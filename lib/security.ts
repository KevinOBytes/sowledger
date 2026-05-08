import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { NextRequest } from "next/server";
import { env } from "./env";
import { UnauthorizedError } from "./auth";
import { db } from "./db";
import { webhooks, lockPeriods, timeEntries, auditLogs } from "./db/schema";
import { eq, and, gte, lt, ne, sql, isNotNull } from "drizzle-orm";

const timerStopCounters = new Map<string, { windowStart: number; count: number }>();
const BLOCKED_WEBHOOK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"]);

function isPrivateIPv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function parseMappedIpv4(mapped: string) {
  if (mapped.includes(".")) return mapped;
  const groups = mapped.split(":").filter(Boolean);
  if (groups.length !== 2) return null;
  const [high, low] = groups.map((group) => Number.parseInt(group, 16));
  if ([high, low].some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) return null;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateIPv6(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "::" || host === "::1") return true;
  if (/^fe[89ab][0-9a-f]?:/i.test(host)) return true;
  if (/^f[cd][0-9a-f]{0,2}:/i.test(host)) return true;
  if (/^ff[0-9a-f]{0,2}:/i.test(host)) return true;
  if (host.startsWith("2001:db8:")) return true;
  if (host.startsWith("::ffff:")) {
    const mapped = parseMappedIpv4(host.slice("::ffff:".length));
    return !mapped || isPrivateIPv4(mapped);
  }
  return false;
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isBlockedWebhookHost(hostname: string) {
  const host = normalizeHostname(hostname);
  const ipVersion = isIP(host);
  return BLOCKED_WEBHOOK_HOSTS.has(host)
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || (ipVersion === 4 && isPrivateIPv4(host))
    || (ipVersion === 6 && isPrivateIPv6(host));
}

export async function validateWebhookUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("A valid HTTPS URL is required.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    url.protocol !== "https:"
    || Boolean(url.username || url.password)
    || isBlockedWebhookHost(hostname)
  ) {
    throw new Error("Webhook URL must be a public HTTPS endpoint.");
  }

  if (!isIP(hostname)) {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    if (resolved.length === 0 || resolved.some((record) => isBlockedWebhookHost(record.address))) {
      throw new Error("Webhook URL must resolve to a public address.");
    }
  }

  return url.toString();
}

async function resolvePublicWebhookAddress(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (isBlockedWebhookHost(normalized)) throw new Error("Webhook URL must resolve to a public address.");
  if (isIP(normalized)) return { address: normalized, family: isIP(normalized) };

  const resolved = await lookup(normalized, { all: true, verbatim: true });
  const publicRecords = resolved.filter((record) => !isBlockedWebhookHost(record.address));
  if (publicRecords.length === 0 || publicRecords.length !== resolved.length) {
    throw new Error("Webhook URL must resolve to a public address.");
  }
  return publicRecords[0];
}

function publicWebhookLookup(): LookupFunction {
  return (hostname, _options, callback) => {
    resolvePublicWebhookAddress(hostname)
      .then((record) => callback(null, record.address, record.family))
      .catch((error) => callback(error as NodeJS.ErrnoException, "", 0));
  };
}

async function postWebhookPayload(url: string, payload: { event: string; data: unknown }) {
  const body = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });
  const endpoint = new URL(url);

  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(endpoint, {
      method: "POST",
      lookup: publicWebhookLookup(),
      timeout: 10_000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body).toString(),
      },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });

    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function dispatchWebhook(workspaceId: string, eventType: string, payload: unknown) {
  const hooks = await db.select().from(webhooks).where(eq(webhooks.workspaceId, workspaceId));
  const activeHooks = hooks.filter(
    (w) => w.events.includes(eventType) || w.events.includes("*")
  );
  
  if (activeHooks.length === 0) return;

  for (const hook of activeHooks) {
    const url = await validateWebhookUrl(hook.url).catch(() => null);
    if (!url) continue;

    postWebhookPayload(url, { event: eventType, data: payload }).catch((e) => console.error("Webhook failed:", e));
  }
}

export async function enforceAuthKey(req: NextRequest) {
  if (!env.AUTH_SHARED_KEY && !env.CRON_SECRET) {
    if (env.NODE_ENV === "production") {
      throw new UnauthorizedError("AUTH_SHARED_KEY or CRON_SECRET must be configured");
    }
    return;
  }
  const key = req.headers.get("x-auth-key");
  const authorization = req.headers.get("authorization");
  const validSharedKey = Boolean(env.AUTH_SHARED_KEY && key === env.AUTH_SHARED_KEY);
  const validCronSecret = Boolean(env.CRON_SECRET && authorization === `Bearer ${env.CRON_SECRET}`);
  if (!validSharedKey && !validCronSecret) throw new UnauthorizedError("Invalid auth key");
}

export async function enforceStopRateLimit(identity: string) {
  const now = Date.now();
  const entry = timerStopCounters.get(identity);
  if (!entry || now - entry.windowStart > 30_000) {
    timerStopCounters.set(identity, { windowStart: now, count: 1 });
    return;
  }

  if (entry.count >= 10) throw new Error("Rate limit exceeded on timer stop endpoint");
  timerStopCounters.set(identity, { ...entry, count: entry.count + 1 });
}

export async function ensurePeriodUnlocked(workspaceId: string, startedAt: Date, stoppedAt: Date) {
  const locks = await db.select().from(lockPeriods).where(eq(lockPeriods.workspaceId, workspaceId));
  for (const lock of locks) {
    const lockStart = new Date(lock.periodStart);
    const lockEnd = new Date(lock.periodEnd);
    if (startedAt < lockEnd && stoppedAt > lockStart) {
      throw new Error(`Period is locked: ${lock.reason}`);
    }
  }
}

export type TimeWindowSegment = {
  startedAt: Date;
  stoppedAt: Date;
  durationSeconds: number;
};

function utcDayRange(businessDate: Date) {
  const dayStart = new Date(Date.UTC(
    businessDate.getUTCFullYear(),
    businessDate.getUTCMonth(),
    businessDate.getUTCDate(),
    0,
    0,
    0,
  ));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

function utcDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getDailyLoggedSeconds(workspaceId: string, userId: string, businessDate: Date, excludeEntryId?: string) {
  const { dayStart, dayEnd } = utcDayRange(businessDate);
  const filters = [
    eq(timeEntries.workspaceId, workspaceId),
    eq(timeEntries.userId, userId),
    gte(timeEntries.startedAt, dayStart),
    lt(timeEntries.startedAt, dayEnd),
    isNotNull(timeEntries.durationSeconds),
  ];
  if (excludeEntryId) {
    filters.push(ne(timeEntries.id, excludeEntryId));
  }

  const [result] = await db
    .select({
      totalSeconds: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)`,
    })
    .from(timeEntries)
    .where(and(...filters));

  const total = Number(result?.totalSeconds ?? 0);
  return Number.isFinite(total) ? total : 0;
}

export async function enforceDailyHoursLimit(workspaceId: string, userId: string, businessDate: Date, nextSeconds: number, excludeEntryId?: string) {
  const total = await getDailyLoggedSeconds(workspaceId, userId, businessDate, excludeEntryId);
  if (total + nextSeconds > 86400) throw new Error("Impossible time: cannot exceed 24 hours in a day");
}

export function splitTimeWindowByUtcDay(startedAt: Date, stoppedAt: Date): TimeWindowSegment[] {
  if (stoppedAt <= startedAt) {
    return [{ startedAt, stoppedAt, durationSeconds: 1 }];
  }

  const segments: TimeWindowSegment[] = [];
  let cursor = new Date(startedAt);

  while (cursor < stoppedAt) {
    const nextDay = new Date(Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate() + 1,
      0,
      0,
      0,
    ));
    const segmentEnd = nextDay < stoppedAt ? nextDay : stoppedAt;
    segments.push({
      startedAt: new Date(cursor),
      stoppedAt: new Date(segmentEnd),
      durationSeconds: Math.max(1, Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000)),
    });
    cursor = segmentEnd;
  }

  return segments;
}

export async function enforceDailyHoursLimitForWindow(workspaceId: string, userId: string, startedAt: Date, stoppedAt: Date, excludeEntryId?: string) {
  for (const segment of splitTimeWindowByUtcDay(startedAt, stoppedAt)) {
    await enforceDailyHoursLimit(workspaceId, userId, segment.startedAt, segment.durationSeconds, excludeEntryId);
  }
}

export async function fitTimeWindowSegmentsToDailyLimit(params: {
  workspaceId: string;
  userId: string;
  segments: TimeWindowSegment[];
  excludeEntryId?: string;
}) {
  const fittedSegments: TimeWindowSegment[] = [];
  const dayTotals = new Map<string, number>();
  let trimmedSeconds = 0;

  for (const segment of params.segments) {
    const key = utcDayKey(segment.startedAt);
    let usedSeconds = dayTotals.get(key);
    if (usedSeconds === undefined) {
      usedSeconds = await getDailyLoggedSeconds(params.workspaceId, params.userId, segment.startedAt, params.excludeEntryId);
    }

    const availableSeconds = Math.max(0, Math.floor(86400 - usedSeconds));
    const allowedSeconds = Math.min(segment.durationSeconds, availableSeconds);
    const removedSeconds = Math.max(0, segment.durationSeconds - allowedSeconds);
    trimmedSeconds += removedSeconds;

    if (allowedSeconds > 0) {
      fittedSegments.push({
        startedAt: segment.startedAt,
        stoppedAt: allowedSeconds === segment.durationSeconds
          ? segment.stoppedAt
          : new Date(segment.startedAt.getTime() + allowedSeconds * 1000),
        durationSeconds: allowedSeconds,
      });
    }

    dayTotals.set(key, usedSeconds + allowedSeconds);
  }

  return { segments: fittedSegments, trimmedSeconds };
}

function signAudit(diff: string, eventType: string) {
  const secret = env.AUDIT_SIGNING_SECRET ?? env.AUTH_COOKIE_SECRET;
  if (!secret) {
    if (env.NODE_ENV === "production") {
      throw new Error("AUDIT_SIGNING_SECRET (or AUTH_COOKIE_SECRET) must be set in production");
    }
    return createHmac("sha256", "dev-only-secret").update(`${eventType}:${diff}`).digest("hex");
  }
  return createHmac("sha256", secret).update(`${eventType}:${diff}`).digest("hex");
}

export async function appendAuditLog(params: {
  workspaceId: string;
  timeEntryId: string;
  actorUserId: string;
  eventType: string;
  diff: Record<string, { before: unknown; after: unknown }>;
}) {
  const serializedDiff = JSON.stringify(params.diff);
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId,
    timeEntryId: params.timeEntryId,
    actorUserId: params.actorUserId,
    eventType: params.eventType,
    diff: params.diff,
    signature: signAudit(serializedDiff, params.eventType),
  });

  // Fire Webhooks async without blocking the main thread
  dispatchWebhook(params.workspaceId, params.eventType, params.diff).catch(() => {});
}

export async function createTimeEntry(input: Omit<typeof timeEntries.$inferInsert, "id" | "createdAt">) {
  const entry = { ...input, id: crypto.randomUUID() };
  const [res] = await db.insert(timeEntries).values(entry).returning();
  return res;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    const sanitized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    if (sanitized.includes(",") || sanitized.includes("\n") || sanitized.includes('"')) {
      return `"${sanitized.replaceAll('"', '""')}"`;
    }
    return sanitized;
  };

  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}

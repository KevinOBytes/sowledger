import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { NextRequest, after } from "next/server";
import { env } from "./env";
import { UnauthorizedError } from "./auth";
import { db } from "./db";
import { webhooks, lockPeriods, auditLogs } from "./db/schema";
import { eq } from "drizzle-orm";

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

export class WebhookUrlValidationError extends Error {}

export async function validateWebhookUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlValidationError("A valid HTTPS URL is required.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    url.protocol !== "https:"
    || Boolean(url.username || url.password)
    || isBlockedWebhookHost(hostname)
  ) {
    throw new WebhookUrlValidationError("Webhook URL must be a public HTTPS endpoint.");
  }

  if (!isIP(hostname)) {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    if (resolved.length === 0 || resolved.some((record) => isBlockedWebhookHost(record.address))) {
      throw new WebhookUrlValidationError("Webhook URL must resolve to a public address.");
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
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Webhook returned HTTP ${res.statusCode ?? "unknown"}`));
      });
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

  await Promise.all(activeHooks.map(async (hook) => {
    const url = await validateWebhookUrl(hook.url).catch(() => null);
    if (!url) return;
    try {
      await postWebhookPayload(url, { event: eventType, data: payload });
    } catch {
      // Keep endpoint URLs and payloads out of application logs.
      console.error("Webhook delivery failed", { webhookId: hook.id, eventType });
    }
  }));
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

  if (entry.count >= 10) throw new TimerStopRateLimitError();
  timerStopCounters.set(identity, { ...entry, count: entry.count + 1 });
}

export class TimerStopRateLimitError extends Error {
  constructor() { super("Rate limit exceeded on timer stop endpoint"); }
}

export class PeriodLockedError extends Error {
  constructor() { super("This entry is in a locked period."); }
}

export async function ensurePeriodUnlocked(workspaceId: string, startedAt: Date, stoppedAt: Date, client: Pick<typeof db, "select"> = db) {
  const locks = await client.select().from(lockPeriods).where(eq(lockPeriods.workspaceId, workspaceId));
  for (const lock of locks) {
    const lockStart = new Date(lock.periodStart);
    const lockEnd = new Date(lock.periodEnd);
    if (startedAt < lockEnd && stoppedAt > lockStart) {
      throw new PeriodLockedError();
    }
  }
}

export type TimeWindowSegment = {
  startedAt: Date;
  stoppedAt: Date;
  durationSeconds: number;
};

export function splitTimeWindowByUtcDay(startedAt: Date, stoppedAt: Date): TimeWindowSegment[] {
  const startMs = startedAt.getTime();
  const stopMs = stoppedAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs < startMs) {
    throw new RangeError("Time window must have valid dates in chronological order");
  }
  if (stopMs === startMs) {
    return [{ startedAt, stoppedAt, durationSeconds: 0 }];
  }

  // Round once for the whole window. Cumulative allocation conserves that
  // budget without changing the real geometry of UTC-midnight fragments.
  const budget = Math.max(1, Math.floor((stopMs - startMs) / 1000));
  const segments: TimeWindowSegment[] = [];
  let cursor = new Date(startedAt);
  let allocatedSeconds = 0;

  while (cursor < stoppedAt) {
    // Date.UTC remaps numeric years 0–99 to 1900–1999. Mutating a copy
    // preserves the actual year, including leap years and year boundaries.
    const nextDay = new Date(cursor);
    nextDay.setUTCHours(0, 0, 0, 0);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const segmentEnd = nextDay < stoppedAt ? nextDay : stoppedAt;
    const cumulativeSeconds = segmentEnd.getTime() === stopMs
      ? budget
      : Math.floor((segmentEnd.getTime() - startMs) / 1000);
    segments.push({
      startedAt: new Date(cursor),
      stoppedAt: new Date(segmentEnd),
      durationSeconds: cumulativeSeconds - allocatedSeconds,
    });
    allocatedSeconds = cumulativeSeconds;
    cursor = segmentEnd;
  }

  return segments;
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
}, transaction?: Pick<typeof db, "insert">) {
  const serializedDiff = JSON.stringify(params.diff);
  const id = crypto.randomUUID();
  await (transaction ?? db).insert(auditLogs).values({
    id,
    workspaceId: params.workspaceId,
    timeEntryId: params.timeEntryId,
    actorUserId: params.actorUserId,
    eventType: params.eventType,
    diff: params.diff,
    signature: signAudit(serializedDiff, params.eventType),
  });

  // Transactional callers dispatch only after commit so rolled-back events
  // cannot escape to integrations. Await delivery for the serverless lifetime.
  if (!transaction) {
    after(async () => {
      await dispatchWebhook(params.workspaceId, params.eventType, params.diff);
    });
  }
  return id;
}

/** The caller reconstructs the original payload; JSONB object order is not signing order. */
export function verifyAuditSignature(eventType: string, originalDiff: Record<string, { before: unknown; after: unknown }>, signature: string) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signAudit(JSON.stringify(originalDiff), eventType), "hex"), Buffer.from(signature, "hex"));
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

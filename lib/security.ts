import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { env } from "./env";
import { UnauthorizedError } from "./auth";
import { db } from "./db";
import { webhooks, lockPeriods, timeEntries, auditLogs } from "./db/schema";
import { eq, and, gt, lt } from "drizzle-orm";

const timerStopCounters = new Map<string, { windowStart: number; count: number }>();

export async function dispatchWebhook(workspaceId: string, eventType: string, payload: unknown) {
  const hooks = await db.select().from(webhooks).where(eq(webhooks.workspaceId, workspaceId));
  const activeHooks = hooks.filter(
    (w) => w.events.includes(eventType) || w.events.includes("*")
  );
  
  if (activeHooks.length === 0) return;

  for (const hook of activeHooks) {
    // Fire-and-forget
    fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() }),
    }).catch((e) => console.error("Webhook failed:", e));
  }
}

export async function enforceAuthKey(req: NextRequest) {
  if (!env.AUTH_SHARED_KEY) {
    if (env.NODE_ENV === "production") {
      throw new UnauthorizedError("AUTH_SHARED_KEY must be configured");
    }
    return;
  }
  const key = req.headers.get("x-auth-key");
  if (!key || key !== env.AUTH_SHARED_KEY) throw new UnauthorizedError("Invalid auth key");
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

export async function enforceDailyHoursLimit(userId: string, businessDate: Date, nextSeconds: number, excludeEntryId?: string) {
  const dayStart = new Date(Date.UTC(
    businessDate.getUTCFullYear(),
    businessDate.getUTCMonth(),
    businessDate.getUTCDate(),
    0,
    0,
    0,
  ));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const query = db.select().from(timeEntries).where(and(
    eq(timeEntries.userId, userId),
    gt(timeEntries.startedAt, dayStart),
    lt(timeEntries.startedAt, dayEnd)
  ));

  const entries = await query;
  
  const total = entries.reduce((acc, entry) => {
    if (!entry.durationSeconds || entry.id === excludeEntryId) return acc;
    return acc + entry.durationSeconds;
  }, 0);

  if (total + nextSeconds > 86400) throw new Error("Impossible time: cannot exceed 24 hours in a day");
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

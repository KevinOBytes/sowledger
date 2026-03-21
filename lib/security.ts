import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { env } from "./env";
import { UnauthorizedError } from "./auth";
import { store, type TimeEntry } from "./store";

export async function dispatchWebhook(workspaceId: string, eventType: string, payload: unknown) {
  const webhooks = Array.from(store.webhooks.values()).filter(
    (w) => w.workspaceId === workspaceId && (w.events.includes(eventType) || w.events.includes("*"))
  );
  if (webhooks.length === 0) return;

  for (const hook of webhooks) {
    // Fire-and-forget
    fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() }),
    }).catch((e) => console.error("Webhook failed:", e));
  }
}

export async function enforceAuthKey(req: NextRequest) {
  if (!env.AUTH_SHARED_KEY) return;
  const key = req.headers.get("x-auth-key");
  if (!key || key !== env.AUTH_SHARED_KEY) throw new UnauthorizedError("Invalid auth key");
}

export async function enforceStopRateLimit(identity: string) {
  const now = Date.now();
  const entry = store.timerStopCounters.get(identity);
  if (!entry || now - entry.windowStart > 30_000) {
    store.timerStopCounters.set(identity, { windowStart: now, count: 1 });
    return;
  }

  if (entry.count >= 10) throw new Error("Rate limit exceeded on timer stop endpoint");
  store.timerStopCounters.set(identity, { ...entry, count: entry.count + 1 });
}

export async function ensurePeriodUnlocked(workspaceId: string, startedAt: Date, stoppedAt: Date) {
  for (const lock of store.locks) {
    if (lock.workspaceId !== workspaceId) continue;
    const lockStart = new Date(lock.periodStart);
    const lockEnd = new Date(lock.periodEnd);
    if (startedAt < lockEnd && stoppedAt > lockStart) {
      throw new Error(`Period is locked: ${lock.reason}`);
    }
  }
}

export async function enforceDailyHoursLimit(userId: string, businessDate: Date, nextSeconds: number, excludeEntryId?: string) {
  const dayStart = Date.UTC(
    businessDate.getUTCFullYear(),
    businessDate.getUTCMonth(),
    businessDate.getUTCDate(),
    0,
    0,
    0,
  );
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const total = [...store.entries.values()].reduce((acc, entry) => {
    if (entry.userId !== userId || !entry.durationSeconds || entry.id === excludeEntryId) return acc;
    const started = new Date(entry.startedAt).getTime();
    return started >= dayStart && started < dayEnd ? acc + entry.durationSeconds : acc;
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
  store.audits.push({
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId,
    timeEntryId: params.timeEntryId,
    actorUserId: params.actorUserId,
    eventType: params.eventType,
    diff: params.diff,
    signature: signAudit(serializedDiff, params.eventType),
    createdAt: new Date().toISOString(),
  });

  // Fire Webhooks async without blocking the main thread
  dispatchWebhook(params.workspaceId, params.eventType, params.diff).catch(() => {});
}

export function createTimeEntry(input: Omit<TimeEntry, "id">) {
  const entry: TimeEntry = { ...input, id: crypto.randomUUID() };
  store.entries.set(entry.id, entry);
  return entry;
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

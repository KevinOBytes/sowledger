import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";

const errors = {
  input: { status: 400, message: "entryId must be a non-empty string of at most 255 characters." },
  missing: { status: 404, message: "No active timer found for entry" },
  pauseData: { status: 409, message: "The pause time for this timer is invalid. Contact support for help." },
  changed: { status: 409, message: "This timer changed. Refresh it and try again." },
} as const;

export class TimerTransitionError extends Error {
  constructor(readonly kind: keyof typeof errors) { super(errors[kind].message); }
  get status() { return errors[this.kind].status; }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 255 && !value.includes("\0");
}

export function timerTransitionEntryId(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !("entryId" in body) || !validId(body.entryId)) throw new TimerTransitionError("input");
  // Whitespace in a nonblank identifier is significant; never rewrite identity.
  return body.entryId;
}

function pauseAggregate(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TimerTransitionError("pauseData");
  // pg may return the shortest float4 decimal (e.g. 0.2), not its widened
  // binary value. Calculate using the canonical stored real, retaining fractions.
  const canonical = Math.fround(value);
  if (!Number.isFinite(canonical) || (value !== 0 && canonical === 0)) throw new TimerTransitionError("pauseData");
  return canonical === 0 ? 0 : canonical;
}

export async function transitionTimer(input: { workspaceId: string; userId: string; entryId: string; action: "pause" | "resume" }) {
  if (!validId(input.workspaceId) || !validId(input.userId) || !validId(input.entryId)) throw new TimerTransitionError("input");
  if (input.action !== "pause" && input.action !== "resume") throw new TypeError("Unsupported timer transition");

  return db.transaction(async (tx) => {
    // The first application data query is this exact scoped row lock. Unlike
    // stop, transitions need no capacity lock and must never request one later.
    const identity = and(eq(timeEntries.id, input.entryId), eq(timeEntries.workspaceId, input.workspaceId), eq(timeEntries.userId, input.userId));
    const [entry] = await tx.select().from(timeEntries).where(identity).for("update");
    if (!entry || entry.stoppedAt !== null) throw new TimerTransitionError("missing");
    const aggregate = pauseAggregate(entry.accumulatedSeconds);
    if (typeof entry.isPaused !== "boolean" || (entry.isPaused && (!(entry.pausedAt instanceof Date) || !Number.isFinite(entry.pausedAt.getTime())))) {
      throw new TimerTransitionError("pauseData");
    }
    const pausing = input.action === "pause";
    if (entry.isPaused === pausing) return { ok: true as const, message: pausing ? "Timer is already paused" : "Timer is already running" };

    // Do not capture a request-start or transaction-start clock before waiting.
    const now = new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid transition clock");
    let next = aggregate;
    if (!pausing) {
      const difference = now.getTime() - entry.pausedAt!.getTime();
      const elapsed = Math.max(0, Math.floor(difference / 1000));
      if (!Number.isSafeInteger(difference) || !Number.isSafeInteger(elapsed)) throw new TimerTransitionError("pauseData");
      const sum = aggregate + elapsed;
      next = Math.fround(sum);
      if (!Number.isFinite(sum) || sum < 0 || !Number.isFinite(next)) throw new TimerTransitionError("pauseData");
      // Existing real precision can absorb a small addition at very large totals.
      // This preserves storage semantics, not exact historical pause intervals.
    }
    const changed = await tx.update(timeEntries).set(pausing
      ? { isPaused: true, pausedAt: now }
      : { isPaused: false, pausedAt: null, accumulatedSeconds: next },
    ).where(and(identity, isNull(timeEntries.stoppedAt), eq(timeEntries.isPaused, entry.isPaused))).returning({ id: timeEntries.id });
    if (changed.length !== 1 || changed[0].id !== entry.id) throw new TimerTransitionError("changed");
    return { ok: true as const };
  }, { isolationLevel: "read committed" });
}

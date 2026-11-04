import { createHash } from "node:crypto";
import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import type { TimeWindowSegment } from "@/lib/security";

export type TimeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Identity = { workspaceId: string; userId: string };
export type BucketRow = { id: string; workspaceId: string; userId: string; startedAt: Date; durationSeconds: number | null };
const locked = Symbol("locked time capacity");
export type LockedCapacity = { readonly tx: TimeTransaction; readonly identity: Readonly<Identity>; readonly [locked]: true };
export const SECOND_UNITS = BigInt("1") << BigInt("149");
const CAP_UNITS = BigInt("86400") * SECOND_UNITS;

export class TimeCapacityError extends Error {
  constructor() { super("This change would exceed 24 logged hours in a day."); }
}
export class TimePrecisionError extends Error {
  constructor(message = "This duration cannot be stored at the supported precision. Choose a different duration.") { super(message); }
}
export class TimeDataError extends Error {
  constructor() { super("Saved time data is invalid. Ask a workspace manager to review it."); }
}

/** Canonical PostgreSQL real value and its exact nonnegative 2^-149 units. */
export function storedDuration(value: number): { seconds: number; units: bigint } {
  const seconds = Math.fround(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(seconds) || (value !== 0 && seconds === 0)) throw new TimePrecisionError();
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, seconds, false);
  const bits = view.getUint32(0, false);
  const exponent = (bits >>> 23) & 255;
  const fraction = BigInt(bits & 0x7fffff);
  return { seconds: seconds === 0 ? 0 : seconds, units: exponent === 0 ? fraction : (BigInt("0x800000") + fraction) << BigInt(exponent - 1) };
}
export function savedDuration(value: number) {
  try { return storedDuration(value); } catch { throw new TimeDataError(); }
}

export function capacityLockKey(identity: Identity): bigint {
  return createHash("sha256").update(JSON.stringify(["sowledger:time-capacity:v1", identity.workspaceId, identity.userId])).digest().readBigInt64BE(0);
}
export async function withTimeCapacity<T>(identity: Identity, body: (capacity: LockedCapacity) => Promise<T>): Promise<T> {
  if (typeof identity.workspaceId !== "string" || !identity.workspaceId || typeof identity.userId !== "string" || !identity.userId) throw new TimeDataError();
  const bound = Object.freeze({ ...identity });
  const key = capacityLockKey(bound).toString();
  return db.transaction(async (tx) => {
    // A separate awaited statement is essential: counted reads must obtain a
    // fresh Read Committed snapshot after any preceding holder has committed.
    await tx.execute(sql`select pg_advisory_xact_lock(${key}::bigint)`);
    return body({ tx, identity: bound, [locked]: true });
  }, { isolationLevel: "read committed" });
}

function dayRange(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new TimeDataError();
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new TimeDataError();
  return { start, end, key: start.toISOString().split("T")[0] };
}
function contribution(rows: readonly BucketRow[], identity: Identity) {
  const totals = new Map<string, bigint>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || !row.id || ids.has(row.id)) throw new TimeDataError();
    ids.add(row.id);
    const key = dayRange(row.startedAt).key;
    totals.set(key, (totals.get(key) ?? BigInt("0")) + (row.durationSeconds === null ? BigInt("0") : savedDuration(row.durationSeconds).units));
  }
  return totals;
}
export async function readBucketTotals(capacity: LockedCapacity, days: readonly Date[]) {
  const ranges = new Map(days.map(date => { const range = dayRange(date); return [range.key, range] as const; }));
  const totals = new Map([...ranges.keys()].map(key => [key, BigInt("0")]));
  if (!ranges.size) return totals;
  const rows = await capacity.tx.select({
    startedAt: timeEntries.startedAt,
    durationSeconds: sql<number | null>`${timeEntries.durationSeconds}::double precision`,
  }).from(timeEntries).where(and(
    eq(timeEntries.workspaceId, capacity.identity.workspaceId), eq(timeEntries.userId, capacity.identity.userId),
    or(...[...ranges.values()].map(range => and(gte(timeEntries.startedAt, range.start), lt(timeEntries.startedAt, range.end)))),
  ));
  for (const row of rows) {
    const key = dayRange(row.startedAt).key;
    if (!totals.has(key)) throw new TimeDataError();
    totals.set(key, totals.get(key)! + (row.durationSeconds === null ? BigInt("0") : savedDuration(row.durationSeconds).units));
  }
  return totals;
}
export async function assertBucketReplacement(capacity: LockedCapacity, change: { before: readonly BucketRow[]; after: readonly BucketRow[] }) {
  const before = contribution(change.before, capacity.identity);
  const after = contribution(change.after, capacity.identity);
  const totals = await readBucketTotals(capacity, [...change.before, ...change.after].map(row => row.startedAt));
  for (const [key, total] of totals) {
    const old = before.get(key) ?? BigInt("0");
    const next = after.get(key) ?? BigInt("0");
    if (total < old) throw new TimeDataError();
    if (next > old && total - old + next > CAP_UNITS) throw new TimeCapacityError();
  }
}
export async function fitStoppedSegments(capacity: LockedCapacity, input: { segments: readonly TimeWindowSegment[]; originalEntry: BucketRow }) {
  const before = contribution([input.originalEntry], capacity.identity);
  const totals = await readBucketTotals(capacity, [input.originalEntry.startedAt, ...input.segments.map(row => row.startedAt)]);
  for (const [key, units] of before) {
    const total = totals.get(key)!;
    if (total < units) throw new TimeDataError();
    totals.set(key, total - units);
  }
  const segments: TimeWindowSegment[] = [];
  let trimmedSeconds = 0;
  for (const segment of input.segments) {
    const key = dayRange(segment.startedAt).key;
    const desired = storedDuration(segment.durationSeconds);
    const used = totals.get(key)!;
    const available = used >= CAP_UNITS ? 0 : Number((CAP_UNITS - used) / SECOND_UNITS);
    const allowed = storedDuration(Math.min(desired.seconds, available));
    trimmedSeconds += desired.seconds - allowed.seconds;
    if (allowed.units > BigInt("0")) segments.push({ ...segment, durationSeconds: allowed.seconds,
      stoppedAt: allowed.units === desired.units ? segment.stoppedAt : new Date(segment.startedAt.getTime() + allowed.seconds * 1000) });
    totals.set(key, used + allowed.units);
  }
  await assertBucketReplacement(capacity, { before: [input.originalEntry], after: segments.map((row, index) => ({ ...row, ...capacity.identity, id: index === 0 ? input.originalEntry.id : `planned-stop-${index}` })) });
  return { segments, trimmedSeconds };
}

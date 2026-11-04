import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { createHash } from "node:crypto";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { Pool, type PoolClient } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { db, getDb } from "../lib/db";
import { apiKeys, auditLogs, lockPeriods, memberships, scheduledWorkBlocks, timeEntries } from "../lib/db/schema";
import { generateApiKeyMaterial } from "../lib/api-keys";

type Owner = { workspaceId: string; userId: string };
type Writer = "M" | "E" | "T" | "I" | "A" | "S";
type Attempt = { writer: Writer; entryId: string; blockId: string; send: () => Promise<APIResponse> };
const start = new Date("2026-10-02T00:00:00.000Z");
const end = new Date("2026-10-02T00:05:00.000Z");
const second = BigInt(2) ** BigInt(149);
const limit = BigInt(86400) * second;

// Independent vector/oracle: do not import the production capacity checker.
function key(owner: Owner) {
  const bytes = createHash("sha256").update(JSON.stringify(["sowledger:time-capacity:v1", owner.workspaceId, owner.userId])).digest();
  const unsigned = BigInt(`0x${bytes.subarray(0, 8).toString("hex")}`);
  return unsigned >= BigInt("9223372036854775808") ? unsigned - BigInt("18446744073709551616") : unsigned;
}
function exactFloat4(hex: string | null) {
  if (hex === null) return BigInt(0);
  const binary = BigInt(`0x${hex}`).toString(2).padStart(32, "0");
  const sign = binary[0], exponent = parseInt(binary.slice(1, 9), 2), fraction = BigInt(`0b${binary.slice(9)}`);
  expect(sign).toBe("0"); expect(exponent).toBeLessThan(255);
  return exponent === 0 ? fraction : (BigInt(8388608) + fraction) * BigInt(2) ** BigInt(exponent - 1);
}
async function snapshot(owner: Owner) {
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.userId, owner.userId)));
  const blocks = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.userId, owner.userId)));
  const audits = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, owner.workspaceId));
  return { entries: entries.sort((a, b) => a.id.localeCompare(b.id)), blocks: blocks.sort((a, b) => a.id.localeCompare(b.id)), audits: audits.sort((a, b) => a.id.localeCompare(b.id)) };
}
async function totals(owner: Owner) {
  const rows = await db.select({ day: sql<string>`to_char(${timeEntries.startedAt}, 'YYYY-MM-DD')`, bits: sql<string | null>`encode(float4send(${timeEntries.durationSeconds}), 'hex')` }).from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.userId, owner.userId)));
  const result = new Map<string, bigint>();
  for (const row of rows) result.set(row.day, (result.get(row.day) ?? BigInt(0)) + exactFloat4(row.bits));
  return result;
}

test.describe("transactional time capacity: actual HTTP and PostgreSQL barriers", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable database only; never production fixtures.");
  test.setTimeout(45000);
  let pool: Pool;
  test.beforeAll(() => { pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 3000, query_timeout: 3000 }); });
  test.afterAll(async () => { await pool?.end(); });

  async function login(request: APIRequestContext, workspace = `time-cap-${crypto.randomUUID()}`, email = `${crypto.randomUUID()}@example.com`) {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email, role: "owner", plan: "smb" })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    return { owner: await response.json() as Owner, workspace, email };
  }
  async function insert(owner: Owner, durationSeconds: number | null, extra: Partial<typeof timeEntries.$inferInsert> = {}) {
    const [entry] = await db.insert(timeEntries).values({ id: crypto.randomUUID(), ...owner, taskId: "Capacity fixture", startedAt: start, stoppedAt: end, durationSeconds, status: "draft", ...extra }).returning();
    return entry;
  }
  async function apiKey(owner: Owner) {
    const material = generateApiKeyMaterial();
    await db.insert(apiKeys).values({ id: crypto.randomUUID(), ...owner, name: "Disposable capacity key", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes: ["write:time", "impersonate:user"], createdByUserId: owner.userId });
    return material.rawKey;
  }
  async function warm(request: APIRequestContext, bearer: string) {
    for (const path of ["manual", "stop", "split"]) await request.post(`/api/timer/${path}`, { data: {}, timeout: 12000 });
    await request.patch("/api/timer/edit", { data: {}, timeout: 12000 });
    await request.post("/api/integrations/calendar/import", { data: { events: "invalid" }, timeout: 12000 });
    await request.post("/api/v1/time-entries", { headers: { authorization: `Bearer ${bearer}` }, data: {}, timeout: 12000 });
  }
  async function attempt(request: APIRequestContext, owner: Owner, writer: Writer, bearer: string, index: number): Promise<Attempt> {
    const entryId = crypto.randomUUID(), blockId = crypto.randomUUID();
    if (writer !== "I") {
      await db.insert(scheduledWorkBlocks).values({ id: blockId, ...owner, createdByUserId: owner.userId, title: "Independent capacity plan", startsAt: start, endsAt: end, status: writer === "M" || writer === "A" ? "planned" : writer === "T" ? "in_progress" : "completed", linkedTimeEntryId: writer === "M" || writer === "A" ? null : entryId });
    }
    if (writer === "E" || writer === "T" || writer === "S") await insert(owner, writer === "T" ? null : writer === "E" ? 300 : 600, {
      id: entryId, scheduledBlockId: blockId, startedAt: writer === "S" ? new Date("2026-10-01T23:55:00Z") : start, stoppedAt: writer === "T" ? null : end,
    });
    const data = { startedAt: start.toISOString(), stoppedAt: end.toISOString(), scheduledBlockId: blockId, taskId: `Barrier ${writer}/${index}` };
    const send = () => writer === "E" ? request.patch("/api/timer/edit", { data: { entryId, stoppedAt: "2026-10-02T00:10:00Z" }, timeout: 12000 })
      : writer === "T" ? request.post("/api/timer/stop", { data: { entryId, endedAt: end.toISOString() }, timeout: 12000 })
      : writer === "S" ? request.post("/api/timer/split", { data: { entryId, fractionSeconds: 300 }, timeout: 12000 })
      : writer === "I" ? request.post("/api/integrations/calendar/import", { data: { events: [{ id: `event-${entryId}`, title: "Barrier import", startsAt: start.toISOString(), endsAt: end.toISOString() }], assigneeUserId: owner.userId }, timeout: 12000 })
      : writer === "A" ? request.post("/api/v1/time-entries", { headers: { authorization: `Bearer ${bearer}` }, data: { ...data, userId: owner.userId }, timeout: 12000 })
      : request.post("/api/timer/manual", { data, timeout: 12000 });
    return { writer, entryId, blockId, send };
  }

  async function barrier<T>(owner: Owner, attempts: Array<() => Promise<T>>, whileHeld: (holder: PoolClient, observer: PoolClient) => Promise<void>, releaseBy: "commit" | "rollback" = "rollback", beforeRequests?: (holder: PoolClient) => Promise<void>) {
    const holder = await pool.connect();
    let observer: PoolClient | undefined;
    const lockKey = key(owner), unsigned = BigInt.asUintN(64, lockKey);
    let released = false, timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const running: Promise<T>[] = [], completed = new Set<number>();
    try {
      observer = await pool.connect();
      await holder.query("begin");
      const holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      await holder.query("select pg_advisory_xact_lock($1::bigint)", [lockKey.toString()]);
      const heldAt = Date.now();
      timer = setTimeout(() => { timedOut = true; void holder.query("rollback").catch(() => {}); }, 6000);
      await beforeRequests?.(holder);
      for (const [index, send] of attempts.entries()) {
        const pending = send().finally(() => { completed.add(index); });
        // Attach a handler immediately so failed requests never become unhandled.
        void pending.catch(() => {}); running.push(pending);
      }
      let waiterCount = 0;
      while (Date.now() - heldAt < 5000) {
        expect(completed.size, "A writer completed without waiting for its capacity key").toBe(0);
        const observed = await observer.query<{ count: number }>(`select count(distinct pid)::int as count from pg_locks where locktype='advisory' and database=(select oid from pg_database where datname=current_database()) and classid=$1::oid and objid=$2::oid and objsubid=1 and mode='ExclusiveLock' and granted=false and pid<>pg_backend_pid() and pid<>$3`, [(unsigned >> BigInt(32)).toString(), (unsigned & BigInt("4294967295")).toString(), holderPid]);
        waiterCount = observed.rows[0].count;
        if (waiterCount === attempts.length) break;
        await yieldLoop();
      }
      expect(waiterCount, "Every request must be observed as an ungranted same-key waiter").toBe(attempts.length);
      await whileHeld(holder, observer);
      expect(timedOut).toBe(false); expect(Date.now() - heldAt).toBeLessThan(6000);
      await holder.query(releaseBy); released = true;
      clearTimeout(timer);
      const result = await Promise.all(running);
      expect(timedOut).toBe(false);
      return result;
    } finally {
      clearTimeout(timer);
      if (!released) await holder.query("rollback").catch(() => {});
      await Promise.allSettled(running);
      holder.release(); observer?.release();
    }
  }

  test("independent stable key vector and binary duration oracle", () => {
    expect(key({ workspaceId: "workspace", userId: "user" }).toString()).toBe("-7397201993736930893");
    expect(exactFloat4("3f800000")).toBe(second);
    expect(exactFloat4("00000001")).toBe(BigInt(1));
    expect(exactFloat4("3e800000")).toBe(second / BigInt(4));
  });

  const writers: Writer[] = ["M", "E", "T", "I", "A", "S"];
  for (const [i, first] of writers.entries()) for (const secondWriter of writers.slice(i)) {
    test(`both HTTP waiters serialize ${first}/${secondWriter} against the shared owner bucket`, async ({ request }) => {
      const { owner } = await login(request);
      const bearer = await apiKey(owner); await warm(request, bearer);
      const attempts = await Promise.all([attempt(request, owner, first, bearer, 0), attempt(request, owner, secondWriter, bearer, 1)]);
      await insert(owner, 86000 - attempts.filter(value => value.writer === "E").length * 300);
      const before = await snapshot(owner);
      const responses = await barrier(owner, attempts.map(value => value.send), async () => { expect(await snapshot(owner)).toEqual(before); });
      const payloads = await Promise.all(responses.map(response => response.json()));
      const stored = await snapshot(owner);
      const targetTotal = (await totals(owner)).get("2026-10-02")!;
      const stopCount = attempts.filter(value => value.writer === "T").length;
      expect(targetTotal <= limit).toBeTruthy();
      if (stopCount === 0) {
        expect(responses.filter(response => response.ok())).toHaveLength(1);
        expect(targetTotal).toBe(BigInt(86300) * second);
      } else if (stopCount === 2) {
        expect(responses.every(response => response.ok())).toBeTruthy();
        expect(payloads.map(value => value.durationSeconds).sort((a, b) => a - b)).toEqual([100, 300]);
        expect(targetTotal).toBe(limit);
      } else expect([BigInt(86300) * second, limit]).toContain(targetTotal);
      for (const [index, value] of attempts.entries()) {
        const response = responses[index], payload = payloads[index];
        // Each import attempt has its own provider identity. A successful I/I
        // competitor must not be mistaken for a rejected attempt's partial save.
        const importHash = createHash("sha256").update(JSON.stringify([owner.workspaceId, owner.userId, "google", `event-${value.entryId}`])).digest("hex");
        const importTaskId = `calendar:google:${importHash}`, importPrefix = `calendar-${importHash}-`;
        const ownsImport = (row: typeof stored.entries[number]) => row.taskId === importTaskId || row.id.startsWith(importPrefix);
        const importIds = new Set([...before.entries, ...stored.entries].filter(ownsImport).map(row => row.id));
        const ownsImportAudit = (row: typeof stored.audits[number]) => row.timeEntryId.startsWith(importPrefix) || importIds.has(row.timeEntryId);
        if (!response.ok()) {
          expect(response.status()).toBe(value.writer === "I" ? 409 : 400);
          expect(stored.entries.filter(row => row.id === value.entryId)).toEqual(before.entries.filter(row => row.id === value.entryId));
          expect(stored.blocks.filter(row => row.id === value.blockId)).toEqual(before.blocks.filter(row => row.id === value.blockId));
          expect(stored.audits.filter(row => row.timeEntryId === value.entryId)).toEqual(before.audits.filter(row => row.timeEntryId === value.entryId));
          if (value.writer === "I") {
            expect(stored.entries.filter(ownsImport)).toEqual(before.entries.filter(ownsImport));
            expect(stored.audits.filter(ownsImportAudit)).toEqual(before.audits.filter(ownsImportAudit));
          }
          if (value.writer === "S") {
            const other = attempts[1 - index];
            const otherCreates = responses[1 - index].ok() && ["M", "A", "I", "S"].includes(other.writer) ? 1 : 0;
            expect(stored.entries.length - before.entries.length).toBe(otherCreates);
          }
        } else if (value.writer === "T") {
          const saved = stored.entries.find(row => row.id === value.entryId)!;
          expect(saved.durationSeconds).toBe(payload.durationSeconds);
          expect(payload.trimmedSeconds).toBe(300 - payload.durationSeconds);
          expect(payload.adjustedForDailyLimit).toBe(payload.durationSeconds !== 300);
        } else if (value.writer === "M" || value.writer === "A") expect(stored.entries.find(row => row.id === payload.entry.id)?.durationSeconds).toBe(payload.entry.durationSeconds);
        else if (value.writer === "E") expect(stored.entries.find(row => row.id === value.entryId)?.durationSeconds).toBe(payload.nextDurationSeconds);
        else if (value.writer === "I") {
          const importedId = `${importPrefix}0`;
          expect(payload).toMatchObject({ imported: 1, skipped: 0 });
          expect(payload.importedIds).toEqual([importedId]);
          const imported = stored.entries.filter(ownsImport);
          expect(imported).toHaveLength(1);
          expect(imported[0]).toMatchObject({ id: importedId, taskId: importTaskId, durationSeconds: 300, source: "calendar", status: "draft", workspaceId: owner.workspaceId, userId: owner.userId });
          expect(stored.audits.filter(ownsImportAudit)).toEqual(before.audits.filter(ownsImportAudit));
        }
      }
    });
  }

  for (const release of ["commit", "rollback"] as const) test(`waiter reads the holder's post-lock ${release} snapshot`, async ({ request }) => {
    const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
    await insert(owner, 86000);
    const writer = await attempt(request, owner, "M", bearer, 0);
    const [response] = await barrier(owner, [writer.send], async () => {}, release, async holder => {
      await holder.query("insert into sowledger.time_entries (id,workspace_id,user_id,task_id,started_at,stopped_at,duration_seconds) values ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), owner.workspaceId, owner.userId, "Holder committed row", start.toISOString(), end.toISOString(), 300]);
    });
    expect(response.status()).toBe(release === "commit" ? 400 : 200);
    expect((await totals(owner)).get("2026-10-02")).toBe(BigInt(86300) * second);
  });

  test("recorded owner, not manager actor, controls edit/split/API/import waiting", async ({ request }) => {
    const actor = await login(request); const bearer = await apiKey(actor.owner); await warm(request, bearer);
    const targetUser = crypto.randomUUID();
    // Use an actual native login to establish the other user, then restore actor.
    const target = await login(request, actor.workspace, `${targetUser}@example.com`);
    await login(request, actor.workspace, actor.email);
    for (const writer of ["E", "S", "A", "I"] as Writer[]) {
      const value = await attempt(request, target.owner, writer, bearer, 0);
      const [response] = await barrier(target.owner, [value.send], async () => {});
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    // Historical staff need not retain membership for manager correction.
    await db.delete(memberships).where(and(eq(memberships.workspaceId, target.owner.workspaceId), eq(memberships.userId, target.owner.userId)));
    const historical = await insert(target.owner, 1, { startedAt: start, stoppedAt: new Date(start.getTime() + 1900) });
    expect((await request.patch("/api/timer/edit", { data: { entryId: historical.id, description: "Historical correction" } })).status()).toBe(200);
  });

  test("independent user/workspace writes complete while one observed same-owner request waits", async ({ request, playwright }) => {
    const held = await login(request); const bearer = await apiKey(held.owner); await warm(request, bearer);
    const otherUser = await playwright.request.newContext({ baseURL: "http://localhost:3008" });
    const otherWorkspace = await playwright.request.newContext({ baseURL: "http://localhost:3008" });
    try {
      const other = await login(otherUser, held.workspace);
      const elsewhere = await login(otherWorkspace, undefined, held.email);
      await warm(otherUser, await apiKey(other.owner)); await warm(otherWorkspace, await apiKey(elsewhere.owner));
      const waiting = await attempt(request, held.owner, "M", bearer, 0);
      const historical = await insert(other.owner, 2, { stoppedAt: new Date(start.getTime() + 1900) });
      await barrier(held.owner, [waiting.send], async () => {
        const responses = await Promise.all([
          otherUser.post("/api/timer/manual", { data: { startedAt: start.toISOString(), stoppedAt: end.toISOString() }, timeout: 2000 }),
          otherWorkspace.post("/api/timer/manual", { data: { startedAt: start.toISOString(), stoppedAt: end.toISOString() }, timeout: 2000 }),
        ]);
        expect(responses.every(response => response.ok())).toBe(true);
        // The actor's capacity key must not serialize correction of another owner.
        expect((await request.patch("/api/timer/edit", { data: { entryId: historical.id, description: "Independent owner correction" }, timeout: 2000 })).status()).toBe(200);
      });
    } finally { await otherUser.dispose(); await otherWorkspace.dispose(); }
  });

  test("binary fractions, overfull corrections, credited moves and precision refusals persist exactly", async ({ request }) => {
    const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
    const parent = await insert(owner, 1, { stoppedAt: new Date(start.getTime() + 1000) });
    await insert(owner, 86399);
    const before = await snapshot(owner);
    for (const fractionSeconds of [0.2, 0.1]) {
      expect((await request.post("/api/timer/split", { data: { entryId: parent.id, fractionSeconds } })).status()).toBe(400);
      expect(await snapshot(owner)).toEqual(before);
    }
    expect((await request.post("/api/timer/split", { data: { entryId: parent.id, fractionSeconds: 0.25 } })).status()).toBe(200);
    expect((await totals(owner)).get("2026-10-02")).toBe(limit);
    const credit = await insert(owner, 2, { startedAt: new Date("2026-10-03T00:00:00Z"), stoppedAt: new Date("2026-10-03T00:00:01.900Z"), accumulatedSeconds: 0.25 });
    const creditBefore = await snapshot(owner);
    expect((await request.patch("/api/timer/edit", { data: { entryId: credit.id, startedAt: start.toISOString(), stoppedAt: "2026-10-02T00:00:01.900Z" } })).status()).toBe(400);
    expect(await snapshot(owner)).toEqual(creditBefore);
    for (const stoppedAt of ["2026-10-03T00:00:02.900Z", "2026-10-03T00:00:01.900Z"]) expect((await request.patch("/api/timer/edit", { data: { entryId: credit.id, stoppedAt } })).status()).toBe(200);
    const [saved] = (await snapshot(owner)).entries.filter(row => row.id === credit.id);
    expect(saved.durationSeconds).toBe(2); expect(saved.accumulatedSeconds).toBe(0.25);
    await insert(owner, 90000, { startedAt: new Date("2026-10-04T00:00:00Z") });
    const overfull = await insert(owner, 1, { startedAt: new Date("2026-10-04T00:00:00Z"), stoppedAt: new Date("2026-10-04T00:00:01Z") });
    expect((await request.patch("/api/timer/edit", { data: { entryId: overfull.id, description: "Safe correction" } })).status()).toBe(200);
    expect((await request.patch("/api/timer/edit", { data: { entryId: overfull.id, stoppedAt: "2026-10-04T00:00:02Z" } })).status()).toBe(400);
  });

  test("opposite credited date moves share one owner key without double subtraction/deadlock", async ({ request }) => {
    const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
    const a = await insert(owner, 2, { stoppedAt: new Date(start.getTime() + 1900), accumulatedSeconds: 0.25 });
    const b = await insert(owner, 2, { startedAt: new Date("2026-10-03T00:00:00Z"), stoppedAt: new Date("2026-10-03T00:00:01.900Z"), accumulatedSeconds: 0 });
    await insert(owner, 86398, { startedAt: new Date("2026-10-03T00:00:00Z") });
    const send = (entryId: string, date: string) => request.patch("/api/timer/edit", { data: { entryId, startedAt: `${date}T00:00:00.000Z`, stoppedAt: `${date}T00:00:01.900Z` }, timeout: 12000 });
    const before = await snapshot(owner);
    const responses = await barrier(owner, [() => send(a.id, "2026-10-03"), () => send(b.id, "2026-10-02")], async () => { expect(await snapshot(owner)).toEqual(before); });
    expect(responses.some(response => response.ok())).toBe(true);
    const counts = await totals(owner);
    expect([...counts.values()].every(value => value <= limit)).toBe(true);
    expect([...counts.values()].reduce((sum, value) => sum + value, BigInt(0))).toBe(BigInt(86402) * second);
    for (const row of (await snapshot(owner)).entries.filter(row => row.id === a.id || row.id === b.id)) {
      expect(row.durationSeconds).toBe(2); expect(row.stoppedAt!.getTime() - row.startedAt.getTime()).toBe(1900);
      expect(row.accumulatedSeconds).toBe(row.id === a.id ? 0.25 : 0);
    }
  });

  test("multi-date import rejects atomically while stop trims only each exhausted start bucket", async ({ request }) => {
    for (const fullDay of ["2026-10-01", "2026-10-02"]) {
      const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
      await insert(owner, 86400, { startedAt: new Date(`${fullDay}T00:00:00Z`) });
      const events = [{ id: "two-days", title: "Allocated work", startsAt: "2026-10-01T23:59:58.100Z", endsAt: "2026-10-02T00:00:01.900Z" }];
      const before = await snapshot(owner);
      expect((await request.post("/api/integrations/calendar/import", { data: { events } })).status()).toBe(409);
      expect(await snapshot(owner)).toEqual(before);
      const timer = await insert(owner, null, { startedAt: new Date(events[0].startsAt), stoppedAt: null });
      const response = await request.post("/api/timer/stop", { data: { entryId: timer.id, endedAt: events[0].endsAt } });
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ durationSeconds: fullDay === "2026-10-01" ? 2 : 1, adjustedForDailyLimit: true, trimmedSeconds: fullDay === "2026-10-01" ? 1 : 2 });
      expect([...(await totals(owner)).values()].every(value => value <= limit)).toBe(true);
    }
  });

  test("same-identity import and same-timer replays wait, then retain one mutation", async ({ request }) => {
    const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
    const events = [{ id: "leading-zero", title: "Boundary minimum", startsAt: "2026-10-01T23:59:59.500Z", endsAt: "2026-10-02T00:00:00.500Z" }];
    const send = () => request.post("/api/integrations/calendar/import", { data: { events }, timeout: 12000 });
    const responses = await barrier(owner, [send, send], async () => {});
    const payloads = await Promise.all(responses.map(response => response.json()));
    expect(payloads.map(value => value.imported).sort()).toEqual([0, 1]);
    const imported = (await snapshot(owner)).entries; expect(imported).toHaveLength(1); expect(imported[0].id.endsWith("-1")).toBe(true);
    await insert(owner, 86399);
    await db.insert(lockPeriods).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, lockedByUserId: owner.userId, periodStart: new Date("2026-10-01Z"), periodEnd: new Date("2026-10-03Z"), reason: "Disposable replay period" });
    const before = await snapshot(owner); expect((await send()).status()).toBe(200); expect(await snapshot(owner)).toEqual(before);
    // A separate date is not locked/full. Both timer attempts must reach capacity.
    const timer = await insert(owner, null, { startedAt: new Date("2026-10-04T00:00:00Z"), stoppedAt: null });
    const stop = () => request.post("/api/timer/stop", { data: { entryId: timer.id, endedAt: "2026-10-04T00:00:01Z" }, timeout: 12000 });
    const stops = await barrier(owner, [stop, stop], async () => {});
    expect(stops.map(response => response.status()).sort()).toEqual([200, 404]);
    expect((await snapshot(owner)).audits.filter(row => row.timeEntryId === timer.id)).toHaveLength(1);
  });

  test("stored fractional totals and malformed numbers cannot become free capacity", async ({ request }) => {
    const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
    await insert(owner, 86399.5);
    const timer = await insert(owner, null, { stoppedAt: null });
    const stopped = await request.post("/api/timer/stop", { data: { entryId: timer.id, endedAt: "2026-10-02T00:00:01Z" } });
    expect(stopped.status()).toBe(200); expect(await stopped.json()).toMatchObject({ durationSeconds: 0, adjustedForDailyLimit: true, trimmedSeconds: 1 });
    const tinyDay = new Date("2026-10-03T00:00:00Z"); await insert(owner, 86400, { startedAt: tinyDay });
    await db.insert(timeEntries).values(Array.from({ length: 128 }, () => ({ id: crypto.randomUUID(), ...owner, taskId: "Tiny persisted legacy value", startedAt: tinyDay, stoppedAt: new Date(tinyDay.getTime() + 1000), durationSeconds: 2 ** -149 })));
    expect((await totals(owner)).get("2026-10-03")).toBe(limit + BigInt(128));
    const data = { startedAt: tinyDay.toISOString(), stoppedAt: new Date(tinyDay.getTime() + 1000).toISOString() };
    expect((await request.post("/api/timer/manual", { data })).status()).toBe(400);
    for (const value of [NaN, Infinity, -0.25]) {
      const bad = await insert(owner, value, { startedAt: new Date("2026-10-04T00:00:00Z") });
      const before = await snapshot(owner);
      expect((await request.post("/api/timer/manual", { data: { startedAt: "2026-10-04T00:00:00Z", stoppedAt: "2026-10-04T00:00:01Z" } })).status()).toBe(409);
      expect(await snapshot(owner)).toEqual(before);
      await db.delete(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.userId, owner.userId), eq(timeEntries.id, bad.id)));
    }
  });

  test("actual-PG split tail/audit and later import-fragment faults roll back preceding writes", async ({ request }) => {
    const native = createRequire(path.join(process.cwd(), "tests/time-capacity-isolated.spec.ts"));
    for (const fault of ["split-tail", "split-audit", "import-fragment"]) {
      const { owner } = await login(request); const bearer = await apiKey(owner); await warm(request, bearer);
      const parent = fault.startsWith("split") ? await insert(owner, 1, { stoppedAt: new Date(start.getTime() + 1000) }) : null;
      const before = await snapshot(owner), original = getDb();
      type Transaction = Parameters<Parameters<typeof original.transaction>[0]>[0];
      let inserts = 0, injected = false;
      const route = fault.startsWith("split") ? "app/api/timer/split/route.ts" : "app/api/integrations/calendar/import/route.ts";
      const data = parent ? { entryId: parent.id, fractionSeconds: 0.25 } : { events: [{ id: "fragment-fault", title: "Two fragments", startsAt: "2026-10-01T23:59:58.100Z", endsAt: "2026-10-02T00:00:01.900Z" }] };
      globalThis.__sowledgerDbClient = new Proxy(original, { get(target, property, receiver) {
        if (property === "transaction") return (callback: (tx: Transaction) => Promise<unknown>, config: Parameters<typeof target.transaction>[1]) => target.transaction(async tx => callback(new Proxy(tx, { get(transaction, prop, txReceiver) {
          if (prop === "insert") return (table: Parameters<Transaction["insert"]>[0]) => {
            if (table === timeEntries) inserts++;
            if ((fault === "split-tail" && table === timeEntries) || (fault === "split-audit" && table === auditLogs) || (fault === "import-fragment" && table === timeEntries && inserts === 2)) { injected = true; throw new Error("Disposable process-only fault"); }
            return transaction.insert(table);
          };
          const value = Reflect.get(transaction, prop, txReceiver); return typeof value === "function" ? value.bind(transaction) : value;
        } })), config);
        const value = Reflect.get(target, property, receiver); return typeof value === "function" ? value.bind(target) : value;
      } });
      try {
        // Only native request context is supplied in-process. Capacity, period,
        // rows, schedule, audit and rollback still execute actual PostgreSQL.
        const loaded = { exports: {} as { POST: (req: Request) => Promise<Response> } };
        const compiled = ts.transpileModule(readFileSync(route, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        new Function("require", "module", "exports", compiled)((id: string) => id === "@/lib/auth" ? { requireSession: async () => ({ ...owner, sub: owner.userId, role: "owner" }), requireRole: () => {} } : id.startsWith("@/") ? native(`../${id.slice(2)}`) : native(id), loaded, loaded.exports);
        const response = await loaded.exports.POST(new Request("http://localhost:3008/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));
        expect(response.status).toBe(500); expect(injected).toBe(true);
      } finally { globalThis.__sowledgerDbClient = original; }
      expect(await snapshot(owner)).toEqual(before);
      const retry = await request.post(parent ? "/api/timer/split" : "/api/integrations/calendar/import", { data });
      expect(retry.ok(), await retry.text()).toBeTruthy();
      const persisted = await snapshot(owner);
      expect(persisted.entries).toHaveLength(2);
      expect(persisted.entries.reduce((sum, row) => sum + row.durationSeconds!, 0)).toBe(parent ? 1 : 3);
    }
  });
});

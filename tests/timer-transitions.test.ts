/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled connection boundary; actual route/helper source runs below. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

type Row = Record<string, any>;
type Condition = (row: Row) => boolean;
const baseline = process.env.SOWLEDGER_TRANSITION_BASELINE === "true";
const instant = Date.parse("2026-01-12T12:00:00Z");
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function comparable(row: Row) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? { dateMs: value.getTime() } : value])); }
class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

function fixture(overrides: Row = {}) {
  let rows: Row[] = [{ id: "timer", workspaceId: "workspace", userId: "actor", stoppedAt: null, isPaused: false, pausedAt: null, accumulatedSeconds: 0, ...overrides }];
  let clock = instant, tick = 0, reads = 0, updates = 0, transactions = 0, active = false;
  let failure: unknown, failAt = "", returnCount = 1, returnId: string | undefined;
  let selectGate: ReturnType<typeof gate> | undefined, reached: ReturnType<typeof gate> | undefined;
  let tail = Promise.resolve();
  let transactionSnapshot: Row[] = [];
  const session = { workspaceId: "workspace", sub: "actor", role: "member" };
  let authFailure: unknown;
  const predicates: Array<{ kind: string; condition: Condition }> = [];
  const payloads: Row[] = [];
  const calls: string[] = [];
  const callbacks: unknown[] = [];
  const table = new Proxy({}, { get: (_t, key) => ({ key }) });
  class Clock extends Date { constructor(value?: any) { super(value === undefined ? clock : value); if (value === undefined) { calls.push("clock"); clock += tick; } } static now() { return clock; } static [Symbol.hasInstance](value: unknown) { return value instanceof Date; } }
  function ops(inside: boolean) {
    return {
      select(projection?: Row) {
        let condition: Condition = () => true, locked = false;
        const builder = {
          from(value: unknown) { assert.equal(value, table); return builder; },
          where(value: Condition) { condition = value; predicates.push({ kind: "select", condition }); return builder; },
          for(mode: string) { assert.equal(mode, "update"); assert.ok(inside); locked = true; return builder; },
          then(resolve: any, reject: any) { return (async () => {
            reads++; calls.push(inside ? "tx:select" : "db:select");
            if (failAt === "select") throw failure;
            const take = () => rows.filter(condition).map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, row[column.key]])) : structuredClone(row));
            // Legacy reads hold a stale before-image; the locked path rereads only
            // when acquisition succeeds. This is controlled, not PostgreSQL proof.
            const stale = locked ? undefined : take();
            const hold = selectGate; selectGate = undefined;
            if (hold) { reached!.release(); await hold.promise; }
            if (locked) { calls.push("row:acquired"); transactionSnapshot = structuredClone(rows); }
            return stale ?? take();
          })().then(resolve, reject); },
        };
        return builder;
      },
      update(value: unknown) {
        assert.equal(value, table);
        return { set(payload: Row) { return { where(condition: Condition) {
          predicates.push({ kind: "update", condition });
          let pending: Promise<Row[]> | undefined;
          const run = () => pending ??= (async () => {
            if (failAt === "update") throw failure;
            updates++; calls.push(inside ? "tx:update" : "db:update"); payloads.push(payload);
            const found = rows.filter(condition);
            for (const row of found) Object.assign(row, payload);
            return Array.from({ length: returnCount }, () => ({ id: returnId ?? found[0]?.id }));
          })();
          return { returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
        } }; } };
      },
    };
  }
  const db = { ...ops(false), async transaction(body: any, config: unknown) {
    transactions++; assert.deepEqual(config, { isolationLevel: "read committed" });
    const previous = tail, done = gate(); tail = done.promise; await previous;
    transactionSnapshot = structuredClone(rows); active = true; calls.push("begin");
    try { const result = await body(ops(true)); if (failAt === "commit") throw failure; calls.push("commit"); return result; }
    catch (error) { rows = transactionSnapshot; calls.push("rollback"); throw error; }
    finally { active = false; done.release(); }
  } };
  const modules: Record<string, any> = {
    "@/lib/db": { db }, "@/lib/db/schema": { timeEntries: table },
    "@/lib/auth": { UnauthorizedError, ForbiddenError, requireSession: async () => { if (authFailure) throw authFailure; return session; }, requireRole: () => { if (session.role === "client") throw new ForbiddenError("private role details"); } },
    "next/server": { NextResponse: { json: Response.json }, after: (callback: unknown) => callbacks.push(callback) },
    "drizzle-orm": {
      eq: (column: { key: string }, value: unknown): Condition => row => row[column.key] === value,
      isNull: (column: { key: string }): Condition => row => row[column.key] === null,
      and: (...conditions: Condition[]): Condition => row => conditions.every(condition => condition(row)),
    },
  };
  function load(file: string): any {
    const selected = baseline && file.startsWith("app/") ? `.superpowers/sdd/continuation-plan-2026-10-31/task-5c-snapshot/before/${file}.snapshot` : file;
    const compiled = ts.transpileModule(readFileSync(selected, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", "Date", compiled)((name: string) => {
      if (name in modules) return modules[name];
      if (name === "@/lib/timer-transition") return modules[name] = load("lib/timer-transition.ts");
      throw new Error(`Unexpected dependency ${name}`);
    }, mod, mod.exports, Clock);
    return mod.exports;
  }
  return {
    get row() { return rows[0]; }, get reads() { return reads; }, get updates() { return updates; }, get transactions() { return transactions; },
    calls, callbacks, payloads, predicates, session,
    clock(value: number, increment = 0) { clock = value; tick = increment; },
    auth(error: unknown) { authFailure = error; }, fail(stage: string, error: unknown = new Error("private SQL token=secret")) { failAt = stage; failure = error; },
    returning(count: number) { returnCount = count; },
    returnId(value?: string) { returnId = value; },
    hold() { selectGate = gate(); reached = gate(); const current = selectGate; return { reached: reached.promise, release: current.release }; },
    helper(input: Row) { return load("lib/timer-transition.ts").transitionTimer(input); },
    request(action: "pause" | "resume", body: unknown = { entryId: "timer" }, raw = false) {
      const handler = load(`app/api/timer/${action}/route.ts`).POST;
      return handler(new Request(`https://example.test/api/timer/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? body as string : JSON.stringify(body) })) as Promise<Response>;
    },
    assertNoExternalEffects() { assert.deepEqual(callbacks, []); assert.equal(active, false); },
  };
}

test("duplicate actual pause routes serialize to one timestamp and one no-op", async () => {
  const f = fixture(); f.clock(instant, 1000);
  const responses = await Promise.all([f.request("pause"), f.request("pause")]);
  assert.equal(f.row.pausedAt.getTime(), instant, "A duplicate pause must not replace the winning pause timestamp");
  assert.deepEqual(await Promise.all(responses.map(r => r.json())), [{ ok: true }, { ok: true, message: "Timer is already paused" }]);
  assert.equal(f.updates, 1); assert.equal(f.row.pausedAt.getTime(), instant);
});

test("waiting resume accounts the current newer pause instead of overwriting its accumulated state", async () => {
  const f = fixture({ isPaused: true, pausedAt: new Date(instant - 10000), accumulatedSeconds: 2 });
  const hold = f.hold(); const pending = f.request("resume"); await hold.reached;
  // A preceding resume and fresh pause committed while the row was unavailable.
  Object.assign(f.row, { isPaused: true, pausedAt: new Date(instant - 1000), accumulatedSeconds: 12 });
  hold.release(); assert.equal((await pending).status, 200);
  assert.equal(f.row.accumulatedSeconds, 13); assert.equal(f.row.isPaused, false);
});

for (const action of ["pause", "resume"] as const) test(`late ${action} does not mutate a timer stopped before row acquisition`, async () => {
  const f = fixture(action === "resume" ? { isPaused: true, pausedAt: new Date(instant - 1000) } : {});
  const hold = f.hold(); const pending = f.request(action); await hold.reached;
  Object.assign(f.row, { stoppedAt: new Date(instant), isPaused: false, pausedAt: null, durationSeconds: 30 });
  const stopped = structuredClone(f.row); hold.release();
  const response = await pending; assert.deepEqual(f.row, stopped); assert.equal(response.status, 404); assert.equal(f.updates, 0);
});

test("duplicate resumes add the active interval once and return the exact running no-op", async () => {
  const f = fixture({ isPaused: true, pausedAt: new Date(instant - 3000), accumulatedSeconds: 2 });
  const responses = await Promise.all([f.request("resume"), f.request("resume")]);
  assert.deepEqual(await Promise.all(responses.map(r => r.json())), [{ ok: true }, { ok: true, message: "Timer is already running" }]);
  assert.equal(f.row.accumulatedSeconds, 5); assert.equal(f.updates, 1);
});

for (const action of ["pause", "resume"] as const) test(`${action} captures the clock only after the awaited row lock`, async () => {
  const f = fixture(action === "resume" ? { isPaused: true, pausedAt: new Date(instant - 1000) } : {});
  const hold = f.hold(); const pending = f.request(action); await hold.reached;
  assert.ok(!f.calls.includes("clock")); f.clock(instant + 2000); hold.release();
  assert.equal((await pending).status, 200);
  if (action === "pause") assert.equal(f.row.pausedAt.getTime(), instant + 2000);
  else assert.equal(f.row.accumulatedSeconds, 3);
  assert.deepEqual(f.calls, ["begin", "tx:select", "row:acquired", "clock", "tx:update", "commit"]);
  assert.equal(f.transactions, 1); f.assertNoExternalEffects();
});

for (const action of ["pause", "resume"] as const) test(`${action} enforces exact JSON/ID boundaries before any database query`, async () => {
  for (const body of [null, [], "text", 1, {}, { entryId: 4 }, { entryId: "" }, { entryId: " \t" }, { entryId: "x".repeat(256) }, { entryId: "bad\0id" }]) {
    const f = fixture(); const response = await f.request(action, body);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "entryId must be a non-empty string of at most 255 characters." }); assert.equal(f.reads, 0);
  }
  const f = fixture(); const malformed = await f.request(action, "{", true);
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: "Send a valid JSON request." }); assert.equal(f.reads, 0);
  assert.equal((await f.request(action, { entryId: " timer " })).status, 404);
  const max = fixture({ id: "x".repeat(255) }); assert.equal((await max.request(action, { entryId: "x".repeat(255), userId: "evil", workspaceId: "evil", action: "evil", timestamp: "evil" })).status, 200);
});

for (const action of ["pause", "resume"] as const) test(`${action} maps only concrete auth errors and never leaks arbitrary status/SyntaxError/SQL details`, async () => {
  for (const [error, status, message] of [
    [new UnauthorizedError("secret"), 401, "Please sign in again."], [new ForbiddenError("secret"), 403, "Your workspace role cannot perform this action."],
    [Object.assign(new Error("password=secret"), { status: 403 }), 500, `Could not ${action} this timer. Please try again.`],
    [new SyntaxError("SQL secret"), 500, `Could not ${action} this timer. Please try again.`],
  ] as const) {
    const f = fixture(); f.auth(error); const response = await f.request(action); assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: message }); assert.equal(f.reads, 0);
  }
  const client = fixture(); client.session.role = "client"; assert.equal((await client.request(action)).status, 403); assert.equal(client.reads, 0);
  for (const error of [new SyntaxError("SQL token=secret"), Object.assign(new Error("private SQL"), { statusCode: 401 }), { status: 403, message: "secret" }]) {
    const f = fixture(); f.fail("select", error); const response = await f.request(action); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: `Could not ${action} this timer. Please try again.` });
  }
});

for (const action of ["pause", "resume"] as const) test(`${action} scopes SELECT and UPDATE by exact ID, workspace and recorded user`, async () => {
  const f = fixture(action === "resume" ? { isPaused: true, pausedAt: new Date(instant) } : {}); assert.equal((await f.request(action)).status, 200);
  for (const { kind, condition } of f.predicates) {
    assert.equal(condition({ ...f.row, isPaused: action === "resume", stoppedAt: null }), true);
    for (const extra of [{ id: "other" }, { workspaceId: "other" }, { userId: "other" }]) assert.equal(condition({ ...f.row, isPaused: action === "resume", stoppedAt: null, ...extra }), false);
    if (kind === "update") { assert.equal(condition({ ...f.row, stoppedAt: new Date() }), false); assert.equal(condition({ ...f.row, stoppedAt: null }), false); }
  }
  for (const role of ["member", "manager", "owner"]) for (const override of [{ id: "missing" }, { workspaceId: "foreign" }, { userId: "another-owner" }, { stoppedAt: new Date(instant) }]) {
    const foreign = fixture(override); foreign.session.role = role;
    const response = await foreign.request(action); assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "No active timer found for entry" }); assert.equal(foreign.updates, 0);
  }
});

for (const action of ["pause", "resume"] as const) test(`${action} rejects malformed saved active state even on a repeated pause`, async () => {
  for (const extra of [{ isPaused: "yes" }, { accumulatedSeconds: -1 }, { accumulatedSeconds: NaN }, { accumulatedSeconds: Infinity }, { accumulatedSeconds: 1e39 }, { accumulatedSeconds: 1e-100 }, { isPaused: true, pausedAt: null }, { isPaused: true, pausedAt: new Date(NaN) }, { isPaused: true, pausedAt: "date" }]) {
    const f = fixture(extra), before = structuredClone(f.row); const response = await f.request(action);
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "The pause time for this timer is invalid. Contact support for help." }); assert.deepEqual(comparable(f.row), comparable(before)); assert.equal(f.updates, 0);
  }
});

test("valid no-ops leave stale inactive pause timestamps, fractional values and negative zero untouched", async () => {
  for (const extra of [{ isPaused: false, pausedAt: "invalid stale date", accumulatedSeconds: -0 }, { isPaused: true, pausedAt: new Date(instant), accumulatedSeconds: 0.2 }]) {
    const f = fixture(extra), before = structuredClone(f.row); const action = extra.isPaused ? "pause" : "resume";
    const response = await f.request(action); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, message: extra.isPaused ? "Timer is already paused" : "Timer is already running" });
    assert.deepEqual(f.row, before); assert.equal(f.updates, 0); assert.ok(!f.calls.includes("clock")); f.assertNoExternalEffects();
  }
  const f = fixture({ pausedAt: "invalid stale date" }); assert.equal((await f.request("pause")).status, 200); assert.equal(f.row.pausedAt.getTime(), instant);
});

test("resume preserves whole-second elapsed and existing float4 rounding without a fake daily cap", async () => {
  for (const [aggregate, elapsedMs, expected] of [[0.2, 1000, 1.2000000476837158], [0.20000000298023224, 1000, 1.2000000476837158], [0.25, 1000, 1.25], [0.25, 999, 0.25], [0.25, -1000, 0.25], [-0, 0, 0], [90000, 1000, 90001], [16777216, 1000, 16777216], [3.4028234663852886e38, 1000, 3.4028234663852886e38]]) {
    const f = fixture({ isPaused: true, pausedAt: new Date(instant - elapsedMs), accumulatedSeconds: aggregate });
    assert.equal((await f.request("resume")).status, 200); assert.deepEqual(f.payloads[0], { isPaused: false, pausedAt: null, accumulatedSeconds: expected });
  }
  const f = fixture({ isPaused: true, pausedAt: new Date(-8640000000000000) }); f.clock(8640000000000000);
  assert.equal((await f.request("resume")).status, 409); assert.equal(f.updates, 0);
});

test("repeated pause cycles preserve totals and invalid internal clocks fail safely", async () => {
  const f = fixture({ accumulatedSeconds: 0.25 });
  for (const elapsed of [2000, 3000]) { assert.equal((await f.request("pause")).status, 200); f.clock(f.row.pausedAt.getTime() + elapsed); assert.equal((await f.request("resume")).status, 200); }
  assert.equal(f.row.accumulatedSeconds, 5.25);
  for (const action of ["pause", "resume"] as const) { const bad = fixture(action === "resume" ? { isPaused: true, pausedAt: new Date(instant) } : {}); bad.clock(NaN); const response = await bad.request(action); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: `Could not ${action} this timer. Please try again.` }); assert.equal(bad.updates, 0); }
});

for (const action of ["pause", "resume"] as const) test(`${action} rolls back update/commit and mismatched returning failures without callbacks; retry works once`, async () => {
  for (const stage of ["update", "commit", "zero", "multiple", "wrong-id"]) {
    const f = fixture(action === "resume" ? { isPaused: true, pausedAt: new Date(instant - 1000) } : {}), before = structuredClone(f.row);
    if (stage === "zero" || stage === "multiple") f.returning(stage === "zero" ? 0 : 2); else if (stage === "wrong-id") f.returnId("another-id"); else f.fail(stage);
    const response = await f.request(action); assert.equal(response.status, stage === "zero" || stage === "multiple" || stage === "wrong-id" ? 409 : 500);
    assert.deepEqual(await response.json(), { error: stage === "zero" || stage === "multiple" || stage === "wrong-id" ? "This timer changed. Refresh it and try again." : `Could not ${action} this timer. Please try again.` });
    assert.deepEqual(f.row, before); f.assertNoExternalEffects(); f.fail(""); f.returning(1); f.returnId();
    assert.equal((await f.request(action)).status, 200); const saved = structuredClone(f.row); assert.equal((await f.request(action)).status, 200); assert.deepEqual(structuredClone(f.row), saved);
  }
});

test("direct helper callers must provide validated identity and supported action", { skip: baseline }, async () => {
  for (const extra of [{ userId: "" }, { workspaceId: " " }, { entryId: "bad\0id" }, { action: "stop" }]) {
    const f = fixture(); await assert.rejects(f.helper({ workspaceId: "workspace", userId: "actor", entryId: "timer", action: "pause", ...extra })); assert.equal(f.transactions, 0);
  }
});

const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Real route, duration-limit and audit code; fake connection and request context.
// These tests exercise rollback/fault paths without a provider or database call.
type Row = Record<string, unknown>;
type TableName = "scheduledWorkBlocks" | "timeEntries" | "auditLogs" | "lockPeriods" | "webhooks";
type Column = { key: string };
type Table = { name: TableName } & Record<string, Column>;
type Condition = (row: Row) => boolean;
const root = process.cwd();
const requireNative = createRequire(path.join(root, "package.json"));
const session = { sub: "person-a", workspaceId: "workspace-a", role: "member" };
const schema = Object.fromEntries(["scheduledWorkBlocks", "timeEntries", "auditLogs", "lockPeriods", "webhooks"].map((name) => [name, new Proxy({ name }, {
  get(target, key: string) { return key === "name" ? target.name : { key }; },
})])) as Record<TableName, Table>;
const at = (value: string) => new Date(`2026-01-${value}:00.000Z`);

function fixture(overrides: Row = {}) {
  let rows: Record<TableName, Row[]> = {
    scheduledWorkBlocks: [{ id: "block-a", workspaceId: session.workspaceId, userId: session.sub, linkedTimeEntryId: "timer-a", status: "in_progress" }],
    timeEntries: [{
      id: "timer-a", workspaceId: session.workspaceId, userId: session.sub, scheduledBlockId: "block-a",
      taskId: "Client delivery", projectId: "client-project", goalId: "client-goal", action: "Review", hourlyRate: 0,
      tags: ["client"], collaborators: [], expenses: [], description: "Review the delivery", status: "draft", source: "web",
      startedAt: at("12T23:30"), stoppedAt: null, durationSeconds: null, accumulatedSeconds: 0, isPaused: false, pausedAt: null,
      ...overrides,
    }], auditLogs: [], lockPeriods: [], webhooks: [],
  };
  let tail = Promise.resolve();
  let transactionActive = false;
  let committedTransactions = 0;
  let outsideTransactionAccesses = 0;
  let lockedEntryReads = 0;
  let failContinuationAt = 0;
  let continuationInserts = 0;
  let failAudit = false;
  const afterCallbacks: Array<() => Promise<unknown>> = [];
  const access = (inside: boolean) => { if (transactionActive && !inside) outsideTransactionAccesses++; };

  function operations(inside: boolean) {
    return {
      async execute() { access(inside); },
      select(projection?: Record<string, Column>) {
        access(inside);
        let table: Table;
        let condition: Condition = () => true;
        const builder = {
          from(value: Table) { table = value; return builder; },
          where(value: Condition) { condition = value; return builder; },
          for(value: string) {
            assert.equal(value, "update");
            if (table.name === "timeEntries") lockedEntryReads++;
            return builder;
          },
          then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve().then(() => {
              const selected = rows[table.name].filter(condition);
              return selected.map((row) => projection ? Object.fromEntries(Object.entries(projection).map(([key, value]) => [key, row[value.key]])) : structuredClone(row));
            }).then(resolve, reject);
          },
        };
        return builder;
      },
      insert(table: Table) {
        access(inside);
        return { values(value: Row) {
          let execution: Promise<Row[]> | undefined;
          const execute = () => execution ??= Promise.resolve().then(() => {
            if (table.name === "timeEntries" && ++continuationInserts === failContinuationAt) throw new Error("Injected continuation insert failure");
            if (table.name === "auditLogs" && failAudit) throw new Error("Injected audit insert failure");
            rows[table.name].push(structuredClone(value));
            return [structuredClone(value)];
          });
          return {
            returning: execute,
            then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); },
          };
        } };
      },
      update(table: Table) {
        access(inside);
        return { set(values: Row) {
          return { async where(condition: Condition) {
            for (const row of rows[table.name].filter(condition)) Object.assign(row, structuredClone(values));
          } };
        } };
      },
    };
  }
  const db = {
    ...operations(false),
    async transaction<T>(callback: (tx: ReturnType<typeof operations>) => Promise<T>, config: unknown) {
      assert.deepEqual(config, { isolationLevel: "read committed" });
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = structuredClone(rows);
      transactionActive = true;
      try {
        const result = await callback(operations(true));
        committedTransactions++;
        return result;
      }
      catch (error) { rows = snapshot; throw error; }
      finally { transactionActive = false; release(); }
    },
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json }, after: (callback: () => Promise<unknown>) => { assert.ok(committedTransactions > 0, "Outgoing callbacks must be registered after commit"); afterCallbacks.push(callback); } },
    "@/lib/db": { db }, "./db": { db },
    "@/lib/db/schema": schema, "./db/schema": schema,
    "@/lib/auth": { ...authErrors, requireSession: async () => session, requireRole: () => {} },
    "./auth": authErrors,
    "./env": { env: { NODE_ENV: "test", AUDIT_SIGNING_SECRET: "not-a-credential-isolated-audit-test" } },
    "drizzle-orm": {
      eq: (column: Column, value: unknown): Condition => (row) => row[column.key] === value,
      ne: (column: Column, value: unknown): Condition => (row) => row[column.key] !== value,
      gte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) >= value,
      lt: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) < value,
      isNotNull: (column: Column): Condition => (row) => row[column.key] != null,
      isNull: (column: Column): Condition => (row) => row[column.key] == null,
      and: (...conditions: Condition[]): Condition => (row) => conditions.every((condition) => condition(row)),
      or: (...conditions: Condition[]): Condition => (row) => conditions.some((condition) => condition(row)),
      sql: (_template: TemplateStringsArray, column: Column): Column => ({ key: column?.key }),
    },
  };
  const helpers = new Set(["@/lib/security", "@/lib/workflow-validation", "@/lib/timer-stop", "@/lib/date-input", "@/lib/time-capacity"]);
  function load(filename: string): unknown {
    const code = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      if (specifier === "node:crypto" || specifier === "node:net") return requireNative(specifier);
      if (specifier === "node:https" || specifier === "node:dns/promises") return new Proxy({}, { get() { return () => { throw new Error("Network access forbidden in this fixture"); }; } });
      assert.ok(helpers.has(specifier), `Unexpected real dependency: ${specifier}`);
      modules[specifier] = load(`${specifier.slice(2)}.ts`);
      return modules[specifier];
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const handler = (load("app/api/timer/stop/route.ts") as { POST: (request: Request) => Promise<Response> }).POST;
  return {
    get rows() { return rows; },
    get lockedEntryReads() { return lockedEntryReads; },
    get outsideTransactionAccesses() { return outsideTransactionAccesses; },
    get callbacks() { return afterCallbacks; },
    failContinuation(number: number) { failContinuationAt = number; continuationInserts = 0; },
    failAudit() { failAudit = true; },
    stop(endedAt = at("13T00:30").toISOString()) {
      return handler(new Request("https://sowledger.example/api/timer/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryId: "timer-a", endedAt }) }));
    },
  };
}

test("concurrent stop requests create one midnight continuation and one audit trail", async () => {
  const f = fixture();
  const responses = await Promise.all([f.stop(), f.stop()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 404]);
  assert.equal(f.rows.timeEntries.length, 2);
  assert.equal(f.rows.timeEntries.reduce((sum, row) => sum + Number(row.durationSeconds), 0), 3600);
  assert.equal(f.rows.auditLogs.length, 2);
  assert.equal(f.rows.scheduledWorkBlocks[0].linkedTimeEntryId, "timer-a");
  assert.equal(f.rows.scheduledWorkBlocks[0].status, "completed");
  assert.equal(f.lockedEntryReads, 2);
  assert.equal(f.outsideTransactionAccesses, 0);
  for (const row of f.rows.timeEntries) {
    assert.equal(row.workspaceId, session.workspaceId);
    assert.equal(row.userId, session.sub);
    assert.equal(row.projectId, "client-project");
    assert.equal(row.goalId, "client-goal");
    assert.equal(row.action, "Review");
    assert.equal(row.hourlyRate, 0);
  }
  assert.equal(f.rows.timeEntries[1].scheduledBlockId, null);
});

test("failure after an inserted continuation restores the original timer and calendar, then retry saves once", async () => {
  const f = fixture();
  const before = structuredClone(f.rows);
  f.failContinuation(2);
  const response = await f.stop(at("14T00:30").toISOString());
  assert.ok(!response.ok);
  assert.deepEqual(f.rows, before);
  assert.equal(f.callbacks.length, 0);
  f.failContinuation(0);
  const retried = await f.stop(at("14T00:30").toISOString());
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).durationSeconds, 90000);
  assert.equal(f.rows.timeEntries.length, 3);
  assert.equal(f.rows.auditLogs.length, 3);
});

test("audit failure rolls back every entry and the completed calendar state, with no outgoing callback", async () => {
  const f = fixture();
  const before = structuredClone(f.rows);
  f.failAudit();
  assert.ok(!(await f.stop()).ok);
  assert.deepEqual(f.rows, before);
  assert.equal(f.callbacks.length, 0);
});

test("same-day and paused stops preserve net time and retain only the original calendar link", async () => {
  for (const paused of [false, true]) {
    const f = fixture({ startedAt: at("12T09:00"), accumulatedSeconds: paused ? 300 : 0, isPaused: paused, pausedAt: paused ? at("12T10:30") : null });
    const response = await f.stop(at("12T11:00").toISOString());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).durationSeconds, paused ? 5100 : 7200);
    assert.equal(f.rows.timeEntries.length, 1);
    assert.equal(f.rows.timeEntries[0].scheduledBlockId, "block-a");
    assert.equal(f.rows.scheduledWorkBlocks[0].status, "completed");
    assert.equal(f.rows.auditLogs.length, 1);
  }
});

test("cross-midnight paused stop preserves the existing total-duration calculation", async () => {
  const f = fixture({ accumulatedSeconds: 300, isPaused: true, pausedAt: at("13T00:20") });
  const response = await f.stop();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).durationSeconds, 2700);
  assert.deepEqual(f.rows.timeEntries.map((entry) => entry.durationSeconds), [1800, 900]);
});

test("fully used daily capacity stops at zero without generating continuation entries", async () => {
  const f = fixture({ startedAt: at("12T09:00") });
  f.rows.timeEntries.push({ id: "existing-hours", workspaceId: session.workspaceId, userId: session.sub, startedAt: at("12T00:00"), durationSeconds: 86400 });
  const response = await f.stop(at("12T10:00").toISOString());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).durationSeconds, 0);
  assert.equal(f.rows.timeEntries.length, 2);
  assert.equal(f.rows.timeEntries[0].durationSeconds, 0);
  assert.equal(f.rows.scheduledWorkBlocks[0].status, "completed");
});

test("locked periods, invalid dates and foreign ownership cannot mutate a timer", async () => {
  for (const overrides of [{ workspaceId: "other-workspace" }, { userId: "other-person" }]) {
    const f = fixture(overrides);
    const before = structuredClone(f.rows);
    assert.equal((await f.stop()).status, 404);
    assert.deepEqual(f.rows, before);
  }
  for (const endedAt of ["invalid", at("12T23:29").toISOString(), new Date(Date.now() + 60_000).toISOString()]) {
    const f = fixture();
    const before = structuredClone(f.rows);
    assert.equal((await f.stop(endedAt)).status, 400);
    assert.deepEqual(f.rows, before);
  }
  const f = fixture();
  f.rows.lockPeriods.push({ workspaceId: session.workspaceId, periodStart: at("12T00:00"), periodEnd: at("14T00:00"), reason: "Closed period" });
  const before = structuredClone(f.rows);
  assert.equal((await f.stop()).status, 403);
  assert.deepEqual(f.rows, before);
});

test("fractional midnight allocations keep the first positive fragment on the original timer ID", async () => {
  for (const scenario of [
    { start: "2026-01-12T23:59:59.500Z", end: "2026-01-13T00:00:00.500Z", durations: [1], savedStart: "2026-01-13T00:00:00.000Z" },
    { start: "2026-01-12T23:59:58.100Z", end: "2026-01-13T00:00:01.900Z", durations: [1, 2], savedStart: "2026-01-12T23:59:58.100Z" },
    { start: "2026-01-12T09:00:00.100Z", end: "2026-01-12T09:00:00.600Z", durations: [1], savedStart: "2026-01-12T09:00:00.100Z" },
    { start: "2026-01-12T23:59:56.900Z", end: "2026-01-13T00:00:00.100Z", durations: [3], savedStart: "2026-01-12T23:59:56.900Z" },
  ]) {
    const f = fixture({ startedAt: new Date(scenario.start) });
    const response = await f.stop(scenario.end);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.durationSeconds, scenario.durations.reduce((sum, duration) => sum + duration, 0));
    assert.deepEqual(f.rows.timeEntries.map((entry) => entry.durationSeconds), scenario.durations);
    assert.equal(f.rows.timeEntries[0].id, "timer-a");
    assert.equal(f.rows.timeEntries[0].scheduledBlockId, "block-a");
    assert.equal((f.rows.timeEntries[0].startedAt as Date).toISOString(), scenario.savedStart);
    const diff = f.rows.auditLogs[0].diff as Record<string, { before: unknown; after: unknown }>;
    assert.equal((diff.startedAt.before as Date).toISOString(), scenario.start);
    assert.equal(diff.startedAt.after, scenario.savedStart);
    assert.equal(diff.requestedStoppedAt.after, scenario.end);
    assert.equal(f.rows.scheduledWorkBlocks[0].linkedTimeEntryId, "timer-a");
    for (const row of f.rows.timeEntries) assert.equal(row.hourlyRate, 0);
  }
});

test("equal endpoints and fully paused windows close truthfully without a capacity adjustment", async () => {
  for (const scenario of [
    { start: "2026-01-12T09:00:00.000Z", end: "2026-01-12T09:00:00.000Z", pause: 0, excluded: 0 },
    { start: "2026-01-12T23:59:59.500Z", end: "2026-01-13T00:00:00.500Z", pause: 1, excluded: 1 },
    { start: "2026-01-12T23:30:00.000Z", end: "2026-01-14T00:30:00.000Z", pause: 90001, excluded: 90000 },
  ]) {
    const f = fixture({ startedAt: new Date(scenario.start), accumulatedSeconds: scenario.pause });
    // Capacity must not turn a zero-net stop into a daily-limit stop.
    f.rows.timeEntries.push({ id: "full-day", workspaceId: session.workspaceId, userId: session.sub, startedAt: new Date(scenario.start), durationSeconds: 86400 });
    const response = await f.stop(scenario.end);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true, entryId: "timer-a", entryIds: ["timer-a"], durationSeconds: 0,
      splitAcrossDays: false, adjustedForDailyLimit: false, trimmedSeconds: 0,
      message: "Timer stopped. No additional time was recorded.",
    });
    assert.equal(f.rows.timeEntries.length, 2);
    assert.equal((f.rows.timeEntries[0].startedAt as Date).toISOString(), scenario.start);
    assert.equal((f.rows.timeEntries[0].stoppedAt as Date).toISOString(), scenario.end);
    assert.equal(f.rows.timeEntries[0].durationSeconds, 0);
    assert.equal(f.rows.scheduledWorkBlocks[0].status, "completed");
    assert.equal(f.rows.auditLogs.length, 1);
    assert.equal(f.rows.auditLogs[0].eventType, "timer_stopped_no_recorded_time");
    const diff = f.rows.auditLogs[0].diff as Record<string, { after: unknown }>;
    assert.equal(diff.requestedStoppedAt.after, scenario.end);
    assert.equal(diff.totalPausedSeconds.after, scenario.pause);
    assert.equal(diff.excludedPauseSeconds.after, scenario.excluded);
    assert.equal(f.outsideTransactionAccesses, 0);
    assert.equal(f.callbacks.length, 1);
  }
});

test("invalid stored pause data safely rejects without writes or callbacks", async () => {
  for (const overrides of [
    { accumulatedSeconds: -1 }, { accumulatedSeconds: NaN }, { accumulatedSeconds: Infinity },
    { accumulatedSeconds: -Infinity }, { isPaused: true, pausedAt: new Date(NaN) }, { isPaused: true, pausedAt: null },
  ]) {
    const f = fixture(overrides);
    const before = structuredClone(f.rows);
    const response = await f.stop();
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "The pause time for this timer is invalid. Contact support for help." });
    // Node's deepStrictEqual treats distinct invalid Date objects as unequal.
    // Compare the complete serialized state as well as the invalid date itself.
    assert.equal(JSON.stringify(f.rows), JSON.stringify(before));
    if (overrides.pausedAt instanceof Date) assert.ok(Number.isNaN((f.rows.timeEntries[0].pausedAt as Date).getTime()));
    assert.equal(f.callbacks.length, 0);
  }
});

test("positive net capacity rejection remains distinct from zero-net and partial trimming", async () => {
  for (const used of [86400, 86300]) {
    const f = fixture({ startedAt: at("12T09:00") });
    f.rows.timeEntries.push({ id: "existing-hours", workspaceId: session.workspaceId, userId: session.sub, startedAt: at("12T00:00"), durationSeconds: used });
    const response = await f.stop(at("12T10:00").toISOString());
    const result = await response.json();
    assert.equal(result.adjustedForDailyLimit, true);
    assert.equal(result.durationSeconds, used === 86400 ? 0 : 100);
    assert.equal(result.trimmedSeconds, used === 86400 ? 3600 : 3500);
    assert.equal(f.rows.auditLogs[0].eventType, used === 86400 ? "timer_stopped_no_daily_capacity" : "timer_stopped_adjusted_daily_limit");
    assert.equal((f.rows.timeEntries[0].stoppedAt as Date).toISOString(), used === 86400 ? at("12T09:00").toISOString() : "2026-01-12T09:01:40.000Z");
  }
});

test("a zero-net audit failure rolls back the requested endpoint and schedule completion", async () => {
  const f = fixture({ accumulatedSeconds: 3600 });
  const before = structuredClone(f.rows);
  f.failAudit();
  assert.ok(!(await f.stop()).ok);
  assert.deepEqual(f.rows, before);
  assert.equal(f.callbacks.length, 0);
});

test("active aggregate pauses deduct after allocation and a later pausedAt preserves backdated-stop semantics", async () => {
  const startedAt = new Date("2026-01-12T23:59:59.500Z");
  const endedAt = "2026-01-13T00:00:00.500Z";
  const fullyPaused = fixture({ startedAt, isPaused: true, pausedAt: startedAt });
  assert.equal((await (await fullyPaused.stop(endedAt)).json()).durationSeconds, 0);
  assert.equal(fullyPaused.rows.auditLogs[0].eventType, "timer_stopped_no_recorded_time");
  const backdated = fixture({ startedAt, isPaused: true, pausedAt: new Date("2026-01-13T00:01:00.500Z") });
  assert.equal((await (await backdated.stop(endedAt)).json()).durationSeconds, 1);
  assert.equal(backdated.rows.timeEntries.length, 1);
});

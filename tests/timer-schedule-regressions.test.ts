const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Execute the real route/helper code, with an in-memory database and no loaded
// environment, real authentication, notifications, or database connections.
// Transaction serialization models the block row lock, not PostgreSQL itself;
// the isolated integration suite separately exercises the real database lock.
type Row = Record<string, unknown>;
type TableName = "projects" | "goals" | "userActions" | "scheduledWorkBlocks" | "timeEntries" | "integrationSyncRecords";
type Column = { key: string };
type Table = { name: TableName } & Record<string, Column>;
type Condition = (row: Row) => boolean;
type Handler = (request: Request) => Promise<Response>;
const root = process.cwd();
const session = { sub: "person-a", workspaceId: "workspace-a", role: "member" };
const schema = Object.fromEntries(["projects", "goals", "userActions", "scheduledWorkBlocks", "timeEntries", "integrationSyncRecords"].map((name) => [name, new Proxy({ name }, {
  get(target, key: string) { return key === "name" ? target.name : { key }; },
})])) as Record<TableName, Table>;

function fixture() {
  let rows: Record<TableName, Row[]> = { projects: [], goals: [], userActions: [], scheduledWorkBlocks: [], timeEntries: [], integrationSyncRecords: [] };
  let transactionTail = Promise.resolve();
  let lockedBlockReads = 0;
  let failBlockUpdate = false;
  let notifications = 0;

  const query = (projection?: Record<string, Column>) => {
    let table: Table;
    let condition: Condition = () => true;
    let limit = Infinity;
    const builder = {
      from(value: Table) { table = value; return builder; },
      where(value: Condition) { condition = value; return builder; },
      for(value: string) {
        assert.equal(value, "update");
        if (table.name === "scheduledWorkBlocks") lockedBlockReads++;
        return builder;
      },
      limit(value: number) { limit = value; return builder; },
      then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => rows[table.name].filter(condition).slice(0, limit).map((row) => (
          projection ? Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, row[column.key]])) : structuredClone(row)
        ))).then(resolve, reject);
      },
    };
    return builder;
  };

  const operations = {
    execute: async () => {},
    select: query,
    insert(table: Table) {
      return { values(value: Row) {
        return { async returning() {
          const row = structuredClone(value);
          rows[table.name].push(row);
          return [structuredClone(row)];
        } };
      } };
    },
    update(table: Table) {
      return { set(values: Row) {
        return { async where(condition: Condition) {
          if (failBlockUpdate && table.name === "scheduledWorkBlocks") throw new Error("Simulated schedule write failure");
          for (const row of rows[table.name].filter(condition)) Object.assign(row, structuredClone(values));
        } };
      } };
    },
  };
  const db = {
    ...operations,
    async transaction<T>(callback: (tx: typeof operations) => Promise<T>, config?: unknown) {
      if (config !== undefined) assert.deepEqual(config, { isolationLevel: "read committed" });
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(rows);
      try { return await callback(operations); }
      catch (error) { rows = before; throw error; }
      finally { release(); }
    },
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json }, after: () => { notifications++; } },
    "@/lib/db": { db },
    "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => {} },
    "@/lib/auth": { ...authErrors, requireSession: async () => session, requireRole: () => {} },
    "@/lib/security": { ensurePeriodUnlocked: async () => {}, PeriodLockedError: class extends Error {} },
    "node:crypto": { createHash },
    "@/lib/app-url": { getAppOrigin: () => "https://sowledger.example" },
    "@/lib/integrations/notifications": { dispatchIntegrationNotification: async () => {} },
    "drizzle-orm": {
      eq: (column: Column, expected: unknown): Condition => (row) => row[column.key] === expected,
      isNull: (column: Column): Condition => (row) => row[column.key] == null,
      and: (...conditions: Condition[]): Condition => (row) => conditions.every((condition) => condition(row)),
      or: (...conditions: Condition[]): Condition => (row) => conditions.some((condition) => condition(row)),
      gte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) >= value,
      lt: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) < value,
      sql: (_parts: TemplateStringsArray, column: Column) => ({ key: column?.key }),
    },
  };
  const allowedHelpers = new Set(["@/lib/validators", "@/lib/scheduled-block-guards", "@/lib/scheduled-block-entry", "@/lib/workflow-validation", "@/lib/date-input", "@/lib/time-capacity"]);
  function load(filename: string): unknown {
    const code = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      assert.ok(allowedHelpers.has(specifier), `Unexpected real dependency: ${specifier}`);
      modules[specifier] = load(`${specifier.slice(2)}.ts`);
      return modules[specifier];
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const start = (load("app/api/timer/start/route.ts") as { POST: Handler }).POST;
  const manual = (load("app/api/timer/manual/route.ts") as { POST: Handler }).POST;
  const invoke = (mode: "start" | "manual", overrides: Row = {}) => (mode === "start" ? start : manual)(new Request(`https://sowledger.example/api/timer/${mode}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: "Client review", startedAt: "2026-01-12T10:00:00Z", stoppedAt: "2026-01-12T11:00:00Z", ...overrides }),
  }));
  return {
    invoke,
    get rows() { return rows; },
    get lockedBlockReads() { return lockedBlockReads; },
    get notifications() { return notifications; },
    failNextBlockWrite() { failBlockUpdate = true; },
    block(overrides: Row = {}) {
      const block = { id: "block-a", ...session, userId: session.sub, title: "Client review", tags: [], status: "planned", linkedTimeEntryId: null, actionId: null, ...overrides };
      rows.scheduledWorkBlocks.push(block);
      return block;
    },
    action(hourlyRate: number | null) {
      const action = { id: `action-${rows.userActions.length}`, workspaceId: session.workspaceId, userId: session.sub, name: "Review", hourlyRate };
      rows.userActions.push(action);
      return action;
    },
  };
}

for (const mode of ["start", "manual"] as const) {
  test(`${mode}: an imported event stays unavailable after editable labels change`, async () => {
    const f = fixture();
    f.block({ tags: [], title: "Renamed external appointment", notes: null });
    f.rows.integrationSyncRecords.push({ id: "sync", workspaceId: session.workspaceId, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: "block-a", metadata: { direction: "google_busy_to_sowledger" } });
    assert.equal((await f.invoke(mode, { scheduledBlockId: "block-a" })).status, 409);
    assert.equal(f.rows.timeEntries.length, 0);
  });

  test(`${mode}: explicit zero rates survive entry creation, distinct from unset rates`, async () => {
    const f = fixture();
    for (const rate of [0, null, 100]) {
      const action = f.action(rate);
      const response = await f.invoke(mode, { actionId: action.id });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).entry.hourlyRate, rate);
    }
  });

  test(`${mode}: a planned block can be consumed once and keeps its existing link on retry`, async () => {
    const f = fixture();
    const block = f.block();
    const responses = await Promise.all([f.invoke(mode, { scheduledBlockId: block.id }), f.invoke(mode, { scheduledBlockId: block.id })]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(f.rows.timeEntries.length, 1);
    assert.equal(f.rows.scheduledWorkBlocks[0].linkedTimeEntryId, f.rows.timeEntries[0].id);
    assert.equal(f.rows.scheduledWorkBlocks[0].status, mode === "start" ? "in_progress" : "completed");
    assert.equal(f.lockedBlockReads, 2);
    assert.equal(f.notifications, 1);
  });

  test(`${mode}: reject completed, in-progress, canceled, skipped and already-linked blocks`, async () => {
    for (const overrides of [
      ...["completed", "in_progress", "canceled", "skipped"].map((status) => ({ status })),
      { linkedTimeEntryId: "existing-entry" },
    ]) {
      const f = fixture();
      f.block(overrides);
      const response = await f.invoke(mode, { scheduledBlockId: "block-a" });
      assert.equal(response.status, 409, JSON.stringify(overrides));
      assert.equal(f.rows.timeEntries.length, 0);
      assert.equal(f.notifications, 0);
    }
  });

  test(`${mode}: resetting calendar metadata cannot orphan an existing time entry and consume it again`, async () => {
    const f = fixture();
    f.block();
    f.rows.timeEntries.push({ id: "already-logged", workspaceId: session.workspaceId, userId: session.sub, scheduledBlockId: "block-a" });
    assert.equal((await f.invoke(mode, { scheduledBlockId: "block-a" })).status, 409);
    assert.equal(f.rows.timeEntries.length, 1);
  });

  test(`${mode}: block ownership, workspace and availability checks remain enforced`, async () => {
    for (const [overrides, expected] of [
      [{ workspaceId: "other-workspace" }, 400],
      [{ userId: "other-person" }, 400],
      [{ tags: ["unavailable"] }, 409],
      [{ tags: ["external-calendar"] }, 409],
      [{ tags: ["ooo"] }, 409],
    ] as const) {
      const f = fixture();
      f.block(overrides);
      assert.equal((await f.invoke(mode, { scheduledBlockId: "block-a" })).status, expected);
      assert.equal(f.rows.timeEntries.length, 0);
    }
    const f = fixture();
    assert.equal((await f.invoke(mode, { scheduledBlockId: "missing" })).status, 400);
  });

  test(`${mode}: failed block update rolls back the new entry`, async () => {
    const f = fixture();
    f.block();
    f.failNextBlockWrite();
    assert.equal((await f.invoke(mode, { scheduledBlockId: "block-a" })).status, 500);
    assert.equal(f.rows.timeEntries.length, 0);
    assert.equal(f.rows.scheduledWorkBlocks[0].status, "planned");
    assert.equal(f.rows.scheduledWorkBlocks[0].linkedTimeEntryId, null);
    assert.equal(f.notifications, 0);
  });
}

test("starting and manually completing the same planned block race safely", async () => {
  const f = fixture();
  f.block();
  const responses = await Promise.all([f.invoke("start", { scheduledBlockId: "block-a" }), f.invoke("manual", { scheduledBlockId: "block-a" })]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(f.rows.timeEntries.length, 1);
  assert.equal(f.rows.scheduledWorkBlocks[0].linkedTimeEntryId, f.rows.timeEntries[0].id);
});

test("manual calendar logging inherits a zero rate, while an explicit cleared action stays unset", async () => {
  for (const clearAction of [false, true]) {
    const f = fixture();
    const action = f.action(0);
    f.block({ actionId: action.id });
    const response = await f.invoke("manual", { scheduledBlockId: "block-a", ...(clearAction ? { actionId: "" } : {}) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).entry.hourlyRate, clearAction ? null : 0);
  }
});

test("different planned blocks still support concurrent timers", async () => {
  const f = fixture();
  f.block();
  f.block({ id: "block-b" });
  const responses = await Promise.all([f.invoke("start", { scheduledBlockId: "block-a" }), f.invoke("start", { scheduledBlockId: "block-b" })]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(f.rows.timeEntries.length, 2);
  assert.equal(new Set(f.rows.scheduledWorkBlocks.map((block) => block.linkedTimeEntryId)).size, 2);
});

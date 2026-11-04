const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

type Row = Record<string, unknown>;
type TableName = "memberships" | "projects" | "scheduledWorkBlocks" | "userActions" | "timeEntries" | "integrationSyncRecords";
type Column = { key: string };
type Table = { name: TableName } & Record<string, Column>;
type Condition = (row: Row) => boolean;
const root = process.cwd();
const tables = Object.fromEntries(["memberships", "projects", "scheduledWorkBlocks", "userActions", "timeEntries", "integrationSyncRecords"].map(name => [name, new Proxy({ name }, {
  get(target, key: string) { return key === "name" ? target.name : { key }; },
})])) as Record<TableName, Table>;
const occurrence = (day = 1, hour = 9) => ({ startsAt: `2026-12-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`, endsAt: `2026-12-${String(day).padStart(2, "0")}T${String(hour + 1).padStart(2, "0")}:00:00Z` });
const payload = (extra: Row = {}) => ({ operationId: crypto.randomUUID(), title: "Client delivery", occurrences: [occurrence(1), occurrence(2), occurrence(3)], ...extra });

function fixture() {
  let rows: Record<TableName, Row[]> = {
    memberships: [{ workspaceId: "workspace", userId: "owner", role: "owner" }, { workspaceId: "workspace", userId: "other", role: "member" }],
    projects: [], scheduledWorkBlocks: [], userActions: [], timeEntries: [], integrationSyncRecords: [],
  };
  const session = { workspaceId: "workspace", sub: "owner", role: "owner" };
  const afterCallbacks: Array<() => Promise<unknown> | void> = [];
  const notifications: unknown[] = [];
  let insertCount = 0;
  let failInsertAt = 0;
  let nextTransaction = Promise.resolve();

  function select() {
    let table: Table;
    let filter: Condition = () => true;
    let limit = Infinity;
    let order: Column | undefined;
    const builder = {
      from(value: Table) { table = value; return builder; },
      where(value: Condition) { filter = value; return builder; },
      for() { return builder; },
      orderBy(value: Column) { order = value; return builder; },
      limit(value: number) { limit = value; return builder; },
      then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
        const selected = rows[table.name].filter(filter).map(row => structuredClone(row));
        if (order) selected.sort((left, right) => String(left[order!.key]).localeCompare(String(right[order!.key])));
        return Promise.resolve(selected.slice(0, limit)).then(resolve, reject);
      },
    };
    return builder;
  }
  const operations = {
    select,
    insert(table: Table) {
      return { values(input: Row | Row[]) {
        const values = Array.isArray(input) ? input : [input];
        let execution: Promise<Row[]> | undefined;
        const execute = () => execution ??= Promise.resolve().then(() => values.map(value => {
          if (table === tables.scheduledWorkBlocks && ++insertCount === failInsertAt) throw new Error("Injected insert failure");
          if (rows[table.name].some(row => row.id === value.id)) throw new Error("Duplicate primary key");
          const row = { status: "planned", linkedTimeEntryId: null, tags: [], createdAt: new Date(), updatedAt: new Date(), ...structuredClone(value) };
          rows[table.name].push(row);
          return structuredClone(row);
        }));
        return { returning: execute, then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } };
      } };
    },
    update(table: Table) {
      return { set(value: Row) { return { where(filter: Condition) {
        let execution: Promise<Row[]> | undefined;
        const execute = () => execution ??= Promise.resolve().then(() => rows[table.name].filter(filter).map(row => { Object.assign(row, structuredClone(value)); return structuredClone(row); }));
        return { returning: execute, then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } };
      } }; } };
    },
  };
  const db = { ...operations, async transaction<T>(callback: (tx: typeof operations) => Promise<T>) {
    let release!: () => void;
    const beforeTransaction = nextTransaction;
    nextTransaction = new Promise(resolve => { release = resolve; });
    await beforeTransaction;
    const snapshot = structuredClone(rows);
    try { return await callback(operations); }
    catch (error) { rows = snapshot; throw error; }
    finally { release(); }
  } };
  const modules: Record<string, unknown> = {
    "node:crypto": { createHash },
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) }, after: (callback: () => Promise<unknown> | void) => afterCallbacks.push(callback) },
    "@/lib/db": { db }, "@/lib/db/schema": tables,
    "@/lib/auth": { ...authErrors, requireSession: async () => session, requireRole: (minimum: string, role: string) => { if (["client", "member", "manager", "owner"].indexOf(role) < ["client", "member", "manager", "owner"].indexOf(minimum)) throw new authErrors.ForbiddenError("Forbidden"); } },
    "@/lib/app-url": { getAppOrigin: () => "https://sowledger.test" },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "@/lib/schedule-mutations": { updateScheduledBlock: async () => { throw new Error("Unexpected update route"); } },
    "@/lib/integrations/notifications": { dispatchIntegrationNotification: async (...args: unknown[]) => { notifications.push(args); } },
    "drizzle-orm": {
      eq: (column: Column, value: unknown): Condition => row => row[column.key] === value,
      gt: (column: Column, value: Date): Condition => row => (row[column.key] as Date) > value,
      lt: (column: Column, value: Date): Condition => row => (row[column.key] as Date) < value,
      inArray: (column: Column, values: unknown[]): Condition => row => values.includes(row[column.key]),
      like: (column: Column, value: string): Condition => row => String(row[column.key]).startsWith(value.slice(0, -1)),
      and: (...conditions: Condition[]): Condition => row => conditions.every(condition => condition(row)),
      or: (...conditions: Condition[]): Condition => row => conditions.some(condition => condition(row)),
      asc: (column: Column) => column,
      desc: (column: Column) => column,
    },
  };
  function load(filename: string): unknown {
    const code = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      assert.ok(["@/lib/schedule-batch", "@/lib/scheduled-block-guards", "@/lib/validators", "@/lib/workflow-validation", "@/lib/date-input", "@/lib/time-capacity"].includes(specifier), `Unexpected real dependency ${specifier}`);
      return modules[specifier] = load(`${specifier.slice(2)}.ts`);
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  const route = load("app/api/schedule/route.ts") as { POST: (request: unknown) => Promise<Response> };
  return {
    get rows() { return rows; }, session, notifications, afterCallbacks,
    failOnInsert(index: number) { failInsertAt = index; },
    post: (body: unknown) => route.POST({ json: async () => body }),
    async flushAfter() { for (const callback of afterCallbacks.splice(0)) await callback(); },
    block(id: string, extra: Row = {}) {
      const row = { id, workspaceId: "workspace", userId: "owner", createdByUserId: "owner", title: "Existing plan", status: "planned", linkedTimeEntryId: null, tags: [], startsAt: new Date(occurrence().startsAt), endsAt: new Date(occurrence().endsAt), updatedAt: new Date("2026-11-01T00:00:00Z"), ...extra };
      rows.scheduledWorkBlocks.push(row);
      return row;
    },
  };
}

test("batch saves all occurrences and notifies only after commit, never again on retry", async () => {
  const f = fixture();
  const input = payload();
  const first = await f.post(input);
  assert.equal(first.status, 200, await first.clone().text());
  const receipt = await first.json();
  assert.equal(receipt.blockIds.length, 3);
  assert.equal(receipt.replayed, false);
  assert.equal(f.notifications.length, 0);
  await f.flushAfter();
  assert.equal(f.notifications.length, 3);
  const retry = await f.post(input);
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).blockIds, receipt.blockIds);
  await f.flushAfter();
  assert.equal(f.notifications.length, 3);
  assert.equal(f.rows.scheduledWorkBlocks.length, 3);
});

test("failed insertion restores skipped plans and preceding inserts, then corrected retry saves once", async () => {
  const f = fixture();
  const original = f.block("old");
  const before = structuredClone(original);
  const input = payload({ occurrences: [occurrence()], replace: [{ blockId: original.id, expectedUpdatedAt: original.updatedAt.toISOString() }] });
  f.failOnInsert(1);
  assert.equal((await f.post(input)).status, 500);
  assert.deepEqual(f.rows.scheduledWorkBlocks, [before]);
  assert.equal(f.afterCallbacks.length, 0);
  assert.equal((await f.post(input)).status, 200);
  assert.equal(f.rows.scheduledWorkBlocks.length, 2);
  assert.equal(f.rows.scheduledWorkBlocks.find(block => block.id === "old")!.status, "skipped");
  const series = fixture();
  series.failOnInsert(2);
  assert.equal((await series.post(payload())).status, 500);
  assert.equal(series.rows.scheduledWorkBlocks.length, 0);
  assert.equal(series.afterCallbacks.length, 0);
});

test("changed and incomplete operation receipts fail closed, while later block edits are preserved", async () => {
  const f = fixture();
  const input = payload();
  assert.equal((await f.post(input)).status, 200);
  assert.equal((await f.post({ ...input, title: "Different work" })).status, 409);
  f.rows.scheduledWorkBlocks[0].title = "Later correction";
  f.rows.scheduledWorkBlocks[0].status = "canceled";
  assert.equal((await f.post(input)).status, 200);
  assert.equal(f.rows.scheduledWorkBlocks[0].title, "Later correction");
  f.rows.scheduledWorkBlocks.pop();
  assert.equal((await f.post(input)).status, 409);
  assert.equal(f.rows.scheduledWorkBlocks.length, 2);
});

test("every replacement is checked before mutations, including hidden imported ownership and either time link", async () => {
  for (const kind of ["stale", "unavailable", "imported", "reverse", "forward", "consumed", "foreign", "other-user", "not-overlapping"]) {
    const f = fixture();
    const good = f.block("a-good");
    const bad = f.block("z-bad", kind === "unavailable" ? { tags: ["ooo"] } : kind === "reverse" ? { linkedTimeEntryId: "entry" } : kind === "consumed" ? { status: "in_progress" } : kind === "foreign" ? { workspaceId: "foreign" } : kind === "other-user" ? { userId: "other" } : kind === "not-overlapping" ? { startsAt: new Date(occurrence(2).startsAt), endsAt: new Date(occurrence(2).endsAt) } : {});
    if (kind === "imported") f.rows.integrationSyncRecords.push({ workspaceId: "workspace", resourceType: "scheduled_work_block", resourceId: bad.id, provider: "google_calendar", metadata: { direction: "google_busy_to_sowledger" } });
    if (kind === "forward") f.rows.timeEntries.push({ id: "entry", workspaceId: "workspace", scheduledBlockId: bad.id });
    const before = structuredClone(f.rows);
    const input = payload({ occurrences: [occurrence()], replace: [good, bad].map(block => ({ blockId: block.id, expectedUpdatedAt: kind === "stale" && block.id === bad.id ? "2026-10-01T00:00:00Z" : block.updatedAt.toISOString() })) });
    assert.equal((await f.post(input)).status, kind === "foreign" ? 404 : 409, kind);
    assert.deepEqual(f.rows, before, kind);
  }
});

test("overlapping distinct occurrences are deliberate and warnings do not hide exact duplicates", async () => {
  const f = fixture();
  const input = payload({ occurrences: [occurrence(), { startsAt: "2026-12-01T09:30:00Z", endsAt: "2026-12-01T10:30:00Z" }] });
  const response = await f.post(input);
  assert.equal(response.status, 200);
  assert.match((await response.json()).warnings.join(" "), /overlap/i);
  const duplicate = await f.post(payload({ occurrences: [occurrence(), occurrence()] }));
  assert.equal(duplicate.status, 400);
  assert.equal(f.rows.scheduledWorkBlocks.length, 2);
});

test("legacy single-create contract and access remain unchanged", async () => {
  const f = fixture();
  const response = await f.post({ title: "Original single caller", ...occurrence() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).block.title, "Original single caller");
  f.session.role = "client";
  assert.equal((await f.post(payload())).status, 403);
  f.session.role = "member";
  assert.equal((await f.post(payload({ userId: "other" }))).status, 403);
  assert.equal(f.rows.scheduledWorkBlocks.length, 1);
});

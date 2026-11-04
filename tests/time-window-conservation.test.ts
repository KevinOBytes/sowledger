const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Compile the actual exported function, without importing DB/env/network modules.
// The AST selects executable code, not an expected source-text assertion.
const source = ts.createSourceFile("security.ts", readFileSync(path.join(process.cwd(), "lib/security.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "splitTimeWindowByUtcDay");
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} as { splitTimeWindowByUtcDay?: (start: Date, end: Date) => Array<{ startedAt: Date; stoppedAt: Date; durationSeconds: number }> } };
new Function("module", "exports", compiled)(loaded, loaded.exports);
const split = loaded.exports.splitTimeWindowByUtcDay!;

const cases: Array<[string, string, number[]]> = [
  ["2026-01-12T23:59:59.500Z", "2026-01-13T00:00:00.500Z", [0, 1]],
  ["2026-01-12T23:59:58.100Z", "2026-01-13T00:00:01.900Z", [1, 2]],
  ["2026-01-12T23:59:58.900Z", "2026-01-13T00:00:01.100Z", [1, 1]],
  ["2026-01-12T23:59:59.900Z", "2026-01-13T00:00:03.100Z", [0, 3]],
  ["2026-01-12T23:59:56.900Z", "2026-01-13T00:00:00.100Z", [3, 0]],
  ["2026-01-12T23:59:59.500Z", "2026-01-14T00:00:00.500Z", [0, 86400, 1]],
  ["2026-01-12T12:00:00.100Z", "2026-01-12T12:00:00.600Z", [1]],
  ["2026-01-12T23:59:59.750Z", "2026-01-13T00:00:00.250Z", [0, 1]],
  ["2026-01-12T23:59:59.500Z", "2026-01-13T00:00:00.000Z", [1]],
  ["2026-01-12T23:59:58.500Z", "2026-01-13T00:00:00.000Z", [1]],
  ["2026-01-12T12:00:00.100Z", "2026-01-12T12:00:00.100Z", [0]],
  ["0012-01-01T23:30:00.000Z", "0012-01-02T00:30:00.000Z", [1800, 1800]],
  ["0099-12-31T23:30:00.000Z", "0100-01-01T00:30:00.000Z", [1800, 1800]],
  ["0000-02-28T23:30:00.000Z", "0000-02-29T00:30:00.000Z", [1800, 1800]],
];

for (const [start, end, durations] of cases) {
  test(`one elapsed budget and real UTC fragments: ${start} -> ${end}`, () => {
    const segments = split(new Date(start), new Date(end));
    assert.deepEqual(segments.map((segment) => segment.durationSeconds), durations);
    assert.equal(segments[0].startedAt.toISOString(), start);
    assert.equal(segments.at(-1)!.stoppedAt.toISOString(), end);
    for (const [index, segment] of segments.entries()) {
      assert.ok(Number.isInteger(segment.durationSeconds) && segment.durationSeconds >= 0);
      assert.ok(segment.stoppedAt >= segment.startedAt);
      if (index > 0) {
        assert.equal(segment.startedAt.getTime(), segments[index - 1].stoppedAt.getTime());
        assert.equal(segment.startedAt.toISOString().slice(11), "00:00:00.000Z");
      }
    }
  });
}

test("invalid or reversed ranges never invent recorded time", () => {
  for (const [start, end] of [
    [new Date(NaN), new Date("2026-01-13Z")],
    [new Date("2026-01-13Z"), new Date(NaN)],
    [new Date("2026-01-13Z"), new Date("2026-01-12Z")],
  ]) assert.throws(() => split(start, end), RangeError);
});

test("fractional boundary distributions conserve a deterministic whole-window budget", () => {
  const midnight = Date.parse("2026-01-13T00:00:00.000Z");
  for (const before of [1, 100, 250, 500, 999, 1001, 1900, 2345]) {
    for (const after of [1, 100, 250, 500, 999, 1001, 1900, 2345]) {
      const segments = split(new Date(midnight - before), new Date(midnight + after));
      assert.equal(segments.length, 2);
      assert.equal(segments.reduce((sum, segment) => sum + segment.durationSeconds, 0), Math.max(1, Math.floor((before + after) / 1000)));
      assert.equal(segments[0].durationSeconds, Math.floor(before / 1000));
      assert.equal(segments[0].stoppedAt.getTime(), midnight);
      assert.equal(segments[1].startedAt.getTime(), midnight);
    }
  }
});

// Exercise the actual import route with real splitter/validation and only its
// external session, DB connection and lock/capacity reads controlled locally.
function importFixture() {
  type Row = Record<string, unknown>;
  type Column = { key: string };
  type Table = { name: string };
  type Condition = (row: Row) => boolean;
  let rows: Row[] = [];
  let insertAttempts = 0;
  let failAt = 0;
  let tail = Promise.resolve();
  const session = { sub: "member", workspaceId: "workspace", role: "manager" };
  const schema = Object.fromEntries(["memberships", "timeEntries", "goals", "projects"].map((name) => [name, new Proxy({ name }, { get(target, key: string) { return key === "name" ? target.name : { key }; } })]));
  const operations = {
    execute: async () => {},
    select() {
      let table: Table;
      let condition: Condition = () => true;
      const query = {
        from(value: Table) { table = value; return query; },
        where(value: Condition) { condition = value; return query; },
        limit() { return query; }, for() { return query; },
        then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
          const candidates = table.name === "memberships" ? [{ userId: session.sub, workspaceId: session.workspaceId }] : rows;
          return Promise.resolve(candidates.filter(condition)).then(resolve, reject);
        },
      };
      return query;
    },
    insert() { return { async values(row: Row) {
      if (++insertAttempts === failAt) throw new Error("Controlled import insert failure");
      rows.push(structuredClone(row));
    } }; },
  };
  const db = { ...operations, async transaction<T>(callback: (tx: typeof operations) => Promise<T>, config: unknown) {
    assert.deepEqual(config, { isolationLevel: "read committed" });
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = structuredClone(rows);
    try { return await callback(operations); }
    catch (error) { rows = before; throw error; }
    finally { release(); }
  } };
  const modules: Record<string, unknown> = {
    "node:crypto": { createHash },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth": { ...authErrors, requireSession: async () => session, requireRole: () => {} },
    "@/lib/db": { db }, "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => {} },
    "@/lib/security": { splitTimeWindowByUtcDay: split, ensurePeriodUnlocked: async () => {}, PeriodLockedError: class extends Error {} },
    "drizzle-orm": {
      eq: (column: Column, value: unknown): Condition => (row) => row[column.key] === value,
      like: (column: Column, value: string): Condition => (row) => String(row[column.key]).startsWith(value.slice(0, -1)),
      and: (...conditions: Condition[]): Condition => (row) => conditions.every((condition) => condition(row)),
      or: (...conditions: Condition[]): Condition => (row) => conditions.some((condition) => condition(row)),
      gte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) >= value,
      lt: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) < value,
      sql: (_parts: TemplateStringsArray, column: Column) => ({ key: column?.key }),
    },
  };
  function load(filename: string): unknown {
    const output = ts.transpileModule(readFileSync(path.join(process.cwd(), filename), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", output)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      assert.ok(["@/lib/validators", "@/lib/workflow-validation", "@/lib/date-input", "@/lib/time-capacity"].includes(specifier), `Unexpected import dependency: ${specifier}`);
      return modules[specifier] = load(`${specifier.slice(2)}.ts`);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const handler = (load("app/api/integrations/calendar/import/route.ts") as { POST: (request: Request) => Promise<Response> }).POST;
  return {
    get rows() { return rows; },
    failInsertAt(value: number) { failAt = value; insertAttempts = 0; },
    send(events = [{ id: "fractional-event", title: "Calendar work", startsAt: "2026-01-12T23:59:59.500Z", endsAt: "2026-01-13T00:00:00.500Z" }]) {
      return handler(new Request("https://sowledger.example/api/integrations/calendar/import", { method: "POST", body: JSON.stringify({ provider: "google", events }) }));
    },
  };
}

test("calendar import skips zero allocation without renumbering provider fragment identities on replay", async () => {
  const f = importFixture();
  const results = await Promise.all([f.send(), f.send()]);
  assert.deepEqual(results.map((response) => response.status), [200, 200]);
  assert.deepEqual(await results[0].json(), {
    ok: true, provider: "google", imported: 1, skipped: 0,
    importedIds: [`calendar-${createHash("sha256").update(JSON.stringify(["workspace", "member", "google", "fractional-event"])).digest("hex")}-1`],
    message: "Events imported as draft time entries. Review the time before approval. Previously imported events were left unchanged.",
  });
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].durationSeconds, 1);
  assert.equal((f.rows[0].startedAt as Date).toISOString(), "2026-01-13T00:00:00.000Z");
  assert.equal((await results[1].json()).skipped, 1);
  assert.equal((await (await f.send()).json()).imported, 0);
  assert.equal(f.rows.length, 1);
});

test("calendar import rolls back a retained fractional fragment when a later batch write fails", async () => {
  const f = importFixture();
  f.failInsertAt(2);
  const events = [
    { id: "fractional", title: "Fractional work", startsAt: "2026-01-12T23:59:59.500Z", endsAt: "2026-01-13T00:00:00.500Z" },
    { id: "later", title: "Later work", startsAt: "2026-01-13T12:00:00.000Z", endsAt: "2026-01-13T13:00:00.000Z" },
  ];
  const response = await f.send(events);
  assert.equal(response.status, 500);
  assert.equal(f.rows.length, 0);
  f.failInsertAt(0);
  assert.equal((await f.send(events)).status, 200);
  assert.equal(f.rows.length, 2);
  assert.equal(f.rows.reduce((sum, row) => sum + Number(row.durationSeconds), 0), 3601);
});

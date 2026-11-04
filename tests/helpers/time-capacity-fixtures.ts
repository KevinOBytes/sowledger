const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled DB boundary for imported actual route/helper code. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

type Row = Record<string, any>;
type Column = { key: string };
type Condition = (row: Row) => boolean;
const native = createRequire(import.meta.url);
export const at = (value = "2026-10-02T00:00:00.000Z") => new Date(value);
export function writerFixture(baseline = process.env.SOWLEDGER_CAPACITY_BASELINE === "true") {
  let rows: Record<string, Row[]> = { timeEntries: [], memberships: [{ workspaceId: "workspace", userId: "actor", role: "owner" }], lockPeriods: [], auditLogs: [], scheduledWorkBlocks: [], projects: [], goals: [], userActions: [] };
  const session = { workspaceId: "workspace", sub: "actor", role: "owner" };
  const calls: string[] = [];
  const callbacks: Array<() => unknown> = [];
  const usage: number[] = [];
  let active = false, committed = false;
  let fail = "";
  let hold: Promise<void> | undefined;
  let onEntryLock: (() => void) | undefined;
  const schema = Object.fromEntries(Object.keys(rows).map(name => [name, new Proxy({ name }, { get: (table, key: string) => key === "name" ? table.name : { key } })]));
  const canonical = (row: Row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, (key === "durationSeconds" || key === "accumulatedSeconds") && value !== null ? Math.fround(value) : value]));
  function ops(inside: boolean) {
    return {
      async execute(query: any) {
        assert.ok(inside); calls.push(`lock:${query.values[0]}`);
        if (fail === "lock") throw new Error("private lock SQL");
        await hold;
      },
      select(projection?: Row) {
        let table: { name: string }, condition: Condition = () => true, mode = "", maximum = Infinity;
        const builder = {
          from(value: { name: string }) { table = value; return builder; },
          where(value: Condition) { condition = value; return builder; },
          limit(value: number) { maximum = value; return builder; },
          for(value: string) { mode = value; return builder; },
          then(resolve: (result: Row[]) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve().then(() => {
              if (mode && table.name === "timeEntries") onEntryLock?.();
              calls.push(`${inside ? "tx" : "db"}:${table.name}:${mode || "read"}${projection?.durationSeconds ? ":capacity" : ""}`);
              if ((fail === "count" && (projection?.durationSeconds || projection?.totalSeconds?.sum)) || (fail === "period" && table.name === "lockPeriods")) throw new Error("private SQL with secrets");
              const selected = rows[table.name].filter(condition).slice(0, maximum);
              if (projection?.totalSeconds?.sum) return [{ totalSeconds: selected.reduce((total, row) => Math.fround(total + (row.durationSeconds ?? 0)), 0) }];
              return selected.map(row => projection
                ? Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, column.widen ? (row[column.key] === null ? null : Math.fround(row[column.key])) : row[column.key]]))
                : structuredClone(row));
            }).then(resolve, reject);
          },
        };
        return builder;
      },
      insert(table: { name: string }) {
        return { values(input: Row) {
          let pending: Promise<Row[]> | undefined;
          const run = () => pending ??= Promise.resolve().then(() => {
            assert.ok(active && inside); calls.push(`insert:${table.name}`);
            if (fail === "audit" && table.name === "auditLogs") throw new Error("private audit SQL");
            if (fail === "second-entry" && table.name === "timeEntries" && rows.timeEntries.length > 0) throw new Error("private continuation SQL");
            const row = { accumulatedSeconds: 0, isPaused: false, pausedAt: null, scheduledBlockId: null, stoppedAt: null, durationSeconds: null, status: "draft", ...canonical(input) };
            rows[table.name].push(row); return [structuredClone(row)];
          });
          return { returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
        } };
      },
      update(table: { name: string }) {
        return { set(updates: Row) { return { where(condition: Condition) {
          let pending: Promise<Row[]> | undefined;
          const run = () => pending ??= Promise.resolve().then(() => {
            assert.ok(active && inside); calls.push(`update:${table.name}`);
            const changed = rows[table.name].filter(condition);
            for (const row of changed) Object.assign(row, canonical(updates));
            return structuredClone(changed);
          });
          return { returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
        } }; } };
      },
    };
  }
  const db = { ...ops(false), async transaction(body: any, config: unknown) {
    calls.push(`transaction:${JSON.stringify(config)}`); active = true; committed = false;
    const before = structuredClone(rows);
    try { const result = await body(ops(true)); committed = true; return result; }
    catch (error) { rows = before; throw error; }
    finally { active = false; }
  } };
  const drizzle = {
    eq: (column: Column, value: unknown): Condition => row => row[column.key] === value,
    ne: (column: Column, value: unknown): Condition => row => row[column.key] !== value,
    isNotNull: (column: Column): Condition => row => row[column.key] != null,
    gte: (column: Column, value: Date): Condition => row => row[column.key] >= value,
    lt: (column: Column, value: Date): Condition => row => row[column.key] < value,
    like: (column: Column, value: string): Condition => row => String(row[column.key]).startsWith(value.replace(/%$/, "")),
    and: (...filters: Condition[]): Condition => row => filters.every(filter => filter(row)),
    or: (...filters: Condition[]): Condition => row => filters.some(filter => filter(row)),
    sql: (parts: TemplateStringsArray, ...values: any[]) => ({ values, key: values[0]?.key, widen: parts.join("").includes("double precision"), sum: parts.join("").includes("sum(") }),
  };
  const modules: Record<string, any> = {
    "drizzle-orm": drizzle,
    "next/server": { NextResponse: { json: Response.json }, after: (callback: () => unknown) => { assert.ok(committed && !active); callbacks.push(callback); } },
    "@/lib/db": { db }, "@/lib/db/schema": schema,
    "@/lib/auth": { ...authErrors, requireSession: async () => session, requireRole: () => {} },
    "@/lib/env": { env: { NODE_ENV: "test", AUDIT_SIGNING_SECRET: "test-only" } },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => {} },
    "@/lib/validators": { normalizeTags: (tags: unknown) => tags ?? [] },
    "@/lib/store": { calculateEffectiveRate: async () => 0 },
    "@/lib/app-url": { getAppOrigin: () => "https://example.com" },
    "@/lib/integrations/notifications": { dispatchIntegrationNotification: async () => {} },
    "@/lib/api-keys": { getApiKeyErrorContext: () => null, authenticateApiKey: async () => ({ workspaceId: "workspace", createdByUserId: "actor" }), requireApiScope: () => {}, recordApiKeyRequest: async (_c: unknown, _r: unknown, status: number) => { usage.push(status); } },
  };
  for (const name of ["export-data", "invoice-proof-pack", "project-creation", "project-history", "schedule-mutations", "revenue-intelligence", "scheduled-block-guards"]) modules[`@/lib/${name}`] = {};
  function load(file: string): any {
    const snapshot = `.superpowers/sdd/continuation-plan-2026-10-31/task-5b-snapshot/before/${file}.snapshot`;
    const selected = baseline && existsSync(snapshot) ? snapshot : file;
    const code = ts.transpileModule(readFileSync(selected, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", code)((name: string) => {
      if (name.startsWith("./") && file.startsWith("lib/")) name = `@/lib/${name.slice(2)}`;
      if (name in modules) return modules[name];
      if (name.startsWith("@/lib/")) return modules[name] = load(`${name.slice(2)}.ts`);
      if (name.startsWith("node:")) return native(name);
      throw new Error(`Unexpected dependency ${name}`);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return {
    get rows() { return rows; }, calls, callbacks, usage, session, load,
    fail(value: string) { fail = value; },
    hold(value: Promise<void>) { hold = value; },
    onEntryLock(value: () => void) { onEntryLock = value; },
    entry(overrides: Row = {}) {
      const row = { id: "entry", workspaceId: "workspace", userId: "actor", startedAt: at(), stoppedAt: new Date(at().getTime() + 1000), durationSeconds: 1, accumulatedSeconds: 0, status: "draft", scheduledBlockId: null, ...overrides };
      rows.timeEntries.push(row); return row;
    },
    async request(route: string, body: Row, method = "POST") {
      const handler = load(route)[method];
      return handler(new Request("https://example.com/api/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ resource: "time-entries" }) }) as Promise<Response>;
    },
  };
}

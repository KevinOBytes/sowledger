import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transformSync } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "../../lib/db/schema";

export type Row = Record<string, unknown>;
export const tagRow = (id = "target", extra: Row = {}): Row => ({ id, workspaceId: "workspace", name: "before", color: "rebeccapurple", projectId: null, isSOWLedgerDefault: false, status: "active", ...extra });
type Module = Record<string, (...args: never[]) => unknown>;

// Closed source loader: storage, sessions and key authentication are controlled;
// all tag production code, Drizzle predicates, role/scope and error identities run.
// This records call order only. It is deliberately NOT a PostgreSQL lock simulator.
export function tagFixture(surface: "native" | "public", options: { rows?: Row[]; projects?: Row[]; emptyReturning?: boolean; ioError?: Error; role?: string; scopes?: string[]; unauthorized?: boolean; recorderFailure?: boolean } = {}) {
  const tables = new Map<unknown, Row[]>([[schema.workspaceTags, structuredClone(options.rows ?? [tagRow()])], [schema.projects, options.projects ?? [{ id: "project", workspaceId: "workspace", status: "archived" }]]]);
  const events: string[] = [], writes: Row[] = [], predicates: Array<{ table: string; sql: string; params: unknown[] }> = [], usage: number[] = [];
  const field = (name: string) => name === "is_billable_default" ? "isSOWLedgerDefault" : name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  function match(table: unknown, row: Row, predicate: SQL) {
    const query = new PgDialect().sqlToQuery(predicate);
    predicates.push({ table: getTableName(table as typeof schema.projects), ...query });
    const expr = query.sql.replace(/(?:"[^"]+"\.)+"([^"]+)" = \$(\d+)/g, (_, name: string, n: string) => String(row[field(name)] === query.params[Number(n) - 1])).replace(/\band\b/gi, "&&").replace(/\bor\b/gi, "||");
    assert.match(expr, /^[()\s&|truefals]+$/, `Unsupported tag predicate: ${query.sql}`);
    return new Function(`return ${expr}`)() as boolean;
  }
  const fail = () => { if (options.ioError) throw options.ioError; };
  const db = {
    select() { return { from(table: unknown) { return { where(predicate: SQL) {
      events.push(`read:${getTableName(table as typeof schema.projects)}`);
      const read = () => { fail(); return (tables.get(table) ?? []).filter(row => match(table, row, predicate)).map(row => ({ ...row })); };
      return { then(yes: (rows: Row[]) => unknown, no: (error: unknown) => unknown) { return Promise.resolve().then(read).then(yes, no); }, async for(mode: string) { events.push(`lock:${getTableName(table as typeof schema.projects)}:${mode}`); return read(); }, async limit(n: number) { return read().slice(0, n); }, orderBy() { return Promise.resolve().then(read); } };
    } }; } }; },
    insert(table: unknown) { return { values(values: Row) { writes.push(values); events.push("insert:workspace_tags"); return { async returning() { fail(); if (options.emptyReturning) return []; const row = { status: "active", ...values }; tables.get(table)!.push(row); return [row]; } }; } }; },
    update(table: unknown) { return { set(values: Row) { return { where(predicate: SQL) { writes.push(values); events.push("update:workspace_tags"); return { async returning() { fail(); if (options.emptyReturning) return []; const rows = tables.get(table)!.filter(row => match(table, row, predicate)); for (const row of rows) Object.assign(row, values); return rows; } }; } }; } }; },
    delete(table: unknown) { return { where(predicate: SQL) { events.push("delete:workspace_tags"); writes.push({ delete: true }); const run = () => { fail(); if (options.emptyReturning) return []; const rows = tables.get(table)!.filter(row => match(table, row, predicate)); tables.set(table, tables.get(table)!.filter(row => !match(table, row, predicate))); return rows; }; return { async returning() { return run(); }, then(yes: (rows: Row[]) => unknown, no: (e: unknown) => unknown) { return Promise.resolve().then(run).then(yes, no); } }; } }; },
    async transaction<T>(fn: (tx: unknown) => Promise<T>, config: unknown): Promise<T> { events.push(`transaction:${JSON.stringify(config)}`); const snapshot = new Map([...tables].map(([table, rows]) => [table, structuredClone(rows)])); try { const value = await fn(db); events.push("commit"); return value; } catch (error) { for (const [table, rows] of snapshot) tables.set(table, rows); events.push("rollback"); throw error; } },
  };
  const native = createRequire(path.join(process.cwd(), "package.json"));
  const deps: Record<string, unknown> = {
    "@/lib/db": { db }, "@/lib/db/schema": schema,
    "server-only": {},
    "@/components/tags-data-table": { TagsDataTable: "TagsDataTable" },
    "@/components/data-load-notice": { DataLoadNotice: "DataLoadNotice" },
    "next/headers": { cookies: async () => { throw new Error("Uncontrolled cookies"); } },
    "@/lib/env": { env: { NODE_ENV: "test", AUTH_COOKIE_SECRET: "synthetic-not-a-real-secret-at-least-24" } },
    "@/lib/admin": { isAdminEmail: () => false }, "@/lib/billing": {}, "@/lib/store": {},
    "@/lib/planned-work": {
      loadEligiblePlannedWork: async () => { throw new Error("Planned-work analytics is outside the tag-only fixture"); },
    },
    "@/lib/invoice-lifecycle": {
      lockInvoiceLifecycle: async () => { throw new Error("Invoice lifecycle locking is outside the tag-only fixture"); },
      exposeInvoice: async () => { throw new Error("Invoice exposure is outside the tag-only fixture"); },
      exposeFinancialRows: async () => { throw new Error("Financial exposure is outside the tag-only fixture"); },
    },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => { events.push("bootstrap"); } },
  };
  for (const name of ["export-data", "invoice-proof-pack", "project-creation", "project-history", "schedule-mutations", "revenue-intelligence", "scheduled-block-entry", "scheduled-block-guards", "security", "task-mutations", "client-mutations"]) deps[`@/lib/${name}`] = {};
  const allowed = new Set(["@/lib/auth", "@/lib/api-keys", "@/lib/workflow-validation", "@/lib/date-input", "@/lib/time-capacity", "@/lib/validators", "@/lib/tag-validation", "@/lib/tag-mutations", "@/lib/team-page-session", "@/app/(app)/settings/tags/page", "@/app/api/settings/tags/route", "@/app/api/v1/[resource]/route"]);
  function load(id: string, from = ""): Module {
    if (id.startsWith(".")) id = "@/" + path.posix.normalize(path.posix.join(path.posix.dirname(from.slice(2)), id));
    if (id in deps) return deps[id] as Module;
    if (!id.startsWith("@/")) { assert.ok(["next/server", "next/navigation", "react/jsx-runtime", "drizzle-orm", "node:crypto"].includes(id), `Uncontrolled package ${id}`); return native(id); }
    assert.ok(allowed.has(id), `Uncontrolled source dependency ${id}`);
    const mod = { exports: {} }; deps[id] = mod.exports;
    const page = id === "@/app/(app)/settings/tags/page";
    new Function("require", "module", "exports", transformSync(readFileSync(`${id.slice(2)}.${page ? "tsx" : "ts"}`, "utf8"), { loader: page ? "tsx" : "ts", jsx: "automatic", format: "cjs" }).code)((name: string) => load(name, id), mod, mod.exports);
    return (deps[id] = mod.exports) as Module;
  }
  const auth = load("@/lib/auth") as unknown as { UnauthorizedError: new (message: string) => Error; requireRole: (min: string, role: string) => void };
  deps["@/lib/auth"] = { ...auth, requireSession: async () => { events.push("session"); if (options.unauthorized) throw new auth.UnauthorizedError("private"); return { workspaceId: "workspace", sub: "owner", role: options.role ?? "owner" }; }, requireRole: (min: string, role: string) => { events.push(`role:${min}`); auth.requireRole(min, role); } };
  const api = load("@/lib/api-keys");
  deps["@/lib/api-keys"] = { ...api, authenticateApiKey: async () => { events.push("api-auth"); if (options.unauthorized) throw new auth.UnauthorizedError("private"); return { id: "key", workspaceId: "workspace", createdByUserId: "owner", scopes: options.scopes ?? ["read:tags", "write:tags"] }; }, recordApiKeyRequest: async (_ctx: unknown, _req: unknown, status: number) => { usage.push(status); if (options.recorderFailure) throw new Error("private recorder"); } };
  return { db, load, events, writes, predicates, usage, rows: () => tables.get(schema.workspaceTags)!, async call(body?: unknown, method = "PATCH", id = "target", raw?: string) {
    const req = new NextRequest(`https://fixture.test/api/tags?id=${encodeURIComponent(id)}`, { method, ...(["POST", "PATCH"].includes(method) ? { body: raw ?? JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    const route = load(surface === "native" ? "@/app/api/settings/tags/route" : "@/app/api/v1/[resource]/route");
    return (route[method] as unknown as (req: NextRequest, ctx: unknown) => Promise<Response>)(req, { params: Promise.resolve({ resource: "tags" }) });
  } };
}

import { UnauthorizedError, ForbiddenError } from "../../lib/auth";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { transformSync } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import * as schema from "../../lib/db/schema";
import * as workflow from "../../lib/workflow-validation";
import * as dates from "../../lib/date-input";

export type Row = Record<string, unknown>;
export const entry = (id = "a", extra: Row = {}): Row => ({ id, workspaceId: "workspace", userId: "owner", projectId: "p", taskId: id, status: "approved", startedAt: new Date("2026-10-01Z"), stoppedAt: new Date("2026-10-01T01:00Z"), durationSeconds: 3600, hourlyRate: 100, description: id, ...extra });
export const project = (id = "p", clientId: string | null = "c", extra: Row = {}): Row => ({ id, clientId, workspaceId: "workspace", name: id, ...extra });
type Options = { entries?: Row[]; projects?: Row[]; clients?: Row[]; invoices?: Row[]; organizations?: Row[]; people?: Row[]; memberships?: Row[]; users?: Row[]; failUserChunk?: number; role?: string; fault?: string; ioError?: Error; probe?: number; changedProject?: boolean; returnedAmount?: number; rereadAmount?: number; affectedIds?: string[]; organizationReturnedIds?: string[]; clientDeletedIds?: string[] };

// Real route, validation and services; only storage/auth/notifications are controlled.
// Real Drizzle compiles predicates; unsupported predicates fail closed in this fixture.
export function invoiceFixture(options: Options = {}) {
  const tables = new Map<unknown, Row[]>([
    [schema.timeEntries, options.entries ?? [entry()]], [schema.projects, options.projects ?? [project()]],
    [schema.clients, options.clients ?? [{ id: "c", workspaceId: "workspace", name: "Client", status: "archived" }]],
    [schema.invoices, options.invoices ?? []], [schema.organizations, options.organizations ?? [{ id: "org", workspaceId: "workspace", clientId: "c" }]], [schema.workspacePeople, options.people ?? []],
    [schema.memberships, options.memberships ?? [{ workspaceId: "workspace", userId: "owner" }]], [schema.users, options.users ?? [{ id: "owner", email: "owner@example.com" }]], [schema.auditLogs, []], [schema.invoiceLifecycle, []], [schema.integrationSyncRecords, []], [schema.webhooks, []], [schema.integrationConnections, []],
  ]);
  const events: string[] = [], errors: unknown[] = [], afters: Array<() => Promise<void>> = [], predicates: Array<{ table: unknown; sql: string; params: unknown[] }> = [];
  let userReads = 0;
  let readingUsers = false;
  const key = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const name = (table: unknown) => getTableName(table as typeof schema.projects);
  function match(row: Row, predicate: SQL) {
    const q = new PgDialect().sqlToQuery(predicate);
    let expr = q.sql.replace(/(?:"[^"]+"\.)+"([^"]+)" in \(([^)]+)\)/g, (_, col: string, params: string) => String(params.split(",").some(p => row[key(col)] === q.params[Number(p.trim().slice(1)) - 1])));
    expr = expr.replace(/(?:"[^"]+"\.)+"([^"]+)" is not null/g, (_, col: string) => String(row[key(col)] != null));
    expr = expr.replace(/(?:"[^"]+"\.)+"([^"]+)" = \$(\d+)/g, (_, col: string, n: string) => String(row[key(col)] === q.params[Number(n) - 1]));
    expr = expr.replace(/(?:"[^"]+"\.)+"([^"]+)" <> \$(\d+)/g, (_, col: string, n: string) => String(row[key(col)] !== q.params[Number(n) - 1]));
    expr = expr.replace(/\band\b/gi, "&&").replace(/\bor\b/gi, "||");
    assert.match(expr, /^[()\s&|truefals]+$/, q.sql);
    return new Function(`return ${expr}`)();
  }
  function fail(point: string) { if (options.ioError) throw options.ioError; if (options.fault === point) throw new Error("private SQL secret"); }
  const fakeDb = {
    select(fields?: Row) { return { from(table: unknown) {
      let predicate: SQL | undefined; let locked = false; let limit = Infinity;
      const read = async () => {
        fail(`read:${name(table)}`); events.push(`read:${name(table)}`);
        if (locked && table === schema.timeEntries && options.changedProject) tables.get(table)![0].projectId = "new-parent";
        // Evaluate only the real GET's exact global-user IN predicate with a Set,
        // keeping the 65,536-member protocol regression linear in fixture rows.
        let userIds: Set<unknown> | undefined;
        if (table === schema.users && predicate) {
          const query = new PgDialect().sqlToQuery(predicate);
          assert.match(query.sql, /^(?:"[^"]+"\.)+"id" in \(\$1(?:, \$\d+)*\)$/);
          if (++userReads === options.failUserChunk || query.params.length > 65535) throw new Error("controlled user query failure");
          userIds = new Set(query.params);
          assert.equal(readingUsers, false, "Membership user chunks must not overlap on the supplied storage client");
          readingUsers = true;
          try { await setImmediate(); } finally { readingUsers = false; }
        }
        const rows = (tables.get(table) ?? []).filter(row => userIds ? userIds.has(row.id) : !predicate || match(row, predicate)).slice(0, limit).sort((a,b) => String(a.id).localeCompare(String(b.id)));
        return rows.map(row => { const copy = { ...row }; if (table === schema.invoices && options.rereadAmount !== undefined) copy.amount = options.rereadAmount; return fields ? Object.fromEntries(Object.entries(fields).map(([k, col]) => [k, (col as { name?: string }).name ? copy[key((col as { name: string }).name)] : true])) : copy; });
      };
      const chain = { where(p: SQL) { predicate = p; const q = new PgDialect().sqlToQuery(p); predicates.push({ table, sql: q.sql, params: q.params }); return chain; }, orderBy() { return chain; }, for(mode: string) { locked = true; events.push(`lock:${name(table)}:${mode}`); return chain; }, limit(n: number) { limit = n; return chain; }, then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(read).then(resolve, reject); } };
      return chain;
    } }; },
    async execute(query: SQL) { const q = new PgDialect().sqlToQuery(query); if (q.sql.includes("pg_advisory_xact_lock")) { assert.deepEqual(q.params, ["invoice-lifecycle:workspace"]); events.push("lifecycle-lock"); return { rows: [] }; } fail("probe"); events.push("probe"); assert.match(q.sql, /cast\(.+ as real\)/i); return { rows: [{ amount: options.probe ?? Number(q.params[0]) }] }; },
    insert(table: unknown) { return { values(raw: Row) { const row = { ...raw, createdAt: new Date("2026-10-31Z") }; const save = () => { fail(`insert:${name(table)}`); events.push(`insert:${name(table)}`); tables.get(table)!.push(row); return [{ ...row, ...(options.returnedAmount === undefined ? {} : { amount: options.returnedAmount }) }]; }; return { async returning() { return save(); }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(save).then(resolve, reject); } }; } }; },
    update(table: unknown) { return { set(values: Row) { return { where(predicate: SQL) { const q = new PgDialect().sqlToQuery(predicate); predicates.push({ table, sql: q.sql, params: q.params }); const run = () => { fail(`update:${name(table)}`); events.push(`update:${name(table)}`); const rows = tables.get(table)!.filter(row => match(row, predicate)); for (const row of rows) Object.assign(row, values); const ids = table === schema.organizations ? options.organizationReturnedIds : table === schema.timeEntries ? options.affectedIds : undefined; return ids ? ids.map(id => ({ id })) : rows; }; return { async returning() { return run(); }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(run).then(resolve, reject); } }; } }; } }; },
    delete(table: unknown) { return { where(predicate: SQL) { const q = new PgDialect().sqlToQuery(predicate); predicates.push({ table, sql: q.sql, params: q.params }); const run = () => { fail(`delete:${name(table)}`); events.push(`delete:${name(table)}`); const rows = tables.get(table)!.filter(row => match(row, predicate)); tables.set(table, tables.get(table)!.filter(row => !match(row, predicate))); return table === schema.clients && options.clientDeletedIds ? options.clientDeletedIds.map(id => ({ id })) : rows; }; return { async returning() { return run(); }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(run).then(resolve, reject); } }; } }; },
    async transaction<T>(fn: (tx: unknown) => Promise<T>, config: unknown) { events.push(`transaction:${JSON.stringify(config)}`); const before = [...tables].map(([table, rows]) => [table, structuredClone(rows)] as const); try { const value = await fn(fakeDb); fail("commit"); events.push("commit"); return value; } catch (error) { errors.push(error); for (const [table, rows] of before) tables.set(table, rows); events.push("rollback"); throw error; } },
  };
  const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const deps: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse, after: (fn: () => Promise<void>) => { assert.equal(events.at(-1), "commit"); events.push("after"); afters.push(fn); } },
    "@/lib/db": { db: fakeDb }, "@/lib/db/schema": schema, "@/lib/workflow-validation": { ...workflow, workflowErrorResponse: (error: unknown, fallback: string, context?: workflow.WorkflowDiagnosticContext) => { errors.push(error); return workflow.workflowErrorResponse(error, fallback, context); } }, "@/lib/date-input": dates,
    "@/lib/auth": { UnauthorizedError, ForbiddenError, requireSession: async () => ({ workspaceId: "workspace", sub: "owner", role: options.role ?? "owner" }), requireRole: (min: string, role: string) => { if (role === "client" || (min === "manager" && role === "member")) throw new ForbiddenError("Forbidden"); } },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "@/lib/billing": { checkWorkspaceLimits: async () => ({ allowed: true }) },
    "@/lib/security": { appendAuditLog: async (row: Row) => { fail("audit"); tables.get(schema.auditLogs)!.push(row); events.push("audit"); }, dispatchWebhook: async () => events.push("webhook") },
    "@/lib/integrations/notifications": { dispatchIntegrationNotification: async () => events.push("notification") }, "@/lib/app-url": { getAppOrigin: () => "https://fixture.test" },
  };
  function load(id: string): unknown {
    if (id in deps) return deps[id];
    if (!id.startsWith("@/")) return nativeRequire(id);
    const mod = { exports: {} }; deps[id] = mod.exports;
    const source = readFileSync(`${id.slice(2)}.ts`, "utf8").replaceAll('import("@/lib/billing")', 'Promise.resolve(require("@/lib/billing"))');
    new Function("require", "module", "exports", transformSync(source, { loader: "ts", format: "cjs" }).code)(load, mod, mod.exports);
    return deps[id] = mod.exports;
  }
  return { events, errors, afters, predicates, rows: (table: unknown = schema.invoices) => tables.get(table)!, load,
    async call(body?: unknown, method = "POST", resource = "invoices", raw?: string) {
      const handlers = load(`@/app/api/${resource}/route`) as Record<string, (req: NextRequest, context: { params: Promise<{ invoiceId: string }> }) => Promise<Response>>;
      return handlers[method](new NextRequest(`https://fixture.test/api/${resource}${method === "DELETE" ? "?clientId=c" : ""}`, { method, ...(["POST", "PATCH"].includes(method) ? { headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) } : {}) }), { params: Promise.resolve({ invoiceId: "invoice" }) });
    } };
}

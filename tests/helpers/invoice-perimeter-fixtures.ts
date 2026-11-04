import { UnauthorizedError, ForbiddenError, WorkspaceCapacityError } from "../../lib/auth";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { transformSync } from "esbuild";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest, NextResponse } from "next/server";
import * as schema from "../../lib/db/schema";
import * as workflow from "../../lib/workflow-validation";
import { errorFixture } from "./error-boundary-fixtures";

type Row = Record<string, unknown>;
type Options = { status?: string; duplicate?: boolean; missing?: boolean; foreign?: boolean; role?: string; entitled?: boolean; receipt?: boolean; overlapGuard?: boolean; providerError?: boolean };
// Actual source is evaluated with only external storage/session/provider boundaries
// replaced for executed operations; no connection is opened. Direct workflow
// imports can reach the lazy runtime DB/auth modules; module reachability is
// not the same as exercising those external operations.
export function perimeterFixture(options: Options = {}) {
  const at = new Date("2026-10-12T09:00:00Z");
  const invoice: Row = { id: "invoice", workspaceId: options.foreign ? "foreign" : "workspace", number: "INV-TEST", status: options.status ?? "sent", amount: 100, projectId: "project", timeEntryIds: options.duplicate ? ["entry", "entry"] : ["entry"], dueDate: null, createdAt: at };
  const tables = new Map<unknown, Row[]>([
    [schema.invoices, options.missing ? [] : [invoice]],
    [schema.projects, [{ id: "project", workspaceId: "workspace", clientId: "client", name: "Project <safe>" }]],
    [schema.timeEntries, [{ id: "entry", workspaceId: "workspace", userId: "user", projectId: "project", scheduledBlockId: "block", taskId: "Task <safe>", description: "Notes", startedAt: at, stoppedAt: new Date(at.getTime() + 3600_000), durationSeconds: 3600, hourlyRate: 100, status: "invoiced", source: "manual", tags: [] }]],
    [schema.users, [{ id: "user", email: "user@example.com" }]],
    [schema.scheduledWorkBlocks, [{ id: "block", workspaceId: "workspace", title: "Plan", startsAt: at, endsAt: new Date(at.getTime() + 1800_000), status: "planned", tags: [], source: "manual" }]],
    [schema.auditLogs, []], [schema.invoiceLifecycle, []],
  ]);
  const events: string[] = [], predicates: Array<{ table: unknown; sql: string; params: unknown[] }> = [];
  let active = 0, insideTransaction = false;
  const key = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  function match(row: Row, p: SQL) {
    const q = new PgDialect().sqlToQuery(p);
    let expr = q.sql.replace(/(?:"[^"]+"\.)+"([^"]+)" in \(([^)]+)\)/g, (_, col: string, params: string) => String(params.split(",").some(n => row[key(col)] === q.params[Number(n.trim().slice(1)) - 1])));
    expr = expr.replace(/(?:"[^"]+"\.)+"([^"]+)" (<>|=) \$(\d+)/g, (_, col: string, op: string, n: string) => String(op === "=" ? row[key(col)] === q.params[Number(n) - 1] : row[key(col)] !== q.params[Number(n) - 1]));
    expr = expr.replace(/\band\b/gi, "&&").replace(/\bor\b/gi, "||");
    assert.match(expr, /^[()\s&|truefals]+$/, q.sql);
    return new Function(`return ${expr}`)() as boolean;
  }
  const fakeDb = {
    async execute(query: SQL) { const q = new PgDialect().sqlToQuery(query); assert.match(q.sql, /pg_advisory_xact_lock/); assert.deepEqual(q.params, ["invoice-lifecycle:workspace"]); events.push("lifecycle-lock"); return { rows: [] }; },
    select() { return { from(table: unknown) {
      let predicate: SQL | undefined;
      const chain = {
        where(p: SQL) { predicate = p; const q = new PgDialect().sqlToQuery(p); predicates.push({ table, sql: q.sql, params: q.params }); return chain; },
        orderBy() { return chain; },
        limit() { return chain; },
        for(mode: string) { events.push(`lock:${getTableName(table as typeof schema.invoices)}:${mode}`); return chain; },
        then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
          const run = async () => {
            if (options.overlapGuard && active) throw new Error("single-client concurrent query");
            active++; events.push(`read:${getTableName(table as typeof schema.invoices)}`);
            try { await setImmediate(); return (tables.get(table) ?? []).filter(row => !predicate || match(row, predicate)).map(row => ({ ...row })); }
            finally { active--; }
          };
          return run().then(resolve, reject);
        },
      }; return chain;
    } }; },
    async transaction<T>(fn: (tx: unknown) => Promise<T>, config: unknown) {
      events.push(`transaction:${JSON.stringify(config)}`); insideTransaction = true;
      try { const result = await fn(fakeDb); events.push("commit"); return result; }
      catch (error) { events.push("rollback"); throw error; }
      finally { insideTransaction = false; }
    },
  };
  const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const connection = { id: "connection", workspaceId: "workspace", provider: "quickbooks", status: "connected", config: { realmId: "realm", environment: "sandbox", connectionGeneration: "generation", customerRefId: "customer", serviceItemRefId: "item" }, credentials: { accessToken: "synthetic-encrypted" }, tokenExpiresAt: new Date(Date.now() + 3600_000) };
  const deps: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse, after: () => events.push("after") },
    "@/lib/db": { db: fakeDb }, "@/lib/db/schema": schema, "@/lib/workflow-validation": workflow,
    "@/lib/auth": { UnauthorizedError, ForbiddenError, WorkspaceCapacityError, requireSession: async () => ({ sub: "user", workspaceId: "workspace", role: options.role ?? "client" }), requireRole: (minimum: string, role: string) => { if (minimum === "manager" && !["owner", "manager"].includes(role)) throw new ForbiddenError("Forbidden"); } },
    "@/lib/client-entitlements": { getClientEntitlementIds: async () => options.entitled === false ? [] : ["client"], isInvoiceClientEntitled: async () => options.entitled !== false && !options.foreign && !options.missing, getClientEntitledInvoiceIds: async () => new Set(options.entitled === false || options.foreign ? [] : ["invoice"]) },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => { events.push("schema"); } },
    "@/lib/security": { WebhookUrlValidationError: errorFixture().security.WebhookUrlValidationError, appendAuditLog: async () => events.push("audit"), dispatchWebhook: async () => events.push("webhook") },
    "@/lib/env": { env: { QUICKBOOKS_ENVIRONMENT: "sandbox" } },
    "@/lib/integrations/crypto": { decryptSecret: () => { events.push("decrypt"); return "synthetic-token"; }, encryptSecret: () => { events.push("encrypt"); return "synthetic-encrypted"; } },
    "@/lib/integrations/connections": {
      getIntegrationConnection: async (workspaceId: string, provider: string) => { assert.equal(insideTransaction, false); assert.equal(workspaceId, "workspace"); assert.equal(provider, "quickbooks"); events.push("connection"); return connection; },
      findSyncRecord: async (input: Row) => { assert.deepEqual(input, { workspaceId: "workspace", provider: "quickbooks", resourceType: "invoice", resourceId: "invoice" }); events.push("receipt-read"); return options.receipt ? { externalId: "existing-external" } : null; },
      upsertSyncRecord: async (input: Row) => { assert.equal(input.workspaceId, "workspace"); assert.equal(input.resourceId, "invoice"); assert.equal(input.externalId, "new-external"); events.push("receipt-write"); },
      markIntegrationSynced: async () => events.push("synced"), markIntegrationError: async () => events.push("provider-error"),
    },
  };
  // This suite retains its invoice/perimeter scope. Durable operation internals
  // are exercised independently against actual source in quickbooks-safety.
  deps["@/lib/integrations/quickbooks-operations"] = {
    assertQuickBooksCurrent: async () => connection,
    quickBooksIdentity: () => ({ realmId: "realm", environment: "sandbox", connectionGeneration: "generation" }),
    confirmedQuickBooksReceipt: (record: Row) => record.externalId,
    claimQuickBooksInvoice: async () => ({ reused: false, record: { metadata: { requestId: "controlled-operation" } } }),
    confirmQuickBooksInvoice: async (_record: Row, externalId: string) => {
      const helpers = deps["@/lib/integrations/connections"] as { upsertSyncRecord: (input: Row) => Promise<unknown> };
      await helpers.upsertSyncRecord({ workspaceId: "workspace", resourceId: "invoice", externalId });
    },
  };
  const providerFetch = async (url: string, init: RequestInit) => {
    assert.equal(insideTransaction, false); events.push("provider"); assert.match(url, /\/v3\/company\/realm\/invoice\?minorversion=75&requestid=controlled-operation$/); assert.equal(init.method, "POST");
    const payload = JSON.parse(init.body as string); assert.equal(payload.DocNumber, "INV-TEST"); assert.equal(payload.Line[0].Amount, 100); assert.deepEqual(payload.CustomerRef, { value: "customer" }); assert.deepEqual(payload.Line[0].SalesItemLineDetail.ItemRef, { value: "item" }); assert.match(payload.PrivateNote, /proof digest [a-f0-9]{64}/);
    if (options.providerError) throw new Error("controlled unknown provider result");
    return Response.json({ Invoice: { Id: "new-external", DocNumber: "INV-TEST" } });
  };
  function load(id: string): unknown {
    if (id in deps) return deps[id];
    if (id.startsWith("../proof-pack")) return load("@/app/api/invoices/[invoiceId]/proof-pack/route");
    if (!id.startsWith("@/")) return nativeRequire(id);
    const mod = { exports: {} }; deps[id] = mod.exports;
    const source = readFileSync(path.join(process.cwd(), `${id.slice(2)}.ts`), "utf8");
    new Function("require", "module", "exports", "fetch", transformSync(source, { loader: "ts", format: "cjs" }).code)(load, mod, mod.exports, providerFetch);
    return deps[id] = mod.exports;
  }
  return { events, predicates, tables, load, invoice,
    push: () => (load("@/lib/integrations/quickbooks") as { pushInvoiceToQuickBooks: (input: Row) => Promise<unknown> }).pushInvoiceToQuickBooks({ workspaceId: "workspace", invoiceId: "invoice" }),
    proof: () => (load("@/lib/invoice-proof-pack") as { buildInvoiceProofPack: (workspace: string, id: string, client: unknown) => Promise<unknown> }).buildInvoiceProofPack("workspace", "invoice", fakeDb),
    async call(resource: "client" | "signoff" | "proof" | "print" | "push", approved = false, digest = "a".repeat(64)) {
      const route = resource === "client" ? "client" : resource === "signoff" ? "client/signoff" : resource === "push" ? "integrations/quickbooks/push-invoice" : `invoices/[invoiceId]/${resource === "proof" ? "proof-pack" : "print"}`;
      const method = resource === "signoff" || resource === "push" ? "POST" : "GET";
      const req = new NextRequest(`https://fixture.test/api/${route}?approved=${approved}`, { method, ...(method === "POST" ? { body: JSON.stringify({ invoiceId: "invoice", digest }), headers: { "content-type": "application/json" } } : {}) });
      return (load(`@/app/api/${route}/route`) as Record<string, (req: NextRequest, ctx: unknown) => Promise<Response>>)[method](req, { params: Promise.resolve({ invoiceId: "invoice" }) });
    },
  };
}

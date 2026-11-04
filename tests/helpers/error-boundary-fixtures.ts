/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled actual-source boundary loader. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transformSync } from "esbuild";
import { NextRequest, NextResponse } from "next/server";
import * as schema from "../../lib/db/schema";

// No runtime db/env/cookie/billing/store module is evaluated. Actual auth class
// identities are evaluated once, then shared by the actual workflow/API modules.
export function errorFixture(options: { integrations?: boolean } = {}) {
  const native = createRequire(path.join(process.cwd(), "package.json"));
  const cache: Record<string, any> = {};
  const state = { error: undefined as unknown, failAuth: false, failDb: false, failTable: undefined as unknown, rows: [] as any[], tables: new Map<unknown, any[]>(), writes: 0, after: 0, dns: undefined as unknown, dnsRecords: [{ address: "8.8.8.8", family: 4 }], authCalls: 0, written: [] as any[], fetch: (async (): Promise<Response> => { throw new Error("Uncontrolled fixture fetch"); }) as (...args: any[]) => Promise<Response> };
  function chain(table?: unknown): any {
    const result: any = new Proxy({}, { get(_target, key) {
      if (key === "then") return (yes: any, no: any) => (state.failDb || (state.failTable !== undefined && state.failTable === table) ? Promise.reject(state.error) : Promise.resolve(state.tables.get(table) ?? state.rows)).then(yes, no);
      if (key === "from") return (value: unknown) => { table = value; return result; };
      if (options.integrations && (key === "set" || key === "values")) return (value: unknown) => { state.written.push(value); return result; };
      return () => result;
    } });
    return result;
  }
  const db = { select: chain, update: () => { state.writes++; return chain(); }, insert: () => { state.writes++; return chain(); }, delete: () => { state.writes++; return chain(); }, execute: async (): Promise<{ rows: any[] }> => { if (state.failDb) throw state.error; return { rows: [] }; }, transaction: async (fn: any) => fn(db) };
  const dependencies: Record<string, any> = {
    "next/server": { NextRequest, NextResponse, after: () => { state.after++; } },
    "next/headers": { cookies: async () => ({ get: () => undefined, set() {} }) },
    "@/lib/db": { db }, "@/lib/db/schema": schema,
    "@/lib/env": { env: { NODE_ENV: "test", AUTH_COOKIE_SECRET: "synthetic-test-only-secret-at-least-24", CRON_SECRET: "synthetic" } },
    "@/lib/admin": { isAdminEmail: () => true },
    "@/lib/app-url": { getAppOrigin: () => "https://fixture.test" },
    "@/lib/billing": { checkWorkspaceLimits: async () => ({ allowed: true }) },
    "@/lib/store": { getMembership: async () => null, createInvitation: async () => undefined },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "node:dns/promises": { lookup: async () => { if (state.dns) throw state.dns; return state.dnsRecords; } },
  };
  const actual = new Set(["auth", "api-keys", "workflow-validation", "date-input", "time-capacity", "security", "validators", "task-validation", "client-validation", "task-mutations", "client-mutations", "tag-validation", "tag-mutations", "invoice-amount", "scheduled-block-guards", "timer-transition", "time-entry-review", "export-data", "invoice-selection"]);
  if (options.integrations) {
    for (const name of ["connections", "google-calendar", "slack", "quickbooks", "quickbooks-operations", "oauth-state", "errors"]) actual.add(`integrations/${name}`);
    dependencies["@/lib/integrations/crypto"] = { encryptSecret: (value: unknown) => value, decryptSecret: (value: unknown) => value };
    dependencies["@/lib/invoice-proof-pack"] = { buildInvoiceProofPack: async () => null };
  }
  function load(id: string, from = ""): any {
    if (id.startsWith(".")) id = "@/" + path.posix.normalize(path.posix.join(path.posix.dirname(from.slice(2)), id));
    if (id in dependencies) return dependencies[id];
    if (id in cache) return cache[id];
    if (!id.startsWith("@/")) return native(id);
    if (!id.startsWith("@/app/") && !actual.has(id.slice(6))) {
      return new Proxy({}, { get: () => async () => { if (state.failDb) throw state.error; return []; } });
    }
    const loadedModule = { exports: {} as any }; cache[id] = loadedModule.exports;
    const source = readFileSync(path.join(process.cwd(), `${id.slice(2)}.ts`), "utf8");
    const compiled = transformSync(source, { loader: "ts", format: "cjs", supported: { "dynamic-import": false } }).code;
    new Function("require", "module", "exports", "process", "fetch", compiled)((name: string) => load(name, id), loadedModule, loadedModule.exports, { env: { NODE_ENV: "test", SOWLEDGER_TEST_DATABASE: "true" } }, (...args: any[]) => state.fetch(...args));
    return cache[id] = loadedModule.exports;
  }
  const auth = load("@/lib/auth");
  const classes = { UnauthorizedError: auth.UnauthorizedError, ForbiddenError: auth.ForbiddenError, WorkspaceCapacityError: auth.WorkspaceCapacityError };
  dependencies["@/lib/auth"] = { ...auth, requireSession: async () => { state.authCalls++; if (state.failAuth) throw state.error; return { sub: "actor", workspaceId: "workspace", role: "owner" }; }, requireRole: auth.requireRole, inviteUser: async () => { if (state.failDb) throw state.error; } };
  const workflow = load("@/lib/workflow-validation");
  const security = load("@/lib/security");
  const api = load("@/lib/api-keys");
  const context = { id: "key", workspaceId: "workspace", scopes: [...api.API_SCOPES], name: "Test", createdByUserId: "actor" };
  const usage: any[] = [];
  let recordFailure = false;
  dependencies["@/lib/api-keys"] = { ...api, authenticateApiKey: async () => { if (state.failAuth) throw state.error; return context; }, recordApiKeyRequest: async (ctx: any, _req: any, status: number) => { usage.push({ context: ctx, status }); if (recordFailure) throw new Error("private recorder SQL"); } };
  // Keep auth-key and URL/limiter producers real. Tests may replace only the
  // authorization operation to reach reminder processing without real secrets.
  dependencies["@/lib/security"] = { ...security, enforceAuthKey: async () => { if (state.failAuth) throw state.error; } };
  return { state, db, dependencies, classes, auth, workflow, security, api, context, usage, load,
    rejectRecorder() { recordFailure = true; },
    async call(route: string, method: string, options: { raw?: string; value?: any; bodyError?: unknown; resource?: string; provider?: string; afterJson?: () => void; query?: string } = {}) {
      const resource = options.resource ?? "projects";
      const request = new NextRequest(`https://fixture.test/api/${route}?id=target&projectId=target&clientId=target&taskId=target&${options.query ?? ""}`, { method, ...(method === "POST" || method === "PATCH" ? { body: options.raw ?? JSON.stringify(options.value ?? {}), headers: { "content-type": "application/json", "x-request-id": "private request marker" } } : {}) });
      if (options.bodyError) request.json = async () => { throw options.bodyError; };
      if (options.afterJson) { const parse = request.json.bind(request); request.json = async () => { const value = await parse(); options.afterJson!(); return value; }; }
      const handler = load(`@/app/api/${route}/route`)[method]; assert.equal(typeof handler, "function");
      return handler(request, { params: Promise.resolve({ resource, invoiceId: "invoice", provider: options.provider ?? "google_calendar" }) }) as Promise<Response>;
    },
  };
}

export async function diagnostics<T>(run: () => Promise<T>) {
  const logs: unknown[][] = []; const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try { return { value: await run(), logs }; } finally { console.error = original; }
}

export function assertDiagnostic(logs: unknown[][], route: string, method: string, count = 1, category: "unexpected" | "upstream" = "unexpected") {
  assert.deepEqual(logs, Array.from({ length: count }, () => ["sowledger_request_failed", { route, method, category }]));
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Actual helpers with controlled transactional storage/provider boundaries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { setImmediate } from "node:timers/promises";
import { errorFixture } from "./helpers/error-boundary-fixtures";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const f = errorFixture({ integrations: true });
  const schema = new Proxy({}, { get: (_t, name: string) => new Proxy({ name }, { get: (t, key: string) => key === "name" ? t.name : { key } }) }) as any;
  type Predicate = (row: any) => boolean;
  const read = (column: any, row: any) => column.read ? column.read(row) : row[column.key];
  const orm = { eq: (col: any, value: any): Predicate => row => isDeepStrictEqual(read(col, row), value), ne: (col: any, value: any): Predicate => row => !isDeepStrictEqual(read(col, row), value), and: (...parts: Predicate[]): Predicate => row => parts.every(p => p(row)), desc: () => undefined,
    sql: (strings: TemplateStringsArray, ...values: any[]) => ({ read: (row: any) => strings.join("").includes("connectionGeneration") ? row.config.connectionGeneration ?? "" : read(values[0], row) }) };
  const connection = { id: "c", workspaceId: "w", provider: "quickbooks", createdByUserId: "u", externalAccountId: "company-a", status: "connected", config: { connectionGeneration: "g-a", realmId: "company-a", environment: "sandbox", customerRefId: "customer", serviceItemRefId: "item" }, credentials: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" }, tokenExpiresAt: new Date(Date.now() + 3600_000), lastError: null, lastSyncedAt: null };
  const rows: Record<string, any[]> = { integrationConnections: [connection], integrationSyncRecords: [], invoices: [{ id: "i", workspaceId: "w", status: "sent", number: "INV", amount: 100, timeEntryIds: ["entry"], dueDate: null }] };
  let transactionTail = Promise.resolve();
  let inTransaction = false;
  let failReceipt = false;
  const db: any = {
    select: () => ({ from: (table: any) => {
      let condition: Predicate = () => true;
      const chain: any = { where(p: Predicate) { condition = p; return chain; }, for() { return chain; }, orderBy() { return chain; }, limit() { return chain; }, then(yes: any, no: any) { return Promise.resolve(rows[table.name].filter(condition).map(row => structuredClone(row))).then(yes, no); } };
      return chain;
    } }),
    insert: (table: any) => ({ values: (value: any) => {
      let conflict: any;
      let ignore = false;
      const chain: any = { onConflictDoNothing(c: any) { conflict = c; ignore = true; return chain; }, onConflictDoUpdate(c: any) { conflict = c; return chain; }, async returning() {
        const found = conflict && rows[table.name].find(row => conflict.target.every((col: any) => isDeepStrictEqual(row[col.key], value[col.key])));
        if (found) { if (ignore) return []; Object.assign(found, structuredClone(conflict.set)); return [structuredClone(found)]; }
        rows[table.name].push(structuredClone(value)); return [structuredClone(value)];
      } }; return chain;
    } }),
    update: (table: any) => ({ set: (value: any) => ({ where: (condition: Predicate) => {
      let done: Promise<any[]> | undefined;
      const run = () => done ??= Promise.resolve().then(() => {
        if (failReceipt && table.name === "integrationSyncRecords" && value.syncStatus === "synced") throw new Error("controlled receipt failure");
        return rows[table.name].filter(condition).map(row => { Object.assign(row, structuredClone(value)); return structuredClone(row); });
      });
      return { returning: run, then: (yes: any, no: any) => run().then(yes, no) };
    } }) }),
    delete: (table: any) => ({ where: async (condition: Predicate) => { rows[table.name] = rows[table.name].filter(row => !condition(row)); } }),
    transaction: async (fn: any) => {
      const prior = transactionTail; const gate = deferred(); transactionTail = gate.promise; await prior;
      inTransaction = true;
      try { return await fn(db); } finally { inTransaction = false; gate.resolve(); }
    },
  };
  Object.assign(f.dependencies, { "drizzle-orm": orm, "@/lib/db/schema": schema, "@/lib/db": { db }, "@/lib/invoice-client-state": { hasDuplicateInvoiceLinks: () => false, duplicateInvoiceConflict: "duplicate" } });
  Object.assign(f.dependencies["@/lib/env"].env, { QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_CLIENT_ID: "synthetic", QUICKBOOKS_CLIENT_SECRET: "synthetic" });
  const requests: Array<{ url: URL; body: any }> = [];
  let provider: (url: URL) => Promise<Response> = async url => url.pathname.endsWith("bearer") ? Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 }) : Response.json({ Invoice: { Id: "42" } });
  f.state.fetch = async (url: string, init: RequestInit) => {
    assert.equal(inTransaction, false, "no database transaction held across provider waits");
    const parsed = new URL(url); requests.push({ url: parsed, body: init.body }); return provider(parsed);
  };
  const q = f.load("@/lib/integrations/quickbooks");
  return { ...f, q, connection, rows, requests, setProvider(value: typeof provider) { provider = value; }, failReceipt() { failReceipt = true; }, push: () => q.pushInvoiceToQuickBooks({ workspaceId: "w", invoiceId: "i" }) };
}

for (const change of ["disconnect", "reconnect"] as const) test(`I1 held old refresh cannot undo ${change} or continue provider work`, async () => {
  const f = fixture(); f.connection.tokenExpiresAt = new Date(0);
  const reached = deferred(), release = deferred();
  f.setProvider(async () => { reached.resolve(); await release.promise; return Response.json({ access_token: "old-access", refresh_token: "old-refresh" }); });
  const pending = f.q.testQuickBooksConnection("w");
  await reached.promise;
  if (change === "disconnect") { f.connection.status = "disabled"; f.connection.credentials = {} as any; }
  else { f.connection.config = { ...f.connection.config, connectionGeneration: "g-b", realmId: "company-b" }; f.connection.externalAccountId = "company-b"; f.connection.credentials = { accessToken: "new-access", refreshToken: "new-refresh" }; }
  const saved = structuredClone(f.connection);
  release.resolve();
  await assert.rejects(pending, (e: any) => e.status === 409);
  assert.deepEqual(f.connection, saved);
  assert.equal(f.requests.length, 1);
});

test("I1 competing refreshes dispatch at most one rotating-token request", async () => {
  const f = fixture(); f.connection.tokenExpiresAt = new Date(0);
  const reached = deferred(), release = deferred();
  f.setProvider(async () => { reached.resolve(); await release.promise; return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh" }); });
  const first = f.q.ensureQuickBooksAccessToken(structuredClone(f.connection));
  await reached.promise;
  const second = f.q.ensureQuickBooksAccessToken(structuredClone(f.connection));
  const results = Promise.allSettled([first, second]);
  await setImmediate(); release.resolve();
  const settled = await results;
  assert.equal(f.requests.length, 1);
  assert.equal(settled.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.connection.credentials.refreshToken, "rotated-refresh");
});

for (const binding of ["same", "different", "legacy"] as const) test(`I2 receipt binding ${binding} is explicit`, async () => {
  const f = fixture();
  f.rows.integrationSyncRecords.push({ id: "receipt", workspaceId: "w", provider: "quickbooks", connectionId: "c", resourceType: "invoice", resourceId: "i", externalId: binding === "legacy" ? "42" : "qb:scoped:42", syncStatus: "synced", metadata: binding === "legacy" ? {} : { state: "confirmed", realmId: binding === "same" ? "company-a" : "company-b", environment: "sandbox", rawExternalId: "42", connectionGeneration: "old-generation" } });
  if (binding === "same") assert.deepEqual(await f.push(), { externalId: "42", reused: true });
  else await assert.rejects(f.push(), (e: any) => e.status === 409);
  assert.equal(f.requests.length, 0);
});

test("I3 simultaneous pushes claim one create, preserving its stable request ID", async () => {
  const f = fixture(); const reached = deferred(), release = deferred();
  f.setProvider(async () => { reached.resolve(); await release.promise; return Response.json({ Invoice: { Id: "42" } }); });
  const first = f.push(); await reached.promise;
  const second = f.push(); const results = Promise.allSettled([first, second]);
  await setImmediate(); release.resolve();
  const settled = await results;
  assert.equal(f.requests.length, 1);
  assert.equal(settled.filter(r => r.status === "fulfilled").length, 1);
  const requestId = f.requests[0].url.searchParams.get("requestid");
  assert.ok(requestId && requestId.length <= 50);
  assert.equal(f.rows.integrationSyncRecords[0].metadata.requestId, requestId);
  assert.deepEqual(await f.push(), { externalId: "42", reused: true });
  assert.equal(f.requests.length, 1);
});

for (const loss of ["response", "receipt"] as const) test(`I3 ${loss} loss prevents automatic second invoice creation`, async () => {
  const f = fixture();
  if (loss === "response") f.setProvider(async () => { throw new Error("controlled response loss"); });
  else f.failReceipt();
  await assert.rejects(f.push());
  await assert.rejects(f.push(), (e: any) => e.status === 409);
  assert.equal(f.requests.length, 1);
});

test("I3 missing preflight authorization creates no invoice claim and can recover after reconnect", async () => {
  const f = fixture();
  f.connection.tokenExpiresAt = new Date(0);
  f.connection.credentials = {} as any;
  await assert.rejects(f.push(), (error: any) => error.status === 409);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.rows.integrationSyncRecords, []);
  f.connection.credentials = { accessToken: "reconnected-access", refreshToken: "reconnected-refresh" };
  f.connection.config.connectionGeneration = "reconnected";
  f.connection.tokenExpiresAt = new Date(Date.now() + 3600_000);
  assert.deepEqual(await f.push(), { externalId: "42", reused: false });
  assert.equal(f.requests.length, 1);
});

test("I1/I3 accepted old-company receipt survives reconnect without a stale success/error stamp", async () => {
  const f = fixture(), reached = deferred(), release = deferred();
  f.setProvider(async () => { reached.resolve(); await release.promise; return Response.json({ Invoice: { Id: "42" } }); });
  const pending = f.push(); const settled = Promise.allSettled([pending]);
  await reached.promise;
  f.connection.config = { ...f.connection.config, connectionGeneration: "new", realmId: "company-b" };
  f.connection.credentials = { accessToken: "new", refreshToken: "new" };
  f.connection.externalAccountId = "company-b";
  const saved = structuredClone(f.connection);
  release.resolve();
  assert.equal((await settled)[0].status, "rejected");
  assert.deepEqual(f.connection, saved);
  assert.equal(f.rows.integrationSyncRecords[0].metadata.realmId, "company-a");
  assert.equal(f.rows.integrationSyncRecords[0].metadata.state, "confirmed");
  await assert.rejects(f.push(), (error: any) => error.status === 409);
  assert.equal(f.requests.length, 1);
});

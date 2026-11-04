// Actual PostgreSQL plus process-local fake provider; no production fault hooks.
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import * as invoiceClientState from "../lib/invoice-client-state";
import { errorFixture } from "./helpers/error-boundary-fixtures";

test.use({ trace: "off", screenshot: "off", video: "off" });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test.describe("Task7g root-owned disposable QuickBooks acceptance", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Disposable wrapper only; no primary data or provider credentials.");
  test.setTimeout(45_000);
  const owned: Array<{ workspaceId: string; userId: string }> = [];
  test.afterEach(async () => {
    for (const item of owned.splice(0)) {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, item.workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, item.userId));
    }
  });

  async function fixture() {
    const workspaceId = crypto.randomUUID(), userId = crypto.randomUUID();
    await db.insert(schema.users).values({ id: userId, email: `qb-local-${userId}@example.com` });
    await db.insert(schema.workspaces).values({ id: workspaceId, slug: `qb-local-${workspaceId}`, name: "QuickBooks isolated fixture" });
    owned.push({ workspaceId, userId });
    const f = errorFixture({ integrations: true });
    let loseReceipt = false;
    const database = new Proxy(db, { get(target, key) {
      if (key === "update") return (table: unknown) => {
        if (loseReceipt && table === schema.integrationSyncRecords) throw new Error("controlled receipt loss");
        return target.update(table as typeof schema.integrationSyncRecords);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    f.dependencies["@/lib/db"] = { db: database };
    // This pure eligibility helper must be real. The generic error fixture's
    // fallback is an async boundary placeholder and is truthy, not a predicate.
    f.dependencies["@/lib/invoice-client-state"] = invoiceClientState;
    expect(invoiceClientState.hasDuplicateInvoiceLinks([])).toBe(false);
    expect(invoiceClientState.hasDuplicateInvoiceLinks(["entry", "entry"])).toBe(true);
    Object.assign(f.dependencies["@/lib/env"].env, { QUICKBOOKS_ENVIRONMENT: "sandbox", QUICKBOOKS_CLIENT_ID: "synthetic-only", QUICKBOOKS_CLIENT_SECRET: "synthetic-only" });
    const calls: URL[] = [];
    let provider = async (url: URL): Promise<Response> => url.pathname.endsWith("bearer")
      ? Response.json({ access_token: "rotated-synthetic-only", refresh_token: "rotated-refresh-only", expires_in: 3600 })
      : Response.json({ Invoice: { Id: "42" } });
    f.state.fetch = async (raw: string, init: RequestInit) => {
      const url = new URL(raw);
      expect(["https://sandbox-quickbooks.api.intuit.com", "https://oauth.platform.intuit.com"]).toContain(url.origin);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      calls.push(url);
      return provider(url);
    };
    const q = f.load("@/lib/integrations/quickbooks");
    const connections = f.load("@/lib/integrations/connections");
    async function connect(realmId = "company-a") {
      await q.storeQuickBooksConnection({ workspaceId, userId, realmId, token: { access_token: "synthetic-access-only", refresh_token: "synthetic-refresh-only", expires_in: 3600 } });
      await q.updateQuickBooksConfig({ workspaceId, customerRefId: "customer", serviceItemRefId: "item" });
      return connections.getIntegrationConnection(workspaceId, "quickbooks");
    }
    async function invoice() {
      const id = crypto.randomUUID();
      await db.insert(schema.invoices).values({ id, workspaceId, number: `LOCAL-${id}`, status: "sent", amount: 100, timeEntryIds: [] });
      return id;
    }
    await connect();
    const invoiceId = await invoice();
    return { q, connections, workspaceId, userId, invoiceId, calls, connect, invoice,
      setProvider(value: typeof provider) { provider = value; }, loseReceipt() { loseReceipt = true; },
      push: (id = invoiceId) => q.pushInvoiceToQuickBooks({ workspaceId, invoiceId: id }),
      receipts: () => db.select().from(schema.integrationSyncRecords).where(eq(schema.integrationSyncRecords.workspaceId, workspaceId)),
    };
  }

  test("two actual reached connection-lock waiters create one invoice and retain one owned receipt", async () => {
    const f = await fixture();
    const locked = deferred(), unlock = deferred(), providerReached = deferred(), releaseProvider = deferred();
    let lockerPid = 0;
    const locker = db.transaction(async tx => {
      await tx.select().from(schema.integrationConnections).where(and(eq(schema.integrationConnections.workspaceId, f.workspaceId), eq(schema.integrationConnections.provider, "quickbooks"))).for("update");
      const result = await tx.execute(sql`select pg_backend_pid() as pid`);
      lockerPid = Number(result.rows[0].pid); locked.resolve(); await unlock.promise;
    });
    f.setProvider(async () => { providerReached.resolve(); await releaseProvider.promise; return Response.json({ Invoice: { Id: "42" } }); });
    await locked.promise;
    const results = Promise.allSettled([f.push(), f.push()]);
    try {
      await expect.poll(async () => {
        const result = await db.execute(sql`
          with recursive wait_chain(pid) as (
            select ${lockerPid}::int
            union
            select activity.pid from pg_stat_activity activity
            join wait_chain parent on parent.pid = any(pg_blocking_pids(activity.pid))
          )
          select count(*)::int as waiting from wait_chain where pid <> ${lockerPid}::int
        `);
        return Number(result.rows[0].waiting);
      }, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      expect(f.calls).toHaveLength(0);
      unlock.resolve(); await locker; await providerReached.promise;
      releaseProvider.resolve();
      const settled = await results;
      expect(settled.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter(result => result.status === "rejected")).toHaveLength(1);
      expect(f.calls).toHaveLength(1);
      const [receipt] = await f.receipts();
      expect(receipt.syncStatus).toBe("synced");
      expect(receipt.metadata.state).toBe("confirmed");
      expect(receipt.metadata.rawExternalId).toBe("42");
      expect(receipt.metadata.requestId).toBe(f.calls[0].searchParams.get("requestid"));
      expect(String(receipt.metadata.requestId).length).toBeLessThanOrEqual(50);
      expect(await f.push()).toEqual({ externalId: "42", reused: true });
      expect(f.calls).toHaveLength(1);
    } finally { unlock.resolve(); releaseProvider.resolve(); await locker; await results; }
  });

  test("real unique external-ID constraint permits same raw invoice ID in different companies without adopting old receipts", async () => {
    const f = await fixture();
    expect(await f.push()).toEqual({ externalId: "42", reused: false });
    const first = (await f.receipts())[0];
    await f.connect("company-b");
    const freshConnection = await f.connections.getIntegrationConnection(f.workspaceId, "quickbooks");
    expect(freshConnection.lastSyncedAt).toBeNull();
    await expect(f.push()).rejects.toMatchObject({ status: 409 });
    const secondId = await f.invoice();
    expect(await f.push(secondId)).toEqual({ externalId: "42", reused: false });
    const receipts = await f.receipts();
    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map(row => row.externalId)).size).toBe(2);
    expect(receipts.find(row => row.id === first.id)).toEqual(first);
    await f.connect("company-b");
    expect(await f.push(secondId)).toEqual({ externalId: "42", reused: true });
    expect(f.calls).toHaveLength(2);
    const legacy = await f.invoice();
    await db.insert(schema.integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: f.workspaceId, connectionId: freshConnection.id, provider: "quickbooks", resourceType: "invoice", resourceId: legacy, externalId: "legacy-raw", syncStatus: "synced", metadata: {} });
    await expect(f.push(legacy)).rejects.toMatchObject({ status: 409 });
    expect(f.calls).toHaveLength(2);
  });

  for (const action of ["disconnect", "reconnect"] as const) test(`actual held refresh cannot undo ${action} or stamp stale success`, async () => {
    const f = await fixture();
    await db.update(schema.integrationConnections).set({ tokenExpiresAt: new Date(0) }).where(eq(schema.integrationConnections.workspaceId, f.workspaceId));
    const reached = deferred(), release = deferred();
    f.setProvider(async () => { reached.resolve(); await release.promise; return Response.json({ access_token: "old-result-only", refresh_token: "old-rotated-only", expires_in: 3600 }); });
    const pending = f.q.testQuickBooksConnection(f.workspaceId);
    const settled = Promise.allSettled([pending]);
    try {
      await reached.promise;
      if (action === "disconnect") await f.connections.disconnectIntegration(f.workspaceId, "quickbooks");
      else await f.connect("company-b");
      const saved = await f.connections.getIntegrationConnection(f.workspaceId, "quickbooks");
      release.resolve();
      expect((await settled)[0].status).toBe("rejected");
      expect(await f.connections.getIntegrationConnection(f.workspaceId, "quickbooks")).toEqual(saved);
      expect(f.calls).toHaveLength(1);
    } finally { release.resolve(); await settled; }
  });

  for (const loss of ["response", "receipt"] as const) test(`actual ${loss} loss leaves non-success reservation and forbids second create`, async () => {
    const f = await fixture();
    if (loss === "response") f.setProvider(async () => { throw new Error("controlled lost response"); });
    else f.loseReceipt();
    await expect(f.push()).rejects.toBeDefined();
    await expect(f.push()).rejects.toMatchObject({ status: 409 });
    expect(f.calls).toHaveLength(1);
    const [record] = await f.receipts();
    expect(record.syncStatus).toBe("error");
    expect(record.metadata.state).toBe("pending");
    expect(record.externalId).toMatch(/^qb:claim:/);
  });

  test("two different pending invoice claims do not collide on the real external-ID unique constraint", async () => {
    const f = await fixture(), other = await f.invoice(), release = deferred();
    f.setProvider(async () => { const id = String(f.calls.length); await release.promise; return Response.json({ Invoice: { Id: id } }); });
    const results = Promise.allSettled([f.push(), f.push(other)]);
    try {
      await expect.poll(() => f.calls.length).toBe(2);
      const rows = await f.receipts();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map(row => row.externalId)).size).toBe(2);
      expect(rows.every(row => row.syncStatus === "error" && row.metadata.state === "pending")).toBe(true);
    } finally { release.resolve(); await results; }
    expect((await results).filter(result => result.status === "fulfilled")).toHaveLength(2);
  });

  test("actual rotating-token claim allows one competing refresh; pre-invoice auth failure creates no invoice claim", async () => {
    const f = await fixture();
    await db.update(schema.integrationConnections).set({ tokenExpiresAt: new Date(0), credentials: {} }).where(eq(schema.integrationConnections.workspaceId, f.workspaceId));
    await expect(f.push()).rejects.toMatchObject({ status: 409 });
    expect(await f.receipts()).toEqual([]); expect(f.calls).toHaveLength(0);
    await f.connect();
    await db.update(schema.integrationConnections).set({ tokenExpiresAt: new Date(0) }).where(eq(schema.integrationConnections.workspaceId, f.workspaceId));
    const connection = await f.connections.getIntegrationConnection(f.workspaceId, "quickbooks");
    const reached = deferred(), release = deferred();
    f.setProvider(async () => { reached.resolve(); await release.promise; return Response.json({ access_token: "rotated-synthetic-only", refresh_token: "rotated-refresh-only", expires_in: 3600 }); });
    const first = f.q.ensureQuickBooksAccessToken(structuredClone(connection));
    let results: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await reached.promise;
      const second = f.q.ensureQuickBooksAccessToken(structuredClone(connection));
      results = Promise.allSettled([first, second]);
      await expect(second).rejects.toMatchObject({ status: 409 });
      expect(f.calls).toHaveLength(1);
      release.resolve();
      expect((await results).filter(row => row.status === "fulfilled")).toHaveLength(1);
      const current = await f.connections.getIntegrationConnection(f.workspaceId, "quickbooks");
      expect(current.credentials.refreshToken).toBe("rotated-refresh-only");
    } finally { release.resolve(); await (results ?? Promise.allSettled([first])); }
  });
});

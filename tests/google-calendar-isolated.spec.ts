import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { transformSync } from "esbuild";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import { errorFixture } from "./helpers/error-boundary-fixtures";

type GoogleEvent = { id: string; etag?: string; status?: string; summary?: string; start: { dateTime: string }; end: { dateTime: string }; extendedProperties?: { private?: Record<string, string> } };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const start = new Date("2026-10-01T00:00:00Z");
const end = new Date("2026-11-01T00:00:00Z");
const externalEvent: GoogleEvent = { id: "external-busy", summary: "External busy time", start: { dateTime: "2026-10-12T10:00:00Z" }, end: { dateTime: "2026-10-12T11:00:00Z" } };

async function fixture() {
  assert.equal(process.env.SOWLEDGER_TEST_DATABASE, "true", "Never run provider/database fixtures against production");
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  await db.insert(schema.users).values({ id: userId, email: `google-isolated-${userId}@example.com` });
  await db.insert(schema.workspaces).values({ id: workspaceId, slug: `google-isolated-${workspaceId}`, name: "Isolated Google sync fixture" });
  await db.insert(schema.integrationConnections).values({
    id: connectionId, workspaceId, provider: "google_calendar", createdByUserId: userId, status: "connected",
    config: { calendarId: "primary", connectionGeneration: crypto.randomUUID(), syncScheduled: true, importBusy: true },
    credentials: { accessToken: "fixture-token-not-a-credential", refreshToken: "fixture-refresh-not-a-credential" },
    tokenExpiresAt: new Date(Date.now() + 3600000),
  });
  let failImportedReceipt = false;
  let refreshCallback: (() => Promise<void>) | undefined;
  let snapshotPause: { ready: () => void; released: Promise<void> } | undefined;
  let deletePause: { ready: () => void; released: Promise<void> } | undefined;
  let loseCreateResponse = false;
  let loseDeleteResponse = false;
  const events = new Map<string, GoogleEvent>();
  const calls: string[] = [];
  // Only fail receipt writes on the import transaction. Real provider-success
  // export receipts use the separate durable database path in production.
  const database = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") return (callback: (tx: Transaction) => Promise<unknown>) => target.transaction((tx) => callback(new Proxy(tx, {
        get(transaction, member) {
          if (member === "insert") return (table: unknown) => {
            if (table === schema.integrationSyncRecords && failImportedReceipt) throw new Error("Injected imported receipt failure");
            return Reflect.apply(transaction.insert, transaction, [table]);
          };
          const value = Reflect.get(transaction, member);
          return typeof value === "function" ? value.bind(transaction) : value;
        },
      })));
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const providerFetch = async (raw: string, init?: RequestInit) => {
    const url = new URL(raw);
    assert.ok(["https://www.googleapis.com", "https://oauth2.googleapis.com"].includes(url.origin));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    assert.ok(init?.signal instanceof AbortSignal, "all fake provider requests exercise bounded production calls");
    if (url.origin === "https://oauth2.googleapis.com") {
      await refreshCallback?.();
      return Response.json({ access_token: "refreshed-fixture-not-a-credential", expires_in: 3600 });
    }
    if (method === "GET" && url.pathname.endsWith("/events")) {
      const snapshot = structuredClone([...events.values()]);
      if (snapshotPause) { const pause = snapshotPause; snapshotPause = undefined; pause.ready(); await pause.released; }
      return Response.json({ kind: "calendar#events", items: snapshot, timeZone: "UTC" });
    }
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (method === "GET") return events.has(id) ? Response.json(events.get(id)) : Response.json({ error: { message: "Not found" } }, { status: 404 });
    if (method === "DELETE") {
      const current = events.get(id);
      if (!current) return Response.json({ error: { message: "Not found" } }, { status: 404 });
      expect(new Headers(init?.headers).get("If-Match")).toBe(current.etag);
      if (deletePause) { const pause = deletePause; deletePause = undefined; pause.ready(); await pause.released; }
      events.set(id, { ...current, status: "cancelled", etag: '"deleted"' });
      if (loseDeleteResponse) { loseDeleteResponse = false; throw new Error("Injected lost delete response"); }
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(String(init?.body)) as GoogleEvent;
    if (method === "POST") {
      if (events.has(body.id)) return Response.json({ error: { message: "Already exists" } }, { status: 409 });
      const next = { ...body, etag: '"created"' };
      events.set(body.id, next);
      if (loseCreateResponse) { loseCreateResponse = false; throw new Error("Injected lost create response"); }
      return Response.json(next);
    }
    if (method === "PATCH") {
      const current = events.get(id);
      if (!current) return Response.json({ error: { message: "Not found" } }, { status: 404 });
      if (current.status === "cancelled") return Response.json({ error: { message: "Resource has been deleted" } }, { status: 410 });
      const next = { ...current, ...body, id, etag: `${current.etag}-next` };
      events.set(id, next);
      return Response.json(next);
    }
    throw new Error("Unexpected fixture provider request");
  };
  const root = process.cwd();
  const require = createRequire(path.join(root, "package.json"));
  const safe = errorFixture();
  const modules: Record<string, unknown> = {
    "@/lib/workflow-validation": safe.workflow, "@/lib/security": safe.security,
    "@/lib/db": { db: database }, "@/lib/db/schema": schema,
    "@/lib/env": { env: { GOOGLE_CALENDAR_CLIENT_ID: "fixture-client", GOOGLE_CALENDAR_CLIENT_SECRET: "fixture-secret-not-a-credential" } },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "@/lib/integrations/crypto": { encryptSecret: (value: string) => value, decryptSecret: (value: string) => value },
  };
  function load(filename: string): Record<string, unknown> {
    const code = transformSync(readFileSync(path.join(root, filename), "utf8"), { loader: "ts", format: "cjs" }).code;
    const loaded = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", "fetch", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      if (specifier.startsWith("@/")) {
        assert.ok(["@/lib/integrations/connections", "@/lib/scheduled-block-guards", "@/lib/integrations/errors"].includes(specifier));
        return modules[specifier] = load(`${specifier.slice(2)}.ts`);
      }
      return require(specifier);
    }, loaded, loaded.exports, providerFetch);
    return loaded.exports;
  }
  const google = load("lib/integrations/google-calendar.ts");
  const sync = google.syncGoogleCalendar as (input: { workspaceId: string; userId: string; start: Date; end: Date }) => Promise<Record<string, unknown>>;
  type Connection = typeof schema.integrationConnections.$inferSelect;
  const connectionHelpers = modules["@/lib/integrations/connections"] as {
    markIntegrationSynced: (connection: Connection) => Promise<Connection>;
    markIntegrationError: (connection: Connection, kind: "upstream" | "unexpected") => Promise<Connection>;
  };
  return {
    workspaceId, userId, connectionId, events, calls,
    sync: () => sync({ workspaceId, userId, start, end }),
    reconnect: () => (google.storeGoogleCalendarConnection as (input: unknown) => Promise<Connection>)({ workspaceId, userId, token: { access_token: "reconnected-access-fixture", refresh_token: "reconnected-refresh-fixture" } }),
    finishSnapshot: (kind: "success" | "error", snapshot: Connection) => kind === "success"
      ? connectionHelpers.markIntegrationSynced(snapshot)
      : connectionHelpers.markIntegrationError(snapshot, "unexpected"),
    connection: async () => (await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId)))[0],
    blocks: () => db.select().from(schema.scheduledWorkBlocks).where(eq(schema.scheduledWorkBlocks.workspaceId, workspaceId)),
    receipts: () => db.select().from(schema.integrationSyncRecords).where(eq(schema.integrationSyncRecords.workspaceId, workspaceId)),
    failImportedReceipt(value = true) { failImportedReceipt = value; },
    loseCreateResponse() { loseCreateResponse = true; },
    loseDeleteResponse() { loseDeleteResponse = true; },
    onRefresh(callback: () => Promise<void>) { refreshCallback = callback; },
    holdSnapshot() {
      let ready!: () => void; let release!: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      snapshotPause = { ready, released }; return { started, release };
    },
    holdDeletion() {
      let ready!: () => void; let release!: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      deletePause = { ready, released }; return { started, release };
    },
    async addOwnedBlock() {
      const id = crypto.randomUUID();
      await db.insert(schema.scheduledWorkBlocks).values({ id, workspaceId, userId, createdByUserId: userId, title: "Owned plan", startsAt: new Date("2026-10-13T10:00:00Z"), endsAt: new Date("2026-10-13T11:00:00Z") });
      return id;
    },
    async cleanup() {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    },
  };
}

test.describe("Google sync PostgreSQL isolation with a fully mocked provider", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires disposable database wrapper; provider calls are always mocked.");

  test("advisory locking rejects overlapping snapshots but not another workspace", async () => {
    const first = await fixture();
    const other = await fixture();
    const held = first.holdSnapshot();
    const active = first.sync();
    await held.started;
    try {
      await expect(first.sync()).rejects.toMatchObject({ status: 409 });
      expect(first.calls).toHaveLength(1);
      expect((await first.connection()).status).toBe("connected");
      other.events.set(externalEvent.id, externalEvent);
      expect((await other.sync()).imported).toBe(1);
    } finally {
      held.release(); await active;
      await first.cleanup(); await other.cleanup();
    }
  });

  test("import failure rolls back busy state but preserves receipts for exported provider events", async () => {
    const f = await fixture();
    try {
      await f.addOwnedBlock();
      f.events.set(externalEvent.id, externalEvent);
      f.failImportedReceipt();
      await expect(f.sync()).rejects.toThrow("Injected imported receipt failure");
      expect(await f.blocks()).toHaveLength(1);
      const receipts = await f.receipts();
      expect(receipts).toHaveLength(1);
      expect(receipts[0].metadata.direction).toBe("sowledger_to_google");
      expect(f.events.size).toBe(2);
      f.failImportedReceipt(false);
      await f.sync();
      expect(await f.blocks()).toHaveLength(2);
      expect(await f.receipts()).toHaveLength(2);
      expect(f.events.size).toBe(2);
    } finally { await f.cleanup(); }
  });

  test("disconnect during a refresh neither deadlocks nor restores provider credentials", async () => {
    const f = await fixture();
    try {
      await db.update(schema.integrationConnections).set({ tokenExpiresAt: new Date(0) }).where(eq(schema.integrationConnections.id, f.connectionId));
      f.onRefresh(async () => {
        await db.update(schema.integrationConnections).set({ status: "disabled", credentials: {} }).where(eq(schema.integrationConnections.id, f.connectionId));
      });
      await expect(f.sync()).rejects.toThrow(/changed|disconnected/);
      const saved = await f.connection();
      expect(saved.status).toBe("disabled");
      expect(saved.credentials).toEqual({});
      expect(f.calls).toHaveLength(1);
      expect(await f.blocks()).toHaveLength(0);
    } finally { await f.cleanup(); }
  });

  test("owned cancellation holds its local block lock until provider absence is durably recorded", async () => {
    const f = await fixture();
    let active: Promise<unknown> | undefined; let held: ReturnType<typeof f.holdDeletion> | undefined;
    try {
      const blockId = await f.addOwnedBlock(); await f.sync();
      const oldId = (await f.receipts())[0].externalId;
      await db.update(schema.scheduledWorkBlocks).set({ status: "canceled" }).where(eq(schema.scheduledWorkBlocks.id, blockId));
      held = f.holdDeletion(); active = f.sync();
      expect(await Promise.race([held.started.then(() => true), active.then(() => false)])).toBe(true);
      let blocked = false;
      try {
        await db.transaction(async tx => {
          await tx.execute(sql`set local lock_timeout = '100ms'`);
          await tx.update(schema.scheduledWorkBlocks).set({ status: "planned" }).where(eq(schema.scheduledWorkBlocks.id, blockId));
        });
      } catch (error) {
        const pg = error as { code?: string; cause?: { code?: string } };
        blocked = (pg.cause?.code ?? pg.code) === "55P03";
      }
      expect(blocked, "a competing restore must wait for the deletion receipt").toBe(true);
      held.release(); await active;
      expect((await f.receipts())[0].syncStatus).toBe("deleted");
      await db.update(schema.scheduledWorkBlocks).set({ status: "planned" }).where(eq(schema.scheduledWorkBlocks.id, blockId));
      await f.sync();
      const restored = (await f.receipts())[0];
      expect(restored.externalId).not.toBe(oldId);
      expect(restored.syncStatus).toBe("synced");
      expect(f.events.get(oldId)!.status).toBe("cancelled");
      expect([...f.events.values()].filter(event => event.status !== "cancelled")).toHaveLength(1);
    } finally { held?.release(); await active; await f.cleanup(); }
  });

  test("owned deletion receipts survive a later imported-state rollback", async () => {
    const f = await fixture();
    try {
      const blockId = await f.addOwnedBlock(); await f.sync();
      const externalId = (await f.receipts())[0].externalId;
      await db.update(schema.scheduledWorkBlocks).set({ status: "skipped" }).where(eq(schema.scheduledWorkBlocks.id, blockId));
      f.events.set(externalEvent.id, externalEvent); f.failImportedReceipt();
      await expect(f.sync()).rejects.toThrow("Injected imported receipt failure");
      expect((await f.receipts())[0].syncStatus).toBe("deleted");
      expect(f.events.get(externalId)!.status).toBe("cancelled");
      expect(await f.blocks()).toHaveLength(1);
      f.failImportedReceipt(false);
      expect((await f.sync()).removed).toBe(0);
      expect(await f.blocks()).toHaveLength(2);
    } finally { await f.cleanup(); }
  });

  test("a proven initial orphan gets a durable receipt before DELETE and can retry a lost deletion response", async () => {
    const f = await fixture(); let held: ReturnType<typeof f.holdDeletion> | undefined; let active: Promise<unknown> | undefined;
    try {
      const blockId = await f.addOwnedBlock(); f.loseCreateResponse();
      await expect(f.sync()).rejects.toMatchObject({ status: 502, message: "The integration provider could not complete the request. Try again later." });
      expect(await f.receipts()).toHaveLength(0);
      const externalId = [...f.events.keys()][0];
      await db.update(schema.scheduledWorkBlocks).set({ status: "canceled" }).where(eq(schema.scheduledWorkBlocks.id, blockId));
      held = f.holdDeletion(); f.loseDeleteResponse(); active = f.sync();
      expect(await Promise.race([held.started.then(() => true), active.then(() => false)])).toBe(true);
      const pending = await f.receipts();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ externalId, syncStatus: "synced", resourceId: blockId });
      held.release(); await expect(active).rejects.toMatchObject({ status: 502, message: "The integration provider could not complete the request. Try again later." });
      expect((await f.receipts())[0].syncStatus).toBe("synced");
      expect((await f.sync()).removed).toBe(1);
      expect((await f.receipts())[0].syncStatus).toBe("deleted");
      expect(f.calls.filter(call => call.startsWith("DELETE "))).toHaveLength(1);
    } finally { held?.release(); await Promise.allSettled(active ? [active] : []); await f.cleanup(); }
  });

  test("reconnect resets prior sync evidence and JSONB config CAS blocks late results for changed settings", async () => {
    const f = await fixture();
    try {
      await db.update(schema.integrationConnections).set({ lastSyncedAt: new Date("2026-01-01T12:00:00Z") }).where(eq(schema.integrationConnections.id, f.connectionId));
      const reconnected = await f.reconnect();
      expect(reconnected.lastSyncedAt).toBeNull();
      const currentConfig = { ...reconnected.config, calendarId: "new-calendar", importBusy: false };
      await db.update(schema.integrationConnections).set({ config: currentConfig, lastSyncedAt: null, lastError: null, status: "connected" }).where(eq(schema.integrationConnections.id, f.connectionId));
      await expect(f.finishSnapshot("success", reconnected)).rejects.toMatchObject({ status: 409 });
      await f.finishSnapshot("error", reconnected);
      expect(await f.connection()).toMatchObject({ config: currentConfig, status: "connected", lastSyncedAt: null, lastError: null });
      await f.sync();
      expect((await f.connection()).lastSyncedAt).not.toBeNull();
    } finally { await f.cleanup(); }
  });
});

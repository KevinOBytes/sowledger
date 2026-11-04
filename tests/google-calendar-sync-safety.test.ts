import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { errorFixture } from "./helpers/error-boundary-fixtures";

type Row = Record<string, unknown>;
type Event = { id: string; etag?: string; summary?: string; description?: string; status?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private: Record<string, string> } };
type Page = { kind?: string; items?: Event[]; nextPageToken?: string; timeZone?: string };
type TableName = "scheduledWorkBlocks" | "integrationConnections" | "integrationSyncRecords";
type Column = { key: string; read?: (row: Row) => unknown };
type Table = { name: TableName } & Record<string, Column>;
type Condition = (row: Row) => boolean;
const root = process.cwd();
const workspaceId = "calendar-workspace";
const connectionId = "calendar-connection";
const connectionGeneration = "calendar-generation-a";
const windowStart = new Date("2026-01-01T00:00:00Z");
const windowEnd = new Date("2026-02-01T00:00:00Z");
const timed = (id: string): Event => ({ id, summary: `External ${id}`, description: "Original provider notes", start: { dateTime: "2026-01-12T10:00:00Z" }, end: { dateTime: "2026-01-12T11:00:00Z" } });
const schema = Object.fromEntries(["scheduledWorkBlocks", "integrationConnections", "integrationSyncRecords"].map((name) => [name, new Proxy({ name }, {
  get(target, key: string) { return key === "name" ? target.name : { key }; },
})])) as Record<TableName, Table>;

function fixture(options: { syncScheduled?: boolean; importBusy?: boolean } = {}) {
  const rows: Record<TableName, Row[]> = {
    scheduledWorkBlocks: [], integrationSyncRecords: [],
    integrationConnections: [{ id: connectionId, workspaceId, provider: "google_calendar", createdByUserId: "calendar-owner", status: "connected", tokenExpiresAt: new Date(Date.now() + 3600000), credentials: { accessToken: "isolated-fixture-token-not-a-credential", refreshToken: "fixture-refresh-not-a-credential" }, config: { connectionGeneration, calendarId: "primary", syncScheduled: options.syncScheduled ?? true, importBusy: options.importBusy ?? true } }],
  };
  let synced = 0;
  let errors = 0;
  let failRecordWrite = false;
  let failDeletedReceipt = false;
  const events = new Map<string, Event>();
  const gone = new Map<string, string>();
  const calls: Array<{ method: string; pathname: string; query: URLSearchParams; body?: unknown; signal?: AbortSignal | null; ifMatch: string | null }> = [];
  let pages: Array<Page | Error> | undefined;
  let pageFunction: ((token: string | null) => Page) | undefined;
  let snapshotPause: { ready: () => void; released: Promise<void> } | undefined;
  let advisoryLocked = false;
  let loseCreateResponse = false;
  let loseDeleteResponse = false;
  let beforeModification: ((id: string) => void) | undefined;
  let beforeRefreshResponse: (() => void) | undefined;
  let beforeConnectionWrite: (() => void) | undefined;
  let beforeRecordWrite: (() => void) | undefined;

  function select() {
    let table: Table;
    let condition: Condition = () => true;
    const builder = {
      from(value: Table) { table = value; return builder; },
      where(value: Condition) { condition = value; return builder; },
      for() { return builder; },
      then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(rows[table.name].filter(condition).map((row) => structuredClone(row))).then(resolve, reject);
      },
    };
    return builder;
  }
  const operations = {
    select,
    insert(table: Table) {
      return { values(value: Row) {
        let conflict: { target: Column[]; set: Row } | undefined;
        let ignoreConflict = false;
        const builder = {
          onConflictDoNothing(value: { target: Column[] }) { conflict = { target: value.target, set: {} }; ignoreConflict = true; return builder; },
          onConflictDoUpdate(value: typeof conflict) { conflict = value; return builder; }, async returning() {
        if (table.name === "integrationSyncRecords" && beforeRecordWrite) { const callback = beforeRecordWrite; beforeRecordWrite = undefined; callback(); }
        if (table.name === "integrationSyncRecords" && failRecordWrite) throw new Error("Injected sync-record write failure");
        const existing = conflict ? rows[table.name].find((row) => conflict!.target.every((column) => row[column.key] === value[column.key])) : undefined;
        if (existing) { if (ignoreConflict) return []; Object.assign(existing, structuredClone(conflict!.set)); return [structuredClone(existing)]; }
        const inserted = { status: "planned", linkedTimeEntryId: null, ...structuredClone(value) };
        rows[table.name].push(inserted);
        return [structuredClone(inserted)];
      } }; return builder; } };
    },
    update(table: Table) {
      return { set(value: Row) { return { where(condition: Condition) {
        let execution: Promise<Row[]> | undefined;
        const execute = () => execution ??= Promise.resolve().then(() => {
          if (table.name === "integrationSyncRecords" && value.syncStatus === "deleted" && failDeletedReceipt) throw new Error("Injected deleted receipt failure");
          if (table.name === "integrationConnections" && beforeConnectionWrite) {
            const callback = beforeConnectionWrite; beforeConnectionWrite = undefined; callback();
          }
          return rows[table.name].filter(condition).map((row) => {
          if (table.name === "integrationConnections") {
            if (value.lastSyncedAt) synced++;
            if (value.status === "error") errors++;
          }
          Object.assign(row, structuredClone(value)); return structuredClone(row);
        }); });
        return { returning: execute, then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } };
      } }; } };
    },
  };
  const db = { ...operations, async transaction<T>(callback: (tx: typeof operations) => Promise<T>) {
    const before = structuredClone(rows);
    let acquired = false;
    const tx = { ...operations, async execute() {
      if (advisoryLocked) return { rows: [{ acquired: false }] };
      advisoryLocked = true; acquired = true;
      return { rows: [{ acquired: true }] };
    } };
    try { return await callback(tx); }
    catch (error) {
      // Only local imported-state mutations belong to this transaction. The
      // implementation's external receipts and connection CAS writes are durable.
      if (acquired || !advisoryLocked) {
        rows.scheduledWorkBlocks = before.scheduledWorkBlocks;
        rows.integrationSyncRecords = rows.integrationSyncRecords.filter((record) => (record.metadata as Row)?.direction === "sowledger_to_google")
          .concat(before.integrationSyncRecords.filter((record) => (record.metadata as Row)?.direction !== "sowledger_to_google"));
      }
      throw error;
    } finally { if (acquired) advisoryLocked = false; }
  } };
  const providerFetch = async (raw: string | URL, init?: RequestInit) => {
    const url = new URL(raw);
    assert.ok(["https://www.googleapis.com", "https://oauth2.googleapis.com"].includes(url.origin), "No live provider request is permitted");
    const method = init?.method ?? "GET";
    const body = init?.body && !(init.body instanceof URLSearchParams) ? JSON.parse(String(init.body)) : undefined;
    const ifMatch = new Headers(init?.headers).get("If-Match");
    calls.push({ method, pathname: url.pathname, query: url.searchParams, body, signal: init?.signal, ifMatch });
    if (url.origin === "https://oauth2.googleapis.com") {
      beforeRefreshResponse?.();
      return Response.json({ access_token: "new-fixture-access-not-a-credential", expires_in: 3600 });
    }
    if (method === "GET" && url.pathname.endsWith("/events")) {
      const token = url.searchParams.get("pageToken");
      if (snapshotPause) { const pause = snapshotPause; snapshotPause = undefined; pause.ready(); await pause.released; }
      if (pageFunction) return Response.json({ kind: "calendar#events", ...pageFunction(token) });
      if (pages) {
        const page = pages[token ? Number(token) : 0];
        if (page instanceof Error) throw page;
        return Response.json(Array.isArray(page) ? page : { kind: "calendar#events", ...page });
      }
      return Response.json({ kind: "calendar#events", items: [...events.values()], timeZone: "UTC" });
    }
    if (method === "GET" && url.pathname.includes("/calendarList/")) return Response.json({ error: { message: "Insufficient scope: calendar.events does not grant calendarList.get" } }, { status: 403 });
    if (method === "POST" && url.pathname.endsWith("/events")) {
      const event = { id: `owned-${events.size + 1}`, ...body, etag: '"fixture-v1"' };
      if (events.has(event.id)) return Response.json({ error: { message: "Already exists" } }, { status: 409 });
      events.set(event.id, event);
      if (loseCreateResponse) { loseCreateResponse = false; throw new Error("Injected lost create response"); }
      return Response.json(event);
    }
    if (method === "GET" && url.pathname.includes("/events/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      if (gone.has(id)) return Response.json({ error: { message: "Resource has been deleted", errors: [{ reason: gone.get(id) }] } }, { status: 410 });
      const event = events.get(id);
      return event ? Response.json(event) : Response.json({ error: { message: "Not found" } }, { status: 404 });
    }
    if (["PATCH", "DELETE"].includes(method) && url.pathname.includes("/events/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      if (beforeModification) { const callback = beforeModification; beforeModification = undefined; callback(id); }
      const current = events.get(id);
      if (current?.status === "cancelled") return Response.json({ error: { message: "Resource has been deleted", errors: [{ reason: "deleted" }] } }, { status: 410 });
      if (!current) return Response.json({ error: { message: "Not found" } }, { status: 404 });
      if (ifMatch && ifMatch !== current.etag) return Response.json({ error: { message: "Precondition Failed" } }, { status: 412 });
      if (method === "DELETE") {
        events.set(id, { id, status: "cancelled", etag: '"fixture-deleted"' });
        if (loseDeleteResponse) { loseDeleteResponse = false; throw new Error("Injected lost delete response"); }
        return new Response(null, { status: 204 });
      }
      const event = { ...current, ...body, id, etag: `${current.etag}-next` };
      events.set(id, event);
      return Response.json(event);
    }
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  };
  const safe = errorFixture();
  const modules: Record<string, unknown> = {
    "@/lib/workflow-validation": safe.workflow, "@/lib/security": safe.security,
    "@/lib/db": { db }, "@/lib/db/schema": schema,
    "@/lib/env": { env: { GOOGLE_CALENDAR_CLIENT_ID: "fixture-client-id", GOOGLE_CALENDAR_CLIENT_SECRET: "fixture-client-secret-not-a-credential" } },
    "@/lib/integrations/crypto": { decryptSecret: (value: string) => value, encryptSecret: (value: string) => value },
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "node:crypto": { createHash },
    "next/server": { NextRequest, NextResponse },
    "@/lib/auth": { requireSession: async () => ({ workspaceId, sub: "operator", role: "manager" }), requireRole: () => undefined },
    "@/lib/integrations/quickbooks": {}, "@/lib/integrations/slack": {},
    "drizzle-orm": {
      eq: (column: Column, value: unknown): Condition => (row) => isDeepStrictEqual(column.read ? column.read(row) : row[column.key], value),
      ne: (column: Column, value: unknown): Condition => (row) => row[column.key] !== value,
      gte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) >= value,
      gt: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) > value,
      lte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) <= value,
      lt: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) < value,
      inArray: (column: Column, values: unknown[]): Condition => (row) => values.includes(row[column.key]),
      and: (...conditions: Condition[]): Condition => (row) => conditions.every((condition) => condition(row)),
      sql: (parts: TemplateStringsArray) => parts.join("").includes("connectionGeneration")
        ? { key: "generation", read: (row: Row) => (row.config as Row).connectionGeneration ?? null }
        : { advisory: true },
    },
  };
  function load(filename: string): unknown {
    const code = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", "fetch", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      assert.ok(["@/lib/scheduled-block-guards", "@/lib/integrations/connections", "@/lib/integrations/errors"].includes(specifier), `Unexpected real dependency: ${specifier}`);
      return modules[specifier] = load(`${specifier.slice(2)}.ts`);
    }, loadedModule, loadedModule.exports, providerFetch);
    return loadedModule.exports;
  }
  const implementation = load("lib/integrations/google-calendar.ts") as { testGoogleCalendarConnection: (workspaceId: string) => Promise<boolean>; syncGoogleCalendar: (input: Row) => Promise<Row>; storeGoogleCalendarConnection: (input: Row) => Promise<Row>; ensureGoogleAccessToken: (connection: Row) => Promise<string> };
  const connectionHelpers = modules["@/lib/integrations/connections"] as {
    upsertIntegrationConnection: (input: Row) => Promise<Row>;
    markIntegrationSynced: (connection: Row) => Promise<Row>;
    markIntegrationError: (connection: Row, kind: "upstream" | "unexpected") => Promise<Row>;
  };
  return {
    events, calls, gone,
    get rows() { return rows; },
    get localState() { return { scheduledWorkBlocks: rows.scheduledWorkBlocks, integrationSyncRecords: rows.integrationSyncRecords }; },
    get synced() { return synced; },
    get errors() { return errors; },
    pages(value: Array<Page | Error>) { pages = value; },
    pageFunction(value: (token: string | null) => Page) { pageFunction = value; },
    failRecordWrite(value = true) { failRecordWrite = value; },
    failDeletedReceipt(value = true) { failDeletedReceipt = value; },
    loseCreateResponse() { loseCreateResponse = true; },
    loseDeleteResponse() { loseDeleteResponse = true; },
    beforeModification(callback: (id: string) => void) { beforeModification = callback; },
    beforeRefreshResponse(callback: () => void) { beforeRefreshResponse = callback; },
    beforeConnectionWrite(callback: () => void) { beforeConnectionWrite = callback; },
    beforeRecordWrite(callback: () => void) { beforeRecordWrite = callback; },
    async configure(body: Row) {
      const handler = (load("app/api/integrations/[provider]/config/route.ts") as { PATCH: (request: NextRequest, context: { params: Promise<{ provider: string }> }) => Promise<Response> }).PATCH;
      return handler(new NextRequest("https://sowledger.example/api/integrations/google_calendar/config", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ provider: "google_calendar" }) });
    },
    refresh: () => implementation.ensureGoogleAccessToken(structuredClone(rows.integrationConnections[0])),
    store: (token: Row, userId = "new-connector") => implementation.storeGoogleCalendarConnection({ workspaceId, userId, token, existingRefreshToken: "old-account-refresh-not-a-credential" }),
    upsertConnection: (updates: Row, provider = "google_calendar") => connectionHelpers.upsertIntegrationConnection({ workspaceId, provider, createdByUserId: "calendar-owner", ...updates }),
    finishSnapshot: (kind: "success" | "error", snapshot = structuredClone(rows.integrationConnections[0])) => kind === "success"
      ? connectionHelpers.markIntegrationSynced(snapshot)
      : connectionHelpers.markIntegrationError(snapshot, "unexpected"),
    holdSnapshot() {
      let ready!: () => void; let release!: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      snapshotPause = { ready, released };
      return { started, release };
    },
    probe: () => implementation.testGoogleCalendarConnection(workspaceId),
    sync: (start = windowStart, end = windowEnd) => implementation.syncGoogleCalendar({ workspaceId, userId: "operator", start, end }),
    block(id: string, overrides: Row = {}) {
      const block = { id, workspaceId, userId: "calendar-owner", title: `Work ${id}`, notes: "Owned work notes", tags: [], status: "planned", startsAt: new Date("2026-01-12T10:00:00Z"), endsAt: new Date("2026-01-12T11:00:00Z"), ...overrides };
      rows.scheduledWorkBlocks.push(block);
      return block;
    },
    link(resourceId: string, externalId: string, overrides: Row = {}) {
      const record = { id: crypto.randomUUID(), workspaceId, connectionId, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId, externalId, syncStatus: "synced", metadata: { direction: "google_busy_to_sowledger", calendarId: "primary", connectionGeneration }, ...overrides };
      rows.integrationSyncRecords.push(record);
      return record;
    },
  };
}

test("connection probe works with the already-requested calendar.events permission", async () => {
  const f = fixture();
  assert.equal(await f.probe(), true);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].pathname.endsWith("/calendars/primary/events"));
  assert.equal(f.calls[0].method, "GET");
});

test("a second sync never writes imported busy events back to Google or changes original provider content", async () => {
  const f = fixture();
  const external = timed("external-a");
  f.events.set(external.id, external);
  await f.sync();
  assert.equal(f.rows.scheduledWorkBlocks.length, 1);
  await f.sync();
  assert.equal(f.rows.scheduledWorkBlocks.length, 1);
  assert.deepEqual(f.events.get(external.id), external);
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
  assert.deepEqual(f.rows.integrationSyncRecords[0].metadata, { direction: "google_busy_to_sowledger", calendarId: "primary", connectionGeneration });
});

test("unavailable blocks and imported records with edited tags are never exported, while owned plans still sync", async () => {
  const f = fixture();
  f.block("unavailable", { tags: ["unavailable"] });
  f.block("imported-tags-cleared");
  f.link("imported-tags-cleared", "external-a");
  f.block("owned-plan");
  f.events.set("external-a", timed("external-a"));
  await f.sync();
  const writes = f.calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { summary: string }).summary, "Work owned-plan");
  assert.equal(writes[0].method, "POST");
});

test("pagination imports every page including an empty middle page", async () => {
  const f = fixture({ syncScheduled: false });
  f.pages([{ items: [timed("a")], nextPageToken: "1", timeZone: "UTC" }, { items: [], nextPageToken: "2", timeZone: "UTC" }, { items: [timed("b")], timeZone: "UTC" }]);
  const result = await f.sync();
  assert.equal(result.imported, 2);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.rows.integrationSyncRecords.map((record) => record.externalId).sort(), ["a", "b"]);
});

test("complete snapshots cancel deleted, moved-away and newly transparent imported busy time only within their calendar/window", async () => {
  const f = fixture({ syncScheduled: false });
  for (const id of ["deleted", "moved", "free", "present", "outside", "other-calendar", "legacy"]) {
    f.block(id, { tags: ["external-calendar", "unavailable"], ...(id === "outside" ? { startsAt: new Date("2025-12-01T10:00:00Z"), endsAt: new Date("2025-12-01T11:00:00Z") } : {}) });
    f.link(id, id, id === "other-calendar" ? { metadata: { direction: "google_busy_to_sowledger", calendarId: "different" } } : id === "legacy" ? { metadata: { direction: "google_busy_to_sowledger" } } : {});
  }
  f.pages([{ items: [{ id: "deleted", status: "cancelled" }, { ...timed("free"), transparency: "transparent" }, timed("present")], timeZone: "UTC" }]);
  await f.sync();
  for (const id of ["deleted", "moved", "free"]) {
    assert.equal(f.rows.scheduledWorkBlocks.find((block) => block.id === id)!.status, "canceled", id);
    assert.equal(f.rows.integrationSyncRecords.find((record) => record.resourceId === id)!.syncStatus, "deleted", id);
  }
  for (const id of ["present", "outside", "other-calendar", "legacy"]) assert.equal(f.rows.scheduledWorkBlocks.find((block) => block.id === id)!.status, "planned", id);
});

test("failed or malformed later pages preserve the entire previous busy snapshot", async () => {
  for (const failure of [new Error("Provider unavailable"), { items: "not-an-array" } as unknown as Page, { kind: undefined }, [] as unknown as Page]) {
    const f = fixture({ syncScheduled: false });
    f.block("existing", { tags: ["external-calendar", "unavailable"] });
    f.link("existing", "existing");
    const before = structuredClone(f.localState);
    f.pages([{ items: [timed("new-event")], nextPageToken: "1", timeZone: "UTC" }, failure]);
    await assert.rejects(f.sync());
    assert.deepEqual(f.localState, before);
    assert.equal(f.synced, 0);
    assert.equal(f.errors, 1);
  }
});

test("a documented empty event page may omit items without being mistaken for an invalid response", async () => {
  const f = fixture({ syncScheduled: false });
  f.block("existing", { tags: ["external-calendar", "unavailable"] });
  f.link("existing", "existing");
  f.pages([{ timeZone: "UTC" }]);
  const result = await f.sync();
  assert.equal(result.canceled, 1);
  assert.equal(f.rows.scheduledWorkBlocks[0].status, "canceled");
});

test("repeated pagination tokens and an excessive page count fail explicitly without reconciliation", async () => {
  for (const repeated of [true, false]) {
    const f = fixture({ syncScheduled: false });
    f.block("existing", { tags: ["external-calendar", "unavailable"] });
    f.link("existing", "existing");
    const before = structuredClone(f.localState);
    f.pageFunction((token) => ({ items: [], timeZone: "UTC", nextPageToken: repeated ? "again" : String(Number(token ?? 0) + 1) }));
    await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === (repeated ? 502 : 409) && (error as Error).message === (repeated ? "The integration provider returned an incomplete or invalid response. Review the integration before trying again." : "Google Calendar page limit exceeded. Use a smaller sync date range."));
    assert.deepEqual(f.localState, before);
    assert.ok(f.calls.length <= 40);
    assert.equal(f.synced, 0);
  }
});

test("all-day events follow the calendar timezone and exclusive end across DST", async () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "UTC"; // The provider's zone must win over the server's zone.
  try {
    for (const scenario of [
      { start: "2026-03-08", end: "2026-03-09", expectedStart: "2026-03-08T05:00:00.000Z", expectedEnd: "2026-03-09T04:00:00.000Z" },
      { start: "2026-11-01", end: "2026-11-02", expectedStart: "2026-11-01T04:00:00.000Z", expectedEnd: "2026-11-02T05:00:00.000Z" },
    ]) {
      const f = fixture({ syncScheduled: false });
      f.pages([{ items: [{ id: "all-day", start: { date: scenario.start }, end: { date: scenario.end } }], timeZone: "America/New_York" }]);
      await f.sync(new Date(`${scenario.start}T00:00:00Z`), new Date(`${scenario.end}T12:00:00Z`));
      const block = f.rows.scheduledWorkBlocks[0];
      assert.equal((block.startsAt as Date).toISOString(), scenario.expectedStart);
      assert.equal((block.endsAt as Date).toISOString(), scenario.expectedEnd);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("transparent events never become unavailable work and malformed busy dates block reconciliation", async () => {
  const f = fixture({ syncScheduled: false });
  f.pages([{ items: [{ ...timed("free"), transparency: "transparent" }], timeZone: "UTC" }]);
  await f.sync();
  assert.equal(f.rows.scheduledWorkBlocks.length, 0);
  f.block("existing", { tags: ["external-calendar", "unavailable"] });
  f.link("existing", "existing");
  const before = structuredClone(f.localState);
  f.pages([{ items: [{ ...timed("bad-date"), start: { dateTime: "bad-date" } }], timeZone: "UTC" }]);
  await assert.rejects(f.sync());
  assert.deepEqual(f.localState, before);
});

test("local record-write failure rolls back imported blocks and does not clear existing availability", async () => {
  const f = fixture({ syncScheduled: false });
  f.block("existing", { tags: ["external-calendar", "unavailable"] });
  f.link("existing", "existing");
  const before = structuredClone(f.localState);
  f.events.set("new", timed("new"));
  f.failRecordWrite();
  await assert.rejects(f.sync(), /sync-record write failure/);
  assert.deepEqual(f.localState, before);
});

test("legacy and different-calendar links stay untouched rather than guessing an event's identity", async () => {
  const f = fixture();
  for (const id of ["legacy-import", "legacy-export", "other-calendar"]) {
    f.block(id, { tags: id === "legacy-export" ? [] : ["external-calendar", "unavailable"] });
    f.link(id, id, { metadata: id === "other-calendar" ? { direction: "google_busy_to_sowledger", calendarId: "different" } : { direction: id === "legacy-export" ? "sowledger_to_google" : "google_busy_to_sowledger" } });
    f.events.set(id, timed(id));
  }
  const before = structuredClone(f.localState);
  const result = await f.sync();
  assert.deepEqual(f.localState, before);
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
  assert.ok(Number(result.skipped) >= 3);
});

test("known owned events retain their identity and receive later plan edits", async () => {
  const f = fixture();
  f.block("owned");
  await f.sync();
  const externalId = String(f.rows.integrationSyncRecords[0].externalId);
  f.rows.scheduledWorkBlocks[0].title = "Updated owned plan";
  f.rows.scheduledWorkBlocks[0].notes = "Updated owned notes";
  const result = await f.sync();
  assert.equal(result.updated, 1);
  assert.equal(result.imported, 0);
  assert.equal(f.rows.integrationSyncRecords.length, 1);
  assert.equal(f.rows.integrationSyncRecords[0].externalId, externalId);
  assert.equal(f.events.get(externalId)!.summary, "Updated owned plan");
  assert.ok(f.events.get(externalId)!.description!.includes("Updated owned notes"));
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
});

test("a canceled imported event can become busy again without creating a duplicate block", async () => {
  const f = fixture({ syncScheduled: false });
  f.block("restored", { status: "canceled", tags: ["external-calendar", "unavailable"] });
  f.link("restored", "restored", { syncStatus: "deleted" });
  f.events.set("restored", timed("restored"));
  await f.sync();
  assert.equal(f.rows.scheduledWorkBlocks.length, 1);
  assert.equal(f.rows.scheduledWorkBlocks[0].status, "planned");
  assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
});

test("failed snapshot reads happen before owned-event writes and invalid ranges make no provider calls", async () => {
  const f = fixture();
  f.block("owned");
  f.pages([new Error("Provider unavailable")]);
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
  const invalid = fixture();
  await assert.rejects(invalid.sync(windowEnd, windowStart), /date range/i);
  assert.equal(invalid.calls.length, 0);
});

test("oversized snapshots fail without importing or reconciling any records", async () => {
  const f = fixture({ syncScheduled: false });
  f.block("existing", { tags: ["external-calendar", "unavailable"] });
  f.link("existing", "existing");
  const before = structuredClone(f.localState);
  f.pages([{ items: Array.from({ length: 10001 }, (_, index) => timed(`event-${index}`)), timeZone: "UTC" }]);
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 409 && /limit/i.test((error as Error).message));
  assert.deepEqual(f.localState, before);
});

test("overlapping sync is rejected before provider reads without marking the active connection errored", async () => {
  const f = fixture({ syncScheduled: false });
  const held = f.holdSnapshot();
  const first = f.sync();
  await held.started;
  try {
    await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 409);
    assert.equal(f.calls.length, 1);
    assert.equal(f.errors, 0);
  } finally { held.release(); await first; }
  f.events.set("later-event", timed("later-event"));
  await f.sync();
  assert.equal(f.rows.scheduledWorkBlocks[0].status, "planned", "a later successful sync starts after the previous snapshot is committed");
});

test("reconnecting rotates account generation and attributes new busy time to the new connector", async () => {
  const f = fixture({ syncScheduled: false });
  const saved = await f.store({ access_token: "new-access-fixture", refresh_token: "new-refresh-fixture", expires_in: 3600 });
  const generation = (saved.config as Row).connectionGeneration;
  assert.equal(typeof generation, "string");
  assert.notEqual(generation, connectionGeneration);
  assert.equal(saved.createdByUserId, "new-connector");
  assert.equal((saved.credentials as Row).refreshToken, "new-refresh-fixture");
  f.events.set("new-account-event", timed("new-account-event"));
  await f.sync();
  assert.equal(f.rows.scheduledWorkBlocks[0].userId, "new-connector");
});

test("a reconnect without a new refresh token cannot combine accounts or alter the previous connection", async () => {
  const f = fixture();
  const before = structuredClone(f.rows.integrationConnections);
  await assert.rejects(f.store({ access_token: "new-access-fixture", expires_in: 3600 }), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider returned an incomplete or invalid response. Review the integration before trying again.");
  assert.deepEqual(f.rows.integrationConnections, before);
});

test("old-generation and unversioned links are never adopted, exported or canceled after reconnect", async () => {
  const f = fixture();
  for (const [id, generation] of [["old-busy", "older-generation"], ["unknown-busy", undefined], ["old-owned", "older-generation"]]) {
    f.block(id!, { tags: id === "old-owned" ? [] : ["external-calendar", "unavailable"] });
    f.link(id!, id!, { metadata: { direction: id === "old-owned" ? "sowledger_to_google" : "google_busy_to_sowledger", calendarId: "primary", ...(generation ? { connectionGeneration: generation } : {}) } });
    if (id !== "unknown-busy") f.events.set(id!, timed(id!));
  }
  const before = structuredClone(f.localState);
  const result = await f.sync();
  assert.deepEqual(f.localState, before);
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
  assert.equal(result.skipped, 3);
});

test("an in-flight refresh cannot resurrect a disconnected or reconnected account", async () => {
  for (const disconnected of [true, false]) {
    const f = fixture();
    f.rows.integrationConnections[0].tokenExpiresAt = new Date(0);
    f.beforeRefreshResponse(() => {
      const connection = f.rows.integrationConnections[0];
      connection.status = disconnected ? "disabled" : "connected";
      connection.credentials = disconnected ? {} : { accessToken: "replacement-account-access", refreshToken: "replacement-account-refresh" };
      if (!disconnected) connection.config = { ...(connection.config as Row), connectionGeneration: "replacement-generation" };
    });
    await assert.rejects(f.refresh(), /changed|reconnect|disconnect/i);
    const connection = f.rows.integrationConnections[0];
    assert.equal(connection.status, disconnected ? "disabled" : "connected");
    assert.deepEqual(connection.credentials, disconnected ? {} : { accessToken: "replacement-account-access", refreshToken: "replacement-account-refresh" });
  }
});

test("a reconnect during snapshot reading prevents old local writes and status updates", async () => {
  const f = fixture({ syncScheduled: false });
  const held = f.holdSnapshot();
  const syncing = f.sync();
  await held.started;
  f.rows.integrationConnections[0].config = { ...(f.rows.integrationConnections[0].config as Row), connectionGeneration: "replacement-generation" };
  f.rows.integrationConnections[0].status = "disabled";
  held.release();
  await assert.rejects(syncing, /changed|reconnect|disconnect/i);
  assert.equal(f.rows.integrationConnections[0].status, "disabled");
  assert.equal(f.errors, 0);
  assert.equal(f.rows.scheduledWorkBlocks.length, 0);
});

test("export retry after provider success and local receipt failure never creates a second event", async () => {
  const f = fixture({ importBusy: false });
  f.block("owned");
  f.failRecordWrite();
  await assert.rejects(f.sync(), /sync-record write failure/);
  assert.equal(f.events.size, 1);
  f.failRecordWrite(false);
  await f.sync();
  assert.equal(f.events.size, 1);
  assert.equal(f.rows.integrationSyncRecords.length, 1);
  const event = [...f.events.values()][0];
  assert.match(event.id, /^[a-v0-9]{5,1024}$/);
  assert.equal(event.extendedProperties?.private.sowledgerWorkspaceId, workspaceId);
  assert.equal(event.extendedProperties?.private.sowledgerBlockId, "owned");
});

test("a lost create response is recovered by stable provider identity on retry", async () => {
  const f = fixture({ importBusy: false });
  f.block("owned");
  f.loseCreateResponse();
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  await f.sync();
  assert.equal(f.events.size, 1);
  assert.equal(f.rows.integrationSyncRecords.length, 1);
});

test("a conflicting provider event with different private ownership is never adopted or patched", async () => {
  const f = fixture({ importBusy: false });
  f.block("owned");
  f.failRecordWrite();
  await assert.rejects(f.sync());
  const [id, event] = [...f.events][0];
  f.events.set(id, { ...event, summary: "Do not overwrite", extendedProperties: { private: { sowledgerWorkspaceId: "different-workspace", sowledgerBlockId: "different-block" } } });
  f.failRecordWrite(false);
  await assert.rejects(f.sync(), /ownership|belongs|identity/i);
  assert.equal(f.events.size, 1);
  assert.equal(f.events.get(id)!.summary, "Do not overwrite");
  assert.equal(f.rows.integrationSyncRecords.length, 0);
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 0);
});

test("every provider request is bounded and a sync deadline stops further pagination", async () => {
  const f = fixture({ syncScheduled: false });
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  f.pageFunction((token) => {
    if (!token) { now += 120_000; return { items: [], timeZone: "UTC", nextPageToken: "1" }; }
    return { items: [], timeZone: "UTC" };
  });
  try {
    await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 504 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].signal instanceof AbortSignal);
  } finally { Date.now = originalNow; }
});

test("stale Google settings cannot restore a prior generation over a reconnected or disabled account", async () => {
  for (const disconnected of [true, false]) {
    const f = fixture();
    f.beforeConnectionWrite(() => {
      const connection = f.rows.integrationConnections[0];
      connection.status = disconnected ? "disabled" : "connected";
      connection.config = { ...(connection.config as Row), connectionGeneration: "new-account-generation", calendarId: "new-account-calendar" };
      connection.credentials = disconnected ? {} : { accessToken: "new-account-token-fixture" };
    });
    const response = await f.configure({ calendarId: "old-calendar", syncScheduled: false });
    assert.equal(response.status, 409);
    assert.equal((f.rows.integrationConnections[0].config as Row).connectionGeneration, "new-account-generation");
    assert.equal((f.rows.integrationConnections[0].config as Row).calendarId, "new-account-calendar");
    assert.equal(f.rows.integrationConnections[0].status, disconnected ? "disabled" : "connected");
  }
});

test("current Google settings can change normal fields but not the account generation or expose tokens", async () => {
  const f = fixture();
  const response = await f.configure({ calendarId: "work-calendar", syncScheduled: false, importBusy: true, connectionGeneration: "client-forged-generation" });
  assert.equal(response.status, 200);
  assert.deepEqual(f.rows.integrationConnections[0].config, { calendarId: "work-calendar", syncScheduled: false, importBusy: true, connectionGeneration });
  assert.equal((await response.json()).connection.credentials, undefined);
});

test("canceling or skipping an owned export conditionally removes only its proven Google event", async () => {
  for (const status of ["canceled", "skipped"]) {
    const f = fixture({ importBusy: false }); f.block("owned");
    await f.sync();
    const receipt = f.rows.integrationSyncRecords[0]; const externalId = String(receipt.externalId);
    f.rows.scheduledWorkBlocks[0].status = status;
    const result = await f.sync();
    assert.equal(result.removed, 1);
    assert.equal(result.canceled, 0);
    assert.equal(f.events.get(externalId)!.status, "cancelled");
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "deleted");
    assert.equal(f.calls.find((call) => call.method === "DELETE")!.ifMatch, '"fixture-v1"');
    assert.equal((await f.sync()).removed, 0, "confirmed deletion is not counted again");
  }
});

test("cancellation never touches imported, legacy, different-account, different-calendar or out-of-window events", async () => {
  const f = fixture({ importBusy: false });
  for (const id of ["imported", "legacy", "generation", "calendar", "connection", "outside", "other-workspace", "other-provider"]) {
    f.block(id, { status: "canceled", ...(id === "outside" ? { startsAt: new Date("2025-12-01T10:00:00Z"), endsAt: new Date("2025-12-01T11:00:00Z") } : {}) });
    const metadata: Row = { direction: "sowledger_to_google", calendarId: "primary", connectionGeneration };
    if (id === "imported") metadata.direction = "google_busy_to_sowledger";
    if (id === "legacy") delete metadata.connectionGeneration;
    if (id === "generation") metadata.connectionGeneration = "other-generation";
    if (id === "calendar") metadata.calendarId = "other-calendar";
    f.link(id, id, { metadata, ...(id === "connection" ? { connectionId: "other-connection" } : {}), ...(id === "other-workspace" ? { workspaceId: "other-workspace" } : {}), ...(id === "other-provider" ? { provider: "quickbooks" } : {}) });
    f.events.set(id, { ...timed(id), etag: '"fixture-v1"', extendedProperties: { private: { sowledgerWorkspaceId: workspaceId, sowledgerBlockId: id, sowledgerConnectionGeneration: connectionGeneration } } });
  }
  const before = structuredClone(f.localState);
  const result = await f.sync();
  assert.equal(result.removed, 0);
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
  assert.deepEqual(f.localState, before);
});

test("owned-event patch verifies current private ownership and a usable ETag before writing", async () => {
  for (const missing of ["workspace", "block", "generation", "etag"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
    const id = String(f.rows.integrationSyncRecords[0].externalId); const event = f.events.get(id)!;
    if (missing === "etag") delete event.etag;
    else event.extendedProperties!.private[missing === "workspace" ? "sowledgerWorkspaceId" : missing === "block" ? "sowledgerBlockId" : "sowledgerConnectionGeneration"] = "different-owner";
    const before = structuredClone(event);
    f.rows.scheduledWorkBlocks[0].title = "Must not overwrite";
    const result = await f.sync();
    assert.equal(result.skipped, 1, missing);
    assert.deepEqual(f.events.get(id), before, missing);
    assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 0);
  }
});

test("Google edits between verification and PATCH or DELETE produce a warning rather than lost edits", async () => {
  for (const method of ["PATCH", "DELETE"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
    const receipt = f.rows.integrationSyncRecords[0]; const id = String(receipt.externalId);
    if (method === "DELETE") f.rows.scheduledWorkBlocks[0].status = "canceled";
    else f.rows.scheduledWorkBlocks[0].title = "New app title";
    f.beforeModification((eventId) => { Object.assign(f.events.get(eventId)!, { etag: '"provider-edited"', summary: "Keep Google edits" }); });
    const result = await f.sync();
    assert.equal(result.skipped, 1);
    assert.equal(result.removed, 0);
    assert.equal(f.events.get(id)!.summary, "Keep Google edits");
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
    assert.equal(f.calls.find((call) => call.method === method)!.ifMatch, '"fixture-v1"');
  }
});

test("cancellation rejects unproven private ownership or missing ETags and treats a bare404 as ambiguous", async () => {
  for (const kind of ["ownership", "etag", "404", "id"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
    const id = String(f.rows.integrationSyncRecords[0].externalId);
    f.rows.scheduledWorkBlocks[0].status = "canceled";
    if (kind === "ownership") f.events.get(id)!.extendedProperties!.private.sowledgerBlockId = "other";
    if (kind === "etag") delete f.events.get(id)!.etag;
    if (kind === "404") f.events.delete(id);
    if (kind === "id") f.events.get(id)!.id = "different-event";
    const result = await f.sync();
    assert.equal(result.removed, 0, kind);
    assert.equal(result.skipped, 1, kind);
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
    assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 0);
  }
});

test("Google410 confirms absence on retrieval or conditional deletion without a second destructive call", async () => {
  for (const stage of ["read", "delete"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
    const id = String(f.rows.integrationSyncRecords[0].externalId);
    f.rows.scheduledWorkBlocks[0].status = "skipped";
    if (stage === "read") f.gone.set(id, "deleted");
    else f.beforeModification(eventId => { f.events.get(eventId)!.status = "cancelled"; });
    const result = await f.sync();
    assert.equal(result.removed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "deleted");
    assert.equal(f.calls.filter(call => call.method === "DELETE").length, stage === "read" ? 0 : 1);
  }
});

test("an unrelated410 reason cannot be mistaken for confirmed event deletion", async () => {
  const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
  const id = String(f.rows.integrationSyncRecords[0].externalId);
  f.rows.scheduledWorkBlocks[0].status = "canceled";
  f.gone.set(id, "fullSyncRequired");
  await assert.rejects(f.sync());
  assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
  assert.equal(f.calls.filter(call => call.method === "DELETE").length, 0);
});

test("a deleted tombstone repairs a lost deletion response or receipt without deleting again", async () => {
  for (const failure of ["response", "receipt"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
    f.rows.scheduledWorkBlocks[0].status = "canceled";
    if (failure === "response") f.loseDeleteResponse(); else f.failDeletedReceipt();
    await assert.rejects(f.sync(), failure === "response" ? (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later." : /deleted receipt failure/);
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
    f.failDeletedReceipt(false);
    assert.equal((await f.sync()).removed, 1);
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "deleted");
    assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 1);
  }
});

test("restoring a canceled plan uses a fresh stable event identity even if its create response is lost", async () => {
  const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
  const oldId = String(f.rows.integrationSyncRecords[0].externalId);
  f.rows.scheduledWorkBlocks[0].status = "canceled"; await f.sync();
  f.rows.scheduledWorkBlocks[0].status = "planned"; f.loseCreateResponse();
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "deleted");
  const result = await f.sync();
  const restoredId = String(f.rows.integrationSyncRecords[0].externalId);
  assert.notEqual(restoredId, oldId);
  assert.equal(f.events.get(oldId)!.status, "cancelled");
  assert.equal([...f.events.values()].filter((event) => event.status !== "cancelled").length, 1);
  assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
  assert.equal(result.exported, 1);
  assert.equal(f.calls.filter((call) => call.method === "PATCH" && call.pathname.endsWith(oldId)).length, 0);
});

test("restoring before a failed deletion receipt retries can recover proven absence but not a bare404", async () => {
  for (const absence of ["tombstone", "410", "404"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); await f.sync();
    const oldId = String(f.rows.integrationSyncRecords[0].externalId);
    if (absence === "tombstone") {
      f.rows.scheduledWorkBlocks[0].status = "canceled"; f.failDeletedReceipt();
      await assert.rejects(f.sync(), /deleted receipt failure/);
      f.failDeletedReceipt(false); f.rows.scheduledWorkBlocks[0].status = "planned";
    } else {
      f.events.delete(oldId);
      if (absence === "410") f.gone.set(oldId, "deleted");
    }
    const result = await f.sync();
    if (absence === "404") {
      assert.equal(result.skipped, 1);
      assert.equal(f.rows.integrationSyncRecords[0].externalId, oldId);
      assert.equal(f.events.size, 0);
    } else {
      assert.equal(result.exported, 1);
      assert.notEqual(f.rows.integrationSyncRecords[0].externalId, oldId);
      assert.equal([...f.events.values()].filter(event => event.status !== "cancelled").length, 1);
    }
  }
});

test("an initial export with a lost response or receipt can be canceled using only its deterministic proven identity", async () => {
  for (const status of ["canceled", "skipped"]) for (const failure of ["response", "receipt"]) {
    const f = fixture({ importBusy: false }); f.block("owned");
    if (failure === "response") f.loseCreateResponse(); else f.failRecordWrite();
    await assert.rejects(f.sync(), failure === "response" ? (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later." : /sync-record write failure/);
    assert.equal(f.rows.integrationSyncRecords.length, 0);
    const id = [...f.events.keys()][0];
    const unrelated = { ...f.events.get(id)!, id: "unrelated-event-with-similar-content" };
    f.events.set(unrelated.id, unrelated);
    f.failRecordWrite(false); f.rows.scheduledWorkBlocks[0].status = status;
    const result = await f.sync();
    assert.equal(result.removed, 1);
    assert.equal(f.events.get(id)!.status, "cancelled");
    assert.deepEqual(f.events.get(unrelated.id), unrelated);
    assert.equal(f.rows.integrationSyncRecords.length, 1);
    assert.equal(f.rows.integrationSyncRecords[0].externalId, id);
    assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "deleted");
    assert.equal(f.calls.find(call => call.method === "DELETE")!.ifMatch, '"fixture-v1"');
  }
});

test("no-receipt cancellation never adopts an unproven deterministic target or a new account's missing target", async () => {
  for (const mismatch of ["workspace", "block", "generation", "etag", "id", "404", "410", "tombstone", "reconnected"]) {
    const f = fixture({ importBusy: false }); f.block("owned"); f.loseCreateResponse();
    await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
    const id = [...f.events.keys()][0]; const event = f.events.get(id)!;
    if (["workspace", "block", "generation"].includes(mismatch)) {
      event.extendedProperties!.private[mismatch === "workspace" ? "sowledgerWorkspaceId" : mismatch === "block" ? "sowledgerBlockId" : "sowledgerConnectionGeneration"] = "unrelated";
    }
    if (mismatch === "etag") delete event.etag;
    if (mismatch === "id") event.id = "unrelated-id";
    if (mismatch === "404") f.events.delete(id);
    if (mismatch === "410") { f.events.delete(id); f.gone.set(id, "deleted"); }
    if (mismatch === "tombstone") f.events.set(id, { id, status: "cancelled" });
    if (mismatch === "reconnected") (f.rows.integrationConnections[0].config as Row).connectionGeneration = "replacement-generation";
    const before = structuredClone([...f.events]);
    f.rows.scheduledWorkBlocks[0].status = "canceled";
    const result = await f.sync();
    assert.equal(result.removed, 0, mismatch);
    assert.equal(result.skipped, 1, mismatch);
    assert.equal(f.rows.integrationSyncRecords.length, 0, mismatch);
    assert.deepEqual([...f.events], before, mismatch);
    assert.equal(f.calls.filter(call => call.method === "DELETE" || call.method === "PATCH").length, 0);
  }
});

test("recovered ownership proof survives a lost DELETE response and supports a safe retry", async () => {
  const f = fixture({ importBusy: false }); f.block("owned"); f.loseCreateResponse();
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  const id = [...f.events.keys()][0];
  f.rows.scheduledWorkBlocks[0].status = "canceled"; f.loseDeleteResponse();
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  assert.equal(f.rows.integrationSyncRecords.length, 1);
  assert.equal(f.rows.integrationSyncRecords[0].externalId, id);
  assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "synced");
  assert.equal((await f.sync()).removed, 1);
  assert.equal(f.rows.integrationSyncRecords[0].syncStatus, "deleted");
  assert.equal(f.calls.filter(call => call.method === "DELETE").length, 1);
});

test("initial-orphan recovery cannot overwrite an imported receipt inserted after its missing-link read", async () => {
  const f = fixture({ importBusy: false }); f.block("owned"); f.loseCreateResponse();
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  const id = [...f.events.keys()][0];
  f.rows.scheduledWorkBlocks[0].status = "canceled";
  f.beforeRecordWrite(() => { f.link("owned", "provider-imported-event"); });
  const result = await f.sync();
  assert.equal(result.removed, 0);
  assert.equal(f.events.get(id)!.status, undefined);
  assert.equal(f.rows.integrationSyncRecords.length, 1);
  assert.equal(f.rows.integrationSyncRecords[0].externalId, "provider-imported-event");
  assert.equal((f.rows.integrationSyncRecords[0].metadata as Row).direction, "google_busy_to_sowledger");
  assert.equal(f.calls.filter(call => call.method === "DELETE").length, 0);
});

test("a new Google connection generation cannot inherit the previous account's last successful sync", async () => {
  const f = fixture();
  f.rows.integrationConnections[0].lastSyncedAt = new Date("2026-01-01T12:00:00Z");
  const reconnected = await f.store({ access_token: "new-access-fixture", refresh_token: "new-refresh-fixture" });
  assert.equal(reconnected.lastSyncedAt, null);
  assert.notEqual((reconnected.config as Row).connectionGeneration, connectionGeneration);
});

test("connection upserts preserve an omitted last sync but honor an explicitly cleared one", async () => {
  for (const provider of ["google_calendar", "slack", "quickbooks"]) {
    const f = fixture(); const before = new Date("2026-01-01T12:00:00Z");
    Object.assign(f.rows.integrationConnections[0], { provider, lastSyncedAt: before });
    assert.deepEqual((await f.upsertConnection({ lastSyncedAt: undefined }, provider)).lastSyncedAt, before);
    assert.equal((await f.upsertConnection({ lastSyncedAt: null }, provider)).lastSyncedAt, null);
  }
});

test("changed Google calendar or sync options clear stale success while a no-op save preserves it", async () => {
  for (const updates of [{ calendarId: "work-calendar" }, { importBusy: false }, { syncScheduled: false }, {}]) {
    const f = fixture(); const before = new Date("2026-01-01T12:00:00Z");
    f.rows.integrationConnections[0].lastSyncedAt = before;
    const response = await f.configure(updates);
    assert.equal(response.status, 200);
    if (Object.keys(updates).length > 0) assert.equal(f.rows.integrationConnections[0].lastSyncedAt, null);
    else assert.deepEqual(f.rows.integrationConnections[0].lastSyncedAt, before);
  }
});

test("a partial Google settings change does not silently switch the chosen calendar back to primary", async () => {
  const f = fixture();
  (f.rows.integrationConnections[0].config as Row).calendarId = "work-calendar";
  f.rows.integrationConnections[0].lastSyncedAt = new Date("2026-01-01T12:00:00Z");
  assert.equal((await f.configure({ importBusy: false })).status, 200);
  assert.equal((f.rows.integrationConnections[0].config as Row).calendarId, "work-calendar");
  assert.equal(f.rows.integrationConnections[0].lastSyncedAt, null);
});

for (const kind of ["success", "error"] as const) test(`late Google ${kind} cannot overwrite status for changed settings`, async () => {
  for (const changed of [{ calendarId: "work-calendar" }, { importBusy: false }, { syncScheduled: false }]) {
    const f = fixture();
    f.beforeConnectionWrite(() => {
      const current = f.rows.integrationConnections[0];
      current.config = { ...(current.config as Row), ...changed };
      Object.assign(current, { status: "connected", lastSyncedAt: null, lastError: null });
    });
    if (kind === "success") await assert.rejects(f.finishSnapshot(kind), /settings.*changed|changed.*settings/i);
    else await f.finishSnapshot(kind);
    assert.equal(f.rows.integrationConnections[0].lastSyncedAt, null);
    assert.equal(f.rows.integrationConnections[0].lastError, null);
    assert.equal(f.rows.integrationConnections[0].status, "connected");
  }
});

test("Google sync cannot return success when its final status compare-and-set loses to new settings", async () => {
  const f = fixture();
  f.beforeConnectionWrite(() => {
    const current = f.rows.integrationConnections[0];
    current.config = { ...(current.config as Row), calendarId: "changed-after-sync" };
    Object.assign(current, { status: "connected", lastSyncedAt: null, lastError: null });
  });
  await assert.rejects(f.sync(), (error: unknown) => (error as { status?: number }).status === 409);
  assert.equal(f.rows.integrationConnections[0].lastSyncedAt, null);
  assert.equal(f.rows.integrationConnections[0].lastError, null);
});

test("Slack status callbacks retain their existing configuration-independent behavior", async () => {
  const f = fixture(); f.rows.integrationConnections[0].provider = "slack";
  f.beforeConnectionWrite(() => { f.rows.integrationConnections[0].config = { different: "current-settings" }; });
  await f.finishSnapshot("success");
  assert.ok(f.rows.integrationConnections[0].lastSyncedAt instanceof Date);
});

test("QuickBooks status callbacks stamp only the current configuration and credential snapshot", async () => {
  for (const kind of ["success", "error"] as const) {
    const current = fixture();
    current.rows.integrationConnections[0].provider = "quickbooks";
    await current.finishSnapshot(kind);
    assert.equal(current.rows.integrationConnections[0].status, kind === "success" ? "connected" : "error");
    assert.equal(current.synced, kind === "success" ? 1 : 0);
    assert.equal(current.errors, kind === "error" ? 1 : 0);
    if (kind === "success") {
      assert.ok(current.rows.integrationConnections[0].lastSyncedAt instanceof Date);
      assert.equal(current.rows.integrationConnections[0].lastError, null);
    } else {
      assert.equal(typeof current.rows.integrationConnections[0].lastError, "string");
    }

    for (const changed of ["config", "credentials"] as const) {
      const stale = fixture();
      stale.rows.integrationConnections[0].provider = "quickbooks";
      let replacement!: Row;
      stale.beforeConnectionWrite(() => {
        const connection = stale.rows.integrationConnections[0];
        connection[changed] = { different: "current-snapshot" };
        Object.assign(connection, { status: "connected", lastSyncedAt: null, lastError: null });
        replacement = structuredClone(connection);
      });
      if (kind === "success") {
        await assert.rejects(stale.finishSnapshot(kind), (error: unknown) => (error as { status?: number }).status === 409);
      } else {
        await stale.finishSnapshot(kind);
      }
      assert.deepEqual(stale.rows.integrationConnections[0], replacement);
      assert.equal(stale.synced, 0);
      assert.equal(stale.errors, 0);
    }
  }
});

test("a stale Google settings save cannot overwrite another settings change in the same account generation", async () => {
  const f = fixture();
  f.beforeConnectionWrite(() => {
    f.rows.integrationConnections[0].config = { ...(f.rows.integrationConnections[0].config as Row), importBusy: false };
    f.rows.integrationConnections[0].lastSyncedAt = null;
  });
  assert.equal((await f.configure({ syncScheduled: false })).status, 409);
  assert.deepEqual(f.rows.integrationConnections[0].config, { calendarId: "primary", connectionGeneration, importBusy: false, syncScheduled: true });
});

test("token refresh cannot save old settings' status after a same-generation calendar change", async () => {
  const f = fixture(); f.rows.integrationConnections[0].tokenExpiresAt = new Date(0);
  const originalCredentials = structuredClone(f.rows.integrationConnections[0].credentials);
  f.beforeRefreshResponse(() => {
    f.rows.integrationConnections[0].config = { ...(f.rows.integrationConnections[0].config as Row), calendarId: "changed-during-refresh" };
    f.rows.integrationConnections[0].lastSyncedAt = null;
  });
  await assert.rejects(f.refresh(), /changed|disconnected/i);
  assert.deepEqual(f.rows.integrationConnections[0].credentials, originalCredentials);
  assert.equal((f.rows.integrationConnections[0].config as Row).calendarId, "changed-during-refresh");
  assert.equal(f.rows.integrationConnections[0].lastSyncedAt, null);
});

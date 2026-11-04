// Retained reminder-domain doubles share identity with the controlled workflow
// module; actual constructor provenance is covered by integration-error-contract.
const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { NextRequest, NextResponse } from "next/server";

type Row = Record<string, unknown>;
type Column = { key: string };
type Condition = (row: Row) => boolean;
const table = new Proxy({}, { get: (_target, key: string) => ({ key }) });
const linkTable = new Proxy({}, { get: (_target, key: string) => ({ key }) });
const notification = { title: "Fixture notice", body: "Fixture details" };
function compare(left: unknown, right: unknown) {
  const a = left instanceof Date ? left.getTime() : String(left);
  const b = right instanceof Date ? right.getTime() : String(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

function fixture() {
  const rows: Row[] = [];
  const links: Row[] = [];
  const connections = new Map<string, Row>();
  const delivered: string[] = [];
  const payloads: Row[] = [];
  const logs: unknown[][] = [];
  let authorized = true;
  let databaseReads = 0;
  let failRecord = false;
  let failConnectionStatus = false;
  let failProvider = false;
  let failLookup = false;
  const locks = new Set<string>();
  let providerPause: { ready: () => void; released: Promise<void> } | undefined;
  let onFreshRead: (() => void) | undefined;
  let afterProvider: (() => void) | undefined;
  const operations = {
    select() {
      databaseReads++;
      if (databaseReads === 2) onFreshRead?.();
      let condition: Condition = () => true;
      let max = Infinity;
      let selected = rows;
      let order: Column[] = [];
      const builder = {
        from(source: unknown) { selected = source === linkTable ? links : rows; return builder; }, where(value: Condition) { condition = value; return builder; },
        orderBy(...columns: Column[]) { order = columns; return builder; },
        limit(value: number) { max = value; return builder; },
        then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(structuredClone(selected.filter(condition).sort((a, b) => order.reduce((result, column) => result || compare(a[column.key], b[column.key]), 0)).slice(0, max))).then(resolve, reject); },
      };
      return builder;
    },
    update() { return { set(values: Row) { return { where(condition: Condition) {
      const execute = async () => {
        if (failRecord) throw new Error("Injected reminder stamp failure");
        return rows.filter(condition).map((row) => { Object.assign(row, values); return structuredClone(row); });
      };
      return { returning: execute, then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } };
    } }; } }; },
  };
  const db = { ...operations, async transaction<T>(callback: (tx: typeof operations) => Promise<T>) {
    const acquired: string[] = [];
    try {
      return await callback({ ...operations, async execute(query: { workspaceId: string }) {
        if (locks.has(query.workspaceId)) return { rows: [{ acquired: false }] };
        locks.add(query.workspaceId); acquired.push(query.workspaceId);
        return { rows: [{ acquired: true }] };
      } } as typeof operations);
    } finally { for (const workspaceId of acquired) locks.delete(workspaceId); }
  } };
  const modules: Record<string, unknown> = {
    "node:crypto": { createHash },
    "next/server": { NextRequest, NextResponse },
    "@/lib/db": { db },
    "@/lib/db/schema": { scheduledWorkBlocks: table, integrationSyncRecords: linkTable },
    "@/lib/app-url": { getAppOrigin: () => "https://sowledger.example" },
    "@/lib/env": { env: {} },
    "@/lib/auth": authErrors,
    "@/lib/security": { enforceAuthKey: async () => { if (!authorized) throw new authErrors.UnauthorizedError("Unauthorized"); }, validateWebhookUrl: async (value: string) => value },
    "@/lib/integrations/crypto": { decryptSecret: (value: string) => value, encryptSecret: (value: string) => value },
    "@/lib/integrations/connections": {
      getIntegrationConnection: async (workspaceId: string, provider: string) => {
        assert.equal(provider, "slack");
        if (failLookup) throw new Error("Injected provider lookup failure");
        return connections.get(workspaceId) ?? null;
      },
      markIntegrationSynced: async (connection: Row) => { if (failConnectionStatus) throw new Error("Injected status write failure"); connection.status = "connected"; },
      markIntegrationError: async (connection: Row) => { if (failConnectionStatus) throw new Error("Injected status write failure"); connection.status = "error"; },
    },
    "drizzle-orm": {
      eq: (column: Column, value: unknown): Condition => (row) => value instanceof Date && row[column.key] instanceof Date ? (row[column.key] as Date).getTime() === value.getTime() : row[column.key] === value,
      isNull: (column: Column): Condition => (row) => row[column.key] == null,
      gte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) >= value,
      lte: (column: Column, value: Date): Condition => (row) => (row[column.key] as Date) <= value,
      gt: (column: Column, value: unknown): Condition => (row) => compare(row[column.key], value) > 0,
      asc: (column: Column) => column,
      and: (...conditions: Condition[]): Condition => (row) => conditions.every((condition) => condition(row)),
      or: (...conditions: Condition[]): Condition => (row) => conditions.some((condition) => condition(row)),
      sql: (_parts: TemplateStringsArray, workspaceId: string) => ({ workspaceId }),
    },
  };
  const providerFetch = async (raw: string, init?: RequestInit) => {
    assert.ok(raw.startsWith("https://hooks.slack.com/services/fixture-"), "No live provider call is permitted");
    assert.equal(init?.method, "POST");
    if (providerPause) { const pause = providerPause; providerPause = undefined; pause.ready(); await pause.released; }
    if (failProvider) return new Response("fixture_provider_failure", { status: 503 });
    delivered.push(raw.split("/").at(-1)!);
    payloads.push(JSON.parse(String(init?.body)));
    afterProvider?.();
    return new Response("ok");
  };
  function load(filename: string): Record<string, unknown> {
    const code = transformSync(readFileSync(path.join(process.cwd(), filename), "utf8"), { loader: "ts", format: "cjs" }).code;
    const loaded = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", "fetch", "console", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      assert.ok(["@/lib/integrations/notifications", "@/lib/integrations/slack", "@/lib/integrations/errors", "@/lib/scheduled-block-guards", "@/lib/workflow-validation", "@/lib/date-input", "@/lib/time-capacity"].includes(specifier), `Unexpected real dependency: ${specifier}`);
      return modules[specifier] = load(`${specifier.slice(2)}.ts`);
    }, loaded, loaded.exports, providerFetch, { error: (...args: unknown[]) => logs.push(args) });
    return loaded.exports;
  }
  const handler = load("app/api/cron/scheduled-block-reminders/route.ts").GET as (request: NextRequest) => Promise<Response>;
  const dispatch = (modules["@/lib/integrations/notifications"] as { dispatchIntegrationNotification: (workspace: string, event: string, payload: typeof notification) => Promise<unknown> }).dispatchIntegrationNotification;
  return {
    rows, links, connections, delivered, payloads, logs,
    get databaseReads() { return databaseReads; },
    unauthorized() { authorized = false; }, failRecord() { failRecord = true; }, failConnectionStatus() { failConnectionStatus = true; }, failProvider(value = true) { failProvider = value; }, failLookup() { failLookup = true; },
    beforeFreshRead(callback: () => void) { onFreshRead = callback; },
    afterProvider(callback: () => void) { afterProvider = callback; },
    holdProvider() {
      let ready!: () => void; let release!: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      providerPause = { ready, released }; return { started, release };
    },
    dispatch: () => dispatch("workspace", "time_entry.created", notification),
    invoke: () => handler(new NextRequest("https://sowledger.example/api/cron/scheduled-block-reminders")),
    channel(workspaceId = "workspace", overrides: Row = {}) {
      const connection = { id: `connection-${workspaceId}`, workspaceId, provider: "slack", status: "connected", credentials: { webhookUrl: `https://hooks.slack.com/services/fixture-${workspaceId}` }, config: { events: ["*"] }, ...overrides };
      connections.set(workspaceId, connection); return connection;
    },
    block(overrides: Row = {}) {
      const block: Row = { id: crypto.randomUUID(), workspaceId: "workspace", title: "Planned work", notes: null, tags: [], status: "planned", reminderSentAt: null,
        startsAt: new Date(Date.now() + 5 * 60_000), endsAt: new Date(Date.now() + 35 * 60_000), ...overrides };
      rows.push(block); return block;
    },
  };
}

test("OOO, note-marked unavailable time, busy and imported blocks never trigger a reminder", async () => {
  const f = fixture(); f.channel();
  for (const overrides of [
    { title: "OOO" }, { tags: ["ooo"] }, { notes: "Out of office for an appointment" }, { notes: "Unavailable this afternoon" },
    { tags: ["unavailable"] }, { tags: ["external-calendar"] }, { title: "  Busy: External meeting" }, { tags: ["busy"] },
  ]) f.block(overrides);
  f.block({ status: "canceled" }); f.block({ reminderSentAt: new Date() });
  const work = f.block();
  const result = await (await f.invoke()).json();
  assert.equal(result.reminded, 1);
  assert.equal(f.delivered.length, 1);
  assert.ok(work.reminderSentAt instanceof Date);
  assert.equal(f.rows.filter((row) => row.reminderSentAt instanceof Date).length, 2);
});

test("missing, disabled and unsubscribed channels are skipped without a reminder stamp", async () => {
  for (const kind of ["missing", "disabled", "unsubscribed"]) {
    const f = fixture(); const block = f.block();
    if (kind === "disabled") f.channel("workspace", { status: "disabled" });
    if (kind === "unsubscribed") f.channel("workspace", { config: { events: ["invoice.created"] } });
    const result = await (await f.invoke()).json();
    assert.equal(result.reminded, 0, kind);
    assert.equal(result.skipped, 1, kind);
    assert.equal(result.failed, 0, kind);
    assert.equal(block.reminderSentAt, null, kind);
    assert.equal(f.delivered.length, 0);
  }
});

test("provider-owned availability cannot trigger reminders after its editable labels were cleared", async () => {
  const f = fixture(); f.channel();
  const imported = f.block(); const work = f.block();
  f.links.push({ workspaceId: "workspace", provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: imported.id, metadata: { direction: "google_busy_to_sowledger" } });
  // A similarly named resource in another workspace or provider must not suppress local work.
  f.links.push({ workspaceId: "other", provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: work.id, metadata: { direction: "google_busy_to_sowledger" } });
  f.links.push({ workspaceId: "workspace", provider: "quickbooks", resourceType: "scheduled_work_block", resourceId: work.id, metadata: { direction: "google_busy_to_sowledger" } });
  const result = await (await f.invoke()).json();
  assert.equal(result.reminded, 1);
  assert.equal(result.skipped, 1);
  assert.equal(imported.reminderSentAt, null);
  assert.ok(work.reminderSentAt instanceof Date);
});

test("provider failure is not counted or stamped as sent and a recovered channel can retry", async () => {
  const f = fixture(); f.channel(); const block = f.block(); f.failProvider();
  const failed = await (await f.invoke()).json();
  assert.equal(failed.reminded, 0);
  assert.equal(failed.failed, 1);
  assert.equal(block.reminderSentAt, null);
  f.failProvider(false);
  const recovered = await (await f.invoke()).json();
  assert.equal(recovered.reminded, 1);
  assert.ok(f.rows.find((row) => row.id === block.id)?.reminderSentAt instanceof Date);
  assert.equal(f.delivered.length, 1);
});

test("provider acceptance stays truthful even if saving integration status fails", async () => {
  const f = fixture(); f.channel(); const block = f.block(); f.failConnectionStatus();
  const result = await (await f.invoke()).json();
  assert.equal(result.reminded, 1);
  assert.equal(f.delivered.length, 1);
  assert.ok(block.reminderSentAt instanceof Date);
});

test("a failed reminder stamp is distinct from provider rejection after accepted delivery", async () => {
  const f = fixture(); f.channel(); const block = f.block(); f.failRecord();
  const result = await (await f.invoke()).json();
  assert.equal(result.reminded, 1);
  assert.equal(result.recordingFailures, 1);
  assert.equal(result.failed, 0);
  assert.equal(f.delivered.length, 1);
  assert.equal(block.reminderSentAt, null);
});

test("ordinary notifications remain nonblocking and return safe delivery counts", async () => {
  const f = fixture(); f.channel(); f.failProvider();
  assert.deepEqual(await f.dispatch(), { sent: 0, failed: 1, skipped: 0 });
  f.failLookup();
  assert.deepEqual(await f.dispatch(), { sent: 0, failed: 1, skipped: 0 });
});

test("each reminder uses its own workspace channel and unsuccessful workspaces remain unmarked", async () => {
  const f = fixture(); f.channel("one");
  const sent = f.block({ workspaceId: "one" });
  const skipped = f.block({ workspaceId: "two" });
  const result = await (await f.invoke()).json();
  assert.equal(result.reminded, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(f.delivered, ["fixture-one"]);
  assert.ok(sent.reminderSentAt instanceof Date);
  assert.equal(skipped.reminderSentAt, null);
});

test("unauthorized reminder runs perform no database reads or provider requests", async () => {
  const f = fixture(); f.channel(); f.block(); f.unauthorized();
  assert.equal((await f.invoke()).status, 401);
  assert.equal(f.databaseReads, 0);
  assert.equal(f.delivered.length, 0);
});

test("concurrent reminder runs cannot double-dispatch but another workspace can proceed", async () => {
  const f = fixture(); f.channel("one"); f.channel("two");
  f.block({ workspaceId: "one" }); f.block({ workspaceId: "two" });
  const held = f.holdProvider();
  const first = f.invoke();
  await held.started;
  try {
    const second = await (await f.invoke()).json();
    assert.equal(second.reminded, 1);
    assert.equal(second.deferred, 1);
    assert.equal(second.failed, 0);
  } finally { held.release(); await first; }
  assert.deepEqual(f.delivered.sort(), ["fixture-one", "fixture-two"]);
  assert.equal((await (await f.invoke()).json()).reminded, 0);
});

test("the locked recheck observes a block canceled or marked unavailable after candidate selection", async () => {
  for (const updates of [{ status: "canceled" }, { notes: "OOO for the afternoon" }, { startsAt: new Date(Date.now() + 60 * 60_000) }]) {
    const f = fixture(); f.channel(); const block = f.block();
    f.beforeFreshRead(() => Object.assign(block, updates));
    assert.equal((await (await f.invoke()).json()).reminded, 0);
    assert.equal(f.delivered.length, 0);
    assert.equal(block.reminderSentAt, null);
  }
});

test("the run deadline defers remaining work without stamping it", async () => {
  const f = fixture(); f.channel(); const first = f.block({ id: "first" }); const second = f.block({ id: "second" });
  const originalNow = Date.now; let now = originalNow();
  Date.now = () => now;
  f.afterProvider(() => { now += 120_000; });
  try {
    const result = await (await f.invoke()).json();
    assert.equal(result.reminded, 1);
    assert.equal(result.deferred, 1);
    assert.equal(result.hasMore, true);
    assert.ok(first.reminderSentAt instanceof Date);
    assert.equal(second.reminderSentAt, null);
  } finally { Date.now = originalNow; }
});

test("pagination does not starve valid work behind unavailable or unconfigured candidates", async () => {
  const f = fixture(); f.channel();
  const startsAt = new Date(Date.now() + 5 * 60_000);
  for (let index = 0; index < 220; index++) f.block({ id: `a-${String(index).padStart(3, "0")}`, title: "OOO", startsAt });
  for (let index = 0; index < 120; index++) f.block({ id: `b-${String(index).padStart(3, "0")}`, workspaceId: "no-channel", startsAt });
  const valid = f.block({ id: "z-valid", startsAt });
  const result = await (await f.invoke()).json();
  assert.equal(result.reminded, 1);
  assert.equal(result.skipped, 340);
  assert.equal(result.hasMore, false);
  assert.ok(valid.reminderSentAt instanceof Date);
  assert.match(String(f.payloads[0].text), /\bUTC\b/);
});

test("bounded accepted notifications report remaining candidates and the next run progresses", async () => {
  const f = fixture(); f.channel();
  for (let index = 0; index < 101; index++) f.block({ id: `work-${index}` });
  const first = await (await f.invoke()).json();
  assert.equal(first.reminded, 100);
  assert.equal(first.deferred, 1);
  assert.equal(first.hasMore, true);
  const second = await (await f.invoke()).json();
  assert.equal(second.reminded, 1);
  assert.equal(second.hasMore, false);
  assert.equal(f.delivered.length, 101);
});

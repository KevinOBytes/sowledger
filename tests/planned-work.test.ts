/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled actual-source storage boundary. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transformSync } from "esbuild";
import { NextRequest, NextResponse } from "next/server";

function fixture() {
  const schema = new Proxy({}, { get: (_t, name: string) => new Proxy({ name }, { get: (t, key: string) => key === "name" ? t.name : key }) }) as any;
  const rows: Record<string, any[]> = {};
  const match = (op: string) => (key: string, value: any) => (row: any) => op === "eq" ? row[key] === value : op === "gt" ? row[key] > value : op === "gte" ? row[key] >= value : row[key] < value;
  const orm = { eq: match("eq"), gt: match("gt"), gte: match("gte"), lt: match("lt"), and: (...conditions: any[]) => (row: any) => conditions.every(fn => fn(row)), inArray: (key: string, values: any[]) => { assert.ok(values.length <= 1000, "provider identity lookup is bounded"); return (row: any) => values.includes(row[key]); }, desc: () => undefined, sql: (strings: TemplateStringsArray, ...params: any[]) => ({ text: strings.join("?"), params }) };
  let insideTransaction = false, lifecycleLocked = false;
  const reader = (snapshot: typeof rows, transactional = false) => ({ select: () => {
    assert.equal(insideTransaction, transactional, "transactional revenue reads must use the supplied reader, not the global pool");
    if (transactional) assert.equal(lifecycleLocked, true, "financial reads must follow the workspace lock");
    return { from: (table: any) => ({ where: (predicate: any) => Promise.resolve((snapshot[table.name] ?? []).filter(predicate)) }) };
  } });
  const db = {
    ...reader(rows),
    async transaction<T>(callback: (tx: any) => Promise<T>, options: { isolationLevel: string }) {
      assert.equal(insideTransaction, false, "the fixture does not support nested transactions");
      assert.ok(["repeatable read", "serializable"].includes(options.isolationLevel), "financial output requires a consistent snapshot");
      const snapshot = structuredClone(rows);
      insideTransaction = true;
      try {
        return await callback({ ...reader(snapshot, true), execute: async (query: { text: string; params: unknown[] }) => {
          assert.equal(insideTransaction, true);
          assert.match(query.text, /pg_advisory_xact_lock\(hashtextextended\(\?, 0\)\)/);
          assert.deepEqual(query.params, ["invoice-lifecycle:w"]);
          lifecycleLocked = true;
          return { rows: [] };
        } });
      } finally { insideTransaction = false; lifecycleLocked = false; }
    },
  };
  class WorkflowError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
  const deps: Record<string, any> = {
    "drizzle-orm": orm, "next/server": { NextRequest, NextResponse }, "@/lib/db": { db }, "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => {} },
    "@/lib/auth": { requireSession: async () => ({ sub: "u", workspaceId: "w", role: "owner" }), requireRole: () => {}, UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {} },
    "@/lib/workflow-validation": { WorkflowError, workflowErrorResponse: (error: any) => { throw error; }, classifyWorkflowError: (error: any) => { throw error; } },
    "@/lib/api-keys": { authenticateApiKey: async () => ({ workspaceId: "w" }), requireApiScope: () => {}, recordApiKeyRequest: async () => {} },
    "@/lib/security": { appendAuditLog: async () => { throw new Error("This planned-work fixture has no returned financial lines to audit."); } },
  };
  const native = createRequire(path.join(process.cwd(), "package.json"));
  const actual = new Set(["@/lib/planned-work", "@/lib/revenue-intelligence", "@/lib/date-input", "@/lib/scheduled-block-guards", "@/lib/invoice-lifecycle"]);
  function load(id: string): any {
    if (id in deps) return deps[id];
    if (!id.startsWith("@/")) return native(id);
    if (!actual.has(id) && !id.startsWith("@/app/")) return {};
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", transformSync(readFileSync(`${id.slice(2)}.ts`, "utf8"), { loader: "ts", format: "cjs" }).code)(load, loadedModule, loadedModule.exports);
    return deps[id] = loadedModule.exports;
  }
  const plan = (id: string, extra: any = {}) => ({ id, workspaceId: "w", userId: "u", projectId: "p", title: "Work", notes: null, tags: [], status: "planned", startsAt: new Date("2026-01-02T10:00Z"), endsAt: new Date("2026-01-02T11:00Z"), ...extra });
  rows.projects = [{ id: "p", workspaceId: "w", name: "Project", budgetType: "none" }];
  rows.timeEntries = [{ id: "e", workspaceId: "w", userId: "u", projectId: "p", startedAt: new Date("2026-01-02T10:00Z"), durationSeconds: 3600, hourlyRate: 100, source: "manual", status: "invoiced" }];
  rows.scheduledWorkBlocks = [plan("good"), plan("cross", { startsAt: new Date("2026-01-01T23:30Z"), endsAt: new Date("2026-01-02T00:30Z") }), plan("outside", { startsAt: new Date("2026-01-03T10:00Z"), endsAt: new Date("2026-01-03T18:00Z") }), plan("other-project", { projectId: "q" }), plan("other-person", { userId: "v" }), plan("foreign", { workspaceId: "x" }), plan("canceled", { status: "canceled" }), plan("ooo", { tags: ["ooo"] }), plan("busy", { title: "Busy: appointment" }), plan("imported", { title: "Renamed", tags: [] })];
  rows.integrationSyncRecords = [{ workspaceId: "w", provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: "imported", metadata: { direction: "google_busy_to_sowledger" } }];
  return { rows, load };
}

test("I6 actual public analytics applies project/person/date scope and clips eligible plans", async () => {
  const f = fixture();
  const response = await f.load("@/app/api/v1/[resource]/route").GET(new NextRequest("https://fixture.test/api/v1/analytics?projectId=p&userId=u&start=2026-01-02&end=2026-01-02"), { params: Promise.resolve({ resource: "analytics" }) });
  const { analytics: data } = await response.json();
  assert.equal(data.totalHours, 1);
  assert.equal(data.plannedHours, 1.5);
  assert.equal(data.utilization, 2 / 3);
  assert.equal(data.missedBlocks, 2);
});

test("I7 actual revenue helper excludes unavailable/canceled/provider-identified plans", async () => {
  const f = fixture();
  const data = await f.load("@/lib/revenue-intelligence").buildRevenueIntelligence("w", { scope: "mine", userId: "u", projectId: "p", start: "2026-01-02", end: "2026-01-02" });
  assert.deepEqual(data.recoveryOpportunities.filter((item: any) => item.type === "missed_scheduled_work").map((item: any) => item.id).sort(), ["missed-block-cross", "missed-block-good"]);
});

test("I6 native report uses the same eligible clipped selection", async () => {
  const f = fixture();
  const response = await f.load("@/app/api/reports/route").GET(new NextRequest("https://fixture.test/api/reports?scope=mine&projectId=p&start=2026-01-02&end=2026-01-02"));
  const data = await response.json();
  assert.equal(data.plannedHours, 1.5);
  assert.equal(data.totalHours, 1);
  assert.equal(data.missedBlocks, 2);
});

test("I7 native and public revenue consumers keep the same genuine missed blocks", async () => {
  const f = fixture();
  const query = "scope=team&projectId=p&start=2026-01-02&end=2026-01-02";
  const native = await f.load("@/app/api/revenue-intelligence/route").GET(new NextRequest(`https://fixture.test/api/revenue-intelligence?${query}`));
  const publicResponse = await f.load("@/app/api/v1/[resource]/route").GET(new NextRequest(`https://fixture.test/api/v1/revenue-intelligence?${query}`), { params: Promise.resolve({ resource: "revenue-intelligence" }) });
  assert.equal((await native.json()).summary.missedScheduledBlockCount, 3);
  assert.equal((await publicResponse.json()).summary.missedScheduledBlockCount, 3);
});

test("I6/I7 all-time provenance lookup retains exclusions across bounded chunks", async () => {
  const f = fixture();
  const sample = f.rows.scheduledWorkBlocks[0];
  f.rows.scheduledWorkBlocks = Array.from({ length: 2001 }, (_, index) => ({ ...sample, id: String(index) }));
  f.rows.integrationSyncRecords = [0, 999, 1000, 1999, 2000].map(index => ({ workspaceId: "w", provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: String(index), metadata: { direction: "google_busy_to_sowledger" } }));
  const selected = await f.load("@/lib/planned-work").loadEligiblePlannedWork("w");
  assert.equal(selected.length, 1996);
  assert.equal(selected.some((block: any) => ["0", "999", "1000", "1999", "2000"].includes(block.id)), false);
});

import { UnauthorizedError, ForbiddenError, WorkspaceCapacityError } from "../lib/auth";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { NextRequest } from "next/server";

import { requireApiScope } from "../lib/api-keys";
import * as schema from "../lib/db/schema";

type Row = Record<string, unknown>;
type Handler = (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => Promise<Response>;

function fixture(overrides: Row = {}) {
  let block: Row = {
    id: "planned-work", workspaceId: "workspace", userId: "owner", title: "Planned work", tags: [],
    status: "planned", linkedTimeEntryId: null, actionId: null, ...overrides,
  };
  let entries: Row[] = [];
  let failLink = false;
  const operations = {
    execute: async () => {},
    select() { return { from(table: unknown) {
      const query = {
        where() { return query; }, for() { return query; }, limit() { return query; },
        then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
          const rows = table === schema.scheduledWorkBlocks ? [block] : table === schema.timeEntries ? entries : table === schema.memberships ? [{ userId: "owner", workspaceId: "workspace" }] : [];
          return Promise.resolve(structuredClone(rows)).then(resolve, reject);
        },
      };
      return query;
    } }; },
    insert() { return { values(row: Row) { return { async returning() { entries.push(row); return [structuredClone(row)]; } }; } }; },
    update() { return { set(value: Row) { return { async where() {
      if (failLink) throw new Error("Synthetic reverse-link write failure");
      Object.assign(block, value);
    } }; } }; },
  };
  const db = {
    ...operations,
    async transaction<T>(callback: (tx: typeof operations) => Promise<T>, config: unknown) {
      assert.deepEqual(config, { isolationLevel: "read committed" });
      const original = structuredClone({ block, entries });
      try { return await callback(operations); }
      catch (error) { block = original.block; entries = original.entries; throw error; }
    },
  };
  const root = process.cwd();
  const require = createRequire(path.join(root, "package.json"));
  const modules: Record<string, unknown> = {
    "@/lib/auth": { UnauthorizedError, ForbiddenError, WorkspaceCapacityError },
    "@/lib/api-keys": { getApiKeyErrorContext: () => null,
      authenticateApiKey: async () => ({ id: "key", name: "Fixture", workspaceId: "workspace", createdByUserId: "owner", scopes: ["write:time"] }),
      requireApiScope, recordApiKeyRequest: async () => undefined,
    },
    "@/lib/db": { db },
    "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    // Period policy is unrelated to schedule-consumption assertions here;
    // capacity still executes its actual helper against the controlled rows.
    "@/lib/security": { ensurePeriodUnlocked: async () => {}, PeriodLockedError: class extends Error {} },
  };
  const realHelpers = new Set(["@/lib/scheduled-block-entry", "@/lib/scheduled-block-guards", "@/lib/workflow-validation", "@/lib/validators", "@/lib/date-input", "@/lib/time-capacity"]);
  function load(filename: string) {
    const compiled = transformSync(readFileSync(path.join(root, filename), "utf8"), { loader: "ts", format: "cjs" }).code;
    const loaded = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", compiled)((id: string) => {
      if (id in modules) return modules[id];
      if (realHelpers.has(id)) return modules[id] = load(`${id.slice(2)}.ts`);
      return id.startsWith("@/") ? {} : require(id);
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  const handler = load("app/api/v1/[resource]/route.ts").POST as Handler;
  return {
    get block() { return block; }, get entries() { return entries; },
    failLink() { failLink = true; },
    seedExistingEntry() { entries.push({ id: "earlier-entry", scheduledBlockId: block.id, workspaceId: "workspace", userId: "owner", startedAt: new Date("2026-10-01T09:00:00Z"), durationSeconds: null }); },
    invoke() {
      return handler(new NextRequest("https://sowledger.example/api/v1/time-entries", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner", scheduledBlockId: "planned-work", startedAt: "2026-10-01T09:00:00Z", stoppedAt: "2026-10-01T10:00:00Z", hourlyRate: 0, status: "submitted" }),
      }), { params: Promise.resolve({ resource: "time-entries" }) });
    },
  };
}

test("API schedule consumption writes one entry and its completed reverse link together", async () => {
  const f = fixture();
  const response = await f.invoke();
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.entry.hourlyRate, 0);
  assert.equal(data.entry.status, "submitted");
  assert.equal(f.block.status, "completed");
  assert.equal(f.block.linkedTimeEntryId, data.entry.id);
  assert.equal((await f.invoke()).status, 409);
  assert.equal(f.entries.length, 1);
});

test("API schedule consumption rejects nonplanned and already-linked records", async () => {
  for (const overrides of [
    ...["in_progress", "completed", "canceled", "skipped"].map((status) => ({ status })),
    { linkedTimeEntryId: "earlier-entry" },
  ]) {
    const f = fixture(overrides);
    assert.equal((await f.invoke()).status, 409);
    assert.equal(f.entries.length, 0);
  }
  const reset = fixture();
  reset.seedExistingEntry();
  assert.equal((await reset.invoke()).status, 409);
  assert.equal(reset.entries.length, 1);
});

test("API schedule consumption rolls back its entry if saving the reverse link fails", async () => {
  const f = fixture();
  f.failLink();
  assert.equal((await f.invoke()).status, 500);
  assert.equal(f.entries.length, 0);
  assert.equal(f.block.status, "planned");
  assert.equal(f.block.linkedTimeEntryId, null);
});

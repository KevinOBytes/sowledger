import { UnauthorizedError, ForbiddenError, WorkspaceCapacityError } from "../lib/auth";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { NextRequest } from "next/server";

import { requireApiScope, type ApiKeyContext } from "../lib/api-keys";
import * as schema from "../lib/db/schema";
import * as workflowValidation from "../lib/workflow-validation";

const context: ApiKeyContext = {
  id: "fixture-key", workspaceId: "fixture-workspace", name: "Limited key",
  createdByUserId: "fixture-owner", scopes: ["write:time", "write:schedule"],
};

type RouteHandler = (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => Promise<Response>;

// Execute the real handler while replacing only external operations. An empty
// UPDATE result models ownership changing after the handler's initial read.
function raceFixture() {
  let mutationPredicate: SQL | undefined;
  const snapshot = {
    id: "fixture-record", userId: context.createdByUserId, status: "draft", actionId: null, tags: [], linkedTimeEntryId: null,
    startsAt: new Date("2026-10-01T09:00:00Z"), endsAt: new Date("2026-10-01T10:00:00Z"),
  };
  const fakeDb = {
    select() { return { from(table: unknown) { const row = { ...snapshot, status: table === schema.scheduledWorkBlocks ? "planned" : "draft" }; return { where() { return {
      then(resolve: (value: unknown[]) => unknown) { return Promise.resolve([row]).then(resolve); },
      async for() { return [row]; },
      async limit() { return []; },
    }; } }; } }; },
    async transaction<T>(callback: (tx: unknown) => Promise<T>) { return callback(fakeDb); },
    update() {
      return { set() { return { where(predicate: SQL) {
        mutationPredicate = predicate;
        return { async returning() { return []; } };
      } }; } };
    },
  };
  const root = process.cwd();
  const require = createRequire(path.join(root, "package.json"));
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { UnauthorizedError, ForbiddenError, WorkspaceCapacityError },
    "@/lib/api-keys": { getApiKeyErrorContext: () => null, authenticateApiKey: async () => context, requireApiScope, recordApiKeyRequest: async () => undefined },
    "@/lib/db": { db: fakeDb },
    "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "@/lib/workflow-validation": workflowValidation,
  };
  const helper = { exports: {} };
  const compiledHelper = transformSync(readFileSync(path.join(root, "lib/schedule-mutations.ts"), "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", compiledHelper)((id: string) => dependencies[id] ?? require(id), helper, helper.exports);
  dependencies["@/lib/schedule-mutations"] = helper.exports;
  const fixtureModule = { exports: {} as Record<"PATCH" | "DELETE", RouteHandler> };
  const source = readFileSync(path.join(root, "app/api/v1/[resource]/route.ts"), "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const execute = new Function("require", "module", "exports", compiled);
  execute((id: string) => dependencies[id] ?? (id.startsWith("@/") ? {} : require(id)), fixtureModule, fixtureModule.exports);
  return {
    routes: fixtureModule.exports,
    assertOwnerPredicate(table: string) {
      assert.ok(mutationPredicate, "The route must issue a conditional write");
      const query = new PgDialect().sqlToQuery(mutationPredicate);
      const match = query.sql.match(new RegExp(`"${table}"\\."user_id" = \\$(\\d+)`));
      assert.ok(match, "Ownership must be checked by the UPDATE predicate, not only by an earlier SELECT");
      assert.equal(query.params[Number(match[1]) - 1], context.createdByUserId);
    },
  };
}

for (const resource of ["time-entries", "schedule"]) {
  test(`${resource} PATCH cannot succeed when the authorized record changes before the write`, async () => {
    const fixture = raceFixture();
    const data = resource === "time-entries" ? { entryId: "fixture-record", description: "Revised" } : { blockId: "fixture-record", title: "Revised" };
    const response = await fixture.routes.PATCH(new NextRequest(`https://sowledger.example/api/v1/${resource}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    }), { params: Promise.resolve({ resource }) });
    assert.equal(response.status, 409, "A write that matched no authorized row must not report success");
    fixture.assertOwnerPredicate(resource === "schedule" ? "scheduled_work_blocks" : "time_entries");
  });
}

test("schedule DELETE checks ownership in the write and reports a changed record", async () => {
  const fixture = raceFixture();
  const response = await fixture.routes.DELETE(new NextRequest("https://sowledger.example/api/v1/schedule?id=fixture-record", { method: "DELETE" }), {
    params: Promise.resolve({ resource: "schedule" }),
  });
  assert.equal(response.status, 409, "A write that matched no authorized row must not report success");
  fixture.assertOwnerPredicate("scheduled_work_blocks");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { memberships, userActions } from "../lib/db/schema";
import { errorFixture } from "./helpers/error-boundary-fixtures";

for (const role of ["owner", "manager", "member"]) {
  for (const target of ["actor", "other", "foreign"]) {
    test(`I5 actions ${role} selecting ${target} preserves membership and ownership`, async () => {
      const f = errorFixture();
      f.dependencies["@/lib/auth"].requireSession = async () => ({ sub: "actor", workspaceId: "workspace", role });
      f.dependencies["@/lib/db"] = { db: { select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
        const q = new PgDialect().sqlToQuery(condition);
        assert.ok(q.params.includes("workspace"), "every lookup is workspace-scoped");
        if (table === memberships) return Promise.resolve(q.params.includes("foreign") ? [] : [{ userId: target, workspaceId: "workspace" }]);
        assert.equal(table, userActions);
        return Promise.resolve([{ id: q.params.includes("other") ? "other-rate" : "actor-rate" }]);
      } }) }) } };
      const response = await f.call("user/actions", "GET", { query: `userId=${target}` });
      if (target !== "actor" && role === "member") assert.equal(response.status, 403);
      else if (target === "foreign") assert.equal(response.status, 404);
      else {
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).actions, [{ id: target === "other" ? "other-rate" : "actor-rate" }]);
      }
    });
  }
}

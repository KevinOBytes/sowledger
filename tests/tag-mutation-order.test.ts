import assert from "node:assert/strict";
import { test } from "node:test";
import { tagFixture, tagRow } from "./helpers/tag-fixtures";
for (const surface of ["native", "public"] as const) {
  for (const method of ["POST", "PATCH"]) test(`${surface} ${method} locks only explicit target project before tag write through READ COMMITTED commit`, async () => {
    const f = tagFixture(surface, { rows: method === "POST" ? [] : [tagRow("target", { projectId: "old" })] });
    const r = await f.call({ tagId: "target", name: "New", projectId: "project" }, method); assert.equal(r.status, method === "POST" && surface === "public" ? 201 : 200);
    const tx = f.events.indexOf('transaction:{"isolationLevel":"read committed"}'), lock = f.events.indexOf("lock:projects:update"), write = f.events.findIndex(event => event === (method === "POST" ? "insert:workspace_tags" : "update:workspace_tags"));
    assert.ok(tx >= 0 && tx < lock && lock < write && write < f.events.indexOf("commit"), f.events.join(",")); assert.equal(f.events.filter(e => e.startsWith("lock:")).length, 1);
    const projectPredicates = f.predicates.filter(p => p.table === "projects"); assert.ok(projectPredicates.length); for (const p of projectPredicates) assert.deepEqual(p.params, ["workspace", "project"]);
    if (method === "PATCH") assert.ok(f.predicates.some(p => p.table === "workspace_tags" && p.params.includes("workspace") && p.params.includes("target")));
  });
  for (const body of [{ tagId: "target", projectId: null }, { tagId: "target", color: "cyan" }, { tagId: "target", status: "archived" }]) test(`${surface} ${JSON.stringify(body)} never waits for old/unrelated project`, async () => { const f = tagFixture(surface, { rows: [tagRow("target", { projectId: "dangling" })] }); assert.equal((await f.call(body)).status, 200); assert.equal(f.events.some(e => e.startsWith("lock:")), false); assert.equal(f.events.some(e => e === "read:projects"), false); if (!("projectId" in body)) assert.equal(f.rows()[0].projectId, "dangling"); });
}

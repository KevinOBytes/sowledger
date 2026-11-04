import assert from "node:assert/strict";
import { test } from "node:test";
import { tagFixture, tagRow } from "./helpers/tag-fixtures";
import { diagnostics, assertDiagnostic } from "./helpers/error-boundary-fixtures";

for (const surface of ["native", "public"] as const) {
  for (const [field, value, message] of [
    ["name", " ", "Enter a tag name of at most 255 characters."], ["name", 3, "Enter a tag name of at most 255 characters."], ["name", "x".repeat(256), "Enter a tag name of at most 255 characters."],
    ["color", null, "Choose a tag color of at most 50 characters."], ["color", " ", "Choose a tag color of at most 50 characters."], ["color", "x".repeat(51), "Choose a tag color of at most 50 characters."],
    ["projectId", " ", "projectId must be a nonempty string of at most 255 characters, null, or an empty string."], ["projectId", false, "projectId must be a nonempty string of at most 255 characters, null, or an empty string."],
    ["isSOWLedgerDefault", "false", "isSOWLedgerDefault must be true or false."], ["status", "closed", "Choose active or archived as the tag status."],
  ] as const) test(`${surface} PATCH rejects ${field}:${JSON.stringify(value)}`, async () => {
    const f = tagFixture(surface); const response = await f.call({ tagId: "target", [field]: value }); assert.equal(response.status, 400); assert.equal((await response.json()).error, message); assert.equal(f.writes.length, 0); if (surface === "public") assert.deepEqual(f.usage, [400]);
  });
  for (const body of [null, [], 1, true, "value"]) test(`${surface} rejects nonobject ${JSON.stringify(body)}`, async () => { const f = tagFixture(surface); const r = await f.call(body, "POST"); assert.equal(r.status, 400); assert.equal((await r.json()).error, "Send a JSON object."); assert.equal(f.writes.length, 0); });
  test(`${surface} create lowercases/defaults, ignores ownership/status, supports explicit false and bounded nonhex colors`, async () => {
    const f = tagFixture(surface, { rows: [] }); const r = await f.call({ name: " Mixed ", color: " rebeccapurple ", isSOWLedgerDefault: false, id: "foreign", workspaceId: "foreign", status: "archived" }, "POST");
    assert.equal(r.status, surface === "native" ? 200 : 201); const { tag } = await r.json(); assert.equal(tag.name, "mixed"); assert.equal(tag.color, "rebeccapurple"); assert.equal(tag.workspaceId, "workspace"); assert.notEqual(tag.id, "foreign"); assert.equal(tag.projectId, null); assert.equal(tag.status, "active"); assert.equal(tag.isSOWLedgerDefault, false);
    const d = await tagFixture(surface, { rows: [] }).call({ name: "Default" }, "POST"); assert.deepEqual(Object.fromEntries(Object.entries((await d.json()).tag).filter(([k]) => ["color", "projectId", "isSOWLedgerDefault", "status"].includes(k))), { color: "#3b82f6", projectId: null, isSOWLedgerDefault: false, status: "active" });
  });
  test(`${surface} explicit false/clear, omission, case and unknown-only PATCH`, async () => {
    const f = tagFixture(surface, { rows: [tagRow("target", { projectId: "project", isSOWLedgerDefault: true })] });
    assert.equal((await f.call({ tagId: "target", name: " Mixed ", workspaceId: "foreign", id: "foreign" })).status, 200); assert.equal(f.rows()[0].name, surface === "native" ? "mixed" : "Mixed"); assert.equal(f.rows()[0].projectId, "project"); assert.equal(f.rows()[0].color, "rebeccapurple");
    for (const projectId of ["", null]) { assert.equal((await f.call({ tagId: "target", projectId, isSOWLedgerDefault: false })).status, 200); assert.equal(f.rows()[0].projectId, null); assert.equal(f.rows()[0].isSOWLedgerDefault, false); }
    for (const body of [{ tagId: "target" }, { tagId: "target", unknown: 1 }]) { const r = await f.call(body); assert.equal(r.status, 400); assert.equal((await r.json()).error, "Choose at least one tag field to update."); }
  });
  test(`${surface} target/project IDs preserve lookup bytes and foreign/missing use same safe refusals`, async () => {
    for (const tagId of ["missing", " target ", "foreign"]) { const f = tagFixture(surface, { rows: [tagRow(), tagRow("foreign", { workspaceId: "foreign" })] }); const r = await f.call({ tagId, name: "New" }); assert.equal(r.status, 404); assert.equal((await r.json()).error, "Tag not found."); }
    for (const projectId of ["absent", " project ", "foreign"]) { const f = tagFixture(surface, { projects: [{ id: "foreign", workspaceId: "foreign" }] }); const r = await f.call({ tagId: "target", projectId }); assert.equal(r.status, 400); assert.equal((await r.json()).error, "projectId is not in this workspace"); assert.equal(f.writes.length, 0); }
    for (const tagId of ["", " ", 4, "x".repeat(256)]) { const r = await tagFixture(surface).call({ tagId, name: "New" }); assert.equal(r.status, 400); assert.equal((await r.json()).error, "tagId must be a nonempty string of at most 255 characters."); }
  });
  test(`${surface} affected-row absence never reports PATCH/delete success and empty insert is unexpected500`, async () => {
    for (const method of ["PATCH", "DELETE"]) { const f = tagFixture(surface, { emptyReturning: true }); const r = await f.call({ tagId: "target", name: "New" }, method); assert.equal(r.status, 404); assert.equal((await r.json()).error, "Tag not found."); if (surface === "public") assert.deepEqual(f.usage, [404]); }
    const f = tagFixture(surface, { rows: [], emptyReturning: true }); const { value: r, logs } = await diagnostics(() => f.call({ name: "New" }, "POST")); assert.equal(r.status, 500); assertDiagnostic(logs, surface === "public" ? "/api/v1/[resource]" : "/api/settings/tags", "POST");
  });
  test(`${surface} storage SyntaxError remains unexpected, not JSON400; diagnostics and usage preserved`, async () => {
    for (const method of ["POST", "PATCH", "DELETE"]) { const f = tagFixture(surface, { ioError: new SyntaxError("private SQL") }); const { value: r, logs } = await diagnostics(() => f.call({ tagId: "target", name: "New" }, method)); assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /SQL|private/); assertDiagnostic(logs, surface === "public" ? "/api/v1/[resource]" : "/api/settings/tags", method); if (surface === "public") assert.deepEqual(f.usage, [500]); }
  });
  test(`${surface} DELETE semantics are hard-delete versus repeatable archive and scoped`, async () => {
    const f = tagFixture(surface, { rows: [tagRow(), tagRow("foreign", { workspaceId: "foreign" })], recorderFailure: true }); const r = await f.call(undefined, "DELETE"); assert.equal(r.status, 200); assert.deepEqual(await r.json(), surface === "native" ? { ok: true } : { ok: true, id: "target" });
    assert.deepEqual(f.rows().find(row => row.id === "foreign"), tagRow("foreign", { workspaceId: "foreign" }));
    const again = await f.call(undefined, "DELETE"); assert.equal(again.status, surface === "native" ? 404 : 200); if (surface === "public") { assert.equal(f.rows()[0].status, "archived"); assert.deepEqual(f.usage, [200, 200]); }
  });
  test(`${surface} auth precedes parsing/storage; member native reads only; public scopes enforced`, async () => {
    const noAuth = tagFixture(surface, { unauthorized: true }); assert.equal((await noAuth.call({}, "POST")).status, 401); assert.equal(noAuth.writes.length, 0);
    if (surface === "native") { const member = tagFixture(surface, { role: "member" }); assert.equal((await member.call(undefined, "GET")).status, 200); assert.equal((await member.call({ name: "New" }, "POST")).status, 403); assert.deepEqual(member.events.slice(0, 3), ["session", "role:member", "bootstrap"]); }
    else { for (const method of ["GET", "POST", "PATCH", "DELETE"]) { const f = tagFixture(surface, { scopes: [] }); assert.equal((await f.call({ tagId: "target", name: "New" }, method)).status, 403); assert.deepEqual(f.usage, [403]); assert.equal(f.writes.length, 0); assert.deepEqual(f.events.slice(0, 2), ["bootstrap", "api-auth"]); } }
  });
}
test("native best-effort duplicate check is retained, public duplicate behavior unchanged", async () => { assert.equal((await tagFixture("native").call({ name: " BEFORE " }, "POST")).status, 400); assert.equal((await tagFixture("public").call({ name: " BEFORE " }, "POST")).status, 201); });
test("canonical lowercasing cannot expand the saved name beyond its column bound", async () => {
  for (const surface of ["native", "public"] as const) { const f = tagFixture(surface); const r = await f.call({ name: "İ".repeat(128) }, "POST"); assert.equal(r.status, 400); assert.equal((await r.json()).error, "Enter a tag name of at most 255 characters."); assert.equal(f.writes.length, 0); }
});
test("guarded actual page derives workspace-keyed manager capability and never includes foreign project names", async () => {
  type Element = { type?: unknown; key?: unknown; props?: { children?: unknown; workspaceId?: unknown; canManageTags?: unknown; projects?: unknown } };
  const find = (value: unknown): Element | undefined => {
    if (Array.isArray(value)) return value.map(find).find(Boolean);
    if (!value || typeof value !== "object") return;
    const node = value as Element;
    return node.type === "TagsDataTable" ? node : find(node.props?.children);
  };
  for (const role of ["owner", "manager", "member"]) {
    const f = tagFixture("native", { role, projects: [{ id: "project", workspaceId: "workspace", name: "Own archived project", status: "archived" }, { id: "foreign", workspaceId: "foreign", name: "Foreign private name" }] });
    const page = f.load("@/app/(app)/settings/tags/page") as unknown as { default: () => Promise<unknown> };
    const output = await page.default(), table = find(output);
    assert.ok(table); assert.equal(table.key, "workspace"); assert.equal(table.props?.workspaceId, "workspace"); assert.equal(table.props?.canManageTags, role !== "member"); assert.deepEqual(table.props?.projects, [{ id: "project", name: "Own archived project" }]); assert.equal(JSON.stringify(output).includes("Foreign private name"), false); assert.equal(f.events[0], "session");
  }
});
for (const surface of ["native", "public"] as const) test(`${surface} bounded maximum names/colors, scoped reads and no project lock on deletion`, async () => {
  const f = tagFixture(surface, { rows: [tagRow(), tagRow("foreign", { workspaceId: "foreign" })] });
  const read = await f.call(undefined, "GET"); assert.equal(read.status, 200); assert.deepEqual((await read.json()).tags.map((t: { id: string }) => t.id), ["target"]);
  assert.equal((await f.call({ tagId: "target", name: "x".repeat(255), color: "x".repeat(50) })).status, 200);
  assert.equal(f.rows()[0].name, "x".repeat(255)); assert.equal(f.rows()[0].color, "x".repeat(50));
  assert.equal((await f.call(undefined, "DELETE")).status, 200); assert.equal(f.events.some(e => e.startsWith("lock:")), false);
});

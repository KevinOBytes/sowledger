/* eslint-disable @typescript-eslint/no-explicit-any -- Actual-source adversarial boundary values. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { errorFixture, diagnostics, assertDiagnostic } from "./helpers/error-boundary-fixtures";

test("static diagnostic supports default/upstream category and ignores logger failures", async () => {
  const f = errorFixture();
  for (const category of [undefined, "upstream"] as const) {
    const { logs } = await diagnostics(async () => f.workflow.reportUnexpectedRequestFailure({ route: "/api/integrations/[provider]/test", method: "POST" }, category));
    assertDiagnostic(logs, "/api/integrations/[provider]/test", "POST", 1, category ?? "unexpected");
  }
  const original = console.error; console.error = () => { throw new Error("private logger"); };
  try { assert.doesNotThrow(() => f.workflow.reportUnexpectedRequestFailure({ route: "/api/integrations", method: "GET" }, "upstream")); } finally { console.error = original; }
});

test("shared formatter refuses forged status and later SyntaxError, emits only static diagnostics", async () => {
  const f = errorFixture();
  const adversaries: unknown[] = [new Error("private SQL"), "private token", 42, null, undefined, new SyntaxError("private SQL"), ...[400, 401, 402, 403, 422, 503, NaN, -1].flatMap(status => [{ status, message: "private body" }, { statusCode: status, name: "UnauthorizedError", code: "FORBIDDEN", cause: { query: "private query" } }]), { cause: { cause: { code: "40001" } } }, ...[503, 401, 500, 0, -1, NaN, Infinity].map(status => new f.workflow.WorkflowError("private invalid", status))];
  for (const error of adversaries) {
    const { value, logs } = await diagnostics(async () => f.workflow.workflowErrorResponse(error, "Fixed fallback."));
    assert.equal(value.status, 500); assert.deepEqual(await value.json(), { error: "Fixed fallback." }); assertDiagnostic(logs, "workflow", "UNSPECIFIED");
  }
});

test("actual constructor identities retain fixed auth/capacity, bounded conflicts and trusted domain statuses", async () => {
  const f = errorFixture();
  const capacity = new f.classes.WorkspaceCapacityError(); capacity.message = "private changed";
  const rows: Array<[unknown, number, string]> = [
    [new f.classes.UnauthorizedError("private changed"), 401, "Please sign in again."],
    [new f.classes.ForbiddenError("private changed"), 403, "Your workspace role cannot perform this action."],
    [capacity, 402, "This workspace is at its member limit. Ask the workspace owner to choose a larger plan, then try the same invitation again."],
    ...[400, 402, 403, 404, 409, 422].map(status => [new f.workflow.WorkflowError("Domain refusal.", status), status, "Domain refusal."] as [unknown, number, string]),
    [new (f.load("@/lib/date-input").DateInputError)("Date refusal."), 400, "Date refusal."],
    ...[{ code: "40001" }, { cause: { code: "40001" } }].map(error => [error, 409, "This record changed while you were reviewing it. Reload it and try again."] as [unknown, number, string]),
  ];
  for (const [error, status, message] of rows) {
    const { value, logs } = await diagnostics(async () => f.workflow.workflowErrorResponse(error, "Fallback"));
    assert.equal(value.status, status); assert.deepEqual(await value.json(), { error: message }); assert.deepEqual(logs, []);
  }
  const result = f.workflow.classifyWorkflowError(new Error("private"), "Fallback");
  assert.deepEqual(result, { status: 500, message: "Fallback", unexpected: true });
});

test("request parser alone converts invalid/empty JSON, never read I/O or later syntax", async () => {
  const f = errorFixture();
  for (const raw of ["{", ""]) await assert.rejects(f.workflow.readRequestJson(new Request("https://fixture.test", { method: "POST", body: raw })), (error: any) => error instanceof f.workflow.WorkflowError && error.status === 400 && error.message === "Send a valid JSON request.");
  for (const value of [null, [], 1, "text", true, {}]) assert.deepEqual(await f.workflow.readRequestJson(new Request("https://fixture.test", { method: "POST", body: JSON.stringify(value) })), value);
  const io = new Error("private I/O"); await assert.rejects(f.workflow.readRequestJson({ json: async () => { throw io; } }), error => error === io);
});

test("API key attribution originates only from actual revoked/expired authentication", async () => {
  const f = errorFixture();
  for (const lifecycle of ["revoked", "expired"]) {
    f.state.rows = [{ id: "key", workspaceId: "workspace", scopes: [], name: "Test", createdByUserId: "actor", revokedAt: lifecycle === "revoked" ? new Date() : null, expiresAt: lifecycle === "expired" ? new Date(0) : null }];
    let caught: any;
    try { await f.api.authenticateApiKey(new Request("https://fixture.test", { headers: { authorization: "Bearer synthetic" } })); } catch (error) { caught = error; }
    assert.ok(caught instanceof f.classes.UnauthorizedError);
    assert.deepEqual(f.api.getApiKeyErrorContext(caught), { id: "key", workspaceId: "workspace", scopes: [], name: "Test", createdByUserId: "actor" });
    caught.apiKeyContext = { id: "foreign" }; assert.equal(f.api.getApiKeyErrorContext(caught).id, "key");
  }
  for (const forged of [new f.classes.UnauthorizedError("forged"), Object.create(f.classes.UnauthorizedError.prototype), { apiKeyContext: f.context }, null, "text"]) assert.equal(f.api.getApiKeyErrorContext(forged), null);
  assert.equal(f.state.writes, 0);
  f.state.rows = [{ ...f.context, revokedAt: null, expiresAt: new Date(Date.now() + 60000) }];
  assert.deepEqual(await f.api.authenticateApiKey(new Request("https://fixture.test", { headers: { authorization: "Bearer synthetic" } })), f.context); assert.equal(f.state.writes, 1);
});

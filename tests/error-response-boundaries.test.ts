/* eslint-disable @typescript-eslint/no-explicit-any -- Execute actual handlers with bounded external operations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { errorFixture, diagnostics, assertDiagnostic } from "./helpers/error-boundary-fixtures";

// Literal method/fallback register: also serves as the executed adapter manifest.
export const methods: Array<[string, string, string, string?]> = [
  ["projects", "GET", "We couldn't load your projects. Please try again."],
  ["projects", "POST", "We couldn't confirm the project was created. Check your project list before trying again."],
  ["projects", "PATCH", "Could not update the project. Please try again."],
  ["projects", "DELETE", "Could not delete the project. Please try again.", "regression"],
  ["clients", "GET", "We couldn't load your clients. Please try again."],
  ["clients", "POST", "We couldn't confirm the client was saved. Check your client list before trying again."],
  ["clients", "PATCH", "We couldn't save this client. Please try again."],
  ["clients", "DELETE", "We couldn't confirm the client was deleted. Refresh your client list before trying again."],
  ["people", "GET", "We couldn't load your people. Please try again."],
  ["people", "POST", "We couldn't confirm the person or invitation was saved. Check your people list before trying again."],
  ["people", "PATCH", "We couldn't confirm the person's changes were saved. Check your people list before trying again."],
  ["organizations", "PATCH", "We couldn't confirm the organization was updated. Check your organizations before trying again."],
  ["settings/tags", "GET", "We couldn't load your tag settings. Please try again."],
  ["settings/tags", "POST", "We couldn't confirm the tag was created. Check your tag list before trying again."],
  ["settings/tags", "PATCH", "We couldn't confirm the tag was updated. Check your tag list before trying again."],
  ["settings/tags", "DELETE", "We couldn't confirm the tag was deleted. Check your tag list before trying again."],
  ["onboarding", "GET", "We couldn't load your setup progress. Please try again."],
  ["onboarding", "PATCH", "We couldn't confirm your setup progress was saved. Check your setup progress before trying again."],
  ["tags", "GET", "We couldn't load your tags. Please try again."],
  ["tags", "PATCH", "We couldn't confirm the tag changes were saved. Check your tags before trying again."],
  ["tags", "DELETE", "We couldn't confirm the tag was removed. Check your tags before trying again."],
  ["user/settings", "GET", "We couldn't load your settings. Please try again."],
  ["user/settings", "PATCH", "We couldn't save your settings. Please try again."],
  ["admin/stats", "GET", "We couldn't load administration statistics. Please try again."],
  ["auth/invite", "POST", "We couldn't confirm the invitation was created. Check your invitations before trying again."],
  ["compliance/daily-check", "POST", "We couldn't confirm the daily check was recorded. Check your daily check before trying again."],
  ["expenses/attach", "POST", "We couldn't confirm the expense was attached. Check the time entry before trying again."],
  ["settings/api-keys", "GET", "We couldn't load your API keys. Please try again."],
  ["settings/api-keys", "POST", "We couldn't confirm the API key was created. Check your API key list before trying again."],
  ["settings/api-keys", "PATCH", "We couldn't confirm the API key was changed. Check your API key list before trying again."],
  ["settings/api-keys", "DELETE", "We couldn't confirm the API key was revoked. Check your API key list before trying again."],
  ["timer/active", "GET", "We couldn't load your active timers. Please try again."],
  ["timer/start", "POST", "We couldn't confirm the timer started. Check your active timers before trying again."],
  ["timer/manual", "POST", "Could not save this time entry. Please try again."],
  ["goals", "GET", "We couldn't load your goals. Please try again."],
  ["goals", "DELETE", "We couldn't confirm the goal was deleted. Check your goals before trying again."],
  ["goals", "POST", "Could not create this goal. Please try again."],
  ["goals", "PATCH", "Could not update this goal. Please try again."],
  ["tasks", "GET", "We couldn't load your tasks. Please try again."],
  ["tasks", "DELETE", "We couldn't confirm the task was deleted. Check your task list before trying again."],
  ["tasks", "POST", "Could not create this task. Please try again."],
  ["tasks", "PATCH", "Could not update this task. Please try again."],
  ["user/actions", "GET", "We couldn't load your work types. Please try again."],
  ["user/actions", "POST", "We couldn't confirm the work type was created. Check your work types before trying again."],
  ["user/actions", "PATCH", "We couldn't confirm the work type was changed. Check your work types before trying again."],
  ["user/actions", "DELETE", "We couldn't confirm the work type was deleted. Check your work types before trying again."],
  ["planner", "GET", "We couldn't load your plan. Please try again."],
  ["calendar", "GET", "We couldn't load your calendar. Please try again."],
  ["notifications", "GET", "We couldn't load your notifications. Please try again."],
  ["notifications", "PATCH", "We couldn't confirm your notifications were updated. Check your notifications before trying again."],
  ["export/csv", "GET", "We couldn't export your data. Please try again."],
  ["revenue-intelligence", "GET", "We couldn't load your revenue analysis. Please try again."],
  ["webhooks", "GET", "We couldn't load your webhooks. Please try again."],
  ["webhooks", "POST", "We couldn't confirm the webhook was created. Check your webhook list before trying again."],
  ["webhooks", "DELETE", "We couldn't confirm the webhook was deleted. Check your webhook list before trying again."],
  ["v1/[resource]", "GET", "We couldn't load this API resource. Please try again."],
  ["v1/[resource]", "POST", "We couldn't confirm this API resource was created. Check the resource before trying again."],
  ["v1/[resource]", "PATCH", "We couldn't confirm this API resource was updated. Check the resource before trying again."],
  ["v1/[resource]", "DELETE", "We couldn't confirm this API resource was deleted. Check the resource before trying again."],
  ["timer/edit", "PATCH", "Could not save this entry. Please try again."],
  ["timer/stop", "POST", "Could not stop this timer. Please try again."],
  ["cron/scheduled-block-reminders", "GET", "We couldn't authorize the reminder check. Please try again."],
  ["test/login", "GET", "Test sign-in failed."],
  ["schedule", "POST", "Could not schedule this work. Please try again."],
  ["schedule", "PATCH", "Could not update this scheduled work. Please try again."],
  ["integrations/calendar/import", "POST", "Could not import these calendar events. No changes were saved; please try again."],
  ["timer/split", "POST", "Could not split this entry. Please try again."],
  ["timer/submit", "POST", "Could not submit time. Please try again."],
  ["timer/approve", "POST", "Could not approve time. Please try again."],
  ["timer/reject", "POST", "Could not send time back. Please try again."],
  ["timer/invoice", "POST", "Could not mark this entry as invoiced. Please try again."],
  ["invoices", "POST", "We couldn't confirm the invoice was saved. Refresh your invoices before trying again."],
  ["invoices/[invoiceId]", "PATCH", "Could not update this invoice. Please try again."],
  ["client/signoff", "POST", "Could not approve this invoice. Please try again."],
  ["activity", "GET", "Could not load activity. Please try again.", "regression"],
  ["approvals", "GET", "Could not load approvals. Please try again.", "regression"],
  ["reports", "GET", "Could not load analytics. Please try again.", "regression"],
  ["timer/list", "GET", "Could not load time entries. Please try again.", "regression"],
  ["schedule", "GET", "Could not load your schedule. Please try again.", "regression"],
  ["schedule", "DELETE", "Could not cancel this scheduled work. Please try again.", "regression"],
  ["invoices", "GET", "Could not load invoices. Please try again.", "regression"],
  ["client", "GET", "Could not load your projects and invoices. Please try again.", "regression"],
  ["invoices/[invoiceId]/proof-pack", "GET", "Could not load invoice details. Please try again.", "regression"],
];

for (const [route, method, fallback, regression] of methods) test(`${route} ${method}: actual boundary masks unknown/syntax/spoof and preserves actual auth`, async () => {
  const f = errorFixture();
  if (route === "test/login") f.dependencies["@/lib/store"].ensureUser = async () => { throw f.state.error; };
  for (const error of [new Error("private SQL/password"), new SyntaxError("private SQL"), { status: 403, message: "private token", cause: { query: "private" } }]) {
    f.state.failAuth = true; f.state.error = error;
    const { value, logs } = await diagnostics(() => f.call(route, method));
    assert.equal(value.status, 500); assert.deepEqual(await value.json(), { ...(route === "cron/scheduled-block-reminders" ? { ok: false } : {}), error: fallback, ...(route === "v1/[resource]" ? { resource: "projects" } : {}) });
    assertDiagnostic(logs, regression ? "workflow" : `/api/${route}`, regression ? "UNSPECIFIED" : method);
  }
  if (route === "test/login") return;
  for (const [error, status, message] of [[new f.classes.UnauthorizedError("private"), 401, route === "cron/scheduled-block-reminders" ? "Unauthorized" : route === "v1/[resource]" ? "Use a valid, active API key." : "Please sign in again."], [new f.classes.ForbiddenError("private"), 403, route === "v1/[resource]" ? "This API key does not have the required scope." : "Your workspace role cannot perform this action."]] as any[]) {
    if (route === "cron/scheduled-block-reminders" && status === 403) continue;
    f.state.error = error; const { value, logs } = await diagnostics(() => f.call(route, method));
    assert.equal(value.status, status); assert.deepEqual(await value.json(), { ...(route === "cron/scheduled-block-reminders" ? { ok: false } : {}), error: message, ...(route === "v1/[resource]" ? { resource: "projects" } : {}) }); assert.deepEqual(logs, []);
  }
});

test("public guard rejects forged attribution for every verb and recorder failure never replaces returned status", async () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const f = errorFixture(); f.state.failAuth = true; f.state.error = { status: 401, message: "private", apiKeyContext: { id: "foreign" } }; f.rejectRecorder();
    const { value } = await diagnostics(() => f.call("v1/[resource]", method));
    assert.equal(value.status, 500); assert.deepEqual(f.usage, [{ context: null, status: 500 }]);
  }
});

const shapeCopy: Record<string, string> = {
  "clients": "Send a client object with the fields to save.", "tasks": "Send a task object with the fields to save.", "user/settings": "Send a settings object with the fields to update.",
  "schedule POST": "Send a valid scheduling request.", "timer/edit": "Choose a time entry to edit.", "timer/split": "Choose an entry and a positive duration to split.", "timer/submit": "Select between 1 and 100 different time entries.",
  "timer/approve": "Choose a time entry to approve.", "timer/reject": "Choose a time entry and keep the reason under 2,000 characters.", "timer/invoice": "Choose a time entry and a valid reason.", "invoices": "Send a valid invoice selection.", "invoices/[invoiceId]": "Choose sent or paid as the next invoice status.", "client/signoff": "Open the invoice details before approving this version.",
};
const readers = methods.filter(([route, method]) => ["POST", "PATCH"].includes(method) && route !== "test/login");
const validBodies: Record<string, any> = {
  "projects POST": { name: "Work" }, "projects PATCH": { projectId: "project" },
  "clients POST": { name: "Client" }, "clients PATCH": { clientId: "client", name: "Updated" },
  "people POST": { organizationId: "org" }, "people PATCH": { personId: "person" }, "organizations PATCH": { organizationId: "org" },
  "settings/tags POST": { name: "Work" }, "settings/tags PATCH": { tagId: "tag", name: "Updated" }, "onboarding PATCH": {}, "tags PATCH": { fromTag: "old", toTag: "new" },
  "user/settings PATCH": { displayName: "Updated" }, "auth/invite POST": { email: "fixture@example.com" }, "compliance/daily-check POST": {}, "expenses/attach POST": { entryId: "entry", label: "Receipt", amount: 1, r2Key: "receipts/test.pdf" },
  "settings/api-keys POST": { name: "Test", scopes: ["read:projects"] }, "settings/api-keys PATCH": { keyId: "key", name: "Updated" }, "timer/start POST": { taskId: "Work" },
  "timer/manual POST": { startedAt: "2026-10-01T09:00:00Z", stoppedAt: "2026-10-01T10:00:00Z" }, "goals POST": { name: "Work" }, "goals PATCH": { goalId: "goal" },
  "tasks POST": { projectId: "project", title: "Work" }, "tasks PATCH": { taskId: "task", title: "Updated" }, "user/actions POST": { name: "Work" }, "user/actions PATCH": { actionId: "action" }, "notifications PATCH": { markAllRead: true },
  "webhooks POST": { url: "https://8.8.8.8/hook" }, "v1/[resource] POST": { name: "Work" }, "v1/[resource] PATCH": { projectId: "project" }, "timer/edit PATCH": { entryId: "entry" }, "timer/stop POST": { entryId: "entry" },
  "schedule POST": { title: "Work", startsAt: "2026-10-01T09:00:00Z", endsAt: "2026-10-01T10:00:00Z" }, "schedule PATCH": { blockId: "block" }, "integrations/calendar/import POST": {},
  "timer/split POST": { entryId: "entry", fractionSeconds: 1 }, "timer/submit POST": { entryIds: ["entry"] }, "timer/approve POST": { entryId: "entry" }, "timer/reject POST": { entryId: "entry" }, "timer/invoice POST": { entryId: "entry" },
  "invoices POST": { timeEntryIds: ["entry"] }, "invoices/[invoiceId] PATCH": { status: "sent" }, "client/signoff POST": { invoiceId: "invoice", digest: "a".repeat(64) },
};
for (const [route, method, fallback] of readers) test(`${route} ${method}: invalid/empty/nonobject/read-I/O/later-syntax parser boundary`, async () => {
  const f = errorFixture();
  if (route === "user/settings") f.state.rows = [{ id: "actor" }];
  for (const raw of ["{", ""]) {
    const { value, logs } = await diagnostics(() => f.call(route, method, { raw }));
    assert.equal(value.status, 400); assert.deepEqual(await value.json(), { error: "Send a valid JSON request.", ...(route === "v1/[resource]" ? { resource: "projects" } : {}) }); assert.deepEqual(logs, []); assert.equal(f.state.writes, 0);
  }
  for (const raw of ["null", "[]", "1", '"private primitive"', "true"]) {
    const { value, logs } = await diagnostics(() => f.call(route, method, { raw }));
    assert.equal(value.status, 400); assert.deepEqual(await value.json(), { error: shapeCopy[`${route} ${method}`] ?? shapeCopy[route] ?? "Send a JSON object.", ...(route === "v1/[resource]" ? { resource: "projects" } : {}) }); assert.deepEqual(logs, []); assert.equal(f.state.writes, 0);
  }
  const io = await diagnostics(() => f.call(route, method, { bodyError: new Error("private body I/O") }));
  assert.equal(io.value.status, 500); assert.deepEqual(await io.value.json(), { error: fallback, ...(route === "v1/[resource]" ? { resource: "projects" } : {}) }); assert.equal(f.state.writes, 0);
  // A syntactically valid object reaches a later authorization boundary; the
  // same SyntaxError is not attributed to JSON parsing merely by its class.
  f.state.failAuth = true; f.state.error = new SyntaxError("private later SQL");
  const later = await diagnostics(() => f.call(route, method, { value: {} })); assert.equal(later.value.status, 500); assert.deepEqual(await later.value.json(), { error: fallback, ...(route === "v1/[resource]" ? { resource: "projects" } : {}) });
});

for (const [route, method, fallback] of readers) test(`${route} ${method}: valid object reaches later SyntaxError without parser misclassification`, async () => {
  const f = errorFixture(); if (route === "user/settings") f.state.rows = [{ id: "actor" }];
  let read = false;
  const { value, logs } = await diagnostics(() => f.call(route, method, { value: validBodies[`${route} ${method}`], afterJson: () => { read = true; f.state.failDb = true; f.state.error = new SyntaxError("private post-parse DB"); } }));
  assert.equal(read, true); assert.equal(value.status, 500, await value.clone().text()); assert.deepEqual(await value.json(), { error: fallback, ...(route === "v1/[resource]" ? { resource: "projects" } : {}) }); assertDiagnostic(logs, `/api/${route}`, method);
});

test("notifications valid empty object remains no-op200", async () => {
  const f = errorFixture(); const { value, logs } = await diagnostics(() => f.call("notifications", "PATCH", { value: {} }));
  assert.equal(value.status, 200); assert.deepEqual(await value.json(), { ok: true }); assert.equal(f.state.writes, 0); assert.deepEqual(logs, []);
});

test("actual webhook validation refusals400, unexpected DNS500, and actual stop limiter403 versus text impostor500", async () => {
  const f = errorFixture();
  for (const [url, message] of [["invalid", "A valid HTTPS URL is required."], ["http://example.com", "Webhook URL must be a public HTTPS endpoint."], ["https://127.0.0.1", "Webhook URL must be a public HTTPS endpoint."]]) {
    const { value, logs } = await diagnostics(() => f.call("webhooks", "POST", { value: { url } })); assert.equal(value.status, 400); assert.deepEqual(await value.json(), { error: message }); assert.deepEqual(logs, []);
  }
  f.state.dns = new Error("private DNS I/O"); const dns = await diagnostics(() => f.call("webhooks", "POST", { value: { url: "https://example.com" } })); assert.equal(dns.value.status, 500); assertDiagnostic(dns.logs, "/api/webhooks", "POST");
  f.state.dns = undefined;
  for (const records of [[], [{ address: "127.0.0.1", family: 4 }]]) {
    f.state.dnsRecords = records; const { value, logs } = await diagnostics(() => f.call("webhooks", "POST", { value: { url: "https://example.com" } })); assert.equal(value.status, 400); assert.deepEqual(await value.json(), { error: "Webhook URL must resolve to a public address." }); assert.deepEqual(logs, []);
  }
  for (let i = 0; i < 10; i++) f.security.enforceStopRateLimit("actor");
  const limited = await diagnostics(() => f.call("timer/stop", "POST", { value: { entryId: "entry" } })); assert.equal(limited.value.status, 403); assert.deepEqual(await limited.value.json(), { error: "Rate limit exceeded on timer stop endpoint" }); assert.deepEqual(limited.logs, []);
  const forged = errorFixture(); forged.state.failAuth = true; forged.state.error = new Error("Rate limit exceeded on timer stop endpoint"); const refused = await diagnostics(() => forged.call("timer/stop", "POST")); assert.equal(refused.value.status, 500); assertDiagnostic(refused.logs, "/api/timer/stop", "POST");
});

test("actual membership capacity producer and invitation adapters retain402, arbitrary402 stays500", async () => {
  for (const route of ["auth/invite", "people"]) {
    const f = errorFixture(); f.dependencies["@/lib/billing"].checkWorkspaceLimits = async () => ({ allowed: false });
    let capacity: any; try { await f.auth.assertWorkspaceMembershipCapacity("workspace", f.db); } catch (error) { capacity = error; }
    assert.ok(capacity instanceof f.classes.WorkspaceCapacityError);
    // Allow the precheck, but the actual producer's raced refusal is thrown at
    // the invitation operation before any person/invitation write.
    f.dependencies["@/lib/billing"].checkWorkspaceLimits = async () => ({ allowed: true }); f.dependencies["@/lib/auth"].inviteUser = async () => { throw capacity; };
    f.state.rows = [{ id: "org" }];
    const { value, logs } = await diagnostics(() => f.call(route, "POST", { value: { email: "fixture@example.com", organizationId: "org", invite: true } }));
    assert.equal(value.status, 402); assert.deepEqual(await value.json(), { error: "This workspace is at its member limit. Ask the workspace owner to choose a larger plan, then try the same invitation again." }); assert.equal(f.state.writes, 0); assert.deepEqual(logs, []);
  }
});

test("submit period helper preserves actual locked409 but rethrows unknown helper/DB/SyntaxError500", async () => {
  for (const fault of [new Error("private period DB"), new SyntaxError("private period DB"), "locked"]) {
    const f = errorFixture(); f.state.rows = [{ id: "entry", userId: "actor", status: "draft", durationSeconds: 1, startedAt: new Date("2026-10-01T09:00Z"), stoppedAt: new Date("2026-10-01T10:00Z") }];
    const schema = f.load("@/lib/db/schema");
    if (fault !== "locked") { f.state.failTable = schema.lockPeriods; f.state.error = fault; }
    else f.state.tables.set(schema.lockPeriods, [{ periodStart: new Date("2026-10-01T08:00Z"), periodEnd: new Date("2026-10-01T11:00Z") }]);
    let called = 0; f.dependencies["@/lib/security"].ensurePeriodUnlocked = (...args: any[]) => { called++; return f.security.ensurePeriodUnlocked(...args); };
    const { value, logs } = await diagnostics(() => f.call("timer/submit", "POST", { value: { entryIds: ["entry"] } }));
    assert.equal(called, 1); assert.equal(value.status, fault === "locked" ? 409 : 500); assert.deepEqual(await value.json(), { error: fault === "locked" ? "One or more entries are in a locked period." : "Could not submit time. Please try again." }); assertDiagnostic(logs, "/api/timer/submit", "POST", fault === "locked" ? 0 : 1); assert.equal(f.state.writes, 0); assert.equal(f.state.after, 0);
  }
});

for (const method of ["GET", "POST", "PATCH", "DELETE"]) test(`public ${method}: real revoked/expired provenance, scope refusal, known failure, final status and successful response survive recorder rejection`, async () => {
  for (const lifecycle of ["revoked", "expired"]) {
    const f = errorFixture(); f.state.rows = [{ ...f.context, revokedAt: lifecycle === "revoked" ? new Date() : null, expiresAt: lifecycle === "expired" ? new Date(0) : null }];
    let authError: unknown; try { await f.api.authenticateApiKey(new Request("https://fixture.test", { headers: { authorization: "Bearer synthetic" } })); } catch (error) { authError = error; }
    assert.ok(authError instanceof f.classes.UnauthorizedError); (authError as any).apiKeyContext = { id: "foreign" };
    f.state.error = authError; f.state.failAuth = true; f.rejectRecorder();
    const { value, logs } = await diagnostics(() => f.call("v1/[resource]", method));
    assert.equal(value.status, 401); assert.deepEqual(await value.json(), { error: "Use a valid, active API key.", resource: "projects" }); assert.deepEqual(logs, []); assert.deepEqual(f.usage, [{ context: f.context, status: 401 }]);
  }
  const scope = errorFixture(); scope.context.scopes = []; scope.rejectRecorder();
  const denied = await diagnostics(() => scope.call("v1/[resource]", method)); assert.equal(denied.value.status, 403); assert.deepEqual(await denied.value.json(), { error: "This API key does not have the required scope.", resource: "projects" }); assert.deepEqual(denied.logs, []); assert.deepEqual(scope.usage, [{ context: scope.context, status: 403 }]);
  const failure = errorFixture(); failure.state.failDb = true; failure.state.error = new Error("private authenticated DB"); failure.rejectRecorder();
  const failed = await diagnostics(() => failure.call("v1/[resource]", method, { value: method === "POST" ? { name: "Work" } : { projectId: "project" } }));
  assert.equal(failed.value.status, 500); assertDiagnostic(failed.logs, "/api/v1/[resource]", method); assert.deepEqual(failure.usage, [{ context: failure.context, status: 500 }]);
  const success = errorFixture(); success.state.rows = [{ id: "target", workspaceId: "workspace", name: "work", color: "#3b82f6", projectId: null, isSOWLedgerDefault: false, status: "active" }]; success.rejectRecorder();
  const response = await success.call("v1/[resource]", method, { resource: "tags", value: method === "POST" ? { name: "Work" } : { tagId: "target", name: "Work" } });
  assert.equal(response.status, method === "POST" ? 201 : 200); assert.equal((await response.json()).ok, true); assert.deepEqual(success.usage, [{ context: success.context, status: method === "POST" ? 201 : 200 }]);
});

test("public nested time preserves API auth and domain copy/envelopes, direct responses and final-status usage", async () => {
  for (const [body, status, message] of [[{}, 400, "name is required"], [{ name: "Work" }, 402, "Choose a larger plan."]] as any[]) {
    const f = errorFixture(); f.dependencies["@/lib/project-creation"] = { createWorkspaceProject: async () => ({ allowed: false, error: "Choose a larger plan." }) }; f.rejectRecorder();
    const { value, logs } = await diagnostics(() => f.call("v1/[resource]", "POST", { value: body })); assert.equal(value.status, status); assert.deepEqual(await value.json(), { error: message }); assert.deepEqual(logs, []); assert.deepEqual(f.usage, [{ context: f.context, status }]);
  }
  const body = { userId: "someone-else", startedAt: "2026-10-01T09:00Z", stoppedAt: "2026-10-01T10:00Z" };
  const scope = errorFixture(); scope.context.scopes = ["write:time"];
  const denied = await diagnostics(() => scope.call("v1/[resource]", "POST", { resource: "time-entries", value: body }));
  assert.equal(denied.value.status, 403); assert.deepEqual(await denied.value.json(), { error: "This API key does not have the required scope." }); assert.deepEqual(denied.logs, []); assert.deepEqual(scope.usage, [{ context: scope.context, status: 403 }]);
  for (const kind of ["auth", "forbidden", "domain", "period", "capacity", "precision", "data", "unexpected"]) {
    const f = errorFixture(), capacity = f.load("@/lib/time-capacity");
    const error = kind === "auth" ? new f.classes.UnauthorizedError("private") : kind === "forbidden" ? new f.classes.ForbiddenError("private") : kind === "domain" ? new f.workflow.WorkflowError("Domain-specific refusal.", 403) : kind === "period" ? new f.security.PeriodLockedError() : kind === "capacity" ? new capacity.TimeCapacityError() : kind === "precision" ? new capacity.TimePrecisionError() : kind === "data" ? new capacity.TimeDataError() : new SyntaxError("private nested DB");
    f.dependencies["@/lib/time-capacity"] = { ...capacity, withTimeCapacity: async () => { throw error; } };
    const { value, logs } = await diagnostics(() => f.call("v1/[resource]", "POST", { resource: "time-entries", value: body }));
    const status = kind === "auth" ? 401 : ["forbidden", "domain"].includes(kind) ? 403 : ["period", "data"].includes(kind) ? 409 : ["capacity", "precision"].includes(kind) ? 400 : 500;
    const message = kind === "auth" ? "Use a valid, active API key." : kind === "forbidden" ? "This API key does not have the required scope." : kind === "unexpected" ? "Could not create this time entry. Please try again." : error.message;
    assert.equal(value.status, status); assert.deepEqual(await value.json(), { error: message, ...(["period", "capacity", "precision", "data"].includes(kind) ? { resource: "time-entries" } : {}) }); assertDiagnostic(logs, "/api/v1/[resource]", "POST", kind === "unexpected" ? 1 : 0); assert.deepEqual(f.usage, [{ context: f.context, status }]);
  }
});

test("public reference producers and nonwritable/unknown boundaries stay scoped and typed", async () => {
  for (const [resource, value, message] of [
    ["projects", { name: "Work", clientId: "foreign" }, "clientId is not in this workspace"],
    ["tags", { name: "Work", projectId: "foreign" }, "projectId is not in this workspace"],
    ["schedule", { userId: "actor", title: "Work", startsAt: "2026-10-01T09:00Z", endsAt: "2026-10-01T10:00Z" }, "userId is not a workspace member"],
    ["schedule", { userId: "actor", title: "Work", startsAt: "2026-10-01T09:00Z", endsAt: "2026-10-01T10:00Z", actionId: "foreign" }, "actionId is not available for this scheduled user"],
  ] as any[]) {
    const f = errorFixture(); if (value.actionId) f.state.tables.set(f.load("@/lib/db/schema").memberships, [{ userId: "actor" }]);
    const { value: response, logs } = await diagnostics(() => f.call("v1/[resource]", "POST", { resource, value })); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: message, resource }); assert.deepEqual(logs, []); assert.equal(f.state.writes, 0); assert.deepEqual(f.usage, [{ context: f.context, status: 400 }]);
  }
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const f = errorFixture(); const response = await f.call("v1/[resource]", method, { resource: "billing" }); assert.equal(response.status, method === "GET" ? 404 : 405); assert.deepEqual(await response.json(), { error: method === "GET" ? "Unknown API resource" : method === "DELETE" ? "Resource is not deletable" : "Resource is not writable" }); assert.equal(f.usage.length, 0); assert.equal(f.state.writes, 0);
  }
});

test("diagnostic emitter rejection cannot replace safe response", async () => {
  const f = errorFixture(); f.state.failAuth = true; f.state.error = new Error("private"); const original = console.error;
  console.error = () => { throw new Error("logger unavailable"); };
  try { const response = await f.call("projects", "GET"); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "We couldn't load your projects. Please try again." }); } finally { console.error = original; }
});

for (const action of ["pause", "resume"]) test(`accepted ${action} contract keeps actual auth, malformed400 and later-helper SyntaxError500`, async () => {
  const f = errorFixture(); const route = `timer/${action}`;
  for (const raw of ["{", ""]) { const response = await f.call(route, "POST", { raw }); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "Send a valid JSON request." }); }
  f.state.failDb = true; f.state.error = new SyntaxError("private DB");
  const response = await f.call(route, "POST", { value: { entryId: "entry" } }); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: `Could not ${action} this timer. Please try again.` });
  f.state.failAuth = true;
  for (const [error, status, message] of [[new f.classes.UnauthorizedError("private"), 401, "Please sign in again."], [new f.classes.ForbiddenError("private"), 403, "Your workspace role cannot perform this action."]] as any[]) { f.state.error = error; const response = await f.call(route, "POST"); assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: message }); }
});

test("existing safe auth service-unavailable503 and verification redirect contracts are regression-only", async () => {
  const f = errorFixture(); f.state.failAuth = true; f.state.error = new Error("private DB");
  for (const method of ["GET", "POST"]) { const { value } = await diagnostics(() => f.call("auth/workspaces", method)); assert.equal(value.status, 503); assert.deepEqual(await value.json(), { error: "We couldn't load your workspaces. Please try again." }); }
  f.dependencies["@/lib/auth"].checkMagicLinkEligibility = async () => { throw f.state.error; };
  const start = await diagnostics(() => f.call("auth/request-link", "POST", { value: { email: "fixture@example.com" } })); assert.equal(start.value.status, 503); assert.deepEqual(await start.value.json(), { error: "We couldn't start sign-in. Please try again in a few minutes." });
  f.dependencies["@/lib/auth"].consumeMagicLink = async () => { throw f.state.error; };
  const verify = await diagnostics(() => f.call("auth/verify", "GET", { query: "token=synthetic" })); assert.equal(verify.value.status, 307); assert.equal(new URL(verify.value.headers.get("location")!).searchParams.get("error"), "service_unavailable");
});

test("export actual invalid-date400 and successful CSV/JSON bytes retain integrity digests", async () => {
  const f = errorFixture(); const invalid = await diagnostics(() => f.call("export/csv", "GET", { query: "start=not-a-date" }));
  assert.equal(invalid.value.status, 400); assert.deepEqual(await invalid.value.json(), { error: "Choose a valid date or a timestamp with a timezone." }); assert.deepEqual(invalid.logs, []);
  for (const format of ["json", "csv"]) {
    const response = await f.call("export/csv", "GET", { query: `format=${format}` }); assert.equal(response.status, 200);
    const bytes = await response.text(); assert.equal(response.headers.get("x-sowledger-export-sha256"), createHash("sha256").update(bytes).digest("hex")); assert.match(response.headers.get("content-type")!, format === "csv" ? /^text\/csv/ : /^application\/json/);
    if (format === "csv") assert.equal(bytes, ""); else { const json = JSON.parse(bytes); assert.deepEqual(json.timeEntries, []); assert.equal(Object.hasOwn(json, "apiKeys"), false); }
  }
});

test("invoice adapter retains only concrete InvoiceAmountError422 additive code envelope", async () => {
  const f = errorFixture(), { InvoiceAmountError } = f.load("@/lib/invoice-amount");
  for (const error of [new InvoiceAmountError(), { status: 422, code: "INVOICE_AMOUNT_NOT_REPRESENTABLE", message: "private shaped" }]) {
    f.state.failAuth = true; f.state.error = error;
    const { value, logs } = await diagnostics(() => f.call("invoices", "POST"));
    assert.equal(value.status, error instanceof InvoiceAmountError ? 422 : 500); assert.deepEqual(await value.json(), error instanceof InvoiceAmountError ? { error: "This total cannot be stored without changing a cent. No invoice was created and your time remains approved. Choose a smaller selection or contact your workspace administrator.", code: "INVOICE_AMOUNT_NOT_REPRESENTABLE" } : { error: "We couldn't confirm the invoice was saved. Refresh your invoices before trying again." }); assertDiagnostic(logs, "/api/invoices", "POST", error instanceof InvoiceAmountError ? 0 : 1);
  }
});

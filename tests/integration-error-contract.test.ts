/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled actual modules, never real providers or DB. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { errorFixture, diagnostics, assertDiagnostic } from "./helpers/error-boundary-fixtures";
import * as schema from "../lib/db/schema";

const unavailable = "The integration provider could not complete the request. Try again later.";
const invalid = "The integration provider returned an incomplete or invalid response. Review the integration before trying again.";
export const integrationMethods: Array<[string, string, string]> = [
  ["integrations", "GET", "We couldn't load your integrations. Please try again."],
  ["integrations/[provider]/config", "PATCH", "We couldn't confirm the integration settings were saved. Reload your integrations before trying again."],
  ["integrations/[provider]/disconnect", "POST", "We couldn't confirm the integration was disconnected. Reload your integrations before trying again."],
  ["integrations/[provider]/test", "POST", "We couldn't test this integration. Please try again."],
  ["integrations/slack/manual", "POST", "We couldn't confirm Slack was connected. Reload your integrations before trying again."],
  ["integrations/quickbooks/push-invoice", "POST", "We couldn't confirm the invoice push. Check QuickBooks and your integrations before trying again."],
  ["integrations/google-calendar/sync", "POST", "We couldn't confirm the calendar sync. Review your calendar and integrations before trying again."],
  ...["google-calendar", "slack", "quickbooks"].map((p, i) => [`integrations/${p}/oauth/start`, "GET", `We couldn't start ${["Google Calendar", "Slack", "QuickBooks"][i]} setup. Please try again.`] as [string, string, string]),
];
function fixture() { return errorFixture({ integrations: true }); }
const connection = (provider: string) => ({ id: "connection", workspaceId: "workspace", createdByUserId: "actor", provider, status: "connected", config: { connectionGeneration: "generation", realmId: "realm", environment: "sandbox" }, credentials: { accessToken: "synthetic", refreshToken: "synthetic", webhookUrl: "https://hooks.slack.com/synthetic" }, tokenExpiresAt: new Date(Date.now() + 3600000), lastError: null });
function configured(f: ReturnType<typeof fixture>) { Object.assign(f.dependencies["@/lib/env"].env, { GOOGLE_CALENDAR_CLIENT_ID: "synthetic", GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic", SLACK_CLIENT_ID: "synthetic", SLACK_CLIENT_SECRET: "synthetic", QUICKBOOKS_CLIENT_ID: "synthetic", QUICKBOOKS_CLIENT_SECRET: "synthetic" }); }

for (const [route, method, fallback] of integrationMethods) test(`${route} ${method}: exact safe JSON boundary and actual auth`, async () => {
  const f = fixture(); f.state.failAuth = true;
  for (const error of [new Error("private marker"), new SyntaxError("private SQL"), { status: 503, name: "GoogleRequestError", message: "private marker" }, null, "private primitive"]) {
    f.state.error = error;
    const { value, logs } = await diagnostics(() => f.call(route, method));
    assert.equal(value.status, 500); assert.deepEqual(await value.json(), { error: fallback }); assertDiagnostic(logs, `/api/${route}`, method);
  }
  for (const [error, status, copy] of [[new f.classes.UnauthorizedError("private"), 401, "Please sign in again."], [new f.classes.ForbiddenError("private"), 403, "Your workspace role cannot perform this action."]] as any[]) {
    f.state.error = error; const { value, logs } = await diagnostics(() => f.call(route, method)); assert.equal(value.status, status); assert.deepEqual(await value.json(), { error: copy }); assert.deepEqual(logs, []);
  }
});

for (const [route, method, fallback] of integrationMethods.filter(([r]) => ["integrations/[provider]/config", "integrations/slack/manual", "integrations/quickbooks/push-invoice", "integrations/google-calendar/sync"].includes(r))) test(`${route}: narrow JSON provenance, no provider operation on malformed body`, async () => {
  const f = fixture(); let calls = 0; f.state.fetch = async () => { calls++; throw new Error("private"); };
  for (const raw of ["", "{", "null", "[]", "1", "true", '"private"']) {
    const { value, logs } = await diagnostics(() => f.call(route, method, { raw }));
    assert.equal(value.status, 400); assert.deepEqual(await value.json(), { error: raw === "" || raw === "{" ? "Send a valid JSON request." : "Send a JSON object." }); assert.deepEqual(logs, []);
    assert.equal(calls, 0); assert.equal(f.state.writes, 0);
  }
  const io = await diagnostics(() => f.call(route, method, { bodyError: new Error("private read I/O") })); assert.equal(io.value.status, 500); assert.deepEqual(await io.value.json(), { error: fallback }); assertDiagnostic(io.logs, `/api/${route}`, method);
  const later = await diagnostics(() => f.call(route, method, { value: route.includes("manual") ? { webhookUrl: "https://hooks.slack.com/synthetic" } : { invoiceId: "invoice" }, afterJson: () => { f.state.failDb = true; f.state.error = new SyntaxError("private DB"); f.state.dns = f.state.error; } }));
  assert.equal(later.value.status, 500); assert.deepEqual(await later.value.json(), { error: fallback }); assertDiagnostic(later.logs, `/api/${route}`, method);
});

const providers = [["google_calendar", "google-calendar", "Google Calendar", "testGoogleCalendarConnection", "exchangeGoogleAuthorizationCode"], ["slack", "slack", "Slack", "testSlackConnection", "exchangeSlackAuthorizationCode"], ["quickbooks", "quickbooks", "QuickBooks", "testQuickBooksConnection", "exchangeQuickBooksAuthorizationCode"]];
for (const [provider, file, label, testName, exchange] of providers) {
  test(`${label}: actual fetch HTTP/body/transport provenance reaches actual test handler`, async () => {
    const f = fixture(); configured(f); f.state.rows = [connection(provider)];
    for (const status of [400, 401, 403, 404, 409, 410, 412, 429, 500, 502, 503]) {
      f.state.fetch = async () => new Response("private malformed payload", { status });
      const { value, logs } = await diagnostics(() => f.call("integrations/[provider]/test", "POST", { provider }));
      assert.equal(value.status, status); assert.deepEqual(await value.json(), { error: status === 401 ? "The integration's authorization expired or was rejected. Reconnect it and try again." : status === 403 ? "The connected account does not have permission for this action. Check its permissions or reconnect it." : status === 429 ? "The integration is temporarily rate limited. Wait before trying again." : status >= 500 ? unavailable : "The integration provider rejected this request. Review the connection settings before trying again." }); assertDiagnostic(logs, "/api/integrations/[provider]/test", "POST", 1, "upstream");
    }
    for (const body of ["private invalid JSON", "null", "[]", "{}", ...(provider === "google_calendar" ? ['{"kind":"calendar#events","items":[{}]}', '{"kind":"calendar#events","items":[{"id":" "}]}'] : [])] ) {
      f.state.fetch = async () => new Response(body);
      const { value, logs } = await diagnostics(() => f.call("integrations/[provider]/test", "POST", { provider })); assert.equal(value.status, 502); assert.deepEqual(await value.json(), { error: invalid }); assertDiagnostic(logs, "/api/integrations/[provider]/test", "POST", 1, "upstream");
    }
    f.state.fetch = async () => { throw Object.assign(new Error("private network"), { name: "TimeoutError", status: 504 }); };
    const network = await diagnostics(() => f.call("integrations/[provider]/test", "POST", { provider })); assert.equal(network.value.status, 502); assert.deepEqual(await network.value.json(), { error: unavailable }); assertDiagnostic(network.logs, "/api/integrations/[provider]/test", "POST", 1, "upstream");
    f.state.rows = []; await assert.rejects(f.load(`@/lib/integrations/${file}`)[testName]("workspace"), (e: any) => e instanceof f.workflow.WorkflowError && e.status === 404 && e.message === `${label} is not connected`);
  });
  test(`${label}: actual OAuth exchange rejects incomplete credentials and preserves HTTP before parsing`, async () => {
    const f = fixture(); configured(f); const implementation = f.load(`@/lib/integrations/${file}`);
    for (const body of ["null", "[]", "{}", '{"error":"private marker"}']) { f.state.fetch = async () => new Response(body); await assert.rejects(implementation[exchange]("code"), (e: any) => e.status === 502 && e.message === invalid); }
    f.state.fetch = async () => new Response("private", { status: 403 }); await assert.rejects(implementation[exchange]("code"), (e: any) => e.status === 403 && !e.message.includes("private"));
    if (provider !== "slack") for (const fields of [{ expires_in: {} }, { expires_in: null }, { refresh_token: 42 }, { token_type: [] }]) {
      f.state.fetch = async () => Response.json({ access_token: "synthetic", refresh_token: "synthetic", ...fields });
      await assert.rejects(implementation[exchange]("code"), (e: any) => e.status === 502 && e.message === invalid);
    }
  });
  test(`${label}: actual historical DTO/GET and safe alternate storage inputs`, async () => {
    const f = fixture(); const c = connection(provider); const helpers = f.load("@/lib/integrations/connections");
    const summary = provider === "google_calendar" ? "Google Calendar sync failed. Review the connection and try again." : provider === "slack" ? "Slack delivery failed. Review the connection and try again." : "QuickBooks request failed. Review the connection before trying again.";
    for (const lastError of ["private historic token", " ", "seemingly safe"]) {
      f.state.rows = [{ ...c, lastError }]; const result = await f.call("integrations", "GET"); const dto = (await result.json()).connections[0]; assert.equal(dto.lastError, summary); assert.equal("credentials" in dto, false);
    }
    for (const lastError of [null, ""]) assert.equal(helpers.toPublicConnection({ ...c, lastError }).lastError, null);
    f.state.rows = [c]; await helpers.markIntegrationError(c, "unexpected"); assert.equal(f.state.written.at(-1).lastError, summary);
    await helpers.upsertIntegrationConnection({ workspaceId: "workspace", provider, createdByUserId: "actor", lastError: "upstream" }); assert.equal(f.state.written.at(-1).lastError, summary);
    await helpers.upsertSyncRecord({ workspaceId: "workspace", connectionId: "connection", provider, resourceType: "invoice", resourceId: "invoice", externalId: "external", lastError: "unexpected" }); assert.equal(f.state.written.at(-1).lastError, summary);
    await helpers.markIntegrationSynced(c); assert.equal(f.state.written.at(-1).lastError, null);
    f.state.failDb = true; f.state.error = new Error("private storage"); await assert.rejects(helpers.markIntegrationError(c, "unexpected"), /private storage/);
  });
  test(`${label}: callbacks fixed redirects, denial/state/session/role ordering and safe unknown failure`, async () => {
    const f = fixture(); configured(f); const state = f.load("@/lib/integrations/oauth-state"); const route = `integrations/${file}/oauth/callback`;
    const restart = `${label} setup was not completed. Start the connection again.`;
    async function check(query: string, copy: string, category?: "upstream" | "unexpected", login = false) {
      const { value, logs } = await diagnostics(() => f.call(route, "GET", { query })); assert.equal(value.status, 307); const url = new URL(value.headers.get("location")!); assert.equal(url.pathname, login ? "/login" : "/integrations"); assert.deepEqual(Object.fromEntries(url.searchParams), login ? { error: copy } : { error: provider, message: copy }); if (category) assertDiagnostic(logs, `/api/${route}`, "GET", 1, category); else assert.deepEqual(logs, []);
    }
    let exchanged = 0; const mod = f.load(`@/lib/integrations/${file}`); f.dependencies[`@/lib/integrations/${file}`] = { ...mod, [exchange]: async () => { exchanged++; throw new Error("private token/storage"); } };
    await check("error=private%20marker", restart); await check("error=", restart); await check("code=synthetic", restart); await check("code=c&state=invalid&realmId=r", restart);
    for (const identity of [{ workspaceId: "foreign", userId: "actor" }, { workspaceId: "workspace", userId: "foreign" }]) { const signed = state.createIntegrationOAuthState({ provider, returnTo: "/integrations", ...identity }); await check(`code=c&state=${signed}&realmId=r`, restart); }
    assert.equal(exchanged, 0);
    const signed = state.createIntegrationOAuthState({ provider, workspaceId: "workspace", userId: "actor", returnTo: "/integrations" }); const query = `code=c&state=${signed}&realmId=r`;
    f.state.failAuth = true; f.state.error = new f.classes.UnauthorizedError("private"); await check(query, provider === "google_calendar" ? "Your session expired during the Google Calendar setup. Please log in and try again." : `Your session expired during ${label} setup. Please log in and try again.`, undefined, true);
    f.state.error = new f.classes.ForbiddenError("private"); await check(query, `${label} setup needs workspace manager permission. Start the connection again.`); assert.equal(exchanged, 0);
    f.state.failAuth = false; await check(query, `We couldn't complete ${label} setup. Start the connection again.`, "unexpected"); assert.equal(exchanged, 1);
    f.dependencies["@/lib/env"].env.AUTH_COOKIE_SECRET = undefined; await check(query, `We couldn't complete ${label} setup. Start the connection again.`, "unexpected");
  });
}

test("actual OAuth state parser rejects signed invalid shapes/expiry/identity and extra segments", () => {
  const f = fixture(); const state = f.load("@/lib/integrations/oauth-state");
  const base = { provider: "slack", workspaceId: "workspace", userId: "actor", returnTo: "/integrations", exp: Date.now() + 600000 };
  function signed(value: any) { const raw = Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url"); return `${raw}.${createHmac("sha256", f.dependencies["@/lib/env"].env.AUTH_COOKIE_SECRET).update(raw).digest("hex")}`; }
  for (const value of [null, [], "{", {}, { ...base, exp: null }, { ...base, exp: Date.now() }, { ...base, workspaceId: " " }, { ...base, userId: 1 }, { ...base, returnTo: null }, { ...base, provider: "quickbooks" }]) assert.throws(() => state.verifyIntegrationOAuthState(signed(value), "slack"), (e: any) => e instanceof state.IntegrationOAuthStateError);
  const valid = signed(base); assert.throws(() => state.verifyIntegrationOAuthState(valid + ".extra", "slack")); assert.deepEqual(state.verifyIntegrationOAuthState(valid, "slack"), base);
});

test("Google sync valid empty object retains default window, incomplete range400 and busy409 stay distinct", async () => {
  const f = fixture(); const c = connection("google_calendar"); f.state.rows = [c];
  f.state.tables.set(schema.integrationConnections, [c]); f.state.tables.set(schema.scheduledWorkBlocks, []); f.state.tables.set(schema.integrationSyncRecords, []);
  let calls = 0; f.state.fetch = async () => { calls++; return Response.json({ kind: "calendar#events", items: [] }); };
  const busy = await diagnostics(() => f.call("integrations/google-calendar/sync", "POST", { value: {} })); assert.equal(busy.value.status, 409); assert.deepEqual(await busy.value.json(), { error: "Google Calendar is already syncing for this workspace. Wait a moment and try again." }); assert.equal(calls, 0); assert.equal(f.state.writes, 0); assert.deepEqual(busy.logs, []);
  f.db.execute = async () => ({ rows: [{ acquired: true }] });
  const partial = await diagnostics(() => f.call("integrations/google-calendar/sync", "POST", { value: { start: "2026-10-02T10:00:00Z" } })); assert.equal(partial.value.status, 400); assert.deepEqual(await partial.value.json(), { error: "Provide both start and end for a Google Calendar sync date range." }); assert.equal(calls, 0); assert.deepEqual(partial.logs, []);
  const accepted = await f.call("integrations/google-calendar/sync", "POST", { value: {} }); assert.equal(accepted.status, 200); const body = await accepted.json();
  const start = new Date(); start.setDate(start.getDate() - 14); start.setHours(0, 0, 0, 0); const end = new Date(); end.setDate(end.getDate() + 60); end.setHours(23, 59, 59, 999);
  assert.equal(body.result.start, start.toISOString()); assert.equal(body.result.end, end.toISOString()); assert.equal(calls, 1);
});

for (const [provider, file, label] of providers) test(`${label}: actual exchange upstream failure uses one safe callback diagnostic`, async () => {
  const f = fixture(); configured(f); const state = f.load("@/lib/integrations/oauth-state"); const signed = state.createIntegrationOAuthState({ provider, workspaceId: "workspace", userId: "actor", returnTo: "/integrations" });
  f.state.fetch = async () => new Response("private provider token details", { status: 503 }); const route = `integrations/${file}/oauth/callback`;
  const result = await diagnostics(() => f.call(route, "GET", { query: `code=c&state=${signed}&realmId=r` })); assert.equal(result.value.status, 307); const url = new URL(result.value.headers.get("location")!); assert.deepEqual(Object.fromEntries(url.searchParams), { error: provider, message: `We couldn't complete ${label} setup. Start the connection again.` }); assertDiagnostic(result.logs, `/api/${route}`, "GET", 1, "upstream"); assert.equal(f.state.writes, 0);
});

test("Google sync malformed provider time/identity types fail502 with no reconciliation", async () => {
  const f = fixture(); const c = connection("google_calendar"); configured(f); f.state.rows = [c];
  f.state.tables.set(schema.integrationConnections, [c]); f.state.tables.set(schema.scheduledWorkBlocks, []); f.state.tables.set(schema.integrationSyncRecords, []);
  f.db.execute = async () => ({ rows: [{ acquired: true }] });
  for (const event of [
    { id: "e", start: { dateTime: 4 }, end: { dateTime: "2026-10-02T12:00:00Z" } },
    { id: "e", start: { date: [] }, end: { date: "2026-10-02" } },
    { id: "e", start: { dateTime: ["2026-10-02T10:00:00Z"] }, end: { dateTime: "2026-10-02T12:00:00Z" } },
    { id: "e", start: { date: ["2026-10-02"], timeZone: ["UTC"] }, end: { date: "2026-10-03" } },
    { id: "e", start: { dateTime: "2026-10-02T10:00:00", timeZone: "invalid timezone" }, end: { dateTime: "2026-10-02T12:00:00Z" } },
    { id: " ", start: { dateTime: "2026-10-02T10:00:00Z" }, end: { dateTime: "2026-10-02T12:00:00Z" } },
  ]) {
    f.state.fetch = async () => Response.json({ kind: "calendar#events", timeZone: "UTC", items: [event] });
    const { value, logs } = await diagnostics(() => f.call("integrations/google-calendar/sync", "POST", { value: {} }));
    assert.equal(value.status, 502); assert.deepEqual(await value.json(), { error: invalid }); assertDiagnostic(logs, "/api/integrations/google-calendar/sync", "POST", 1, "upstream");
    assert.ok(f.state.written.every((value: any) => value.status === "error"));
  }
});

test("provider timeout needs actual owned signal evidence; body-read faults stay narrow", async () => {
  const f = fixture(); const errors = f.load("@/lib/integrations/errors");
  for (const [reason, status] of [[new DOMException("private deadline", "TimeoutError"), 504], [new Error("private cancellation"), 502]] as const) {
    const controller = new AbortController(); controller.abort(reason);
    f.state.fetch = async () => { throw new Error("private fetch"); };
    await assert.rejects(errors.integrationFetch("slack", "https://fixture.test", { signal: controller.signal }), (e: any) => e.status === status && e.message === unavailable);
    const response = new Response("synthetic"); response.text = async () => { throw new Error("private body I/O"); };
    await assert.rejects(errors.integrationResponseJson("slack", response, controller.signal), (e: any) => e.status === status && e.message === unavailable);
  }
});

test("Google outbound response requires a nonblank string event identity before receipt/success", async () => {
  const f = fixture(); const c = connection("google_calendar"); configured(f); f.state.rows = [c];
  f.state.tables.set(schema.integrationConnections, [c]); f.state.tables.set(schema.integrationSyncRecords, []);
  f.state.tables.set(schema.scheduledWorkBlocks, [{ id: "block", workspaceId: "workspace", status: "planned", tags: [], startsAt: new Date(), endsAt: new Date(Date.now() + 3600000), title: "Plan" }]);
  f.db.execute = async () => ({ rows: [{ acquired: true }] });
  for (const id of [42, " "]) {
    f.state.fetch = async (_url, init) => init.method === "POST" ? Response.json({ id }) : Response.json({ kind: "calendar#events", items: [] });
    const { value, logs } = await diagnostics(() => f.call("integrations/google-calendar/sync", "POST", { value: {} }));
    assert.equal(value.status, 502); assert.deepEqual(await value.json(), { error: invalid }); assertDiagnostic(logs, "/api/integrations/google-calendar/sync", "POST", 1, "upstream");
    assert.ok(f.state.written.every((value: any) => value.status === "error"));
  }
});

test("Slack accepted send survives timestamp failure; failed send plus failed error storage stays failed", async () => {
  const f = fixture(); f.state.rows = [connection("slack")]; f.state.failDb = false;
  const helpers = f.load("@/lib/integrations/connections"); f.dependencies["@/lib/integrations/connections"] = { ...helpers, markIntegrationSynced: async () => { throw new Error("private timestamp"); }, markIntegrationError: async () => { throw new Error("private storage"); } };
  const slack = f.load("@/lib/integrations/slack");
  f.state.fetch = async () => new Response("ok"); const accepted = await diagnostics(() => slack.notifySlack("workspace", "event", { title: "synthetic" })); assert.deepEqual(accepted.value, { status: "sent" }); assert.deepEqual(accepted.logs, []);
  f.state.fetch = async () => new Response("private rejected", { status: 500 }); const failed = await diagnostics(() => slack.notifySlack("workspace", "event", { title: "synthetic" })); assert.deepEqual(failed.value, { status: "failed" }); assert.deepEqual(failed.logs, []);
});

test("Slack/QuickBooks config disabled404 and missing RETURNING row safe failure, nullish defaults retained", async () => {
  for (const provider of ["slack", "quickbooks"]) {
    const f = fixture(); const c = { ...connection(provider), config: { customerRefId: "customer", serviceItemRefId: "item" }, lastError: "private historical" }; f.state.rows = [c]; const helpers = f.load("@/lib/integrations/connections");
    f.dependencies["@/lib/integrations/connections"] = { ...helpers, getIntegrationConnection: async () => c };
    const saved = await f.call("integrations/[provider]/config", "PATCH", { provider, value: provider === "slack" ? { events: [" event ", "", 42] } : { customerRefId: null, serviceItemRefId: null } });
    assert.equal(saved.status, 200); assert.equal((await saved.json()).connection.lastError.includes("private"), false);
    assert.deepEqual(f.state.written.at(-1).config, provider === "slack" ? { customerRefId: "customer", serviceItemRefId: "item", events: ["event"] } : { customerRefId: "customer", serviceItemRefId: "item" });
    f.state.rows = [];
    let result = await diagnostics(() => f.call("integrations/[provider]/config", "PATCH", { provider, value: {} }));
    assert.equal(result.value.status, provider === "quickbooks" ? 409 : 500);
    if (provider === "quickbooks") {
      assert.deepEqual(await result.value.json(), { error: "QuickBooks connection or credentials changed. Review the current connection before trying again." });
      assert.deepEqual(result.logs, []);
    } else assertDiagnostic(result.logs, "/api/integrations/[provider]/config", "PATCH");
    c.status = "disabled"; result = await diagnostics(() => f.call("integrations/[provider]/config", "PATCH", { provider, value: {} })); assert.equal(result.value.status, 404); assert.deepEqual(result.logs, []);
  }
});

test("actual QuickBooks company-info minimum rejects unusable identities but accepts a distinct realm/Id", async () => {
  const f = fixture(); f.state.rows = [connection("quickbooks")];
  for (const CompanyInfo of [null, [], {}, { Id: 4 }, { Id: " " }]) {
    f.state.fetch = async () => Response.json({ CompanyInfo }); const before = f.state.writes;
    const result = await diagnostics(() => f.call("integrations/[provider]/test", "POST", { provider: "quickbooks" })); assert.equal(result.value.status, 502); assert.deepEqual(await result.value.json(), { error: invalid }); assert.equal(f.state.writes, before);
  }
  f.state.fetch = async () => Response.json({ CompanyInfo: { Id: "different-from-realm" } }); const accepted = await f.call("integrations/[provider]/test", "POST", { provider: "quickbooks" }); assert.equal(accepted.status, 200); assert.equal(f.state.written.at(-1).status, "connected");
});

for (const [provider] of providers) test(`${provider}: DB/crypto faults are unexpected500, never promoted to upstream`, async () => {
  for (const where of ["db", "crypto"]) {
    const f = fixture(); f.state.rows = [connection(provider)]; let calls = 0; f.state.fetch = async () => { calls++; return Response.json({}); };
    if (where === "db") { f.state.failDb = true; f.state.error = Object.assign(new Error("private DB"), { status: 503, name: "TimeoutError" }); }
    else f.dependencies["@/lib/integrations/crypto"].decryptSecret = () => { throw Object.assign(new Error("private crypto"), { status: 403 }); };
    const result = await diagnostics(() => f.call("integrations/[provider]/test", "POST", { provider })); assert.equal(result.value.status, 500); assert.deepEqual(await result.value.json(), { error: "We couldn't test this integration. Please try again." }); assertDiagnostic(result.logs, "/api/integrations/[provider]/test", "POST"); assert.equal(calls, 0);
  }
});

test("Google failed provider plus rejected error storage is safe500, never false sync success", async () => {
  const f = fixture(); const c = connection("google_calendar"); f.state.rows = [c]; f.state.tables.set(schema.integrationConnections, [c]); f.db.execute = async () => ({ rows: [{ acquired: true }] });
  f.state.fetch = async () => { f.state.failDb = true; f.state.error = new Error("private error-storage SQL"); return new Response("private provider body", { status: 503 }); };
  const result = await diagnostics(() => f.call("integrations/google-calendar/sync", "POST", { value: {} })); assert.equal(result.value.status, 500); assert.deepEqual(await result.value.json(), { error: "We couldn't confirm the calendar sync. Review your calendar and integrations before trying again." }); assertDiagnostic(result.logs, "/api/integrations/google-calendar/sync", "POST"); assert.ok(f.state.written.every((v: any) => v.status !== "connected"));
});

test("all named nonnull error-storage inputs reject values outside the closed kinds", async () => {
  const f = fixture(); const c = connection("slack"); f.state.rows = [c]; const helpers = f.load("@/lib/integrations/connections");
  for (const run of [() => helpers.markIntegrationError(c, "private arbitrary marker"), () => helpers.upsertIntegrationConnection({ workspaceId: "workspace", provider: "slack", createdByUserId: "actor", lastError: "private arbitrary marker" }), () => helpers.upsertSyncRecord({ workspaceId: "workspace", connectionId: "connection", provider: "slack", resourceType: "invoice", resourceId: "invoice", externalId: "external", lastError: "private arbitrary marker" })]) {
    await assert.rejects(run(), /Unknown integration failure kind/); assert.equal(f.state.writes, 0);
  }
});

for (const [provider, file, label, , exchange] of providers) test(`${label}: successful callback shape, actual role denial and storage failure`, async () => {
  const f = fixture(); configured(f); const state = f.load("@/lib/integrations/oauth-state"); const mod = f.load(`@/lib/integrations/${file}`);
  const store = provider === "slack" ? "storeSlackOAuthConnection" : provider === "quickbooks" ? "storeQuickBooksConnection" : "storeGoogleCalendarConnection";
  const trace: string[] = [];
  f.dependencies[`@/lib/integrations/${file}`] = { ...mod, [exchange]: async () => { trace.push("exchange"); return { access_token: "synthetic", refresh_token: "synthetic" }; }, [store]: async () => { trace.push("store"); } };
  const signed = state.createIntegrationOAuthState({ provider, workspaceId: "workspace", userId: "actor", returnTo: "https://untrusted.test" }); const query = `code=c&state=${signed}&realmId=r`; const route = `integrations/${file}/oauth/callback`;
  const success = await diagnostics(() => f.call(route, "GET", { query })); assert.equal(success.value.status, 307); const location = new URL(success.value.headers.get("location")!); assert.equal(location.pathname, "/integrations"); assert.deepEqual(Object.fromEntries(location.searchParams), { connected: provider }); assert.deepEqual(trace, ["exchange", "store"]); assert.deepEqual(success.logs, []);
  f.dependencies[`@/lib/integrations/${file}`][store] = async () => { throw new Error("private storage credential"); };
  const failure = await diagnostics(() => f.call(route, "GET", { query })); assert.equal(new URL(failure.value.headers.get("location")!).searchParams.get("message"), `We couldn't complete ${label} setup. Start the connection again.`); assertDiagnostic(failure.logs, `/api/${route}`, "GET");
  f.dependencies["@/lib/auth"].requireSession = async () => ({ sub: "actor", workspaceId: "workspace", role: "member" }); const before = trace.length;
  const denied = await diagnostics(() => f.call(route, "GET", { query })); assert.equal(new URL(denied.value.headers.get("location")!).searchParams.get("message"), `${label} setup needs workspace manager permission. Start the connection again.`); assert.equal(trace.length, before); assert.deepEqual(denied.logs, []);
});

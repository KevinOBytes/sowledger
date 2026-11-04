import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { test as baseTest } from "@playwright/test";
import type { BrowserContext, Request, Response } from "@playwright/test";

// These controlled objects exercise our sanitizer/observer, not browser or Next behavior.
const load = () => import("./helpers/stream-diagnostic-fixture");
const origin = "http://localhost:3008";
const secret = "DO_NOT_PERSIST_workspace-token-SQL";

function request(url = `${origin}/api/settings/tags?workspace=${secret}#${secret}`, overrides: object = {}) {
  const page = {};
  return {
    url: () => url, method: () => "PATCH", resourceType: () => "fetch",
    isNavigationRequest: () => false, frame: () => ({ page: () => page }),
    redirectedFrom: () => null, failure: () => null,
    headerValue: async (name: string) => {
      assert.ok(["rsc", "next-router-prefetch", "purpose", "sec-purpose"].includes(name));
      return name === "rsc" ? "1" : null;
    },
    headers: () => { throw new Error("must not read header maps"); },
    postData: () => { throw new Error("must not read body"); },
    ...overrides,
  } as unknown as Request;
}

async function setup() {
  const observerModule = await load();
  const context = new EventEmitter();
  const snapshots: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const observer = observerModule.createStreamDiagnosticObserver(context as unknown as BrowserContext, {
    baseURL: origin, source: "e2e-professional.spec.ts", line: 42, retry: 0, workerIndex: 0,
    sink: (kind, data) => snapshots.push({ kind, data: JSON.parse(JSON.stringify(data)) }),
  });
  return { context, snapshots, observer };
}

test("observer module is available before any runtime/browser capture", async () => {
  const observerModule = await load().catch(() => null);
  assert.equal(typeof observerModule?.createStreamDiagnosticObserver, "function", "bounded observer is not implemented");
});

test("ordinary imports export the unextended base test when the opt-in flag is absent", async () => {
  assert.notEqual(process.env.SOWLEDGER_STREAM_DIAGNOSTICS, "1", "run pure checks without capture enabled");
  assert.equal((await load()).test, baseTest);
});

test("route templates discard dynamic identity, query, fragments and external hosts", async () => {
  const { routeCategory } = await load();
  assert.equal(routeCategory(`${origin}/projects/${secret}?${secret}#${secret}`, origin), "/projects/:projectId");
  assert.equal(routeCategory(`${origin}/api/projects/${secret}`, origin), "/api/projects/:projectId");
  assert.equal(routeCategory(`${origin}/_next/static/${secret}.js`, origin), "next-asset");
  assert.equal(routeCategory(`https://${secret}.example/api/settings/tags`, origin), "external");
  assert.equal(routeCategory(`${origin}/${secret}`, origin), "unknown");
  assert.equal(routeCategory(secret, origin), "unavailable");
  for (const route of ["/clients", "/planner", "/api/clients"]) assert.equal(routeCategory(`${origin}${route}?${secret}`, origin), route);
});

test("failure text is classified into closed categories without retaining messages", async () => {
  const { failureCategory } = await load();
  for (const [text, want] of [["net::ERR_ABORTED", "canceled"], ["ECONNRESET", "connection-reset"], ["net::ERR_CONNECTION_REFUSED", "connection-refused"], [secret, "other"], [null, "unavailable"]] as const) {
    assert.equal(failureCategory(text), want);
  }
});

test("response headers do not finish a request and teardown retains pending requests", async () => {
  const { context, snapshots, observer } = await setup();
  const req = request();
  context.emit("request", req);
  context.emit("response", { request: () => req, status: () => 503, headerValue: async () => `application/json; ${secret}` } as unknown as Response);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  observer.checkpoint();
  const checkpoint = snapshots[0].data;
  assert.equal(checkpoint.complete, false);
  assert.deepEqual(checkpoint.pendingRequestIds, ["r1"]);
  context.emit("requestfinished", req);
  context.emit("close");
  const final = snapshots.at(-1)!;
  assert.equal(final.kind, "final");
  assert.equal(final.data.complete, true);
  assert.deepEqual(final.data.pendingRequestIds, []);
  const serialized = JSON.stringify(snapshots);
  assert.ok(serialized.includes('"status":503'));
  assert.ok(serialized.includes('"terminal":"finished"'));
  assert.ok(serialized.includes('"contentType":"json"'));
  assert.ok(!serialized.includes(secret));
});

test("page, navigation, failure and context-close lifecycle survives fixture end", async () => {
  const { context, snapshots, observer } = await setup();
  const page = {};
  context.emit("page", page);
  const req = request(undefined, { frame: () => ({ page: () => page }), failure: () => ({ errorText: `ECONNRESET ${secret}` }) });
  context.emit("request", req);
  observer.checkpoint();
  context.emit("framenavigated", { page: () => page, url: () => `${origin}/projects/${secret}`, parentFrame: () => null });
  context.emit("requestfailed", req);
  context.emit("pageclose", page);
  context.emit("close");
  const data = snapshots.at(-1)!.data;
  const events = data.events as Array<{ event: string }>;
  assert.deepEqual(events.map((event) => event.event), ["page", "request", "fixture-end", "navigation", "requestfailed", "pageclose", "contextclose"]);
  assert.ok(JSON.stringify(data).includes('"failure":"connection-reset"'));
  assert.ok(!JSON.stringify(data).includes(secret));
});

test("pending metadata is explicitly unavailable at close and late promises cannot alter final evidence", async () => {
  const { context, snapshots, observer } = await setup();
  let resolve!: (value: string | null) => void;
  const pending = new Promise<string | null>((done) => { resolve = done; });
  const req = request(undefined, { headerValue: () => pending, frame: () => { throw new Error(secret); } });
  context.emit("request", req);
  observer.checkpoint();
  assert.ok(JSON.stringify(snapshots[0]).includes('"rsc":"pending"'));
  context.emit("close");
  const frozen = JSON.stringify(snapshots.at(-1));
  assert.ok(frozen.includes('"unavailable-at-context-close"'));
  assert.ok(frozen.includes('"pageId":"unavailable"'));
  resolve(`1 ${secret}`);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(JSON.stringify(snapshots.at(-1)), frozen);
  assert.equal(snapshots.length, 2);
});

test("rejected header metadata and unknown methods/resources remain closed scalar categories", async () => {
  const { context, snapshots } = await setup();
  const req = request(undefined, { method: () => secret, resourceType: () => secret, headerValue: async () => { throw new Error(secret); } });
  context.emit("request", req);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  context.emit("close");
  const serialized = JSON.stringify(snapshots);
  assert.ok(serialized.includes('"method":"other"'));
  assert.ok(serialized.includes('"resourceType":"other"'));
  assert.ok(serialized.includes('"rsc":"unavailable"'));
  assert.ok(!serialized.includes(secret));
});

test("redirects use object identities and keep each terminal request distinct", async () => {
  const { context, snapshots } = await setup();
  const first = request(`${origin}/dashboard`);
  const second = request(`${origin}/projects`, { redirectedFrom: () => first });
  context.emit("request", first); context.emit("requestfinished", first);
  context.emit("request", second); context.emit("close");
  const data = snapshots[0].data;
  assert.deepEqual(data.pendingRequestIds, ["r2"]);
  assert.ok(JSON.stringify(data).includes('"redirectedFrom":"r1"'));
});

test("sink failures are visible to the caller rather than a clean capture", async () => {
  const { createStreamDiagnosticObserver } = await load();
  const context = new EventEmitter();
  const observer = createStreamDiagnosticObserver(context as unknown as BrowserContext, {
    baseURL: origin, source: "unknown", line: 0, retry: 0, workerIndex: 0,
    sink: () => { throw new Error("controlled sink failure"); },
  });
  assert.throws(() => observer.checkpoint(), /Stream diagnostic persistence failed/);
  assert.throws(() => context.emit("close"), /Stream diagnostic persistence failed/);
});

test("capture includes generated run identity and an explicit metadata-completeness boundary", async () => {
  const { context, snapshots } = await setup();
  context.emit("request", request());
  context.emit("close");
  const data = snapshots[0].data;
  assert.match(String(data.runId), /^[a-f0-9-]{36}$/);
  assert.equal(data.metadataComplete, false);
});

test("resolved RSC/prefetch and response type use booleans and closed categories only", async () => {
  const { context, snapshots } = await setup();
  const req = request(`${origin}/projects/${secret}?${secret}`, {
    headerValue: async (name: string) => name === "sec-purpose" ? `prefetch;prerender` : null,
  });
  context.emit("request", req);
  context.emit("response", { request: () => req, status: () => 200, headerValue: async () => "text/x-component; charset=utf-8" } as unknown as Response);
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  context.emit("requestfinished", req);
  context.emit("close");
  const data = snapshots[0].data;
  assert.equal(data.metadataComplete, true);
  assert.deepEqual(data.requests, [{ id: "r1", pageId: "p1", method: "PATCH", route: "/projects/:projectId", resourceType: "fetch", navigation: false, terminal: "finished", rsc: false, prefetch: true, status: 200, contentType: "rsc" }]);
  assert.ok(!JSON.stringify(data).includes(secret));
});

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { test as baseTest, expect, type BrowserContext, type Page, type Request } from "@playwright/test";

export { expect };

const runId = randomUUID();
const routes = new Set([
  "/", "/login", "/dashboard", "/calendar", "/activity", "/projects", "/settings/tags", "/clients", "/planner",
  "/api/projects", "/api/settings/tags", "/api/calendar", "/api/onboarding", "/api/schedule", "/api/clients",
  "/api/timer/start", "/api/timer/stop", "/api/timer/active", "/api/timer/list", "/api/timer/manual",
  "/api/tasks", "/api/user/actions", "/api/planner", "/api/goals", "/api/tags",
]);
const sources = new Set(["e2e-professional.spec.ts", "project-history.spec.ts", "workflow-interface.spec.ts"]);
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const resources = new Set(["document", "stylesheet", "image", "media", "font", "script", "texttrack", "xhr", "fetch", "eventsource", "websocket", "manifest", "other"]);

/** Input values never leave this function: only fixed code-owned route labels do. */
export function routeCategory(raw: string, baseURL: string | undefined): string {
  try {
    const url = new URL(raw);
    if (!baseURL) return "unavailable";
    if (url.origin !== new URL(baseURL).origin) return "external";
    if (url.pathname.startsWith("/_next/")) return "next-asset";
    if (/^\/projects\/[^/]+$/.test(url.pathname)) return "/projects/:projectId";
    if (/^\/api\/projects\/[^/]+$/.test(url.pathname)) return "/api/projects/:projectId";
    return routes.has(url.pathname) ? url.pathname : "unknown";
  } catch { return "unavailable"; }
}

export function failureCategory(text: string | null): string {
  if (text === null) return "unavailable";
  if (/ERR_ABORTED|\bcancel(?:ed|led)?\b|\baborted\b/i.test(text)) return "canceled";
  if (/ECONNRESET|ERR_CONNECTION_RESET/i.test(text)) return "connection-reset";
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) return "connection-refused";
  return "other";
}

type Metadata = boolean | "pending" | "unavailable" | "unavailable-at-context-close";
type ContentType = "pending" | "unavailable" | "unavailable-at-context-close" | "absent" | "rsc" | "html" | "json" | "javascript" | "css" | "other";
type RequestRecord = {
  id: string; pageId: string; method: string; route: string; resourceType: string; navigation: boolean;
  redirectedFrom?: string; status?: number; terminal: "pending" | "finished" | "failed";
  failure?: string; rsc: Metadata; prefetch: Metadata; contentType?: ContentType;
};
type EventRecord = { event: string; sequence: number; elapsedMs: number; requestId?: string; pageId?: string; route?: string; mainFrame?: boolean; pendingRequestIds?: string[] };
type Snapshot = Record<string, unknown>;
type ObserverOptions = {
  baseURL: string | undefined; source: string; line: number; retry: number; workerIndex: number;
  sink: (kind: "checkpoint" | "final", data: Snapshot) => void;
};

/** Public, read-only browser-context events only; APIRequestContext/DB calls are not covered. */
export function createStreamDiagnosticObserver(context: BrowserContext, options: ObserverOptions) {
  const started = performance.now();
  const wallClockAnchor = new Date().toISOString();
  const testId = randomUUID();
  const pages = new Map<Page, string>();
  const requests = new Map<Request, RequestRecord>();
  const events: EventRecord[] = [];
  let closed = false;
  let pendingMetadata = 0;
  let metadataUnavailableAtClose = 0;

  function pageId(page: Page): string {
    if (!pages.has(page)) pages.set(page, `p${pages.size + 1}`);
    return pages.get(page)!;
  }
  function pendingRequestIds() {
    return [...requests.values()].filter((record) => record.terminal === "pending").map((record) => record.id);
  }
  function event(name: string, fields: Omit<EventRecord, "event" | "sequence" | "elapsedMs"> = {}) {
    events.push({ event: name, sequence: events.length + 1, elapsedMs: Math.round((performance.now() - started) * 1000) / 1000, ...fields });
  }
  function recordFor(request: Request): RequestRecord {
    const existing = requests.get(request);
    if (existing) return existing;
    let owner = "unavailable";
    try { owner = pageId(request.frame().page()); } catch { /* Worker/early navigation can lack a frame. */ }
    const method = request.method();
    const resourceType = request.resourceType();
    const record: RequestRecord = {
      id: `r${requests.size + 1}`, pageId: owner,
      method: methods.has(method) ? method : "other", route: routeCategory(request.url(), options.baseURL),
      resourceType: resources.has(resourceType) ? resourceType : "other", navigation: request.isNavigationRequest(),
      terminal: "pending", rsc: "pending", prefetch: "pending",
    };
    requests.set(request, record);
    const predecessor = request.redirectedFrom();
    if (predecessor) record.redirectedFrom = recordFor(predecessor).id;
    return record;
  }
  function enrich<T>(read: () => Promise<T>, apply: (value: T) => void, unavailable: () => void) {
    pendingMetadata += 1;
    // Never await network from the event handler or hold browser closure open.
    void read().then((value) => { if (!closed) apply(value); }, () => { if (!closed) unavailable(); }).finally(() => { pendingMetadata -= 1; });
  }
  function persist(kind: "checkpoint" | "final") {
    try {
      options.sink(kind, {
        schemaVersion: 1, runId, testId, source: sources.has(options.source) ? options.source : "unknown",
        line: Number.isSafeInteger(options.line) ? options.line : 0,
        retry: options.retry, workerIndex: options.workerIndex, wallClockAnchor,
        complete: closed, pendingRequestIds: pendingRequestIds(), pendingMetadata,
        metadataComplete: [...requests.values()].every((record) => typeof record.rsc === "boolean" && typeof record.prefetch === "boolean" && (record.contentType === undefined || !["pending", "unavailable", "unavailable-at-context-close"].includes(record.contentType))),
        metadataUnavailableAtClose, requests: [...requests.values()], events,
      });
    } catch { throw new Error("Stream diagnostic persistence failed; capture is incomplete"); }
  }

  context.on("page", (page) => event("page", { pageId: pageId(page) }));
  context.on("framenavigated", (frame) => event("navigation", {
    pageId: pageId(frame.page()), route: routeCategory(frame.url(), options.baseURL), mainFrame: frame.parentFrame() === null,
  }));
  context.on("pageclose", (page) => event("pageclose", { pageId: pageId(page), pendingRequestIds: pendingRequestIds() }));
  context.on("request", (request) => {
    const record = recordFor(request);
    event("request", { requestId: record.id, pageId: record.pageId });
    enrich(() => request.headerValue("rsc"), (value) => { record.rsc = value === "1"; }, () => { record.rsc = "unavailable"; });
    enrich(() => Promise.all([request.headerValue("next-router-prefetch"), request.headerValue("purpose"), request.headerValue("sec-purpose")]),
      ([next, purpose, secPurpose]) => { record.prefetch = next === "1" || purpose?.toLowerCase() === "prefetch" || /(?:^|[,;\s])prefetch(?:$|[,;\s])/.test(secPurpose?.toLowerCase() ?? ""); },
      () => { record.prefetch = "unavailable"; });
  });
  context.on("response", (response) => {
    const record = recordFor(response.request());
    const status = response.status();
    record.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
    record.contentType = "pending";
    event("response", { requestId: record.id, pageId: record.pageId });
    enrich(() => response.headerValue("content-type"), (value) => {
      const mime = value?.split(";", 1)[0].trim().toLowerCase();
      record.contentType = !mime ? "absent" : mime === "text/x-component" ? "rsc" : mime === "text/html" ? "html" : mime === "application/json" ? "json" : ["application/javascript", "text/javascript"].includes(mime) ? "javascript" : mime === "text/css" ? "css" : "other";
    }, () => { record.contentType = "unavailable"; });
  });
  context.on("requestfinished", (request) => {
    const record = recordFor(request);
    record.terminal = "finished";
    event("requestfinished", { requestId: record.id, pageId: record.pageId });
  });
  context.on("requestfailed", (request) => {
    const record = recordFor(request);
    record.terminal = "failed";
    record.failure = failureCategory(request.failure()?.errorText ?? null);
    event("requestfailed", { requestId: record.id, pageId: record.pageId });
  });
  context.on("close", () => {
    closed = true;
    metadataUnavailableAtClose = pendingMetadata;
    for (const record of requests.values()) {
      if (record.rsc === "pending") record.rsc = "unavailable-at-context-close";
      if (record.prefetch === "pending") record.prefetch = "unavailable-at-context-close";
      if (record.contentType === "pending") record.contentType = "unavailable-at-context-close";
    }
    event("contextclose", { pendingRequestIds: pendingRequestIds() });
    persist("final");
  });
  return { checkpoint() { event("fixture-end", { pendingRequestIds: pendingRequestIds() }); persist("checkpoint"); } };
}

const observedTest = () => baseTest.extend<{ streamDiagnosticObserver: void }>({
  streamDiagnosticObserver: [async ({ context, baseURL }, runFixture, testInfo) => {
    const observer = createStreamDiagnosticObserver(context, {
      baseURL, source: basename(testInfo.file), line: testInfo.line, retry: testInfo.retry, workerIndex: testInfo.workerIndex,
      sink: (kind, data) => {
        const path = testInfo.outputPath(`stream-diagnostic-${kind}.json`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
      },
    });
    try { await runFixture(); } finally { observer.checkpoint(); }
    // Intentionally leave listeners attached: dependent context teardown comes next.
  }, { auto: true }],
});

// Ordinary test imports are exactly the original base test, without extra fixtures.
export const test = process.env.SOWLEDGER_STREAM_DIAGNOSTICS === "1" ? observedTest() : baseTest;

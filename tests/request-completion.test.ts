import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { Page, Request, Response } from "@playwright/test";

const load = () => import("./helpers/request-completion");
const pageURL = "http://localhost:3008/settings/tags";
function response(options: { url?: string; method?: string; body?: unknown; headers?: Record<string, string>; contentType?: string; status?: number; failure?: string; finished?: () => Promise<Error | null> } = {}) {
  const req = {
    method: () => options.method ?? "GET", postDataJSON: () => Object.hasOwn(options, "body") ? options.body : {}, isNavigationRequest: () => false,
    headerValue: async (name: string) => options.headers?.[name] ?? (name === "rsc" ? "1" : null),
    failure: () => options.failure ? { errorText: options.failure } : null,
  } as unknown as Request;
  return { url: () => options.url ?? pageURL, request: () => req, status: () => options.status ?? 200,
    headerValue: async (name: string) => name === "content-type" ? options.contentType ?? "text/x-component; charset=utf-8" : null,
    finished: options.finished ?? (async () => null),
  } as unknown as Response;
}

test("test completion helper exists independently of the observer", async () => {
  const helper = await load().catch(() => null);
  assert.equal(typeof helper?.mutationResponse, "function", "request completion helper is not implemented");
});

test("mutation matching requires exact origin/path/method and intended scalar identity", async () => {
  const { mutationResponse } = await load();
  assert.equal(response({ body: null }).request().postDataJSON(), null, "the fixture must preserve explicitly supplied null");
  const matches = mutationResponse(pageURL, "/api/settings/tags", "PATCH", { tagId: "intended-tag", projectId: "intended-project", isSOWLedgerDefault: false });
  const body = { tagId: "intended-tag", projectId: "intended-project", isSOWLedgerDefault: false, extra: "allowed" };
  assert.equal(matches(response({ url: "http://localhost:3008/api/settings/tags?ignored=value", method: "PATCH", body, status: 500 })), true, "match failed HTTP responses too so the owning assertion rejects them");
  for (const mismatch of [
    { url: "https://foreign.invalid/api/settings/tags" }, { url: "http://localhost:3008/api/settings/tags/other" },
    { method: "POST" }, { body: { ...body, tagId: "different" } }, { body: { ...body, projectId: "global" } },
    { body: { ...body, isSOWLedgerDefault: "false" } }, { body: null }, { body: [] },
  ]) assert.equal(matches(response({ url: "http://localhost:3008/api/settings/tags", method: "PATCH", body, ...mismatch })), false);
});

test("render matching excludes old request identities, foreign paths, HMR and prefetch traffic", async () => {
  const { currentPathRender } = await load();
  const good = response();
  assert.equal(await currentPathRender(good, pageURL, new Set([good.request()])), true);
  assert.equal(await currentPathRender(good, pageURL, new Set()), false);
  for (const rejected of [
    response({ url: "https://foreign.invalid/settings/tags" }), response({ url: "http://localhost:3008/projects" }),
    response({ method: "POST" }), response({ headers: { rsc: "0" } }), response({ contentType: "text/html" }),
    response({ headers: { "next-router-prefetch": "1" } }), response({ headers: { purpose: "prefetch" } }),
    response({ headers: { "sec-purpose": "prefetch;prerender" } }),
    response({ headers: { "next-hmr-refresh": "1" } }),
  ]) assert.equal(await currentPathRender(rejected, pageURL, new Set([rejected.request()])), false);
});

test("response completion remains pending until body finish and propagates finish failures", async () => {
  const { finishResponse } = await load();
  let finish!: (value: Error | null) => void;
  let completed = false;
  const done = finishResponse(response({ finished: () => new Promise((resolve) => { finish = resolve; }) })).then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  finish(null); await done; assert.equal(completed, true);
  const error = new Error("controlled incomplete body");
  await assert.rejects(finishResponse(response({ finished: async () => error })), (actual) => actual === error);
  await assert.rejects(finishResponse(response({ finished: async () => { throw error; } })), (actual) => actual === error);
});

class ControlledPage extends EventEmitter {
  url() { return pageURL; }
  waitForResponse(predicate: (response: Response) => boolean | Promise<boolean>) {
    return new Promise<Response>((resolve, reject) => {
      const listener = (value: Response) => {
        void Promise.resolve(predicate(value)).then((matches) => {
          if (matches) { this.off("response", listener); resolve(value); }
        }, (error) => { this.off("response", listener); reject(error); });
      };
      this.on("response", listener);
    });
  }
}

// Yield one event-loop turn for the asynchronous header matcher, never a timed sleep.
const flushEvents = () => new Promise<void>((resolve) => setImmediate(resolve));
const observedEvents = ["request", "response", "requestfinished", "requestfailed", "close"];
function assertClean(page: ControlledPage) {
  for (const event of observedEvents) assert.equal(page.listenerCount(event), 0, `${event} observer leaked`);
}
function emitResponse(page: ControlledPage, value: Response) {
  page.emit("request", value.request()); page.emit("response", value);
}

test("action refresh requires both its exact terminal request and server-rendered proof", async () => {
  const { completeActionRefresh } = await load();
  const page = new ControlledPage();
  const old = response();
  const unrelated = response({ url: "http://localhost:3008/projects" });
  const fresh = response();
  const value = {};
  let completed = false;
  let proofCalls = 0;
  const work = completeActionRefresh(page as unknown as Page, async () => {
    for (const event of observedEvents) assert.equal(page.listenerCount(event), 1, `${event} must be armed before the action`);
    page.emit("response", old); // headers for a request already in flight cannot satisfy this action
    emitResponse(page, fresh);
    emitResponse(page, unrelated); page.emit("requestfinished", unrelated.request());
    return value;
  }, async (actual) => {
    assert.equal(actual, value); proofCalls++;
  }).then((result) => { completed = true; return result; });
  await flushEvents();
  assert.equal(completed, false); assert.equal(proofCalls, 1);
  page.emit("requestfinished", fresh.request());
  assert.equal(await work, value); assertClean(page);
});

test("terminal events preceding asynchronous response selection are not lost", { timeout: 2_000 }, async () => {
  const { completeActionRefresh } = await load();
  for (const terminal of ["requestfinished", "requestfailed"]) {
    const page = new ControlledPage();
    // Playwright's finished promise can remain pending after requestfailed. The
    // helper must use the actual terminal event, not assume that promise settles.
    const fresh = response({ failure: "net::ERR_ABORTED", finished: () => new Promise(() => {}) });
    let proved = false;
    const work = completeActionRefresh(page as unknown as Page, async () => {
      emitResponse(page, fresh); page.emit(terminal, fresh.request());
      return "saved";
    }, async () => { proved = true; });
    assert.equal(await work, "saved"); assert.equal(proved, true); assertClean(page);
  }
});

test("a canceled RSC cannot complete before the server-rendered change is proved", async () => {
  const { completeActionRefresh } = await load();
  const page = new ControlledPage();
  const fresh = response({ failure: "net::ERR_ABORTED" });
  let prove!: () => void;
  let completed = false;
  const work = completeActionRefresh(page as unknown as Page, async () => {
    emitResponse(page, fresh); page.emit("requestfailed", fresh.request());
  }, () => new Promise<void>((resolve) => { prove = resolve; })).then(() => { completed = true; });
  await flushEvents();
  assert.equal(completed, false); assert.equal(typeof prove, "function");
  prove(); await work; assertClean(page);
});

test("stale or missing server-rendered content rejects even an exact canceled RSC", async () => {
  const { completeActionRefresh } = await load();
  for (const terminal of ["requestfinished", "requestfailed"]) {
    const page = new ControlledPage();
    const fresh = response({ failure: "net::ERR_ABORTED" });
    const proofFailure = new Error("server-rendered active count remained at its baseline");
    const work = completeActionRefresh(page as unknown as Page, async () => {
      emitResponse(page, fresh); page.emit(terminal, fresh.request());
    }, async () => { throw proofFailure; });
    await assert.rejects(work, (error) => error === proofFailure); assertClean(page);
  }
});

test("omitting the mandatory server-rendered proof rejects before performing an action", async () => {
  const { completeActionRefresh } = await load();
  const page = new ControlledPage(); let calls = 0;
  const fresh = response();
  const withoutProof = completeActionRefresh as unknown as (page: Page, action: () => Promise<void>) => Promise<void>;
  const work = withoutProof(page as unknown as Page, async () => {
    calls++; emitResponse(page, fresh); page.emit("requestfinished", fresh.request());
  });
  await assert.rejects(work, /server-rendered proof/i);
  assert.equal(calls, 0); assertClean(page);
});

test("arbitrary transport failures reject even when the server-rendered proof succeeds", async () => {
  const { completeActionRefresh } = await load();
  for (const failure of ["net::ERR_CONNECTION_RESET", "net::ERR_FAILED", "net::ERR_ABORTED_OTHER", "NS_BINDING_ABORTED", undefined]) {
    const page = new ControlledPage();
    const fresh = response({ failure });
    const work = completeActionRefresh(page as unknown as Page, async () => {
      emitResponse(page, fresh); page.emit("requestfailed", fresh.request());
    }, async () => {});
    await assert.rejects(work, /render request failed/i); assertClean(page);
  }
});

test("HMR cannot satisfy the action refresh even with successful status and terminal events", async () => {
  const { completeActionRefresh } = await load();
  const page = new ControlledPage();
  const hmr = response({ headers: { "next-hmr-refresh": "1" } });
  const fresh = response();
  let completed = false;
  const work = completeActionRefresh(page as unknown as Page, async () => {
    emitResponse(page, hmr); page.emit("requestfinished", hmr.request());
  }, async () => {}).then(() => { completed = true; });
  await flushEvents(); assert.equal(completed, false);
  emitResponse(page, fresh); page.emit("requestfinished", fresh.request());
  await work; assertClean(page);
});

test("unsuccessful RSC status is never accepted by server-rendered proof", async () => {
  const { completeActionRefresh } = await load();
  const page = new ControlledPage(); let proofCalls = 0;
  const fresh = response({ status: 503, failure: "net::ERR_ABORTED" });
  const work = completeActionRefresh(page as unknown as Page, async () => {
    emitResponse(page, fresh); page.emit("requestfailed", fresh.request());
  }, async () => { proofCalls++; });
  await assert.rejects(work, (error) => error instanceof assert.AssertionError);
  assert.equal(proofCalls, 0); assertClean(page);
});

test("action failure is not retried and removes every observer", async () => {
  const { completeActionRefresh } = await load();
  const page = new ControlledPage(); let calls = 0; let proofCalls = 0;
  const actionFailure = new Error("controlled mutation failure");
  const work = completeActionRefresh(page as unknown as Page, async () => {
    calls++; throw actionFailure;
  }, async () => { proofCalls++; });
  await assert.rejects(work, (error) => error === actionFailure);
  assert.equal(calls, 1); assert.equal(proofCalls, 0); assertClean(page);
});

test("closing the page rejects an incomplete refresh and removes every observer", { timeout: 2_000 }, async () => {
  const { completeActionRefresh } = await load();
  for (const sawResponse of [false, true]) {
    const page = new ControlledPage();
    const fresh = response();
    const work = completeActionRefresh(page as unknown as Page, async () => {
      if (sawResponse) emitResponse(page, fresh);
    }, async () => {});
    const rejected = assert.rejects(work, /page closed/i);
    await flushEvents(); page.emit("close");
    await rejected; assertClean(page);
  }
});

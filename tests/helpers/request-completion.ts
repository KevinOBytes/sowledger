import assert from "node:assert/strict";
import type { Page, Request, Response } from "@playwright/test";

/** Match a specific browser mutation; status/body assertions stay in its test. */
export function mutationResponse(pageURL: string, pathname: string, method: "POST" | "PATCH", expected: Record<string, string | number | boolean | null> = {}) {
  const origin = new URL(pageURL).origin;
  return (response: Response) => {
    const url = new URL(response.url());
    const request = response.request();
    if (url.origin !== origin || url.pathname !== pathname || request.method() !== method) return false;
    if (Object.keys(expected).length === 0) return true;
    const body: unknown = request.postDataJSON();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      && Object.entries(expected).every(([key, value]) => (body as Record<string, unknown>)[key] === value);
  };
}

/** An action cannot claim a prior response, another page, HMR, or a speculative prefetch. */
export async function currentPathRender(response: Response, pageURL: string, issued: ReadonlySet<Request>) {
  const request = response.request();
  if (!issued.has(request) || request.method() !== "GET" || request.isNavigationRequest()) return false;
  const current = new URL(pageURL);
  const url = new URL(response.url());
  if (url.origin !== current.origin || url.pathname !== current.pathname) return false;
  const [rsc, next, hmr, purpose, secPurpose, type] = await Promise.all([
    request.headerValue("rsc"), request.headerValue("next-router-prefetch"), request.headerValue("next-hmr-refresh"),
    request.headerValue("purpose"), request.headerValue("sec-purpose"), response.headerValue("content-type"),
  ]);
  const prefetch = [purpose, secPurpose].some((value) => /(?:^|[,;\s])prefetch(?:$|[,;\s])/.test(value?.toLowerCase() ?? ""));
  return rsc === "1" && next !== "1" && hmr !== "1" && !prefetch && type?.split(";", 1)[0].trim().toLowerCase() === "text/x-component";
}

export async function finishResponse(response: Pick<Response, "finished">) {
  const error = await response.finished();
  if (error) throw error;
}

type RenderTerminal = { kind: "finished" } | { kind: "failed"; errorText: string | null };

/**
 * Require this action's normal same-path RSC request and a changed server-rendered
 * value, not optimistic/client row state. Callers still verify persisted data.
 * Observed development requests can emit ERR_ABORTED even when new server props commit;
 * their cause is unknown and Response.finished() may never settle. Only that exact
 * terminal error is eligible, and only when the mandatory server proof succeeds.
 */
export async function completeActionRefresh<T>(page: Page, action: () => Promise<T>, proveServerRender: (value: T) => Promise<void>): Promise<T> {
  assert.equal(typeof proveServerRender, "function", "An explicit server-rendered proof is required");
  const issued = new Set<Request>();
  const terminals = new Map<Request, RenderTerminal>();
  let selected: Request | undefined;
  let observing = true;
  let select!: (response: Response) => void;
  let rejectRender!: (error: unknown) => void;
  let finish!: (terminal: RenderTerminal) => void;
  let rejectClosed!: (error: Error) => void;
  const render = new Promise<Response>((resolve, reject) => { select = resolve; rejectRender = reject; });
  const terminal = new Promise<RenderTerminal>((resolve) => { finish = resolve; });
  const closed = new Promise<never>((_, reject) => { rejectClosed = reject; });
  const capture = (request: Request) => { issued.add(request); };
  const current = page.url();
  const record = (request: Request, state: RenderTerminal) => {
    if (!issued.has(request)) return;
    terminals.set(request, state);
    if (request === selected) finish(state);
  };
  const succeeded = (request: Request) => record(request, { kind: "finished" });
  const failed = (request: Request) => record(request, { kind: "failed", errorText: request.failure()?.errorText ?? null });
  const received = (response: Response) => {
    void currentPathRender(response, current, issued).then((matches) => {
      if (!observing || !matches || selected) return;
      selected = response.request();
      select(response);
      // A terminal event can precede the asynchronous header checks above.
      const prior = terminals.get(selected);
      if (prior) finish(prior);
    }, rejectRender);
  };
  const pageClosed = () => rejectClosed(new Error("Page closed before the action-triggered render completed"));
  page.on("request", capture).on("response", received).on("requestfinished", succeeded).on("requestfailed", failed).on("close", pageClosed);
  try {
    return await Promise.race([closed, (async () => {
      const [value, response] = await Promise.all([Promise.resolve().then(action), render]);
      assert.equal(response.status(), 200, "The action-triggered render must succeed");
      await Promise.all([
        terminal.then((state) => {
          if (state.kind === "failed" && state.errorText !== "net::ERR_ABORTED") {
            throw new Error(`The action-triggered render request failed: ${state.errorText ?? "unknown transport failure"}`);
          }
        }),
        Promise.resolve().then(() => proveServerRender(value)),
      ]);
      return value;
    })()]);
  } finally {
    observing = false;
    page.off("request", capture).off("response", received).off("requestfinished", succeeded).off("requestfailed", failed).off("close", pageClosed);
  }
}

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// Root owns execution. The fixture never visits the application or a vendor:
// actual layout/banner/telemetry sources run with real React effects in an
// intercepted origin; only SDK I/O and unrelated Next shell services are doubled.
const origin = "https://consent.sowledger.test";
const cookieName = "sowledger-cookie-consent";
type Snapshot = { calls: string[]; sends: string[]; attempts: string[]; refreshes: number; configs: Record<string, Record<string, unknown>> };
type HarnessWindow = typeof window & { fixtureSentryReplayMode?: "session" | "buffer" | "inactive"; consentFixture: { snapshot(): Snapshot; emit(): Promise<void>; sendPendingSentry(): Promise<void>; revoke(): Promise<void>; ready: boolean } };

const stateSource = `
export const env = {
  NODE_ENV: 'production', VERCEL: '1', NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-SYNTHETIC',
  NEXT_PUBLIC_DATADOG_APPLICATION_ID: 'synthetic-application', NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: 'synthetic-public-token',
  NEXT_PUBLIC_DATADOG_SITE: 'datadoghq.com', NEXT_PUBLIC_SENTRY_DSN: 'https://synthetic@invalid.test/1'
};
export const state = { calls: [], sends: [], attempts: [], refreshes: 0, configs: {}, emitters: {}, pendingSentry: undefined };
export function call(value) { state.calls.push(value); }
export async function wire(vendor) {
  state.sends.push(vendor);
  await fetch('/controlled-capture/' + vendor, {method: 'POST', body: 'synthetic-event'});
  return {statusCode: 200};
}
window.consentFixture = {
  ready: false,
  snapshot() { return JSON.parse(JSON.stringify(state)); },
  async emit() {
    for (const [name, fn] of Object.entries(state.emitters)) { state.attempts.push(name); await fn(); }
  },
  async sendPendingSentry() {
    if (!state.pendingSentry) throw Error('Sentry retained transport is not initialized');
    state.attempts.push('sentry-pending-envelope');
    await state.pendingSentry();
  },
  async revoke() {
    document.cookie = 'sowledger-cookie-consent=false; Path=/; SameSite=Lax';
    window.dispatchEvent(new Event('focus'));
  }
};
`;

// Deliberately no cleanup that makes unmount look like vendor shutdown.
// Vercel keeps its installed send hook; GA checks the documented disable flag.
const vercelSource = `
import { useEffect } from 'react'; import { state, call, wire } from 'consent-fixture-state';
call('vercel:import'); let installed = false; let hook;
export function Analytics(props) {
  useEffect(() => {
    hook = props.beforeSend;
    if (!installed) { installed = true; call('vercel:start'); }
    state.emitters.vercel = () => !hook || hook({type:'pageview', url:location.href}) !== null ? wire('vercel') : undefined;
  }, [props.beforeSend]); return null;
}
`;
const googleSource = `
import { useEffect } from 'react'; import { state, call, wire } from 'consent-fixture-state';
call('ga:import'); let installed = false;
export function GoogleAnalytics({gaId}) {
  useEffect(() => {
    if (!installed) { installed = true; call('ga:start'); }
    state.emitters.ga = () => window['ga-disable-' + gaId] === true ? undefined : wire('ga');
  }, [gaId]); return null;
}
`;
const datadogSource = `
import { state, call, wire } from 'consent-fixture-state';
call('DD_SDK_IMPORT'); let config; let consent = 'granted'; let replay = false;
export const datadogRum = {
  init(value) { if(config) throw Error('Duplicate Datadog init'); config = value; consent = value.trackingConsent ?? 'granted'; state.configs.datadog = value; call('datadog:init');
    state.emitters.datadog = () => consent !== 'granted' || config.beforeSend?.({type:'action'}, {}) === false ? undefined : wire('datadog'); },
  getInitConfiguration() { return config; },
  setTrackingConsent(value) { if(!['granted','not-granted'].includes(value)) throw Error('Invalid tracking consent'); consent=value; call('datadog:consent:' + value); },
  startSessionReplayRecording() { replay=true; call('datadog:start'); },
  stopSessionReplayRecording() { replay=false; call('datadog:stop'); },
  getInternalContext() { return { replay }; }
};
`;
const sentrySource = `
import { state, call, wire } from 'consent-fixture-state';
call('sentry:import'); let options; let transport; let recording = false; let recordingMode;
// Faithful public lifecycle/scopes support for the production integration.
// The appended installed-SDK cases, not these minimal doubles, prove collection.
const hooks = new Map();
function emitHook(name, value) { for(const callback of hooks.get(name) ?? []) callback(value); }
const client = {
  getOptions: () => options, getTransport: () => transport,
  getIntegrationByName: name => options.integrations.find(integration => integration.name === name),
  on(name, callback) {
    const listeners = hooks.get(name) ?? new Set(); listeners.add(callback); hooks.set(name, listeners);
    return () => listeners.delete(callback);
  }
};
const scopes = Array.from({length:3}, () => ({clearBreadcrumbs() { return this; }, getScopeData() { return {breadcrumbs:[]}; }}));
export function getGlobalScope() { return scopes[0]; }
export function getIsolationScope() { return scopes[1]; }
export function getCurrentScope() { return scopes[2]; }
export function getActiveSpan() { return undefined; }
export function getRootSpan(span) { return span; }
export function spanToJSON(span) { return {data:span.attributes, span_id:'synthetic-span', trace_id:'synthetic-trace'}; }
export function browserTracingIntegration() { return {name:'BrowserTracing'}; }
function transactionSpan() {
  let sampled = options.tracesSampleRate != null || typeof options.tracesSampler === 'function';
  const span = {
    attributes: {}, setAttribute(name, value) { if(value === undefined) delete this.attributes[name]; else this.attributes[name] = value; return this; },
    isRecording() { return sampled; },
    end() { if(!sampled) return; sampled=false; emitHook('spanEnd', span); }
  };
  emitHook('spanStart', span);
  return span;
}
const replay = {
  name: 'Replay',
  start() { recording = true; recordingMode = 'session'; call('sentry:replay:start'); },
  startBuffering() { recording = true; recordingMode = 'buffer'; call('sentry:replay:buffer'); },
  async stop(value) { call('sentry:replay:stop:' + String(value?.flush)); if(recording && value?.flush !== false) await wire('sentry-replay-flush'); recording=false; recordingMode=undefined; },
  getReplayId() { return recording ? 'synthetic-replay' : undefined; },
  getRecordingMode() { return recording ? recordingMode : undefined; },
  async flush() { if(recording) await wire('sentry-replay'); }
};
export function replayIntegration(value) { state.configs.replay = value; return replay; }
export function makeFetchTransport(transportOptions) {
  if(typeof transportOptions.url !== 'string' || typeof transportOptions.recordDroppedEvent !== 'function') throw Error('Invalid Sentry transport construction contract');
  call('sentry:fetch-transport:construct');
  return { send: () => wire('sentry-transport'), flush: async () => true };
}
export function init(value) {
  if(options) throw Error('Duplicate Sentry init'); options=value; state.configs.sentry=value; call('sentry:init');
  // Installed Client constructs the chosen transport once, with URL/drop-report
  // options, then retains it. Do not reevaluate a custom factory on every send.
  call('sentry:transport:construct');
  transport = (value.transport ?? makeFetchTransport)({
    tunnel: value.tunnel, recordDroppedEvent() {}, ...value.transportOptions,
    url: 'https://invalid.test/api/1/envelope/'
  });
  const retainedTransport = transport;
  const pendingEnvelope = [{event_id:'synthetic-pending'}, [[{type:'replay_recording'}, 'synthetic-pending-segment']]];
  // This models an envelope prepared before withdrawal but not yet handed to
  // transport.send. It bypasses event hooks and client enabled short circuits;
  // it does not pretend to retract a request already dispatched by a transport.
  state.pendingSentry = () => retainedTransport.send(pendingEnvelope);
  // Like the real SDK, setup hooks for every integration precede afterAllSetup.
  for(const integration of value.integrations ?? []) integration.setup?.(client);
  for(const integration of value.integrations ?? []) integration.afterAllSetup?.(client);
  // Deterministically model the public SDK-selected mode without changing rates.
  // 'inactive' represents getRecordingMode() returning undefined, not permission
  // to start a fresh sampled session when the application re-enables analytics.
  recordingMode = window.fixtureSentryReplayMode === 'inactive' ? undefined : window.fixtureSentryReplayMode ?? 'session';
  recording = recordingMode !== undefined && !!(value.replaysSessionSampleRate || value.replaysOnErrorSampleRate);
  async function send(kind, event) {
    if(options.enabled === false) return;
    const hook = kind === 'transaction' ? options.beforeSendTransaction : options.beforeSend;
    if(hook && await hook(event, {}) === null) return;
    await transport.send([{event_id:'synthetic'}, [[{type:kind},event]]]);
  }
  state.emitters.sentry = () => send('event', {message:'synthetic'});
  state.emitters['sentry-transaction'] = () => {
    const span = transactionSpan(); span.end();
    return send('transaction', {type:'transaction', transaction:'synthetic', contexts:{trace:spanToJSON(span)}});
  };
  state.emitters['sentry-replay'] = async () => {
    if(!recording || options.enabled === false) return;
    await transport.send([{}, [[{type:'replay_recording'},'synthetic']]]);
  };
}
export function getClient() { return options ? client : undefined; }
export function getReplay() { return replay; }
export function addIntegration() {}
export async function close() { await replay.stop(); options.enabled=false; call('sentry:close'); return true; }
`;

let assets: Map<string, string>;
let css: string;
test.beforeAll(async () => {
  const root = process.cwd();
  css = (await postcss([tailwind({ base: root })]).process(readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const virtual: Record<string, string> = {
    "consent-fixture-state": stateSource,
    "@vercel/analytics/next": vercelSource,
    "@next/third-parties/google": googleSource,
    "@datadog/browser-rum": datadogSource,
    "@sentry/nextjs": sentrySource,
    "next/navigation": `import { state } from 'consent-fixture-state'; export function useRouter() { return {refresh() { state.refreshes++; }}; }`,
    sonner: "export function Toaster() { return null; }",
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import 'consent-fixture-state'; import './sentry.client.config'; import Layout from './app/layout';
        const tree = Layout({children: React.createElement('main', null, 'Necessary site content')});
        const body = React.Children.toArray(tree.props.children).find(child => child.type === 'body');
        document.documentElement.className = tree.props.className;
        document.body.className = body.props.className;
        createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, body.props.children));
        requestAnimationFrame(() => requestAnimationFrame(() => { window.consentFixture.ready = true; }));`,
      resolveDir: process.cwd(), sourcefile: "consent-entry.tsx", loader: "tsx",
    },
    absWorkingDir: process.cwd(), outdir: "/consent-fixture-assets", bundle: true, write: false,
    splitting: true, format: "esm", platform: "browser", jsx: "automatic", target: "es2022",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "strict-consent-io-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(virtual, args.path) ? { path: args.path, namespace: "consent-boundary" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "consent-boundary" }, args => ({ contents: virtual[args.path], loader: "js", resolveDir: process.cwd() }));
      builder.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "css" }));
      // Inject a process boundary into actual application sources, while keeping
      // React development's real StrictMode effect replay enabled.
      builder.onLoad({ filter: /(?:app\/layout\.tsx|components\/(?:DatadogInit|analytics-wrapper|optional-analytics|cookie-consent)\.tsx|sentry\.client\.config\.ts)$/ }, args => ({
        contents: `import { env as fixtureEnv } from 'consent-fixture-state';\n${readFileSync(args.path, "utf8").replaceAll("process.env", "fixtureEnv")}`,
        loader: args.path.endsWith("tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path),
      }));
    } }],
  });
  assets = new Map(result.outputFiles.map(file => [`/assets/${path.basename(file.path)}`, file.text]));
});

async function install(context: BrowserContext, options: { delayDatadog?: boolean; failDatadog?: boolean } = {}) {
  const unexpected: string[] = []; const captures: string[] = [];
  let datadogRequests = 0;
  const observe = (page: Page) => page.on("pageerror", error => unexpected.push(`pageerror: ${error.message}`));
  for (const page of context.pages()) observe(page);
  context.on("page", observe);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { unexpected.push(url.origin + url.pathname); await route.abort(); return; }
    if (url.pathname.startsWith("/controlled-capture/")) { captures.push(url.pathname); await route.fulfill({ status: 204 }); return; }
    if (url.pathname === "/assets/consent.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    const script = assets.get(url.pathname);
    if (script !== undefined) {
      if (script.includes('call("DD_SDK_IMPORT")')) {
        datadogRequests++;
        if (options.delayDatadog) await blocked;
        if (options.failDatadog) { await route.fulfill({ contentType: "text/javascript", body: "throw new Error('Synthetic SDK unavailable');" }); return; }
      }
      await route.fulfill({ contentType: "text/javascript", body: script }); return;
    }
    if (url.pathname === "/") {
      const entry = [...assets.keys()].find(name => /stdin\.js$/.test(name));
      expect(entry, "Compiled actual layout fixture entry must exist").toBeTruthy();
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/consent.css"></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>` }); return;
    }
    unexpected.push(url.pathname); await route.abort();
  });
  return { unexpected, captures, release, datadogRequests: () => datadogRequests };
}
async function open(page: Page) {
  await page.goto(origin);
  await expect.poll(() => page.evaluate(() => (window as HarnessWindow).consentFixture?.ready)).toBe(true);
}
async function snapshot(page: Page) { return page.evaluate(() => (window as HarnessWindow).consentFixture.snapshot()); }
async function consentCookie(context: BrowserContext, value: string) { await context.addCookies([{ name: cookieName, value, url: origin, sameSite: "Lax" }]); }
async function expectStarted(page: Page) {
  await expect.poll(async () => (await snapshot(page)).calls).toEqual(expect.arrayContaining(["ga:start", "vercel:start", "datadog:init", "sentry:init"]));
}

for (const width of [320, 1280]) test(`initial consent banner preserves styled appearance and usable controls at ${width}px`, async ({ page, context }, testInfo) => {
  const io = await install(context); await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
  await open(page);
  const banner = page.getByRole("region", { name: "Cookie preferences" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Necessary cookies keep the site working. Optional analytics stay off unless you accept.");
  for (const name of ["Decline", "Accept All"]) {
    const button = banner.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  }
  // Poll past the real Framer spring so screenshots/geometry describe the
  // settled, still-visible banner rather than an intermediate entrance frame.
  await expect.poll(async () => banner.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const settled = style.transform === "none" || Math.abs(new DOMMatrixReadOnly(style.transform).m42) < 0.5;
    return settled && Number(style.opacity) > 0.99 && rect.left >= 15 && rect.top >= 0 && rect.right <= innerWidth - 15 && rect.bottom <= innerHeight - 15;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`consent-banner-initial-${width}.png`), fullPage: true, animations: "disabled" });
  expect(io.unexpected).toEqual([]);
});

for (const value of [undefined, "false", "malformed"]) test(`actual layout initializes no optional child with ${value ?? "absent"} consent`, async ({ page, context }) => {
  const io = await install(context); if (value) await consentCookie(context, value);
  await open(page);
  await expect(page.getByText("Necessary site content")).toBeVisible();
  const s = await snapshot(page);
  expect(s.calls.filter(call => /:init$|:start$|DD_SDK_IMPORT/.test(call)), "Existing unconsented SDK initialization is the intended RED").toEqual([]);
  await page.evaluate(() => (window as HarnessWindow).consentFixture.emit());
  expect((await snapshot(page)).sends).toEqual([]); expect(io.captures).toEqual([]); expect(io.unexpected).toEqual([]);
});

test("GA shadow-name cookie cannot initialize the actual wrapper", async ({ page, context }) => {
  const io = await install(context);
  await context.addCookies([{ name: "shadow-sowledger-cookie-consent", value: "true", url: origin }]);
  await open(page);
  await expect(page.getByRole("region", { name: "Cookie preferences" })).toBeVisible();
  expect((await snapshot(page)).calls).not.toContain("ga:start");
  expect(io.unexpected).toEqual([]);
});

for (const width of [320, 1280]) test(`actual banner accepts without reload, preserves provider settings and remembers choice at ${width}px`, async ({ page, context }) => {
  const io = await install(context); await page.setViewportSize({ width, height: 900 });
  await open(page);
  await page.getByRole("button", { name: "Accept All", exact: true }).click();
  await expectStarted(page);
  await expect(page.getByRole("region", { name: "Cookie preferences" })).toHaveCount(0);
  expect((await context.cookies(origin)).find(cookie => cookie.name === cookieName)?.value).toBe("true");
  const s = await snapshot(page);
  expect(s.refreshes, "Consent must reach browser subscribers without router refresh").toBe(0);
  expect(s.calls.filter(call => call === "datadog:init")).toHaveLength(1);
  expect(s.calls.filter(call => call === "sentry:init")).toHaveLength(1);
  expect(s.configs.datadog).toMatchObject({ sessionSampleRate: 100, sessionReplaySampleRate: 20, defaultPrivacyLevel: "mask-user-input", trackUserInteractions: true, trackResources: true, trackLongTasks: true });
  expect(s.configs.sentry).toMatchObject({ tracesSampleRate: 0.2, replaysOnErrorSampleRate: 1, replaysSessionSampleRate: 0.02, debug: false });
  expect(s.configs.replay).toMatchObject({ maskAllText: true, blockAllMedia: true });
  await page.evaluate(() => (window as HarnessWindow).consentFixture.emit());
  expect((await snapshot(page)).attempts).toEqual(expect.arrayContaining(["ga", "vercel", "datadog", "sentry", "sentry-transaction", "sentry-replay"]));
  expect(io.captures.length).toBeGreaterThanOrEqual(6);
  await page.reload(); await expectStarted(page);
  await expect(page.getByRole("region", { name: "Cookie preferences" })).toHaveCount(0);
  expect(io.unexpected).toEqual([]);
});

test("actual banner decline persists false and never enables optional telemetry", async ({ page, context }) => {
  const io = await install(context); await open(page);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  expect((await context.cookies(origin)).find(cookie => cookie.name === cookieName)?.value).toBe("false");
  await page.reload(); await open(page);
  await expect(page.getByRole("region", { name: "Cookie preferences" })).toHaveCount(0);
  expect((await snapshot(page)).calls.filter(call => /:init$|:start$|DD_SDK_IMPORT/.test(call))).toEqual([]);
  expect(io.captures).toEqual([]); expect(io.unexpected).toEqual([]);
});

test("installed SDKs reject capture after same-task focus revocation and discard pending replay", async ({ page, context }) => {
  const io = await install(context); await consentCookie(context, "true"); await open(page); await expectStarted(page);
  await page.evaluate(() => (window as HarnessWindow).consentFixture.emit());
  const before = (await snapshot(page)).sends.length;
  await page.evaluate(async () => { const f = (window as HarnessWindow).consentFixture; await f.revoke(); await f.emit(); });
  await expect.poll(async () => (await snapshot(page)).calls).toEqual(expect.arrayContaining(["datadog:consent:not-granted", "datadog:stop", "sentry:replay:stop:false"]));
  expect((await snapshot(page)).sends.slice(before), "Unmount alone must not be mistaken for send revocation").toEqual([]);
  await page.evaluate(() => { document.cookie = "sowledger-cookie-consent=true; Path=/; SameSite=Lax"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(async () => {
    await page.evaluate(() => (window as HarnessWindow).consentFixture.emit());
    return (await snapshot(page)).sends.slice(before);
  }).toEqual(expect.arrayContaining(["ga", "vercel", "datadog"]));
  expect((await snapshot(page)).calls.filter(call => call === "datadog:init")).toHaveLength(1);
  expect((await snapshot(page)).calls.filter(call => call === "sentry:init")).toHaveLength(1);
  expect(io.unexpected).toEqual([]);
});

test("Sentry's retained transport rejects a previously prepared envelope after withdrawal", async ({ page, context }) => {
  const io = await install(context); await consentCookie(context, "true"); await open(page); await expectStarted(page);
  await page.evaluate(() => (window as HarnessWindow).consentFixture.sendPendingSentry());
  const before = await snapshot(page);
  expect(before.calls.filter(call => call === "sentry:transport:construct")).toHaveLength(1);
  expect(before.sends).toContain("sentry-transport");
  // This path intentionally does not invoke captureMessage/captureEvent,
  // beforeSend, or the client's enabled check after withdrawal.
  await page.evaluate(async () => { const f = (window as HarnessWindow).consentFixture; await f.revoke(); await f.sendPendingSentry(); });
  const after = await snapshot(page);
  expect(after.calls.filter(call => call === "sentry:transport:construct")).toHaveLength(1);
  expect(after.attempts.filter(attempt => attempt === "sentry-pending-envelope")).toHaveLength(2);
  expect(after.sends.slice(before.sends.length), "The transport created while consented must recheck current consent, not a captured boolean").toEqual([]);
  expect(io.unexpected).toEqual([]);
});

// Root approved these after implementation to cover the installed public API.
// They are post-implementation contract coverage, not previously observed RED.
for (const mode of ["session", "buffer", "inactive"] as const) test(`Sentry reacceptance preserves the SDK-selected ${mode === "inactive" ? "undefined" : mode} replay mode`, async ({ page, context }) => {
  await context.addInitScript(selected => { (window as HarnessWindow).fixtureSentryReplayMode = selected; }, mode);
  const io = await install(context); await consentCookie(context, "true"); await open(page); await expectStarted(page);
  await page.evaluate(() => (window as HarnessWindow).consentFixture.revoke());
  await expect.poll(async () => (await snapshot(page)).calls).toContain("sentry:replay:stop:false");
  await page.evaluate(() => { document.cookie = "sowledger-cookie-consent=true; Path=/; SameSite=Lax"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(async () => (await snapshot(page)).configs.sentry.enabled).toBe(true);
  // Extra checks must not restart either mode on every focus/poll notification.
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("focus")); });
  const s = await snapshot(page);
  expect(s.calls.filter(call => call === "sentry:init")).toHaveLength(1);
  expect(s.calls.filter(call => call === "sentry:replay:start")).toHaveLength(mode === "session" ? 1 : 0);
  expect(s.calls.filter(call => call === "sentry:replay:buffer")).toHaveLength(mode === "buffer" ? 1 : 0);
  expect(s.configs.sentry).toMatchObject({ tracesSampleRate: 0.2, replaysOnErrorSampleRate: 1, replaysSessionSampleRate: 0.02 });
  expect(io.unexpected).toEqual([]);
});

test("another tab's consent write is noticed and a focus revocation blocks previously installed sends", async ({ page, context }) => {
  const io = await install(context); await consentCookie(context, "false"); await open(page);
  const other = await context.newPage(); await open(other);
  await other.evaluate(() => { document.cookie = "sowledger-cookie-consent=true; Path=/; SameSite=Lax"; localStorage.setItem("consent-external-fixture", "accepted"); });
  await expectStarted(page);
  await other.evaluate(() => { document.cookie = "sowledger-cookie-consent=false; Path=/; SameSite=Lax"; localStorage.setItem("consent-external-fixture", "declined"); });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const before = (await snapshot(page)).sends.length;
  await page.evaluate(() => (window as HarnessWindow).consentFixture.emit());
  expect((await snapshot(page)).sends.slice(before)).toEqual([]); expect(io.unexpected).toEqual([]);
});

test("Datadog import completing after withdrawal never initializes or starts recording", async ({ page, context }) => {
  const io = await install(context, { delayDatadog: true }); await consentCookie(context, "true"); await open(page);
  try {
    await expect.poll(io.datadogRequests).toBe(1);
    await page.evaluate(() => (window as HarnessWindow).consentFixture.revoke());
    io.release();
    await expect.poll(async () => (await snapshot(page)).calls).toContain("DD_SDK_IMPORT");
    expect((await snapshot(page)).calls).not.toContain("datadog:init");
    expect((await snapshot(page)).calls).not.toContain("datadog:start");
    expect(io.unexpected).toEqual([]);
  } finally { io.release(); }
});

test("a failed SDK import stays contained without unhandled rejection or focus retry storm", async ({ page, context }) => {
  const io = await install(context, { failDatadog: true }); await consentCookie(context, "true"); await open(page);
  await expect.poll(io.datadogRequests).toBe(1);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Necessary site content")).toBeVisible();
  expect((await snapshot(page)).calls).not.toContain("datadog:init");
  expect(io.datadogRequests()).toBe(1); expect(io.unexpected).toEqual([]);
});

// Final review I1/I2: execute the INSTALLED Next/browser SDK, including its real
// Breadcrumbs, BrowserTracing, scopes and span serialization. No vendor double
// can establish collection/lifetime behavior. Only the origin and synthetic
// envelope endpoint are intercepted; unknown requests are failures.
type InstalledState = {
  enabled: boolean | undefined;
  tracesSampleRate: number | undefined;
  integrations: string[];
  breadcrumbs: unknown[];
  requests: Array<{ url: string; recording: boolean }>;
  roots: Record<string, { recording: boolean; recordingDescendants: unknown[] }>;
};
type InstalledDriver = {
  ready(): boolean;
  state(): InstalledState;
  choice(accepted: boolean, notify?: boolean): void;
  root(name: string): { recording: boolean };
  child(name: string, parent: string): { recording: boolean };
  request(name: string, parent?: string): Promise<void>;
  finish(name: string): Promise<void>;
  message(name: string): Promise<void>;
};
type InstalledWindow = typeof window & { installedConsent: InstalledDriver };
const installedOrigin = "https://installed-consent.sowledger.test";
let installedAssets: Map<string, string>;

const installedEntry = `
import * as SDK from '@sentry/nextjs';
import './sentry.client.config';
const roots = new Map();
const requests = []; let observedClient;
window.installedConsent = {
  ready() {
    const client = SDK.getClient();
    if (client && client !== observedClient) {
      observedClient = client;
      client.on('beforeOutgoingRequestSpan', (span, hint) => {
        requests.push({url: String(hint.input?.[0] ?? 'xhr'), recording: span.isRecording()});
      });
    }
    return !!client;
  },
  state() {
    const client = SDK.getClient();
    return {
      enabled: client ? client.getOptions().enabled !== false && !!client.getTransport() : undefined,
      tracesSampleRate: client?.getOptions().tracesSampleRate,
      integrations: (client?.getOptions().integrations ?? []).map(integration => integration.name),
      breadcrumbs: [SDK.getGlobalScope(), SDK.getIsolationScope(), SDK.getCurrentScope()].flatMap(scope => scope.getScopeData().breadcrumbs),
      requests: [...requests],
      roots: Object.fromEntries([...roots].map(([name, root]) => [name, {
        recording: root.isRecording(),
        recordingDescendants: SDK.getSpanDescendants(root).filter(span => span.isRecording()).map(span => SDK.spanToJSON(span))
      }]))
    };
  },
  choice(accepted, notify = true) {
    document.cookie = 'sowledger-cookie-consent=' + accepted + '; Path=/; SameSite=Lax';
    if (notify) window.dispatchEvent(new Event('focus'));
  },
  root(name) {
    // A deterministic draw from the configured rate, not a rate override. Both
    // the public propagation API and the actual sampler remain in use.
    const root = SDK.startNewTrace(() => {
      const scope = SDK.getCurrentScope();
      scope.setPropagationContext({...scope.getPropagationContext(), sampleRand: 0});
      return SDK.startInactiveSpan({ name, op: 'test.consent', parentSpan: null, forceTransaction: true });
    });
    roots.set(name, root);
    SDK.setActiveSpanInBrowser(root);
    return { recording: root.isRecording() };
  },
  child(name, parent) {
    // Keep an explicit reference even if withdrawal ends/removes the root from
    // the browser's current scope: ending is not evidence all references vanish.
    const span = SDK.withActiveSpan(roots.get(parent), () => SDK.startInactiveSpan({name, op:'test.consent.child'}));
    const recording = span.isRecording(); span.end(); return {recording};
  },
  async request(name, parent) {
    const send = () => fetch('/probe/' + name).then(response => { if(!response.ok) throw Error('Synthetic request failed'); });
    if(parent) await SDK.withActiveSpan(roots.get(parent), send); else await send();
  },
  async finish(name) { roots.get(name).end(); await SDK.flush(2000); },
  async message(name) { SDK.captureMessage(name); await SDK.flush(2000); }
};
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: installedEntry, resolveDir: process.cwd(), sourcefile: "installed-consent-entry.ts", loader: "ts" },
    absWorkingDir: process.cwd(), outdir: "/installed-consent-assets", bundle: true, write: false,
    splitting: true, format: "esm", platform: "browser", target: "es2022",
    // Match Next's installed client define-env contract: NEXT_RUNTIME is ''.
    // Without this explicit constant, esbuild retains the Pages-router bloom
    // filter's nodejs-only gzip-size branch, although the fixture is a browser.
    define: {
      "process.env.NODE_ENV": '"production"', "process.env.NEXT_RUNTIME": '""', "process.env": "{}",
      // Next's browser webpack defaults use node.__dirname='mock' -> '/'. The
      // installed process package's ncc wrapper uses it only for unused .ab metadata.
      __dirname: '"/"',
    },
    inject: ["installed-next-browser-process"],
    plugins: [{ name: "installed-sdk-synthetic-configuration-only", setup(builder) {
      // Next's client ProvidePlugin supplies its installed process polyfill.
      // With no preexisting process in this fixture, Next's wrapper selects this
      // exact compiled browser implementation; do not invent a process object.
      builder.onResolve({ filter: /^installed-next-browser-process$/ }, () => ({ path: "installed-next-browser-process", namespace: "installed-next-runtime" }));
      builder.onLoad({ filter: /.*/, namespace: "installed-next-runtime" }, () => ({
        contents: `export { default as process } from 'next/dist/compiled/process';`,
        loader: "js", resolveDir: process.cwd(),
      }));
      // Keep all SDK imports/exports and the production lifecycle source real.
      // Only the same public configuration boundary used by the other fixture
      // supplies synthetic IDs, never a runtime seam in application source.
      builder.onLoad({ filter: /sentry\.client\.config\.ts$/ }, args => ({
        contents: `const fixtureEnv = { NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_DSN: 'https://synthetic@invalid.test/1' };\n${readFileSync(args.path, "utf8").replaceAll("process.env", "fixtureEnv")}`,
        loader: "ts", resolveDir: path.dirname(args.path),
      }));
    } }],
  });
  installedAssets = new Map(result.outputFiles.map(file => [`/installed-assets/${path.basename(file.path)}`, file.text]));
});

async function installRealSentry(context: BrowserContext, page: Page) {
  const unexpected: string[] = [];
  const envelopes: string[] = [];
  page.on("pageerror", error => unexpected.push(`pageerror: ${error.stack ?? error.message}`));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const diagnostic = () => JSON.stringify({ url: route.request().url(), protocol: url.protocol, resourceType: route.request().resourceType(), method: route.request().method() });
    // Replay creates this genuine same-origin in-memory compression worker.
    // WebKit exposes its blob GET through routing; it is not remote traffic.
    if (url.protocol === "blob:" && url.origin === installedOrigin && route.request().method() === "GET") {
      await route.continue(); return;
    }
    if (url.origin === "https://invalid.test" && url.pathname === "/api/1/envelope/" && route.request().method() === "POST") {
      envelopes.push(route.request().postDataBuffer()?.toString("utf8") ?? "");
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); return;
    }
    if (url.origin !== installedOrigin) { unexpected.push(diagnostic()); await route.abort(); return; }
    if (url.pathname.startsWith("/probe/")) { await route.fulfill({ status: 200, contentType: "text/plain", body: "synthetic" }); return; }
    const script = installedAssets.get(url.pathname);
    if (script !== undefined) { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/") {
      const entry = [...installedAssets.keys()].find(name => /stdin\.js$/.test(name));
      expect(entry, "Installed SDK fixture must have an entry bundle").toBeTruthy();
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="denied-dom-I1">Denied DOM canary</button><button id="positive-dom-I1">Consented DOM control</button><script type="module" src="${entry}"></script></body></html>` }); return;
    }
    unexpected.push(diagnostic()); await route.abort();
  });
  await context.addCookies([{ name: cookieName, value: "true", url: installedOrigin, sameSite: "Lax" }]);
  await page.goto(installedOrigin);
  await expect.poll(async () => {
    // Callback errors escape expect.poll immediately (unlike a false matcher
    // result). Preserve readiness while exposing the actual setup failure.
    if (unexpected.length) throw new Error(`Installed SDK fixture setup failed:\n${unexpected.join("\n")}`);
    const ready = await page.evaluate(() => (window as InstalledWindow).installedConsent?.ready());
    if (unexpected.length) throw new Error(`Installed SDK fixture setup failed:\n${unexpected.join("\n")}`);
    return ready;
  }).toBe(true);
  const state = await page.evaluate(() => (window as InstalledWindow).installedConsent.state());
  expect(state.integrations).toEqual(expect.arrayContaining(["Breadcrumbs", "BrowserTracing"]));
  expect(state.tracesSampleRate, "Keep the production trace sample rate").toBe(0.2);
  return { unexpected, envelopes };
}

function installedPayloads(envelopes: string[]): Array<Record<string, unknown>> {
  return envelopes.flatMap(envelope => envelope.split("\n").flatMap(line => {
    try {
      const parsed: unknown = JSON.parse(line);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed as Record<string, unknown>] : [];
    } catch { return []; } // Binary replay segments are not JSON event payloads.
  }));
}

test("installed Sentry rejects denied DOM/console/request breadcrumb retention and later event export (I1)", async ({ page, context }) => {
  const io = await installRealSentry(context, page);
  await page.evaluate(() => (window as InstalledWindow).installedConsent.choice(false));
  await page.locator("#denied-dom-I1").click();
  await page.evaluate(async () => {
    console.log("denied-console-I1");
    await (window as InstalledWindow).installedConsent.request("denied-request-I1");
  });
  const deniedState = await page.evaluate(() => (window as InstalledWindow).installedConsent.state());
  await page.evaluate(() => (window as InstalledWindow).installedConsent.choice(true));
  await expect.poll(() => page.evaluate(() => (window as InstalledWindow).installedConsent.state().enabled)).toBe(true);
  await page.locator("#positive-dom-I1").click();
  await page.evaluate(async () => {
    console.log("positive-console-I1");
    const driver = (window as InstalledWindow).installedConsent;
    await driver.request("positive-request-I1"); await driver.message("consented-event-I1");
  });
  const event = installedPayloads(io.envelopes).find(payload => payload.message === "consented-event-I1");
  expect(event, "A real SDK consented event must reach the intercepted envelope boundary").toBeTruthy();
  const exported = JSON.stringify(event);
  for (const canary of ["positive-dom-I1", "positive-console-I1", "positive-request-I1"]) expect(exported).toContain(canary);
  const retained = JSON.stringify(deniedState.breadcrumbs);
  for (const canary of ["denied-dom-I1", "denied-console-I1", "denied-request-I1"]) {
    expect({ retained: retained.includes(canary), exported: exported.includes(canary) }, `Denied breadcrumb ${canary} must fail at collection and final-envelope boundaries`).toEqual({ retained: false, exported: false });
  }
  expect(io.unexpected).toEqual([]);
});

test("installed Sentry discards a retained sampled parent across withdrawal, including stale async parent references (I2)", async ({ page, context }) => {
  const io = await installRealSentry(context, page);
  expect(await page.evaluate(() => (window as InstalledWindow).installedConsent.root("held-consented-root-I2"))).toEqual({ recording: true });
  expect(await page.evaluate(() => (window as InstalledWindow).installedConsent.child("positive-before-I2", "held-consented-root-I2"))).toEqual({ recording: true });
  await page.evaluate(() => (window as InstalledWindow).installedConsent.request("positive-before-request-I2", "held-consented-root-I2"));
  const denied = await page.evaluate(async () => {
    const driver = (window as InstalledWindow).installedConsent;
    driver.choice(false, false); // No notification: test the actual current-cookie collection boundary.
    const child = driver.child("denied-child-I2", "held-consented-root-I2");
    await driver.request("denied-request-I2", "held-consented-root-I2");
    return { child, state: driver.state() };
  });
  await page.evaluate(() => (window as InstalledWindow).installedConsent.choice(true));
  await expect.poll(() => page.evaluate(() => (window as InstalledWindow).installedConsent.state().enabled)).toBe(true);
  const staleChild = await page.evaluate(() => (window as InstalledWindow).installedConsent.child("stale-parent-child-I2", "held-consented-root-I2"));
  await page.evaluate(() => (window as InstalledWindow).installedConsent.finish("held-consented-root-I2"));
  expect(await page.evaluate(() => (window as InstalledWindow).installedConsent.root("fresh-consented-root-I2"))).toEqual({ recording: true });
  expect(await page.evaluate(() => (window as InstalledWindow).installedConsent.child("fresh-positive-child-I2", "fresh-consented-root-I2"))).toEqual({ recording: true });
  await page.evaluate(async () => {
    const driver = (window as InstalledWindow).installedConsent;
    await driver.request("fresh-positive-request-I2", "fresh-consented-root-I2"); await driver.finish("fresh-consented-root-I2");
  });
  const transactions = installedPayloads(io.envelopes).filter(payload => payload.type === "transaction");
  const positive = transactions.find(payload => payload.transaction === "fresh-consented-root-I2");
  expect(positive, "A fresh, fully consented actual sampled tree must be exported").toBeTruthy();
  expect(JSON.stringify(positive)).toContain("fresh-positive-child-I2");
  expect(JSON.stringify(positive)).toContain("fresh-positive-request-I2");
  expect(denied.state.requests.find(request => request.url.includes("positive-before-request-I2"))?.recording, "Real default BrowserTracing must create a consented request span").toBe(true);
  const deniedRequest = denied.state.requests.find(request => request.url.includes("denied-request-I2"));
  expect(deniedRequest, "Observe the actual installed outgoing-request hook, not an invented span fixture").toBeTruthy();
  expect(deniedRequest?.recording, "The denied request must not start a recording span").toBe(false);
  expect({ child: denied.child.recording, parent: denied.state.roots["held-consented-root-I2"].recording, staleChild: staleChild.recording }, "Withdrawal must stop active recording, not merely wait to filter a later envelope").toEqual({ child: false, parent: false, staleChild: false });
  const exported = JSON.stringify(transactions);
  expect(exported).not.toContain("held-consented-root-I2");
  for (const canary of ["denied-child-I2", "denied-request-I2", "stale-parent-child-I2"]) expect(exported).not.toContain(canary);
  expect(io.unexpected).toEqual([]);
});

test("installed Sentry does not record a root initiated while denied or revive it after reacceptance (I2)", async ({ page, context }) => {
  const io = await installRealSentry(context, page);
  await page.evaluate(() => (window as InstalledWindow).installedConsent.choice(false));
  const deniedRoot = await page.evaluate(() => (window as InstalledWindow).installedConsent.root("denied-created-root-I2"));
  const deniedChild = await page.evaluate(() => (window as InstalledWindow).installedConsent.child("denied-created-child-I2", "denied-created-root-I2"));
  await page.evaluate(() => (window as InstalledWindow).installedConsent.request("denied-created-request-I2", "denied-created-root-I2"));
  await page.evaluate(() => (window as InstalledWindow).installedConsent.choice(true));
  await expect.poll(() => page.evaluate(() => (window as InstalledWindow).installedConsent.state().enabled)).toBe(true);
  const resumedChild = await page.evaluate(() => (window as InstalledWindow).installedConsent.child("denied-root-resumed-child-I2", "denied-created-root-I2"));
  await page.evaluate(() => (window as InstalledWindow).installedConsent.finish("denied-created-root-I2"));
  expect(await page.evaluate(() => (window as InstalledWindow).installedConsent.root("positive-after-denied-root-I2"))).toEqual({ recording: true });
  await page.evaluate(() => (window as InstalledWindow).installedConsent.finish("positive-after-denied-root-I2"));
  const transactions = installedPayloads(io.envelopes).filter(payload => payload.type === "transaction");
  expect(transactions.find(payload => payload.transaction === "positive-after-denied-root-I2")).toBeTruthy();
  expect({ root: deniedRoot.recording, child: deniedChild.recording, resumedChild: resumedChild.recording }, "Denied root/children must be non-recording through the real SDK lifecycle").toEqual({ root: false, child: false, resumedChild: false });
  expect(JSON.stringify(transactions)).not.toContain("denied-created");
  expect(JSON.stringify(transactions)).not.toContain("denied-root-resumed");
  expect(io.unexpected).toEqual([]);
});

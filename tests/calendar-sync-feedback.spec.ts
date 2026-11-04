import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { WorkflowError, readRequestJson } from "../lib/workflow-validation";

const root = path.resolve(__dirname, "..");
const origin = "http://calendar-sync-feedback.test";
const warning = "Some older or changed calendar links could not be matched safely and were left unchanged.";
let script: string;
let css: string;

test.beforeAll(async () => {
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { CalendarIntegrationPanel } from "./components/calendar-integration-panel";
import { IntegrationCenterClient } from "./components/integration-center-client";
window.calendarUpdates = 0;
window.addEventListener("sowledger:calendar-updated", () => { window.calendarUpdates += 1; });
const Component = location.search.includes("panel") ? CalendarIntegrationPanel : IntegrationCenterClient;
const content = <><Component /><Toaster richColors duration={60000} /></>;
createRoot(document.getElementById("root")).render(location.search.includes("strict") ? <StrictMode>{content}</StrictMode> : content);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "next-calendar-feedback-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^next\/link$/ }, (args) => ({ path: args.path, namespace: "next-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "next-fixture" }, () => ({
          resolveDir: root,
          loader: "jsx",
          contents: "export default function Link(props) { return <a {...props} />; }",
        }));
      },
    }],
  });
  script = bundle.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

type Response = { result?: unknown; status?: number; error?: string; abort?: boolean };
type AccessOptions = { capability?: boolean | "missing" | "invalid"; connected?: boolean; oauthReady?: boolean; failRead?: boolean; revokeAfterSync?: boolean; displayName?: string; strict?: boolean; pendingInitial?: boolean; initialRead?: (route: Route, snapshot: Record<string, unknown>, read: number) => Promise<void>; configSave?: (route: Route) => Promise<void>; syncRequest?: (route: Route) => Promise<void> };

async function mount(page: Page, surface: "panel" | "center", responses: Response[], options: AccessOptions = {}) {
  const errors: string[] = [];
  const mutations: string[] = [];
  const oauthNavigations: string[] = [];
  const unexpected: string[] = [];
  const configs: Record<string, unknown>[] = [];
  let config: Record<string, unknown> = { calendarId: "primary", syncScheduled: true, importBusy: true };
  let lastSyncedAt: string | null = options.configSave ? "2026-10-20T12:00:00.000Z" : null;
  let syncs = 0;
  let reads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") mutations.push(url.pathname);
    if (url.origin !== origin) { unexpected.push(`${request.method()} ${request.url()}`); return route.abort(); }
    if (url.pathname === "/fixture" && request.method() === "GET") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/integrations" && request.method() === "GET") {
      reads += 1;
      if (options.failRead) return route.fulfill({ status: 503, json: { error: "Integrations unavailable" } });
      const capability = options.revokeAfterSync && reads > 1 ? false : options.capability;
      const snapshot = {
        ...(capability === "missing" ? {} : { canManage: capability === "invalid" ? "true" : capability ?? true }),
        connections: options.connected === false ? [] : [{ id: "google-connection", provider: "google_calendar", status: "connected", displayName: options.displayName ?? "Workspace calendar", externalAccountId: null, config, tokenExpiresAt: null, lastSyncedAt, lastError: null, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z" }],
        readiness: { googleCalendarOAuth: options.oauthReady ?? true, slackOAuth: false, slackManualWebhook: true, quickBooksOAuth: false },
      };
      if (options.initialRead) return options.initialRead(route, snapshot, reads);
      return route.fulfill({ json: snapshot });
    }
    if (url.pathname === "/api/integrations/google_calendar/config" && request.method() === "PATCH" && options.configSave) {
      configs.push(request.postDataJSON());
      await options.configSave(route);
      return;
    }
    if (url.pathname.endsWith("/oauth/start")) { oauthNavigations.push(url.pathname); return route.fulfill({ contentType: "text/plain", body: "Controlled OAuth navigation" }); }
    if (url.pathname === "/api/integrations/google-calendar/sync" && request.method() === "POST") {
      if (options.syncRequest) { syncs += 1; return options.syncRequest(route); }
      const response = responses[syncs++];
      if (!response || response.abort) return route.abort();
      return route.fulfill({ status: response.status ?? 200, json: { result: response.result, error: response.error } });
    }
    unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  await page.goto(`${origin}/fixture?${surface}${options.strict ? "&strict" : ""}`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  if (options.pendingInitial) {
    if (surface === "panel") await expect(page.getByRole("status")).toHaveText("Checking Google Calendar connection...");
    else await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
  }
  else if (options.failRead) await expect(page.getByRole("alert").first()).toBeVisible();
  else if (surface === "panel") {
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page.getByText("Checking Google Calendar connection...", { exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
    await expect(page.getByText("...", { exact: true })).toHaveCount(0);
  }
  return { errors, mutations, configs, oauthNavigations, unexpected, syncs: () => syncs, reads: () => reads,
    savedConfig(value: Record<string, unknown>) { config = value; lastSyncedAt = null; },
  };
}

for (const width of [390, 1280]) for (const ordering of [
  "latest read-only then old manager",
  "latest failure then old manager",
  "latest manager then old failure",
  "old manager while latest pending",
  "old failure while latest pending",
] as const) test(`panel latest-read ownership: ${ordering} at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const held: Array<{ route: Route; snapshot: Record<string, unknown> }> = [];
  const released = new Set<Route>();
  const fixture = await mount(page, "panel", [], {
    strict: true, pendingInitial: true,
    initialRead: async (route, snapshot) => { held.push({ route, snapshot }); },
  });
  const oldAccount = "older-manager-calendar@example.com";
  const latestAccount = "latest-calendar@example.com";
  const retryAccount = "recovered-calendar@example.com";
  const failure = { error: "Controlled genuine integrations read failure" };
  function connectedRead(index: number, displayName: string, canManage = true) {
    const snapshot = held[index].snapshot;
    return {
      ...snapshot, canManage,
      connections: (snapshot.connections as Array<Record<string, unknown>>).map(connection => ({ ...connection, displayName })),
      readiness: { ...(snapshot.readiness as Record<string, unknown>), googleCalendarOAuth: canManage },
    };
  }
  async function release(index: number, body: Record<string, unknown>, status = 200) {
    const { route } = held[index];
    const request = route.request();
    const completed = page.waitForResponse(response => response.request() === request);
    await route.fulfill({ status, json: body });
    released.add(route);
    const response = await completed;
    expect(response.request()).toBe(request);
    expect(response.status()).toBe(status);
    expect(await response.finished()).toBeNull();
    expect(await response.json()).toEqual(body);
  }
  async function noMutationControls() {
    await expect(page.getByRole("button", { name: /^(Sync now|Connect calendar)$/ })).toHaveCount(0);
    await expect(page.locator('a[href$="/oauth/start"]')).toHaveCount(0);
  }
  async function focusSettings() {
    const settings = page.getByRole("link", { name: "Integration settings", exact: true });
    await expect(settings).toBeVisible();
    await settings.focus();
    await expect(settings).toBeFocused();
    await page.keyboard.press("Tab");
  }
  async function latestConnected(account: string, canManage: boolean) {
    await expect(page.getByRole("heading", { name: "Google Calendar connected", exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(account.replaceAll(".", "\\.")))).toBeVisible();
    await expect(page.getByText(new RegExp(oldAccount.replaceAll(".", "\\.")))).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry connection check", exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (canManage) await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
    else {
      await expect(page.getByText("An owner or manager can connect or sync this calendar.", { exact: true })).toBeVisible();
      await noMutationControls();
    }
  }
  try {
    await expect.poll(() => held.length).toBe(2);
    expect(held[0].route.request()).not.toBe(held[1].route.request());
    if (ordering === "latest read-only then old manager") {
      await release(1, connectedRead(1, latestAccount, false));
      await latestConnected(latestAccount, false);
      await release(0, connectedRead(0, oldAccount));
      await focusSettings();
      await latestConnected(latestAccount, false);
    } else if (ordering === "latest failure then old manager") {
      const retry = page.getByRole("button", { name: "Retry connection check", exact: true });
      await release(1, failure, 503);
      await expect(retry).toBeVisible();
      await release(0, connectedRead(0, oldAccount));
      await expect(retry).toBeVisible();
      await retry.focus(); await page.keyboard.press("Tab");
      await expect(page.getByRole("alert")).toContainText("Could not check your Google Calendar connection.");
      await expect(retry).toBeVisible();
      await noMutationControls();
      expect(fixture.reads()).toBe(2);
      await retry.click();
      await expect.poll(() => held.length).toBe(3);
      await expect(page.getByRole("status")).toHaveText("Checking Google Calendar connection...");
      await noMutationControls();
      await release(2, connectedRead(2, retryAccount));
      await focusSettings();
      await latestConnected(retryAccount, true);
    } else if (ordering === "latest manager then old failure") {
      await release(1, connectedRead(1, latestAccount));
      await latestConnected(latestAccount, true);
      await release(0, failure, 503);
      await focusSettings();
      await latestConnected(latestAccount, true);
    } else {
      await release(0, ordering === "old manager while latest pending" ? connectedRead(0, oldAccount) : failure, ordering === "old manager while latest pending" ? 200 : 503);
      await expect(page.getByRole("status")).toBeVisible();
      await page.getByRole("status").click();
      await expect(page.getByRole("status")).toHaveText("Checking Google Calendar connection...");
      await noMutationControls();
      await expect(page.getByRole("heading")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retry connection check", exact: true })).toHaveCount(0);
      await expect(page.getByText(new RegExp(oldAccount.replaceAll(".", "\\.")))).toHaveCount(0);
      await release(1, connectedRead(1, latestAccount, false));
      await focusSettings();
      await latestConnected(latestAccount, false);
    }
    expect(fixture.reads()).toBe(ordering === "latest failure then old manager" ? 3 : 2);
    expect(fixture.syncs()).toBe(0);
    expect(fixture.mutations).toEqual([]);
    expect(fixture.oauthNavigations).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    // Complete every held request even when a pre-repair assertion fails.
    for (let index = 0; index < held.length; index++) {
      if (!released.has(held[index].route)) await release(index, connectedRead(index, latestAccount, false));
    }
  }
});

for (const width of [320, 390]) test(`connected panel account stays readable and controls reachable at ${width}px`, async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const account = "synthetic-long-calendar-account-for-layout-and-readability@example.com";
  const fixture = await mount(page, "panel", [], { displayName: account });
  const description = page.getByText(new RegExp(account.replaceAll(".", "\\.")));
  await expect(description).toBeVisible();
  const layout = await description.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      text: element.textContent,
      widthAvailable: element.clientWidth, widthUsed: element.scrollWidth,
      heightAvailable: element.clientHeight, heightUsed: element.scrollHeight,
      textRects: [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right })),
    };
  });
  await testInfo.attach("connected-panel-layout.json", { body: JSON.stringify(layout, null, 2), contentType: "application/json" });
  await testInfo.attach("connected-panel.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect.soft(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(width);
  expect.soft(layout.text).toContain(account);
  expect.soft(layout.widthUsed).toBeLessThanOrEqual(layout.widthAvailable);
  expect.soft(layout.heightUsed).toBeLessThanOrEqual(layout.heightAvailable);
  for (const rect of layout.textRects) {
    expect.soft(rect.left).toBeGreaterThanOrEqual(0);
    expect.soft(rect.right).toBeLessThanOrEqual(width);
  }
  const sync = page.getByRole("button", { name: "Sync now", exact: true });
  const settings = page.getByRole("link", { name: "Integration settings", exact: true });
  await expect(sync).toBeEnabled();
  for (const control of [sync, settings]) {
    await control.scrollIntoViewIfNeeded();
    const bounds = (await control.boundingBox())!;
    expect.soft(bounds.x).toBeGreaterThanOrEqual(0);
    expect.soft(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect.soft(bounds.y).toBeGreaterThanOrEqual(0);
    expect.soft(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  }
  await sync.focus();
  await expect(sync).toBeFocused();
  // WebKit on macOS uses Option-Tab to include links in keyboard navigation.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(settings).toBeFocused();
  expect(fixture.reads()).toBe(1);
  expect(fixture.syncs()).toBe(0);
  expect(fixture.mutations).toEqual([]);
  expect(fixture.oauthNavigations).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

for (const width of [390, 1280]) for (const late of ["success", "failure"] as const) test(`overlapping StrictMode initial ${late} cannot reset an edited config draft at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  let held!: { route: Route; snapshot: Record<string, unknown> };
  const fixture = await mount(page, "center", [], {
    strict: true,
    initialRead: async (route, snapshot, read) => {
      if (read === 1) { held = { route, snapshot }; return; }
      await route.fulfill({ json: snapshot });
    },
    configSave: async route => route.fulfill({ status: 409, json: { error: "Controlled save receipt: reload and try again." } }),
  });
  await expect.poll(() => fixture.reads()).toBe(2);
  const input = page.getByLabel("Google calendar ID", { exact: true });
  const push = page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true });
  const busy = page.getByLabel("Import external busy events as unavailable blocks", { exact: true });
  await expect(input).toHaveValue("primary");
  await input.fill("retained-strict-draft@example.com");
  await push.uncheck(); await busy.uncheck();
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/integrations" && response.request().method() === "GET");
  await held.route.fulfill(late === "success" ? { json: held.snapshot } : { status: 503, json: { error: "Controlled stale integrations read failure" } });
  const response = await oldResponse;
  expect(await response.finished()).toBeNull();
  // User interaction after the exact stale body finishes exercises the draft,
  // not a fake replacement form or a fixed-duration timing assumption.
  await input.focus(); await page.keyboard.press("Tab");
  await expect(input).toHaveValue("retained-strict-draft@example.com");
  await expect(push).not.toBeChecked(); await expect(busy).not.toBeChecked();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => fixture.configs.length).toBe(1);
  expect(fixture.configs).toEqual([{ calendarId: "retained-strict-draft@example.com", importBusy: false, syncScheduled: false }]);
  expect(fixture.mutations).toEqual(["/api/integrations/google_calendar/config"]);
  expect(fixture.errors).toEqual([]);
});

for (const late of ["success", "failure"] as const) test(`stale initial ${late} cannot finish a newer pending integrations read`, async ({ page }) => {
  const held: Array<{ route: Route; snapshot: Record<string, unknown> }> = [];
  const fixture = await mount(page, "center", [], {
    strict: true, pendingInitial: true,
    initialRead: async (route, snapshot) => { held.push({ route, snapshot }); },
  });
  await expect.poll(() => held.length).toBe(2);
  const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/integrations");
  await held[0].route.fulfill(late === "success" ? { json: held[0].snapshot } : { status: 503, json: { error: "Controlled stale initial failure" } });
  expect(await (await initialResponse).finished()).toBeNull();
  await page.getByRole("heading", { name: "Integrations", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Google calendar ID", { exact: true })).toHaveCount(0);
  await expect(page.getByText("...", { exact: true })).toHaveCount(2);
  await expect(page.getByText("We couldn't load your integration connections.", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  await held[1].route.fulfill({ json: held[1].snapshot });
  await expect(page.getByLabel("Google calendar ID", { exact: true })).toHaveValue("primary");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expect(fixture.reads()).toBe(2); expect(fixture.mutations).toEqual([]); expect(fixture.errors).toEqual([]);
});

test("latest initial read failure stays actionable after stale success and retry recovers", async ({ page }) => {
  let held!: { route: Route; snapshot: Record<string, unknown> };
  const fixture = await mount(page, "center", [], {
    strict: true, pendingInitial: true,
    initialRead: async (route, snapshot, read) => {
      if (read === 1) { held = { route, snapshot }; return; }
      await route.fulfill(read === 2 ? { status: 503, json: { error: "Controlled latest read failure" } } : { json: snapshot });
    },
  });
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't load your integration connections." })).toBeVisible();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText("Integrations unavailable");
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/integrations");
  await held.route.fulfill({ json: held.snapshot });
  expect(await (await oldResponse).finished()).toBeNull();
  await page.getByRole("heading", { name: "Integrations", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't load your integration connections." })).toBeVisible();
  await expect(page.getByLabel("Google calendar ID", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Google calendar ID", { exact: true })).toHaveValue("primary");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  expect(fixture.reads()).toBe(3); expect(fixture.mutations).toEqual([]); expect(fixture.errors).toEqual([]);
});

test("stale manager read cannot regrant controls after the latest read-only capability", async ({ page }) => {
  let held!: { route: Route; snapshot: Record<string, unknown> };
  const fixture = await mount(page, "center", [], {
    strict: true,
    initialRead: async (route, snapshot, read) => {
      if (read === 1) { held = { route, snapshot }; return; }
      await route.fulfill({ json: { ...snapshot, canManage: false } });
    },
  });
  await expect(page.getByText(/owner or manager/i).first()).toBeVisible();
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/integrations");
  await held.route.fulfill({ json: held.snapshot });
  expect(await (await oldResponse).finished()).toBeNull();
  await page.getByRole("heading", { name: "Integrations", exact: true }).click();
  await expect(page.getByText(/owner or manager/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Connect|Reconnect|Test|Disconnect|Sync now|Save)$/ })).toHaveCount(0);
  await expect(page.getByLabel("Google calendar ID", { exact: true })).toHaveCount(0);
  expect(fixture.reads()).toBe(2); expect(fixture.mutations).toEqual([]); expect(fixture.errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`styled Google config controls save one exact snapshot and refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let pending!: Route;
    const account = "synthetic-long-calendar-account-for-layout-and-readability@example.com";
    const fixture = await mount(page, "center", [], { displayName: account, configSave: async route => { pending = route; } });
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Google Calendar", exact: true }) });
    await expect(card.getByText(account, { exact: true })).toBeVisible();
    const accountLayout = await card.getByText(account, { exact: true }).evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }));
    expect(accountLayout.contentWidth).toBeLessThanOrEqual(accountLayout.width);
    expect(accountLayout.contentHeight).toBeLessThanOrEqual(accountLayout.height);
    await expect(card.locator("dd").filter({ hasText: "Never" })).toHaveCount(0);
    const input = page.getByLabel("Google calendar ID", { exact: true });
    await input.fill("review-team@example.com");
    await page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true }).uncheck();
    await page.getByLabel("Import external busy events as unavailable blocks", { exact: true }).uncheck();
    const save = page.getByRole("button", { name: "Save", exact: true });
    for (const control of [input, save]) {
      await control.scrollIntoViewIfNeeded();
      const bounds = (await control.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    }
    const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("#root *")].filter(element => element.getBoundingClientRect().right > innerWidth).map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 80), right: element.getBoundingClientRect().right, className: element.className })).slice(-12) }));
    expect(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(width);
    await save.click();
    await expect.poll(() => fixture.configs.length).toBe(1);
    await expect(save).toBeDisabled();
    expect(fixture.configs).toEqual([{ calendarId: "review-team@example.com", importBusy: false, syncScheduled: false }]);
    fixture.savedConfig({ calendarId: "review-team@example.com", importBusy: false, syncScheduled: false });
    await pending.fulfill({ json: { ok: true, connection: { id: "google-connection", provider: "google_calendar", config: fixture.configs[0], lastSyncedAt: null } } });
    await expect.poll(() => fixture.reads()).toBe(2);
    await expect(input).toHaveValue("review-team@example.com");
    await expect(page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Import external busy events as unavailable blocks", { exact: true })).not.toBeChecked();
    await expect(card.locator("dd").filter({ hasText: "Never" })).toHaveCount(1);
    await expect(save).toBeEnabled();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("Integration settings saved");
    await expect(page.getByText("Calendar sync complete", { exact: true })).toHaveCount(0);
    expect(fixture.mutations).toEqual(["/api/integrations/google_calendar/config"]);
    expect(fixture.errors).toEqual([]);
  });

  test(`styled Google config conflict retains editable draft and actionable feedback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mount(page, "center", [], { configSave: async route => {
      await route.fulfill({ status: 409, json: { error: "Google Calendar changed while you were updating settings. Reload it and try again." } });
    } });
    await page.getByLabel("Google calendar ID", { exact: true }).fill("retained-review@example.com");
    await page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true }).uncheck();
    await page.getByLabel("Import external busy events as unavailable blocks", { exact: true }).uncheck();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    const feedback = page.locator('[data-sonner-toast][data-type="error"]');
    await expect(feedback).toContainText("Could not save settings");
    await expect(feedback).toContainText("Reload it and try again.");
    await expect(page.getByLabel("Google calendar ID", { exact: true })).toHaveValue("retained-review@example.com");
    await expect(page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Import external busy events as unavailable blocks", { exact: true })).not.toBeChecked();
    await expect(save).toBeEnabled();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    expect(fixture.configs).toEqual([{ calendarId: "retained-review@example.com", importBusy: false, syncScheduled: false }]);
    expect(fixture.reads()).toBe(1); expect(fixture.syncs()).toBe(0); expect(fixture.errors).toEqual([]);
  });
}

for (const surface of ["panel", "center"] as const) {
  for (const capability of [false, "missing", "invalid"] as const) {
    test(`${surface} fails closed for ${capability === false ? "member" : capability} management capability`, async ({ page }) => {
      const fixture = await mount(page, surface, [], { capability });
      await expect(page.getByText(/owner or manager/i).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^(Connect|Reconnect|Test|Disconnect|Sync now|Save|Save Slack webhook|Save QuickBooks defaults|Connect Google Calendar)$/ })).toHaveCount(0);
      await expect(page.locator('a[href$="/oauth/start"]')).toHaveCount(0);
      await expect(page.getByLabel("Incoming webhook URL", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/Workspace calendar/).first()).toBeVisible();
      await expect(page.getByRole("link", { name: surface === "panel" ? "Integration settings" : "Read API documentation", exact: true })).toBeVisible();
      expect(fixture.mutations).toEqual([]);
      expect(fixture.oauthNavigations).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }

  test(`${surface} unavailable OAuth cannot be activated with keyboard or programmatic click`, async ({ page }) => {
    const fixture = await mount(page, surface, [], { connected: false, oauthReady: false });
    await expect(page.locator('a[href$="/oauth/start"]')).toHaveCount(0);
    const controls = page.getByRole("button", { name: surface === "panel" ? "Connect calendar" : /^Connect(?: Google Calendar)?$/, exact: surface === "panel" });
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      await expect(control).toBeDisabled();
      await control.evaluate(element => { (element as HTMLElement).focus(); (element as HTMLElement).click(); });
      await page.keyboard.press("Enter");
    }
    await expect(page).toHaveURL(`${origin}/fixture?${surface}`);
    expect(fixture.oauthNavigations).toEqual([]);
    expect(fixture.mutations).toEqual([]);
  });

  test(`${surface} ready managers can start the Google connection flow`, async ({ page }) => {
    const fixture = await mount(page, surface, [], { connected: false, oauthReady: true });
    if (surface === "panel") await page.getByRole("link", { name: "Connect calendar", exact: true }).click();
    else await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Google Calendar", exact: true }) }).getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/api/integrations/google-calendar/oauth/start`);
    expect(fixture.oauthNavigations).toEqual(["/api/integrations/google-calendar/oauth/start"]);
    expect(fixture.mutations).toEqual([]);
  });

  test(`${surface} a failed capability check exposes no management controls`, async ({ page }) => {
    const fixture = await mount(page, surface, [], { failRead: true });
    await expect(page.getByRole("button", { name: /^(Connect|Reconnect|Test|Disconnect|Sync now|Save)$/ })).toHaveCount(0);
    await expect(page.locator('a[href$="/oauth/start"]')).toHaveCount(0);
    expect(fixture.mutations).toEqual([]);
  });

  test(`${surface} a refreshed read-only capability removes previously available sync controls`, async ({ page }) => {
    const fixture = await mount(page, surface, [{ result: completed }], { revokeAfterSync: true });
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect.poll(() => fixture.reads()).toBe(2);
    await expect(page.getByText(/owner or manager/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now", exact: true })).toHaveCount(0);
    expect(fixture.syncs()).toBe(1);
    expect(fixture.mutations).toEqual(["/api/integrations/google-calendar/sync"]);
  });
}

const completed = { exported: 2, imported: 3, updated: 1, canceled: 4, skipped: 0, warnings: [] };

for (const surface of ["panel", "center"] as const) {
  // Omitting JSON at the component boundary must not be hidden by a success-only stub.
  test(`${surface} sync request contract`, async ({ page }) => {
    const captured: Array<{ contentType: string | undefined; body: string | null; parsed?: unknown; status?: number }> = [];
    let confirmedReplies = 0;
    const fixture = await mount(page, surface, [], { syncRequest: async route => {
      const outgoing = route.request();
      const headers = await outgoing.allHeaders();
      const request = new Request(outgoing.url(), { method: outgoing.method(), headers, body: outgoing.postData() });
      const record: (typeof captured)[number] = { contentType: headers["content-type"], body: outgoing.postData() };
      captured.push(record);
      try {
        // This executes only in the Node test process, not the browser bundle.
        record.parsed = await readRequestJson(request);
        if (!record.parsed || typeof record.parsed !== "object" || Array.isArray(record.parsed)) throw new WorkflowError("Send a JSON object.", 400);
        if (record.contentType !== "application/json" || record.body !== "{}" || Object.keys(record.parsed).length !== 0) throw new WorkflowError("Send application/json with the empty object.", 400);
      } catch (error) {
        if (!(error instanceof WorkflowError)) throw error;
        record.status = error.status;
        await route.fulfill({ status: error.status, json: { error: error.message } });
        return;
      }
      record.status = 200;
      confirmedReplies += 1;
      await route.fulfill({ json: { ok: true, result: completed } });
    } });
    const receipt = page.waitForResponse(response => new URL(response.url()).pathname === "/api/integrations/google-calendar/sync" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const response = await receipt;
    expect(await response.finished()).toBeNull();
    expect(captured).toHaveLength(1);
    if (response.status() === 400) {
      await expect(page.locator("#root").getByRole("alert")).toContainText("We couldn't confirm the latest sync");
      await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
      expect(confirmedReplies).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { calendarUpdates: number }).calendarUpdates)).toBe(0);
    }
    expect(captured[0], "The real component POST must reach the strict JSON boundary as the default-window empty object").toEqual({ contentType: "application/json", body: "{}", parsed: {}, status: 200 });
    expect(response.status()).toBe(200);
    expect(confirmedReplies).toBe(1);
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("Calendar sync complete");
    await expect(page.locator("#root").getByRole("status")).toContainText("4 outdated busy blocks cleared");
    await expect.poll(() => fixture.reads()).toBe(2);
    await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { calendarUpdates: number }).calendarUpdates)).toBe(1);
    expect(fixture.syncs()).toBe(1);
    expect(fixture.mutations).toEqual(["/api/integrations/google-calendar/sync"]);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  for (const width of [320, 1280]) test(`${surface} sync scope at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mount(page, surface, []);
    const sync = page.getByRole("button", { name: "Sync now", exact: true });
    const scope = surface === "panel" ? page.locator("section").filter({ has: sync }) : page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Calendar sync controls", exact: true }) });
    const cue = scope.getByText("Sync covers the past 14 days and the next 60 days, not the dates currently shown.", { exact: true });
    const screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-calendar-sync-"));
    const screenshot = path.join(screenshots, `${surface}-${width}-${testInfo.project.name}.png`);
    try {
      await expect(cue).toBeVisible();
      await cue.scrollIntoViewIfNeeded();
      const layout = await cue.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return {
          documentWidth: document.documentElement.scrollWidth,
          width: element.clientWidth, contentWidth: element.scrollWidth,
          height: element.clientHeight, contentHeight: element.scrollHeight,
          lines: Array.from(range.getClientRects(), rect => ({ top: rect.top, left: rect.left, right: rect.right })),
        };
      });
      expect(layout.documentWidth).toBeLessThanOrEqual(width);
      expect(layout.contentWidth).toBeLessThanOrEqual(layout.width);
      expect(layout.contentHeight).toBeLessThanOrEqual(layout.height);
      expect(layout.lines.length).toBeGreaterThan(0);
      for (const line of layout.lines) { expect(line.left).toBeGreaterThanOrEqual(0); expect(line.right).toBeLessThanOrEqual(width); }
      if (width === 320) expect(new Set(layout.lines.map(line => line.top)).size).toBeGreaterThan(1);
      expect(await cue.evaluate((element, button) => Boolean(element.compareDocumentPosition(button as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await sync.elementHandle())).toBe(true);
      await sync.scrollIntoViewIfNeeded();
      await expect(sync).toBeEnabled();
      await sync.focus();
      await expect(sync).toBeFocused();
      const bounds = (await sync.boundingBox())!;
      const cueBounds = (await cue.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      expect(Math.abs(bounds.y - (cueBounds.y + cueBounds.height))).toBeLessThanOrEqual(200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(fixture.syncs()).toBe(0);
      expect(fixture.mutations).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally {
      // Only controlled fixture content is captured, outside the source checkout.
      await page.screenshot({ path: screenshot, fullPage: true });
      testInfo.annotations.push({ type: "controlled-fixture-screenshot", description: screenshot });
    }
  });
}

for (const surface of ["panel", "center"] as const) {
  test(`${surface} shows skipped-event warnings and every result count without claiming complete success`, async ({ page }) => {
    const fixture = await mount(page, surface, [{ result: { ...completed, skipped: 2, warnings: [warning] } }]);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const toast = page.locator('[data-sonner-toast][data-type="warning"]');
    await expect(toast).toContainText("Calendar sync needs attention");
    await expect(toast).toContainText("2 sent to Google, 0 SOWLedger events removed from Google, 3 busy events added, 1 updated, 4 outdated busy blocks cleared, 2 left unchanged.");
    await expect(toast).toContainText(warning);
    await expect(page.getByText("Calendar sync complete", { exact: true })).toHaveCount(0);
    // Keep warnings available after the transient toast is dismissed.
    await expect(page.locator("#root").getByRole("alert")).toContainText(warning);
    await expect.poll(() => fixture.reads()).toBe(2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { calendarUpdates: number }).calendarUpdates)).toBe(1);
    expect(fixture.errors).toEqual([]);
  });

  test(`${surface} reports a confirmed successful sync with removed availability`, async ({ page }) => {
    const fixture = await mount(page, surface, [{ result: completed }]);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const toast = page.locator('[data-sonner-toast][data-type="success"]');
    await expect(toast).toContainText("Calendar sync complete");
    await expect(toast).toContainText("4 outdated busy blocks cleared");
    await expect(page.locator("#root").getByRole("status")).toContainText("0 left unchanged");
    expect(fixture.syncs()).toBe(1);
    expect(fixture.errors).toEqual([]);
  });

  test(`${surface} distinguishes removed SOWLedger exports from cleared imported busy blocks`, async ({ page }) => {
    await mount(page, surface, [{ result: { ...completed, removed: 2 } }]);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const status = page.locator("#root").getByRole("status");
    await expect(status).toContainText("2 SOWLedger events removed from Google");
    await expect(status).toContainText("4 outdated busy blocks cleared");
  });

  for (const failure of [
    { label: "HTTP error", response: { status: 502, error: "Google Calendar could not be reached" } },
    { label: "network error", response: { abort: true } },
    { label: "missing result", response: {} },
    { label: "invalid counts", response: { result: { ...completed, canceled: -1 } } },
    { label: "invalid removed count", response: { result: { ...completed, removed: -1 } } },
  ]) {
    test(`${surface} does not report success after ${failure.label} and allows retry`, async ({ page }) => {
      const fixture = await mount(page, surface, [failure.response, { result: completed }]);
      const button = page.getByRole("button", { name: "Sync now", exact: true });
      await button.click();
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText("Calendar sync failed");
      await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
      await expect(page.locator("#root").getByRole("alert")).toContainText("We couldn't confirm the latest sync");
      expect(await page.evaluate(() => (window as unknown as { calendarUpdates: number }).calendarUpdates)).toBe(0);
      expect(fixture.reads()).toBe(1);
      await expect(button).toBeEnabled();
      await button.click();
      await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("Calendar sync complete");
      expect(fixture.syncs()).toBe(2);
      expect(fixture.errors).toEqual([]);
    });
  }
}

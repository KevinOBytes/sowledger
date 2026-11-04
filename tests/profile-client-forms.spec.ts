import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
const origin = "http://profile-client.test";
let script: string;
let css: string;
const originalUser = { id: "user", email: "kevin@example.com", displayName: "Kevin", timezone: "America/New_York", preferredTags: ["focus"], calendarPreferences: { visibleStartHour: 7, visibleEndHour: 19 } };
const originalClients = [{ id: "acme", name: "Acme", email: "billing@example.com", status: "active" }, { id: "beta", name: "Beta", email: null, status: "active" }];

test.beforeAll(async () => {
  const result = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import SettingsPage from "./app/(app)/settings/page";
import { ClientsPageClient } from "./components/clients-page-client";
import { CreateClientButton } from "./components/create-client-button";
window.renderFixture = () => { const query = new URLSearchParams(location.search); const member = query.has("member"); window.fixtureRoot ||= createRoot(document.getElementById("root")); window.fixtureRoot.render(<StrictMode>{query.has("settings") ? <SettingsPage /> : <main className="p-4 sm:p-8">{!member && <CreateClientButton />}<ClientsPageClient initialClients={window.fixtureClients} projects={[]} organizations={[]} people={[]} canManageClients={!member}/></main>}</StrictMode>); }; window.renderFixture();` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "next-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: root, loader: "jsx", contents: args.path === "next/link" ? "export default function Link(props) { return <a {...props}/>; }" : "const router = { refresh() { window.fixtureRefreshes = (window.fixtureRefreshes || 0) + 1; }, push() {} }; export const useRouter = () => router;" }));
  } }] });
  script = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

type Write = { path: string; body: Record<string, unknown> };
async function mount(page: Page, query = "", mode = "success") {
  const writes: Write[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let user = structuredClone(originalUser);
  let initialReads = 0;
  let clients = structuredClone(originalClients);
  if (query.includes("archived")) clients[0].status = "archived";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (request.method() === "GET") {
      initialReads++;
      const snapshot = structuredClone(user);
      if (mode === "late-initial" && initialReads === 1) await gate;
      return route.fulfill({ json: { ok: true, user: snapshot } });
    }
    const body = request.postDataJSON();
    writes.push({ path: url.pathname, body });
    if (mode === "pending") await gate;
    if (mode === "http") return route.fulfill({ status: 500, json: { error: "SQL private details" } });
    if (mode === "network") return route.abort("failed");
    if (mode === "malformed") return route.fulfill({ json: { ok: true, user: { id: "user" }, client: { id: "acme" } } });
    if (mode === "mismatch") return route.fulfill({ json: { ok: true, user: originalUser, client: { ...originalClients[0], id: "wrong-client" } } });
    if (url.pathname === "/api/user/settings") {
      user = { ...user, ...body };
      if (mode === "partial") return route.fulfill({ json: { ok: true, user: { id: user.id, email: user.email, displayName: user.displayName, timezone: user.timezone, preferredTags: user.preferredTags } } });
      return route.fulfill({ json: { ok: true, user } });
    }
    if (request.method() === "POST") return route.fulfill({ json: { ok: true, client: { id: "new", workspaceId: "workspace", status: "active", name: body.name, email: body.email ?? null, address: body.address ?? null, currencyOverride: null } } });
    const client = { ...clients.find(c => c.id === body.clientId)!, ...body, email: Object.hasOwn(body, "email") ? (body.email?.trim().toLowerCase() || null) : clients.find(c => c.id === body.clientId)!.email };
    if (mode === "concurrent-unsubmitted") {
      if (Object.hasOwn(body, "status")) { client.name = "Renamed by another manager"; client.email = "updated@example.com"; }
      else client.status = "archived";
    }
    if (mode === "wrong-name") client.name = "Wrong saved name";
    if (mode === "wrong-email") client.email = "wrong@example.com";
    if (mode === "wrong-status") client.status = body.status === "active" ? "archived" : "active";
    clients = clients.map(c => c.id === client.id ? client : c);
    return route.fulfill({ json: { ok: true, client } });
  });
  async function load() {
    await page.goto(`${origin}/fixture${query}`);
    await page.evaluate((data) => { (window as unknown as { fixtureClients: unknown }).fixtureClients = data; }, clients);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(query.includes("settings") ? page.getByLabel("Display name") : page.getByText("No clients yet", { exact: true }).or(page.getByRole("heading", { name: "Acme", exact: true }))).toBeVisible();
  }
  await load();
  return { writes, release: () => release!(), initialReads: () => initialReads, reload: load, succeed: () => { mode = "success"; }, errors };
}

test("profile sends an explicit blank name and renders saved clear after reload", async ({ page }) => {
  const f = await mount(page, "?settings");
  await page.getByLabel("Display name").fill("");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  expect(f.writes[0].body.displayName).toBe("");
  await f.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("");
  await expect(page.getByLabel("Timezone")).toHaveValue("America/New_York");
  expect(f.errors).toEqual([]);
});

test("profile rejects an incomplete saved profile even when its editable fields match", async ({ page }) => {
  await mount(page, "?settings", "partial");
  await page.getByLabel("Display name").fill("New name");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/try again/i);
  await expect(page.getByLabel("Display name")).toHaveValue("New name");
});

test("late initial profile read cannot replace a draft or save after StrictMode effect cleanup", async ({ page }) => {
  const f = await mount(page, "?settings", "late-initial");
  await expect.poll(f.initialReads).toBe(2);
  await page.getByLabel("Display name").fill("");
  const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/user/settings") && response.request().method() === "GET");
  f.release();
  await lateResponse;
  // Observe the rendered result after the delayed fetch continuation and React paint.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel("Display name")).toHaveValue("");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  expect(f.writes[0].body.displayName).toBe("");
  await f.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("");
});

for (const mode of ["http", "network", "malformed", "mismatch"]) {
  test(`profile ${mode} preserves the draft and offers a retry`, async ({ page }) => {
    const f = await mount(page, "?settings", mode);
    await page.getByLabel("Display name").fill("New name");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/try again/i);
    await expect(page.getByRole("alert")).not.toContainText("SQL");
    await expect(page.getByLabel("Display name")).toHaveValue("New name");
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
    expect(f.writes).toHaveLength(1);
    f.succeed();
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Settings saved");
    expect(f.writes).toHaveLength(2);
  });
  test(`client ${mode} preserves edit and does not claim saved email`, async ({ page }) => {
    const f = await mount(page, "", mode);
    await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
    await page.getByLabel("Client name").fill("New name");
    await page.getByLabel("Billing email", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/try again/i);
    await expect(page.getByRole("alert")).not.toContainText("SQL");
    await expect(page.getByLabel("Client name")).toHaveValue("New name");
    await expect(page.getByLabel("Billing email", { exact: true })).toHaveValue("");
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].body.email).toBe("");
    f.succeed();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("saved");
    expect(f.writes).toHaveLength(2);
  });
}

test("profile in-flight guard blocks duplicate submits and freezes fields", async ({ page }) => {
  const f = await mount(page, "?settings", "pending");
  await page.getByLabel("Display name").fill("New name");
  await page.locator("form").evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
  await expect.poll(() => f.writes.length).toBe(1);
  for (const label of ["Display name", "Timezone", "Preferred tags"]) await expect(page.getByLabel(label)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  f.release();
  await expect(page.getByRole("status")).toContainText("Settings saved");
});

test("client clear reloads truthfully; keyboard cancel is request-free with focus return", async ({ page }) => {
  const f = await mount(page);
  await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
  await expect(page.getByLabel("Client name")).toBeFocused();
  await page.getByLabel("Billing email", { exact: true }).fill("");
  await page.getByLabel("Billing email", { exact: true }).press("Enter");
  await expect(page.getByRole("status")).toContainText("saved");
  await f.reload();
  await expect(page.locator("article").first()).toContainText("No billing email");
  await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
  await page.getByLabel("Client name").press("Escape");
  await expect(page.getByRole("button", { name: "Edit Client", exact: true }).first()).toBeFocused();
  expect(f.writes).toHaveLength(1);
});

test("client pending blocks duplicate Enter, cancel and switching editors", async ({ page }) => {
  const f = await mount(page, "", "pending");
  await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
  await page.getByLabel("Client name").fill("New name");
  await page.getByLabel("Client name").evaluate(input => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await expect(page.getByLabel("Client name")).toBeDisabled();
  await expect(page.getByLabel("Billing email", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel editing", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Client", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(f.writes).toHaveLength(1);
  f.release();
  await expect(page.getByRole("heading", { name: "New name", exact: true })).toBeVisible();
});

test("client edit accepts submitted canonical fields and renders an independently archived returned client", async ({ page }) => {
  const f = await mount(page, "", "concurrent-unsubmitted");
  await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
  await page.getByLabel("Client name").fill(" Saved client ");
  await page.getByLabel("Billing email", { exact: true }).fill(" NEW@EXAMPLE.COM ");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Client changes saved");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const archived = page.getByRole("heading", { name: "Archived clients", exact: true }).locator("..");
  await expect(archived.getByRole("heading", { name: "Saved client", exact: true })).toBeVisible();
  await expect(archived).toContainText("new@example.com");
  await expect(archived.getByRole("button", { name: "Restore Client", exact: true })).toBeVisible();
  expect(f.writes[0].body).toEqual({ clientId: "acme", name: "Saved client", email: "NEW@EXAMPLE.COM" });
  expect(f.writes).toHaveLength(1);
});

for (const action of ["Archive", "Restore"]) {
  test(`${action} accepts its saved status and renders independent returned name/email changes`, async ({ page }) => {
    const f = await mount(page, action === "Restore" ? "?archived" : "", "concurrent-unsubmitted");
    await page.getByRole("button", { name: `${action} Client`, exact: true }).first().click();
    await expect(page.getByRole("status")).toContainText(action === "Archive" ? "archived" : "restored");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const clientCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Renamed by another manager", exact: true }) });
    await expect(clientCard).toContainText("updated@example.com");
    await expect(clientCard.getByRole("button", { name: action === "Archive" ? "Restore Client" : "Archive Client", exact: true })).toBeVisible();
    expect(f.writes[0].body).toEqual({ clientId: "acme", status: action === "Archive" ? "archived" : "active" });
    expect(f.writes).toHaveLength(1);
  });
}

for (const field of ["name", "email"]) {
  test(`client edit rejects a complete correct-identity response with wrong submitted ${field}`, async ({ page }) => {
    const f = await mount(page, "", `wrong-${field}`);
    await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
    await page.getByLabel("Client name").fill("Saved client");
    await page.getByLabel("Billing email", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/try again/i);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByLabel("Client name")).toHaveValue("Saved client");
    await expect(page.getByLabel("Billing email", { exact: true })).toHaveValue("");
    expect(f.writes).toHaveLength(1);
  });
}

for (const action of ["Archive", "Restore"]) {
  test(`${action} rejects a complete correct-identity response with wrong submitted status`, async ({ page }) => {
    const f = await mount(page, action === "Restore" ? "?archived" : "", "wrong-status");
    const button = page.getByRole("button", { name: `${action} Client`, exact: true }).first();
    await button.click();
    await expect(page.getByRole("alert")).toContainText(/try again/i);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(f.writes).toHaveLength(1);
  });
}

for (const action of ["Archive", "Restore"]) for (const mode of ["http", "network", "malformed", "mismatch"]) {
  test(`${action} ${mode} keeps saved status unchanged until a successful manual retry`, async ({ page }) => {
    const f = await mount(page, action === "Restore" ? "?archived" : "", mode);
    const button = page.getByRole("button", { name: `${action} Client`, exact: true }).first();
    await button.click();
    await expect(page.getByRole("alert")).toContainText(/try again/i);
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(button).toBeEnabled();
    expect(f.writes).toHaveLength(1);
    f.succeed();
    await button.click();
    await expect(page.getByRole("status")).toContainText(action === "Archive" ? "archived" : "restored");
    expect(f.writes).toHaveLength(2);
  });
}

test("archive and restore use saved responses and announce persistence", async ({ page }) => {
  const f = await mount(page);
  await page.getByRole("button", { name: "Archive Client", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("archived");
  await f.reload();
  await expect(page.getByRole("heading", { name: "Archived clients" })).toBeVisible();
  await page.getByRole("button", { name: "Restore Client", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("restored");
  await f.reload();
  await expect(page.getByRole("button", { name: "Restore Client", exact: true })).toHaveCount(0);
});

test("archive failure is visible and retryable; pending disables conflicting mutations but not links", async ({ page }) => {
  const f = await mount(page, "", "pending");
  await page.getByRole("button", { name: "Archive Client", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Archive Client", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Client", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("link", { name: "View projects" }).first()).toBeVisible();
  f.release();
  await expect(page.getByRole("status")).toContainText("archived");
  await mount(page, "", "http");
  await page.getByRole("button", { name: "Archive Client", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText(/try again/i);
  await expect(page.getByRole("button", { name: "Archive Client", exact: true }).first()).toBeEnabled();
});

test("member has no mutation controls and empty state explains manager ownership", async ({ page }) => {
  await mount(page, "?member");
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View projects" }).first()).toBeVisible();
  await page.evaluate(() => { const w = window as unknown as { fixtureClients: unknown[]; renderFixture: () => void }; w.fixtureClients = []; w.renderFixture(); });
  await expect(page.getByText(/ask.*owner|ask.*manager/i)).toBeVisible();
});

test("create pending prevents close and duplicate submission, then restores opener focus", async ({ page }) => {
  const f = await mount(page, "", "pending");
  await page.getByRole("button", { name: "New Client", exact: true }).click();
  await page.getByLabel("Company Name", { exact: true }).fill("New client");
  await page.locator("dialog form").evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
  await expect.poll(() => f.writes.length).toBe(1);
  await expect(page.getByLabel("Company Name", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close modal", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  f.release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Client", exact: true })).toBeFocused();
});

for (const mode of ["http", "network", "malformed", "mismatch"]) {
  test(`create ${mode} retains draft and warns to check list before manual retry`, async ({ page }) => {
    const f = await mount(page, "", mode);
    await page.getByRole("button", { name: "New Client", exact: true }).click();
    await page.getByLabel("Company Name", { exact: true }).fill("New client");
    await page.getByRole("button", { name: "Save Client", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/check the client list/i);
    await expect(page.getByRole("alert")).not.toContainText("SQL");
    await expect(page.getByLabel("Company Name", { exact: true })).toHaveValue("New client");
    await expect(page.getByRole("button", { name: "Save Client", exact: true })).toBeEnabled();
    expect(f.writes).toHaveLength(1);
  });
}

for (const width of [320, 390, 1440]) {
  test(`settings navigation and client footer remain reachable without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(page, "?settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Settings navigation" }).getByRole("link")).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mount(page);
    for (const link of await page.getByRole("link").all()) {
      const box = await link.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole("button", { name: "Edit Client", exact: true }).first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("create error keeps alert, header and footer fully visible at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mount(page, "", "http");
  await page.getByRole("button", { name: "New Client", exact: true }).click();
  await page.getByLabel("Company Name", { exact: true }).fill("New client");
  await page.getByRole("button", { name: "Save Client", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
  const heading = await page.getByRole("heading", { name: "Add Client", exact: true }).boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(16);
  await expect(page.getByRole("button", { name: "Save Client", exact: true })).toBeInViewport({ ratio: 1 });
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
const origin = "http://dialog-regression.test";

for (const outcome of ["success", "failure", "uncertain", "wrong-project"] as const) {
  test(`project pending draft survives close and duplicate attempts: ${outcome}`, async ({ page }) => {
    await mount(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route("**/api/projects", async (route) => {
      requests++;
      await held;
      await route.fulfill({ status: outcome === "failure" ? 500 : 200, json: outcome === "success"
        ? { ok: true, project: { id: "created", name: "Project A", billingModel: "hourly", budgetType: "none", budgetAmount: null, clientId: null } }
        : outcome === "failure" ? { error: "Project was not saved." }
        : outcome === "wrong-project" ? { ok: true, project: { id: "other", name: "Project B", billingModel: "hourly", budgetType: "none", clientId: null, budgetAmount: null } }
        : { ok: true } });
    });
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create New Project" });
    await dialog.getByLabel("Project Name", { exact: true }).fill("Project A");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await dialog.getByRole("button", { name: "Close modal" }).evaluate((element: HTMLButtonElement) => element.click());
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "New Project", exact: true }).evaluate((element: HTMLButtonElement) => element.click());
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
    await dialog.locator("form").evaluate((element: HTMLFormElement) => element.requestSubmit());
    expect(requests).toBe(1);
    release();
    if (outcome === "success") await expect(dialog).toHaveCount(0);
    else {
      await expect(dialog.getByRole("alert")).toBeVisible();
      await dialog.getByRole("button", { name: "Back", exact: true }).click();
      await expect(dialog.getByLabel("Project Name", { exact: true })).toHaveValue("Project A");
    }
  });
}

test("project client-list response belongs only to the form session that requested it", async ({ page }) => {
  await mount(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/clients", async route => {
    const current = ++reads;
    if (current === 1) await gate;
    await route.fulfill({ json: { clients: [{ id: String(current), name: current === 1 ? "Old client" : "Current client" }] } });
  });
  const trigger = page.getByRole("button", { name: "New Project", exact: true });
  await trigger.click();
  await expect.poll(() => reads).toBe(1);
  await page.keyboard.press("Escape");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create New Project" });
  await expect(dialog.getByRole("option", { name: "Current client" })).toHaveCount(1);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/clients");
  release(); await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(dialog.getByRole("option", { name: "Old client" })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: "Current client" })).toHaveCount(1);
});
let script: string;
let css: string;
let screenshots: string;

test.beforeAll(async () => {
  screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-dialog-screenshots-"));
  // Real components and current-source CSS; only Next navigation and HTTP are mocked.
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CreateClientButton } from "./components/create-client-button";
import { CreateProjectButton } from "./components/create-project-button";
import { Sidebar } from "./components/sidebar";
createRoot(document.getElementById("root")).render(<StrictMode><Sidebar /><main className="min-h-[1600px] p-6 md:ml-80"><h1>Workspace</h1><CreateClientButton /><CreateProjectButton /><button>Background action</button></main></StrictMode>);`,
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
      name: "next-dialog-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({ path: args.path, namespace: "next-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "next-fixture" }, (args) => ({
          resolveDir: root,
          loader: "jsx",
          contents: args.path === "next/navigation"
            ? `export const usePathname = () => "/dashboard"; export const useRouter = () => ({ refresh() { window.fixtureRefreshes = (window.fixtureRefreshes || 0) + 1; }, push() {} });`
            : args.path === "next/link"
              ? `export default function Link(props) { return <a {...props} />; }`
              : `export default function Image({ unoptimized, priority, fill, ...props }) { return <img {...props} />; }`,
        }));
      },
    }],
  });
  script = bundle.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

type Write = { path: string; body: Record<string, unknown> };

async function mount(page: Page, options: { failFirstWrite?: boolean } = {}) {
  const writes: Write[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="overflow:auto"><div id="root"></div></body></html>' });
    if (url.pathname === "/api/clients" || url.pathname === "/api/projects") {
      if (request.method() === "GET") return route.fulfill({ json: { clients: [{ id: "acme", name: "Acme" }] } });
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      if (options.failFirstWrite && writes.length === 1) return route.fulfill({ status: 500, json: { error: "We couldn't save your changes. Please try again." } });
      const saved = request.postDataJSON();
      return route.fulfill({ json: { ok: true, client: { id: "created-client", workspaceId: "studio", name: saved.name, email: saved.email ?? null, address: saved.address ?? null, currencyOverride: null, status: "active" }, project: { id: "created-project", ...saved } } });
    }
    if (url.pathname === "/api/notifications") return route.fulfill({ json: { notifications: [], unreadCount: 0 } });
    if (url.pathname === "/api/auth/workspaces") return route.fulfill({ json: { currentWorkspaceId: "studio", workspaces: [{ id: "studio", name: "Studio", role: "owner" }, { id: "other", name: "Other workspace", role: "owner" }] } });
    return route.abort();
  });
  await page.goto(`${origin}/fixture`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("button", { name: "New Client", exact: true })).toBeVisible();
  return { writes, errors };
}

async function expectInsideViewport(page: Page, element: Locator, margin = 0) {
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(margin);
  expect(box!.y).toBeGreaterThanOrEqual(margin);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - margin);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - margin);
}

async function expectFocusInside(dialog: Locator) {
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  for (const kind of ["client", "project"] as const) {
    test(`${kind} dialog stays usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { errors } = await mount(page);
      const trigger = page.getByRole("button", { name: kind === "client" ? "New Client" : "New Project", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: kind === "client" ? "Add Client" : "Create New Project", exact: true });
      await expect(dialog).toBeVisible();
      await expectInsideViewport(page, dialog, 16);
      await expectInsideViewport(page, dialog.getByRole("button", { name: "Close modal" }));
      const input = dialog.getByLabel(kind === "client" ? "Company Name" : "Project Name", { exact: true });
      await expect(input).toBeFocused();
      await input.fill("Client website");
      const submit = dialog.getByRole("button", { name: kind === "client" ? "Save Client" : "Next", exact: true });
      await expectInsideViewport(page, submit);
      await page.screenshot({ path: path.join(screenshots, `${kind}-${viewport.width}.png`) });

      // Native modal behavior must keep background controls out of the focus sequence.
      await page.getByRole("button", { name: "Background action" }).evaluate((element) => element.focus());
      await expectFocusInside(dialog);
      await submit.focus();
      await page.keyboard.press("Tab");
      await expectFocusInside(dialog);
      await page.keyboard.press("Shift+Tab");
      await expectFocusInside(dialog);
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      // Creation dialogs should not discard work on a backdrop click.
      await page.mouse.click(2, 2);
      await expect(dialog).toBeVisible();

      if (kind === "project") {
        await submit.click();
        await expect(dialog.getByText("Step 2 of 2", { exact: true })).toBeVisible();
        await expectInsideViewport(page, dialog, 16);
        await expectInsideViewport(page, dialog.getByRole("button", { name: "Create Project", exact: true }));
        await page.screenshot({ path: path.join(screenshots, `project-step-2-${viewport.width}.png`) });
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.locator("body")).toHaveCSS("overflow", "auto");
      expect(errors).toEqual([]);
    });
  }
}

test("client errors keep the form editable and retry sends the same existing payload", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { writes, errors } = await mount(page, { failFirstWrite: true });
  await page.getByRole("button", { name: "New Client", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Client" });
  await dialog.getByLabel("Company Name", { exact: true }).fill(" Acme ");
  await dialog.getByLabel(/^Billing Email/).fill("billing@example.com");
  await dialog.getByLabel(/^Address/).fill("123 Main Street");
  await dialog.getByRole("button", { name: "Save Client", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Please try again.");
  await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
  await expectInsideViewport(page, dialog, 16);
  await expectInsideViewport(page, dialog.getByRole("heading", { name: "Add Client", exact: true }), 16);
  await expectInsideViewport(page, dialog.getByRole("button", { name: "Close modal", exact: true }), 16);
  await expectInsideViewport(page, dialog.getByRole("button", { name: "Save Client", exact: true }));
  await expect(dialog.getByLabel("Company Name", { exact: true })).toHaveValue(" Acme ");
  await page.screenshot({ path: path.join(screenshots, "client-error-320.png") });
  await dialog.getByRole("button", { name: "Save Client", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: "/api/clients", body: { name: "Acme", email: "billing@example.com", address: "123 Main Street" } })));
  expect(await page.evaluate(() => (window as unknown as { fixtureRefreshes: number }).fixtureRefreshes)).toBe(1);
  expect(errors).toEqual([]);
});

test("client cancellation keeps its draft, while project cancellation resets its two-step form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await mount(page);
  const newClient = page.getByRole("button", { name: "New Client", exact: true });
  await newClient.click();
  await page.getByLabel("Company Name", { exact: true }).fill("Draft client");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await newClient.click();
  await expect(page.getByLabel("Company Name", { exact: true })).toHaveValue("Draft client");
  await page.keyboard.press("Escape");
  const newProject = page.getByRole("button", { name: "New Project", exact: true });
  await newProject.click();
  await page.getByLabel("Project Name", { exact: true }).fill("Draft project");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.keyboard.press("Escape");
  await newProject.click();
  await expect(page.getByText("Step 1 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Project Name", { exact: true })).toHaveValue("");
  expect(writes).toEqual([]);
});

test("project presets, client selection, back, and retry preserve their existing payload", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { writes, errors } = await mount(page, { failFirstWrite: true });
  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create New Project" });
  await dialog.getByRole("button", { name: /Fee budget/ }).click();
  await dialog.getByRole("combobox", { name: "Select Client", exact: true }).selectOption("acme");
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Select Budget Type" })).toHaveValue("fees");
  await expect(dialog.getByRole("spinbutton", { name: "Amount" })).toHaveValue("10000");
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog.getByLabel("Project Name", { exact: true })).toHaveValue("Website Launch");
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Please try again.");
  await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
  await expectInsideViewport(page, dialog, 16);
  await expectInsideViewport(page, dialog.getByRole("button", { name: "Create Project", exact: true }));
  await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: "/api/projects", body: { name: "Website Launch", clientId: "acme", billingModel: "fixed_fee", budgetType: "fees", budgetAmount: 10000 } })));
  expect(await page.evaluate(() => (window as unknown as { fixtureRefreshes: number }).fixtureRefreshes)).toBe(1);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`mobile More contains focus and closes accessibly at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { errors } = await mount(page);
    const trigger = page.getByRole("button", { name: "More", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "More SOWLedger navigation" });
    await expectFocusInside(dialog);
    await expect(dialog.getByRole("button", { name: "Close more navigation" })).toBeFocused();
    await expectInsideViewport(page, dialog, 12);
    await expect(dialog.getByRole("combobox", { name: "Workspace", exact: true })).toHaveValue("studio");
    await expect(dialog.getByRole("link")).toHaveCount(13);
    await expect(dialog.getByRole("link", { name: "Exports", exact: true })).toHaveAttribute("href", "/exports");
    await page.screenshot({ path: path.join(screenshots, `more-${viewport.width}.png`) });
    await dialog.getByRole("link", { name: "Sign out", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expectFocusInside(dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("body")).toHaveCSS("overflow", "auto");
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("resizing mobile More to desktop closes the modal without leaving the page inert", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mount(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("overflow", "auto");
  await page.getByRole("button", { name: "Background action" }).focus();
  await expect(page.getByRole("button", { name: "Background action" })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test.afterAll(() => {
  console.log(`Dialog screenshots: ${screenshots}`);
});

import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const root = path.resolve(__dirname, ".."), origin = "http://tag-settings.test";
const original = { id: "target", workspaceId: "workspace", name: "focus", color: "rebeccapurple", projectId: null as string | null, isSOWLedgerDefault: false, status: "active" };
let script: string, css: string;
test.beforeAll(async () => {
  script = (await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `import { createRoot } from "react-dom/client"; import { StrictMode } from "react"; import { TagsDataTable } from "./components/tags-data-table";
window.renderFixture = (props = window.fixtureProps) => { window.fixtureProps = props; window.fixtureRoot ||= createRoot(document.getElementById("root")); window.fixtureRoot.render(<StrictMode><main className="min-w-0 p-4 sm:p-8"><TagsDataTable key={props.workspaceId} {...props}/></main></StrictMode>); }; window.renderFixture();` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "next", setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, args => ({ path: args.path, namespace: "fixture" })); b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const useRouter = () => ({ refresh() { window.refreshes = (window.refreshes || 0) + 1; if(window.refreshError) throw Error("refresh failed"); } });` })); } }] })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});
type Write = { method: string; body: Record<string, unknown>; url: string };
async function mount(page: Page, mode = "success", extra: Record<string, unknown> = {}) {
  const writes: Write[] = [], errors: string[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  page.on("pageerror", e => errors.push(e.message));
  let rows = [structuredClone(original), { ...original, id: "other", name: "other" }];
  const props = { initialTags: rows, projects: [{ id: "project", name: "Archived project" }], workspaceId: "workspace", canManageTags: true, ...extra };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname !== "/api/settings/tags") throw Error(`Unexpected fixture request ${url.pathname}`);
    const body = request.method() === "DELETE" ? {} : request.postDataJSON(); writes.push({ body, url: request.url(), method: request.method() });
    if (mode === "pending") await gate;
    if (mode === "http") return route.fulfill({ status: 500, json: { error: "private SQL provider secret" } });
    if (mode === "network") return route.abort("failed");
    if (mode === "json") return route.fulfill({ contentType: "application/json", body: "{" });
    if (mode === "malformed") return route.fulfill({ json: { ok: true, tag: { id: "target" } } });
    if (request.method() === "DELETE") { if (mode === "delete-bad") return route.fulfill({ json: { ok: false } }); rows = rows.filter(t => t.id !== url.searchParams.get("id")); return route.fulfill({ json: { ok: true } }); }
    let tag = { ...(request.method() === "POST" ? { ...original, id: "new", color: "#3b82f6" } : rows.find(t => t.id === body.tagId)!), ...body, ...(body.name !== undefined ? { name: body.name.trim().toLowerCase() } : {}) };
    if (mode === "wrong-target") tag.id = request.method() === "POST" ? "target" : "wrong";
    if (mode === "wrong-workspace") tag.workspaceId = "foreign";
    if (mode === "wrong-name") tag.name = "not submitted";
    if (mode === "wrong-color") tag.color = "red";
    if (mode === "wrong-project") tag.projectId = "wrong";
    if (mode === "wrong-boolean") tag.isSOWLedgerDefault = !tag.isSOWLedgerDefault;
    if (mode === "wrong-status") tag.status = tag.status === "active" ? "archived" : "active";
    if (mode === "existing-id") tag.id = "target";
    if (mode === "concurrent") tag = { ...tag, name: "concurrent name", status: "archived" };
    rows = request.method() === "POST" ? [tag, ...rows] : rows.map(t => t.id === body.tagId ? tag : t);
    return route.fulfill({ json: { ok: true, tag } });
  });
  await page.goto(`${origin}/fixture`); await page.evaluate(p => { (window as unknown as { fixtureProps: unknown }).fixtureProps = p; }, props); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expect(page.getByLabel("Search or filter tags")).toBeVisible();
  return { writes, release, errors, succeed() { mode = "success"; }, async rerender(changes: Record<string, unknown>) { await page.evaluate(p => { const w = window as unknown as { fixtureProps: Record<string, unknown>; renderFixture: (p: unknown) => void }; w.renderFixture({ ...w.fixtureProps, ...p }); }, changes); } };
}
for (const width of [320, 390, 1440]) {
  test(`member read/search/plain reference values no writes at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); const f = await mount(page, "success", { canManageTags: false, initialTags: [{ ...original, projectId: "foreign" }] });
    await expect(page.getByText("Managers can edit workspace tags.")).toBeVisible(); await expect(page.getByText("Associated project unavailable", { exact: true })).toBeVisible(); await expect(page.getByText("No billable label", { exact: true })).toBeVisible(); expect(await page.getByRole("button").count()).toBe(0); expect(await page.getByRole("combobox").count()).toBe(0); await page.getByLabel("Search or filter tags").fill("absent"); await expect(page.getByText("No tags match your search.")).toBeVisible(); expect(f.writes).toHaveLength(0); expect(f.errors).toEqual([]);
  });
  test(`CRUD keyboard focus and internally scrolling actions at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); const f = await mount(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("New Tag Name").fill(" NEW "); await page.getByRole("button", { name: "Select color Rose", exact: true }).click(); await expect(page.getByRole("button", { name: "Select color Rose", exact: true })).toHaveAttribute("aria-pressed", "true"); await page.getByLabel("New Tag Name").press("Enter"); await expect(page.getByRole("status")).toContainText("Tag created"); await expect(page.getByLabel("New Tag Name")).toHaveValue(""); await expect(page.getByLabel("New Tag Name")).toBeFocused();
    await page.getByRole("button", { name: "Edit tag new", exact: true }).click(); await expect(page.getByLabel("Edit tag name")).toBeFocused(); await page.getByLabel("Edit tag name").fill(" RENAMED "); await page.getByRole("button", { name: "Use Cyan", exact: true }).click(); await page.getByLabel("Edit tag name").press("Enter"); await expect(page.getByRole("button", { name: "Edit tag renamed", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Edit tag renamed", exact: true }).click(); await page.getByLabel("Edit tag name").press("Escape"); await expect(page.getByRole("button", { name: "Edit tag renamed", exact: true })).toBeFocused();
    await page.getByLabel("Associated project for renamed", { exact: true }).selectOption("project"); await expect(page.getByLabel("Associated project for renamed", { exact: true })).toHaveValue("project"); await page.getByLabel("Associated project for renamed", { exact: true }).selectOption(""); await expect(page.getByLabel("Associated project for renamed", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "No billable label for renamed", exact: true }).click(); await expect(page.getByRole("button", { name: "Billable label for renamed", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Archive tag renamed", exact: true }).click(); await expect(page.getByRole("button", { name: "Restore tag renamed", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Restore tag renamed", exact: true }).click();
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Delete tag renamed", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Tag deleted"); await expect(page.getByRole("button", { name: "Edit tag renamed", exact: true })).toHaveCount(0); await expect(page.getByLabel("Search or filter tags")).toBeFocused(); expect(f.writes.at(-1)?.url).toBe(`${origin}/api/settings/tags?id=new`); expect(f.errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test(`inline save and cancel buttons remain reachable at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); const f = await mount(page);
    await page.getByRole("button", { name: "Edit tag focus", exact: true }).click();
    await page.getByLabel("Edit tag name").fill("discarded draft");
    await page.getByRole("button", { name: "Cancel editing focus", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit tag focus", exact: true })).toBeFocused(); expect(f.writes).toHaveLength(0);
    await page.getByRole("button", { name: "Edit tag focus", exact: true }).click(); await page.getByLabel("Edit tag name").fill("saved draft");
    await page.getByRole("button", { name: "Save changes for focus", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit tag saved draft", exact: true })).toBeFocused(); expect(f.writes).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(f.errors).toEqual([]);
  });
}
for (const mode of ["http", "network", "json", "malformed", "wrong-target", "wrong-workspace", "wrong-name", "wrong-color"]) for (const action of ["create", "edit"]) test(`${action} ${mode} preserves drafts and reports only local uncertainty`, async ({ page }) => {
  const f = await mount(page, mode); if (action === "edit") await page.getByRole("button", { name: "Edit tag focus", exact: true }).click();
  const input = page.getByLabel(action === "create" ? "New Tag Name" : "Edit tag name"); await input.fill(" Draft "); await page.getByRole("button", { name: action === "create" ? "Select color Rose" : "Use Rose", exact: true }).click(); await input.press("Enter"); await expect(page.getByRole("alert")).toHaveText("We couldn't confirm this change. Reload this page to check your tags before trying again."); await expect(input).toHaveValue(" Draft "); await expect(page.getByRole("button", { name: action === "create" ? "Select color Rose" : "Use Rose", exact: true })).toHaveAttribute("aria-pressed", "true"); expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]);
});
test("pending serializes Enter/click all writes while search works and cancel/switch stay frozen", async ({ page }) => {
  const f = await mount(page, "pending"); await page.getByRole("button", { name: "Edit tag focus", exact: true }).click(); await page.getByLabel("Edit tag name").fill("draft"); await page.getByLabel("Edit tag name").evaluate(input => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }); await expect.poll(() => f.writes.length).toBe(1);
  await expect(page.getByRole("status")).toContainText("Saving"); for (const name of ["Save changes for focus", "Cancel editing focus", "Edit tag other", "Archive tag other", "Delete tag other", "Add Tag"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled(); await expect(page.getByLabel("Edit tag name")).toBeDisabled(); await expect(page.getByLabel("New Tag Name")).toBeDisabled(); await page.getByLabel("Search or filter tags").fill("focus"); await expect(page.getByLabel("Search or filter tags")).toBeEnabled(); f.release(); await expect(page.getByRole("button", { name: "Edit tag draft", exact: true })).toHaveCount(0); await page.getByLabel("Search or filter tags").fill(""); await expect(page.getByRole("button", { name: "Edit tag draft", exact: true })).toBeVisible(); expect(f.writes).toHaveLength(1);
});
test("duplicate create submission is one write; existing returned ID is not a new tag", async ({ page }) => { const f = await mount(page, "existing-id"); await page.getByLabel("New Tag Name").fill("new"); await page.locator("form").evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); }); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByLabel("New Tag Name")).toHaveValue("new"); expect(f.writes).toHaveLength(1); });
test("unsubmitted concurrent state is adopted and failed refresh does not undo a confirmed save", async ({ page }) => { const f = await mount(page, "concurrent"); await page.evaluate(() => { (window as unknown as { refreshError: boolean }).refreshError = true; }); await page.getByLabel("Associated project for focus", { exact: true }).selectOption("project"); await expect(page.getByLabel("Associated project for concurrent name", { exact: true })).toHaveValue("project"); await expect(page.getByRole("button", { name: "Restore tag concurrent name", exact: true })).toBeVisible(); await expect(page.getByRole("alert")).toHaveCount(0); await expect(page.getByRole("status")).toContainText("Tag saved"); expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]); });
for (const [mode, name] of [["wrong-project", "project"], ["wrong-boolean", "boolean"], ["wrong-status", "status"]]) test(`mismatched ${name} is not adopted`, async ({ page }) => { await mount(page, mode); if (name === "project") await page.getByLabel("Associated project for focus", { exact: true }).selectOption("project"); else await page.getByRole("button", { name: name === "boolean" ? "No billable label for focus" : "Archive tag focus", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible(); if (name === "project") await expect(page.getByLabel("Associated project for focus", { exact: true })).toHaveValue(""); });
test("DELETE requires ok:true, preserves requested row on malformed success, and cancel sends no request", async ({ page }) => { const f = await mount(page, "delete-bad"); page.once("dialog", d => d.dismiss()); await page.getByRole("button", { name: "Delete tag focus", exact: true }).click(); expect(f.writes).toHaveLength(0); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Delete tag focus", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("button", { name: "Edit tag focus", exact: true })).toBeVisible(); expect(f.writes).toHaveLength(1); });
test("rerender preserves drafts; workspace remount ignores a late response", async ({ page }) => { const f = await mount(page, "pending"); await page.getByLabel("New Tag Name").fill("draft"); await f.rerender({ initialTags: [] }); await expect(page.getByLabel("New Tag Name")).toHaveValue("draft"); await page.getByLabel("New Tag Name").press("Enter"); await expect.poll(() => f.writes.length).toBe(1); await f.rerender({ workspaceId: "new-workspace", initialTags: [] }); await expect(page.getByLabel("New Tag Name")).toHaveValue(""); f.release(); await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))); await expect(page.getByText("Add a tag to label work in your workspace.")).toBeVisible(); await expect(page.getByRole("status")).toHaveCount(0); });
test("role-aware empty guidance and honest helpers", async ({ page }) => { const f = await mount(page, "success", { initialTags: [] }); await expect(page.getByText("Add a tag to label work in your workspace.")).toBeVisible(); await expect(page.getByText("This label doesn't change time entries, rates, or invoices.")).toBeVisible(); await expect(page.getByText("Tags can still be used on other projects.")).toBeVisible(); await f.rerender({ workspaceId: "member-workspace", canManageTags: false }); await expect(page.getByText("Ask a workspace manager to add tags.")).toBeVisible(); });
test("same-workspace capability downgrade hides an open editor without discarding drafts or sending requests", async ({ page }) => {
  const f = await mount(page);
  await page.getByLabel("New Tag Name").fill("unsaved new tag");
  await page.getByRole("button", { name: "Select color Amber", exact: true }).click();
  await page.getByRole("button", { name: "Edit tag focus", exact: true }).click();
  await page.getByLabel("Edit tag name").fill("unsaved edited tag");
  await page.getByRole("button", { name: "Use Rose", exact: true }).click();

  // Deliberately keep workspaceId unchanged: a same-workspace refresh can
  // replace capability props without remounting the component or its drafts.
  await f.rerender({ canManageTags: false });
  await expect(page.getByText("Managers can edit workspace tags.", { exact: true })).toBeVisible();
  await expect(page.getByText("#focus", { exact: true })).toBeVisible();
  await expect(page.getByText("#other", { exact: true })).toBeVisible();
  await expect(page.getByText("No associated project", { exact: true })).toHaveCount(2);
  await expect(page.getByText("No billable label", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Edit tag name")).toHaveCount(0);
  await expect(page.getByLabel("New Tag Name")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await page.getByLabel("Search or filter tags").fill("other");
  await expect(page.getByText("#focus", { exact: true })).toHaveCount(0);
  await expect(page.getByText("#other", { exact: true })).toBeVisible();
  expect(f.writes).toHaveLength(0);

  // Regranting the capability proves this was render gating, not a role key or
  // a reset of either the unrelated creation draft or the hidden edit draft.
  await f.rerender({ canManageTags: true });
  await expect(page.getByLabel("Search or filter tags")).toHaveValue("other");
  await expect(page.getByLabel("New Tag Name")).toHaveValue("unsaved new tag");
  await expect(page.getByRole("button", { name: "Select color Amber", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Search or filter tags").fill("");
  await expect(page.getByLabel("Edit tag name")).toHaveValue("unsaved edited tag");
  await expect(page.getByRole("button", { name: "Use Rose", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(f.writes).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
test("DELETE cannot confirm success from a different final response URL", async ({ page }) => {
  const f = await mount(page);
  // WebKit route.fulfill cannot synthesize 302. Control only the final network
  // Response URL, leaving real fetch parsing and the production component intact.
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      return new Proxy(response, { get(target, property) {
        if (property === "url") return new URL("/api/redirected", location.href).href;
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
    };
  });
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Delete tag focus", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("We couldn't confirm this change. Reload this page to check your tags before trying again.");
  await expect(page.getByRole("button", { name: "Edit tag focus", exact: true })).toBeVisible(); expect(f.writes).toHaveLength(1);
});

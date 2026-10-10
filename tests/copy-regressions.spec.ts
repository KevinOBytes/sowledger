import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(__dirname, "..");
type WorkType = { id: string; name: string; hourlyRate?: number | null };
type WorkTypeWrite = { method: string; body: { actionId?: string; name: string; hourlyRate?: number | null } };

let workTypesScript: string;
let exportsScript: string;

async function bundleClientPage(componentPath: string) {
  // Bundle the real client component in memory, without starting Next or accessing a database.
  // esbuild is already installed as part of the repository's tsx development dependency.
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { createRoot } from "react-dom/client";
import Page from ${JSON.stringify(componentPath)};
createRoot(document.getElementById("root")).render(<Page />);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  return bundle.outputFiles[0].text;
}

test.beforeAll(async () => {
  workTypesScript = await bundleClientPage("./app/(app)/settings/actions/page");
  exportsScript = await bundleClientPage("./app/(app)/exports/page");
});

async function mountWorkTypes(page: Page, initial: WorkType[]) {
  const actions = initial.map((action) => ({ ...action }));
  const writes: WorkTypeWrite[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://copy-regression.test") return route.abort();
    if (url.pathname === "/settings/actions") {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    }
    if (url.pathname !== "/api/user/actions") return route.abort();
    if (request.method() === "GET") return route.fulfill({ json: { ok: true, actions } });

    const body = request.postDataJSON() as WorkTypeWrite["body"];
    writes.push({ method: request.method(), body });
    if (request.method() === "POST") {
      const action = { id: `created-${actions.length}`, name: body.name, hourlyRate: body.hourlyRate ?? null };
      actions.push(action);
      return route.fulfill({ json: { ok: true, action } });
    }
    if (request.method() === "PATCH") {
      const action = actions.find((candidate) => candidate.id === body.actionId);
      if (!action) return route.fulfill({ status: 404, json: { error: "Work type not found" } });
      action.name = body.name;
      // Match the API contract: omission leaves the rate unchanged, null clears it.
      if (body.hourlyRate !== undefined) action.hourlyRate = body.hourlyRate;
      return route.fulfill({ json: { ok: true, action } });
    }
    return route.abort();
  });

  await page.goto("http://copy-regression.test/settings/actions");
  await page.addScriptTag({ content: workTypesScript });
  await expect(page.getByRole("heading", { name: "Work types and rates" })).toBeVisible();
  await expect(page.getByText("Loading work types...", { exact: true })).toBeHidden();
  return { writes, pageErrors };
}

test("work types load and edit null rates without crashing, while keeping zero rates", async ({ page }) => {
  const { pageErrors } = await mountWorkTypes(page, [
    { id: "no-rate", name: "Research", hourlyRate: null },
    { id: "zero-rate", name: "Complimentary review", hourlyRate: 0 },
  ]);
  await expect(page.getByText("Research", { exact: true })).toBeVisible();
  await expect(page.getByText("No rate", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.00/hr", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Research", exact: true }).click();
  await expect(page.getByLabel("Hourly rate", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Work type name", { exact: true })).toHaveValue("Research");
  expect(pageErrors).toEqual([]);
});

test("creating a work type without a rate renders the API's null rate", async ({ page }) => {
  const { writes, pageErrors } = await mountWorkTypes(page, []);
  await page.getByLabel("New work type", { exact: true }).fill("Research");
  await page.getByRole("button", { name: "Add work type", exact: true }).click();
  await expect(page.getByText("Research", { exact: true })).toBeVisible();
  await expect(page.getByText("No rate", { exact: true })).toBeVisible();
  expect(writes).toEqual([{ method: "POST", body: { name: "Research" } }]);
  expect(pageErrors).toEqual([]);
});

test("clearing an existing hourly rate sends null and renders No rate", async ({ page }) => {
  const { writes, pageErrors } = await mountWorkTypes(page, [{ id: "rated", name: "Consulting", hourlyRate: 150 }]);
  await expect(page.getByText("$150.00/hr", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Consulting", exact: true }).click();
  await page.getByLabel("Hourly rate", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save work type", exact: true }).click();
  await expect(page.getByText("No rate", { exact: true })).toBeVisible();
  await expect(page.getByText("$150.00/hr", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([{ method: "PATCH", body: { actionId: "rated", name: "Consulting", hourlyRate: null } }]);
  expect(pageErrors).toEqual([]);
});

test("CSV ignores JSON datasets even when every dataset is unchecked", async ({ page }) => {
  const exportQueries: URLSearchParams[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://copy-regression.test") return route.abort();
    if (url.pathname === "/exports") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/people") return route.fulfill({ json: { people: [] } });
    if (url.pathname === "/api/export/csv") {
      exportQueries.push(url.searchParams);
      return route.fulfill({ contentType: "text/csv", body: "task,hours\nResearch,1\n" });
    }
    return route.abort();
  });
  await page.goto("http://copy-regression.test/exports");
  await page.addScriptTag({ content: exportsScript });
  await expect(page.getByRole("heading", { name: "Exports", exact: true })).toBeVisible();
  await expect(page.getByText("Loading export filters...", { exact: true })).toBeHidden();

  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.uncheck();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download JSON", exact: true }).first()).toBeDisabled();
  const headerCsv = page.getByRole("button", { name: "Download CSV", exact: true }).first();
  await expect(headerCsv).toBeEnabled();
  const headerDownload = page.waitForEvent("download");
  await headerCsv.click();
  expect((await headerDownload).suggestedFilename()).toMatch(/\.csv$/);

  await expect(page.getByRole("combobox", { name: /^Format/ })).toHaveValue("csv");
  const selectedFormatCsv = page.getByRole("button", { name: "Download CSV", exact: true }).last();
  await expect(selectedFormatCsv).toBeEnabled();
  const selectedFormatDownload = page.waitForEvent("download");
  await selectedFormatCsv.click();
  expect((await selectedFormatDownload).suggestedFilename()).toMatch(/\.csv$/);
  expect(exportQueries).toHaveLength(2);
  for (const query of exportQueries) {
    expect(query.get("format")).toBe("csv");
    expect(query.has("include")).toBe(false);
  }
  expect(pageErrors).toEqual([]);
});

test("planned-work review suggestions point to the calendar", async () => {
  const block = {
    id: "past-plan", workspaceId: "review-workspace", userId: "review-person", projectId: null,
    title: "Research", status: "planned", startsAt: "2000-01-01T10:00:00.000Z", endsAt: "2000-01-01T11:00:00.000Z",
  };
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["lib/revenue-intelligence.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [{
      name: "database-free-review-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/db(?:\/ensure-workspace-schema)?$/ }, (args) => ({ path: args.path, namespace: "review-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "review-fixture" }, (args) => ({
          contents: args.path.endsWith("ensure-workspace-schema")
            ? "export async function ensureWorkspaceSchema() {}"
            : `const results = ${JSON.stringify([[], [], [], [block]])};
export const db = { select() { return { from() { return { async where() { if (!results.length) throw new Error("Unexpected database read"); return results.shift(); } }; } }; } };`,
          loader: "js",
        }));
      },
    }],
  });
  const fixtureModule = { exports: {} as { buildRevenueIntelligence: (workspaceId: string, options: { scope: string; userId: string }) => Promise<{ recoveryOpportunities: Array<{ type: string; title: string; url?: string }> }> } };
  const runModule = new Function("require", "module", "exports", bundle.outputFiles[0].text);
  runModule(createRequire(path.join(root, "package.json")), fixtureModule, fixtureModule.exports);
  const result = await fixtureModule.exports.buildRevenueIntelligence("review-workspace", { scope: "mine", userId: "review-person" });
  expect(result.recoveryOpportunities).toEqual([expect.objectContaining({ type: "missed_scheduled_work", title: "Check planned work: Research", url: "/calendar" })]);
});

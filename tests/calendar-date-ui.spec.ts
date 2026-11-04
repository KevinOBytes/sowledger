import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test.use({ timezoneId: "America/New_York" });
const root = path.resolve(__dirname, "..");
const scripts: Record<string, string> = {};
let css: string;
const pageErrors = new WeakMap<Page, string[]>();
const report = (hours: number) => ({ ok: true, scope: "mine", totalHours: hours, totalBillableAmount: 0, plannedHours: 0, manualHours: hours, timerHours: 0, calendarHours: 0, utilization: null, missedBlocks: 0, dailyTrend: [], projectDistribution: [], userDistribution: [] });

test.beforeAll(async () => {
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  for (const [name, component, imported] of [
    ["reports", "./components/reports-page-client", "{ ReportsPageClient as Component }"],
    ["exports", "./app/(app)/exports/page", "Component"],
    ["planner", "./components/resource-planner", "{ ResourcePlanner as Component }"],
    ["activity", "./app/(app)/activity/page", "Component"],
    ["developers", "./app/(app)/settings/developers/page", "Component"],
  ]) {
    const result = await build({ absWorkingDir: root, stdin: { contents: `import {createRoot} from 'react-dom/client'; import ${imported} from ${JSON.stringify(component)}; createRoot(document.getElementById('root')).render(<Component/>);`, loader: "tsx", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } });
    scripts[name] = result.outputFiles[0].text;
  }
});

async function mount(page: Page, name: string, respond: (route: Route, url: URL) => Promise<unknown>) {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-31T03:30:00.000Z"));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://calendar-date.test") return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    return respond(route, url);
  });
  await page.goto("http://calendar-date.test/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: scripts[name] });
}

test.afterEach(async ({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

test("Analytics date fields have visible start and end labels", async ({ page }) => {
  await mount(page, "reports", async (route, url) => route.fulfill({ json: url.pathname === "/api/reports" ? report(3) : { ok: true } }));
  for (const name of ["Start date", "End date"]) {
    const input = page.getByLabel(name, { exact: true });
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute("type", "date");
    await expect(page.locator("label").filter({ has: input })).toHaveText(name);
    await expect(page.locator("label").filter({ has: input })).toBeVisible();
  }
});

async function reachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const bounds = (await control.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [320, 390]) {
  test(`styled Analytics range and export are usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const queries: URL[] = [];
    await mount(page, "reports", async (route, url) => {
      queries.push(url);
      if (url.pathname === "/api/export/csv") return route.fulfill({ contentType: "text/csv; charset=utf-8", body: "hours\n3\n", headers: { "content-disposition": "attachment; filename=analytics.csv", "x-sowledger-export-sha256": "a".repeat(64) } });
      return route.fulfill({ json: url.pathname === "/api/reports" ? { ...report(3), scope: url.searchParams.get("scope") ?? "mine" } : { ok: true } });
    });
    await page.getByRole("button", { name: "Team analytics", exact: true }).click();
    // A local fall-back day is 25 hours; no UTC-date slicing is acceptable.
    await page.getByLabel("End date", { exact: true }).fill("2026-11-01");
    for (const label of ["Start date", "End date"]) {
      const input = page.getByLabel(label, { exact: true });
      await reachable(page, input);
      await expect(page.locator("label").filter({ has: input })).toContainText(label);
      await input.fill("2026-11-01");
    }
    await expect.poll(() => queries.filter(url => url.pathname === "/api/reports").at(-1)?.searchParams.get("start")).toBe("2026-11-01T04:00:00.000Z");
    expect(queries.filter(url => url.pathname === "/api/reports").at(-1)?.searchParams.get("end")).toBe("2026-11-02T05:00:00.000Z");
    const action = page.getByRole("button", { name: "Export CSV", exact: true });
    await reachable(page, action);
    // Analytics navigates to the attachment endpoint. Assert that production
    // boundary here; the Exports cases below exercise actual download events.
    // Intercepted WebKit attachment navigations do not emit a download event.
    await action.click();
    await expect.poll(() => queries.filter(url => url.pathname === "/api/export/csv").length).toBe(1);
    const exported = queries.filter(url => url.pathname === "/api/export/csv");
    expect(exported).toHaveLength(1);
    expect(Object.fromEntries(exported[0].searchParams)).toEqual({ format: "csv", scope: "team", include: "projects,timeEntries,users,schedule", start: "2026-11-01T04:00:00.000Z", end: "2026-11-02T05:00:00.000Z" });
  });

  test(`styled Activity date ranges and clear action are usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const queries: URLSearchParams[] = [];
    await mount(page, "activity", async (route, url) => {
      if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
      if (url.pathname === "/api/timer/list") { queries.push(url.searchParams); return route.fulfill({ json: { entries: [], total: 0, hasMore: false } }); }
      return route.abort();
    });
    for (const label of ["From date", "To date"]) {
      const input = page.getByLabel(label, { exact: true });
      await reachable(page, input); await input.fill("2026-11-01");
    }
    await expect.poll(() => queries.at(-1)?.get("to")).toBe("2026-11-02T04:59:59.999Z");
    expect(queries.at(-1)?.get("from")).toBe("2026-11-01T04:00:00.000Z");
    const clear = page.getByRole("button", { name: "Clear filters", exact: true });
    await reachable(page, clear); await clear.click();
    await expect.poll(() => queries.at(-1)?.has("from")).toBe(false);
    expect(queries.at(-1)?.has("to")).toBe(false);
    await reachable(page, page.getByRole("button", { name: "Log completed work", exact: true }).first());
  });

  test(`styled Exports date ranges and download are usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const queries: URLSearchParams[] = [];
    await mount(page, "exports", async (route, url) => {
      if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
      if (url.pathname === "/api/people") return route.fulfill({ json: { people: [] } });
      if (url.pathname === "/api/export/csv") { queries.push(url.searchParams); return route.fulfill({ contentType: "text/csv", body: "hours\n1\n", headers: { "x-sowledger-export-sha256": "a".repeat(64) } }); }
      return route.abort();
    });
    await page.getByLabel("End", { exact: true }).fill("2026-11-01");
    for (const label of ["Start", "End"]) {
      const input = page.getByLabel(label, { exact: true }); await reachable(page, input); await input.fill("2026-11-01");
    }
    const download = page.waitForEvent("download");
    const action = page.getByRole("button", { name: "Download CSV", exact: true }).first();
    await reachable(page, action); await action.click(); await download;
    expect(queries).toHaveLength(1);
    expect(queries[0].get("start")).toBe("2026-11-01T04:00:00.000Z");
    expect(queries[0].get("end")).toBe("2026-11-02T05:00:00.000Z");
  });

  test(`styled API-key expiry and deliberate blank are usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const writes: Array<{ expiresAt: string | null }> = [];
    await mount(page, "developers", async (route, url) => {
      if (url.pathname !== "/api/settings/api-keys") return route.abort();
      if (route.request().method() === "GET") return route.fulfill({ json: { keys: [], usage: [] } });
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { rawKey: "synthetic-fixture-key-not-valid" } });
    });
    const expiry = page.getByLabel("Expires", { exact: true });
    const action = page.getByRole("button", { name: "Create API key", exact: true });
    for (const value of ["2026-11-01", ""]) {
      await reachable(page, expiry); await expiry.fill(value);
      await reachable(page, action); await action.click();
      await expect.poll(() => writes.length).toBe(value ? 1 : 2);
    }
    expect(writes.map(write => write.expiresAt)).toEqual(["2026-11-02T04:59:59.999Z", null]);
  });

  test(`styled populated ResourcePlanner date labels and work links fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mount(page, "planner", async route => route.fulfill({ json: {
      people: [{ id: "active", status: "active", displayName: "Active person", invitationStatus: "accepted" }], organizations: [],
      tasks: [{ id: "dated-task", projectId: "project", assigneeId: null, title: "Dated delivery task", status: "todo", estimatedHours: 3, dueDate: "2026-10-30T00:00:00.000Z" }],
      goals: [{ id: "dated-goal", name: "Dated delivery goal", assignedUserId: "active", targetType: "hours", targetHours: 2, recurrence: "none", dueDate: "2026-10-30T00:00:00.000Z" }],
    } }));
    const dates = page.getByText("Due: Oct 30, 2026", { exact: true });
    await expect(dates).toHaveCount(2);
    for (const date of await dates.all()) await reachable(page, date);
    const work = page.getByRole("link", { name: /Dated delivery task/ });
    await reachable(page, work); await expect(work).toHaveAttribute("href", "/projects/project");
    await reachable(page, page.getByRole("link", { name: /Add people or invite members/ }));
  });
}

test("Analytics starts on local dates and old responses cannot overwrite a newer range", async ({ page }) => {
  const held: Route[] = [];
  const queries: URLSearchParams[] = [];
  await mount(page, "reports", async (route, url) => {
    if (!url.pathname.startsWith("/api/")) return route.abort();
    queries.push(url.searchParams);
    const current = url.searchParams.get("start")?.startsWith("2026-10-20");
    if (!current) { held.push(route); return; }
    return route.fulfill({ json: url.pathname === "/api/reports" ? report(111) : { ok: true, recoveryOpportunities: [{ title: "Current review item" }] } });
  });
  await expect(page.getByTitle("Start Date")).toHaveValue("2026-09-30");
  await expect(page.getByTitle("End Date")).toHaveValue("2026-10-30");
  await expect.poll(() => held.length).toBe(2);
  await page.getByTitle("Start Date").fill("2026-10-20");
  await expect(page.getByText("111h", { exact: true }).first()).toBeVisible();
  for (const route of held) await route.fulfill({ json: new URL(route.request().url()).pathname === "/api/reports" ? report(22) : { ok: true, recoveryOpportunities: [{ title: "Stale review item" }] } });
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("111h", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("22h", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stale review item", { exact: true })).toHaveCount(0);
  expect(queries.at(-1)?.get("start")).toBe("2026-10-20T04:00:00.000Z");
  expect(queries.at(-1)?.get("end")).toBe("2026-10-31T04:00:00.000Z");
});

test("temporary team errors preserve the selected scope and invalid ranges do not issue requests", async ({ page }) => {
  let calls = 0;
  let failTeam = true;
  await mount(page, "reports", async (route, url) => {
    calls++;
    if (url.searchParams.get("scope") === "team" && failTeam) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    return route.fulfill({ json: url.pathname === "/api/reports" ? report(3) : { ok: true } });
  });
  await expect(page.getByText("3.0h", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Team analytics", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry analytics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Team analytics", exact: true })).toHaveAttribute("aria-pressed", "true");
  failTeam = false;
  await page.getByRole("button", { name: "Retry analytics" }).click();
  await expect(page.getByText("3.0h", { exact: true }).first()).toBeVisible();
  const before = calls;
  await page.getByTitle("Start Date").fill("2026-11-02");
  await expect(page.getByRole("alert").filter({ hasText: "Choose an end date on or after the start date." })).toBeVisible();
  expect(calls).toBe(before);
  await expect(page.getByRole("button", { name: "Export CSV", exact: true })).toBeDisabled();
});

for (const [day, start, end] of [["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"], ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]]) {
  test(`Exports uses the complete local ${day} day across a clock change`, async ({ page }) => {
    const queries: URLSearchParams[] = [];
    await mount(page, "exports", async (route, url) => {
      if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
      if (url.pathname === "/api/people") return route.fulfill({ json: { people: [] } });
      if (url.pathname === "/api/export/csv") { queries.push(url.searchParams); return route.fulfill({ contentType: "text/csv", body: "hours\n1\n", headers: { "x-sowledger-export-sha256": "a".repeat(64) } }); }
      return route.abort();
    });
    await page.getByLabel("Start", { exact: true }).fill(day);
    await page.getByLabel("End", { exact: true }).fill(day);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).first().click();
    await download;
    expect(queries).toHaveLength(1);
    expect(queries[0].get("start")).toBe(start);
    expect(queries[0].get("end")).toBe(end);
    await page.getByLabel("Start", { exact: true }).fill("2026-12-20");
    await expect(page.getByRole("button", { name: "Download CSV", exact: true }).first()).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "Choose an end date on or after the start date." })).toBeVisible();
  });
}

test("Planner keeps calendar dates, unassigned goals and archived-owner work visible", async ({ page }) => {
  await mount(page, "planner", async route => route.fulfill({ json: {
    people: [{ id: "active", status: "active", displayName: "Active person", invitationStatus: "accepted" }, { id: "archived", status: "archived", displayName: "Former person", invitationStatus: "accepted" }], organizations: [],
    tasks: [{ id: "former", projectId: "project", assigneeId: "archived", title: "Work needing reassignment", status: "todo", estimatedHours: 3, dueDate: "2026-10-30T00:00:00.000Z" }, ...Array.from({ length: 11 }, (_, i) => ({ id: `task-${i}`, projectId: "project", assigneeId: null, title: `Backlog task ${i + 1}`, status: "todo", estimatedHours: 0 }))],
    goals: [{ id: "assigned-goal", name: "Dated goal", assignedUserId: "active", targetType: "hours", targetHours: 2, recurrence: "none", dueDate: "2026-10-30T00:00:00.000Z" }, { id: "unassigned-goal", name: "Unassigned goal", assignedUserId: null, targetType: "hours", targetHours: 5, recurrence: "none", dueDate: null }],
  } }));
  await expect(page.getByText("Work needing reassignment", { exact: true })).toBeVisible();
  await expect(page.getByText("Due: Oct 30, 2026", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("10 hrs", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Work needing reassignment/ })).toHaveAttribute("href", "/projects/project");
  await page.getByRole("button", { name: /Show all .* tasks/ }).click();
  await expect(page.getByText("Backlog task 11", { exact: true })).toBeVisible();
});

test("Activity date controls keep the full local day, reject reversed dates and clear filters", async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await mount(page, "activity", async (route, url) => {
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/timer/list") { queries.push(url.searchParams); return route.fulfill({ json: { entries: [], total: 0, hasMore: false } }); }
    return route.abort();
  });
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  await page.getByLabel("From date", { exact: true }).fill("2026-11-01");
  await page.getByLabel("To date", { exact: true }).fill("2026-11-01");
  await expect.poll(() => queries.at(-1)?.get("to")).toBe("2026-11-02T04:59:59.999Z");
  expect(queries.at(-1)?.get("from")).toBe("2026-11-01T04:00:00.000Z");
  const count = queries.length;
  await page.getByLabel("From date", { exact: true }).fill("2026-11-03");
  await expect(page.getByText("The end date must be on or after the start date.", { exact: true })).toBeVisible();
  expect(queries).toHaveLength(count);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(count);
  expect(queries.at(-1)?.has("from")).toBe(false);
  expect(queries.at(-1)?.has("to")).toBe(false);
});

test("API key expiry uses the chosen local day's end and supports a deliberate blank date", async ({ page }) => {
  const writes: Array<{ expiresAt: string | null }> = [];
  await mount(page, "developers", async (route, url) => {
    if (url.pathname !== "/api/settings/api-keys") return route.abort();
    if (route.request().method() === "GET") return route.fulfill({ json: { keys: [], usage: [] } });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { rawKey: "synthetic-fixture-key-not-valid" } });
  });
  await page.getByLabel("Expires", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "Create API key", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].expiresAt).toBe("2026-11-02T04:59:59.999Z");
  await page.getByLabel("Expires", { exact: true }).fill("");
  await page.getByRole("button", { name: "Create API key", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].expiresAt).toBeNull();
});

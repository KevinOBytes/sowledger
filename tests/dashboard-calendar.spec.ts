import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test.use({ timezoneId: "America/New_York" });
const root = path.resolve(__dirname, "..");
let script: string;
let css: string;
const errors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  script = (await build({ absWorkingDir: root, stdin: { contents: 'import {createRoot} from "react-dom/client"; import {Toaster} from "sonner"; import {TimerDashboard} from "./components/timer-dashboard"; createRoot(document.getElementById("root")).render(<><TimerDashboard/><Toaster/></>);', loader: "tsx", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

async function mount(page: Page, rows: Record<string, unknown>[]) {
  const writes: Record<string, unknown>[] = [];
  const pageErrors: string[] = [];
  errors.set(page, pageErrors);
  page.on("pageerror", error => pageErrors.push(error.message));
  const blocks = rows.map(row => ({ projectId: null, taskId: null, actionId: null, notes: null, tags: [], status: "planned", startsAt: "2026-11-03T14:00:00.000Z", endsAt: "2026-11-03T15:00:00.000Z", ...row }));
  await page.clock.install({ time: new Date("2026-10-30T16:00:00.000Z") });
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://dashboard-calendar.test") return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/schedule") {
      if (request.method() === "GET") return route.fulfill({ json: { blocks } });
      const body = request.postDataJSON();
      writes.push(body);
      return route.fulfill({ json: { ok: true, block: { ...body, id: body.blockId ?? "created" } } });
    }
    if (url.pathname === "/api/timer/active") return route.fulfill({ json: { activeEntries: [] } });
    if (url.pathname === "/api/onboarding") return route.fulfill({ json: { onboarding: { completedSteps: [], skippedAt: null, completedAt: null } } });
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/user/actions") return route.fulfill({ json: { actions: [] } });
    return route.abort();
  });
  await page.goto("http://dashboard-calendar.test/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await expect(page.getByText("Loading scheduled work...", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Up next", exact: true })).toBeVisible();
  return writes;
}

test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

test("future and overnight work include their dates and the move label matches its action", async ({ page }) => {
  const writes = await mount(page, [{ id: "future", title: "Future client work" }, { id: "overnight", title: "Overnight client work", startsAt: "2026-11-04T04:00:00Z", endsAt: "2026-11-04T06:00:00Z" }]);
  const future = page.locator("article").filter({ has: page.getByText("Future client work", { exact: true }) });
  await expect(future).toContainText("Nov 3");
  const overnight = page.locator("article").filter({ has: page.getByText("Overnight client work", { exact: true }) });
  await expect(overnight).toContainText("Nov 3");
  await expect(overnight).toContainText("Nov 4");
  await future.getByRole("button", { name: "One day later", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ blockId: "future", startsAt: "2026-11-04T14:00:00.000Z", endsAt: "2026-11-04T15:00:00.000Z" });
});

test("stale planned status cannot offer actions for either time link or an imported event", async ({ page }) => {
  await mount(page, [{ id: "forward", title: "Forward linked", linkedTimeEntryId: "entry" }, { id: "reverse", title: "Reverse linked", hasRecordedTime: true }, { id: "external", title: "Imported with edited tags", isImported: true }]);
  for (const name of ["Forward linked", "Reverse linked", "Imported with edited tags"]) {
    const card = page.locator("article").filter({ has: page.getByText(name, { exact: true }) });
    await expect(card.getByRole("button")).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "Review recorded time", exact: true })).toHaveCount(2);
});

for (const width of [320, 390]) test(`dashboard planning explains local time and rejects a skipped clock time at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const writes = await mount(page, []);
  await page.getByRole("button", { name: "Schedule work", exact: true }).first().click();
  await page.getByLabel("Start", { exact: true }).fill("2026-03-08T02:30");
  await page.getByLabel("End", { exact: true }).fill("2026-03-08T04:00");
  await expect(page.locator("#dashboard-schedule-form")).toContainText("America/New_York");
  await page.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(page.getByText(/That local time does not exist/)).toBeVisible();
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

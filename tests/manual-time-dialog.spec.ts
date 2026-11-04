import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
const origin = "http://manual-time-dialog.test";
let script: string;
let css: string;
let screenshots: string;
const originalStart = "2026-11-01T06:30:45.123Z"; // Second 01:30, after the fall clock change.
const originalEnd = "2026-11-01T07:30:55.987Z";

// The main app config also discovers this standalone fixture.
test.use({ timezoneId: "America/New_York" });

test.beforeAll(async () => {
  screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-manual-time-screenshots-"));
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ManualTimeDialog } from "./components/manual-time-dialog";
function Fixture() {
  const [open, setOpen] = useState(false);
  const [, refreshFixture] = useState(0);
  useEffect(() => { const refresh = () => refreshFixture(value => value + 1); window.addEventListener("fixture:refresh", refresh); return () => window.removeEventListener("fixture:refresh", refresh); }, []);
  const settings = window.fixtureSettings;
  const common = { id: "entry-or-block", taskId: "Client review", projectId: "project", tags: ["review"] };
  const saved = settings.mode === "edit" ? { ...common, action: "Complimentary review", description: "Saved notes", startedAt: ${JSON.stringify(originalStart)}, stoppedAt: ${JSON.stringify(originalEnd)}, durationSeconds: 3010, ...settings.entry } : undefined;
  const scheduled = settings.mode === "scheduled" ? { ...common, title: "Scheduled review", actionId: "zero-rate", notes: "Scheduled notes", startsAt: ${JSON.stringify(originalStart)}, endsAt: ${JSON.stringify(originalEnd)} } : undefined;
  return <><main className="min-h-[1600px] bg-slate-50 p-5"><button onClick={() => setOpen(true)}>Open time entry</button><button>Background action</button><ManualTimeDialog open={open} onOpenChange={setOpen} editEntry={saved} scheduledBlock={scheduled} onSaved={async () => { window.savedCallbacks = (window.savedCallbacks || 0) + 1; if (settings.failRefresh) throw new Error("Refresh unavailable"); }} /></main><Toaster richColors duration={60000} /></>;
}
createRoot(document.getElementById("root")).render(<StrictMode><Fixture /></StrictMode>);`,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  script = bundle.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

type Options = { mode?: "new" | "edit" | "scheduled"; failWrite?: boolean; holdWrite?: boolean; failChoices?: boolean; failRefresh?: boolean; failNetwork?: boolean; malformedWrite?: boolean; ambiguousWriteStatus?: number; entry?: Record<string, unknown> };
async function mount(page: Page, options: Options = {}) {
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const errors: string[] = [];
  let pending: Route | undefined;
  let failChoices = Boolean(options.failChoices);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="overflow:auto"><div id="root"></div></body></html>' });
    if (url.pathname === "/api/projects" || url.pathname === "/api/user/actions") {
      if (failChoices) return route.fulfill({ status: 503, json: { error: "Choices unavailable" } });
      return route.fulfill({ json: url.pathname === "/api/projects" ? { projects: [{ id: "project", name: "Client project" }] } : { actions: [{ id: "zero-rate", name: "Complimentary review", hourlyRate: 0 }, { id: "unset-rate", name: "Unpriced work", hourlyRate: null }] } });
    }
    if (["/api/timer/manual", "/api/timer/edit"].includes(url.pathname)) {
      writes.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
      if (options.failNetwork) return route.abort("failed");
      if (options.malformedWrite) return route.fulfill({ json: {} });
      if (options.ambiguousWriteStatus) return route.fulfill({ status: options.ambiguousWriteStatus, json: { error: "The server could not complete the response." } });
      if (options.holdWrite && writes.length === 1) { pending = route; return; }
      if (options.failWrite && writes.length === 1) return route.fulfill({ status: 422, json: { error: "Your time could not be saved. The selected project is temporarily unavailable; review your selection and try again." } });
      return route.fulfill({ json: { ok: true, entry: { id: "created-entry" } } });
    }
    return route.abort();
  });
  await page.goto(`${origin}/fixture`);
  await page.evaluate(settings => { (window as unknown as { fixtureSettings: Options }).fixtureSettings = settings; }, options);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  const opener = page.getByRole("button", { name: "Open time entry", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: options.mode === "edit" ? "Edit completed work" : "Add completed work", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, opener, writes, errors, restoreChoices() { failChoices = false; }, async releaseWrite() { await pending!.fulfill({ json: { ok: true, entry: { id: "created-entry" } } }); } };
}

async function insideViewport(page: Page, locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(16);
  expect(bounds!.y).toBeGreaterThanOrEqual(16);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 16);
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`manual dialog is modal, focused and usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { dialog, opener, errors } = await mount(page);
    await expect(dialog.getByLabel("Work label", { exact: true })).toBeFocused();
    await insideViewport(page, dialog);
    await insideViewport(page, dialog.getByRole("button", { name: "Log time", exact: true }));
    await insideViewport(page, dialog.getByRole("button", { name: "Close manual time dialog" }));
    await page.getByRole("button", { name: "Background action" }).evaluate(element => element.focus());
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await dialog.getByRole("button", { name: "Log time", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, `manual-${viewport.width}.png`) });
    await dialog.getByLabel("Tags", { exact: true }).fill("review");
    await expect(dialog.getByLabel("Tags", { exact: true })).toHaveValue("review");
    expect(await dialog.locator("fieldset").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "auto");
    expect(errors).toEqual([]);
  });
}

test("scheduled logging preserves exact second-fold timestamps and explicitly cleared zero rate", async ({ page }) => {
  const { dialog, writes, errors } = await mount(page, { mode: "scheduled" });
  await expect(dialog.getByLabel(/^Work type \/ rate/).locator('option[value="zero-rate"]')).toHaveText("Complimentary review ($0/hr)");
  await expect(dialog).toContainText("America/New_York");
  await expect(dialog).toContainText("first occurrence");
  await dialog.getByLabel(/^Work type \/ rate/).selectOption("");
  await dialog.getByRole("button", { name: "Log time", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ startedAt: originalStart, stoppedAt: originalEnd, scheduledBlockId: "entry-or-block", actionId: "" });
  expect(errors).toEqual([]);
});

test("notes-only corrections preserve precision, second-fold offset and paused net duration", async ({ page }) => {
  const { dialog, writes } = await mount(page, { mode: "edit" });
  await expect(dialog.getByText("0h 50m", { exact: true })).toBeVisible();
  await dialog.getByLabel("Notes", { exact: true }).fill("Corrected description");
  await dialog.getByLabel(/^Project/).selectOption("");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ path: "/api/timer/edit", method: "PATCH", body: { entryId: "entry-or-block", description: "Corrected description", projectId: null } });
  for (const key of ["startedAt", "stoppedAt", "durationSeconds", "actionId"]) expect(writes[0].body).not.toHaveProperty(key);
});

test("parent refreshes do not replace an in-progress correction with old details", async ({ page }) => {
  const { dialog, writes } = await mount(page, { mode: "edit" });
  await dialog.getByLabel("Work label", { exact: true }).fill("Client handoff");
  await dialog.getByLabel("Notes", { exact: true }).fill("Corrected description");
  await page.evaluate(() => window.dispatchEvent(new Event("fixture:refresh")));
  await expect(dialog.getByLabel("Work label", { exact: true })).toHaveValue("Client handoff");
  await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Corrected description");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ taskId: "Client handoff", description: "Corrected description" });
});

test("spring-gap inputs are rejected instead of being silently shifted", async ({ page }) => {
  const { dialog, writes } = await mount(page);
  await dialog.getByLabel("Start date", { exact: true }).fill("2026-03-08");
  await dialog.getByLabel("Start time", { exact: true }).fill("02:30");
  await dialog.getByLabel("End date", { exact: true }).fill("2026-03-08");
  await dialog.getByLabel("End time", { exact: true }).fill("04:30");
  await dialog.getByRole("button", { name: "Log time", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/does not exist|clock change|daylight/i);
  expect(writes).toHaveLength(0);
  await expect(dialog.getByLabel("Start time", { exact: true })).toHaveValue("02:30");
});

test("new repeated-hour inputs use the disclosed first occurrence", async ({ page }) => {
  const { dialog, writes } = await mount(page);
  await dialog.getByLabel("Start date", { exact: true }).fill("2026-11-01");
  await dialog.getByLabel("Start time", { exact: true }).fill("01:30");
  await dialog.getByLabel("End date", { exact: true }).fill("2026-11-01");
  await dialog.getByLabel("End time", { exact: true }).fill("02:30");
  await expect(dialog.getByText("2h 0m", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Log time", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ startedAt: "2026-11-01T05:30:00.000Z", stoppedAt: "2026-11-01T07:30:00.000Z" });
});

for (const entry of [
  { startedAt: "2026-10-30T16:00:00.123Z", stoppedAt: "2026-10-30T16:00:00.123Z", durationSeconds: 0 },
  { startedAt: "2026-10-30T16:00:00.123Z", stoppedAt: "2026-10-30T16:00:22.987Z", durationSeconds: 22 },
]) {
  test(`a ${entry.durationSeconds}-second entry allows notes-only correction without changing time`, async ({ page }) => {
    const { dialog, writes } = await mount(page, { mode: "edit", entry });
    await expect(dialog.getByText("0h 0m", { exact: true })).toBeVisible();
    await dialog.getByLabel("Notes", { exact: true }).fill("Corrected short entry");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect.poll(() => writes.length).toBe(1);
    for (const key of ["startedAt", "stoppedAt", "durationSeconds"]) expect(writes[0].body).not.toHaveProperty(key);
  });
}

test("editing one endpoint preserves the other endpoint's exact timestamp and recorded pause", async ({ page }) => {
  const { dialog, writes } = await mount(page, { mode: "edit" });
  await dialog.getByLabel("End time", { exact: true }).fill("03:00");
  await expect(dialog.getByText("1h 19m", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.stoppedAt).toBe("2026-11-01T08:00:00.000Z");
  expect(writes[0].body).not.toHaveProperty("startedAt");
  expect(writes[0].body).not.toHaveProperty("durationSeconds");
});

test("failure keeps the draft and pinned actions available on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { dialog, writes } = await mount(page, { failWrite: true });
  await dialog.getByLabel("Work label", { exact: true }).fill("Client handoff");
  await dialog.getByLabel("Notes", { exact: true }).fill("Keep these completed-work details");
  await dialog.getByRole("button", { name: "Log time", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your time could not be saved");
  await expect(dialog.getByLabel("Work label", { exact: true })).toHaveValue("Client handoff");
  await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Keep these completed-work details");
  await insideViewport(page, dialog.getByRole("alert"));
  await insideViewport(page, dialog.getByRole("button", { name: "Log time", exact: true }));
  await page.screenshot({ path: path.join(screenshots, "manual-error-320.png") });
  await dialog.getByRole("button", { name: "Log time", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
});

test("in-flight saves submit once and cannot dismiss the dialog before confirmation", async ({ page }) => {
  const { dialog, writes, releaseWrite } = await mount(page, { holdWrite: true });
  await dialog.getByRole("button", { name: "Log time", exact: true }).evaluate(button => { (button as HTMLElement).click(); (button as HTMLElement).click(); });
  await expect.poll(() => writes.length).toBe(1);
  await expect(dialog.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Notes", { exact: true })).toBeDisabled();
  await releaseWrite();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

test("choices can be retried without discarding work, and Enter submits the form", async ({ page }) => {
  const { dialog, writes, restoreChoices } = await mount(page, { failChoices: true });
  await expect(dialog.getByRole("alert")).toContainText("Could not load projects and work types");
  await dialog.getByLabel("Work label", { exact: true }).fill("Keyboard submission");
  await dialog.getByLabel("Notes", { exact: true }).fill("Keep this while retrying choices");
  restoreChoices();
  await dialog.getByRole("button", { name: "Retry choices", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Keep this while retrying choices");
  await dialog.getByLabel("Work label", { exact: true }).press("Enter");
  await expect.poll(() => writes.length).toBe(1);
  await expect(dialog).toHaveCount(0);
});

test("a failed refresh after a confirmed save does not falsely report logging failure", async ({ page }) => {
  const { dialog, writes } = await mount(page, { failRefresh: true });
  await dialog.getByRole("button", { name: "Log time", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast][data-type="warning"]')).toContainText(/saved|logged/i);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

for (const options of [{ failNetwork: true }, { malformedWrite: true }, { ambiguousWriteStatus: 503 }, { ambiguousWriteStatus: 408 }]) {
  test(`an unconfirmed ${"failNetwork" in options ? "network" : "ambiguousWriteStatus" in options ? options.ambiguousWriteStatus : "response"} result keeps the draft and warns before retry`, async ({ page }) => {
    const { dialog, writes } = await mount(page, options);
    await dialog.getByLabel("Notes", { exact: true }).fill("Keep this until the save is confirmed");
    await dialog.getByRole("button", { name: "Log time", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Check Activity before retrying");
    await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Keep this until the save is confirmed");
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    expect(writes).toHaveLength(1);
  });
}

test("canceling and reopening starts a new draft and returns focus to the opener", async ({ page }) => {
  const { dialog, opener } = await mount(page);
  await dialog.getByLabel("Work label", { exact: true }).fill("Unsaved draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.getByLabel("Work label", { exact: true })).toHaveValue("General work");
  await expect(dialog.getByLabel("Work label", { exact: true })).toBeFocused();
});

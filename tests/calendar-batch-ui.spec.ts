import { expect, test, type Page, type Request } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
let script: string;
let css: string;
let screenshots: string;
const recoveryKey = "sowledger:schedule-pending:v1:studio:owner";
const snapshotEndpoints = ["/api/calendar", "/api/schedule?scope=team", "/api/projects", "/api/user/actions", "/api/people", "/api/user/settings", "/api/auth/me"];
type Block = { id: string; title: string; userId: string; startsAt: string; endsAt: string; updatedAt: string; status: string; tags: string[] };
type Payload = Record<string, unknown> & { operationId?: string; occurrences?: Array<{ startsAt: string; endsAt: string }>; replace?: Array<{ blockId: string; expectedUpdatedAt: string }> };
test.use({ timezoneId: "America/New_York", viewport: { width: 1280, height: 1000 } });

test.beforeAll(async () => {
  screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-calendar-batch-ui-"));
  const bundle = await build({ absWorkingDir: root, stdin: { contents: 'import {createRoot} from "react-dom/client"; import {Toaster} from "sonner"; import {CalendarView} from "./components/calendar-view"; createRoot(document.getElementById("root")).render(<main className="p-4"><CalendarView/><Toaster/></main>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  script = bundle.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

async function mount(page: Page, options: { failure?: "lost-response" | "validation" | "replacement" | "timeout"; receiptFault?: "ids" | "replacements" | "ok" | "warnings" | "replayed"; manualFailure?: "malformed" | "server-error"; hold?: boolean; holdManual?: boolean; holdRefresh?: "success" | "failure"; holdLatestRefresh?: boolean; blocks?: Block[] } = {}) {
  const blocks = (options.blocks ?? []).map((block) => ({ ...block }));
  const writes: Array<{ method: string; body: Payload }> = [];
  const receipts = new Map<string, { blockIds: string[]; replacedBlockIds: string[] }>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let releaseLatest!: () => void;
  const latestGate = new Promise<void>((resolve) => { releaseLatest = resolve; });
  const reads = { schedule: 0 };
  const snapshotReads = new Map<string, Request[]>(snapshotEndpoints.map((endpoint) => [endpoint, []]));
  const settings = { user: { timezone: "America/New_York", calendarPreferences: { visibleStartHour: 8, visibleEndHour: 18 } } };
  let postCount = 0;
  const identity = { sub: "owner", email: "owner@example.com", role: "owner", workspaceId: "studio" };
  await page.clock.install({ time: new Date("2026-10-31T16:00:00.000Z") });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://calendar-batch.test") return route.abort();
    // Assignee-scoped work-type requests are not a calendar snapshot generation.
    if (request.method() === "GET") snapshotReads.get(url.pathname + url.search)?.push(request);
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/calendar") return route.fulfill({ json: { entries: [] } });
    if (url.pathname === "/api/timer/manual") {
      writes.push({ method: request.method(), body: request.postDataJSON() });
      if (options.holdManual) await gate;
      return route.fulfill({ status: options.manualFailure === "server-error" ? 503 : 200, json: options.manualFailure === "server-error" ? { error: "Service temporarily unavailable" } : options.manualFailure === "malformed" ? {} : { ok: true } });
    }
    if (url.pathname === "/api/schedule") {
      if (request.method() === "GET") {
        const generation = ++reads.schedule;
        const snapshot = structuredClone(blocks);
        if (generation === 2 && options.holdRefresh) {
          await gate;
          if (options.holdRefresh === "failure") return route.fulfill({ status: 503, json: { error: "Old refresh failed" } });
        }
        if (generation === 3 && options.holdLatestRefresh) await latestGate;
        return route.fulfill({ json: { blocks: snapshot } });
      }
      const body: Payload = request.postDataJSON();
      writes.push({ method: request.method(), body });
      if (request.method() === "PATCH") {
        Object.assign(blocks.find((block) => block.id === body.blockId)!, body);
        return route.fulfill({ json: { block: blocks.find((block) => block.id === body.blockId) } });
      }
      postCount++;
      if (options.hold && postCount === 1) await gate;
      if ((options.failure === "validation" && postCount === 1) || options.failure === "replacement") return route.fulfill({ status: 409, json: { error: "A planned block changed. Refresh the calendar before replacing it." } });
      const prior = body.operationId ? receipts.get(body.operationId) : undefined;
      if (prior) return route.fulfill({ json: { ok: true, ...prior, replayed: true, warnings: [] } });
      const occurrences = body.occurrences ?? [{ startsAt: body.startsAt as string, endsAt: body.endsAt as string }];
      const created = occurrences.map((occurrence, index) => ({ id: `saved-${postCount}-${index}`, title: String(body.title), userId: "owner", startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, updatedAt: "2026-10-31T16:00:00.000Z", status: "planned", tags: [] }));
      blocks.push(...created);
      for (const replacement of body.replace ?? []) blocks.find((block) => block.id === replacement.blockId)!.status = "skipped";
      const receipt = { blockIds: created.map((block) => block.id), replacedBlockIds: (body.replace ?? []).map((item) => item.blockId) };
      if (body.operationId) receipts.set(body.operationId, receipt);
      if (options.failure === "lost-response" && postCount === 1) return route.abort("failed");
      if (options.failure === "timeout" && postCount === 1) return route.fulfill({ status: 408, json: { error: "The save response timed out." } });
      if (options.receiptFault && postCount === 1) {
        const corrupted = { ok: true, ...receipt, replayed: false, warnings: [], ...({ ids: { blockIds: Array(created.length).fill(created[0].id) }, replacements: { replacedBlockIds: ["unrequested-block"] }, ok: { ok: false }, warnings: { warnings: "not-a-list" }, replayed: { replayed: "no" } }[options.receiptFault]) };
        return route.fulfill({ json: corrupted });
      }
      return route.fulfill({ json: body.occurrences ? { ok: true, ...receipt, replayed: false, warnings: [] } : { ok: true, block: created[0] } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/user/actions") return route.fulfill({ json: { actions: [] } });
    if (url.pathname === "/api/people") return route.fulfill({ json: { people: [] } });
    if (url.pathname === "/api/user/settings") return route.fulfill({ json: settings });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { session: identity } });
    return route.abort();
  });
  await page.goto("https://calendar-batch.test/fixture");
  async function render() {
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Day", exact: true }).click();
  }
  await render();
  return { writes, blocks, release, releaseLatest, render, identity, reads, snapshotReads, settings };
}

async function repeatComposer(page: Page) {
  await page.getByRole("button", { name: "Schedule work", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Calendar event composer" });
  await dialog.getByLabel("Title", { exact: true }).fill("Daily client review");
  await dialog.getByLabel("Starts", { exact: true }).fill("2026-10-31T09:00");
  await dialog.getByLabel("Ends", { exact: true }).fill("2026-10-31T10:00");
  await dialog.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("daily");
  await dialog.getByRole("spinbutton", { name: "Occurrences", exact: true }).fill("3");
  return dialog;
}

async function selectRange(page: Page) {
  const column = await page.locator("[data-day-column]").boundingBox();
  await page.mouse.move(column!.x + column!.width - 10, column!.y + 36);
  await page.mouse.down();
  await page.mouse.move(column!.x + column!.width - 10, column!.y + 216, { steps: 5 });
  await page.mouse.up();
  return page.getByRole("dialog", { name: "Create calendar work block" });
}

test("repeated work is one atomic request and keeps local times across DST", async ({ page }) => {
  const { writes, blocks } = await mount(page);
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].body.operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(writes[0].body.occurrences).toEqual([
    { startsAt: "2026-10-31T13:00:00.000Z", endsAt: "2026-10-31T14:00:00.000Z" },
    { startsAt: "2026-11-01T14:00:00.000Z", endsAt: "2026-11-01T15:00:00.000Z" },
    { startsAt: "2026-11-02T14:00:00.000Z", endsAt: "2026-11-02T15:00:00.000Z" },
  ]);
  expect(blocks).toHaveLength(3);
});

test("a lost save response can be retried after closing without creating duplicates", async ({ page }) => {
  const { writes, blocks } = await mount(page, { failure: "lost-response" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(blocks).toHaveLength(3);
});

const planned: Block = { id: "planned", title: "Original work", userId: "owner", startsAt: "2026-10-31T13:00:00.000Z", endsAt: "2026-10-31T14:00:00.000Z", updatedAt: "2026-10-30T12:00:00.000Z", status: "planned", tags: [] };

test("replacement failure cannot skip old plans before new work is saved", async ({ page }) => {
  const { writes, blocks } = await mount(page, { blocks: [planned], failure: "replacement" });
  const dialog = await selectRange(page);
  await dialog.getByRole("button", { name: "Replace planned", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("A planned block changed.");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: "POST", body: { replace: [{ blockId: "planned", expectedUpdatedAt: planned.updatedAt }] } });
  expect(blocks[0].status).toBe("planned");
});

test("quick-create blocks duplicate clicks while a batch request is pending", async ({ page }) => {
  const { writes, release } = await mount(page, { hold: true });
  try {
    const dialog = await selectRange(page);
    const save = dialog.getByRole("button", { name: "Save plan", exact: true });
    await save.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => writes.length).toBe(1);
    await expect(dialog.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(1);
  } finally { release(); }
});

test("definite validation failure keeps the draft editable and reuses its operation key", async ({ page }) => {
  const { writes } = await mount(page, { failure: "validation" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("A planned block changed.");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
  await dialog.getByLabel("Title", { exact: true }).fill("Corrected review");
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].body.operationId).toBe(writes[0].body.operationId);
  expect(writes[1].body.title).toBe("Corrected review");
});

test("a repeated occurrence in a missing clock hour is rejected before any write", async ({ page }) => {
  const { writes } = await mount(page);
  const dialog = await repeatComposer(page);
  await dialog.getByLabel("Starts", { exact: true }).fill("2026-03-07T02:30");
  await dialog.getByLabel("Ends", { exact: true }).fill("2026-03-07T03:30");
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("March 8");
  expect(writes).toEqual([]);
});

test("reload offers an explicit retry of the exact unconfirmed batch without automatic writes", async ({ page }) => {
  const { writes, blocks, render } = await mount(page, { failure: "lost-response" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await page.reload();
  await render();
  await expect(page.getByText("An earlier save in this tab still needs confirmation.", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(blocks).toHaveLength(3);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
});

test("another workspace or user cannot recover this tab's pending save", async ({ page }) => {
  const { writes, render, identity } = await mount(page, { failure: "lost-response" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  identity.workspaceId = "other-workspace";
  await page.reload();
  await render();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  identity.workspaceId = "studio";
  identity.sub = "different-user";
  await page.reload();
  await render();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  identity.sub = "owner";
  await page.reload();
  await render();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
});

test("expired or malformed recovery is discarded without submission", async ({ page }) => {
  const { writes, render } = await mount(page);
  for (const invalid of [{ version: 1, expiresAt: 0, payload: {} }, { version: 1, expiresAt: Date.parse("2026-11-01T12:00:00.000Z"), payload: { operationId: "not-a-uuid", occurrences: [] } }, { version: 9, expiresAt: Date.parse("2026-11-01T12:00:00.000Z"), payload: {} }]) {
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: recoveryKey, value: invalid });
    await page.reload();
    await render();
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
  }
  expect(writes).toEqual([]);
});

test("unavailable recovery storage keeps in-memory retry and explains the reload limit", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage unavailable", "SecurityError"); } }));
  const { writes, blocks } = await mount(page, { failure: "lost-response" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByText("This browser could not keep a recovery copy. Keep this page open and retry the save before leaving.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(blocks).toHaveLength(3);
});

for (const receiptFault of ["ids", "replacements", "ok", "warnings", "replayed"] as const) {
  test(`an invalid ${receiptFault} receipt cannot clear an unconfirmed save`, async ({ page }) => {
    const { writes, blocks } = await mount(page, { receiptFault });
    const dialog = await repeatComposer(page);
    await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes[1].body).toEqual(writes[0].body);
    expect(blocks).toHaveLength(3);
  });
}

test("HTTP408 retains the exact operation for a safe retry", async ({ page }) => {
  const { writes, blocks } = await mount(page, { failure: "timeout" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(blocks).toHaveLength(3);
});

test("full recovery storage keeps the original in-memory request", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); }; });
  const { writes, blocks } = await mount(page, { failure: "lost-response" });
  const dialog = await repeatComposer(page);
  await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(dialog.getByText("This browser could not keep a recovery copy. Keep this page open and retry the save before leaving.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(blocks).toHaveLength(3);
});

for (const manualFailure of ["malformed", "server-error"] as const) {
  test(`completed time retains the draft and directs Activity review after ${manualFailure}`, async ({ page }) => {
    const { writes } = await mount(page, { manualFailure });
    const dialog = await repeatComposer(page);
    await dialog.getByRole("button", { name: "Completed time", exact: true }).click();
    await dialog.getByRole("button", { name: "Log completed work", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Check Activity before retrying");
    await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue("Daily client review");
    await expect(dialog.getByLabel("Title", { exact: true })).toBeEnabled();
    await expect(dialog.getByRole("link", { name: "Check Activity", exact: true })).toHaveAttribute("href", "/activity");
    expect(writes).toHaveLength(1);
    expect(writes[0].body.source).toBe("calendar");
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`recovered save can be reviewed and retried at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { writes, render } = await mount(page, { failure: "lost-response" });
    const dialog = await repeatComposer(page);
    await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Retry save", exact: true })).toBeInViewport();
    await page.screenshot({ path: path.join(screenshots, `pending-composer-${viewport.width}.png`) });
    await page.reload();
    await render();
    await expect(page.getByText("An earlier save in this tab still needs confirmation.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review calendar", exact: true }).click();
    expect(writes).toHaveLength(1);
    await page.screenshot({ path: path.join(screenshots, `recovered-save-${viewport.width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
    expect(writes[1].body).toEqual(writes[0].body);
  });
}

for (const outcome of ["success", "failure"] as const) {
  test(`an in-flight completed-time ${outcome} cannot dismiss or overwrite its draft`, async ({ page }) => {
    const { writes, release } = await mount(page, { holdManual: true, manualFailure: outcome === "failure" ? "server-error" : undefined });
    try {
      const dialog = await repeatComposer(page);
      await dialog.getByRole("button", { name: "Completed time", exact: true }).click();
      await dialog.getByLabel("Title", { exact: true }).fill("Unconfirmed client workshop");
      await dialog.getByLabel("Notes", { exact: true }).fill("Keep these detailed handoff notes");
      await dialog.getByRole("button", { name: "Log completed work", exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close calendar composer", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Schedule work", exact: true, includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
      await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue("Unconfirmed client workshop");
      release();
      if (outcome === "failure") {
        await expect(dialog.getByRole("alert")).toContainText("Check Activity before retrying");
        await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue("Unconfirmed client workshop");
        await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Keep these detailed handoff notes");
        await expect(dialog.getByRole("button", { name: "Close calendar composer", exact: true })).toBeEnabled();
      } else await expect(dialog).toHaveCount(0);
      expect(writes).toHaveLength(1);
    } finally { release(); }
  });
}

for (const holdRefresh of ["success", "failure"] as const) {
  test(`an older refresh ${holdRefresh} cannot replace a confirmed save's snapshot`, async ({ page }) => {
    const { blocks, writes, release, snapshotReads, settings } = await mount(page, { holdRefresh });
    try {
      const dialog = await repeatComposer(page);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("sowledger:time-saved")));
      await expect.poll(() => snapshotEndpoints.filter((endpoint) => snapshotReads.get(endpoint)!.length !== 2)).toEqual([]);
      const oldSnapshot = snapshotEndpoints.map((endpoint) => ({ endpoint, request: snapshotReads.get(endpoint)![1] }));
      settings.user.timezone = "UTC";
      settings.user.calendarPreferences.visibleEndHour = 17;
      await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("calendar-block")).toHaveCount(1);
      release();
      const oldBodies = new Map(await Promise.all(oldSnapshot.map(async ({ endpoint, request }) => {
        const response = await request.response();
        expect(response).not.toBeNull();
        expect(response!.status()).toBe(endpoint === "/api/schedule?scope=team" && holdRefresh === "failure" ? 503 : 200);
        expect(await response!.finished()).toBeNull();
        return [endpoint, await response!.json()] as const;
      })));
      expect(oldBodies.get("/api/user/settings")).toEqual({ user: { timezone: "America/New_York", calendarPreferences: { visibleStartHour: 8, visibleEndHour: 18 } } });
      expect(oldBodies.get("/api/schedule?scope=team")).toEqual(holdRefresh === "failure" ? { error: "Old refresh failed" } : { blocks: [] });
      await page.evaluate(() => new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close(); channel.port2.close();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        channel.port2.postMessage(null);
      }));
      await expect(page.getByTestId("calendar-block")).toHaveCount(1);
      await expect(page.getByTestId("calendar-timezone-cue")).toContainText("Account timezone UTC");
      await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
      await expect(page.getByLabel("Visible end hour", { exact: true })).toHaveValue("17");
      await expect(page.getByText("Could not load your calendar. Check your connection and try again.", { exact: true })).toHaveCount(0);
      expect(blocks).toHaveLength(3);
      expect(writes).toHaveLength(1);
    } finally { release(); }
  });
}

test("a stale failed refresh cannot finish the latest refresh's loading state", async ({ page }) => {
  const { reads, release, releaseLatest } = await mount(page, { holdRefresh: "failure", holdLatestRefresh: true });
  try {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sowledger:time-saved")));
    await expect.poll(() => reads.schedule).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sowledger:calendar-updated")));
    await expect.poll(() => reads.schedule).toBe(3);
    const response = page.waitForResponse((item) => item.url().includes("/api/schedule?") && item.request().method() === "GET");
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByText("Loading calendar...", { exact: true })).toBeVisible();
    await expect(page.getByText("Could not load your calendar. Check your connection and try again.", { exact: true })).toHaveCount(0);
    releaseLatest();
    await expect(page.getByText("Loading calendar...", { exact: true })).toHaveCount(0);
  } finally { release(); releaseLatest(); }
});

test.afterAll(() => console.log(`Calendar recovery screenshots: ${screenshots}`));

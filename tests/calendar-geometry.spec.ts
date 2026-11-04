import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
const blockUpdatedAt = "2026-10-30T12:00:00.000Z";
let script: string;
let css: string;
let screenshots: string;
type Block = { id: string; userId: string; title: string; startsAt: string; endsAt: string; status: string; tags: string[]; linkedTimeEntryId?: string | null };
type Entry = { id: string; userId: string; taskId: string; startedAt: string; stoppedAt: string | null; durationSeconds: number | null; source: "web" | "manual"; scheduledBlockId?: string | null };
type Write = { method: string; body: Record<string, unknown> };

// The full Chromium suite also discovers this file; do not depend on the standalone config.
test.use({ timezoneId: "America/New_York", viewport: { width: 1280, height: 1000 } });

test.beforeAll(async () => {
  screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-calendar-geometry-"));
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: 'import { createRoot } from "react-dom/client"; import { Toaster } from "sonner"; import { CalendarView } from "./components/calendar-view"; createRoot(document.getElementById("root")).render(<main className="p-4"><CalendarView /><Toaster /></main>);', resolveDir: root, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  script = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

async function mount(page: Page, options: { now: string; blocks?: Block[]; entries?: Entry[]; failPatch?: string; startHour?: number; teammate?: boolean }) {
  const blocks = (options.blocks ?? []).map((block) => ({ projectId: null, taskId: null, actionId: null, notes: null, updatedAt: blockUpdatedAt, ...block }));
  const entries = options.entries ?? [];
  const writes: Write[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(options.now) });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://calendar-geometry.test") return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/calendar") return route.fulfill({ json: { entries } });
    if (url.pathname === "/api/schedule") {
      if (request.method() === "GET") return route.fulfill({ json: { blocks } });
      const body = request.postDataJSON();
      writes.push({ method: request.method(), body });
      if (request.method() === "PATCH") {
        if (body.blockId === options.failPatch) return route.fulfill({ status: 409, json: { error: "This block is no longer planned." } });
        const block = blocks.find((item) => item.id === body.blockId)!;
        Object.assign(block, body);
        return route.fulfill({ json: { block } });
      }
      if (body.replace?.some((item: { blockId: string }) => item.blockId === options.failPatch)) return route.fulfill({ status: 409, json: { error: "This block is no longer planned." } });
      const created = body.occurrences.map((occurrence: { startsAt: string; endsAt: string }, index: number) => ({ projectId: null, taskId: null, actionId: null, notes: null, tags: [], status: "planned", updatedAt: blockUpdatedAt, ...body, ...occurrence, id: `created-${blocks.length + index}`, userId: body.userId || "owner" }));
      blocks.push(...created);
      for (const item of body.replace ?? []) blocks.find((block) => block.id === item.blockId)!.status = "skipped";
      return route.fulfill({ json: { ok: true, blockIds: created.map((block: { id: string }) => block.id), replacedBlockIds: (body.replace ?? []).map((item: { blockId: string }) => item.blockId), replayed: false, warnings: [] } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/user/actions") return route.fulfill({ json: { actions: [] } });
    if (url.pathname === "/api/people") return route.fulfill({ json: { people: options.teammate ? [{ id: "colleague", linkedUserId: "colleague", displayName: "Colleague", personType: "member", invitationStatus: "accepted" }] : [] } });
    if (url.pathname === "/api/user/settings") return route.fulfill({ json: { user: { timezone: "America/New_York", calendarPreferences: { visibleStartHour: options.startHour ?? 8, visibleEndHour: 18 } } } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { session: { sub: "owner", email: "owner@example.com", role: "owner", workspaceId: "studio" } } });
    return route.abort();
  });
  await page.goto("https://calendar-geometry.test/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Day", exact: true }).click();
  return { blocks, entries, writes, errors };
}

for (const transition of [
  { name: "spring forward", day: "2026-03-08", now: "2026-03-08T16:00:00.000Z", start: "2026-03-08T13:00:00.000Z", end: "2026-03-08T14:00:00.000Z", movedStart: "2026-03-08T14:00:00.000Z", movedEnd: "2026-03-08T15:00:00.000Z", resizedEnd: "2026-03-08T15:30:00.000Z" },
  { name: "fall back", day: "2026-11-01", now: "2026-11-01T17:00:00.000Z", start: "2026-11-01T14:00:00.000Z", end: "2026-11-01T15:00:00.000Z", movedStart: "2026-11-01T15:00:00.000Z", movedEnd: "2026-11-01T16:00:00.000Z", resizedEnd: "2026-11-01T16:30:00.000Z" },
]) {
  test(`calendar create, move, and resize follow wall-clock hours on ${transition.name}`, async ({ page }) => {
    const { writes, errors } = await mount(page, { now: transition.now });
    await page.getByRole("button", { name: "Schedule work", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "Calendar event composer" });
    await composer.getByLabel("Title", { exact: true }).fill("DST review");
    await composer.getByLabel("Starts", { exact: true }).fill(`${transition.day}T09:00`);
    await composer.getByLabel("Ends", { exact: true }).fill(`${transition.day}T10:00`);
    await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    const card = page.getByTestId("calendar-block");
    await expect(card).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, `${transition.name.replaceAll(" ", "-")}-created.png`) });
    expect(writes[0].body).toMatchObject({ occurrences: [{ startsAt: transition.start, endsAt: transition.end }] });
    await expect(card).toHaveCSS("top", "72px");
    await expect(card).toHaveCSS("height", "72px");

    const handle = await card.getByRole("button", { name: "Drag to reschedule DST review", exact: true }).boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 72, { steps: 4 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Move block", exact: true }).click();
    await expect(card).toHaveCSS("top", "144px");
    expect(writes[1].body).toMatchObject({ startsAt: transition.movedStart, endsAt: transition.movedEnd });
    const resize = await card.getByRole("button", { name: "Resize end for DST review", exact: true }).boundingBox();
    await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2 + 36, { steps: 3 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Resize block", exact: true }).click();
    await expect(card).toHaveCSS("height", "108px");
    expect(writes[2].body).toMatchObject({ startsAt: transition.movedStart, endsAt: transition.resizedEnd });
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(card).toHaveCSS("top", "144px");
    await expect(card).toHaveCSS("height", "108px");
    expect(errors).toEqual([]);
  });
}

test("month totals split an overnight entry across its actual days", async ({ page }) => {
  await mount(page, { now: "2026-11-01T17:00:00.000Z", entries: [{ id: "overnight", userId: "owner", taskId: "Overnight work", startedAt: "2026-11-02T04:30:00.000Z", stoppedAt: "2026-11-02T05:30:00.000Z", durationSeconds: 3600, source: "manual" }] });
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const firstDay = page.getByText("1", { exact: true }).locator("../..");
  const secondDay = page.getByText("2", { exact: true }).locator("../..");
  await expect(firstDay).toContainText("0.5h");
  await expect(secondDay).toContainText("0.5h");
  await expect(firstDay).not.toContainText("1.0h");
});

test("live timer conflicts extend to now and refresh every minute", async ({ page }) => {
  await mount(page, { now: "2026-11-01T17:00:00.000Z", entries: [{ id: "live", userId: "owner", taskId: "Running design", startedAt: "2026-11-01T14:00:00.000Z", stoppedAt: null, durationSeconds: null, source: "web" }], blocks: [{ id: "meeting", userId: "owner", title: "Client meeting", startsAt: "2026-11-01T16:00:00.000Z", endsAt: "2026-11-01T17:00:00.000Z", tags: [], status: "planned" }] });
  const entry = page.locator("article").filter({ hasText: "Running design" });
  await expect(entry).toContainText("12:00 PM");
  await page.clock.fastForward(60000);
  await expect(entry).toContainText("12:01 PM");
  await page.getByTestId("calendar-block").getByText("Client meeting", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Scheduled work actions" })).toContainText("Overlaps 1 item(s).");
});

test("a calendar block does not conflict with its own linked time entry", async ({ page }) => {
  await mount(page, { now: "2026-11-01T17:00:00.000Z", entries: [{ id: "live", userId: "owner", taskId: "Running design", startedAt: "2026-11-01T14:00:00.000Z", stoppedAt: null, durationSeconds: null, scheduledBlockId: "design", source: "web" }], blocks: [{ id: "design", userId: "owner", title: "Client design", startsAt: "2026-11-01T14:00:00.000Z", endsAt: "2026-11-01T16:00:00.000Z", tags: [], status: "in_progress", linkedTimeEntryId: "live" }] });
  await page.getByTestId("calendar-block").getByText("Client design", { exact: true }).click();
  const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
  await expect(actions.getByText(/Overlaps \d+ item/)).toHaveCount(0);
  await expect(actions.getByRole("link", { name: "Go to timer", exact: true })).toBeVisible();
});

async function selectOverlap(page: Page) {
  const column = await page.locator("[data-day-column]").boundingBox();
  await page.mouse.move(column!.x + column!.width - 10, column!.y + 36);
  await page.mouse.down();
  await page.mouse.move(column!.x + column!.width - 10, column!.y + 288, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Create calendar work block" })).toBeVisible();
}

const overlappingBlock: Block = { id: "planned", userId: "owner", title: "Replaceable plan", startsAt: "2026-11-01T14:00:00.000Z", endsAt: "2026-11-01T16:00:00.000Z", status: "planned", tags: [] };

test("Replace planned leaves running, completed, linked and unavailable blocks untouched", async ({ page }) => {
  const { writes, errors } = await mount(page, { now: "2026-11-01T17:00:00.000Z", blocks: [
    overlappingBlock,
    { ...overlappingBlock, id: "running", title: "Running work", status: "in_progress" },
    { ...overlappingBlock, id: "completed", title: "Completed work", status: "completed" },
    { ...overlappingBlock, id: "linked", title: "Linked work", linkedTimeEntryId: "entry" },
    { ...overlappingBlock, id: "unavailable", title: "Busy", tags: ["unavailable"] },
  ] });
  await selectOverlap(page);
  await page.getByRole("button", { name: "Replace planned", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create calendar work block" })).toHaveCount(0);
  expect(writes.filter((write) => write.method === "PATCH")).toEqual([]);
  expect(writes.filter((write) => write.method === "POST")).toHaveLength(1);
  expect(writes[0].body.replace).toEqual([{ blockId: "planned", expectedUpdatedAt: blockUpdatedAt }]);
  expect(errors).toEqual([]);
});

test("Replace planned is absent when the overlap contains no editable plans", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-11-01T17:00:00.000Z", blocks: [{ ...overlappingBlock, status: "in_progress" }] });
  await selectOverlap(page);
  await expect(page.getByTestId("calendar-conflict-warning")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace planned", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("a failed replacement does not silently create another overlapping block", async ({ page }) => {
  const { writes, blocks, errors } = await mount(page, { now: "2026-11-01T17:00:00.000Z", blocks: [overlappingBlock], failPatch: "planned" });
  await selectOverlap(page);
  await page.getByRole("button", { name: "Replace planned", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create calendar work block" }).getByRole("alert")).toHaveText("This block is no longer planned.");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: "POST", body: { replace: [{ blockId: "planned", expectedUpdatedAt: blockUpdatedAt }] } });
  expect(blocks).toHaveLength(1);
  expect(blocks[0].status).toBe("planned");
  expect(errors).toEqual([]);
});

test("notes-only edits preserve the second occurrence of a repeated clock hour", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-11-01T17:00:00.000Z", startHour: 0, blocks: [{ ...overlappingBlock, startsAt: "2026-11-01T06:30:00.000Z", endsAt: "2026-11-01T07:00:00.000Z" }] });
  await page.getByTestId("calendar-block").getByText("Replaceable plan", { exact: true }).click();
  await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Edit", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await composer.getByLabel("Notes", { exact: true }).fill("Same time, clearer notes.");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect(writes[0].body).toMatchObject({ startsAt: "2026-11-01T06:30:00.000Z", endsAt: "2026-11-01T07:00:00.000Z" });
});

test("month totals allocate net time proportionally when an overnight entry includes breaks", async ({ page }) => {
  await mount(page, { now: "2026-11-01T17:00:00.000Z", entries: [{ id: "overnight-breaks", userId: "owner", taskId: "Overnight work", startedAt: "2026-11-02T03:00:00.000Z", stoppedAt: "2026-11-02T07:00:00.000Z", durationSeconds: 7200, source: "manual" }] });
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByText("1", { exact: true }).locator("../..")).toContainText("1.0h");
  await expect(page.getByText("2", { exact: true }).locator("../..")).toContainText("1.0h");
  await expect(page.getByText(/Time after breaks is allocated proportionally/)).toBeVisible();
});

test("quick selection into a missing DST time is rejected before writing", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-03-08T16:00:00.000Z", startHour: 0 });
  const column = await page.locator("[data-day-column]").boundingBox();
  await page.mouse.move(column!.x + 100, column!.y + 108);
  await page.mouse.down();
  await page.mouse.move(column!.x + 100, column!.y + 180, { steps: 5 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Create calendar work block" });
  await expect(dialog.getByRole("alert")).toContainText("does not exist");
  await expect(dialog.getByRole("button", { name: "Save plan", exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
});

for (const action of ["move", "resize"] as const) {
  test(`${action} into a missing DST time is rejected before writing`, async ({ page }) => {
    const { writes } = await mount(page, { now: "2026-03-08T16:00:00.000Z", startHour: 0, blocks: [{ ...overlappingBlock, title: "Early review", startsAt: "2026-03-08T06:30:00.000Z", endsAt: "2026-03-08T06:45:00.000Z" }] });
    const card = page.getByTestId("calendar-block");
    const handle = await card.getByRole("button", { name: action === "move" ? "Drag to reschedule Early review" : "Resize end for Early review", exact: true }).boundingBox();
    const column = await page.locator("[data-day-column]").boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    // Target the 02:30 row explicitly so the test does not depend on the handle's inset.
    await page.mouse.move(handle!.x + handle!.width / 2, column!.y + 180, { steps: 5 });
    await page.mouse.up();
    const dialog = page.getByRole("dialog", { name: action === "move" ? "Move scheduled work" : "Resize scheduled work", exact: true });
    await expect(dialog.getByRole("alert")).toContainText("does not exist");
    await expect(dialog.getByRole("button", { name: action === "move" ? "Move block" : "Resize block", exact: true })).toBeDisabled();
    expect(writes).toEqual([]);
  });
}

test("keyboard nudges cannot silently move work into a missing DST time", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-03-08T16:00:00.000Z", startHour: 0, blocks: [{ ...overlappingBlock, startsAt: "2026-03-08T06:30:00.000Z", endsAt: "2026-03-08T06:45:00.000Z" }] });
  await page.getByTestId("calendar-block").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByRole("alert")).toContainText("does not exist");
  expect(writes).toEqual([]);
});

for (const scenario of [
  { name: "later repeated-hour start", now: "2026-11-01T17:00:00.000Z", startHour: 0, edge: "end", startsAt: "2026-11-01T06:30:45.123Z", endsAt: "2026-11-01T07:00:10.567Z", targetMinute: 150, expectedStart: "2026-11-01T06:30:45.123Z", expectedEnd: "2026-11-01T07:30:00.000Z" },
  { name: "start before visible hours", now: "2026-10-31T16:00:00.000Z", startHour: 8, edge: "end", startsAt: "2026-10-31T11:00:12.345Z", endsAt: "2026-10-31T13:00:00.000Z", targetMinute: 600, expectedStart: "2026-10-31T11:00:12.345Z", expectedEnd: "2026-10-31T14:00:00.000Z" },
  { name: "end after visible hours", now: "2026-10-31T16:00:00.000Z", startHour: 8, edge: "start", startsAt: "2026-10-31T21:00:00.000Z", endsAt: "2026-10-31T23:00:42.789Z", targetMinute: 990, expectedStart: "2026-10-31T20:30:00.000Z", expectedEnd: "2026-10-31T23:00:42.789Z" },
] as const) {
  test(`resizing preserves the untouched ${scenario.name} exactly`, async ({ page }) => {
    const { writes } = await mount(page, { now: scenario.now, startHour: scenario.startHour, blocks: [{ ...overlappingBlock, title: "Exact time review", startsAt: scenario.startsAt, endsAt: scenario.endsAt }] });
    const handle = page.getByRole("button", { name: `Resize ${scenario.edge} for Exact time review`, exact: true });
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    const column = await page.locator("[data-day-column]").boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, column!.y + (scenario.targetMinute - scenario.startHour * 60) / 60 * 72, { steps: 5 });
    await page.mouse.up();
    await page.getByRole("dialog", { name: "Resize scheduled work", exact: true }).getByRole("button", { name: "Resize block", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toMatchObject({ startsAt: scenario.expectedStart, endsAt: scenario.expectedEnd });
  });
}

for (const clock of [{ name: "spring forward", now: "2026-03-08T13:30:00.000Z" }, { name: "fall back", now: "2026-11-01T14:30:00.000Z" }]) {
  test(`the current-time marker follows wall-clock minutes on ${clock.name}`, async ({ page }) => {
    const { writes } = await mount(page, { now: clock.now });
    const marker = page.getByTestId("calendar-now-marker");
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute("aria-label", "Current time 9:30 AM");
    expect(await marker.evaluate((element) => Number.parseFloat((element as HTMLElement).style.top))).toBe(108);
    await expect(marker).toHaveCSS("pointer-events", "none");
    await page.clock.fastForward(60_000);
    await expect(marker).toHaveAttribute("aria-label", "Current time 9:31 AM");
    expect(await marker.evaluate((element) => Number.parseFloat((element as HTMLElement).style.top))).toBeCloseTo(109.2);
    await page.screenshot({ path: path.join(screenshots, `now-${clock.name.replace(" ", "-")}.png`) });
    expect(writes).toEqual([]);
  });
}

test("the current-time marker appears only on today's day, week and team lanes", async ({ page }) => {
  await mount(page, { now: "2026-10-31T16:00:00.000Z", teammate: true });
  const markers = page.getByTestId("calendar-now-marker");
  await expect(markers).toHaveCount(1);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(markers).toHaveCount(1);
  await expect(markers.locator("..")).toHaveAttribute("data-day-key", "2026-10-31");
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(markers).toHaveCount(2);
  await page.getByRole("button", { name: "Next period", exact: true }).click();
  await expect(markers).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(markers).toHaveCount(2);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(markers).toHaveCount(0);
});

test("the current-time marker hides outside visible hours", async ({ page }) => {
  await mount(page, { now: "2026-10-31T21:59:00.000Z" });
  const marker = page.getByTestId("calendar-now-marker");
  await expect(marker).toHaveCount(1);
  await page.clock.fastForward(60_000);
  await expect(marker).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
  await page.getByLabel("Visible end hour", { exact: true }).selectOption("20");
  await expect(marker).toHaveCount(1);
});

test.afterAll(() => console.log(`Calendar geometry screenshots: ${screenshots}`));

import { expect, test, type Page } from "@playwright/test";
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
type Block = { id: string; title: string; startsAt: string; endsAt: string; userId?: string; status?: string; tags?: string[]; linkedTimeEntryId?: string | null; actionId?: string | null };
type Entry = { id: string; userId: string; taskId: string; startedAt: string; stoppedAt: string | null; durationSeconds: number | null; source: "web" | "manual"; scheduledBlockId?: string | null };

// The normal Chromium config discovers this fixture too; no app server is used.
test.use({ timezoneId: "America/New_York", viewport: { width: 1280, height: 1000 } });

test.beforeAll(async () => {
  screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-calendar-accessibility-"));
  const bundle = await build({
    absWorkingDir: root,
    stdin: { contents: 'import { createRoot } from "react-dom/client"; import { Toaster } from "sonner"; import { CalendarView } from "./components/calendar-view"; createRoot(document.getElementById("root")).render(<main className="p-4"><CalendarView /><Toaster /></main>);', resolveDir: root, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  script = bundle.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

async function mount(page: Page, options: { now?: string; blocks?: Block[]; entries?: Entry[]; startHour?: number; colleague?: boolean; workTypes?: boolean } = {}) {
  const blocks = (options.blocks ?? []).map((block) => ({ userId: "owner", projectId: null, actionId: null, taskId: null, notes: null, tags: [], status: "planned", linkedTimeEntryId: null, ...block }));
  const calendarPreferences = { visibleStartHour: options.startHour ?? 8, visibleEndHour: 18 };
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  const errors: string[] = [];
  const timeWrites: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(options.now ?? "2026-10-30T16:00:00.000Z") });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://calendar-accessibility.test") return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><title>Calendar accessibility fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname.startsWith("/api/timer/") && request.method() !== "GET") timeWrites.push(url.pathname);
    if (url.pathname === "/api/calendar") return route.fulfill({ json: { entries: options.entries ?? [] } });
    if (url.pathname === "/api/schedule") {
      if (request.method() === "GET") return route.fulfill({ json: { blocks } });
      const body = request.postDataJSON();
      writes.push({ method: request.method(), body });
      if (request.method() === "PATCH") {
        const block = blocks.find((item) => item.id === body.blockId)!;
        Object.assign(block, body);
        return route.fulfill({ json: { ok: true, block } });
      }
      const created = body.occurrences.map((occurrence: { startsAt: string; endsAt: string }, index: number) => ({ userId: "owner", projectId: null, actionId: null, taskId: null, notes: null, tags: [], status: "planned", linkedTimeEntryId: null, ...body, ...occurrence, id: `created-${blocks.length + index}` }));
      blocks.push(...created);
      return route.fulfill({ json: { ok: true, blockIds: created.map((block: { id: string }) => block.id), replacedBlockIds: [], replayed: false, warnings: [] } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/user/actions") {
      const user = url.searchParams.get("userId") || "owner";
      return route.fulfill({ json: { actions: options.workTypes ? [{ id: `${user}-rate`, name: `${user} work`, hourlyRate: user === "owner" ? 100 : 200 }] : [] } });
    }
    if (url.pathname === "/api/people") return route.fulfill({ json: { people: options.colleague || options.entries?.some((entry) => entry.userId === "colleague") ? [{ id: "colleague", linkedUserId: "colleague", displayName: "Colleague", personType: "member", invitationStatus: "accepted", status: "active" }] : [] } });
    if (url.pathname === "/api/user/settings") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        writes.push({ method: request.method(), body });
        Object.assign(calendarPreferences, body.calendarPreferences);
        return route.fulfill({ json: { ok: true, user: { calendarPreferences } } });
      }
      return route.fulfill({ json: { user: { timezone: "UTC", calendarPreferences } } });
    }
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { session: { sub: "owner", email: "owner@example.com", role: "owner", workspaceId: "studio" } } });
    return route.abort();
  });
  await page.goto("https://calendar-accessibility.test/fixture");
  async function render() {
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(page).toHaveTitle("Calendar accessibility fixture");
  }
  await render();
  return { writes, blocks, errors, timeWrites, render };
}

async function holdNextScheduleRead(page: Page, fail = false) {
  let started = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/schedule?scope=team", async (route) => {
    started = true;
    await gate;
    if (fail) return route.fulfill({ status: 503, json: { error: "Calendar unavailable" } });
    await route.fallback();
  }, { times: 1 });
  return { hasStarted: () => started, release };
}

for (const order of ["rate-first", "assignee-first"]) test(`I5 composer resolves assignee work types ${order}`, async ({ page }) => {
  const f = await mount(page, { colleague: true, workTypes: true });
  await page.getByRole("button", { name: "Schedule work", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  if (order === "rate-first") await composer.getByLabel("Work type / rate").selectOption("owner-rate");
  await composer.getByLabel("Assignee").selectOption("colleague");
  if (order === "rate-first") await expect(composer).toContainText("Work type cleared for the new assignee");
  await composer.getByLabel("Work type / rate").selectOption("colleague-rate");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].body).toMatchObject({ userId: "colleague", actionId: "colleague-rate" });
});

test("I5 existing other-member action survives unrelated edit and reassignment clears it", async ({ page }) => {
  const f = await mount(page, { colleague: true, workTypes: true, blocks: [{ id: "assigned", title: "Assigned work", userId: "colleague", actionId: "colleague-rate", startsAt: "2026-10-30T13:00:00Z", endsAt: "2026-10-30T14:00:00Z" }] });
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.locator('[data-calendar-block-id="assigned"]').first().click();
  await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Edit", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await expect(composer.getByLabel("Work type / rate")).toHaveValue("colleague-rate");
  await composer.getByLabel("Title", { exact: true }).fill("Updated assigned work");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].body).toMatchObject({ actionId: "colleague-rate", userId: "colleague" });
  await expect(composer).toHaveCount(0);
  await page.locator('[data-calendar-block-id="assigned"]').first().click();
  await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Edit", exact: true }).click();
  await composer.getByLabel("Assignee").selectOption("owner");
  await expect(composer.getByLabel("Work type / rate")).toHaveValue("");
  await composer.getByLabel("Work type / rate").selectOption("owner-rate");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].body).toMatchObject({ actionId: "owner-rate", userId: "owner" });
});

test("I5 slow prior-assignee choices cannot replace the current list; failed choices are explicit", async ({ page }) => {
  await mount(page, { colleague: true, workTypes: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/user/actions?userId=owner", async route => {
    await gate;
    await route.fulfill({ json: { actions: [{ id: "stale-owner-rate", name: "Stale owner", hourlyRate: 1 }] } });
  });
  await page.getByRole("button", { name: "Schedule work", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await composer.getByLabel("Assignee").selectOption("colleague");
  await composer.getByLabel("Work type / rate").selectOption("colleague-rate");
  const response = page.waitForResponse(r => r.url().endsWith("actions?userId=owner"));
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(composer.getByLabel("Work type / rate")).toHaveValue("colleague-rate");
  await expect(composer.getByRole("option", { name: /Stale owner/ })).toHaveCount(0);
  await page.route("**/api/user/actions?userId=owner", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await composer.getByLabel("Assignee").selectOption("owner");
  await expect(composer).toContainText("Work types could not be loaded for this assignee");
  await expect(composer.getByLabel("Work type / rate")).toHaveValue("");
});

test("I5 rated grid reassignment refuses the hidden incompatible action with edit guidance", async ({ page }) => {
  const f = await mount(page, { colleague: true, workTypes: true, blocks: [{ id: "rated", title: "Rated work", actionId: "owner-rate", startsAt: "2026-10-30T13:00:00Z", endsAt: "2026-10-30T14:00:00Z" }] });
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const card = page.locator('[data-calendar-block-id="rated"]').first();
  const handle = (await card.getByRole("button", { name: "Drag to reschedule Rated work", exact: true }).boundingBox())!;
  const target = (await page.locator('[data-day-column][data-user-id="colleague"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Move scheduled work", exact: true });
  await dialog.getByRole("button", { name: "Move block", exact: true }).click();
  await expect(dialog).toContainText("Use Edit details to choose the new assignee");
  expect(f.writes).toEqual([]);
});

for (const operation of ["pointer", "keyboard", "Next slot", "Duplicate"] as const) {
  test(`I4 exact irregular interval survives ${operation}`, async ({ page }) => {
    const start = operation === "keyboard" ? "2026-10-30T13:00:45.000Z" : "2026-10-30T13:00:00.000Z";
    const end = operation === "pointer" ? "2026-10-30T13:37:00.000Z" : operation === "keyboard" ? "2026-10-30T13:30:15.000Z" : "2026-10-30T13:05:00.000Z";
    const f = await mount(page, { blocks: [{ id: "exact", title: "Exact interval", startsAt: start, endsAt: end }] });
    const card = page.locator('[data-calendar-block-id="exact"]').first();
    if (operation === "pointer") {
      const box = (await card.getByRole("button", { name: "Drag to reschedule Exact interval", exact: true }).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 72, { steps: 4 });
      await page.mouse.up();
      await page.getByRole("dialog", { name: "Move scheduled work", exact: true }).getByRole("button", { name: "Move block", exact: true }).click();
    } else if (operation === "keyboard") {
      await card.focus();
      await page.keyboard.press("ArrowDown");
    } else {
      await card.click();
      await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: operation, exact: true }).click();
    }
    await expect.poll(() => f.writes.length).toBe(1);
    const result = operation === "Duplicate" ? (f.writes[0].body.occurrences as Array<{ startsAt: string; endsAt: string }>)[0] : f.writes[0].body;
    expect(new Date(result.endsAt as string).getTime() - new Date(result.startsAt as string).getTime()).toBe(new Date(end).getTime() - new Date(start).getTime());
    if (operation === "pointer") expect(result).toMatchObject({ startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T14:37:00.000Z" });
    if (operation === "keyboard") expect(result).toMatchObject({ startsAt: "2026-10-30T13:15:45.000Z", endsAt: "2026-10-30T13:45:15.000Z" });
  });
}

// A refresh that removes the focused article must not strand the next arrow key.
test("release calendar keyboard focus survives a delayed refresh and a second nudge", async ({ page }) => {
  const f = await mount(page, { blocks: [{ id: "keyboard-continuity", title: "Keyboard continuity", startsAt: "2026-10-30T13:00:45.000Z", endsAt: "2026-10-30T13:30:15.000Z" }] });
  const card = page.locator('[data-calendar-block-id="keyboard-continuity"]');
  const held = await holdNextScheduleRead(page);
  await card.focus();
  try {
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => f.writes.length).toBe(1);
    expect(f.writes[0]).toEqual({ method: "PATCH", body: { blockId: "keyboard-continuity", startsAt: "2026-10-30T13:15:45.000Z", endsAt: "2026-10-30T13:45:15.000Z" } });
    await expect.poll(held.hasStarted).toBe(true);
    // Let the pending refresh paint before releasing it; immediate replies can
    // conceal the loading-state unmount that causes this keyboard regression.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally {
    held.release();
  }
  await expect(card).toHaveAttribute("aria-label", /9:15\sAM to 9:45\sAM$/);
  await expect(card).toBeFocused();
  // No focus() here: this must be the same continuous keyboard interaction.
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1]).toEqual({ method: "PATCH", body: { blockId: "keyboard-continuity", startsAt: "2026-10-30T13:30:45.000Z", endsAt: "2026-10-30T14:00:15.000Z" } });
  await expect(card).toHaveAttribute("aria-label", /9:30\sAM to 10:00\sAM$/);
  await expect(card).toBeFocused();
  expect(f.errors).toEqual([]);
});

// A successful nearby move must not reset the user's scrolled time window.
test("release calendar scroll position survives a delayed nudge refresh", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const f = await mount(page, { startHour: 0, blocks: [{ id: "scroll-continuity", title: "Afternoon continuity", startsAt: "2026-10-30T18:00:45.000Z", endsAt: "2026-10-30T18:30:15.000Z" }] });
  const card = page.locator('[data-calendar-block-id="scroll-continuity"]');
  const scroll = page.getByTestId("calendar-scroll-area");
  await card.focus();
  await scroll.evaluate((element) => { element.scrollTop = 800; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(800);
  await expect(card).toBeFocused();
  const held = await holdNextScheduleRead(page);
  try {
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => f.writes.length).toBe(1);
    expect(f.writes[0]).toEqual({ method: "PATCH", body: { blockId: "scroll-continuity", startsAt: "2026-10-30T18:15:45.000Z", endsAt: "2026-10-30T18:45:15.000Z" } });
    await expect.poll(held.hasStarted).toBe(true);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally {
    held.release();
  }
  await expect(card).toHaveAttribute("aria-label", /2:15\sPM to 2:45\sPM$/);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(800);
  expect(f.errors).toEqual([]);
});

test("release calendar nudge refresh does not take focus from another control", async ({ page }) => {
  await mount(page, { blocks: [{ id: "focus-choice", title: "Focus choice", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T13:30:00.000Z" }] });
  const card = page.locator('[data-calendar-block-id="focus-choice"]');
  const held = await holdNextScheduleRead(page);
  const schedule = page.getByRole("button", { name: "Schedule work", exact: true });
  await card.focus();
  try {
    await page.keyboard.press("ArrowDown");
    await expect.poll(held.hasStarted).toBe(true);
    await schedule.focus();
    await expect(schedule).toBeFocused();
  } finally {
    held.release();
  }
  await expect(card).toHaveAttribute("aria-label", /9:15\sAM to 9:45\sAM$/);
  await expect(schedule).toBeFocused();
});

test("release calendar failed nudge refresh puts keyboard focus on retry", async ({ page }) => {
  const f = await mount(page, { blocks: [{ id: "refresh-failure", title: "Refresh failure", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T13:30:00.000Z" }] });
  const held = await holdNextScheduleRead(page, true);
  await page.locator('[data-calendar-block-id="refresh-failure"]').focus();
  try {
    await page.keyboard.press("ArrowDown");
    await expect.poll(held.hasStarted).toBe(true);
    expect(f.writes).toEqual([{ method: "PATCH", body: { blockId: "refresh-failure", startsAt: "2026-10-30T13:15:00.000Z", endsAt: "2026-10-30T13:45:00.000Z" } }]);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally {
    held.release();
  }
  await expect(page.getByRole("button", { name: "Retry calendar", exact: true })).toBeFocused();
  expect(f.errors).toEqual([]);
});

test("release calendar nudge outside the displayed day returns focus to date navigation", async ({ page }) => {
  const f = await mount(page, { blocks: [{ id: "next-day-focus", title: "Next day focus", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T13:30:00.000Z" }] });
  const card = page.locator('[data-calendar-block-id="next-day-focus"]');
  const held = await holdNextScheduleRead(page);
  await card.focus();
  try {
    await page.keyboard.press("ArrowRight");
    await expect.poll(held.hasStarted).toBe(true);
    expect(f.writes).toEqual([{ method: "PATCH", body: { blockId: "next-day-focus", startsAt: "2026-10-31T13:00:00.000Z", endsAt: "2026-10-31T13:30:00.000Z" } }]);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally {
    held.release();
  }
  await expect(card).toHaveCount(0);
  await expect(page.getByLabel("Go to date", { exact: true })).toHaveValue("2026-10-30");
  await expect(page.getByLabel("Go to date", { exact: true })).toBeFocused();
  expect(f.errors).toEqual([]);
});

test("I4 repeated-hour nudge preserves the existing second occurrence offset", async ({ page }) => {
  const f = await mount(page, { now: "2026-11-01T17:00:00.000Z", startHour: 0, blocks: [{ id: "fold", title: "Second occurrence", startsAt: "2026-11-01T06:00:45.000Z", endsAt: "2026-11-01T06:05:15.000Z" }] });
  await page.locator('[data-calendar-block-id="fold"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].body).toMatchObject({ startsAt: "2026-11-01T06:15:45.000Z", endsAt: "2026-11-01T06:20:15.000Z" });
});

for (const operation of ["Next slot", "Duplicate"] as const) test(`I4 ${operation} retains sub-minute endpoints`, async ({ page }) => {
  const f = await mount(page, { blocks: [{ id: "seconds", title: "Seconds", startsAt: "2026-10-30T13:00:45.000Z", endsAt: "2026-10-30T13:05:15.000Z" }] });
  await page.locator('[data-calendar-block-id="seconds"]').first().click();
  await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: operation, exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  const result = operation === "Duplicate" ? (f.writes[0].body.occurrences as Array<{ startsAt: string; endsAt: string }>)[0] : f.writes[0].body;
  expect(result).toMatchObject({ startsAt: "2026-10-30T13:15:45.000Z", endsAt: "2026-10-30T13:20:15.000Z" });
});

for (const width of [320, 390]) {
  test(`Next slot skips same-member busy time and preserves duration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mount(page, { colleague: true, blocks: [
      { id: "move", title: "Move this review", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T14:00:00.000Z" },
      { id: "busy", title: "Owner busy", startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T15:30:00.000Z", tags: ["unavailable"] },
      { id: "other", userId: "colleague", title: "Other member busy", startsAt: "2026-10-30T15:30:00.000Z", endsAt: "2026-10-30T18:00:00.000Z", tags: ["unavailable"] },
    ] });
    await page.locator('[data-calendar-block-id="move"]').first().click();
    await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Next slot", exact: true }).click();
    await expect.poll(() => fixture.writes.length).toBe(1);
    expect(fixture.writes).toEqual([{ method: "PATCH", body: { blockId: "move", startsAt: "2026-10-30T15:30:00.000Z", endsAt: "2026-10-30T16:30:00.000Z" } }]);
    await page.locator('[data-calendar-block-id="move"]').first().click();
    await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Calendar event composer" });
    await expect(dialog.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-30T11:30");
    await expect(dialog.getByLabel("Ends", { exact: true })).toHaveValue("2026-10-30T12:30");
    expect(fixture.errors).toEqual([]);
  });

  test(`unavailable blocks save and reopen without recording controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mount(page);
    await page.getByRole("button", { name: "Mark unavailable", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Calendar event composer" });
    await dialog.getByLabel("Title", { exact: true }).fill("Unavailable review window");
    await dialog.getByLabel("Starts", { exact: true }).fill("2026-10-30T14:00");
    await dialog.getByLabel("Ends", { exact: true }).fill("2026-10-30T15:00");
    await dialog.getByRole("button", { name: "Save unavailable block", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.writes).toEqual([{ method: "POST", body: {
      operationId: expect.any(String), title: "Unavailable review window", userId: "owner", projectId: null, actionId: null, taskId: null, notes: null, tags: ["unavailable"],
      occurrences: [{ startsAt: "2026-10-30T18:00:00.000Z", endsAt: "2026-10-30T19:00:00.000Z" }],
    } }]);
    await page.getByTestId("calendar-block").first().click();
    const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
    await expect(actions.getByRole("button", { name: /^(Start|Complete)$/ })).toHaveCount(0);
    await actions.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Unavailable", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", { name: "Completed time", exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-30T14:00");
    await expect(dialog.getByRole("button", { name: "Save unavailable block", exact: true })).toBeVisible();
    expect(fixture.timeWrites).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  test(`manager assigns weekly local-clock recurrence across fall-back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mount(page, { now: "2026-10-25T16:00:00.000Z", colleague: true });
    await page.getByRole("button", { name: "Schedule work", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Calendar event composer" });
    await dialog.getByLabel("Title", { exact: true }).fill("Colleague weekly review");
    await expect(dialog.getByRole("combobox", { name: "Assignee", exact: true }).locator('option[value="colleague"]')).toHaveText("Colleague");
    await dialog.getByRole("combobox", { name: "Assignee", exact: true }).selectOption("colleague");
    await dialog.getByLabel("Starts", { exact: true }).fill("2026-10-25T09:00");
    await dialog.getByLabel("Ends", { exact: true }).fill("2026-10-25T10:00");
    await dialog.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("weekly");
    await dialog.getByLabel("Occurrences", { exact: true }).fill("3");
    await dialog.getByLabel("Tags", { exact: true }).fill("review, client");
    await dialog.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.writes).toEqual([{ method: "POST", body: {
      operationId: expect.any(String), title: "Colleague weekly review", userId: "colleague", projectId: null, actionId: null, taskId: null, notes: null, tags: ["review", "client"],
      occurrences: [
        { startsAt: "2026-10-25T13:00:00.000Z", endsAt: "2026-10-25T14:00:00.000Z" },
        { startsAt: "2026-11-01T14:00:00.000Z", endsAt: "2026-11-01T15:00:00.000Z" },
        { startsAt: "2026-11-08T14:00:00.000Z", endsAt: "2026-11-08T15:00:00.000Z" },
      ],
    } }]);
    await page.getByRole("button", { name: "Team", exact: true }).click();
    for (const day of ["2026-10-25", "2026-11-01", "2026-11-08"]) {
      await page.getByLabel("Go to date", { exact: true }).fill(day);
      await page.getByTestId("calendar-block").first().click();
      await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Edit", exact: true }).click();
      await expect(dialog.getByRole("combobox", { name: "Assignee", exact: true })).toHaveValue("colleague");
      await expect(dialog.getByLabel("Starts", { exact: true })).toHaveValue(`${day}T09:00`);
      await expect(dialog.getByLabel("Ends", { exact: true })).toHaveValue(`${day}T10:00`);
      await page.keyboard.press("Escape");
    }
    expect(fixture.errors).toEqual([]);
  });
}

test("composer contains focus, closes with Escape, and returns to its pointer opener", async ({ page }) => {
  const { writes, errors } = await mount(page);
  const opener = page.getByRole("button", { name: "Schedule work", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Calendar event composer" });
  await page.screenshot({ path: path.join(screenshots, "composer-desktop.png") });
  await expect(dialog.getByLabel("Title", { exact: true })).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const close = dialog.getByRole("button", { name: "Close calendar composer" });
  const save = dialog.getByRole("button", { name: "Save scheduled work", exact: true });
  await save.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 1000 }]) {
  test(`last calendar hour is selectable, saved and reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { writes, errors, timeWrites, render } = await mount(page, { blocks: [
      { id: "last-hour-work", title: "Late delivery review", startsAt: "2026-10-31T03:15:00Z", endsAt: "2026-10-31T03:45:00Z" },
    ] });
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    const start = page.getByLabel("Visible start hour", { exact: true });
    const end = page.getByLabel("Visible end hour", { exact: true });
    const lastStart = start.locator('option[value="23"]');
    // This must fail because the real start selector currently omits 23.
    await expect(lastStart).toHaveCount(1);
    await expect(lastStart).toBeDisabled();
    expect(await start.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    ]);
    expect(await end.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
    ]);
    await expect(start).toHaveValue("8");
    await expect(end).toHaveValue("18");
    await expect(start.locator('option[value="17"]')).toBeEnabled();
    await expect(start.locator('option[value="18"]')).toBeDisabled();
    await expect(end.locator('option[value="7"]')).toBeDisabled();
    await expect(end.locator('option[value="8"]')).toBeDisabled();
    await expect(end.locator('option[value="9"]')).toBeEnabled();
    await expect(end.locator('option[value="24"]')).toHaveText("Midnight");
    await start.selectOption("0");
    await end.selectOption("1");
    await expect(start.locator('option[value="0"]')).toBeEnabled();
    await expect(start.locator('option[value="1"]')).toBeDisabled();
    await expect(lastStart).toBeDisabled();
    await end.selectOption("24");
    await expect(lastStart).toBeEnabled();
    await start.selectOption("23");
    await expect(end.locator('option[value="22"]')).toBeDisabled();
    await expect(end.locator('option[value="23"]')).toBeDisabled();
    await expect(end.locator('option[value="24"]')).toBeEnabled();
    await page.getByRole("button", { name: "Save hours", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ method: "PATCH", body: { calendarPreferences: { visibleStartHour: 23, visibleEndHour: 24 } } });
    await page.reload();
    await render();
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    await expect(start).toHaveValue("23");
    await expect(end).toHaveValue("24");
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    for (const view of ["Day", "Week", "Team", "Month"]) {
      const button = page.getByRole("button", { name: view, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      const card = page.locator('[data-calendar-block-id="last-hour-work"]').first();
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport();
      await card.focus();
      await page.keyboard.press("Enter");
      const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
      await expect(actions.getByRole("heading", { name: "Late delivery review", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(actions).toHaveCount(0);
    }
    expect(writes).toHaveLength(1);
    expect(timeWrites).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`composer keeps close and save reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mount(page);
    await page.getByRole("button", { name: "Schedule work", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Calendar event composer" });
    await page.screenshot({ path: path.join(screenshots, `composer-${viewport.width}.png`) });
    for (const name of ["Close calendar composer", "Save scheduled work"]) {
      const bounds = await dialog.getByRole("button", { name, exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    }
    await dialog.getByLabel("Tags", { exact: true }).fill("review");
    await expect(dialog.getByLabel("Tags", { exact: true })).toHaveValue("review");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

const clientBlock: Block = { id: "review", title: "Client review", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T14:00:00.000Z" };

test("event keyboard actions and composer handoff return focus to the original event", async ({ page }) => {
  const { writes } = await mount(page, { blocks: [clientBlock] });
  const card = page.getByTestId("calendar-block");
  await card.focus();
  await page.keyboard.press("Enter");
  const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
  await expect(actions.getByRole("button", { name: "Close scheduled work actions" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(actions).toHaveCount(0);
  await expect(card).toBeFocused();
  await page.keyboard.press("Space");
  await actions.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Calendar event composer" }).getByLabel("Title", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
  expect(writes).toEqual([]);
});

test("drag selection receives keyboard focus and Escape restores its originating slot", async ({ page }) => {
  const { writes } = await mount(page);
  const slot = page.locator("[data-calendar-slot]").first();
  const bounds = await slot.boundingBox();
  await page.mouse.move(bounds!.x + 50, bounds!.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 50, bounds!.y + 100, { steps: 5 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Create calendar work block" });
  await expect(dialog.getByRole("textbox", { name: "Work title" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(slot).toBeFocused();
  expect(writes).toEqual([]);
});

test("month view exposes overflow events as keyboard-operable controls", async ({ page }) => {
  await mount(page, { blocks: Array.from({ length: 5 }, (_, index) => ({ ...clientBlock, id: `event-${index}`, title: `Review ${index + 1}` })) });
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.screenshot({ path: path.join(screenshots, "month-overflow.png") });
  const more = page.getByRole("button", { name: "Show 2 more events on October 30", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.focus();
  await page.keyboard.press("Enter");
  const fifth = page.getByRole("button", { name: /^Review 5 Planned/ });
  await expect(fifth).toBeVisible();
  await fifth.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Scheduled work actions" })).toContainText("Review 5");
  await page.keyboard.press("Escape");
  await expect(fifth).toBeFocused();
  await page.screenshot({ path: path.join(screenshots, "month-expanded.png") });
});

test("all calendar view toggles expose their selected state", async ({ page }) => {
  await mount(page);
  for (const name of ["Day", "Week", "Team", "Month"]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    for (const other of ["Day", "Week", "Team", "Month"].filter((item) => item !== name)) {
      await expect(page.getByRole("button", { name: other, exact: true })).toHaveAttribute("aria-pressed", "false");
    }
  }
});

test("spring-forward missing times cannot be silently saved or selected from the grid", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-03-08T16:00:00.000Z", startHour: 0 });
  await page.getByRole("button", { name: "Schedule work", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await composer.getByLabel("Starts", { exact: true }).fill("2026-03-08T02:30");
  await composer.getByLabel("Ends", { exact: true }).fill("2026-03-08T04:30");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Starts", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(composer).toContainText("This time does not exist because the clocks move forward. Choose another time.");
  await page.screenshot({ path: path.join(screenshots, "spring-gap.png") });
  expect(writes).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /2:00 AM does not occur/ })).toBeDisabled();
});

test("fall-back explains the selected occurrence and preserves an existing later occurrence", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-11-01T17:00:00.000Z", startHour: 0, blocks: [{ id: "fold", title: "Second occurrence review", startsAt: "2026-11-01T06:30:00.000Z", endsAt: "2026-11-01T06:45:00.000Z" }] });
  await page.getByTestId("calendar-block").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Edit", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await expect(composer).toContainText("Second occurrence (UTC-05:00). The saved time is preserved.");
  await composer.getByLabel("Notes", { exact: true }).fill("Reviewed without changing the time.");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  expect(writes[0].body).toMatchObject({ startsAt: "2026-11-01T06:30:00.000Z", endsAt: "2026-11-01T06:45:00.000Z" });
  await page.getByRole("button", { name: "Schedule work", exact: true }).click();
  await composer.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:30");
  await composer.getByLabel("Ends", { exact: true }).fill("2026-11-01T02:30");
  await expect(composer).toContainText("First occurrence (UTC-04:00). New or changed times use the first occurrence.");
  await expect(composer).toContainText("America/New_York");
  await page.screenshot({ path: path.join(screenshots, "fall-fold.png") });
});

test("date navigation jumps directly and keeps previous, next and today in each view", async ({ page }) => {
  const { writes } = await mount(page);
  const date = page.getByLabel("Go to date", { exact: true });
  await date.fill("2028-02-29");
  await expect(page.getByRole("heading", { name: "Tuesday, Feb 29", exact: true })).toBeVisible();
  for (const view of [{ name: "Day", next: "2026-10-31", previous: "2026-10-30" }, { name: "Week", next: "2026-11-06", previous: "2026-10-30" }, { name: "Team", next: "2026-10-31", previous: "2026-10-30" }, { name: "Month", next: "2026-11-01", previous: "2026-10-01" }]) {
    await page.getByRole("button", { name: view.name, exact: true }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "Next period", exact: true }).click();
    await expect(date).toHaveValue(view.next);
    await page.getByRole("button", { name: "Previous period", exact: true }).click();
    await expect(date).toHaveValue(view.previous);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(date).toHaveValue("2026-10-30");
  }
  expect(writes).toEqual([]);
});

test("date navigation rejects a cleared date without corrupting the current view", async ({ page }) => {
  await mount(page);
  const date = page.getByLabel("Go to date", { exact: true });
  await date.fill("");
  await expect(page.getByRole("alert")).toContainText("Choose a valid calendar date.");
  await expect(page.getByRole("heading", { name: "Friday, Oct 30", exact: true })).toBeVisible();
  await date.fill("2026-11-01");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sunday, Nov 1", exact: true })).toBeVisible();
});

test("timezone guidance uses the stable zone rather than today's seasonal abbreviation", async ({ page }) => {
  await mount(page);
  await expect(page.getByTestId("calendar-timezone-cue")).toHaveText("Times shown in browser timezone America/New_York · Account timezone UTC");
  await page.getByLabel("Go to date", { exact: true }).fill("2026-12-15");
  await expect(page.getByTestId("calendar-timezone-cue")).toHaveText("Times shown in browser timezone America/New_York · Account timezone UTC");
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`calendar hours remain within ${viewport.width}px and save through reload`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { writes, render } = await mount(page);
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    for (const control of [page.getByLabel("Visible start hour", { exact: true }), page.getByLabel("Visible end hour", { exact: true }), page.getByRole("button", { name: "Save hours", exact: true })]) {
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      // Reserve room for the hour label and native select arrow, not just its bounds.
      if (await control.evaluate((element) => element.tagName === "SELECT")) expect(box!.width).toBeGreaterThanOrEqual(100);
    }
    await page.getByLabel("Visible start hour", { exact: true }).selectOption("7");
    await page.getByLabel("Visible end hour", { exact: true }).selectOption("20");
    await page.screenshot({ path: path.join(screenshots, `hours-${viewport.width}.png`) });
    await page.getByRole("button", { name: "Save hours", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toEqual({ calendarPreferences: { visibleStartHour: 7, visibleEndHour: 20 } });
    await page.reload();
    await render();
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    await expect(page.getByLabel("Visible start hour", { exact: true })).toHaveValue("7");
    await expect(page.getByLabel("Visible end hour", { exact: true })).toHaveValue("20");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("recorded entries link only to existing review or timer routes for their owner", async ({ page }) => {
  await mount(page, { entries: [
    { id: "own-logged", userId: "owner", taskId: "Reviewed proposal", startedAt: "2026-10-30T13:00:00.000Z", stoppedAt: "2026-10-30T14:00:00.000Z", durationSeconds: 3600, source: "manual" },
    { id: "own-running", userId: "owner", taskId: "Live design", startedAt: "2026-10-30T14:00:00.000Z", stoppedAt: null, durationSeconds: null, source: "web" },
    { id: "other-logged", userId: "colleague", taskId: "Other review", startedAt: "2026-10-30T13:00:00.000Z", stoppedAt: "2026-10-30T14:00:00.000Z", durationSeconds: 3600, source: "manual" },
  ] });
  const review = page.getByRole("link", { name: "Review Reviewed proposal in Activity", exact: true });
  await expect(review).toHaveAttribute("href", "/activity");
  await review.focus();
  await expect(review).toBeFocused();
  await expect(page.getByRole("link", { name: "Go to timer for Live design", exact: true })).toHaveAttribute("href", "/dashboard");
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(page.getByText("Other review", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Other review/ })).toHaveCount(0);
});

test("populated week cards keep full-width titles and unclipped short-event time", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const examples: Block[] = [
    { id: "week-review", title: "Client launch review", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T14:00:00.000Z" },
    { id: "week-unavailable", title: "Unavailable", tags: ["unavailable"], startsAt: "2026-10-30T14:30:00.000Z", endsAt: "2026-10-30T15:00:00.000Z" },
    { id: "week-handoff", title: "Quick handoff", startsAt: "2026-10-30T15:30:00.000Z", endsAt: "2026-10-30T15:45:00.000Z" },
  ];
  const { writes } = await mount(page, { now: "2026-10-30T17:00:00.000Z", blocks: examples });
  // Match the actual app's 288px desktop sidebar and 32px page padding.
  await page.locator("main").evaluate((element) => { element.style.marginLeft = "288px"; element.style.padding = "32px"; });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.screenshot({ path: path.join(screenshots, "populated-week-1440.png"), animations: "disabled" });
  for (const example of examples) {
    const card = page.locator(`[data-calendar-block-id="${example.id}"]`);
    const cardBounds = (await card.boundingBox())!;
    const title = card.getByText(example.title, { exact: true });
    const titleBounds = (await title.boundingBox())!;
    expect(titleBounds.width).toBeGreaterThanOrEqual(cardBounds.width * 0.75);
    expect(titleBounds.y + titleBounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height);
    if (cardBounds.height >= 34) {
      const timeBounds = (await card.locator("p").nth(1).boundingBox())!;
      expect(timeBounds.y + timeBounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height);
    } else {
      await expect(card.locator("p")).toHaveCount(1);
      await expect(card).toHaveAttribute("title", /11:30 AM to 11:45 AM/);
    }
    if (!example.tags) {
      const dragBounds = (await card.getByRole("button", { name: `Drag to reschedule ${example.title}`, exact: true }).boundingBox())!;
      if (cardBounds.height >= 34) expect(dragBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height);
      else {
        const reservedWidth = await title.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight));
        expect(dragBounds.x).toBeGreaterThanOrEqual(titleBounds.x + titleBounds.width - reservedWidth);
      }
    }
    await expect(card).toHaveAttribute("aria-label", new RegExp(example.title));
    await card.focus();
    await page.keyboard.press("Enter");
    const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
    await expect(actions.getByRole("heading", { name: example.title, exact: true })).toBeVisible();
    for (const name of example.tags ? ["Duplicate", "Edit", "Cancel"] : ["Start", "Complete", "Duplicate", "Next slot", "Edit", "Skip", "Cancel"]) await expect(actions.getByRole("button", { name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeFocused();
    if (!example.tags) {
      for (const name of [`Drag to reschedule ${example.title}`, `Resize start for ${example.title}`, `Resize end for ${example.title}`]) await expect(card.getByRole("button", { name, exact: true })).toBeVisible();
    }
  }
  expect(writes).toEqual([]);
});

test("compact week cards retain drag and end-resize controls", async ({ page }) => {
  const { writes } = await mount(page, { now: "2026-10-30T17:00:00.000Z", blocks: [{ id: "short-review", title: "Quick review", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T13:15:00.000Z" }] });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const card = page.locator('[data-calendar-block-id="short-review"]');
  const drag = (await card.getByRole("button", { name: "Drag to reschedule Quick review", exact: true }).boundingBox())!;
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await page.mouse.down();
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2 + 72, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("dialog", { name: "Move scheduled work", exact: true }).getByRole("button", { name: "Move block", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T14:15:00.000Z" });
  await expect(card).toHaveCSS("top", "144px");
  const resize = (await card.getByRole("button", { name: "Resize end for Quick review", exact: true }).boundingBox())!;
  const lane = (await page.locator('[data-day-column][data-day-key="2026-10-30"]').boundingBox())!;
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2, lane.y + 216, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("dialog", { name: "Resize scheduled work", exact: true }).getByRole("button", { name: "Resize block", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toMatchObject({ startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T15:00:00.000Z" });
  await expect(card).toHaveCSS("height", "72px");
});

test("short recorded overlays keep title, time and review link within their bounds", async ({ page }) => {
  await mount(page, { entries: [
    { id: "recorded-15", userId: "owner", taskId: "Brief client review", startedAt: "2026-10-30T13:00:00.000Z", stoppedAt: "2026-10-30T13:15:00.000Z", durationSeconds: 900, source: "manual" },
    { id: "recorded-30", userId: "owner", taskId: "Proposal handoff", startedAt: "2026-10-30T14:00:00.000Z", stoppedAt: "2026-10-30T14:30:00.000Z", durationSeconds: 1800, source: "manual" },
  ] });
  for (const view of ["Week", "Day"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.screenshot({ path: path.join(screenshots, `short-recorded-${view.toLowerCase()}.png`), animations: "disabled" });
    for (const title of ["Brief client review", "Proposal handoff"]) {
      const link = page.getByRole("link", { name: `Review ${title} in Activity`, exact: true });
      const card = page.locator("article").filter({ has: link });
      const bounds = (await card.boundingBox())!;
      await expect(link).toHaveAttribute("href", "/activity");
      await expect(card.locator("p")).toHaveCount(bounds.height < 34 ? 1 : 2);
      await expect(link).toHaveAccessibleDescription(title === "Brief client review" ? "9:00 AM to 9:15 AM" : "10:00 AM to 10:30 AM");
      for (const paragraph of await card.locator("p").all()) {
        const textBounds = (await paragraph.boundingBox())!;
        expect(textBounds.y).toBeGreaterThanOrEqual(bounds.y);
        expect(textBounds.y + textBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
      await link.focus();
      await expect(link).toBeFocused();
    }
  }
});

test("adjacent short planned and recorded events keep exact time placement without hiding the next title", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes } = await mount(page, { blocks: [
    { id: "adjacent-plan", title: "Quick handoff", startsAt: "2026-10-30T12:15:00.000Z", endsAt: "2026-10-30T12:30:00.000Z" },
    { id: "next-plan", title: "Client delivery review", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T14:00:00.000Z" },
    { id: "recorded-plan", title: "Completed review", status: "completed", linkedTimeEntryId: "linked-recorded", startsAt: "2026-10-30T16:00:00.000Z", endsAt: "2026-10-30T17:00:00.000Z" },
  ], entries: [
    { id: "adjacent-recorded", userId: "owner", taskId: "Review notes", startedAt: "2026-10-30T12:30:00.000Z", stoppedAt: "2026-10-30T12:45:00.000Z", durationSeconds: 900, source: "manual" },
    { id: "later-recorded", userId: "owner", taskId: "Delivery wrap-up", startedAt: "2026-10-30T14:30:00.000Z", stoppedAt: "2026-10-30T15:30:00.000Z", durationSeconds: 3600, source: "manual" },
    { id: "linked-recorded", userId: "owner", taskId: "Completed review", scheduledBlockId: "recorded-plan", startedAt: "2026-10-30T16:00:00.000Z", stoppedAt: "2026-10-30T17:00:00.000Z", durationSeconds: 3600, source: "manual" },
  ] });
  await page.locator("main").evaluate((element) => { element.style.marginLeft = "288px"; element.style.padding = "32px"; });
  for (const view of ["Week", "Day", "Team"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    const plan = page.locator('[data-calendar-block-id="adjacent-plan"]');
    const next = page.locator('[data-calendar-block-id="next-plan"]');
    const recordedLink = page.getByRole("link", { name: "Review Review notes in Activity", exact: true });
    const recorded = page.locator("article").filter({ has: recordedLink });
    const later = page.locator("article").filter({ has: page.getByRole("link", { name: "Review Delivery wrap-up in Activity", exact: true }) });
    await page.screenshot({ path: path.join(screenshots, `adjacent-events-${view.toLowerCase()}.png`), animations: "disabled" });
    for (const [card, top, height] of [[plan, "18px", "18px"], [recorded, "36px", "18px"], [next, "72px", "72px"], [later, "180px", "72px"]] as const) {
      await expect(card).toHaveCSS("top", top);
      await expect(card).toHaveCSS("height", height);
    }
    const planBounds = (await plan.boundingBox())!;
    const recordedBounds = (await recorded.boundingBox())!;
    const nextBounds = (await next.boundingBox())!;
    expect(planBounds.y + planBounds.height).toBeLessThanOrEqual(recordedBounds.y);
    expect(recordedBounds.y + recordedBounds.height).toBeLessThanOrEqual(nextBounds.y);
    const title = next.getByText("Client delivery review", { exact: true });
    const titleBounds = (await title.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-calendar-block-id]")?.getAttribute("data-calendar-block-id"), { x: titleBounds.x + titleBounds.width / 2, y: titleBounds.y + titleBounds.height / 2 })).toBe("next-plan");
    await expect(plan).toHaveAttribute("aria-label", /8:15 AM to 8:30 AM/);
    await expect(recordedLink).toHaveAttribute("title", /8:30.*8:45/);
    await expect(recordedLink).toHaveAccessibleDescription("8:30 AM to 8:45 AM");
    await plan.focus();
    await page.keyboard.press("Enter");
    const actions = page.getByRole("dialog", { name: "Scheduled work actions", exact: true });
    await expect(actions.getByRole("heading", { name: "Quick handoff", exact: true })).toBeVisible();
    await expect(actions).toContainText("8:15 AM");
    await expect(actions.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    // The completed plan keeps its keyboard actions beside the recorded entry.
    const completedPlan = page.locator('[data-calendar-block-id="recorded-plan"]');
    await completedPlan.focus();
    await page.keyboard.press("Enter");
    await expect(actions.getByRole("heading", { name: "Completed review", exact: true })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Review in Activity", exact: true })).toHaveAttribute("href", "/activity");
    await page.keyboard.press("Escape");
    await expect(completedPlan).toBeFocused();
  }
  expect(writes).toEqual([]);
});

for (const scenario of [
  { name: "live overlap", planStart: "2026-10-30T15:00:00.000Z", planEnd: "2026-10-30T16:00:00.000Z", entryStart: "2026-10-30T13:00:00.000Z", entryEnd: null, duration: null, link: "Go to timer for Recorded work" },
  { name: "minimum marker adjacency", planStart: "2026-10-30T13:00:00.000Z", planEnd: "2026-10-30T14:00:00.000Z", entryStart: "2026-10-30T12:58:00.000Z", entryEnd: "2026-10-30T12:59:00.000Z", duration: 60, link: "Review Recorded work in Activity" },
]) {
  test(`${scenario.name} keeps planned and recorded titles independently clickable`, async ({ page }) => {
    await mount(page, { blocks: [{ id: "overlap-plan", title: "Client meeting", startsAt: scenario.planStart, endsAt: scenario.planEnd }], entries: [{ id: "overlap-entry", userId: "owner", taskId: "Recorded work", startedAt: scenario.entryStart, stoppedAt: scenario.entryEnd, durationSeconds: scenario.duration, source: "web" }] });
    for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const view of ["Day", "Week"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const plan = page.getByTestId("calendar-block");
      const link = page.getByRole("link", { name: scenario.link, exact: true });
      const recorded = page.locator("article").filter({ has: link });
      const planBox = (await plan.boundingBox())!;
      const recordedBox = (await recorded.boundingBox())!;
      expect(planBox.x + planBox.width <= recordedBox.x || recordedBox.x + recordedBox.width <= planBox.x).toBe(true);
      // Earlier painted intervals receive the first column regardless of kind.
      expect(recordedBox.x).toBeLessThan(planBox.x);
      const planTitle = plan.getByText("Client meeting", { exact: true });
      expect((await planTitle.boundingBox())!.width).toBeGreaterThanOrEqual(planBox.width * 0.7);
      for (const target of [plan.getByText("Client meeting", { exact: true }), link.getByText("Recorded work", { exact: true })]) {
        await target.scrollIntoViewIfNeeded();
        const bounds = (await target.boundingBox())!;
        expect(await target.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })).toBe(true);
      }
      await plan.getByText("Client meeting", { exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Scheduled work actions", exact: true }).getByRole("heading", { name: "Client meeting", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await link.click({ trial: true });
      await page.screenshot({ path: path.join(screenshots, `${scenario.name.replaceAll(" ", "-")}-${view.toLowerCase()}-${width}.png`), animations: "disabled" });
    }
    }
  });
}

for (const startHour of [0, 1]) {
test(`fall-back equal and reversed clock spans stay readable with explicit offset guidance from ${startHour}h`, async ({ page }) => {
  await mount(page, { now: "2026-11-01T17:00:00.000Z", startHour, blocks: [{ id: "fold-marker", title: "Clock-change handoff", startsAt: "2026-11-01T05:45:00.000Z", endsAt: "2026-11-01T06:00:00.000Z" }], entries: [{ id: "fold-recorded", userId: "owner", taskId: "Clock-change review", startedAt: "2026-11-01T05:30:00.000Z", stoppedAt: "2026-11-01T06:30:00.000Z", durationSeconds: 3600, source: "manual" }] });
  const plan = page.getByTestId("calendar-block");
  const link = page.getByRole("link", { name: "Review Clock-change review in Activity", exact: true });
  await expect(plan).toHaveCSS("height", "18px");
  await expect(page.locator("article").filter({ has: link })).toHaveCSS("height", "18px");
  await expect(link).toBeVisible();
  await expect(plan).toHaveAccessibleDescription(/UTC-04:00.*UTC-05:00.*15 minutes.*marker/);
  await expect(link).toHaveAccessibleDescription(/UTC-04:00.*UTC-05:00.*60 minutes.*marker/);
  await expect(link).toHaveAttribute("title", /UTC-04:00.*UTC-05:00.*60 minutes/);
  await plan.getByText("Clock-change handoff", { exact: true }).click();
  const actions = page.getByRole("dialog", { name: "Scheduled work actions", exact: true });
  await expect(actions).toContainText("UTC-04:00");
  await expect(actions).toContainText("UTC-05:00");
  await expect(actions).toContainText("15 minutes");
  await expect(actions).toContainText("marker");
  await page.keyboard.press("Escape");
  await link.click({ trial: true });
  await page.screenshot({ path: path.join(screenshots, `fall-back-markers-${startHour}h.png`), animations: "disabled" });
});
}

test("a just-started timer remains a reachable marker", async ({ page }) => {
  await mount(page, { now: "2026-10-30T12:00:10.000Z", entries: [{ id: "recent", userId: "owner", taskId: "New live timer", startedAt: "2026-10-30T12:00:05.000Z", stoppedAt: null, durationSeconds: null, source: "web" }] });
  const link = page.getByRole("link", { name: "Go to timer for New live timer", exact: true });
  await expect(page.locator("article").filter({ has: link })).toHaveCSS("height", "18px");
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleDescription(/marker/);
  await link.click({ trial: true });
  await link.focus();
  await expect(link).toBeFocused();
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`previous, today and next stay together at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mount(page);
    if (viewport.width === 1440) await page.locator("main").evaluate((element) => { element.style.marginLeft = "288px"; element.style.padding = "32px"; });
    for (const expandedHours of [false, true]) {
      if (expandedHours) await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
      const previous = (await page.getByRole("button", { name: "Previous period", exact: true }).boundingBox())!;
      const today = (await page.getByRole("button", { name: "Today", exact: true }).boundingBox())!;
      const next = (await page.getByRole("button", { name: "Next period", exact: true }).boundingBox())!;
      expect(Math.abs(previous.y - today.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(previous.y - next.y)).toBeLessThanOrEqual(1);
      expect(previous.x + previous.width).toBeLessThanOrEqual(today.x);
      expect(today.x + today.width).toBeLessThanOrEqual(next.x);
      expect(previous.x).toBeGreaterThanOrEqual(0);
      expect(next.x + next.width).toBeLessThanOrEqual(viewport.width);
      await expect(page.getByRole("group", { name: "Calendar navigation", exact: true })).toContainText("Today");
      await page.screenshot({ path: path.join(screenshots, `navigation-${viewport.width}-${expandedHours ? "expanded" : "collapsed"}.png`), animations: "disabled" });
    }
  });
}

const overlapScenarios = [
  { name: "two planned", plans: [[0, 60], [0, 60]], recorded: [] },
  { name: "two recorded", plans: [], recorded: [[0, 60], [0, 60]] },
  { name: "four mixed", plans: [[0, 60], [0, 60]], recorded: [[0, 60], [0, 60]] },
  { name: "chained", plans: [[0, 30], [20, 50], [40, 70]], recorded: [] },
  { name: "adjacent quarter hours", plans: [[0, 15], [15, 30]], recorded: [[30, 45], [45, 60]] },
  { name: "same-type minimum markers", plans: [[0, 1], [2, 3]], recorded: [[30, 31], [32, 33]] },
];

for (const scenario of overlapScenarios) {
  test(`packed overlap ${scenario.name} keeps every title and action pointer reachable`, async ({ page }) => {
    test.setTimeout(90_000);
    const instant = (minute: number) => new Date(Date.parse("2026-10-30T13:00:00Z") + minute * 60_000).toISOString();
    const { writes, errors } = await mount(page, {
      blocks: scenario.plans.map(([start, end], index) => ({ id: `item-${index}`, title: `Planned client delivery ${index}`, startsAt: instant(start), endsAt: instant(end) })),
      entries: [
        ...scenario.recorded.map(([start, end], index): Entry => ({ id: `item-${index}`, userId: "owner", taskId: `Recorded client delivery ${index}`, startedAt: instant(start), stoppedAt: instant(end), durationSeconds: (end - start) * 60, source: "manual" })),
        ...(scenario.name === "four mixed" ? [{ id: "colleague-entry", userId: "colleague", taskId: "Colleague delivery", startedAt: instant(0), stoppedAt: instant(60), durationSeconds: 3600, source: "manual" as const }] : []),
      ],
    });
    for (const width of [1280, 1440, 320, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("main").evaluate((element, desktop) => { element.style.marginLeft = desktop ? "288px" : "0"; element.style.padding = desktop ? "32px" : "16px"; }, width >= 1280);
      for (const view of ["Day", "Week", "Team"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        const cards = page.locator("[data-day-column] article");
        // Check the actual painted title point before any geometry assertions:
        // stacked same-type cards used to intercept this pointer.
        for (const card of await cards.all()) {
          const title = card.locator("p").first();
          await title.scrollIntoViewIfNeeded();
          // A full-width Team card can exceed the phone viewport. Hit the
          // center of its visible title portion, not an offscreen midpoint.
          const hit = await title.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const scroll = element.closest('[data-testid="calendar-scroll-area"]')!.getBoundingClientRect();
            const x = (Math.max(bounds.left, scroll.left, 0) + Math.min(bounds.right, scroll.right, window.innerWidth)) / 2;
            const y = (Math.max(bounds.top, scroll.top, 0) + Math.min(bounds.bottom, scroll.bottom, window.innerHeight)) / 2;
            const target = document.elementFromPoint(x, y);
            return { reachable: element.contains(target), target: target?.outerHTML };
          });
          expect(hit.reachable, `${view} ${width}px: ${await title.textContent()} hit ${hit.target}`).toBe(true);
          const fullTitle = await title.textContent();
          await expect(card).toHaveAttribute("title", new RegExp(fullTitle!));
          if (await card.getAttribute("data-calendar-block-id")) {
            await expect(card).toHaveAttribute("aria-label", /AM to/);
            await title.click();
            const actions = page.getByRole("dialog", { name: "Scheduled work actions", exact: true });
            await expect(actions.getByRole("heading", { name: fullTitle!, exact: true })).toBeVisible();
            await expect(actions.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
            await page.keyboard.press("Escape");
            for (const button of await card.getByRole("button").all()) await button.click({ trial: true });
          } else if (await card.getByRole("link").count()) {
            const link = card.getByRole("link");
            await expect(link).toHaveAttribute("href", "/activity");
            await expect(link).toHaveAccessibleDescription(/AM to/);
            await link.click({ trial: true });
            await link.focus();
            await expect(link).toBeFocused();
          } else {
            await expect(card).toHaveAccessibleDescription(/AM to/);
            await expect(card.getByRole("link")).toHaveCount(0);
          }
        }
        const boxes = await cards.evaluateAll((elements) => elements.map((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
        for (let i = 0; i < boxes.length; i++) {
          expect(boxes[i].width).toBeGreaterThanOrEqual(80);
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            expect(a.x + a.width <= b.x + 0.01 || b.x + b.width <= a.x + 0.01 || a.y + a.height <= b.y + 0.01 || b.y + b.height <= a.y + 0.01).toBe(true);
          }
        }
        const scroll = page.getByTestId("calendar-scroll-area");
        const alignment = await scroll.evaluate((element) => {
          const headers = [...element.querySelectorAll(":scope > div > div:first-child > div")].slice(1);
          return [...element.querySelectorAll("[data-day-column]")].map((column, index) => ({ header: headers[index].getBoundingClientRect().x, body: column.getBoundingClientRect().x, headerWidth: headers[index].getBoundingClientRect().width, bodyWidth: column.getBoundingClientRect().width }));
        });
        for (const lane of alignment) {
          expect(Math.abs(lane.header - lane.body)).toBeLessThanOrEqual(0.01);
          expect(Math.abs(lane.headerWidth - lane.bodyWidth)).toBeLessThanOrEqual(0.01);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (scenario.name === "four mixed" && (width < 600 || view === "Week")) expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        if (scenario.name === "four mixed") {
          if (view === "Team") await expect(page.locator("[data-day-column]")).toHaveCount(2);
          await page.screenshot({ path: path.join(screenshots, `packed-mixed-${view.toLowerCase()}-${width}.png`), animations: "disabled" });
        }
      }
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("single-event Day stays full width without horizontal scrolling on phones", async ({ page }) => {
  await mount(page, { blocks: [clientBlock] });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const lane = (await page.locator("[data-day-column]").boundingBox())!;
    const card = (await page.getByTestId("calendar-block").boundingBox())!;
    expect(lane.width - card.width).toBeLessThanOrEqual(9);
    expect(await page.getByTestId("calendar-scroll-area").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

for (const duration of [15, 30]) {
  test(`compact handle movement preserves a one-hour pointer displacement for ${duration}-minute work`, async ({ page }) => {
    const { writes } = await mount(page, { blocks: [{ ...clientBlock, endsAt: `2026-10-30T13:${duration}:00.000Z` }] });
    await page.getByRole("button", { name: "Week", exact: true }).click();
    const card = page.locator('[data-calendar-block-id="review"]');
    for (const confirm of [false, true]) {
      await card.scrollIntoViewIfNeeded();
      const handle = (await card.getByRole("button", { name: "Drag to reschedule Client review", exact: true }).boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 72, { steps: 4 });
      await page.mouse.up();
      const dialog = page.getByRole("dialog", { name: "Move scheduled work", exact: true });
      await expect(dialog).toBeVisible();
      expect(writes).toEqual([]);
      if (!confirm) {
        await page.keyboard.press("Escape");
        await expect(card).toHaveCSS("top", "72px");
      } else {
        await dialog.getByRole("button", { name: "Move block", exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0].body).toMatchObject({ startsAt: "2026-10-30T14:00:00.000Z", endsAt: `2026-10-30T14:${duration}:00.000Z` });
      }
    }
  });
}

test("packed short cards preserve actual resize, drag and keyboard rescheduling", async ({ page }) => {
  const { writes } = await mount(page, { blocks: [
    { ...clientBlock, endsAt: "2026-10-30T13:15:00.000Z" },
    { ...clientBlock, id: "neighbor", title: "Neighbor work", endsAt: "2026-10-30T13:15:00.000Z" },
  ] });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const card = page.locator('[data-calendar-block-id="review"]');
  await card.scrollIntoViewIfNeeded();
  const lane = (await page.locator('[data-day-column][data-day-key="2026-10-30"]').boundingBox())!;
  const resize = (await card.getByRole("button", { name: "Resize end for Client review", exact: true }).boundingBox())!;
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2, lane.y + 108, { steps: 4 });
  await page.mouse.up();
  const resizeDialog = page.getByRole("dialog", { name: "Resize scheduled work", exact: true });
  await expect(resizeDialog).toBeVisible();
  expect(writes).toEqual([]);
  await resizeDialog.getByRole("button", { name: "Resize block", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T13:30:00.000Z" });
  const drag = (await card.getByRole("button", { name: "Drag to reschedule Client review", exact: true }).boundingBox())!;
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await page.mouse.down();
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2 + 72, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("dialog", { name: "Move scheduled work", exact: true }).getByRole("button", { name: "Move block", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toMatchObject({ startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T14:30:00.000Z" });
  await card.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].body).toMatchObject({ startsAt: "2026-10-30T14:15:00.000Z", endsAt: "2026-10-30T14:45:00.000Z" });
});

test.afterAll(() => console.log(`Calendar accessibility screenshots: ${screenshots}`));

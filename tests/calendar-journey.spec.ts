import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { memberships, scheduledWorkBlocks, timeEntries, users, workspaces } from "../lib/db/schema";

test.use({ timezoneId: "America/New_York" });
type Block = { id: string; title: string; status: string; notes: string | null; linkedTimeEntryId: string | null };

async function blocks(page: Page): Promise<Block[]> {
  const response = await page.request.get("/api/schedule");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).blocks;
}

async function openActions(page: Page, id: string) {
  const card = page.locator(`[data-calendar-block-id="${id}"]`).first();
  await card.focus();
  await page.keyboard.press("Enter");
  return page.getByRole("dialog", { name: "Scheduled work actions" });
}

test("last calendar hour persists literal 23/24 in authenticated settings", async ({ page }) => {
  expect(process.env.SOWLEDGER_TEST_DATABASE, "Root-owned disposable database required").toBe("true");
  await page.clock.setFixedTime(new Date("2026-10-30T16:00:00.000Z"));
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const slug = `calendar-last-hour-${crypto.randomUUID()}`;
  const email = `${slug}@example.com`;
  let state: { workspaceId: string; userId: string } | undefined;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const login = await page.request.get(`/api/test/login?${new URLSearchParams({ workspace: slug, email, plan: "smb" })}`);
    expect(login.status()).toBe(200);
    state = await login.json();
    await page.goto("/calendar");
    await expect(page.getByText("Loading calendar...", { exact: true })).toHaveCount(0);
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    await page.getByLabel("Visible end hour", { exact: true }).selectOption("24");
    await page.getByLabel("Visible start hour", { exact: true }).selectOption("23");
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/user/settings" && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save hours", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON()).toEqual({ calendarPreferences: { visibleStartHour: 23, visibleEndHour: 24 } });
    expect(await saved.json()).toMatchObject({ ok: true, user: { id: state!.userId, calendarPreferences: { visibleStartHour: 23, visibleEndHour: 24 } } });
    const persisted = await page.request.get("/api/user/settings");
    expect(persisted.status()).toBe(200);
    const settings = await persisted.json();
    expect(settings.user.id).toBe(state!.userId);
    expect(settings.user.calendarPreferences).toEqual({ visibleStartHour: 23, visibleEndHour: 24 });
    await page.reload();
    await expect(page.getByText("Loading calendar...", { exact: true })).toHaveCount(0);
    await page.locator("summary").filter({ hasText: "Calendar hours" }).click();
    await expect(page.getByLabel("Visible start hour", { exact: true })).toHaveValue("23");
    await expect(page.getByLabel("Visible end hour", { exact: true })).toHaveValue("24");
    const afterReload = await page.request.get("/api/user/settings");
    expect(afterReload.status()).toBe(200);
    expect((await afterReload.json()).user.calendarPreferences).toEqual({ visibleStartHour: 23, visibleEndHour: 24 });
    expect(errors).toEqual([]);
  } finally {
    if (state) {
      await db.delete(workspaces).where(and(eq(workspaces.id, state.workspaceId), eq(workspaces.slug, slug)));
      await db.delete(users).where(and(eq(users.id, state.userId), eq(users.email, email)));
    }
  }
});

test("calendar notifications can be dismissed without blocking phone controls", async ({ page }) => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Never create calendar journey fixtures in production.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-10-30T16:00:00.000Z"));
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const workspace = `calendar-toast-${crypto.randomUUID()}`;
  expect((await page.request.get(`/api/test/login?${new URLSearchParams({ workspace, plan: "smb", email: `${workspace}@example.com` })}`)).ok()).toBeTruthy();
  const created = await page.request.post("/api/schedule", { data: { title: "Dismissible calendar notice", startsAt: "2026-10-30T13:00:00Z", endsAt: "2026-10-30T14:00:00Z" } });
  expect(created.ok()).toBeTruthy();
  const block = (await created.json()).block;
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await (await openActions(page, block.id)).getByRole("button", { name: "Skip", exact: true }).click();
  const notification = page.locator("[data-sonner-toast]").filter({ hasText: "Scheduled work skipped" });
  await expect(notification).toBeVisible();
  // Hover keeps this notification open, reproducing an overlay that previously
  // blocked a following calendar action indefinitely without a close control.
  await notification.hover();
  const close = notification.getByRole("button", { name: "Dismiss notification", exact: true });
  await expect(close).toBeVisible();
  const bounds = (await close.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(28);
  expect(bounds.height).toBeGreaterThanOrEqual(28);
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(notification).toHaveCount(0);
  await expect((await openActions(page, block.id)).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
});

for (const width of [1280, 390]) test(`calendar controls and plan-to-record journey persist at ${width}px`, async ({ page }) => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Never create calendar journey fixtures in production.");
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-30T16:00:00.000Z"));
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const workspace = `calendar-journey-${crypto.randomUUID()}`;
  expect((await page.request.get(`/api/test/login?${new URLSearchParams({ workspace, plan: "smb", email: `${workspace}@example.com` })}`)).ok()).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/calendar");
  await expect(page.getByText("Loading calendar...", { exact: true })).toHaveCount(0);

  for (const mode of ["Day", "Week", "Team", "Month"]) {
    const button = page.getByRole("button", { name: mode, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    const heading = page.getByRole("main").getByRole("heading", { level: 2 }).first();
    const today = await heading.innerText();
    await page.getByRole("button", { name: "Next period" }).click();
    await expect(heading).not.toHaveText(today);
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(heading).toHaveText(today);
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(heading).not.toHaveText(today);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(heading).toHaveText(today);
  }

  await page.getByText("Calendar hours", { exact: true }).click();
  await page.getByLabel("Visible start hour").selectOption("7");
  await page.getByLabel("Visible end hour").selectOption("19");
  const hoursSaved = page.waitForResponse(response => response.url().endsWith("/api/user/settings") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save hours", exact: true }).click();
  expect((await hoursSaved).ok()).toBeTruthy();
  await page.reload();
  await page.getByText("Calendar hours", { exact: true }).click();
  await expect(page.getByLabel("Visible start hour")).toHaveValue("7");
  await expect(page.getByLabel("Visible end hour")).toHaveValue("19");
  await page.getByText("Calendar hours", { exact: true }).click();

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.getByRole("button", { name: "Schedule work", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await composer.getByLabel("Title", { exact: true }).fill("Client delivery review");
  await composer.getByLabel("Starts", { exact: true }).fill("2026-10-30T09:00");
  await composer.getByLabel("Ends", { exact: true }).fill("2026-10-30T10:00");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(composer).toHaveCount(0);
  const original = (await blocks(page)).find(block => block.title === "Client delivery review")!;
  expect(original).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await (await openActions(page, original.id)).getByRole("button", { name: "Edit", exact: true }).click();
  await composer.getByLabel("Notes", { exact: true }).fill("Ready for client handoff");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect((await blocks(page)).find(block => block.id === original.id)?.notes).toBe("Ready for client handoff");

  await (await openActions(page, original.id)).getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect.poll(async () => (await blocks(page)).length).toBe(2);
  const copy = (await blocks(page)).find(block => block.id !== original.id)!;
  await (await openActions(page, copy.id)).getByRole("button", { name: "Skip", exact: true }).click();
  await expect.poll(async () => (await blocks(page)).find(block => block.id === copy.id)?.status).toBe("skipped");
  await (await openActions(page, copy.id)).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(async () => (await blocks(page)).find(block => block.id === copy.id)?.status).toBe("canceled");

  await (await openActions(page, original.id)).getByRole("button", { name: "Complete", exact: true }).click();
  await composer.getByRole("button", { name: "Log completed work", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect.poll(async () => (await blocks(page)).find(block => block.id === original.id)?.status).toBe("completed");
  const completed = (await blocks(page)).find(block => block.id === original.id)!;
  expect(completed.linkedTimeEntryId).toBeTruthy();
  // Dismiss the feedback before opening a new action panel on small screens.
  const notices = page.locator("[data-sonner-toast]");
  while (await notices.count()) {
    const count = await notices.count();
    await notices.first().getByRole("button", { name: "Dismiss notification", exact: true }).click();
    await expect.poll(() => notices.count()).toBeLessThan(count);
  }
  const actions = await openActions(page, original.id);
  await expect(actions.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
  await actions.getByRole("link", { name: "Review in Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole("button", { name: "Correct time entry Ready for client handoff", exact: true })).toBeVisible();
  const exported = await page.request.get("/api/export/csv?format=json&include=timeEntries");
  expect(exported.headers()["x-sowledger-export-sha256"]).toMatch(/^[a-f0-9]{64}$/);
  expect((await exported.json()).timeEntries).toEqual(expect.arrayContaining([expect.objectContaining({ id: completed.linkedTimeEntryId, taskId: "Client delivery review", description: "Ready for client handoff", durationSeconds: 3600, source: "calendar" })]));
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test(`Next slot, unavailable and assigned weekly calendar controls persist at ${width}px`, async ({ page }) => {
  expect(process.env.SOWLEDGER_TEST_DATABASE, "Root-owned disposable database required").toBe("true");
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-25T16:00:00.000Z"));
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const slug = `calendar-positive-${crypto.randomUUID()}`; const email = `${slug}@example.com`;
  const colleagueId = crypto.randomUUID(); const colleagueEmail = `calendar-colleague-${colleagueId}@example.com`;
  let state: { workspaceId: string; userId: string } | undefined;
  const errors: string[] = []; const timeWrites: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/timer/") && request.method() !== "GET") timeWrites.push(new URL(request.url()).pathname); });
  try {
    const login = await page.request.get(`/api/test/login?${new URLSearchParams({ workspace: slug, email, plan: "smb" })}`);
    expect(login.status()).toBe(200); state = await login.json();
    await db.insert(users).values({ id: colleagueId, email: colleagueEmail, displayName: "Synthetic calendar colleague" });
    await db.insert(memberships).values({ workspaceId: state!.workspaceId, userId: colleagueId, role: "member" });
    const moveId = crypto.randomUUID();
    const busyId = crypto.randomUUID();
    await db.insert(scheduledWorkBlocks).values([
      { id: moveId, workspaceId: state!.workspaceId, userId: state!.userId, createdByUserId: state!.userId, title: "Move owner review", startsAt: new Date("2026-10-25T13:00:00Z"), endsAt: new Date("2026-10-25T14:00:00Z") },
      { id: busyId, workspaceId: state!.workspaceId, userId: state!.userId, createdByUserId: state!.userId, title: "Owner busy interval", tags: ["unavailable"], startsAt: new Date("2026-10-25T14:00:00Z"), endsAt: new Date("2026-10-25T15:30:00Z") },
    ]);
    const rows = () => db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.workspaceId, state!.workspaceId));
    const safeRows = async () => {
      const response = await page.request.get("/api/schedule?scope=team"); expect(response.status()).toBe(200);
      return (await response.json()).blocks as Array<{ id: string; userId: string; startsAt: string; endsAt: string; tags: string[]; linkedTimeEntryId: string | null }>;
    };
    const navigate = async (day = "2026-10-25", view = "Day") => {
      await page.getByRole("button", { name: view, exact: true }).click();
      await page.getByLabel("Go to date", { exact: true }).fill(day);
      await expect(page.getByLabel("Go to date", { exact: true })).toHaveValue(day);
    };
    const dismissNotices = async () => {
      const notices = page.locator("[data-sonner-toast]");
      while (await notices.count()) {
        const count = await notices.count();
        await notices.first().getByRole("button", { name: "Dismiss notification", exact: true }).click();
        await expect.poll(() => notices.count()).toBeLessThan(count);
      }
    };
    await page.goto("/calendar"); await navigate();
    const movedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/schedule" && response.request().method() === "PATCH");
    await (await openActions(page, moveId)).getByRole("button", { name: "Next slot", exact: true }).click();
    const moved = await movedResponse;
    expect(moved.status()).toBe(200);
    expect(moved.request().postDataJSON()).toEqual({ blockId: moveId, startsAt: "2026-10-25T15:30:00.000Z", endsAt: "2026-10-25T16:30:00.000Z" });
    expect(await moved.json()).toMatchObject({ ok: true, block: { id: moveId, userId: state!.userId, startsAt: "2026-10-25T15:30:00.000Z", endsAt: "2026-10-25T16:30:00.000Z" } });
    expect((await safeRows()).find(row => row.id === moveId)).toMatchObject({ startsAt: "2026-10-25T15:30:00.000Z", endsAt: "2026-10-25T16:30:00.000Z" });
    const movedRow = (await rows()).find(row => row.id === moveId)!;
    expect([movedRow.startsAt.toISOString(), movedRow.endsAt.toISOString()]).toEqual(["2026-10-25T15:30:00.000Z", "2026-10-25T16:30:00.000Z"]);
    await page.reload(); await navigate();
    await (await openActions(page, moveId)).getByRole("button", { name: "Edit", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "Calendar event composer" });
    await expect(composer.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-25T11:30");
    await expect(composer.getByLabel("Ends", { exact: true })).toHaveValue("2026-10-25T12:30");
    await page.keyboard.press("Escape"); await dismissNotices();

    await page.getByRole("button", { name: "Mark unavailable", exact: true }).click();
    await composer.getByLabel("Title", { exact: true }).fill("Saved unavailable window");
    await composer.getByLabel("Starts", { exact: true }).fill("2026-10-25T14:00");
    await composer.getByLabel("Ends", { exact: true }).fill("2026-10-25T15:00");
    const unavailableResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/schedule" && response.request().method() === "POST");
    await composer.getByRole("button", { name: "Save unavailable block", exact: true }).click();
    const unavailable = await unavailableResponse; expect(unavailable.status()).toBe(200);
    expect(unavailable.request().postDataJSON()).toEqual({ operationId: expect.any(String), title: "Saved unavailable window", userId: state!.userId, projectId: null, actionId: null, taskId: null, notes: null, tags: ["unavailable"], occurrences: [{ startsAt: "2026-10-25T18:00:00.000Z", endsAt: "2026-10-25T19:00:00.000Z" }] });
    const unavailableReceipt = await unavailable.json();
    expect(unavailableReceipt).toEqual({ ok: true, blockIds: [expect.any(String)], replacedBlockIds: [], replayed: false, warnings: [] });
    const unavailableId = unavailableReceipt.blockIds[0];
    expect((await safeRows()).find(row => row.id === unavailableId)).toMatchObject({ userId: state!.userId, tags: ["unavailable"], linkedTimeEntryId: null });
    expect((await rows()).find(row => row.id === unavailableId)).toMatchObject({ workspaceId: state!.workspaceId, userId: state!.userId, tags: ["unavailable"], linkedTimeEntryId: null });
    await page.reload(); await navigate();
    const actions = await openActions(page, unavailableId);
    await expect(actions.getByRole("button", { name: /^(Start|Complete)$/ })).toHaveCount(0);
    await actions.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(composer.getByRole("button", { name: "Completed time", exact: true })).toBeDisabled();
    await expect(composer.getByRole("button", { name: "Unavailable", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(composer.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-25T14:00");
    await page.keyboard.press("Escape"); await dismissNotices();

    await page.getByRole("button", { name: "Schedule work", exact: true }).click();
    await composer.getByLabel("Title", { exact: true }).fill("Assigned weekly review");
    const assignee = composer.getByRole("combobox", { name: "Assignee", exact: true });
    await expect(assignee.locator(`option[value="${colleagueId}"]`)).toHaveText("Synthetic calendar colleague");
    await assignee.selectOption(colleagueId);
    await composer.getByLabel("Starts", { exact: true }).fill("2026-10-25T09:00");
    await composer.getByLabel("Ends", { exact: true }).fill("2026-10-25T10:00");
    await composer.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("weekly");
    await composer.getByLabel("Occurrences", { exact: true }).fill("3");
    await composer.getByLabel("Tags", { exact: true }).fill("review, client");
    const weeklyResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/schedule" && response.request().method() === "POST");
    await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    const weekly = await weeklyResponse; expect(weekly.status()).toBe(200);
    const occurrences = [
      { startsAt: "2026-10-25T13:00:00.000Z", endsAt: "2026-10-25T14:00:00.000Z" },
      { startsAt: "2026-11-01T14:00:00.000Z", endsAt: "2026-11-01T15:00:00.000Z" },
      { startsAt: "2026-11-08T14:00:00.000Z", endsAt: "2026-11-08T15:00:00.000Z" },
    ];
    expect(weekly.request().postDataJSON()).toEqual({ operationId: expect.any(String), title: "Assigned weekly review", userId: colleagueId, projectId: null, actionId: null, taskId: null, notes: null, tags: ["review", "client"], occurrences });
    const receipt = await weekly.json();
    expect(receipt).toEqual({ ok: true, blockIds: [expect.any(String), expect.any(String), expect.any(String)], replacedBlockIds: [], replayed: false, warnings: [] });
    const saved = (await rows()).filter(row => receipt.blockIds.includes(row.id)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    expect(saved.map(row => ({ workspaceId: row.workspaceId, userId: row.userId, tags: row.tags, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }))).toEqual(occurrences.map(occurrence => ({ workspaceId: state!.workspaceId, userId: colleagueId, tags: ["client", "review"], ...occurrence })));
    expect((await safeRows()).filter(row => receipt.blockIds.includes(row.id)).map(row => row.id).sort()).toEqual([...receipt.blockIds].sort());
    await page.reload();
    for (let index = 0; index < saved.length; index++) {
      const day = ["2026-10-25", "2026-11-01", "2026-11-08"][index];
      await navigate(day, "Team");
      await (await openActions(page, saved[index].id)).getByRole("button", { name: "Edit", exact: true }).click();
      await expect(assignee).toHaveValue(colleagueId);
      await expect(composer.getByLabel("Starts", { exact: true })).toHaveValue(`${day}T09:00`);
      await expect(composer.getByLabel("Ends", { exact: true })).toHaveValue(`${day}T10:00`);
      await page.keyboard.press("Escape");
    }
    expect(await db.select({ id: timeEntries.id }).from(timeEntries).where(eq(timeEntries.workspaceId, state!.workspaceId))).toEqual([]);
    expect(timeWrites).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (state) await db.delete(workspaces).where(and(eq(workspaces.id, state.workspaceId), eq(workspaces.slug, slug)));
    await db.delete(users).where(and(eq(users.id, colleagueId), eq(users.email, colleagueEmail)));
    if (state) await db.delete(users).where(and(eq(users.id, state.userId), eq(users.email, email)));
  }
});

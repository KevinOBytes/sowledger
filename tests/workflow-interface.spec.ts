import { expect, test, type Page } from "@playwright/test";
import { gotoApp, requestGetApp } from "./helpers/navigation";

const unique = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function sampleEntry(index: number) {
  return {
    id: `interface-entry-${index}`,
    taskId: `Interface task ${index}`,
    description: `Interface notes ${index}`,
    projectId: null as string | null,
    projectName: null as string | null,
    goalName: null,
    action: null,
    tags: [],
    startedAt: "2026-09-10T14:00:31.000Z",
    stoppedAt: "2026-09-10T15:00:42.000Z" as string | null,
    durationSeconds: 3011,
    status: "draft",
    rejectionReason: null as string | null,
    source: "manual",
  };
}

async function expectInViewport(page: Page, selector: ReturnType<Page["getByRole"]>) {
  const box = await selector.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

async function createWorkRate(page: Page, name: string, hourlyRate: number) {
  const response = await page.request.post("/api/user/actions", { data: { name, hourlyRate } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).action as { id: string; name: string; hourlyRate: number };
}

async function createPlannedBlock(page: Page, title: string, actionId: string, startsAt?: Date) {
  const start = startsAt ?? new Date();
  if (!startsAt) start.setHours(10, 0, 0, 0);
  const response = await page.request.post("/api/schedule", {
    data: { title, actionId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString() },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).block as { id: string; title: string };
}

test.describe("Operational workflow interface", () => {
  test.beforeEach(async ({ page }) => {
    // Test login creates records. The controller must select a disposable DB first.
    expect(process.env.SOWLEDGER_TEST_DATABASE, "Run through scripts/with-test-database.mjs before creating test records").toBe("true");
    const response = await requestGetApp(page, `/api/test/login?plan=smb&workspace=interface-${unique()}&clean=true`);
    expect(response.ok()).toBeTruthy();
    await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", url: "http://localhost:3008" }]);
  });

  test("Dashboard prioritizes the timer, reveals the schedule form, and links to current routes", async ({ page }) => {
    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("button", { name: "Start timer", exact: true })).toBeEnabled();
    const guide = page.locator("details").filter({ has: page.locator("summary", { hasText: "Workspace setup and shortcuts" }) });
    await expect(guide).not.toHaveAttribute("open");
    const timerHeading = page.getByRole("heading", { name: "Ready when you are" });
    expect((await timerHeading.boundingBox())!.y).toBeLessThan(420);

    await page.getByRole("button", { name: "Schedule work", exact: true }).first().click();
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
    await expectInViewport(page, page.getByLabel("Title", { exact: true }));
    const title = `Visible plan ${unique()}`;
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await guide.locator("summary").click();
    const rail = page.getByRole("region", { name: "SOWLedger workflow" });
    await expect(rail.getByRole("link", { name: /^Track / })).toHaveAttribute("href", "/dashboard");
    await expect(rail.getByRole("link", { name: /^Review / })).toHaveAttribute("href", "/reports");
    await expect(rail.getByRole("link", { name: /^Integrate / })).toHaveAttribute("href", "/integrations");
  });

  test("Activity refreshes when a timer finishes stopping after navigation", async ({ page }) => {
    const started = await page.request.post("/api/timer/start", { data: { taskId: "Stop then open Activity" } });
    expect(started.ok()).toBeTruthy();
    await gotoApp(page, "/dashboard");
    let releaseStop: () => void = () => {};
    const stoppedGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    await page.route("**/api/timer/stop", async (route) => { await stoppedGate; await route.continue(); });
    await page.getByRole("button", { name: "Stop focused timer", exact: true }).click();
    await page.getByRole("navigation", { name: "Application navigation" }).getByRole("link", { name: "Activity", exact: true }).click();
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
    releaseStop();
    await expect(page.getByRole("button", { name: "Submit Stop then open Activity for approval", exact: true })).toBeVisible();
    await expect(page.getByText("Running", { exact: true })).toHaveCount(0);
  });

  test("Phone manual entry keeps Save and Close reachable and exposes notifications and sign out", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 644 });
    // Keep the cookie notice present to verify that it cannot cover modal controls.
    await page.context().clearCookies({ name: "sowledger-cookie-consent" });
    await gotoApp(page, "/dashboard");
    await page.getByRole("button", { name: "Log completed work", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add completed work" });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "Close manual time dialog" });
    const save = dialog.getByRole("button", { name: "Log time", exact: true });
    await expectInViewport(page, close);
    await expectInViewport(page, save);
    await dialog.getByLabel("Tags", { exact: true }).fill("phone-entry");
    await expectInViewport(page, save);
    await save.click();
    await expect(dialog).toBeHidden();
    // Desktop Chromium at a phone viewport can hover the toast and pause its timeout.
    await page.mouse.move(0, 0);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Time logged" })).toBeHidden({ timeout: 10_000 });
    await page.getByRole("button", { name: "Decline", exact: true }).click();

    await page.getByRole("button", { name: /^More/ }).click();
    const more = page.getByRole("dialog", { name: "More SOWLedger navigation" });
    await expect(more.getByRole("link", { name: /^Notifications/ })).toHaveAttribute("href", "/notifications");
    await expect(more.getByRole("link", { name: "Sign out", exact: true })).toHaveAttribute("href", "/api/auth/logout");
    await expectInViewport(page, more.getByRole("link", { name: "Sign out", exact: true }));
  });

  test("Phone calendar uses one day without horizontal scrolling and supports tap scheduling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().clearCookies({ name: "sowledger-cookie-consent" });
    await gotoApp(page, "/calendar");
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-day-column]")).toHaveCount(1);
    const scrollArea = page.getByTestId("calendar-scroll-area");
    expect(await scrollArea.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect((await scrollArea.boundingBox())!.y).toBeLessThan(600);
    await page.locator("[data-calendar-slot]").first().click();
    const composer = page.getByRole("dialog", { name: "Calendar event composer" });
    await expect(composer).toBeVisible();
    const title = `Phone schedule ${unique()}`;
    await composer.getByLabel("Title", { exact: true }).fill(title);
    await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
    await expect(composer).toBeHidden();
    await expect(page.getByTestId("calendar-block")).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Work scheduled" })).toBeHidden({ timeout: 10_000 });

    // Existing-block actions must also be usable above a fresh-session cookie notice.
    const blockTitle = page.getByTestId("calendar-block").getByText(title, { exact: true });
    const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
    await blockTitle.click();
    for (const name of ["Start", "Complete", "Edit", "Cancel"]) {
      await expectInViewport(page, actions.getByRole("button", { name, exact: true }));
      await actions.getByRole("button", { name, exact: true }).click({ trial: true });
    }
    await actions.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(composer).toBeVisible();
    await composer.getByRole("button", { name: "Close calendar composer" }).click();
    await blockTitle.click();
    await actions.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(composer.getByRole("heading", { name: "Log completed work" })).toBeVisible();
    await composer.getByRole("button", { name: "Close calendar composer" }).click();
    await blockTitle.click();
    const canceled = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/schedule" && response.request().method() === "DELETE");
    await actions.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await canceled).ok()).toBeTruthy();
    await expect(actions).toBeHidden();
    await expect(page.getByRole("button", { name: "Decline", exact: true })).toBeVisible();
  });

  test("Dashboard failure is actionable and does not pretend no timers exist", async ({ page }) => {
    let fail = true;
    await page.route("**/api/timer/active", async (route) => {
      if (fail) await route.fulfill({ status: 503, json: { error: "private_database_failure_details" } });
      else await route.continue();
    });
    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("button", { name: "Retry dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No live timers" })).toHaveCount(0);
    await expect(page.getByText("private_database_failure_details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start timer", exact: true })).toBeDisabled();
    fail = false;
    await page.getByRole("button", { name: "Retry dashboard" }).click();
    await expect(page.getByRole("button", { name: "Start timer", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Retry dashboard" })).toHaveCount(0);
  });

  test("Dashboard keeps Pause and Stop usable when projects and schedule fail", async ({ page }) => {
    const started = await page.request.post("/api/timer/start", { data: { taskId: "Timer survives auxiliary failure" } });
    expect(started.ok()).toBeTruthy();
    let fail = true;
    for (const endpoint of ["**/api/projects", "**/api/schedule?status=planned"]) {
      await page.route(endpoint, async (route) => {
        if (fail) await route.fulfill({ status: 503, json: { error: "private_auxiliary_failure_details" } });
        else await route.continue();
      });
    }
    await gotoApp(page, "/dashboard");
    await expect(page.getByText("Could not load projects or work types. Retry to choose them for new work.")).toBeVisible();
    await expect(page.getByText("Schedule unavailable. Use Retry dashboard above to reload it.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing scheduled yet" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No live timers" })).toHaveCount(0);
    await expect(page.getByText("private_auxiliary_failure_details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop focused timer", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Stop timer for Timer survives auxiliary failure in No project", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Pause timer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume timer", exact: true })).toBeEnabled();
    const stopped = page.waitForResponse((response) => response.url().endsWith("/api/timer/stop") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Stop focused timer", exact: true }).click();
    expect((await stopped).ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing scheduled yet" })).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Nothing scheduled yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry dashboard" })).toHaveCount(0);
  });

  for (const selection of ["changed", "cleared"] as const) {
    test(`Calendar completion persists a ${selection} work rate from the form`, async ({ page }) => {
      const original = await createWorkRate(page, "Original planned rate", 125);
      const replacement = selection === "changed" ? await createWorkRate(page, "Updated completion rate", 250) : null;
      const block = await createPlannedBlock(page, `Calendar rate ${selection}`, original.id);
      await gotoApp(page, "/calendar");
      await page.getByRole("button", { name: "Day", exact: true }).click();
      await page.getByTestId("calendar-block").getByText(block.title, { exact: true }).click();
      await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Complete", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "Calendar event composer" });
      const rate = composer.getByRole("combobox", { name: "Work type / rate", exact: true });
      await expect(rate).toHaveValue(original.id);
      await rate.selectOption(replacement?.id ?? "");
      const saved = page.waitForResponse((response) => response.url().endsWith("/api/timer/manual") && response.request().method() === "POST");
      await composer.getByRole("button", { name: "Log completed work", exact: true }).click();
      const response = await saved;
      expect(response.ok()).toBeTruthy();
      expect(response.request().postDataJSON()).toMatchObject({ actionId: replacement?.id ?? "", scheduledBlockId: block.id });
      expect((await response.json()).entry).toMatchObject({ action: replacement?.name ?? null, hourlyRate: replacement?.hourlyRate ?? null, scheduledBlockId: block.id, source: "calendar" });
      await expect(composer).toBeHidden();
    });
  }

  test("Dashboard Log completed work explicitly clears a scheduled work rate", async ({ page }) => {
    const rate = await createWorkRate(page, "Scheduled rate to clear", 125);
    const block = await createPlannedBlock(page, "Dashboard rate clearing", rate.id, new Date(Date.now() + 30 * 60000));
    await gotoApp(page, "/dashboard");
    await page.locator("article").filter({ hasText: block.title }).getByRole("button", { name: "Log completed work", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add completed work" });
    const selection = dialog.getByRole("combobox", { name: "Work type / rate", exact: true });
    await expect(selection).toHaveValue(rate.id);
    await selection.selectOption("");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/timer/manual") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Log time", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ actionId: "", scheduledBlockId: block.id });
    expect((await response.json()).entry).toMatchObject({ action: null, hourlyRate: null, scheduledBlockId: block.id });
    await expect(dialog).toBeHidden();
  });

  test("Calendar and Activity report failed requests and recover on retry", async ({ page }) => {
    let fail = true;
    await page.route("**/api/calendar", async (route) => {
      if (fail) await route.abort("failed");
      else await route.continue();
    });
    await gotoApp(page, "/calendar");
    await expect(page.getByRole("button", { name: "Retry calendar" })).toBeVisible();
    await expect(page.locator("[data-calendar-slot]")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry calendar" }).click();
    await expect(page.locator("[data-calendar-slot]").first()).toBeVisible();

    fail = true;
    await page.route("**/api/timer/list?*", async (route) => {
      if (fail) await route.fulfill({ status: 503, json: { error: "private_database_failure_details" } });
      else await route.continue();
    });
    await gotoApp(page, "/activity");
    await expect(page.getByRole("button", { name: "Retry activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No time entries yet" })).toHaveCount(0);
    await expect(page.getByText("private_database_failure_details")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry activity" }).click();
    await expect(page.getByRole("heading", { name: "No time entries yet" })).toBeVisible();
  });

  test("Activity paginates and sends date and status filters to the API", async ({ page }) => {
    const entries = Array.from({ length: 26 }, (_, index) => sampleEntry(index));
    const requested: URL[] = [];
    await page.route("**/api/timer/list?*", async (route) => {
      const url = new URL(route.request().url());
      requested.push(url);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 25);
      await route.fulfill({ json: { entries: entries.slice(offset, offset + limit), total: entries.length, hasMore: offset + limit < entries.length } });
    });
    await gotoApp(page, "/activity");
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Interface notes 25", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("rejected");
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByLabel("From date", { exact: true }).fill("2026-09-01");
    await page.getByLabel("To date", { exact: true }).fill("2026-09-30");
    await expect.poll(() => requested.at(-1)?.searchParams.get("to")).toBeTruthy();
    expect(requested.at(-1)!.searchParams.get("status")).toBe("rejected");
    expect(requested.at(-1)!.searchParams.get("offset")).toBe("0");
    expect(Number.isFinite(Date.parse(requested.at(-1)!.searchParams.get("from")!))).toBeTruthy();
  });

  test("Activity submits completed drafts and sent-back entries, excluding running and locked time", async ({ page }) => {
    const entries = [sampleEntry(1), { ...sampleEntry(2), rejectionReason: "Please add details" }, { ...sampleEntry(3), status: "approved" }, { ...sampleEntry(4), stoppedAt: null }];
    let submitted: string[] = [];
    await page.route("**/api/timer/list?*", (route) => route.fulfill({ json: { entries, total: entries.length, hasMore: false } }));
    await page.route("**/api/timer/submit", async (route) => {
      submitted = route.request().postDataJSON().entryIds;
      entries.forEach((entry) => { if (submitted.includes(entry.id)) { entry.status = "submitted"; entry.rejectionReason = null; } });
      await route.fulfill({ json: { ok: true, submitted: submitted.length } });
    });
    await gotoApp(page, "/activity");
    await expect(page.getByRole("button", { name: "Submit Interface notes 2 for approval" })).toHaveText("Resubmit for approval");
    await expect(page.getByRole("button", { name: "Submit Interface notes 3 for approval" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit Interface notes 4 for approval" })).toHaveCount(0);
    await page.getByRole("button", { name: "Submit page for approval" }).click();
    await expect.poll(() => submitted).toEqual(["interface-entry-1", "interface-entry-2"]);
    await expect(page.getByRole("button", { name: "Submit page for approval" })).toHaveCount(0);
  });

  test("Manual correction explicitly clears notes and project without changing timestamps", async ({ page }) => {
    const entry = { ...sampleEntry(1), projectId: "interface-project", projectName: "Interface project" };
    let edited: Record<string, unknown> | null = null;
    await page.route("**/api/timer/list?*", (route) => route.fulfill({ json: { entries: [entry], total: 1, hasMore: false } }));
    await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [{ id: entry.projectId, name: entry.projectName }] } }));
    await page.route("**/api/timer/edit", async (route) => {
      edited = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    });
    await gotoApp(page, "/activity");
    await page.getByRole("button", { name: "Correct time entry Interface notes 1" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit completed work" });
    await expect(dialog.getByText("0h 50m", { exact: true })).toBeVisible();
    await dialog.getByRole("combobox", { name: "Project", exact: true }).selectOption("");
    await dialog.getByLabel("Notes", { exact: true }).fill("");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect.poll(() => edited).toMatchObject({ entryId: entry.id, projectId: null, description: "" });
    expect(edited).not.toHaveProperty("startedAt");
    expect(edited).not.toHaveProperty("stoppedAt");
  });

  test("Notes can be corrected on an entry shorter than one minute", async ({ page }) => {
    const entry = { ...sampleEntry(1), stoppedAt: "2026-09-10T14:00:42.000Z", durationSeconds: 11 };
    let edited: Record<string, unknown> | null = null;
    await page.route("**/api/timer/list?*", (route) => route.fulfill({ json: { entries: [entry], total: 1, hasMore: false } }));
    await page.route("**/api/timer/edit", async (route) => {
      edited = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    });
    await gotoApp(page, "/activity");
    await page.getByRole("button", { name: "Correct time entry Interface notes 1" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit completed work" });
    await dialog.getByLabel("Notes", { exact: true }).fill("Short entry corrected");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect.poll(() => edited).toMatchObject({ description: "Short entry corrected" });
    expect(edited).not.toHaveProperty("startedAt");
    expect(edited).not.toHaveProperty("stoppedAt");
  });

  test("Successful Google Calendar sync refreshes the displayed schedule", async ({ page }) => {
    const auth = await page.request.get("/api/auth/me");
    const { session } = await auth.json();
    let imported = false;
    const startsAt = new Date();
    startsAt.setHours(10, 0, 0, 0);
    const block = { id: "imported-busy-block", userId: session.sub, title: "Imported busy event", projectId: null, taskId: null, actionId: null, notes: null, tags: ["external-calendar", "unavailable"], startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3600000).toISOString(), status: "planned" };
    await page.route("**/api/integrations", (route) => route.fulfill({ json: { connections: [{ provider: "google_calendar", status: "connected", displayName: "Test calendar", lastSyncedAt: null, lastError: null }], readiness: { googleCalendarOAuth: true } } }));
    await page.route("**/api/schedule?scope=team", (route) => route.fulfill({ json: { blocks: imported ? [block] : [] } }));
    await page.route("**/api/integrations/google-calendar/sync", async (route) => {
      imported = true;
      await route.fulfill({ json: { ok: true, result: { imported: 1 } } });
    });
    await gotoApp(page, "/calendar");
    await expect(page.locator("[data-calendar-slot]").first()).toBeVisible();
    await page.locator("summary", { hasText: "Google Calendar sync" }).click();
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const importedBlock = page.getByTestId("calendar-block").filter({ hasText: "Imported busy event" });
    await expect(importedBlock).toHaveCount(1);
    await expect(importedBlock.getByRole("button", { name: "Start timer from scheduled work" })).toHaveCount(0);
  });
});

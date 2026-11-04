import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { apiKeys, goals, projectTasks, scheduledWorkBlocks, timeEntries, users, workspaces } from "../lib/db/schema";

// Worker-scoped artifact policy applies to secret-bearing cases and every retry.
test.use({ trace: "off", screenshot: "off", video: "off", locale: "en-US" });

test.describe("calendar date persistence and filtering", () => {
  test.use({ timezoneId: "America/New_York" });
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");
  async function setup(request: APIRequestContext) {
    const suffix = crypto.randomUUID();
    const login = await request.get(`/api/test/login?workspace=date-contract-${suffix}&email=date-${suffix}@example.com&plan=smb`);
    expect(login.ok()).toBeTruthy();
    return await login.json() as { workspaceId: string; userId: string };
  }

  test("task and goal dates can be set, omitted, cleared, and read back without an epoch date", async ({ request }) => {
    const state = await setup(request);
    const createdProject = await request.post("/api/projects", { data: { name: "Dated work" } });
    expect(createdProject.ok()).toBeTruthy();
    const { project } = await createdProject.json();
    for (const resource of ["tasks", "goals"] as const) {
      const create = await request.post(`/api/${resource}`, { data: { projectId: project.id, title: "Dated task", name: "Dated goal", dueDate: "2026-10-30" } });
      expect(create.ok()).toBeTruthy();
      const created = (await create.json())[resource === "tasks" ? "task" : "goal"];
      const idKey = resource === "tasks" ? "taskId" : "goalId";
      const read = async () => resource === "tasks"
        ? (await db.select().from(projectTasks).where(eq(projectTasks.id, created.id)))[0]
        : (await db.select().from(goals).where(eq(goals.id, created.id)))[0];
      expect((await read()).dueDate?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
      expect((await request.patch(`/api/${resource}`, { data: { [idKey]: created.id, description: "Only notes changed" } })).ok()).toBeTruthy();
      expect((await read()).dueDate?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
      for (const dueDate of [null, "", "   "]) {
        expect((await request.patch(`/api/${resource}`, { data: { [idKey]: created.id, dueDate: "2026-11-01" } })).ok()).toBeTruthy();
        const cleared = await request.patch(`/api/${resource}`, { data: { [idKey]: created.id, dueDate } });
        expect(cleared.ok()).toBeTruthy();
        expect((await read()).dueDate).toBeNull();
      }
      expect((await read()).workspaceId).toBe(state.workspaceId);
    }
  });

  for (const tab of ["list", "board"]) for (const width of [1280, 390]) {
    test(`${tab} due-date control sets and clears persisted dates at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "declined", domain: "localhost", path: "/" }]);
      await setup(page.request);
      const { project } = await (await page.request.post("/api/projects", { data: { name: "Due date controls" } })).json();
      const { task } = await (await page.request.post("/api/tasks", { data: { projectId: project.id, title: "Review client delivery" } })).json();
      const open = async () => {
        await page.goto(`/projects/${project.id}?tab=${tab}`);
        if (tab === "list") await page.getByRole("button", { name: "Open task: Review client delivery", exact: true }).click();
        else await page.getByText("Review client delivery", { exact: true }).click();
        await expect(page.getByLabel("Due date", { exact: true })).toBeVisible();
      };
      await open();
      for (const value of ["2026-11-01", ""]) {
        const saved = page.waitForResponse(response => response.url().endsWith("/api/tasks") && response.request().method() === "PATCH");
        await page.getByLabel("Due date", { exact: true }).fill(value);
        if (tab === "list") await page.getByRole("button", { name: "Save task", exact: true }).click();
        expect((await saved).ok()).toBeTruthy();
        const [persisted] = await db.select().from(projectTasks).where(eq(projectTasks.id, task.id));
        expect(persisted.dueDate?.toISOString() ?? null).toBe(value ? "2026-11-01T00:00:00.000Z" : null);
        await open();
        await expect(page.getByLabel("Due date", { exact: true })).toHaveValue(value);
      }
    });
  }

  test("invalid task and goal dates fail before writing instead of normalizing an impossible day", async ({ request }) => {
    await setup(request);
    const { project } = await (await request.post("/api/projects", { data: { name: "Date validation" } })).json();
    for (const resource of ["tasks", "goals"] as const) {
      const created = (await (await request.post(`/api/${resource}`, { data: { projectId: project.id, title: "Task", name: "Goal", dueDate: "2026-10-30" } })).json())[resource === "tasks" ? "task" : "goal"];
      for (const dueDate of ["not-a-date", "2026-02-30", "2026-13-01", 42, false, {}]) {
        const body = { projectId: project.id, title: "Invalid task", name: "Invalid goal", dueDate };
        expect((await request.post(`/api/${resource}`, { data: body })).status()).toBe(400);
        expect((await request.patch(`/api/${resource}`, { data: { [resource === "tasks" ? "taskId" : "goalId"]: created.id, dueDate } })).status()).toBe(400);
      }
    }
  });

  test("analytics, Activity and exports select the same local start-day entries, including the local evening", async ({ request }) => {
    const state = await setup(request);
    const definitions = [
      { id: crypto.randomUUID(), taskId: "Previous local day", at: "2026-10-30T02:00:00Z" },
      { id: crypto.randomUUID(), taskId: "Selected local evening", at: "2026-10-31T02:00:00Z" },
      { id: crypto.randomUUID(), taskId: "Next local day", at: "2026-10-31T04:00:00Z" },
    ];
    for (const entry of definitions) await db.insert(timeEntries).values({ id: entry.id, workspaceId: state.workspaceId, userId: state.userId, taskId: entry.taskId, startedAt: new Date(entry.at), stoppedAt: new Date(Date.parse(entry.at) + 3600000), durationSeconds: 3600, source: "manual" });
    const start = "2026-10-30T04:00:00.000Z";
    const end = "2026-10-31T04:00:00.000Z";
    const query = new URLSearchParams({ start, end, timeZone: "America/New_York" });
    const report = await request.get(`/api/reports?${query}`);
    expect(report.ok()).toBeTruthy();
    expect(await report.json()).toMatchObject({ totalHours: 1, dailyTrend: [{ date: "2026-10-30", hours: 1 }] });
    const activity = await request.get(`/api/timer/list?${new URLSearchParams({ from: start, to: "2026-10-31T03:59:59.999Z" })}`);
    expect((await activity.json()).entries.map((entry: { id: string }) => entry.id)).toEqual([definitions[1].id]);
    const exported = await request.get(`/api/export/csv?${query}&format=json&include=timeEntries`);
    expect(exported.ok()).toBeTruthy();
    expect(exported.headers()["x-sowledger-export-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect((await exported.json()).timeEntries.map((entry: { id: string }) => entry.id)).toEqual([definitions[1].id]);
    const csv = await request.get(`/api/export/csv?${query}&format=csv`);
    const text = await csv.text();
    expect(text).toContain("Selected local evening");
    expect(text).not.toContain("Previous local day");
    expect(text).not.toContain("Next local day");
    const utcReport = await request.get("/api/reports?start=2026-10-30&end=2026-10-30");
    expect(await utcReport.json()).toMatchObject({ totalHours: 1, dailyTrend: [{ date: "2026-10-30", hours: 1 }] });
  });

  test("reports and exports reject invalid or reversed ranges instead of silently dropping filters", async ({ request }) => {
    await setup(request);
    for (const route of ["/api/reports", "/api/revenue-intelligence", "/api/export/csv"]) {
      for (const range of [{ start: "not-a-date" }, { end: "2026-02-30" }, { start: "2026-11-02", end: "2026-11-01" }] as Record<string, string>[]) {
        expect((await request.get(`${route}?${new URLSearchParams(range)}`)).status(), `${route}: ${JSON.stringify(range)}`).toBe(400);
      }
    }
    expect((await request.get("/api/reports?timeZone=not-a-timezone")).status()).toBe(400);
  });

  test("overnight plans appear in a day export and analytics count only their overlapping time", async ({ request }) => {
    const state = await setup(request);
    const blockId = crypto.randomUUID();
    await db.insert(scheduledWorkBlocks).values({ id: blockId, workspaceId: state.workspaceId, userId: state.userId, createdByUserId: state.userId, title: "Overnight plan", startsAt: new Date("2026-10-30T03:00:00Z"), endsAt: new Date("2026-10-30T05:00:00Z") });
    const query = new URLSearchParams({ start: "2026-10-30T04:00:00.000Z", end: "2026-10-31T04:00:00.000Z", timeZone: "America/New_York" });
    expect(await (await request.get(`/api/reports?${query}`)).json()).toMatchObject({ plannedHours: 1 });
    const exported = await request.get(`/api/export/csv?${query}&format=json&include=schedule`);
    expect((await exported.json()).scheduledWorkBlocks.map((block: { id: string }) => block.id)).toEqual([blockId]);
  });

  test.describe("secret-bearing browser-selected API-key expiry", () => {
    // Applies to every retry as well: a one-time credential must never enter
    // traces, screenshots, or video. Closing the page in finally also prevents
    // Playwright's failure-context DOM snapshot from retaining its one-time UI.
    for (const width of [390, 1280]) test(`selected fall-back expiry and deliberate blank persist at ${width}px`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
      const slug = `api-expiry-ui-${crypto.randomUUID()}`;
      const email = `${slug}@example.com`;
      let state: { workspaceId: string; userId: string } | undefined;
      // Independently derive a future New York fall-back Sunday. The day ends
      // just before next-day 05:00Z, not 24 hours after its 04:00Z start.
      const year = new Date().getUTCFullYear() + 2;
      const sunday = 1 + (7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7;
      const selected = `${year}-11-${String(sunday).padStart(2, "0")}`;
      const selectedEnd = new Date(Date.UTC(year, 10, sunday + 1, 5) - 1).toISOString();
      try {
        const login = await page.request.get(`/api/test/login?${new URLSearchParams({ workspace: slug, email, plan: "smb" })}`);
        expect(login.status()).toBe(200); state = await login.json();
        for (const [value, expiresAt, name] of [[selected, selectedEnd, "Selected local expiry"], ["", null, "Deliberately no expiry"]] as const) {
          await page.goto("/settings/developers");
          await page.getByLabel("Name", { exact: true }).fill(name);
          await page.getByRole("button", { name: "Clear", exact: true }).click();
          await page.getByRole("checkbox", { name: "read:time", exact: true }).check();
          await page.getByLabel("Expires", { exact: true }).fill(value);
          const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/api-keys" && response.request().method() === "POST");
          await page.getByRole("button", { name: "Create API key", exact: true }).click();
          const response = await pending;
          const completionError = await response.finished();
          if (completionError) throw new Error("API-key creation response body did not finish.");
          const { key } = await response.json() as { key: { id: string; expiresAt: string | null } };
          // Drop the one-time secret UI before any readback assertion. Do not
          // read/log the rawKey field or select the secret-bearing page text.
          await page.reload();
          expect(response.request().postDataJSON()).toEqual({ name, scopes: ["read:time"], expiresAt });
          expect(response.status()).toBe(200);
          expect(key.expiresAt).toBe(expiresAt);
          const safeGet = await page.request.get("/api/settings/api-keys"); expect(safeGet.status()).toBe(200);
          const safe = (await safeGet.json()).keys.find((item: { id: string }) => item.id === key.id);
          expect({ id: safe.id, name: safe.name, scopes: safe.scopes, expiresAt: safe.expiresAt }).toEqual({ id: key.id, name, scopes: ["read:time"], expiresAt });
          const [persisted] = await db.select({ id: apiKeys.id, workspaceId: apiKeys.workspaceId, name: apiKeys.name, scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt }).from(apiKeys).where(and(eq(apiKeys.workspaceId, state!.workspaceId), eq(apiKeys.id, key.id)));
          expect({ ...persisted, expiresAt: persisted.expiresAt?.toISOString() ?? null }).toEqual({ id: key.id, workspaceId: state!.workspaceId, name, scopes: ["read:time"], expiresAt });
          const row = page.getByRole("article").filter({ has: page.getByText(name, { exact: true }) });
          await expect(row).toHaveCount(1);
          const displayedExpiry = row.locator("dl > div").filter({ has: page.getByText("Expires", { exact: true }) }).locator("dd");
          await expect(displayedExpiry).toHaveText(value ? `11/${sunday}/${year}` : "No expiry");
        }
      } finally {
        await page.close();
        if (state) {
          await db.delete(workspaces).where(and(eq(workspaces.id, state.workspaceId), eq(workspaces.slug, slug)));
          await db.delete(users).where(and(eq(users.id, state.userId), eq(users.email, email)));
        }
      }
    });
  });
});

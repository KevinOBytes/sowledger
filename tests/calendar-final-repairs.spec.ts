import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import { generateApiKeyMaterial } from "../lib/api-keys";

test.use({ timezoneId: "America/New_York", trace: "off", screenshot: "off", video: "off" });
test.describe("Task7g root-owned calendar and report database acceptance", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Disposable wrapper only; no primary records.");
  test.setTimeout(90_000);
  const owned: Array<{ workspaceId: string; userId: string }> = [];
  const extraUsers: string[] = [];
  test.afterEach(async () => {
    for (const item of owned.splice(0)) {
      await db.delete(schema.workspacePeople).where(eq(schema.workspacePeople.workspaceId, item.workspaceId));
      await db.delete(schema.organizations).where(eq(schema.organizations.workspaceId, item.workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, item.workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, item.userId));
    }
    for (const id of extraUsers.splice(0)) await db.delete(schema.users).where(eq(schema.users.id, id));
  });
  async function seed(page: Page) {
    const workspace = `final-calendar-${crypto.randomUUID()}`, email = `${workspace}@example.com`;
    const response = await page.request.get(`/api/test/login?${new URLSearchParams({ workspace, email, plan: "smb" })}`);
    expect(response.ok()).toBeTruthy();
    const owner = await response.json() as { workspaceId: string; userId: string }; owned.push(owner);
    await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
    return { ...owner, workspace };
  }

  test("37-minute pointer move, five-minute next/duplicate and sub-minute nudge persist exact instants after reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.clock.setFixedTime(new Date("2026-10-30T16:00:00Z"));
    const s = await seed(page);
    const examples = [
      { title: "Exact37", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T13:37:00.000Z", nextStart: "2026-10-30T14:00:00.000Z", nextEnd: "2026-10-30T14:37:00.000Z", operation: "pointer" },
      { title: "Exact5", startsAt: "2026-10-30T15:00:00.000Z", endsAt: "2026-10-30T15:05:00.000Z", nextStart: "2026-10-30T15:15:00.000Z", nextEnd: "2026-10-30T15:20:00.000Z", operation: "next" },
      { title: "ExactSeconds", startsAt: "2026-10-30T17:00:45.000Z", endsAt: "2026-10-30T17:30:15.000Z", nextStart: "2026-10-30T17:15:45.000Z", nextEnd: "2026-10-30T17:45:15.000Z", operation: "keyboard" },
    ];
    for (const example of examples) {
      const created = await page.request.post("/api/schedule", { data: { title: example.title, startsAt: example.startsAt, endsAt: example.endsAt } });
      expect(created.ok()).toBeTruthy();
      const block = (await created.json()).block;
      await page.goto("/calendar");
      await page.getByRole("button", { name: "Day", exact: true }).click();
      const card = page.locator(`[data-calendar-block-id="${block.id}"]`).first();
      await expect(card).toBeVisible();
      await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === "/api/schedule" && r.request().method() === "PATCH" && r.request().postDataJSON().blockId === block.id);
      if (example.operation === "pointer") {
        const box = (await card.getByRole("button", { name: `Drag to reschedule ${example.title}`, exact: true }).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 72, { steps: 4 });
        await page.mouse.up();
        await page.getByRole("dialog", { name: "Move scheduled work" }).getByRole("button", { name: "Move block", exact: true }).click();
      } else if (example.operation === "keyboard") {
        await card.focus(); await page.keyboard.press("ArrowDown");
      } else {
        await card.click();
        await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Next slot", exact: true }).click();
      }
      const savedResponse = await saved;
      expect(savedResponse.ok()).toBeTruthy();
      expect(await savedResponse.finished()).toBeNull();
      expect((await savedResponse.json()).block).toMatchObject({ id: block.id, startsAt: example.nextStart, endsAt: example.nextEnd });
      const expectedLabel = await page.evaluate(example => `${example.title} Planned ${new Date(example.nextStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} to ${new Date(example.nextEnd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, example);
      await expect(card).toHaveAttribute("aria-label", expectedLabel);
      await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
      await page.reload();
      const response = await page.request.get("/api/schedule");
      const persisted = (await response.json()).blocks.find((row: { id: string }) => row.id === block.id);
      expect(persisted).toMatchObject({ startsAt: example.nextStart, endsAt: example.nextEnd });
      const [record] = await db.select().from(schema.scheduledWorkBlocks).where(and(eq(schema.scheduledWorkBlocks.workspaceId, s.workspaceId), eq(schema.scheduledWorkBlocks.id, block.id)));
      expect(record.endsAt.getTime() - record.startsAt.getTime()).toBe(new Date(example.endsAt).getTime() - new Date(example.startsAt).getTime());
      if (example.operation === "next") {
        await page.getByRole("button", { name: "Day", exact: true }).click();
        await page.locator(`[data-calendar-block-id="${block.id}"]`).first().click();
        const duplicate = page.waitForResponse(r => new URL(r.url()).pathname === "/api/schedule" && r.request().method() === "POST" && r.request().postDataJSON().title === example.title);
        await page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("button", { name: "Duplicate", exact: true }).click();
        const duplicateResponse = await duplicate;
        expect(duplicateResponse.ok()).toBeTruthy();
        expect(await duplicateResponse.finished()).toBeNull();
        const copied = await duplicateResponse.json();
        expect(copied.ok).toBe(true); expect(copied.blockIds).toHaveLength(1);
        await expect(page.locator(`[data-calendar-block-id="${copied.blockIds[0]}"]`).first()).toBeVisible();
        await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
        const [copy] = await db.select().from(schema.scheduledWorkBlocks).where(and(eq(schema.scheduledWorkBlocks.workspaceId, s.workspaceId), eq(schema.scheduledWorkBlocks.id, copied.blockIds[0])));
        expect(copy.endsAt.getTime() - copy.startsAt.getTime()).toBe(300_000);
      }
    }
  });

  test("authorized assignee choices save and read back; ordinary and foreign reads remain denied", async ({ page }) => {
    const s = await seed(page), member = crypto.randomUUID(), foreign = crypto.randomUUID();
    extraUsers.push(member, foreign);
    await db.insert(schema.users).values([{ id: member, email: `${member}@example.com` }, { id: foreign, email: `${foreign}@example.com` }]);
    await db.insert(schema.memberships).values({ workspaceId: s.workspaceId, userId: member, role: "member" });
    const actionId = crypto.randomUUID();
    await db.insert(schema.userActions).values({ id: actionId, workspaceId: s.workspaceId, userId: member, name: "Member work", hourlyRate: 175 });
    const choices = await page.request.get(`/api/user/actions?userId=${member}`);
    expect(choices.status()).toBe(200);
    expect((await choices.json()).actions.map((row: { id: string }) => row.id)).toEqual([actionId]);
    const created = await page.request.post("/api/schedule", { data: { userId: member, actionId, title: "Assigned with rate", startsAt: "2026-10-30T13:00:00Z", endsAt: "2026-10-30T13:37:00Z" } });
    expect(created.ok()).toBeTruthy();
    const block = (await created.json()).block;
    const changed = await page.request.patch("/api/schedule", { data: { blockId: block.id, title: "Unrelated title edit", userId: member, actionId } });
    expect(changed.ok()).toBeTruthy();
    const [saved] = await db.select().from(schema.scheduledWorkBlocks).where(and(eq(schema.scheduledWorkBlocks.workspaceId, s.workspaceId), eq(schema.scheduledWorkBlocks.id, block.id)));
    expect(saved.actionId).toBe(actionId); expect(saved.userId).toBe(member);
    expect((await page.request.get(`/api/user/actions?userId=${foreign}`)).status()).toBe(404);
    await page.request.get(`/api/test/login?${new URLSearchParams({ workspace: s.workspace, email: `${member}@example.com`, role: "member", plan: "smb" })}`);
    expect((await page.request.get(`/api/user/actions?userId=${s.userId}`)).status()).toBe(403);
    const own = await page.request.get("/api/user/actions"); expect(own.status()).toBe(200);
    expect((await own.json()).actions.map((row: { id: string }) => row.id)).toEqual([actionId]);
  });

  test("native/public analytics and revenue use persisted eligible scoped plans and clipped totals", async ({ page }) => {
    const s = await seed(page), projectId = crypto.randomUUID(), otherProject = crypto.randomUUID();
    await db.insert(schema.projects).values([{ id: projectId, workspaceId: s.workspaceId, name: "Scoped project" }, { id: otherProject, workspaceId: s.workspaceId, name: "Other project" }]);
    await db.insert(schema.timeEntries).values({ id: crypto.randomUUID(), workspaceId: s.workspaceId, userId: s.userId, projectId, taskId: "Actual hour", startedAt: new Date("2026-01-02T10:00Z"), stoppedAt: new Date("2026-01-02T11:00Z"), durationSeconds: 3600, hourlyRate: 100, status: "invoiced", source: "manual" });
    const base = { workspaceId: s.workspaceId, userId: s.userId, createdByUserId: s.userId, projectId, title: "Genuine work", startsAt: new Date("2026-01-02T10:00Z"), endsAt: new Date("2026-01-02T11:00Z"), status: "planned" as const, tags: [] };
    const importedId = crypto.randomUUID();
    await db.insert(schema.scheduledWorkBlocks).values([
      { ...base, id: crypto.randomUUID() },
      { ...base, id: crypto.randomUUID(), startsAt: new Date("2026-01-01T23:30Z"), endsAt: new Date("2026-01-02T00:30Z") },
      { ...base, id: crypto.randomUUID(), projectId: otherProject },
      { ...base, id: crypto.randomUUID(), startsAt: new Date("2026-01-03T00:00Z"), endsAt: new Date("2026-01-03T08:00Z") },
      { ...base, id: crypto.randomUUID(), status: "canceled" },
      { ...base, id: crypto.randomUUID(), tags: ["unavailable"] },
      { ...base, id: crypto.randomUUID(), title: "Busy: meeting" },
      { ...base, id: importedId, title: "Renamed imported availability" },
    ]);
    const connectionId = crypto.randomUUID();
    await db.insert(schema.integrationConnections).values({ id: connectionId, workspaceId: s.workspaceId, provider: "google_calendar", createdByUserId: s.userId, status: "disabled", credentials: {}, config: {} });
    await db.insert(schema.integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: s.workspaceId, connectionId, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: importedId, externalId: "fixture-busy", metadata: { direction: "google_busy_to_sowledger" } });
    const key = generateApiKeyMaterial();
    await db.insert(schema.apiKeys).values({ id: crypto.randomUUID(), workspaceId: s.workspaceId, name: "Disposable final-review key", keyHash: key.keyHash, keyPrefix: key.keyPrefix, scopes: ["read:analytics", "read:revenue-intelligence"], createdByUserId: s.userId });
    const query = new URLSearchParams({ scope: "mine", projectId, userId: s.userId, start: "2026-01-02", end: "2026-01-02" });
    const native = await page.request.get(`/api/reports?${query}`);
    const publicReport = await page.request.get(`/api/v1/analytics?${query}`, { headers: { Authorization: `Bearer ${key.rawKey}` } });
    expect(native.status()).toBe(200); expect(publicReport.status()).toBe(200);
    for (const data of [await native.json(), (await publicReport.json()).analytics]) {
      expect(data.totalHours).toBe(1); expect(data.plannedHours).toBe(1.5); expect(data.utilization).toBe(2 / 3); expect(data.missedBlocks).toBe(2);
    }
    for (const resource of ["/api/revenue-intelligence", "/api/v1/revenue-intelligence"]) {
      const response = await page.request.get(`${resource}?${query}`, { headers: resource.includes("/v1/") ? { Authorization: `Bearer ${key.rawKey}` } : {} });
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.summary.missedScheduledBlockCount).toBe(2);
      expect(data.recoveryOpportunities.filter((item: { type: string }) => item.type === "missed_scheduled_work")).toHaveLength(2);
    }
  });
});

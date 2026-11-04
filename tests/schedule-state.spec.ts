import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { apiKeys, integrationConnections, integrationSyncRecords, scheduledWorkBlocks, timeEntries } from "../lib/db/schema";
import { generateApiKeyMaterial } from "../lib/api-keys";

test.describe("calendar schedule state", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");

  async function fixture(request: APIRequestContext, overrides: Partial<typeof scheduledWorkBlocks.$inferInsert> = {}) {
    const suffix = crypto.randomUUID();
    const login = await request.get(`/api/test/login?workspace=schedule-state-${suffix}&email=schedule-${suffix}@example.com&plan=smb`);
    expect(login.ok()).toBeTruthy();
    const owner = await login.json() as { workspaceId: string; userId: string };
    const [block] = await db.insert(scheduledWorkBlocks).values({
      id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId, createdByUserId: owner.userId,
      title: "Overnight client work", startsAt: new Date("2026-10-01T23:00:00Z"), endsAt: new Date("2026-10-02T02:00:00Z"), ...overrides,
    }).returning();
    const material = generateApiKeyMaterial();
    await db.insert(apiKeys).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, createdByUserId: owner.userId, name: "Schedule state", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes: ["write:schedule"] });
    return { ...owner, block, headers: { authorization: `Bearer ${material.rawKey}` } };
  }

  test("date-window queries include blocks that began the previous day and reject malformed dates", async ({ request }) => {
    const state = await fixture(request);
    const response = await request.get("/api/schedule?start=2026-10-02T00:00:00Z&end=2026-10-03T00:00:00Z");
    expect(response.status()).toBe(200);
    expect((await response.json()).blocks.map((block: { id: string }) => block.id)).toContain(state.block.id);
    const adjacent = await request.get("/api/schedule?start=2026-10-02T02:00:00Z&end=2026-10-03T00:00:00Z");
    expect((await adjacent.json()).blocks).toHaveLength(0);
    expect((await request.get("/api/schedule?start=not-a-date")).status()).toBe(400);
    expect((await request.get("/api/schedule?start=2026-10-03&end=2026-10-02")).status()).toBe(400);
  });

  test("schedule reads expose recorded work and imported ownership even when editable labels are stale", async ({ request }) => {
    const state = await fixture(request);
    await db.insert(timeEntries).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, userId: state.userId, scheduledBlockId: state.block.id, taskId: "Existing record", startedAt: state.block.startsAt, stoppedAt: state.block.endsAt, durationSeconds: 10800 });
    const [connection] = await db.insert(integrationConnections).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, createdByUserId: state.userId, provider: "google_calendar", status: "disabled" }).returning();
    await db.insert(integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, connectionId: connection.id, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: state.block.id, externalId: "provider-event", metadata: { direction: "google_busy_to_sowledger" } });
    const response = await request.get("/api/schedule?status=planned");
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).blocks.find((block: { id: string }) => block.id === state.block.id)).toMatchObject({ status: "planned", linkedTimeEntryId: null, hasRecordedTime: true, isImported: true });
  });

  for (const path of ["/api/schedule", "/api/v1/schedule"]) {
    test(`${path} cannot reset, cancel, or move tracked work`, async ({ request }) => {
      const state = await fixture(request, { status: "in_progress" });
      const [entry] = await db.insert(timeEntries).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, userId: state.userId, scheduledBlockId: state.block.id, taskId: "Active work", startedAt: state.block.startsAt }).returning();
      await db.update(scheduledWorkBlocks).set({ linkedTimeEntryId: entry.id }).where(and(eq(scheduledWorkBlocks.workspaceId, state.workspaceId), eq(scheduledWorkBlocks.id, state.block.id)));
      const headers = path.includes("/v1/") ? state.headers : undefined;
      for (const update of [{ status: "planned" }, { status: "skipped" }, { startsAt: "2026-10-02T00:00:00Z" }]) {
        expect((await request.patch(path, { headers, data: { blockId: state.block.id, ...update } })).status()).toBe(409);
      }
      const idParam = path.includes("/v1/") ? "id" : "blockId";
      expect((await request.delete(`${path}?${idParam}=${state.block.id}`, { headers })).status()).toBe(409);
      const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, state.workspaceId), eq(scheduledWorkBlocks.id, state.block.id)));
      expect(saved).toMatchObject({ status: "in_progress", linkedTimeEntryId: entry.id, startsAt: state.block.startsAt });
      // Descriptive corrections do not alter the recorded-time link.
      expect((await request.patch(path, { headers, data: { blockId: state.block.id, notes: "Clarified description" } })).status()).toBe(200);
    });

    test(`${path} does not manufacture completion or overwrite imported availability`, async ({ request }) => {
      const state = await fixture(request);
      const headers = path.includes("/v1/") ? state.headers : undefined;
      for (const status of ["completed", "in_progress"]) {
        expect((await request.patch(path, { headers, data: { blockId: state.block.id, status } })).status()).toBe(400);
      }
      await db.update(scheduledWorkBlocks).set({ tags: ["external-calendar", "unavailable"] }).where(and(eq(scheduledWorkBlocks.workspaceId, state.workspaceId), eq(scheduledWorkBlocks.id, state.block.id)));
      expect((await request.patch(path, { headers, data: { blockId: state.block.id, title: "Overwrite external event", tags: [] } })).status()).toBe(409);
    });
  }

  test("planned work can still move, resize, skip and cancel, but time links are server-managed", async ({ request }) => {
    const state = await fixture(request);
    expect((await request.patch("/api/schedule", { data: { blockId: state.block.id, linkedTimeEntryId: crypto.randomUUID() } })).status()).toBe(400);
    for (const update of [
      { startsAt: "2026-10-01T22:00:00Z", endsAt: "2026-10-01T23:30:00Z" },
      { endsAt: "2026-10-02T00:30:00Z" }, { status: "skipped" }, { status: "planned" },
    ]) expect((await request.patch("/api/schedule", { data: { blockId: state.block.id, ...update } })).status()).toBe(200);
    expect((await request.delete(`/api/schedule?blockId=${state.block.id}`)).status()).toBe(200);
  });

  test("legacy imported events remain read-only through app and API even after labels were cleared", async ({ request }) => {
    const state = await fixture(request, { title: "Renamed external event", tags: [], notes: null });
    const [connection] = await db.insert(integrationConnections).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, createdByUserId: state.userId, provider: "google_calendar", status: "disabled" }).returning();
    await db.insert(integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, connectionId: connection.id, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: state.block.id, externalId: crypto.randomUUID(), metadata: { direction: "google_busy_to_sowledger" } });
    for (const path of ["/api/schedule", "/api/v1/schedule"]) {
      const headers = path.includes("/v1/") ? state.headers : undefined;
      expect((await request.patch(path, { headers, data: { blockId: state.block.id, title: "Overwritten event" } })).status()).toBe(409);
      expect((await request.delete(`${path}?${path.includes("/v1/") ? "id" : "blockId"}=${state.block.id}`, { headers })).status()).toBe(409);
    }
    const [saved] = await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.id, state.block.id));
    expect(saved).toMatchObject({ title: "Renamed external event", status: "planned" });
  });
});

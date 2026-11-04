import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { integrationConnections, integrationSyncRecords, scheduledWorkBlocks, timeEntries } from "../lib/db/schema";

type Owner = { userId: string; workspaceId: string };
const startedAt = "2026-01-12T10:00:00.000Z";
const stoppedAt = "2026-01-12T11:00:00.000Z";

test.describe("isolated calendar-to-time entry integrity", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures into production.");
  test.setTimeout(90000);

  async function login(request: APIRequestContext, workspace = `calendar-entry-${crypto.randomUUID()}`) {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, role: "owner", plan: "smb", email: `${workspace}@example.com` })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    return await response.json() as Owner;
  }

  async function createBlock(owner: Owner, overrides: Partial<typeof scheduledWorkBlocks.$inferInsert> = {}) {
    const [block] = await db.insert(scheduledWorkBlocks).values({
      id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId, createdByUserId: owner.userId,
      title: "Client review", startsAt: new Date(startedAt), endsAt: new Date(stoppedAt), ...overrides,
    }).returning();
    return block;
  }

  function log(request: APIRequestContext, mode: "start" | "manual", extra: Record<string, unknown> = {}) {
    return request.post(`/api/timer/${mode}`, { data: { taskId: "Client review", startedAt, stoppedAt, ...extra } });
  }

  test("timer and manual entry creation keep zero, missing and nonzero rates separate", async ({ request }) => {
    const owner = await login(request);
    let zeroActionId = "";
    for (const hourlyRate of [0, null, 100]) {
      const actionResponse = await request.post("/api/user/actions", { data: { name: `Review at ${hourlyRate}`, ...(hourlyRate === null ? {} : { hourlyRate }) } });
      expect(actionResponse.ok(), await actionResponse.text()).toBeTruthy();
      const { action } = await actionResponse.json();
      if (hourlyRate === 0) zeroActionId = action.id;
      for (const mode of ["start", "manual"] as const) {
        const response = await log(request, mode, { actionId: action.id });
        expect(response.ok(), await response.text()).toBeTruthy();
        expect((await response.json()).entry.hourlyRate).toBe(hourlyRate);
      }
    }
    for (const clearAction of [false, true]) {
      const block = await createBlock(owner, { actionId: zeroActionId });
      const response = await log(request, "manual", { scheduledBlockId: block.id, ...(clearAction ? { actionId: "" } : {}) });
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json()).entry.hourlyRate).toBe(clearAction ? null : 0);
    }
  });

  test("repeated starts, repeated completions and start-versus-complete races record exactly one entry", async ({ request }) => {
    const owner = await login(request);
    for (const modes of [["start", "start"], ["manual", "manual"], ["start", "manual"]] as const) {
      const block = await createBlock(owner);
      const responses = await Promise.all(modes.map((mode) => log(request, mode, { scheduledBlockId: block.id })));
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
      const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.scheduledBlockId, block.id)));
      expect(entries).toHaveLength(1);
      const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.id, block.id)));
      expect(saved.linkedTimeEntryId).toBe(entries[0].id);
      expect(saved.status).toBe(entries[0].stoppedAt ? "completed" : "in_progress");
    }
  });

  test("nonplanned, unavailable and already-linked blocks reject both entry creation paths", async ({ request }) => {
    const owner = await login(request);
    const variants: Array<Partial<typeof scheduledWorkBlocks.$inferInsert>> = [
      ...(["in_progress", "completed", "skipped", "canceled"] as const).map((status) => ({ status })),
      { linkedTimeEntryId: crypto.randomUUID() },
      { tags: ["unavailable"] }, { tags: ["external-calendar"] }, { tags: ["ooo"] },
    ];
    for (const overrides of variants) {
      const block = await createBlock(owner, overrides);
      for (const mode of ["start", "manual"] as const) {
        expect((await log(request, mode, { scheduledBlockId: block.id })).status()).toBe(409);
      }
    }
    const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId));
    expect(entries).toHaveLength(0);
  });

  test("clearing schedule metadata cannot reconsume work that already has a time entry", async ({ request }) => {
    const owner = await login(request);
    const block = await createBlock(owner);
    const response = await log(request, "manual", { scheduledBlockId: block.id });
    expect(response.ok(), await response.text()).toBeTruthy();
    await db.update(scheduledWorkBlocks).set({ status: "planned", linkedTimeEntryId: null }).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.id, block.id)));
    for (const mode of ["start", "manual"] as const) expect((await log(request, mode, { scheduledBlockId: block.id })).status()).toBe(409);
    const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.scheduledBlockId, block.id)));
    expect(entries).toHaveLength(1);
  });

  test("import identity prevents timer or manual entry after external labels change", async ({ request }) => {
    const owner = await login(request);
    const block = await createBlock(owner, { title: "Renamed external appointment", tags: [], notes: null });
    const [connection] = await db.insert(integrationConnections).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, createdByUserId: owner.userId, provider: "google_calendar", status: "disabled" }).returning();
    await db.insert(integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, connectionId: connection.id, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: block.id, externalId: crypto.randomUUID(), metadata: { direction: "google_busy_to_sowledger" } });
    for (const mode of ["start", "manual"] as const) expect((await log(request, mode, { scheduledBlockId: block.id })).status()).toBe(409);
    expect(await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId))).toHaveLength(0);
  });

  test("a linked timer can stop normally but its completed block cannot be logged again", async ({ request }) => {
    const owner = await login(request);
    const block = await createBlock(owner);
    const started = await log(request, "start", { scheduledBlockId: block.id });
    expect(started.ok(), await started.text()).toBeTruthy();
    const { entry } = await started.json();
    await db.update(timeEntries).set({ startedAt: new Date(Date.now() - 60_000) }).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.id, entry.id)));
    const stopped = await request.post("/api/timer/stop", { data: { entryId: entry.id } });
    expect(stopped.ok(), await stopped.text()).toBeTruthy();
    const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.id, block.id)));
    expect(saved).toMatchObject({ status: "completed", linkedTimeEntryId: entry.id });
    for (const mode of ["start", "manual"] as const) expect((await log(request, mode, { scheduledBlockId: block.id })).status()).toBe(409);
  });

  test("a foreign workspace's block is never claimed", async ({ request }) => {
    const owner = await login(request);
    const block = await createBlock(owner);
    await login(request);
    for (const mode of ["start", "manual"] as const) expect((await log(request, mode, { scheduledBlockId: block.id })).status()).toBe(400);
    const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.id, block.id)));
    expect(saved).toMatchObject({ status: "planned", linkedTimeEntryId: null });
  });
});

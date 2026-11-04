import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db, getDb } from "../lib/db";
import { auditLogs, projects, scheduledWorkBlocks, timeEntries } from "../lib/db/schema";
import { stopTimer } from "../lib/timer-stop";

type Owner = { userId: string; workspaceId: string };
const at = (value: string) => new Date(`2026-01-${value}:00.000Z`);

test.describe("isolated atomic timer stops", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures into production.");
  test.setTimeout(90000);

  async function seed(request: APIRequestContext, overrides: Partial<typeof timeEntries.$inferInsert> = {}) {
    const workspace = `stop-atomic-${crypto.randomUUID()}`;
    const login = await request.get(`/api/test/login?${new URLSearchParams({ workspace, role: "owner", plan: "smb", email: `${workspace}@example.com` })}`);
    expect(login.ok(), await login.text()).toBeTruthy();
    const owner = await login.json() as Owner;
    const entryId = crypto.randomUUID();
    const blockId = crypto.randomUUID();
    const [project] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Client delivery" }).returning();
    const [block] = await db.insert(scheduledWorkBlocks).values({
      id: blockId, workspaceId: owner.workspaceId, userId: owner.userId, createdByUserId: owner.userId,
      projectId: project.id, title: "Client review", startsAt: at("12T23:30"), endsAt: at("13T00:30"),
      status: "in_progress", linkedTimeEntryId: entryId,
    }).returning();
    const [entry] = await db.insert(timeEntries).values({
      id: entryId, workspaceId: owner.workspaceId, userId: owner.userId, projectId: project.id, scheduledBlockId: block.id,
      taskId: "Review delivery", description: "Review the client delivery", source: "web", status: "draft",
      action: "Complimentary review", hourlyRate: 0, startedAt: at("12T23:30"), ...overrides,
    }).returning();
    return { owner, entry, block };
  }

  function stop(request: APIRequestContext, entryId: string, endedAt = at("13T00:30")) {
    return request.post("/api/timer/stop", { data: { entryId, endedAt: endedAt.toISOString() } });
  }

  test("competing midnight stops conserve time and record one continuation and audit trail", async ({ request }) => {
    const { owner, entry, block } = await seed(request);
    const responses = await Promise.all([stop(request, entry.id), stop(request, entry.id)]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 404]);
    const result = await responses.find((response) => response.ok())!.json();
    expect(result).toMatchObject({ durationSeconds: 3600, splitAcrossDays: true, adjustedForDailyLimit: false });
    const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId));
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)).toBe(3600);
    expect(entries.map((row) => row.id).sort()).toEqual([...result.entryIds].sort());
    for (const row of entries) expect(row).toMatchObject({ userId: owner.userId, projectId: entry.projectId, hourlyRate: 0, action: entry.action, source: "web", status: "draft" });
    expect(entries.find((row) => row.id !== entry.id)!.scheduledBlockId).toBeNull();
    const [savedBlock] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.id, block.id)));
    expect(savedBlock).toMatchObject({ status: "completed", linkedTimeEntryId: entry.id });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, owner.workspaceId));
    expect(audit.map((row) => row.eventType).sort()).toEqual(["timer_continued_after_midnight", "timer_stopped_split"]);
    expect((await stop(request, entry.id)).status()).toBe(404);
  });

  test("same-day, paused, multi-day and capacity-limited stops preserve existing totals", async ({ request }) => {
    for (const scenario of [
      { startedAt: at("12T09:00"), endedAt: at("12T11:00"), expected: 7200, count: 1 },
      { startedAt: at("12T09:00"), endedAt: at("12T11:00"), pausedAt: at("12T10:30"), accumulatedSeconds: 300, expected: 5100, count: 1 },
      { startedAt: at("12T23:30"), endedAt: at("14T00:30"), expected: 90000, count: 3 },
    ]) {
      const { owner, entry } = await seed(request, { startedAt: scenario.startedAt, isPaused: Boolean(scenario.pausedAt), pausedAt: scenario.pausedAt ?? null, accumulatedSeconds: scenario.accumulatedSeconds ?? 0 });
      const response = await stop(request, entry.id, scenario.endedAt);
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json()).durationSeconds).toBe(scenario.expected);
      const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId));
      expect(entries).toHaveLength(scenario.count);
      expect(entries.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)).toBe(scenario.expected);
    }
    const { owner, entry } = await seed(request, { startedAt: at("12T09:00") });
    await db.insert(timeEntries).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId, taskId: "Previously logged day", startedAt: at("12T00:00"), stoppedAt: at("13T00:00"), durationSeconds: 86400 });
    const limited = await stop(request, entry.id, at("12T10:00"));
    expect(limited.ok(), await limited.text()).toBeTruthy();
    expect(await limited.json()).toMatchObject({ durationSeconds: 0, adjustedForDailyLimit: true, trimmedSeconds: 3600 });
    const [saved] = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.id, entry.id)));
    expect(saved.durationSeconds).toBe(0);
  });

  test("real database rollback restores the original timer and block after continuation or audit failure", async ({ request }) => {
    for (const fault of ["continuation", "audit"] as const) {
      const { owner, entry, block } = await seed(request);
      const originalClient = getDb();
      type Transaction = Parameters<Parameters<typeof originalClient.transaction>[0]>[0];
      let continuationAttempts = 0;
      let injected = false;
      // Inject a failure into this test process only; the transaction and all
      // preceding writes still run against PostgreSQL. No schema change, server
      // backdoor, extra privilege, or production-accessible fault switch exists.
      globalThis.__sowledgerDbClient = new Proxy(originalClient, {
        get(target, property, receiver) {
          if (property === "transaction") return (callback: (tx: Transaction) => Promise<unknown>, config: Parameters<typeof target.transaction>[1]) => target.transaction(async (tx) => callback(new Proxy(tx, {
            get(transaction, txProperty, txReceiver) {
              if (txProperty === "insert") return (table: Parameters<Transaction["insert"]>[0]) => {
                if (table === timeEntries) continuationAttempts++;
                if ((fault === "continuation" && table === timeEntries && continuationAttempts === 2) || (fault === "audit" && table === auditLogs)) {
                  injected = true;
                  throw new Error(`Isolated ${fault} failure`);
                }
                return transaction.insert(table);
              };
              const value = Reflect.get(transaction, txProperty, txReceiver);
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          })), config);
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      try {
        await expect(stopTimer({ workspaceId: owner.workspaceId, userId: owner.userId, entryId: entry.id, endedAt: at("14T00:30") })).rejects.toThrow(`Isolated ${fault} failure`);
      } finally {
        globalThis.__sowledgerDbClient = originalClient;
      }
      expect(injected).toBe(true);
      expect(continuationAttempts).toBe(2);
      const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId));
      expect(entries).toEqual([entry]);
      const [savedBlock] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.id, block.id)));
      expect(savedBlock).toEqual(block);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, owner.workspaceId));
      expect(audit).toHaveLength(0);
      // Retry the normal HTTP endpoint after restoring the connection wrapper.
      const retried = await stop(request, entry.id, at("14T00:30"));
      expect(retried.ok(), await retried.text()).toBeTruthy();
      expect((await retried.json()).durationSeconds).toBe(90000);
    }
  });

  test("another workspace cannot stop the original owner's timer", async ({ request }) => {
    const original = await seed(request);
    await seed(request);
    expect((await stop(request, original.entry.id)).status()).toBe(404);
    const [unchanged] = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, original.owner.workspaceId), eq(timeEntries.id, original.entry.id)));
    expect(unchanged).toEqual(original.entry);
  });

  test("fractional midnight windows conserve persisted seconds and original timer identity", async ({ request }) => {
    for (const scenario of [
      { start: "2026-01-12T23:59:59.500Z", end: "2026-01-13T00:00:00.500Z", durations: [1], savedStart: "2026-01-13T00:00:00.000Z" },
      { start: "2026-01-12T23:59:58.100Z", end: "2026-01-13T00:00:01.900Z", durations: [1, 2], savedStart: "2026-01-12T23:59:58.100Z" },
      { start: "2026-01-12T23:59:59.750Z", end: "2026-01-13T00:00:00.250Z", durations: [1], savedStart: "2026-01-13T00:00:00.000Z" },
    ]) {
      const { owner, entry, block } = await seed(request, { startedAt: new Date(scenario.start) });
      const response = await stop(request, entry.id, new Date(scenario.end));
      expect(response.ok(), await response.text()).toBeTruthy();
      const result = await response.json();
      const saved = (await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId))).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      expect(saved.map((row) => row.durationSeconds)).toEqual(scenario.durations);
      expect(saved.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)).toBe(scenario.durations.reduce((sum, value) => sum + value, 0));
      expect(result.entryIds).toEqual(saved.map((row) => row.id));
      expect(saved[0]).toMatchObject({ id: entry.id, scheduledBlockId: block.id, hourlyRate: 0, action: entry.action, status: "draft" });
      expect(saved[0].startedAt.toISOString()).toBe(scenario.savedStart);
      for (const continued of saved.slice(1)) expect(continued.scheduledBlockId).toBeNull();
      const [savedBlock] = await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.id, block.id));
      expect(savedBlock).toMatchObject({ status: "completed", linkedTimeEntryId: entry.id });
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, owner.workspaceId), eq(auditLogs.timeEntryId, entry.id)));
      expect(audit).toHaveLength(1);
      expect(audit[0].diff).toMatchObject({ startedAt: { before: scenario.start, after: scenario.savedStart }, requestedStoppedAt: { after: scenario.end } });
      expect((await stop(request, entry.id, new Date(scenario.end))).status()).toBe(404);
    }
  });

  test("zero-net persisted timers retain requested endpoints and truthful pause evidence", async ({ request }) => {
    for (const scenario of [
      { start: "2026-01-12T09:00:00.000Z", end: "2026-01-12T09:00:00.000Z", pause: 0, excluded: 0 },
      { start: "2026-01-12T23:59:59.500Z", end: "2026-01-13T00:00:00.500Z", pause: 1, excluded: 1 },
      { start: "2026-01-12T23:30:00.000Z", end: "2026-01-14T00:30:00.000Z", pause: 90001, excluded: 90000 },
    ]) {
      const { owner, entry, block } = await seed(request, { startedAt: new Date(scenario.start), accumulatedSeconds: scenario.pause });
      const response = await stop(request, entry.id, new Date(scenario.end));
      expect(response.ok(), await response.text()).toBeTruthy();
      expect(await response.json()).toMatchObject({ entryId: entry.id, entryIds: [entry.id], durationSeconds: 0, splitAcrossDays: false, adjustedForDailyLimit: false, trimmedSeconds: 0, message: "Timer stopped. No additional time was recorded." });
      const saved = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId));
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ id: entry.id, durationSeconds: 0, scheduledBlockId: block.id });
      expect(saved[0].startedAt.toISOString()).toBe(scenario.start);
      expect(saved[0].stoppedAt?.toISOString()).toBe(scenario.end);
      const [savedBlock] = await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.id, block.id));
      expect(savedBlock).toMatchObject({ status: "completed", linkedTimeEntryId: entry.id });
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, owner.workspaceId));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ eventType: "timer_stopped_no_recorded_time", diff: {
        requestedStoppedAt: { after: scenario.end }, stoppedAt: { after: scenario.end },
        totalPausedSeconds: { after: scenario.pause }, excludedPauseSeconds: { after: scenario.excluded },
      } });
    }
  });

  test("invalid saved pause data leaves PostgreSQL timer, calendar and audit unchanged", async ({ request }) => {
    for (const overrides of [{ accumulatedSeconds: -1 }, { isPaused: true, pausedAt: null }]) {
      const { owner, entry, block } = await seed(request, overrides);
      const response = await stop(request, entry.id);
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ error: "The pause time for this timer is invalid. Contact support for help." });
      expect(await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId))).toEqual([entry]);
      expect(await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.id, block.id))).toEqual([block]);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, owner.workspaceId))).toHaveLength(0);
    }
  });
});

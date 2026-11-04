import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { lockPeriods, timeEntries } from "../lib/db/schema";

test.describe("calendar draft import", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");
  async function owner(request: APIRequestContext) {
    const suffix = crypto.randomUUID();
    const response = await request.get(`/api/test/login?workspace=calendar-import-${suffix}&email=import-${suffix}@example.com&plan=smb`);
    expect(response.ok()).toBeTruthy();
    return await response.json() as { workspaceId: string; userId: string };
  }
  const event = (id = crypto.randomUUID(), startsAt = "2026-10-01T09:00:00Z", endsAt = "2026-10-01T10:00:00Z") => ({ id, title: "Calendar work", startsAt, endsAt });
  const send = (request: APIRequestContext, events: unknown, provider = "google") => request.post("/api/integrations/calendar/import", { data: { provider, events } });
  const entries = (workspaceId: string) => db.select().from(timeEntries).where(eq(timeEntries.workspaceId, workspaceId));

  test("invalid or duplicate event input rejects the entire batch before writing", async ({ request }) => {
    const state = await owner(request);
    for (const events of [
      [event(), event("negative", "2026-10-01T11:00:00Z", "2026-10-01T10:00:00Z")],
      [event(), event("bad-date", "not-a-date")],
      [event("duplicate"), event("duplicate")],
      [{ ...event(), title: "" }],
      "not-an-array",
    ]) {
      expect((await send(request, events)).status()).toBe(400);
      expect(await entries(state.workspaceId)).toHaveLength(0);
    }
  });

  test("retries and concurrent imports do not duplicate the same provider event", async ({ request }) => {
    const state = await owner(request);
    const events = [event()];
    const responses = await Promise.all([send(request, events), send(request, events)]);
    expect(responses.map(response => response.status())).toEqual([200, 200]);
    expect(await entries(state.workspaceId)).toHaveLength(1);
    const repeated = await send(request, events);
    expect(await repeated.json()).toMatchObject({ imported: 0, skipped: 1 });
    expect(await entries(state.workspaceId)).toHaveLength(1);
    // Identical provider IDs from a different provider are independent.
    expect((await send(request, events, "outlook")).status()).toBe(200);
    expect(await entries(state.workspaceId)).toHaveLength(2);
  });

  test("locked periods roll back all entries in a batch", async ({ request }) => {
    const state = await owner(request);
    await db.insert(lockPeriods).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, lockedByUserId: state.userId, periodStart: new Date("2026-10-01T09:00:00Z"), periodEnd: new Date("2026-10-01T10:00:00Z"), reason: "Reviewed billing period" });
    const response = await send(request, [event("first", "2026-10-01T07:00:00Z", "2026-10-01T08:00:00Z"), event("locked")]);
    expect(response.status()).toBe(409);
    expect(await entries(state.workspaceId)).toHaveLength(0);
  });

  test("daily capacity applies to the entire batch and rejects without partial saves", async ({ request }) => {
    const state = await owner(request);
    const response = await send(request, [event("first", "2026-10-01T00:00:00Z", "2026-10-01T20:00:00Z"), event("over-limit", "2026-10-01T08:00:00Z", "2026-10-01T13:00:00Z")]);
    expect(response.status()).toBe(409);
    expect(await entries(state.workspaceId)).toHaveLength(0);
  });

  test("cross-midnight imports conserve duration across daily segments and replay as one event", async ({ request }) => {
    const state = await owner(request);
    const events = [event("overnight", "2026-10-01T23:00:00Z", "2026-10-02T01:00:00Z")];
    const response = await send(request, events);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1, skipped: 0 });
    const saved = await entries(state.workspaceId);
    expect(saved).toHaveLength(2);
    expect(saved.map(row => row.durationSeconds)).toEqual([3600, 3600]);
    expect(saved.every(row => row.status === "draft" && row.source === "calendar" && row.userId === state.userId)).toBe(true);
    expect((await send(request, events)).status()).toBe(200);
    expect(await entries(state.workspaceId)).toHaveLength(2);
  });

  test("legacy imports are not guessed or duplicated", async ({ request }) => {
    const state = await owner(request);
    const imported = event("legacy-provider-id");
    await db.insert(timeEntries).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, userId: state.userId, taskId: `calendar:${imported.id}`, startedAt: new Date(imported.startsAt), stoppedAt: new Date(imported.endsAt), durationSeconds: 3600, source: "calendar" });
    const response = await send(request, [imported]);
    expect(response.status()).toBe(409);
    expect(await response.text()).toMatch(/older calendar connection/);
    expect(await entries(state.workspaceId)).toHaveLength(1);
  });

  test("fractional imports omit zero fragments, retain geometric identity suffixes and replay once", async ({ request }) => {
    for (const scenario of [
      { start: "2026-10-01T23:59:59.500Z", end: "2026-10-02T00:00:00.500Z", durations: [1], indices: [1] },
      { start: "2026-10-01T23:59:58.100Z", end: "2026-10-02T00:00:01.900Z", durations: [1, 2], indices: [0, 1] },
      { start: "2026-10-01T23:59:59.750Z", end: "2026-10-02T00:00:00.250Z", durations: [1], indices: [1] },
    ]) {
      const state = await owner(request);
      const imported = event("fractional-midnight", scenario.start, scenario.end);
      const identity = createHash("sha256").update(JSON.stringify([state.workspaceId, state.userId, "google", imported.id])).digest("hex");
      const expectedIds = scenario.indices.map((index) => `calendar-${identity}-${index}`);
      const responses = await Promise.all([send(request, [imported]), send(request, [imported])]);
      expect(responses.map((response) => response.status())).toEqual([200, 200]);
      const results = await Promise.all(responses.map((response) => response.json()));
      expect(results.map((result) => result.imported).sort()).toEqual([0, 1]);
      expect(results.find((result) => result.imported === 1).importedIds).toEqual(expectedIds);
      const saved = (await entries(state.workspaceId)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      expect(saved.map((row) => row.id)).toEqual(expectedIds);
      expect(saved.map((row) => row.durationSeconds)).toEqual(scenario.durations);
      expect(saved.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)).toBe(scenario.durations.reduce((sum, value) => sum + value, 0));
      expect(saved.every((row) => row.taskId === `calendar:google:${identity}` && row.userId === state.userId)).toBe(true);
      expect(await (await send(request, [imported])).json()).toMatchObject({ imported: 0, skipped: 1, importedIds: [] });
      expect(await entries(state.workspaceId)).toEqual(expect.arrayContaining(saved));
      expect(await entries(state.workspaceId)).toHaveLength(saved.length);
    }
  });

  test("later locked event rolls back a fractional import's only retained identity", async ({ request }) => {
    const state = await owner(request);
    await db.insert(lockPeriods).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, lockedByUserId: state.userId, periodStart: new Date("2026-10-02T09:00:00Z"), periodEnd: new Date("2026-10-02T10:00:00Z"), reason: "Reviewed billing period" });
    const fractional = event("fractional-first", "2026-10-01T23:59:59.500Z", "2026-10-02T00:00:00.500Z");
    expect((await send(request, [fractional, event("locked-later", "2026-10-02T09:00:00Z", "2026-10-02T10:00:00Z")])).status()).toBe(409);
    expect(await entries(state.workspaceId)).toHaveLength(0);
    expect(await (await send(request, [fractional])).json()).toMatchObject({ imported: 1, skipped: 0 });
    expect((await entries(state.workspaceId)).map((row) => row.durationSeconds)).toEqual([1]);
  });
});

import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db, getDb } from "../lib/db";
import { integrationConnections, integrationSyncRecords, projects, scheduledWorkBlocks, timeEntries, userActions } from "../lib/db/schema";
import { createScheduledBatch } from "../lib/schedule-batch";

type Actor = { workspaceId: string; userId: string; slug: string; email: string };
const range = (day = 1, hour = 9) => ({ startsAt: `2026-12-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`, endsAt: `2026-12-${String(day).padStart(2, "0")}T${String(hour + 1).padStart(2, "0")}:00:00.000Z` });
const batch = (overrides: Record<string, unknown> = {}) => ({ operationId: crypto.randomUUID(), title: "Client delivery", occurrences: [range(1), range(2), range(3)], ...overrides });

test.describe("atomic scheduling batches", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");
  test.setTimeout(90000);

  async function login(request: APIRequestContext, options: { slug?: string; email?: string; role?: string } = {}): Promise<Actor> {
    const slug = options.slug ?? `schedule-batch-${crypto.randomUUID()}`;
    const email = options.email ?? `${crypto.randomUUID()}@example.com`;
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace: slug, email, role: options.role ?? "owner", plan: "smb" })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    return { ...(await response.json()), slug, email };
  }
  const send = (request: APIRequestContext, data: unknown) => request.post("/api/schedule", { data });
  const blocks = (workspaceId: string) => db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.workspaceId, workspaceId));

  async function plan(actor: Actor, overrides: Partial<typeof scheduledWorkBlocks.$inferInsert> = {}) {
    const [block] = await db.insert(scheduledWorkBlocks).values({ id: crypto.randomUUID(), workspaceId: actor.workspaceId, userId: actor.userId, createdByUserId: actor.userId, title: "Existing plan", startsAt: new Date(range().startsAt), endsAt: new Date(range().endsAt), ...overrides }).returning();
    return block;
  }

  test("repeat creation is one atomic operation and retries return its original receipt", async ({ request }) => {
    const actor = await login(request);
    const payload = batch();
    const first = await send(request, payload);
    expect(first.status(), await first.text()).toBe(200);
    const receipt = await first.json();
    expect(receipt).toMatchObject({ ok: true, replayed: false, replacedBlockIds: [], warnings: [] });
    expect(receipt.blockIds).toHaveLength(3);
    expect((await blocks(actor.workspaceId)).map(row => row.id).sort()).toEqual([...receipt.blockIds].sort());
    // Simulate a committed save whose response was lost; no new rows on retry.
    const repeated = await send(request, payload);
    expect(repeated.status()).toBe(200);
    expect(await repeated.json()).toMatchObject({ blockIds: receipt.blockIds, replayed: true });
    expect(await blocks(actor.workspaceId)).toHaveLength(3);
  });

  test("concurrent same-key requests serialize and a changed payload cannot reuse a saved key", async ({ request }) => {
    const actor = await login(request);
    const payload = batch();
    const responses = await Promise.all([send(request, payload), send(request, payload)]);
    expect(responses.map(response => response.status())).toEqual([200, 200]);
    const receipts = await Promise.all(responses.map(response => response.json()));
    expect(receipts.map(receipt => receipt.replayed).sort()).toEqual([false, true]);
    expect(receipts[0].blockIds).toEqual(receipts[1].blockIds);
    expect(await blocks(actor.workspaceId)).toHaveLength(3);
    expect((await send(request, { ...payload, title: "Changed after lost response" })).status()).toBe(409);
    const changedKey = crypto.randomUUID();
    const competing = await Promise.all([send(request, batch({ operationId: changedKey, title: "First" })), send(request, batch({ operationId: changedKey, title: "Second" }))]);
    expect(competing.map(response => response.status()).sort()).toEqual([200, 409]);
    expect(await blocks(actor.workspaceId)).toHaveLength(6);
  });

  test("replace planned saves all replacements and the new plan together", async ({ request }) => {
    const actor = await login(request);
    const old = await db.insert(scheduledWorkBlocks).values([0, 1].map(index => ({
      id: crypto.randomUUID(), workspaceId: actor.workspaceId, userId: actor.userId, createdByUserId: actor.userId,
      title: `Old plan ${index}`, startsAt: new Date(range(1).startsAt), endsAt: new Date(range(1).endsAt),
    }))).returning();
    const payload = batch({ occurrences: [range(1)], replace: old.map(block => ({ blockId: block.id, expectedUpdatedAt: block.updatedAt.toISOString() })) });
    const response = await send(request, payload);
    expect(response.status(), await response.text()).toBe(200);
    const receipt = await response.json();
    expect(receipt.blockIds).toHaveLength(1);
    expect([...receipt.replacedBlockIds].sort()).toEqual(old.map(block => block.id).sort());
    const saved = await blocks(actor.workspaceId);
    expect(saved).toHaveLength(3);
    expect(saved.filter(block => old.some(prior => prior.id === block.id)).every(block => block.status === "skipped")).toBe(true);
    // Receipt lookup precedes stale version validation on a replay.
    expect(await (await send(request, payload)).json()).toMatchObject({ replayed: true, blockIds: receipt.blockIds });
    await db.update(scheduledWorkBlocks).set({ title: "Later correction", status: "canceled" }).where(and(eq(scheduledWorkBlocks.workspaceId, actor.workspaceId), eq(scheduledWorkBlocks.id, receipt.blockIds[0])));
    expect(await (await send(request, payload)).json()).toMatchObject({ replayed: true });
    expect((await blocks(actor.workspaceId)).find(block => block.id === receipt.blockIds[0])).toMatchObject({ title: "Later correction", status: "canceled" });
  });

  test("invalid batches save nothing and do not reserve their operation key", async ({ request }) => {
    const actor = await login(request);
    const operationId = crypto.randomUUID();
    const invalid = [
      { occurrences: [] }, { occurrences: Array.from({ length: 13 }, (_, index) => range(index + 1)) },
      { occurrences: [range(), range()] },
      { occurrences: [range(), { startsAt: "not-a-date", endsAt: range().endsAt }] },
      { occurrences: [{ startsAt: "2026-02-30T09:00:00Z", endsAt: "2026-03-02T10:00:00Z" }] },
      { occurrences: [{ startsAt: "2026-12-01T09:00:00", endsAt: "2026-12-01T10:00:00" }] },
      { occurrences: [{ startsAt: range().endsAt, endsAt: range().startsAt }] },
      { title: "" }, { tags: [1] }, { operationId: "not-a-uuid" },
      { replace: [{ blockId: "same", expectedUpdatedAt: range().startsAt }] },
      { occurrences: [range()], replace: Array.from({ length: 2 }, () => ({ blockId: "same", expectedUpdatedAt: range().startsAt })) },
    ];
    for (const input of invalid) {
      const response = await send(request, batch({ operationId, ...input }));
      expect(response.status(), await response.text()).toBe(400);
      expect(await blocks(actor.workspaceId)).toHaveLength(0);
    }
    expect((await send(request, batch({ operationId }))).status()).toBe(200);
    expect(await blocks(actor.workspaceId)).toHaveLength(3);
  });

  test("distinct overlaps save with warnings and explicit DST timestamps retain their instants", async ({ request }) => {
    const actor = await login(request);
    const response = await send(request, batch({ occurrences: [range(), { startsAt: "2026-12-01T09:30:00Z", endsAt: "2026-12-01T10:30:00Z" }] }));
    expect(response.status()).toBe(200);
    expect((await response.json()).warnings.join(" ")).toMatch(/overlap/i);
    const dst = await send(request, batch({ occurrences: [
      { startsAt: "2026-03-07T09:00:00-05:00", endsAt: "2026-03-07T10:00:00-05:00" },
      { startsAt: "2026-03-08T09:00:00-04:00", endsAt: "2026-03-08T10:00:00-04:00" },
    ] }));
    expect(dst.status()).toBe(200);
    const receipt = await dst.json();
    const saved = (await blocks(actor.workspaceId)).filter(block => receipt.blockIds.includes(block.id));
    expect(saved.map(block => block.startsAt.toISOString()).sort()).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
  });

  test("real database insertion failures roll back the whole series and replacement", async ({ request }) => {
    for (const replacement of [false, true]) {
      const actor = await login(request);
      const old = await plan(actor);
      const body = batch(replacement ? { occurrences: [range()], replace: [{ blockId: old.id, expectedUpdatedAt: old.updatedAt.toISOString() }] } : {});
      const originalClient = getDb();
      type Transaction = Parameters<Parameters<typeof originalClient.transaction>[0]>[0];
      let inserts = 0;
      let injected = false;
      // Fault exists in this test process only. Prior mutations and rollback use
      // the actual isolated PostgreSQL database, with no DDL or server backdoor.
      globalThis.__sowledgerDbClient = new Proxy(originalClient, {
        get(target, property, receiver) {
          if (property === "transaction") return (callback: (tx: Transaction) => Promise<unknown>) => target.transaction(async tx => callback(new Proxy(tx, {
            get(transaction, txProperty, txReceiver) {
              if (txProperty === "insert") return (table: Parameters<Transaction["insert"]>[0]) => {
                if (table === scheduledWorkBlocks && ++inserts === (replacement ? 1 : 2)) { injected = true; throw new Error("Isolated scheduling insert failure"); }
                return transaction.insert(table);
              };
              const value = Reflect.get(transaction, txProperty, txReceiver);
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          })));
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      try {
        await expect(createScheduledBatch({ workspaceId: actor.workspaceId, actorUserId: actor.userId, canManageOthers: true, body })).rejects.toThrow("Isolated scheduling insert failure");
      } finally {
        globalThis.__sowledgerDbClient = originalClient;
      }
      expect(injected).toBe(true);
      expect(await blocks(actor.workspaceId)).toEqual([old]);
      expect((await send(request, body)).status()).toBe(200);
      expect(await blocks(actor.workspaceId)).toHaveLength(replacement ? 2 : 4);
    }
  });

  test("stale, consumed, unavailable and imported replacements preserve every selected plan", async ({ request }) => {
    const actor = await login(request);
    const [connection] = await db.insert(integrationConnections).values({ id: crypto.randomUUID(), workspaceId: actor.workspaceId, createdByUserId: actor.userId, provider: "google_calendar", status: "disabled" }).returning();
    for (const kind of ["stale", "reverse", "forward", "in_progress", "completed", "canceled", "skipped", "unavailable", "imported", "not-overlapping"]) {
      const good = await plan(actor);
      const bad = await plan(actor, kind === "reverse" ? { linkedTimeEntryId: crypto.randomUUID() } : kind === "unavailable" ? { tags: ["ooo"] } : ["in_progress", "completed", "canceled", "skipped"].includes(kind) ? { status: kind as "in_progress" | "completed" | "canceled" | "skipped" } : kind === "not-overlapping" ? { startsAt: new Date(range(2).startsAt), endsAt: new Date(range(2).endsAt) } : {});
      if (kind === "forward") await db.insert(timeEntries).values({ id: crypto.randomUUID(), workspaceId: actor.workspaceId, userId: actor.userId, scheduledBlockId: bad.id, taskId: "Recorded work", startedAt: bad.startsAt, stoppedAt: bad.endsAt, durationSeconds: 3600 });
      if (kind === "imported") await db.insert(integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: actor.workspaceId, connectionId: connection.id, provider: "google_calendar", resourceType: "scheduled_work_block", resourceId: bad.id, externalId: crypto.randomUUID(), metadata: { direction: "google_busy_to_sowledger" } });
      const body = batch({ occurrences: [range()], replace: [good, bad].map(block => ({ blockId: block.id, expectedUpdatedAt: kind === "stale" && block.id === bad.id ? "2020-01-01T00:00:00Z" : block.updatedAt.toISOString() })) });
      const response = await send(request, body);
      expect(response.status(), `${kind}: ${await response.text()}`).toBe(409);
      const saved = await blocks(actor.workspaceId);
      expect(saved.find(block => block.id === good.id)).toEqual(good);
      expect(saved.find(block => block.id === bad.id)).toEqual(bad);
    }
  });

  test("workspace, assignee and work-type boundaries apply to every batch", async ({ request }) => {
    const actor = await login(request);
    const teammate = await login(request, { slug: actor.slug, role: "member" });
    const teammateBlock = await plan(teammate);
    const [teammateAction] = await db.insert(userActions).values({ id: crypto.randomUUID(), workspaceId: actor.workspaceId, userId: teammate.userId, name: "Teammate work", hourlyRate: 0 }).returning();
    const foreign = await login(request);
    const foreignBlock = await plan(foreign);
    const [foreignProject] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: foreign.workspaceId, name: "Foreign project" }).returning();
    await login(request, { slug: actor.slug, email: actor.email });
    for (const data of [{ userId: foreign.userId }, { projectId: foreignProject.id }, { actionId: teammateAction.id }]) expect((await send(request, batch(data))).status()).toBe(400);
    expect((await send(request, batch({ occurrences: [range()], replace: [{ blockId: foreignBlock.id, expectedUpdatedAt: foreignBlock.updatedAt.toISOString() }] }))).status()).toBe(404);
    expect((await send(request, batch({ occurrences: [range()], replace: [{ blockId: teammateBlock.id, expectedUpdatedAt: teammateBlock.updatedAt.toISOString() }] }))).status()).toBe(409);
    expect((await send(request, batch({ userId: teammate.userId, actionId: teammateAction.id }))).status()).toBe(200);
    // The isolated app enables bootstrap-owner recovery. Keep a separate owner
    // so this deliberately demoted actor remains a member when authenticated.
    await login(request, { slug: actor.slug, role: "owner" });
    await login(request, { slug: actor.slug, email: actor.email, role: "member" });
    expect((await (await request.get("/api/auth/me")).json()).session.role).toBe("member");
    expect((await send(request, batch({ userId: teammate.userId }))).status()).toBe(403);
    expect((await send(request, batch({ occurrences: [range()] }))).status()).toBe(200);
    await login(request, { slug: actor.slug, email: actor.email, role: "client" });
    expect((await send(request, batch())).status()).toBe(403);
    const unauthenticated = await request.post("/api/schedule", { headers: { cookie: "sowledger_session=invalid" }, data: batch() });
    expect(unauthenticated.status()).toBe(401);
    const missingSession = await request.post("/api/schedule", { headers: { cookie: "" }, data: batch(), maxRedirects: 0 });
    expect(missingSession.status()).toBe(307);
    expect(missingSession.headers().location).toContain("/login");
    expect((await blocks(foreign.workspaceId))).toEqual([foreignBlock]);
  });

  test("replacement races safely against timer start and manual completion", async ({ request }) => {
    for (const consumption of ["start", "manual"]) {
      const actor = await login(request);
      const old = await plan(actor);
      const body = batch({ occurrences: [range()], replace: [{ blockId: old.id, expectedUpdatedAt: old.updatedAt.toISOString() }] });
      const timerBody = consumption === "start" ? { scheduledBlockId: old.id, taskId: "Racing work" } : { scheduledBlockId: old.id, taskId: "Racing work", startedAt: range().startsAt, stoppedAt: range().endsAt };
      const responses = await Promise.all([send(request, body), request.post(`/api/timer/${consumption}`, { data: timerBody })]);
      expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
      const saved = await blocks(actor.workspaceId);
      const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, actor.workspaceId));
      const original = saved.find(block => block.id === old.id)!;
      if (responses[0].ok()) {
        expect(saved).toHaveLength(2);
        expect(original.status).toBe("skipped");
        expect(entries).toHaveLength(0);
      } else {
        expect(saved).toHaveLength(1);
        expect(entries).toHaveLength(1);
        expect(original.linkedTimeEntryId).toBe(entries[0].id);
        expect(original.status).toBe(consumption === "start" ? "in_progress" : "completed");
      }
    }
  });

  test("oppositely ordered replacement requests cannot deadlock or both consume the plans", async ({ request }) => {
    const actor = await login(request);
    const old = [await plan(actor), await plan(actor)];
    const replace = old.map(block => ({ blockId: block.id, expectedUpdatedAt: block.updatedAt.toISOString() }));
    const responses = await Promise.all([send(request, batch({ occurrences: [range()], replace })), send(request, batch({ occurrences: [range()], replace: [...replace].reverse() }))]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
    expect(await blocks(actor.workspaceId)).toHaveLength(3);
  });

  test("legacy single-create remains available beside batches", async ({ request }) => {
    const actor = await login(request);
    const response = await send(request, { title: "Existing caller", ...range() });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, block: { title: "Existing caller", userId: actor.userId, workspaceId: actor.workspaceId } });
  });
});

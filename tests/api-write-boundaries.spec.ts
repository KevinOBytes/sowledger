import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { generateApiKeyMaterial, type ApiScope } from "../lib/api-keys";
import { db } from "../lib/db";
import { apiKeyRequests, apiKeys, projects, scheduledWorkBlocks, timeEntries } from "../lib/db/schema";
import { ensureMembership, ensureUser } from "../lib/store";

type WorkspaceOwner = { userId: string; workspaceId: string };

test.describe("public API write boundaries", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");
  test.setTimeout(90000);

  async function ownerSession(request: APIRequestContext, plan = "smb") {
    const suffix = crypto.randomUUID();
    const query = new URLSearchParams({ workspace: `api-boundary-${suffix}`, email: `api-owner-${suffix}@example.com`, plan });
    const response = await request.get(`/api/test/login?${query}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    return await response.json() as WorkspaceOwner;
  }

  async function apiKey(owner: WorkspaceOwner, scopes: ApiScope[]) {
    const material = generateApiKeyMaterial();
    const id = crypto.randomUUID();
    await db.insert(apiKeys).values({
      id, workspaceId: owner.workspaceId, createdByUserId: owner.userId,
      name: "Disposable boundary test", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes,
    });
    return { id, headers: { authorization: `Bearer ${material.rawKey}` } };
  }

  async function coworker(owner: WorkspaceOwner) {
    const user = await ensureUser(`api-coworker-${crypto.randomUUID()}@example.com`);
    await ensureMembership(user.id, owner.workspaceId, "member");
    return { ...owner, userId: user.id };
  }

  async function entry(owner: WorkspaceOwner, status: "draft" | "submitted" | "approved" = "draft") {
    const [created] = await db.insert(timeEntries).values({
      id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId,
      taskId: "api-boundary-test", description: "Original private work notes", status,
      startedAt: new Date("2026-10-01T09:00:00Z"), stoppedAt: new Date("2026-10-01T10:00:00Z"),
      durationSeconds: 3600, source: "manual",
    }).returning();
    return created;
  }

  async function block(owner: WorkspaceOwner, overrides: Partial<typeof scheduledWorkBlocks.$inferInsert> = {}) {
    const [created] = await db.insert(scheduledWorkBlocks).values({
      id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId,
      createdByUserId: owner.userId, title: "Original work plan", status: "planned",
      startsAt: new Date("2026-10-01T09:00:00Z"), endsAt: new Date("2026-10-01T10:00:00Z"),
      ...overrides,
    }).returning();
    return created;
  }

  test("write:time without impersonation cannot edit another member's entries", async ({ request }) => {
    const owner = await ownerSession(request);
    const colleague = await coworker(owner);
    const otherEntry = await entry(colleague);
    const key = await apiKey(owner, ["write:time"]);
    const response = await request.patch("/api/v1/time-entries", {
      headers: key.headers, data: { entryId: otherEntry.id, description: "Unauthorized replacement", status: "submitted" },
    });
    expect(response.status()).toBe(403);
    const [saved] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, otherEntry.id), eq(timeEntries.workspaceId, owner.workspaceId)));
    expect(saved).toMatchObject({ description: "Original private work notes", status: "draft", userId: colleague.userId });
    const usage = await db.select().from(apiKeyRequests).where(and(eq(apiKeyRequests.apiKeyId, key.id), eq(apiKeyRequests.workspaceId, owner.workspaceId)));
    expect(usage.map((row) => row.status)).toContain(403);
  });

  test("write:schedule cannot take another member's block by assigning it to the key owner", async ({ request }) => {
    const owner = await ownerSession(request);
    const colleague = await coworker(owner);
    const otherBlock = await block(colleague);
    const key = await apiKey(owner, ["write:schedule"]);
    const response = await request.patch("/api/v1/schedule", {
      headers: key.headers, data: { blockId: otherBlock.id, userId: owner.userId, title: "Taken over" },
    });
    expect(response.status()).toBe(403);
    const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, otherBlock.id), eq(scheduledWorkBlocks.workspaceId, owner.workspaceId)));
    expect(saved).toMatchObject({ title: "Original work plan", userId: colleague.userId });
  });

  test("write:schedule cannot cancel another member's block without impersonation", async ({ request }) => {
    const owner = await ownerSession(request);
    const colleague = await coworker(owner);
    const otherBlock = await block(colleague);
    const key = await apiKey(owner, ["write:schedule"]);
    const response = await request.delete(`/api/v1/schedule?id=${otherBlock.id}`, { headers: key.headers });
    expect(response.status()).toBe(403);
    const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, otherBlock.id), eq(scheduledWorkBlocks.workspaceId, owner.workspaceId)));
    expect(saved.status).toBe("planned");
  });

  test("self writes and explicitly scoped impersonation work without bypassing workspace or approval locks", async ({ request }) => {
    const owner = await ownerSession(request);
    const colleague = await coworker(owner);
    const ownEntry = await entry(owner);
    const ownBlock = await block(owner);
    const otherEntry = await entry(colleague, "submitted");
    const otherBlock = await block(colleague);
    const approvedEntry = await entry(colleague, "approved");
    const key = await apiKey(owner, ["write:time", "write:schedule"]);
    const privileged = await apiKey(owner, ["write:time", "write:schedule", "impersonate:user"]);

    expect((await request.patch("/api/v1/time-entries", { headers: key.headers, data: { entryId: ownEntry.id, description: "Updated by owner" } })).status()).toBe(200);
    expect((await request.patch("/api/v1/schedule", { headers: key.headers, data: { blockId: ownBlock.id, title: "My revised plan" } })).status()).toBe(200);
    expect((await request.patch("/api/v1/schedule", { headers: key.headers, data: { blockId: ownBlock.id, userId: colleague.userId } })).status()).toBe(403);
    expect((await request.delete(`/api/v1/schedule?id=${ownBlock.id}`, { headers: key.headers })).status()).toBe(200);
    expect((await request.patch("/api/v1/time-entries", { headers: privileged.headers, data: { entryId: otherEntry.id, description: "Authorized revision" } })).status()).toBe(200);
    expect((await request.patch("/api/v1/schedule", { headers: privileged.headers, data: { blockId: otherBlock.id, userId: owner.userId, title: "Authorized reassignment" } })).status()).toBe(200);
    const cancelable = await block(colleague);
    expect((await request.delete(`/api/v1/schedule?id=${cancelable.id}`, { headers: privileged.headers })).status()).toBe(200);
    expect((await request.patch("/api/v1/time-entries", { headers: privileged.headers, data: { entryId: approvedEntry.id, description: "Cannot replace approved evidence" } })).status()).toBe(409);

    const foreignOwner = await ownerSession(request);
    const foreignEntry = await entry(foreignOwner);
    const foreignBlock = await block(foreignOwner);
    expect((await request.patch("/api/v1/time-entries", { headers: privileged.headers, data: { entryId: foreignEntry.id, description: "Not authorized across tenants" } })).status()).toBe(404);
    expect((await request.patch("/api/v1/schedule", { headers: privileged.headers, data: { blockId: foreignBlock.id, title: "Not authorized across tenants" } })).status()).toBe(404);
    expect((await request.delete(`/api/v1/schedule?id=${foreignBlock.id}`, { headers: privileged.headers })).status()).toBe(404);
    const [untouched] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, foreignBlock.id), eq(scheduledWorkBlocks.workspaceId, foreignOwner.workspaceId)));
    expect(untouched.status).toBe("planned");
  });

  test("public API project creation observes the same free-plan cap as app creation", async ({ request }) => {
    const owner = await ownerSession(request, "free");
    const key = await apiKey(owner, ["write:projects"]);
    for (const name of ["First project", "Second project"]) {
      expect((await request.post("/api/v1/projects", { headers: key.headers, data: { name } })).status()).toBe(201);
    }
    const denied = await request.post("/api/v1/projects", { headers: key.headers, data: { name: "Beyond plan" } });
    expect(denied.status()).toBe(402);
    expect((await request.post("/api/projects", { data: { name: "Also beyond plan" } })).status()).toBe(402);
    expect(await db.select().from(projects).where(eq(projects.workspaceId, owner.workspaceId))).toHaveLength(2);
  });

  test("simultaneous API and app creation cannot both consume the last project slot", async ({ request }) => {
    const owner = await ownerSession(request, "free");
    const key = await apiKey(owner, ["write:projects"]);
    await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Existing project" });
    const results = await Promise.all([
      request.post("/api/v1/projects", { headers: key.headers, data: { name: "API contender" } }),
      request.post("/api/projects", { data: { name: "App contender" } }),
    ]);
    expect(results.filter((result) => result.ok())).toHaveLength(1);
    expect(results.filter((result) => result.status() === 402)).toHaveLength(1);
    expect(await db.select().from(projects).where(eq(projects.workspaceId, owner.workspaceId))).toHaveLength(2);
  });

  function apiTime(owner: WorkspaceOwner, blockId: string) {
    return {
      userId: owner.userId, scheduledBlockId: blockId, startedAt: "2026-10-01T09:00:00Z", stoppedAt: "2026-10-01T10:00:00Z",
      description: "API logged work", hourlyRate: 0, status: "submitted",
    };
  }

  test("API calendar time completes its block once and retains explicit zero rates and submission", async ({ request }) => {
    const owner = await ownerSession(request);
    const planned = await block(owner);
    const key = await apiKey(owner, ["write:time"]);
    const response = await request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(owner, planned.id) });
    expect(response.status()).toBe(201);
    const created = (await response.json()).entry;
    expect(created).toMatchObject({ userId: owner.userId, hourlyRate: 0, status: "submitted", source: "manual", scheduledBlockId: planned.id });
    const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, planned.id), eq(scheduledWorkBlocks.workspaceId, owner.workspaceId)));
    expect(saved).toMatchObject({ status: "completed", linkedTimeEntryId: created.id });
    expect((await request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(owner, planned.id) })).status()).toBe(409);
    expect(await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.scheduledBlockId, planned.id)))).toHaveLength(1);
  });

  test("API calendar time rejects nonplanned, linked, and previously consumed blocks", async ({ request }) => {
    const owner = await ownerSession(request);
    const key = await apiKey(owner, ["write:time"]);
    for (const overrides of [
      ...(["in_progress", "completed", "skipped", "canceled"] as const).map((status) => ({ status })),
      { linkedTimeEntryId: crypto.randomUUID() },
    ]) {
      const planned = await block(owner, overrides);
      expect((await request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(owner, planned.id) })).status()).toBe(409);
    }
    const consumed = await block(owner);
    const logged = await entry(owner);
    await db.update(timeEntries).set({ scheduledBlockId: consumed.id }).where(and(eq(timeEntries.id, logged.id), eq(timeEntries.workspaceId, owner.workspaceId)));
    expect((await request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(owner, consumed.id) })).status()).toBe(409);
    expect(await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId))).toHaveLength(1);
  });

  test("API calendar time and app start or logging compete for exactly one block consumption", async ({ request }) => {
    const owner = await ownerSession(request);
    const key = await apiKey(owner, ["write:time"]);
    for (const competitor of ["api", "start", "manual"]) {
      const planned = await block(owner);
      const first = request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(owner, planned.id) });
      const second = competitor === "api"
        ? request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(owner, planned.id) })
        : request.post(`/api/timer/${competitor}`, { data: { ...apiTime(owner, planned.id), taskId: "App competitor" } });
      const responses = await Promise.all([first, second]);
      expect(responses.filter((response) => response.ok())).toHaveLength(1);
      expect(responses.filter((response) => response.status() === 409)).toHaveLength(1);
      const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.scheduledBlockId, planned.id)));
      expect(entries).toHaveLength(1);
      const [saved] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, planned.id), eq(scheduledWorkBlocks.workspaceId, owner.workspaceId)));
      expect(saved).toMatchObject({ status: entries[0].stoppedAt ? "completed" : "in_progress", linkedTimeEntryId: entries[0].id });
    }
  });

  test("API calendar consumption preserves impersonation, owner, tenant, and unavailable boundaries", async ({ request }) => {
    const owner = await ownerSession(request);
    const colleague = await coworker(owner);
    const planned = await block(colleague);
    const key = await apiKey(owner, ["write:time"]);
    const privileged = await apiKey(owner, ["write:time", "impersonate:user"]);
    expect((await request.post("/api/v1/time-entries", { headers: key.headers, data: apiTime(colleague, planned.id) })).status()).toBe(403);
    expect((await request.post("/api/v1/time-entries", { headers: privileged.headers, data: apiTime(owner, planned.id) })).status()).toBe(400);
    expect((await request.post("/api/v1/time-entries", { headers: privileged.headers, data: apiTime(colleague, planned.id) })).status()).toBe(201);
    const unavailable = await block(owner, { tags: ["external-calendar"] });
    expect((await request.post("/api/v1/time-entries", { headers: privileged.headers, data: apiTime(owner, unavailable.id) })).status()).toBe(400);
    const foreign = await ownerSession(request);
    const foreignBlock = await block(foreign);
    expect((await request.post("/api/v1/time-entries", { headers: privileged.headers, data: apiTime(owner, foreignBlock.id) })).status()).toBe(400);
    const [untouched] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, foreignBlock.id), eq(scheduledWorkBlocks.workspaceId, foreign.workspaceId)));
    expect(untouched).toMatchObject({ status: "planned", linkedTimeEntryId: null });
  });
});

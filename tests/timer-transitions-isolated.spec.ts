import { expect, test, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { auditLogs, scheduledWorkBlocks, timeEntries, users, workspaces } from "../lib/db/schema";
import { deadline, operation, reachedBlocker, type Action, type Identity, type Operation, type Outcome } from "./helpers/timer-transition-fixtures";

const startMs = Date.parse("2026-01-12T12:00:00.000Z");
const at = (seconds: number) => new Date(startMs + seconds * 1000);
type Owner = { workspaceId: string; userId: string };
type Seed = { owner: Owner; workspace: string; entry: typeof timeEntries.$inferSelect; block: typeof scheduledWorkBlocks.$inferSelect };

test.describe("atomic timer transitions: authenticated HTTP and reached real-PG row barriers", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable PostgreSQL only; never production fixtures.");
  test.setTimeout(45000);
  let pool: Pool;
  const ownedWorkspaces = new Set<string>(), ownedUsers = new Set<string>();
  test.beforeAll(() => { pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 3000, query_timeout: 3000 }); });
  test.afterAll(async () => { await pool?.end(); });
  test.afterEach(async () => {
    // IDs came only from unique test-created fixtures, never broad data cleanup.
    for (const id of ownedWorkspaces) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of ownedUsers) await db.delete(users).where(eq(users.id, id));
    ownedWorkspaces.clear(); ownedUsers.clear();
  });

  async function login(request: APIRequestContext, role = "owner", workspace = `transition-${crypto.randomUUID()}`) {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, role, plan: "smb", email: `${crypto.randomUUID()}@example.com` })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const owner = await response.json() as Owner;
    ownedWorkspaces.add(owner.workspaceId); ownedUsers.add(owner.userId);
    return { owner, workspace };
  }
  async function seed(request: APIRequestContext, paused = false, extra: Partial<typeof timeEntries.$inferInsert> = {}): Promise<Seed> {
    const { owner, workspace } = await login(request);
    const entryId = crypto.randomUUID();
    const [block] = await db.insert(scheduledWorkBlocks).values({ id: crypto.randomUUID(), ...owner, createdByUserId: owner.userId, title: "Transition fixture", startsAt: at(0), endsAt: at(20), status: "in_progress", linkedTimeEntryId: entryId }).returning();
    const [entry] = await db.insert(timeEntries).values({ id: entryId, ...owner, taskId: "Transition fixture", startedAt: at(0), stoppedAt: null, scheduledBlockId: block.id, isPaused: paused, pausedAt: paused ? at(5) : null, accumulatedSeconds: 0.25, ...extra }).returning();
    return { owner, workspace, entry, block };
  }
  async function snapshot(owner: Owner) {
    const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, owner.workspaceId), eq(timeEntries.userId, owner.userId)));
    const blocks = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, owner.workspaceId), eq(scheduledWorkBlocks.userId, owner.userId)));
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, owner.workspaceId));
    return { entries: entries.sort((a, b) => a.id.localeCompare(b.id)), blocks, audits };
  }
  async function saved(identity: Identity) {
    return (await db.select({ id: timeEntries.id, isPaused: timeEntries.isPaused, pausedAt: timeEntries.pausedAt, stoppedAt: timeEntries.stoppedAt, durationSeconds: sql<number | null>`${timeEntries.durationSeconds}::double precision`, accumulatedSeconds: sql<number>`${timeEntries.accumulatedSeconds}::double precision` }).from(timeEntries).where(and(eq(timeEntries.workspaceId, identity.workspaceId), eq(timeEntries.userId, identity.userId), eq(timeEntries.id, identity.entryId))))[0];
  }
  function success(outcome: Outcome) { expect(outcome.ok, outcome.ok ? "" : String(outcome.error)).toBe(true); if (!outcome.ok) throw outcome.error; return outcome.value; }

  async function ordering(seed: Seed, first: Action, second: Action, options: { rollback?: boolean; endedAt?: Date; whileHeld?: (holder: Operation) => Promise<void> } = {}) {
    const identity = { ...seed.owner, entryId: seed.entry.id };
    const holder = operation(identity, first, { hold: true, rollback: options.rollback, now: first === "stop" ? at(30).getTime() : at(10).getTime(), endedAt: options.endedAt ?? at(20) });
    const waiter = operation(identity, second, { now: second === "stop" ? at(30).getTime() : at(15).getTime(), endedAt: options.endedAt ?? at(20) });
    const observer = await pool.connect();
    const before = await snapshot(seed.owner), started = Date.now();
    const pending: Array<Promise<Outcome>> = [];
    let forcedRelease = false;
    // Always release by 6s; a deadline release is failure, never evidence.
    const releaseTimer = setTimeout(() => { forcedRelease = true; holder.release(); }, 6000);
    try {
      pending.push(holder.run()); await deadline(Promise.race([holder.acquired, pending[0].then(result => { if (!result.ok) throw result.error; throw new Error("Holder completed without reaching its row gate"); })]), 5000, "Holder never acquired its actual timer row");
      pending.push(waiter.run()); await reachedBlocker(observer, holder, waiter);
      expect(await snapshot(seed.owner)).toEqual(before); // No dirty visibility or precommit callback.
      await options.whileHeld?.(holder);
      holder.state.now = first === "stop" ? at(30).getTime() : at(12).getTime(); // Cross two whole seconds while row is held.
      expect(forcedRelease).toBe(false); expect(Date.now() - started).toBeLessThan(6000);
      holder.release();
      const result = await deadline(Promise.all(pending), Math.max(1, 12000 - (Date.now() - started)), "Operations did not finish within 12 seconds");
      expect(forcedRelease).toBe(false);
      expect(holder.state.capacityAcquired).toBe(first === "stop"); expect(waiter.state.capacityAcquired).toBe(second === "stop");
      expect(holder.state.callbacks.length).toBe(first === "stop" && !options.rollback ? 1 : 0);
      expect(waiter.state.callbacks.length).toBe(second === "stop" && result[1].ok ? 1 : 0);
      return { identity, holder, waiter, first: result[0], second: result[1], before };
    } finally {
      clearTimeout(releaseTimer); holder.release(); waiter.release();
      // Do not release the observer/cleanup fixtures with operations outstanding.
      try {
        try { await deadline(Promise.all(pending), 12000, "Cleanup could not settle owned transactions"); }
        catch (cleanupError) {
          // Abort only still-owned, unsettled test transactions; no query text,
          // unrelated backend inspection, or pooled-client release while active.
          const pids = [holder, waiter].filter(op => !op.state.settled && op.state.pid > 0).map(op => op.state.pid);
          if (pids.length) await observer.query("select pg_cancel_backend(pid) from unnest($1::int[]) as owned(pid)", [pids]);
          await deadline(Promise.all(pending), 5000, "Cancelled owned transactions did not settle");
          throw cleanupError;
        }
      }
      finally { observer.release(); }
    }
  }

  const matrix: Array<{ first: Action; second: Action; paused: boolean; aggregate: number; pausedAt: number | null; duration?: number }> = [
    { first: "pause", second: "pause", paused: false, aggregate: 0.25, pausedAt: 12 },
    { first: "resume", second: "resume", paused: true, aggregate: 7.25, pausedAt: null },
    { first: "pause", second: "resume", paused: false, aggregate: 3.25, pausedAt: null },
    { first: "resume", second: "pause", paused: true, aggregate: 7.25, pausedAt: 15 },
    { first: "pause", second: "stop", paused: false, aggregate: 0.25, pausedAt: 12, duration: 11.75 },
    { first: "resume", second: "stop", paused: true, aggregate: 7.25, pausedAt: null, duration: 12.75 },
    { first: "stop", second: "pause", paused: false, aggregate: 0.25, pausedAt: null, duration: 19.75 },
    { first: "stop", second: "resume", paused: true, aggregate: 0.25, pausedAt: 5, duration: 4.75 },
  ];
  for (const row of matrix) test(`${row.first} holder → ${row.second} waiter rereads the committed row after observed blocking`, async ({ request }) => {
    const s = await seed(request, row.paused), run = await ordering(s, row.first, row.second);
    success(run.first);
    if (row.first === "stop") { expect(run.second.ok).toBe(false); if (!run.second.ok) expect(run.second.error).toMatchObject({ status: 404, message: "No active timer found for entry" }); }
    else {
      const second = success(run.second);
      if (row.first === row.second) expect(second).toEqual({ ok: true, message: row.second === "pause" ? "Timer is already paused" : "Timer is already running" });
    }
    const final = await saved(run.identity);
    expect(final.accumulatedSeconds).toBe(row.aggregate); expect(final.pausedAt?.getTime() ?? null).toBe(row.pausedAt === null ? null : at(row.pausedAt).getTime());
    expect(final.isPaused).toBe(row.pausedAt !== null); expect(final.durationSeconds).toBe(row.duration ?? null);
    expect(final.stoppedAt?.getTime() ?? null).toBe(row.duration === undefined ? null : at(20).getTime());
    const persisted = await snapshot(s.owner);
    expect(persisted.audits).toHaveLength(row.duration === undefined ? 0 : 1);
    expect(persisted.blocks[0]).toMatchObject({ status: row.duration === undefined ? "in_progress" : "completed", linkedTimeEntryId: s.entry.id });
    if (row.duration === undefined) expect(persisted.blocks).toEqual(run.before.blocks);
    else if (row.first === "stop") {
      // A fresh rejected toggle cannot alter the completed stop/audit/calendar.
      const retry = operation(run.identity, row.second, { now: at(30).getTime() }); expect((await retry.run()).ok).toBe(false); expect(await snapshot(s.owner)).toEqual(persisted);
    }
  });

  for (const action of ["pause", "resume"] as const) test(`${action} real-update rollback is invisible; waiter reads prior committed state and fresh retry is no-op`, async ({ request }) => {
    const s = await seed(request, action === "resume"), run = await ordering(s, action, action, { rollback: true });
    expect(run.first.ok).toBe(false); if (!run.first.ok) expect(run.first.error.message).toBe("Disposable post-update rollback");
    expect(run.holder.state.writes).toBe(1); expect(run.holder.state.bodyFinished).toBe(true); expect(run.holder.state.committed).toBe(false);
    expect(success(run.second)).toEqual({ ok: true });
    const final = await saved(run.identity); expect(final.accumulatedSeconds).toBe(action === "resume" ? 10.25 : 0.25); expect(final.pausedAt?.getTime() ?? null).toBe(action === "pause" ? at(15).getTime() : null);
    const beforeRetry = await snapshot(s.owner), retry = operation(run.identity, action, { now: at(30).getTime() });
    expect(success(await retry.run())).toEqual({ ok: true, message: action === "pause" ? "Timer is already paused" : "Timer is already running" }); expect(retry.state.writes).toBe(0); expect(retry.state.callbacks).toHaveLength(0); expect(await snapshot(s.owner)).toEqual(beforeRetry);
  });

  for (const action of ["pause", "resume"] as const) test(`${action} rollback with no waiter restores timer, schedule and audit byte-for-byte`, async ({ request }) => {
    const s = await seed(request, action === "resume"), before = await snapshot(s.owner);
    const failed = operation({ ...s.owner, entryId: s.entry.id }, action, { rollback: true, now: at(12).getTime() });
    expect((await failed.run()).ok).toBe(false); expect(failed.state.bodyFinished).toBe(true); expect(failed.state.writes).toBe(1); expect(failed.state.callbacks).toHaveLength(0); expect(await snapshot(s.owner)).toEqual(before);
  });

  test("same-user independent timer and separate workspace/user transitions finish while the first timer stays locked", async ({ request }) => {
    const s = await seed(request), other = await seed(request);
    const colleague = await login(request, "member", s.workspace);
    const [independent] = await db.insert(timeEntries).values({ id: crypto.randomUUID(), ...s.owner, taskId: "Independent same-user timer", startedAt: at(0) }).returning();
    const [colleagueTimer] = await db.insert(timeEntries).values({ id: crypto.randomUUID(), ...colleague.owner, taskId: "Independent colleague timer", startedAt: at(0) }).returning();
    await ordering(s, "pause", "pause", { whileHeld: async holder => {
      for (const identity of [{ ...s.owner, entryId: independent.id }, { ...colleague.owner, entryId: colleagueTimer.id }, { ...other.owner, entryId: other.entry.id }]) {
        const free = operation(identity, "pause", { now: at(11).getTime() }); success(await deadline(free.run(), 2000, "Independent timer waited on an owner/global lock"));
        expect(free.state.pid).not.toBe(holder.state.pid); expect(holder.state.settled).toBe(false); expect(holder.state.committed).toBe(false);
      }
    } });
  });

  for (const variant of ["backdated", "zero-net"] as const) test(`pause → stop preserves accepted ${variant} requested-endpoint behavior`, async ({ request }) => {
    const s = await seed(request, false, variant === "zero-net" ? { accumulatedSeconds: 50 } : {});
    const run = await ordering(s, "pause", "stop", { endedAt: variant === "backdated" ? at(10) : at(20) });
    success(run.first); const response = success(run.second); expect(response.durationSeconds).toBe(variant === "zero-net" ? 0 : 9.75);
    const final = await saved(run.identity); expect(final.stoppedAt?.getTime()).toBe(variant === "backdated" ? at(10).getTime() : at(20).getTime());
    expect((await snapshot(s.owner)).audits[0].eventType).toBe(variant === "zero-net" ? "timer_stopped_no_recorded_time" : "timer_stopped");
  });

  test("actual real storage: shortest fractional readback, zero/future/subsecond and large precision boundaries", async ({ request }) => {
    for (const [aggregate, pausedAt, want] of [[0.2, at(11), 1.2000000476837158], [0.25, at(11), 1.25], [0.25, new Date(at(12).getTime() - 999), 0.25], [0.25, at(20), 0.25], [16777216, at(11), 16777216], [90000, at(11), 90001]] as const) {
      const s = await seed(request, true, { accumulatedSeconds: aggregate, pausedAt }); const identity = { ...s.owner, entryId: s.entry.id };
      success(await operation(identity, "resume", { now: at(12).getTime() }).run());
      expect(await saved(identity)).toMatchObject({ accumulatedSeconds: want, isPaused: false, pausedAt: null });
    }
  });

  test("authenticated native HTTP: own member succeeds; client/manager-foreign/owner-foreign/workspace/missing sessions cannot toggle", async ({ request, playwright }) => {
    const s = await seed(request), before = await snapshot(s.owner);
    for (const role of ["member", "manager", "owner", "client"]) {
      const context = await playwright.request.newContext({ baseURL: "http://localhost:3008" });
      try {
        const actor = await login(context, role, s.workspace);
        for (const action of ["pause", "resume"]) {
          const response = await context.post(`/api/timer/${action}`, { data: { entryId: s.entry.id } });
          expect(response.status()).toBe(role === "client" ? 403 : 404);
          expect(await response.json()).toEqual({ error: role === "client" ? "Your workspace role cannot perform this action." : "No active timer found for entry" });
        }
        if (role === "member") {
          const [own] = await db.insert(timeEntries).values({ id: crypto.randomUUID(), ...actor.owner, taskId: "Member own timer", startedAt: at(0) }).returning();
          for (const action of ["pause", "resume"]) {
            expect((await context.post(`/api/timer/${action}`, { data: { entryId: own.id } })).status()).toBe(200);
            expect(await (await context.post(`/api/timer/${action}`, { data: { entryId: own.id } })).json()).toEqual({ ok: true, message: action === "pause" ? "Timer is already paused" : "Timer is already running" });
          }
          const final = await saved({ ...actor.owner, entryId: own.id }); expect(final.isPaused).toBe(false); expect(final.pausedAt).toBeNull();
        }
      } finally { await context.dispose(); }
    }
    expect(await snapshot(s.owner)).toEqual(before);
    const foreign = await playwright.request.newContext({ baseURL: "http://localhost:3008" });
    const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3008" });
    try {
      await login(foreign);
      for (const action of ["pause", "resume"]) {
        expect((await foreign.post(`/api/timer/${action}`, { data: { entryId: s.entry.id } })).status()).toBe(404);
        const missing = await anonymous.post(`/api/timer/${action}`, { data: { entryId: s.entry.id }, maxRedirects: 0 });
        expect(missing.status()).toBe(307);
        const location = missing.headers()["location"]; expect(location).toBeTruthy();
        expect(new URL(location, "http://localhost:3008").href).toBe("http://localhost:3008/login"); expect(await snapshot(s.owner)).toEqual(before);
        // Presence alone passes the unchanged proxy; native session decoding
        // must then reject this invalid cookie with the route's fixed response.
        const invalid = await anonymous.post(`/api/timer/${action}`, { headers: { cookie: "sowledger_session=invalid-native-transition-session" }, data: { entryId: s.entry.id }, maxRedirects: 0 });
        expect(invalid.status()).toBe(401); expect(await invalid.json()).toEqual({ error: "Please sign in again." }); expect(await snapshot(s.owner)).toEqual(before);
      }
    } finally { await foreign.dispose(); await anonymous.dispose(); }
    expect(await snapshot(s.owner)).toEqual(before);
  });

  test("authenticated HTTP rejects malformed JSON/IDs and invalid saved pause; stopped state is immutable", async ({ request }) => {
    const s = await seed(request), before = await snapshot(s.owner);
    for (const action of ["pause", "resume"]) {
      for (const body of [null, [], "text", {}, { entryId: 4 }, { entryId: " " }, { entryId: "x".repeat(256) }, { entryId: "bad\0id" }]) {
        const response = await request.post(`/api/timer/${action}`, { headers: { "content-type": "application/json" }, data: JSON.stringify(body) }); expect(response.status()).toBe(400); expect(await response.json()).toEqual({ error: "entryId must be a non-empty string of at most 255 characters." });
      }
      const malformed = await request.post(`/api/timer/${action}`, { headers: { "content-type": "application/json" }, data: Buffer.from("{", "utf8") }); expect(malformed.status()).toBe(400); expect(await malformed.json()).toEqual({ error: "Send a valid JSON request." });
    }
    expect(await snapshot(s.owner)).toEqual(before);
    for (const extra of [{ isPaused: true, pausedAt: null }, { accumulatedSeconds: -1 }, { accumulatedSeconds: NaN }, { accumulatedSeconds: Infinity }]) {
      await db.update(timeEntries).set({ isPaused: false, pausedAt: null, accumulatedSeconds: 0.25, ...extra }).where(and(eq(timeEntries.workspaceId, s.owner.workspaceId), eq(timeEntries.userId, s.owner.userId), eq(timeEntries.id, s.entry.id)));
      const invalid = await snapshot(s.owner);
      for (const action of ["pause", "resume"]) { const response = await request.post(`/api/timer/${action}`, { data: { entryId: s.entry.id } }); expect(response.status()).toBe(409); expect(await response.json()).toEqual({ error: "The pause time for this timer is invalid. Contact support for help." }); expect(await snapshot(s.owner)).toEqual(invalid); }
    }
    await db.update(timeEntries).set({ stoppedAt: at(20) }).where(and(eq(timeEntries.workspaceId, s.owner.workspaceId), eq(timeEntries.userId, s.owner.userId), eq(timeEntries.id, s.entry.id)));
    const stopped = await snapshot(s.owner);
    for (const action of ["pause", "resume"]) { const response = await request.post(`/api/timer/${action}`, { data: { entryId: s.entry.id } }); expect(response.status()).toBe(404); expect(await response.json()).toEqual({ error: "No active timer found for entry" }); expect(await snapshot(s.owner)).toEqual(stopped); }
  });

  test("390px real dashboard start → pause → resume → stop persists through visible controls and reload", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
    const { owner } = await login(page.request, "member");
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto("/dashboard");
    await expect(page).toHaveURL("http://localhost:3008/dashboard");
    await expect(page.getByRole("heading", { name: "Your time today", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
    const label = `Mobile transition ${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Work label", { exact: true }).fill(label);
    const startResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/timer/start" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Start timer", exact: true }).click();
    const started = await startResponse; expect(started.ok(), await started.text()).toBeTruthy();
    const { entry } = await started.json() as { entry: typeof timeEntries.$inferSelect };
    expect(entry).toMatchObject({ workspaceId: owner.workspaceId, userId: owner.userId, taskId: label });
    const identity = { ...owner, entryId: entry.id };
    expect(await saved(identity)).toMatchObject({ isPaused: false, pausedAt: null, stoppedAt: null, accumulatedSeconds: 0 });
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const pauseResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/timer/pause" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Pause timer", exact: true }).click();
    const pausedResponse = await pauseResponse; expect(pausedResponse.status()).toBe(200); expect(await pausedResponse.json()).toEqual({ ok: true });
    await expect(page.getByRole("button", { name: "Resume timer", exact: true })).toBeVisible();
    await expect(page.getByText("Elapsed (Paused)", { exact: true })).toBeVisible();
    const paused = await saved(identity); expect(paused).toMatchObject({ isPaused: true, stoppedAt: null, accumulatedSeconds: 0 });
    expect(paused.pausedAt).toBeInstanceOf(Date); expect(Number.isFinite(paused.pausedAt!.getTime())).toBe(true);
    expect((await snapshot(owner)).audits).toHaveLength(0);
    // Observe an ordinary whole paused second, without fake product time or
    // direct timer writes, so resumed persistence must include a real interval.
    await expect.poll(() => Date.now() - paused.pausedAt!.getTime()).toBeGreaterThanOrEqual(1100);

    const resumeResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/timer/resume" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Resume timer", exact: true }).click();
    const resumedResponse = await resumeResponse; expect(resumedResponse.status()).toBe(200); expect(await resumedResponse.json()).toEqual({ ok: true });
    await expect(page.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
    await expect(page.getByText("Elapsed (Paused)", { exact: true })).toHaveCount(0);
    const resumed = await saved(identity); expect(resumed).toMatchObject({ isPaused: false, pausedAt: null, stoppedAt: null });
    expect(resumed.accumulatedSeconds).toBeGreaterThanOrEqual(1); expect(Number.isInteger(resumed.accumulatedSeconds)).toBe(true);
    expect((await snapshot(owner)).audits).toHaveLength(0);

    const stopResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/timer/stop" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Stop focused timer", exact: true }).click();
    const stoppedResponse = await stopResponse; expect(stoppedResponse.ok(), await stoppedResponse.text()).toBeTruthy();
    const stopped = await stoppedResponse.json(); expect(stopped).toMatchObject({ ok: true, entryId: entry.id });
    await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause timer", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Resume timer", exact: true })).toHaveCount(0);
    const persisted = await snapshot(owner);
    expect(persisted.entries.map(row => row.id).sort()).toEqual([...stopped.entryIds].sort());
    expect(persisted.entries.reduce((total, row) => total + (row.durationSeconds ?? 0), 0)).toBe(stopped.durationSeconds);
    expect(persisted.entries.every(row => row.stoppedAt !== null)).toBe(true);
    expect(persisted.entries.find(row => row.id === entry.id)).toMatchObject({ isPaused: false, pausedAt: null, accumulatedSeconds: resumed.accumulatedSeconds });
    expect(persisted.audits.length).toBeGreaterThanOrEqual(1); expect(persisted.blocks).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start timer", exact: true })).toBeVisible();
    expect(await snapshot(owner)).toEqual(persisted);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});

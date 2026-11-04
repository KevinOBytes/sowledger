/* eslint-disable @typescript-eslint/no-explicit-any -- Test-process-only proxies forward actual PostgreSQL transactions; no production fault hook. */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Pool, type PoolClient } from "pg";
import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import { checkedInvoiceCents } from "../lib/invoice-amount";
import { generateApiKeyMaterial } from "../lib/api-keys";
import { createWorkspaceProject } from "../lib/project-creation";
import { updateWorkspaceProject } from "../lib/project-history";
import { WorkflowError } from "../lib/workflow-validation";
import { gotoApp } from "./helpers/navigation";

// Generated bearer keys remain in process memory only, including failures
// and retries. Worker-scoped capture settings must be declared at file scope.
test.use({ trace: "off", screenshot: "off", video: "off" });

type Owner = { workspaceId: string; userId: string };
type Seed = { owner: Owner; workspace: string; email: string; clientId: string; p: string; q: string };
type Pending<T> = { settled: boolean; result: Promise<T> };
const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
const at = new Date("2026-10-12T09:00:00.000Z");
async function deadline<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); } finally { clearTimeout(timer); }
}

test.describe("invoice selections: root-owned disposable PostgreSQL acceptance", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable wrapper only; never use operator/production data.");
  test.setTimeout(60_000);
  let pool: Pool;
  const owned: Owner[] = [];
  const syntheticUsers = new Set<string>();
  test.beforeAll(() => { pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 3000, query_timeout: 12_000 }); });
  test.afterAll(async () => { await pool?.end(); });
  test.afterEach(async () => {
    // Only UUID-unique workspaces/users made by this test; no global cleanup.
    // The actual tables lack workspace cascades, so remove only this spec's
    // exact owned people/organization fixtures explicitly before workspace cleanup.
    for (const owner of owned.splice(0)) {
      await db.delete(schema.workspacePeople).where(eq(schema.workspacePeople.workspaceId, owner.workspaceId));
      await db.delete(schema.organizations).where(eq(schema.organizations.workspaceId, owner.workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, owner.workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, owner.userId));
    }
    // Only this test's exact generated IDs, after owned memberships/workspaces
    // have been removed. Never broaden this to a global-user cleanup.
    const ids = [...syntheticUsers];
    for (let offset = 0; offset < ids.length; offset += 1000) await db.delete(schema.users).where(inArray(schema.users.id, ids.slice(offset, offset + 1000)));
    syntheticUsers.clear();
  });

  async function seed(request: APIRequestContext): Promise<Seed> {
    const workspace = `invoice-selection-${crypto.randomUUID()}`, email = `invoice-${crypto.randomUUID()}@example.com`;
    const login = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email, plan: "smb" })}`); expect(login.ok(), await login.text()).toBeTruthy();
    const owner = await login.json() as Owner; owned.push(owner);
    const clientId = crypto.randomUUID();
    await db.insert(schema.clients).values({ id: clientId, workspaceId: owner.workspaceId, name: "Invoice selection client", email: `client-${workspace}@example.com`, status: "archived" });
    await db.insert(schema.organizations).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, clientId, name: "Invoice organization", type: "client" });
    const p = crypto.randomUUID(), q = crypto.randomUUID();
    await db.insert(schema.projects).values([{ id: p, workspaceId: owner.workspaceId, clientId, name: "Selection alpha" }, { id: q, workspaceId: owner.workspaceId, clientId, name: "Selection beta" }]);
    return { owner, workspace, email, clientId, p, q };
  }
  async function entry(s: Seed, overrides: Partial<typeof schema.timeEntries.$inferInsert> = {}) {
    const [saved] = await db.insert(schema.timeEntries).values({ id: crypto.randomUUID(), ...s.owner, projectId: s.p, taskId: "Selection fixture", description: "Invoice selection fixture", startedAt: at, stoppedAt: new Date(at.getTime() + 3600_000), durationSeconds: 3600, hourlyRate: 100, source: "manual", status: "approved", ...overrides }).returning();
    return saved;
  }
  async function snapshot(s: Seed) {
    const byId = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
    return { invoices: byId(await db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, s.owner.workspaceId))), entries: byId(await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.workspaceId, s.owner.workspaceId))), audits: byId(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.workspaceId, s.owner.workspaceId))), clients: byId(await db.select().from(schema.clients).where(eq(schema.clients.workspaceId, s.owner.workspaceId))), projects: byId(await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, s.owner.workspaceId))), organizations: byId(await db.select().from(schema.organizations).where(eq(schema.organizations.workspaceId, s.owner.workspaceId))), people: byId(await db.select().from(schema.workspacePeople).where(eq(schema.workspacePeople.workspaceId, s.owner.workspaceId))) };
  }
  function assertNoDirectoryOrphans(saved: Awaited<ReturnType<typeof snapshot>>) {
    expect(saved.people.filter(person => !saved.organizations.some(organization => organization.id === person.organizationId && organization.workspaceId === person.workspaceId)), "Every retained person must still have an existing same-workspace organization").toEqual([]);
  }
  const post = (request: APIRequestContext, ids: string[]) => request.post("/api/invoices", { data: { timeEntryIds: ids }, timeout: 25_000 });

  test("actual 1001 workspace memberships preserve all boundary author labels without borrowing a foreign membership", async ({ request }) => {
    const foreign = await seed(request), s = await seed(request);
    const rows = Array.from({ length: 1000 }, () => { const id = crypto.randomUUID(); syntheticUsers.add(id); return { id, email: `member-${id}@example.com` }; });
    for (let offset = 0; offset < rows.length; offset += 1000) {
      const chunk = rows.slice(offset, offset + 1000); await db.insert(schema.users).values(chunk);
      await db.insert(schema.memberships).values(chunk.map(user => ({ workspaceId: s.owner.workspaceId, userId: user.id, role: "member" as const })));
    }
    const expected = new Map<string, string>();
    for (const user of [rows[0], rows[998], rows[999]]) { const saved = await entry(s, { userId: user.id }); expected.set(saved.id, user.email); }
    const owner = await entry(s); expected.set(owner.id, s.email);
    const unscoped = await entry(s, { userId: foreign.owner.userId }); expected.set(unscoped.id, "Unknown User");
    const before = await snapshot(s), response = await request.get("/api/invoices"); expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json(); expect(data.billableEntries).toHaveLength(5);
    for (const row of data.billableEntries) expect(row.userEmail).toBe(expected.get(row.id));
    expect(await db.select().from(schema.memberships).where(eq(schema.memberships.workspaceId, s.owner.workspaceId))).toHaveLength(1001);
    expect(await snapshot(s)).toEqual(before);
  });

  for (const width of [390, 1440]) test(`mixed healthy and duplicate saved history stays unchanged while ordinary creation works at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", url: "http://localhost:3008" }]);
    const s = await seed(page.request), old = await entry(s, { status: "invoiced" }), approved = await entry(s, { durationSeconds: 36, hourlyRate: 1 });
    const duplicateId = crypto.randomUUID(), healthyId = crypto.randomUUID();
    await db.insert(schema.invoices).values([
      { id: healthyId, workspaceId: s.owner.workspaceId, number: `HEALTHY-${healthyId}`, amount: 100, timeEntryIds: [old.id], status: "sent" },
      { id: duplicateId, workspaceId: s.owner.workspaceId, number: `DUPLICATE-${duplicateId}`, amount: 7.89, timeEntryIds: [old.id, old.id], status: "sent" },
    ]);
    const before = await snapshot(s), requests: string[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", req => { if (req.url().includes("push-invoice")) requests.push(req.url()); });
    await gotoApp(page, "/invoices");
    const duplicate = page.locator("article").filter({ hasText: `DUPLICATE-${duplicateId}` });
    await expect(duplicate).toContainText("This saved invoice needs review."); await expect(duplicate.getByRole("button")).toHaveCount(0); await expect(duplicate.getByRole("link")).toHaveCount(0);
    await duplicate.locator("summary").focus(); await page.keyboard.press("Enter"); await expect(duplicate.locator("ol > li")).toHaveText([old.id, old.id]);
    await expect(page.getByText("Saved totals include invoices that need review.")).toBeVisible();
    const denied = await page.request.patch(`/api/invoices/${duplicateId}`, { data: { status: "paid" } }); expect(denied.status()).toBe(409);
    expect(await snapshot(s)).toEqual(before);
    const healthy = page.locator("article").filter({ hasText: `HEALTHY-${healthyId}` }); await expect(healthy.getByRole("button", { name: "Mark as paid" })).toBeEnabled();
    await healthy.getByRole("button", { name: "Open proof pack" }).click(); await expect(page.getByRole("heading", { name: `HEALTHY-${healthyId}` })).toBeVisible();
    await page.getByRole("button", { name: /Selection alpha/ }).click(); await expect(page.getByText("36 sec × $1/hr", { exact: true })).toBeVisible();
    const pending = page.waitForResponse(res => res.url().endsWith("/api/invoices") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Create draft invoice (1)", exact: true }).click(); const created = await pending; expect(created.ok()).toBeTruthy();
    await expect(page.getByRole("status").filter({ hasText: /Draft invoice created/ }).first()).toBeVisible();
    const after = await snapshot(s); expect(after.invoices.find(i => i.id === duplicateId)).toEqual(before.invoices.find(i => i.id === duplicateId));
    expect(after.entries.find(e => e.id === approved.id)?.status).toBe("invoiced"); expect(after.audits.filter(a => a.timeEntryId === duplicateId)).toEqual(before.audits.filter(a => a.timeEntryId === duplicateId));
    expect(requests).toEqual([]); expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`mixed-duplicate-history-${width}.png`), fullPage: true });
  });

  test("actual GET preserves large sparse history across bind-safe boundaries without foreign or missing-reference misclassification", async ({ request }) => {
    test.setTimeout(120_000); // Allows sequential remote reads without an unbounded wait.
    const s = await seed(request), foreign = await seed(request), prefix = crypto.randomUUID();
    const ids = Array.from({ length: 65535 }, (_, index) => `history-${prefix}-${index}`);
    const internalProject = crypto.randomUUID(); await db.insert(schema.projects).values({ id: internalProject, workspaceId: s.owner.workspaceId, clientId: null, name: "Large-history internal project" });
    await entry(s, { id: ids[0], status: "invoiced" }); await entry(s, { id: ids.at(-1)!, projectId: s.q, status: "invoiced" });
    await entry(s, { id: ids[1], projectId: null, status: "invoiced" }); await entry(s, { id: ids.at(-2)!, projectId: internalProject, status: "invoiced" });
    await entry(s, { id: ids[2], projectId: foreign.p, status: "invoiced" }); await entry(foreign, { id: ids.at(-3)!, status: "invoiced" });
    // JSON references need not have matching time rows. Keep all >65k IDs while
    // inserting only six time rows; this is a synthetic historical fixture.
    const ordinary = Array.from({ length: 656 }, (_, index) => ({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, number: `HISTORY-${prefix}-${index}`, timeEntryIds: ids.slice(index * 100, (index + 1) * 100), projectId: null, amount: 0, status: "draft" as const, createdAt: new Date(at.getTime() + (656 - index) * 1000) }));
    const clientId = crypto.randomUUID(), internalId = crypto.randomUUID(), corruptId = crypto.randomUUID(), foreignId = crypto.randomUUID(), missingId = crypto.randomUUID(), duplicateId = crypto.randomUUID(), emptyId = crypto.randomUUID();
    const special: Array<typeof schema.invoices.$inferInsert> = [
      { id: clientId, workspaceId: s.owner.workspaceId, number: `HISTORY-CLIENT-${prefix}`, timeEntryIds: [ids[0], ids.at(-1)!], projectId: s.p, amount: 123.456, status: "sent" },
      { id: internalId, workspaceId: s.owner.workspaceId, number: `HISTORY-INTERNAL-${prefix}`, timeEntryIds: [ids[1], ids.at(-2)!], projectId: null, amount: 12.34, status: "draft" },
      { id: corruptId, workspaceId: s.owner.workspaceId, number: `HISTORY-CORRUPT-${prefix}`, timeEntryIds: [ids[2]], projectId: null, amount: 1.23, status: "sent" },
      { id: foreignId, workspaceId: s.owner.workspaceId, number: `HISTORY-FOREIGN-ENTRY-${prefix}`, timeEntryIds: [ids.at(-3)!], projectId: null, amount: 4.56, status: "sent" },
      { id: missingId, workspaceId: s.owner.workspaceId, number: `HISTORY-MISSING-${prefix}`, timeEntryIds: [ids[3]], projectId: null, amount: 7.89, status: "sent" },
      { id: duplicateId, workspaceId: s.owner.workspaceId, number: `HISTORY-DUPLICATE-${prefix}`, timeEntryIds: [ids[0], ids[0]], projectId: s.p, amount: 0, status: "draft" },
      { id: emptyId, workspaceId: s.owner.workspaceId, number: `HISTORY-EMPTY-${prefix}`, timeEntryIds: [], projectId: null, amount: 0, status: "draft" },
    ];
    // Stable createdAt ordering makes both valid pairs span actual chunks,
    // regardless of insert/physical row ordering or ties among special records.
    await db.insert(schema.invoices).values([...ordinary, ...special.map(invoice => ({ ...invoice, createdAt: new Date(at.getTime() - 1000) }))]);
    const outsideInvoiceId = crypto.randomUUID(); await db.insert(schema.invoices).values({ id: outsideInvoiceId, workspaceId: foreign.owner.workspaceId, number: `HISTORY-OUTSIDE-${prefix}`, timeEntryIds: [ids.at(-3)!], amount: 999, status: "sent" });
    const relog = await request.get(`/api/test/login?${new URLSearchParams({ workspace: s.workspace, email: s.email, plan: "smb" })}`); expect(relog.ok()).toBe(true);
    const before = await snapshot(s), outsideBefore = await snapshot(foreign);
    const response = await request.get("/api/invoices", { timeout: 90_000 }); expect(response.status(), await response.text()).toBe(200); const payload = await response.json();
    expect(payload.invoices).toHaveLength(ordinary.length + special.length); expect(payload.invoices.some((invoice: any) => invoice.id === outsideInvoiceId)).toBe(false);
    expect(new Set(payload.invoices.flatMap((invoice: any) => invoice.timeEntryIds))).toEqual(new Set(ids));
    for (const stored of before.invoices) { const visible = payload.invoices.find((invoice: any) => invoice.id === stored.id); expect(visible, "Every saved invoice must remain reachable").toBeTruthy(); expect(visible.timeEntryIds).toEqual(stored.timeEntryIds); expect(visible.amount).toBe(stored.amount); expect(visible.projectId).toBe(stored.projectId); }
    expect(payload.invoices.find((invoice: any) => invoice.id === clientId)).toMatchObject({ billingAudience: "client", clientId: s.clientId, projectId: s.p });
    expect(payload.invoices.find((invoice: any) => invoice.id === internalId)).toMatchObject({ billingAudience: "internal", clientId: null, clientName: null });
    for (const id of [corruptId, foreignId, missingId, duplicateId, emptyId, ordinary[0].id, ordinary.at(-1)!.id]) expect(payload.invoices.find((invoice: any) => invoice.id === id)).toMatchObject({ billingAudience: "unknown", clientId: null, clientName: null });
    expect(await snapshot(s)).toEqual(before); expect(await snapshot(foreign)).toEqual(outsideBefore);
  });

  async function waiters(observer: PoolClient, holderPid: number, workspaceId: string, relation: "projects" | "clients" | "time_entries", count: number, pending: Pending<unknown>[]) {
    const end = Date.now() + 7500;
    while (Date.now() < end) {
      expect(pending.every(op => !op.settled), "Every contender must join the actual row/advisory blocking chain, not fail early").toBe(true);
      // An invoice holding the workspace advisory lock waits on the owned row;
      // later invoice contenders wait on that exact advisory key first. Count
      // both only when pg_blocking_pids connects them back to our row holder.
      // PostgreSQL exposes a bigint advisory key as high/low unsigned 32-bit
      // classid/objid with objsubid=1. Never inspect pg_stat_activity.query.
      const locks = (await observer.query<{ pid: number; blockers: number[] }>(`
        select distinct l.pid,pg_blocking_pids(l.pid) as blockers
        from pg_locks l
        where l.database=(select oid from pg_database where datname=current_database())
          and l.pid<>$2 and (
            (l.locktype='relation' and l.relation=$1::regclass and l.mode='RowShareLock')
            or (l.locktype='advisory' and l.mode='ExclusiveLock' and not l.granted and l.objsubid=1
              and l.classid::bigint=((hashtextextended($3,0) >> 32) & 4294967295::bigint)
              and l.objid::bigint=(hashtextextended($3,0) & 4294967295::bigint))
          )`, [`"sowledger"."${relation}"`, holderPid, `invoice-lifecycle:${workspaceId}`])).rows;
      const chained = new Set([holderPid]);
      for (let pass = 0; pass <= locks.length; pass++) for (const row of locks) if (row.blockers.some(pid => chained.has(pid))) chained.add(row.pid);
      if (chained.size - 1 >= count) return [...chained].filter(pid => pid !== holderPid);
      await yieldLoop();
    }
    throw new Error(`Did not observe ${count} contenders chained to the owned ${relation} row through row locks or this workspace's invoice advisory key`);
  }
  async function barrier<T>(s: Seed, relation: "projects" | "clients" | "time_entries", id: string, actions: Array<() => Promise<T>>, whileHeld?: (holder: PoolClient, observer: PoolClient, pids: number[]) => Promise<void>, before?: (holder: PoolClient) => Promise<void>) {
    const holder = await pool.connect(), observer = await pool.connect(); const pending: Pending<T>[] = []; let released = false, forced = false;
    const emergency = setTimeout(() => { forced = true; void holder.query("rollback").catch(() => undefined); }, 20_000);
    try {
      await holder.query("begin isolation level read committed");
      const holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      expect((await holder.query(`select id from "sowledger"."${relation}" where workspace_id=$1 and id=$2 for update`, [s.owner.workspaceId, id])).rowCount).toBe(1);
      await before?.(holder);
      let pids: number[] = [];
      for (const action of actions) {
        const op = { settled: false } as Pending<T>; op.result = action().finally(() => { op.settled = true; }); void op.result.catch(() => undefined); pending.push(op);
        pids = await waiters(observer, holderPid, s.owner.workspaceId, relation, pending.length, pending);
      }
      await whileHeld?.(holder, observer, pids); expect(forced).toBe(false);
      await holder.query("commit"); released = true;
      const results = await deadline(Promise.all(pending.map(op => op.result)), 25_000, "Invoice contenders did not settle after releasing the row"); expect(forced).toBe(false); return results;
    } finally {
      clearTimeout(emergency); if (!released) await holder.query("rollback");
      try { await deadline(Promise.allSettled(pending.map(op => op.result)), 25_000, "Invoice barrier cleanup timed out"); } finally { holder.release(); observer.release(); }
    }
  }

  for (const overlap of [true, false]) test(`observed overlapping=${overlap} invoice competitors consume each selected entry at most once`, async ({ request }) => {
    const s = await seed(request), a = await entry(s), b = await entry(s);
    const responses = await barrier(s, "projects", s.p, [() => post(request, [a.id]), () => post(request, overlap ? [a.id, b.id] : [b.id])]);
    expect(responses.map(r => r.status()).sort()).toEqual(overlap ? [200, 409] : [200, 200]);
    const saved = await snapshot(s); expect(saved.invoices.length).toBe(overlap ? 1 : 2);
    for (const id of [a.id, b.id]) { const owners = saved.invoices.filter(invoice => invoice.timeEntryIds.includes(id)); expect(owners.length).toBeLessThanOrEqual(1); expect(saved.entries.find(entry => entry.id === id)?.status).toBe(owners.length ? "invoiced" : "approved"); }
    expect(saved.audits.filter(a => a.eventType === "invoice_created")).toHaveLength(saved.invoices.length);
    expect(saved.audits.filter(a => a.eventType === "entry_invoiced")).toHaveLength(saved.entries.filter(e => e.status === "invoiced").length);
  });
  for (const mutation of ["reassign", "delete"] as const) test(`observed project ${mutation} versus invoice creation preserves billing history`, async ({ request }) => {
    const s = await seed(request), a = await entry(s); const otherClient = crypto.randomUUID(); await db.insert(schema.clients).values({ id: otherClient, workspaceId: s.owner.workspaceId, name: "Other client" });
    const responses = await barrier(s, "projects", s.p, [() => mutation === "delete" ? request.delete(`/api/projects?projectId=${s.p}`) : request.patch("/api/projects", { data: { projectId: s.p, clientId: otherClient } }), () => post(request, [a.id])]);
    expect(responses.map(r => r.status())).toEqual([409, 200]); const saved = await snapshot(s); expect(saved.projects.find(p => p.id === s.p)?.clientId).toBe(s.clientId); expect(saved.entries[0].projectId).toBe(s.p);
  });
  test("entry parent changed after discovery conflicts after actual reached entry lock, without acquiring a new parent", async ({ request }) => {
    const s = await seed(request), a = await entry(s); const responses = await barrier(s, "time_entries", a.id, [() => post(request, [a.id])], undefined, async holder => { await holder.query('update "sowledger"."time_entries" set project_id=$1 where workspace_id=$2 and id=$3', [s.q, s.owner.workspaceId, a.id]); });
    expect(responses[0].status()).toBe(409); const saved = await snapshot(s); expect(saved.invoices).toHaveLength(0); expect(saved.entries[0]).toMatchObject({ projectId: s.q, status: "approved" }); expect(saved.audits).toHaveLength(0);
  });
  test.describe("project/client transactional assignment", () => {
    const missingClient = "The selected client is no longer available. Refresh the client list and choose another client.";
    type Surface = "native" | "public";
    async function projectWriter(request: APIRequestContext, s: Seed, surface: Surface) {
      let headers: Record<string, string> = {};
      if (surface === "public") {
        const material = generateApiKeyMaterial();
        await db.insert(schema.apiKeys).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, createdByUserId: s.owner.userId, name: "Disposable project/client conflict", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes: ["write:projects"] });
        headers = { authorization: `Bearer ${material.rawKey}` };
      }
      const url = surface === "public" ? "/api/v1/projects" : "/api/projects";
      return (operation: "create" | "reassign", data: Record<string, unknown>) => request[operation === "create" ? "post" : "patch"](url, { headers, data, timeout: 25_000 });
    }

    for (const surface of ["native", "public"] as const) for (const operation of ["create", "reassign"] as const) for (const deletionFirst of [true, false]) test(`${surface} client deletion vs project ${operation}, deletionFirst=${deletionFirst}, has no reverse-lock deadlock/orphan`, async ({ request }) => {
      const foreign = await seed(request), s = await seed(request);
      // Remove references only in this never-recorded fixture, before contention.
      await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
      await db.update(schema.projects).set({ budgetType: "fees", budgetAmount: 137 }).where(and(eq(schema.projects.workspaceId, s.owner.workspaceId), eq(schema.projects.id, s.p)));
      const write = await projectWriter(request, s, surface);
      const before = await snapshot(s), foreignBefore = await snapshot(foreign);
      const remove = () => request.delete(`/api/clients?clientId=${s.clientId}`, { timeout: 25_000 });
      const associate = () => write(operation, { ...(operation === "reassign" ? { projectId: s.p } : {}), name: "Concurrent associated project", clientId: s.clientId, budgetAmount: 947 });
      const responses = await barrier(s, "clients", s.clientId, deletionFirst ? [remove, associate] : [associate, remove], async (_holder, observer, pids) => {
        if (operation === "create") {
          const workspaceLocks = await observer.query<{ pid: number }>(`select distinct pid from pg_locks where relation='"sowledger"."workspaces"'::regclass and mode='RowShareLock' and pid=any($1::int[])`, [pids]);
          expect(workspaceLocks.rows.length, "Project creation must really hold its workspace transaction lock while waiting for the client").toBeGreaterThan(0);
        }
      });
      const deleted = responses[deletionFirst ? 0 : 1], associated = responses[deletionFirst ? 1 : 0];
      const saved = await snapshot(s); const linked = saved.projects.filter(p => p.clientId === s.clientId);
      if (deletionFirst) {
        expect(deleted.status()).toBe(200); expect(associated.status()).toBe(409);
        expect(await associated.json()).toEqual(surface === "public" ? { error: missingClient, resource: "projects" } : { error: missingClient });
        expect(saved.clients).toHaveLength(0); expect(saved.organizations).toHaveLength(1); expect(saved.organizations[0].clientId).toBeNull(); expect(linked).toHaveLength(0);
        // Includes the complete old name/client/budget and every other column.
        expect(saved.projects).toEqual(before.projects);
      } else {
        expect(deleted.status()).toBe(409); expect(associated.status()).toBe(surface === "public" && operation === "create" ? 201 : 200);
        const payload = await associated.json(); expect(payload.project).toMatchObject({ clientId: s.clientId, name: "Concurrent associated project", budgetAmount: 947 });
        expect(saved.clients).toEqual(before.clients); expect(saved.organizations).toEqual(before.organizations); expect(linked).toHaveLength(1);
        expect(linked[0].id).toBe(operation === "create" ? payload.project.id : s.p);
        expect(saved.projects).toHaveLength(before.projects.length + (operation === "create" ? 1 : 0));
        expect(saved.projects.filter(p => p.id !== linked[0].id)).toEqual(before.projects.filter(p => p.id !== linked[0].id));
      }
      expect(saved.entries).toEqual(before.entries); expect(saved.invoices).toEqual(before.invoices); expect(saved.audits).toEqual(before.audits); expect(saved.people).toEqual(before.people);
      expect(await snapshot(foreign)).toEqual(foreignBefore);
    });

    for (const operation of ["create", "reassign"] as const) test(`real helper ${operation} rejects an existing foreign-workspace client without partial writes`, async ({ request }) => {
      // Own-workspace cleanup comes first even if the unfixed helper wrongly
      // persists the cross-workspace association during RED.
      const s = await seed(request), foreign = await seed(request);
      const before = await snapshot(s), foreignBefore = await snapshot(foreign);
      const action = operation === "create"
        ? createWorkspaceProject({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, clientId: foreign.clientId, name: "Forbidden helper project", budgetAmount: 947 })
        : updateWorkspaceProject(s.owner.workspaceId, s.p, { clientId: foreign.clientId, name: "Forbidden helper rename", budgetAmount: 947 });
      const outcome = await action.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      expect(outcome.error).toBeInstanceOf(WorkflowError);
      expect(outcome.error).toMatchObject({ status: 409, message: missingClient });
      expect(await snapshot(s)).toEqual(before); expect(await snapshot(foreign)).toEqual(foreignBefore);
    });

    for (const surface of ["native", "public"] as const) for (const operation of ["create", "reassign"] as const) for (const invalid of ["missing", "foreign"] as const) test(`${surface} initially ${invalid} client ${operation} stays 400 with both workspaces unchanged`, async ({ request }) => {
      const foreign = await seed(request), s = await seed(request), write = await projectWriter(request, s, surface);
      const before = await snapshot(s), foreignBefore = await snapshot(foreign);
      const response = await write(operation, { ...(operation === "reassign" ? { projectId: s.p } : {}), clientId: invalid === "foreign" ? foreign.clientId : crypto.randomUUID(), name: "Must not be saved", budgetAmount: 947 });
      expect(response.status()).toBe(400);
      expect(await snapshot(s)).toEqual(before); expect(await snapshot(foreign)).toEqual(foreignBefore);
    });

    for (const surface of ["native", "public"] as const) for (const operation of ["create", "reassign"] as const) for (const assignment of ["omitted", "null"] as const) test(`${surface} ${assignment} client ${operation} preserves absent/null success semantics`, async ({ request }) => {
      const foreign = await seed(request), s = await seed(request), write = await projectWriter(request, s, surface);
      const before = await snapshot(s), foreignBefore = await snapshot(foreign);
      const response = await write(operation, { ...(operation === "reassign" ? { projectId: s.p } : {}), ...(assignment === "null" ? { clientId: null } : {}), name: "Safe internal edit", budgetAmount: 947 });
      expect(response.status()).toBe(surface === "public" && operation === "create" ? 201 : 200);
      const { project } = await response.json(), saved = await snapshot(s);
      const clientId = operation === "reassign" && assignment === "omitted" ? s.clientId : null;
      expect(project).toMatchObject({ clientId, name: "Safe internal edit", budgetAmount: 947 });
      const stored = saved.projects.find(p => p.id === project.id); expect(stored).toMatchObject({ clientId, name: "Safe internal edit", budgetAmount: 947 });
      if (operation === "reassign") expect(stored).toEqual({ ...before.projects.find(p => p.id === s.p), clientId, name: "Safe internal edit", budgetAmount: 947 });
      expect(saved.projects).toHaveLength(before.projects.length + (operation === "create" ? 1 : 0));
      expect(saved.projects.filter(p => p.id !== project.id)).toEqual(before.projects.filter(p => p.id !== project.id));
      expect(saved.clients).toEqual(before.clients); expect(saved.organizations).toEqual(before.organizations); expect(saved.people).toEqual(before.people); expect(saved.entries).toEqual(before.entries); expect(saved.invoices).toEqual(before.invoices); expect(saved.audits).toEqual(before.audits);
      expect(await snapshot(foreign)).toEqual(foreignBefore);
    });
  });
  test("client deletion versus invoice creation contends on client and cannot detach history", async ({ request }) => {
    const s = await seed(request), a = await entry(s);
    const responses = await barrier(s, "clients", s.clientId, [() => request.delete(`/api/clients?clientId=${s.clientId}`), () => post(request, [a.id])]);
    expect(responses.map(r => r.status())).toEqual([409, 200]); const saved = await snapshot(s); expect(saved.clients).toHaveLength(1); expect(saved.projects.every(p => p.clientId === s.clientId)).toBe(true);
  });

  for (const amount of [131072, 131072.02, 0]) test(`actual decoder accepts candidate ${amount} only with equal preview/response/persisted/proof/export cents`, async ({ request }) => {
    const s = await seed(request), a = await entry(s, { hourlyRate: amount });
    // The inserted rate is read back independently; these exact neighbors survive real.
    const [input] = await db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.workspaceId, s.owner.workspaceId), eq(schema.timeEntries.id, a.id))); expect(input.hourlyRate).toBe(amount);
    const expected = amount === 0 ? 0 : amount === 131072 ? 13107200 : 13107202;
    const preview = await (await request.get("/api/invoices")).json(); expect(preview.billableEntries.find((e: any) => e.id === a.id).amountCents).toBe(expected);
    const response = await post(request, [a.id]); expect(response.status(), await response.text()).toBe(200); const { invoice } = await response.json(); expect(invoice.amountCents).toBe(expected); expect(invoice.amount).toBe(amount);
    const saved = await snapshot(s); expect(saved.invoices[0]).toMatchObject({ id: invoice.id, amount, timeEntryIds: [a.id] }); expect(saved.entries[0].status).toBe("invoiced");
    const proof = await (await request.get(`/api/invoices/${invoice.id}/proof-pack`)).json(); expect(proof.proofPack.entries.reduce((sum: number, e: any) => sum + Math.round(e.amount * 100), 0)).toBe(expected); expect(Math.round(proof.proofPack.totals.amount * 100)).toBe(expected);
    const print = await request.get(`/api/invoices/${invoice.id}/print`); expect(print.ok()).toBe(true); expect(await print.text()).toContain(amount.toFixed(2));
    const exported = await request.get("/api/export/csv?format=json&include=invoices"); expect(exported.ok()).toBe(true); expect(exported.headers()["x-sowledger-export-sha256"]).toMatch(/^[a-f0-9]{64}$/); const payload = await exported.json(); expect(payload.invoices.find((i: any) => i.id === invoice.id).amount).toBe(amount);
  });
  test("actual persisted 13107201c line sum refuses 422 with exact unchanged state", async ({ request }) => {
    const s = await seed(request); const a = await entry(s, { hourlyRate: 131072 }), b = await entry(s, { durationSeconds: 36, hourlyRate: 1 });
    const stored = await db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.workspaceId, s.owner.workspaceId), inArray(schema.timeEntries.id, [a.id, b.id]))); expect(checkedInvoiceCents(stored)).toBe(13107201);
    const before = await snapshot(s), response = await post(request, [a.id, b.id]); expect(response.status()).toBe(422); expect((await response.json()).code).toBe("INVOICE_AMOUNT_NOT_REPRESENTABLE"); expect(await snapshot(s)).toEqual(before);
  });
  for (const internal of [false, true]) test(`persisted multi-project internal=${internal} grouping and client entitlement remain distinct`, async ({ request }) => {
    const s = await seed(request); if (internal) await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    const a = await entry(s, { durationSeconds: 18, hourlyRate: 1 }), b = await entry(s, { projectId: internal ? null : s.q, durationSeconds: 18, hourlyRate: 1 });
    const response = await post(request, [a.id, b.id]); expect(response.status()).toBe(200); const { invoice } = await response.json(); expect(invoice).toMatchObject({ amount: 0.02, amountCents: 2, projectId: null, billingAudience: internal ? "internal" : "client" });
    // Creation above must accept an archived client without any portal contact.
    // Establish genuine existing entitlement afterward in BOTH branches so the
    // internal denial is not merely a missing-contact denial.
    const clientEmail = `client-${s.workspace}@example.com`;
    const [organization] = await db.select().from(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId)));
    expect(organization).toBeTruthy();
    await db.insert(schema.workspacePeople).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, organizationId: organization.id, email: clientEmail, displayName: "Entitled client contact", personType: "client", status: "active" });
    expect((await request.patch(`/api/invoices/${invoice.id}`, { data: { status: "sent" } })).status()).toBe(200);
    const login = await request.get(`/api/test/login?${new URLSearchParams({ workspace: s.workspace, email: clientEmail, role: "client", plan: "smb" })}`); expect(login.ok()).toBe(true);
    const portal = await (await request.get("/api/client")).json(); expect(portal.invoices.some((i: any) => i.id === invoice.id)).toBe(!internal); expect((await request.get(`/api/invoices/${invoice.id}/proof-pack`)).status()).toBe(internal ? 404 : 200);
  });

  for (const kind of ["mixed-clients", "mixed-internal", "foreign-entry", "foreign-project", "foreign-client", "missing-entry", "explicit-project"] as const) test(`actual ${kind} selection has no invoice/status/audit or cross-workspace writes`, async ({ request }) => {
    const s = await seed(request), foreign = await seed(request);
    const relog = await request.get(`/api/test/login?${new URLSearchParams({ workspace: s.workspace, email: s.email, plan: "smb" })}`); expect(relog.ok()).toBe(true);
    const a = await entry(s), b = await entry(s, { projectId: s.q }), outside = await entry(foreign);
    if (kind === "mixed-clients") { const c = crypto.randomUUID(); await db.insert(schema.clients).values({ id: c, workspaceId: s.owner.workspaceId, name: "Other billing group" }); await db.update(schema.projects).set({ clientId: c }).where(and(eq(schema.projects.workspaceId, s.owner.workspaceId), eq(schema.projects.id, s.q))); }
    if (kind === "mixed-internal") await db.update(schema.projects).set({ clientId: null }).where(and(eq(schema.projects.workspaceId, s.owner.workspaceId), eq(schema.projects.id, s.q)));
    if (kind === "foreign-project") await db.update(schema.timeEntries).set({ projectId: foreign.p }).where(and(eq(schema.timeEntries.workspaceId, s.owner.workspaceId), eq(schema.timeEntries.id, b.id)));
    if (kind === "foreign-client") await db.update(schema.projects).set({ clientId: foreign.clientId }).where(and(eq(schema.projects.workspaceId, s.owner.workspaceId), eq(schema.projects.id, s.q)));
    const before = await snapshot(s), foreignBefore = await snapshot(foreign);
    const ids = kind === "foreign-entry" ? [a.id, outside.id] : kind === "missing-entry" ? [a.id, crypto.randomUUID()] : [a.id, b.id];
    const response = await request.post("/api/invoices", { data: { timeEntryIds: ids, ...(kind === "explicit-project" ? { projectId: s.p } : {}) } }); expect(response.status()).toBe(kind === "foreign-entry" || kind === "missing-entry" ? 404 : 400);
    expect(await snapshot(s)).toEqual(before); expect(await snapshot(foreign)).toEqual(foreignBefore);
    if (kind === "foreign-project" || kind === "foreign-client") { const preview = await (await request.get("/api/invoices")).json(); expect(preview.billableEntries.find((row: any) => row.id === b.id)).toMatchObject({ eligible: false, amount: null, amountCents: null }); }
  });
  for (const status of ["draft", "sent", "paid", "void", "unknown"]) test(`actual approved entry still referenced by ${status} invoice is not consumed again`, async ({ request }) => {
    const s = await seed(request), a = await entry(s);
    await db.insert(schema.invoices).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, number: `LEGACY-${crypto.randomUUID()}`, amount: 100, status: status as "draft", timeEntryIds: [a.id] });
    const before = await snapshot(s), response = await post(request, [a.id]); expect(response.status()).toBe(409); expect(await snapshot(s)).toEqual(before);
  });
  test("actual fractional saved duration and individually rounded half-cent lines remain valid", async ({ request }) => {
    const s = await seed(request), a = await entry(s, { durationSeconds: 0.5, hourlyRate: 72 }), b = await entry(s, { durationSeconds: 18, hourlyRate: 1 }), c = await entry(s, { durationSeconds: 18, hourlyRate: 1 });
    const response = await post(request, [a.id, b.id, c.id]); expect(response.status()).toBe(200); expect((await response.json()).invoice.amountCents).toBe(3); const saved = await snapshot(s); expect(saved.invoices[0].amount).toBe(0.03); expect(saved.entries.find(e => e.id === a.id)?.durationSeconds).toBe(0.5);
  });
  for (const dependency of ["project", "organization", "person"] as const) test(`actual corrupt foreign ${dependency} FK refuses client deletion and preserves both workspaces`, async ({ request }) => {
    const s = await seed(request), foreign = await seed(request);
    await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    if (dependency === "project") await db.update(schema.projects).set({ clientId: s.clientId }).where(and(eq(schema.projects.workspaceId, foreign.owner.workspaceId), eq(schema.projects.id, foreign.p)));
    if (dependency === "organization") await db.insert(schema.organizations).values({ id: crypto.randomUUID(), workspaceId: foreign.owner.workspaceId, clientId: s.clientId, name: "Corrupt foreign organization" });
    if (dependency === "person") { const [organization] = await db.select().from(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId))); await db.insert(schema.workspacePeople).values({ id: crypto.randomUUID(), workspaceId: foreign.owner.workspaceId, organizationId: organization.id, displayName: "Corrupt foreign person" }); }
    const relog = await request.get(`/api/test/login?${new URLSearchParams({ workspace: s.workspace, email: s.email, plan: "smb" })}`); expect(relog.ok()).toBe(true);
    const before = await snapshot(s), foreignBefore = await snapshot(foreign), response = await request.delete(`/api/clients?clientId=${s.clientId}`);
    expect(response.status()).toBe(409); expect(await response.text()).not.toMatch(/Corrupt foreign|foreign organization|foreign person/); expect(await snapshot(s)).toEqual(before); expect(await snapshot(foreign)).toEqual(foreignBefore);
  });
  for (const count of [0, 1, 2]) test(`actual unreferenced client with ${count} organizations retains exact directory state without any orphan`, async ({ request }) => {
    const s = await seed(request); await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    if (!count) await db.delete(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId)));
    if (count === 2) await db.insert(schema.organizations).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, clientId: s.clientId, name: "Second retained organization", type: "vendor" });
    const organizations = await db.select().from(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId)));
    for (const organization of organizations) await db.insert(schema.workspacePeople).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, organizationId: organization.id, displayName: "Retained client contact", title: "Unchanged title", personType: "client", status: "active" });
    const before = await snapshot(s); const response = await request.delete(`/api/clients?clientId=${s.clientId}`); expect(response.status()).toBe(200); const saved = await snapshot(s);
    expect(saved.clients).toHaveLength(0); expect(saved.organizations).toEqual(before.organizations.map(organization => ({ ...organization, clientId: null }))); expect(saved.people).toEqual(before.people); assertNoDirectoryOrphans(saved);
    expect(saved.projects).toEqual(before.projects); expect(saved.invoices).toEqual(before.invoices); expect(saved.entries).toEqual(before.entries); expect(saved.audits).toEqual(before.audits);
  });

  for (const operation of ["POST", "PATCH"] as const) for (const deleteFirst of [false, true]) test(`actual invitation-free people ${operation}, deleteFirst=${deleteFirst}, keeps retained same-workspace target`, async ({ request }) => {
    const s = await seed(request); await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    const [organization] = await db.select().from(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId)));
    const sourceId = crypto.randomUUID(); await db.insert(schema.organizations).values({ id: sourceId, workspaceId: s.owner.workspaceId, name: "Prior person organization", type: "other" });
    const personId = crypto.randomUUID(); if (operation === "PATCH") await db.insert(schema.workspacePeople).values({ id: personId, workspaceId: s.owner.workspaceId, organizationId: sourceId, displayName: "Reassigned person", personType: "contact" });
    const before = await snapshot(s);
    const write = () => operation === "POST" ? request.post("/api/people", { data: { organizationId: organization.id, displayName: "Concurrent retained person", personType: "contact", invite: false } }) : request.patch("/api/people", { data: { personId, organizationId: organization.id } });
    let personResponse: Awaited<ReturnType<typeof write>> | undefined;
    if (deleteFirst) { expect((await request.delete(`/api/clients?clientId=${s.clientId}`)).status()).toBe(200); personResponse = await write(); }
    else {
      const responses = await barrier(s, "clients", s.clientId, [() => request.delete(`/api/clients?clientId=${s.clientId}`)], async () => { personResponse = await write(); expect(personResponse.status()).toBe(200); const held = await snapshot(s); expect(held.clients).toHaveLength(1); expect(held.organizations.find(org => org.id === organization.id)?.clientId).toBe(s.clientId); });
      expect(responses[0].status()).toBe(200);
    }
    expect(personResponse!.status()).toBe(200); const { person } = await personResponse!.json(); const saved = await snapshot(s); expect(saved.clients).toHaveLength(0); expect(saved.organizations).toEqual(before.organizations.map(org => org.id === organization.id ? { ...org, clientId: null } : org)); expect(saved.people.find(row => row.id === person.id)?.organizationId).toBe(organization.id); assertNoDirectoryOrphans(saved);
    expect(await db.select().from(schema.invitations).where(eq(schema.invitations.workspaceId, s.owner.workspaceId))).toEqual([]);
  });
  for (const existing of [false, true]) for (const deleteFirst of [false, true]) test(`actual directory ensure existing-member=${existing}, deleteFirst=${deleteFirst}, preserves client-linked internal organization target`, async ({ request }) => {
    const s = await seed(request); await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    await db.update(schema.organizations).set({ type: "other" }).where(eq(schema.organizations.workspaceId, s.owner.workspaceId));
    const [organization] = await db.update(schema.organizations).set({ type: "internal" }).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId))).returning();
    if (existing) await db.insert(schema.workspacePeople).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, organizationId: organization.id, linkedUserId: s.owner.userId, email: s.email, displayName: "Existing directory member", personType: "member", invitationStatus: "accepted", inviteRole: "owner", status: "active" });
    const before = await snapshot(s); let directoryResponse: Awaited<ReturnType<typeof request.get>> | undefined;
    if (deleteFirst) { expect((await request.delete(`/api/clients?clientId=${s.clientId}`)).status()).toBe(200); directoryResponse = await request.get("/api/people"); }
    else {
      const responses = await barrier(s, "clients", s.clientId, [() => request.delete(`/api/clients?clientId=${s.clientId}`)], async () => { directoryResponse = await request.get("/api/people"); expect(directoryResponse.ok()).toBe(true); expect((await snapshot(s)).clients).toHaveLength(1); }); expect(responses[0].status()).toBe(200);
    }
    expect(directoryResponse!.status()).toBe(200); const saved = await snapshot(s); expect(saved.clients).toHaveLength(0); expect(saved.organizations).toEqual(before.organizations.map(org => org.id === organization.id ? { ...org, clientId: null } : org)); const member = saved.people.find(person => person.linkedUserId === s.owner.userId); expect(member?.organizationId).toBe(organization.id); expect(member?.personType).toBe("member"); if (existing) expect(member?.id).toBe(before.people[0].id); assertNoDirectoryOrphans(saved);
  });
  test("ordinary directory ensure still creates a standalone internal organization", async ({ request }) => {
    const s = await seed(request); await db.update(schema.organizations).set({ type: "other" }).where(eq(schema.organizations.workspaceId, s.owner.workspaceId));
    const response = await request.get("/api/people"); expect(response.status()).toBe(200); const saved = await snapshot(s); const internal = saved.organizations.filter(org => org.type === "internal"); expect(internal).toHaveLength(1); expect(internal[0].clientId).toBeNull(); expect(saved.people.find(person => person.linkedUserId === s.owner.userId)?.organizationId).toBe(internal[0].id); assertNoDirectoryOrphans(saved);
  });

  // Actual-module/real-DB evidence, not full HTTP/auth proof: the unchanged
  // route/helper executes with a test-process-only storage boundary gate.
  function gatedModule(s: Seed, kind: "people-read" | "directory-write", organizationId: string) {
    let release!: () => void, reached!: () => void, used = false;
    const gate = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { reached = resolve; });
    function gatedQuery(query: any, before: boolean): any {
      return new Proxy(query, { get(target, property, receiver) {
        if (property === "then") return (resolve: any, reject: any) => (async () => {
          if (before && !used) { used = true; reached(); await gate; }
          const rows = await target;
          if (!before && !used) { expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: organizationId, workspaceId: s.owner.workspaceId }); used = true; reached(); await gate; }
          return rows;
        })().then(resolve, reject);
        const value = Reflect.get(target, property, receiver); return typeof value === "function" ? (...args: any[]) => gatedQuery(value.apply(target, args), before) : value;
      } });
    }
    const storage = new Proxy(db, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (kind === "people-read" && property === "select") return (...args: any[]) => {
        const query = (value as any).apply(target, args);
        return new Proxy(query, { get(builder, step, builderReceiver) {
          if (step === "from") return (table: unknown) => { const from = builder.from(table); return table === schema.organizations ? gatedQuery(from, false) : from; };
          const field = Reflect.get(builder, step, builderReceiver); return typeof field === "function" ? field.bind(builder) : field;
        } });
      };
      if (kind === "directory-write" && (property === "insert" || property === "update")) return (table: unknown) => { const query = (value as any).call(target, table); return table === schema.workspacePeople ? gatedQuery(query, true) : query; };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const modules: Record<string, any> = { "@/lib/db": { db: storage } };
    if (kind === "people-read") {
      const auth = nativeRequire("./lib/auth");
      modules["@/lib/auth"] = { ...auth, requireSession: async () => ({ workspaceId: s.owner.workspaceId, sub: s.owner.userId, email: s.email, role: "owner" }), inviteUser: async () => { throw new Error("Invitations are forbidden in this disposable gate"); } };
      modules["@/lib/db/ensure-workspace-schema"] = { ensureWorkspaceSchema: async () => undefined };
    }
    function load(id: string): any {
      if (id in modules) return modules[id];
      if (id !== "@/app/api/people/route" && id !== "@/lib/people-directory") return nativeRequire(id.startsWith("@/") ? `./${id.slice(2)}` : id);
      const mod = { exports: {} }; new Function("require", "module", "exports", ts.transpileModule(readFileSync(`${id.slice(2)}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(load, mod, mod.exports); return modules[id] = mod.exports;
    }
    return { load, arrived, release };
  }
  for (const method of ["POST", "PATCH"] as const) test(`actual-module/DB people ${method} validation-before-delete/write-after-delete retains its target`, async ({ request }) => {
    const s = await seed(request); await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    const [organization] = await db.select().from(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId)));
    const source = crypto.randomUUID(); await db.insert(schema.organizations).values({ id: source, workspaceId: s.owner.workspaceId, name: "Gated person's prior organization", type: "other" });
    const personId = crypto.randomUUID(); if (method === "PATCH") await db.insert(schema.workspacePeople).values({ id: personId, workspaceId: s.owner.workspaceId, organizationId: source, displayName: "Gated reassignment", personType: "contact" });
    const before = await snapshot(s), fixture = gatedModule(s, "people-read", organization.id); let settled = false;
    const pending: Promise<Response> = fixture.load("@/app/api/people/route")[method](new NextRequest("http://localhost:3008/api/people", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, ...(method === "POST" ? { displayName: "Gated new person", personType: "contact", invite: false } : { personId }) }) })).finally(() => { settled = true; }); void pending.catch(() => undefined);
    try {
      await deadline(Promise.race([fixture.arrived, pending.then(() => { throw new Error("People route settled before reaching the real organization validation read gate"); })]), 7500, "People route did not reach actual DB organization read"); expect(settled).toBe(false);
      expect((await request.delete(`/api/clients?clientId=${s.clientId}`)).status()).toBe(200); const held = await snapshot(s); expect(held.clients).toHaveLength(0); expect(held.organizations).toEqual(before.organizations.map(org => org.id === organization.id ? { ...org, clientId: null } : org)); expect(held.people).toEqual(before.people); expect(settled).toBe(false);
      fixture.release(); const response = await deadline(pending, 15_000, "Gated people write did not settle"); expect(response.status).toBe(200); const { person } = await response.json(); const saved = await snapshot(s); expect(saved.people.find(row => row.id === person.id)?.organizationId).toBe(organization.id); assertNoDirectoryOrphans(saved); expect(await db.select().from(schema.invitations).where(eq(schema.invitations.workspaceId, s.owner.workspaceId))).toEqual([]);
    } finally { fixture.release(); await deadline(Promise.allSettled([pending]), 15_000, "Gated people cleanup did not settle"); }
  });
  for (const existing of [false, true]) test(`actual-helper/DB directory ${existing ? "existing-member assignment" : "new-member insert"} chosen before delete keeps its retained target`, async ({ request }) => {
    const s = await seed(request); await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId)); await db.update(schema.organizations).set({ type: "other" }).where(eq(schema.organizations.workspaceId, s.owner.workspaceId));
    const [organization] = await db.update(schema.organizations).set({ type: "internal" }).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId))).returning();
    if (existing) await db.insert(schema.workspacePeople).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, organizationId: organization.id, linkedUserId: s.owner.userId, email: s.email, displayName: "Preserved existing member", personType: "member", invitationStatus: "accepted", inviteRole: "owner", status: "active" });
    const fixture = gatedModule(s, "directory-write", organization.id), before = await snapshot(s); let settled = false;
    const pending: Promise<void> = fixture.load("@/lib/people-directory").ensureWorkspacePeopleDirectory(s.owner.workspaceId).finally(() => { settled = true; }); void pending.catch(() => undefined);
    try {
      await deadline(Promise.race([fixture.arrived, pending.then(() => { throw new Error("Directory helper settled before reaching its person writer gate"); })]), 7500, "Directory did not reach its actual person writer boundary"); expect(settled).toBe(false);
      expect((await request.delete(`/api/clients?clientId=${s.clientId}`)).status()).toBe(200); const held = await snapshot(s); expect(held.clients).toHaveLength(0); expect(held.organizations).toEqual(before.organizations.map(org => org.id === organization.id ? { ...org, clientId: null } : org)); expect(held.people).toEqual(before.people);
      fixture.release(); await deadline(pending, 15_000, "Directory write did not settle after release"); const saved = await snapshot(s); const member = saved.people.find(person => person.linkedUserId === s.owner.userId); expect(member?.organizationId).toBe(organization.id); if (existing) expect(member?.id).toBe(before.people[0].id); assertNoDirectoryOrphans(saved);
      // This proves retained target identity only. No concurrent reassignment
      // is performed, and the directory's separate stale-reassignment gap is not fixed.
    } finally { fixture.release(); await deadline(Promise.allSettled([pending]), 15_000, "Gated directory cleanup did not settle"); }
  });

  // Actual transactions with faulting I/O at known boundaries, never an app endpoint/switch.
  for (const fault of ["invoice-insert", "invoice-returning", "invoice-reread", "entry-update", "entry-ids", "audit", "organization-detach", "organization-ids", "client-delete", "client-returning"]) test(`actual transaction rolls back injected ${fault} fault`, async ({ request }) => {
    const s = await seed(request), a = await entry(s); const clientFault = fault.startsWith("client-") || fault.startsWith("organization-"); if (clientFault) { await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId)); await db.insert(schema.organizations).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, clientId: s.clientId, name: "Second original client link", type: "client" }); const [org] = await db.select().from(schema.organizations).where(and(eq(schema.organizations.workspaceId, s.owner.workspaceId), eq(schema.organizations.clientId, s.clientId))); await db.insert(schema.workspacePeople).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, organizationId: org.id, displayName: "Must survive rollback" }); }
    const before = await snapshot(s); let reached = false;
    function resultProxy(result: any, mutate: (value: any) => any): any {
      return new Proxy(result, { get(target, property, receiver) {
        if (property === "then") return (resolve: any, reject: any) => Promise.resolve(target).then(mutate).then(resolve, reject);
        const value = Reflect.get(target, property, receiver); return typeof value === "function" ? (...args: any[]) => resultProxy(value.apply(target, args), mutate) : value;
      } });
    }
    const instrumented = { transaction: (body: (tx: any) => Promise<unknown>, config: any) => db.transaction(tx => body(new Proxy(tx, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (["insert", "update", "delete", "select"].includes(String(property))) return (...args: any[]) => {
        const table = args[0];
        if (fault === "invoice-insert" && property === "insert" && table === schema.invoices || fault === "entry-update" && property === "update" && table === schema.timeEntries || fault === "client-delete" && property === "delete" && table === schema.clients) { reached = true; throw new Error(`Disposable ${fault} fault`); }
        const result = (value as any).apply(target, args);
        if ((fault === "organization-detach" || fault === "organization-ids") && property === "update" && table === schema.organizations) return resultProxy(result, rows => { reached = true; if (fault === "organization-detach") throw new Error("Disposable failure after actual organization detachment"); return rows.map((row: any) => ({ ...row, id: "wrong-organization" })); });
        if (fault === "client-returning" && property === "delete" && table === schema.clients) return resultProxy(result, rows => { reached = true; return rows.map((row: any) => ({ ...row, id: "wrong-client" })); });
        if (fault === "invoice-returning" && property === "insert" && table === schema.invoices) return resultProxy(result, rows => { reached = true; return rows.map((row: any) => ({ ...row, amount: row.amount + 0.01 })); });
        if (fault === "entry-ids" && property === "update" && table === schema.timeEntries) return resultProxy(result, rows => { reached = true; return rows.map((row: any) => ({ ...row, id: "wrong-entry" })); });
        if (fault === "invoice-reread" && property === "select") return resultProxy(result, rows => {
          if (Array.isArray(rows) && rows.some((row: any) => row.number?.startsWith("INV-") && row.workspaceId === s.owner.workspaceId)) { reached = true; return rows.map((row: any) => ({ ...row, amount: row.amount + 0.01 })); } return rows;
        });
        return result;
      };
      return typeof value === "function" ? value.bind(target) : value;
    } })), config) };
    const modules: Record<string, any> = { "@/lib/db": { db: instrumented } };
    if (fault === "audit") { const security = nativeRequire("./lib/security"); modules["@/lib/security"] = { ...security, appendAuditLog: async (...args: any[]) => { await security.appendAuditLog(...args); reached = true; throw new Error("Disposable audit fault after real insertion"); } }; }
    function load(id: string): any {
      if (id in modules) return modules[id];
      if (id !== "@/lib/invoice-selection" && id !== "@/lib/client-history") return nativeRequire(id.startsWith("@/") ? `./${id.slice(2)}` : id);
      const mod = { exports: {} }; new Function("require", "module", "exports", ts.transpileModule(readFileSync(`${id.slice(2)}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(load, mod, mod.exports); return modules[id] = mod.exports;
    }
    await expect(clientFault ? load("@/lib/client-history").deleteUnreferencedWorkspaceClient(s.owner.workspaceId, s.clientId) : load("@/lib/invoice-selection").createInvoiceFromSelection({ workspaceId: s.owner.workspaceId, actorUserId: s.owner.userId, ids: [a.id], dueDate: null })).rejects.toThrow(); expect(reached).toBe(true); const saved = await snapshot(s); expect(saved).toEqual(before); assertNoDirectoryOrphans(saved);
  });

  for (const width of [390, 1440]) test(`real ${width}px selection/create/reload agrees with independently persisted exact IDs/cents`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const s = await seed(page.request);
    await db.update(schema.projects).set({ clientId: null }).where(eq(schema.projects.workspaceId, s.owner.workspaceId));
    const a = await entry(s, { durationSeconds: 1800, hourlyRate: 99.99 }), b = await entry(s, { projectId: null, durationSeconds: 18, hourlyRate: 1 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await gotoApp(page, "/invoices"); const alpha = page.getByRole("button", { name: /Selection alpha/ }); await alpha.focus(); await page.keyboard.press("Space");
    const general = page.getByRole("button", { name: /^General\b/ }); await general.click(); await expect(page.getByText("$50.01 selected.")).toBeVisible(); await expect(page.getByText("Internal — not shared in the client portal").first()).toBeVisible();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/invoices") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create draft invoice (2)", exact: true }).click(); const response = await responsePromise; expect(response.status()).toBe(200); const { invoice } = await response.json();
    await expect(page.getByRole("status").filter({ hasText: /Draft invoice created/ }).first()).toBeVisible(); expect(invoice).toMatchObject({ amountCents: 5001, amount: 50.01, billingAudience: "internal" });
    const saved = await snapshot(s); expect(saved.invoices).toHaveLength(1); expect(saved.invoices[0].id).toBe(invoice.id); expect(saved.invoices[0].amount).toBe(50.01); expect([...saved.invoices[0].timeEntryIds].sort()).toEqual([a.id, b.id].sort()); expect(saved.entries.every(entry => entry.status === "invoiced")).toBe(true); expect(saved.audits.filter(a => a.eventType === "entry_invoiced")).toHaveLength(2);
    await page.reload(); await expect(page.getByText(invoice.number, { exact: true })).toBeVisible(); await expect(page.getByText("$50.01", { exact: true })).toBeVisible(); await expect(alpha).toHaveCount(0); await expect(general).toHaveCount(0); expect(await snapshot(s)).toEqual(saved); expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const screenshotPath = test.info().outputPath(`invoice-created-reloaded-${width}px.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await test.info().attach(`invoice-created-reloaded-${width}px`, { path: screenshotPath, contentType: "image/png" });
  });
  test("real UI 422 keeps selection and exact invoice/approved-entry/audit snapshots unchanged", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 }); const s = await seed(page.request);
    const a = await entry(s, { description: "Large exact line", hourlyRate: 131072 }), b = await entry(s, { projectId: s.q, description: "One cent line", durationSeconds: 36, hourlyRate: 1 });
    const inputs = await db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.workspaceId, s.owner.workspaceId), inArray(schema.timeEntries.id, [a.id, b.id]))); expect(checkedInvoiceCents(inputs)).toBe(13107201);
    const before = await snapshot(s), errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await gotoApp(page, "/invoices"); const alpha = page.getByRole("button", { name: /Selection alpha/ }), beta = page.getByRole("button", { name: /Selection beta/ }); await alpha.click(); await beta.click(); await expect(page.getByText("$131072.01 selected.")).toBeVisible();
    const pending = page.waitForResponse(response => response.url().endsWith("/api/invoices") && response.request().method() === "POST"); await page.getByRole("button", { name: "Create draft invoice (2)", exact: true }).click(); expect((await pending).status()).toBe(422); await expect(page.getByRole("alert").filter({ hasText: "This total cannot be stored without changing a cent." })).toContainText(/cannot be stored without changing a cent/); await expect(alpha).toHaveAttribute("aria-pressed", "true"); await expect(beta).toHaveAttribute("aria-pressed", "true"); expect(await snapshot(s)).toEqual(before); expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const screenshotPath = test.info().outputPath("invoice-422-retained-selection-390px.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await test.info().attach("invoice-422-retained-selection-390px", { path: screenshotPath, contentType: "image/png" });
  });
});

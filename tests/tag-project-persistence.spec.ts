/* eslint-disable @typescript-eslint/no-explicit-any -- Test-only query forwarding keeps the actual Drizzle fluent object and production queries intact. */
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import path from "node:path";
import * as schema from "../lib/db/schema";
import * as workflow from "../lib/workflow-validation";
import { generateApiKeyMaterial, type ApiScope } from "../lib/api-keys";

// ROOT ONLY: reviewed disposable wrapper + exclusively owned app on port 3008.
// API keys never enter traces, screenshots, video, attachments or console output,
// including on retries/failures. Custom request contexts do not enable tracing.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });
test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable PostgreSQL wrapper required");
test.setTimeout(60_000);

type Surface = "native" | "public";
type Playwright = typeof import("playwright-core");
type Owner = { workspaceId: string; userId: string; slug: string };
type Phase = "project-locked" | "tags-cleared" | "tag-returned";
type OwnedOperation<T> = { settled: boolean; result: Promise<{ value: T; error?: never } | { error: unknown; value?: never }> };
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  expect(process.env.SOWLEDGER_TEST_DATABASE).toBe("true");
  pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, max: 6, connectionTimeoutMillis: 3000, query_timeout: 12_000 });
  database = drizzle(pool, { schema });
});
test.afterAll(async () => { if (pool) await deadline(pool.end(), 15_000, "Owned tag pool did not close"); });

// DEADLINES / DRAIN: Every timer is cleared and every owned operation has a
// rejection handler immediately, even when a reached-barrier assertion fails.
async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
class Operations {
  private owned: OwnedOperation<unknown>[] = [];
  start<T>(action: () => Promise<T>): OwnedOperation<T> {
    const op = { settled: false } as OwnedOperation<T>;
    op.result = Promise.resolve().then(action).then(value => ({ value }), error => ({ error })).finally(() => { op.settled = true; });
    this.owned.push(op);
    return op;
  }
  async finish<T>(op: OwnedOperation<T>): Promise<T> {
    const outcome = await deadline(op.result, 15_000, "Owned tag operation did not settle");
    if ("error" in outcome) throw outcome.error;
    return outcome.value as T;
  }
  async drain() { await deadline(Promise.all(this.owned.map(op => op.result)), 15_000, "Owned tag operations did not drain; retain fixtures for branch disposal"); }
}

// READBACK / FIXTURE LEDGER: Only UUID-owned returned IDs are accepted. No
// clean=true endpoint, prefix cleanup, shared user lookup or primary DB use.
class Fixture {
  readonly ops = new Operations();
  readonly contexts: APIRequestContext[] = [];
  readonly owners: Owner[] = [];
  readonly keys: Array<{ workspaceId: string; id: string }> = [];
  readonly projectIds: Array<{ workspaceId: string; id: string }> = [];
  readonly tagIds: Array<{ workspaceId: string; id: string }> = [];
  constructor(readonly playwright: Playwright, readonly baseURL: string) {}
  async context() {
    const ctx = await this.playwright.request.newContext({ baseURL: this.baseURL, timeout: 12_000 });
    this.contexts.push(ctx); return ctx;
  }
  async login(role = "owner", slug = `tag-acceptance-${crypto.randomUUID()}`) {
    const request = await this.context();
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace: slug, email: `tag-${crypto.randomUUID()}@example.com`, plan: "smb", role })}`);
    expect(response.status()).toBe(200);
    const value = await response.json();
    expect(value.workspaceId).toMatch(/^[0-9a-f-]{36}$/); expect(value.userId).toMatch(/^[0-9a-f-]{36}$/);
    const owner = { workspaceId: value.workspaceId as string, userId: value.userId as string, slug };
    this.owners.push(owner); // record IDs immediately before any further action
    expect((await pool.query('select slug from "sowledger"."workspaces" where id=$1', [owner.workspaceId])).rows).toEqual([{ slug }]);
    return { request, owner };
  }
  async project(request: APIRequestContext, owner: Owner) {
    const response = await request.post("/api/projects", { data: { name: `Tag project ${crypto.randomUUID()}` } });
    expect(response.status()).toBe(200); const { project } = await response.json();
    this.projectIds.push({ workspaceId: owner.workspaceId, id: project.id }); return project.id as string;
  }
  async tag(request: APIRequestContext, owner: Owner, projectId: string | null = null) {
    const response = await request.post("/api/settings/tags", { data: { name: `tag-${crypto.randomUUID()}`, projectId } });
    expect(response.status()).toBe(200); const { tag } = await response.json();
    this.tagIds.push({ workspaceId: owner.workspaceId, id: tag.id }); return tag.id as string;
  }
  async key(owner: Owner, scopes: ApiScope[] = ["read:tags", "write:tags"]) {
    const material = generateApiKeyMaterial(), id = crypto.randomUUID();
    this.keys.push({ workspaceId: owner.workspaceId, id });
    await database.insert(schema.apiKeys).values({ id, workspaceId: owner.workspaceId, createdByUserId: owner.userId, name: "Disposable tag acceptance", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes });
    return { id, headers: { authorization: `Bearer ${material.rawKey}` } };
  }
  async saved(workspaceId: string, id: string) {
    return (await pool.query('select id,workspace_id,project_id,name,color,is_billable_default,status from "sowledger"."workspace_tags" where workspace_id=$1 and id=$2', [workspaceId, id])).rows[0];
  }
  async tags(workspaceId: string) {
    return (await pool.query('select id,workspace_id,project_id,name,color,is_billable_default,status from "sowledger"."workspace_tags" where workspace_id=$1 order by id', [workspaceId])).rows;
  }
  async seed() {
    const { request, owner } = await this.login();
    const projectId = await this.project(request, owner), otherProjectId = await this.project(request, owner), tagId = await this.tag(request, owner), key = await this.key(owner);
    return { request, owner, projectId, otherProjectId, tagId, key };
  }
  // CLEANUP: called only after all transactions/requests drained. Exact workspace
  // IDs+slugs are rechecked; all memberships must belong to ledger-returned users.
  // Workspace schema FKs cascade only those exact synthetic workspace rows.
  // Users are deliberately RETAINED for disposable-branch teardown: no email or
  // guessed-membership deletion and no attempt to prove shared-user ownership.
  async cleanup() {
    for (const [id, owner] of new Map(this.owners.map(o => [o.workspaceId, o]))) {
      const workspace = (await pool.query('select slug from "sowledger"."workspaces" where id=$1', [id])).rows;
      expect(workspace).toEqual([{ slug: owner.slug }]);
      const users = new Set(this.owners.filter(o => o.workspaceId === id).map(o => o.userId));
      const memberships = (await pool.query('select user_id from "sowledger"."memberships" where workspace_id=$1', [id])).rows;
      expect(memberships.every(row => users.has(row.user_id))).toBe(true);
      for (const key of this.keys.filter(k => k.workspaceId === id)) {
        await pool.query('delete from "sowledger"."api_key_requests" where workspace_id=$1 and api_key_id=$2', [id, key.id]);
        await pool.query('delete from "sowledger"."api_keys" where workspace_id=$1 and id=$2', [id, key.id]);
      }
      await pool.query('delete from "sowledger"."workspaces" where id=$1 and slug=$2', [id, owner.slug]);
    }
  }
}
async function withFixture(playwright: Playwright, baseURL: string | undefined, body: (f: Fixture) => Promise<void>) {
  expect(process.env.SOWLEDGER_TEST_DATABASE).toBe("true");
  expect(baseURL).toBe("http://localhost:3008");
  const f = new Fixture(playwright, baseURL!);
  let completed = false;
  try { await body(f); completed = true; }
  finally {
    let drained = false;
    try { await f.ops.drain(); drained = true; }
    finally {
      const closed = await Promise.allSettled(f.contexts.map(context => deadline(context.dispose(), 5000, "Owned request context did not close")));
      const contextsClosed = closed.every(result => result.status === "fulfilled");
      // A failed/timed-out HTTP action might still be finishing in the app.
      // Do not race fixture deletion against it: retain all rows on any failure.
      if (completed && drained && contextsClosed) await f.cleanup();
      else await test.info().attach("retained-tag-ledger", { contentType: "application/json", body: JSON.stringify({ workspaces: f.owners, keys: f.keys, projects: f.projectIds, tags: f.tagIds }) });
      if (!contextsClosed) throw new Error("Owned tag request context did not close; retained fixtures for branch disposal");
    }
  }
}
function write(request: APIRequestContext, surface: Surface, headers: Record<string, string>, method: "POST" | "PATCH", data: unknown) {
  return request[method === "POST" ? "post" : "patch"](surface === "native" ? "/api/settings/tags" : "/api/v1/tags", { data, headers: surface === "public" ? headers : {} });
}
async function expectStatus(response: APIResponse, status: number) { expect(response.status(), await response.text()).toBe(status); return response.json(); }

// REAL LOCK OBSERVATION: query only lock metadata on the named relation and
// connections blocked by our known holder PID. Never inspect session SQL text.
async function waitBlocked(observer: PoolClient, holderPid: number, relation: "projects" | "workspace_tags", op: OwnedOperation<unknown>) {
  const observerPid = Number((await observer.query("select pg_backend_pid() as pid")).rows[0].pid);
  expect(observerPid).not.toBe(holderPid);
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    expect(op.settled, "Competitor must reach the intended lock, not fail early").toBe(false);
    const edges = (await observer.query<{ pid: number; blockers: number[] }>(`select distinct l.pid,pg_blocking_pids(l.pid) as blockers from pg_locks l where l.database=(select oid from pg_database where datname=current_database()) and l.relation=$2::regclass and $1=any(pg_blocking_pids(l.pid))`, [holderPid, `"sowledger"."${relation}"`])).rows;
    if (edges.length) {
      expect(edges).toHaveLength(1); expect(edges[0].pid).not.toBe(holderPid);
      await test.info().attach(`reached-${relation}-${holderPid}`, { contentType: "application/json", body: JSON.stringify({ holderPid, observerPid, relation, edges }) });
      return edges[0].pid;
    }
    await yieldLoop();
  }
  throw new Error(`No owned PostgreSQL blocking edge reached on ${relation}`);
}

// RAW HOLDER: exact UUID workspace/row predicates, actual READ COMMITTED lock,
// 12-second emergency rollback, and one idempotent release/rollback operation.
async function holdRow(workspaceId: string, id: string, relation: "projects" | "workspace_tags") {
  const client = await pool.connect();
  let released = false, forced = false, emergencyRollback: Promise<unknown> | undefined, emergencyError: unknown;
  const timer = setTimeout(() => { forced = true; emergencyRollback = client.query("rollback").catch(error => { emergencyError = error; }); }, 12_000);
  try {
    await client.query("begin isolation level read committed");
    await client.query("set local statement_timeout='10s'");
    const pid = Number((await client.query("select pg_backend_pid() as pid")).rows[0].pid);
    const row = await client.query(`select id from "sowledger"."${relation}" where workspace_id=$1 and id=$2 for update`, [workspaceId, id]); expect(row.rowCount).toBe(1);
    return { client, pid, forced: () => forced, async release(commit = false) {
      if (released) return;
      released = true; clearTimeout(timer);
      try { if (emergencyRollback) { await emergencyRollback; if (emergencyError) throw emergencyError; } else await client.query(commit ? "commit" : "rollback"); }
      finally { client.release(); }
    } };
  } catch (error) { clearTimeout(timer); try { await client.query("rollback"); } finally { client.release(); } throw error; }
}

// FORWARDING: no app hook, query replacement, fake rows, changed predicates or
// synthetic locks. Pause ONLY after the exact real operation has returned.
// The same actual callback transaction owns the lock until commit/rollback.
function forwardedService(phase: Phase) {
  let reached!: (v: { pid: number; phase: Phase }) => void, release!: (commit: boolean) => void;
  const reachedPromise = new Promise<{ pid: number; phase: Phase }>(resolve => { reached = resolve; });
  const permit = new Promise<boolean>(resolve => { release = resolve; });
  const emergency = setTimeout(() => release(false), 12_000);
  let held = false;
  async function pause(pid: number, actual: Phase | undefined) {
    if (actual !== phase || held) return;
    held = true; reached({ pid, phase });
    if (!(await permit)) throw new Error("Owned forwarding gate aborted; actual transaction rolled back");
  }
  const forwardedDb = {
    transaction: (body: (tx: any) => Promise<unknown>, config: any) => database.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout='10s'`);
      const isolation = (await tx.execute(sql`select current_setting('transaction_isolation') as isolation`)).rows[0].isolation;
      expect(isolation).toBe("read committed");
      const pid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
      type Query = { kind: string; table?: unknown; clear?: boolean; phase?: Phase };
      function builder(target: any, query: Query): any {
        return new Proxy(target, { get(object, property) {
          if (property === "then") return (yes: any, no: any) => Promise.resolve(object).then(async value => { await pause(pid, query.phase); return value; }).then(yes, no);
          const member = Reflect.get(object, property, object);
          if (typeof member !== "function") return member;
          return (...args: any[]) => {
            const next = { ...query };
            if (property === "from") next.table = args[0];
            if (property === "set") next.clear = args[0].projectId === null;
            if (property === "for" && next.table === schema.projects && args[0] === "update") next.phase = "project-locked";
            if (property === "where" && next.table === schema.workspaceTags && next.kind === "update" && next.clear) next.phase = "tags-cleared";
            if (property === "returning" && next.table === schema.workspaceTags) next.phase = "tag-returned";
            const result = member.apply(object, args);
            return result && typeof result === "object" ? builder(result, next) : result;
          };
        } });
      }
      const wrapped = new Proxy(tx, { get(target, property) {
        const member = Reflect.get(target, property, target);
        if (["select", "insert", "update", "delete"].includes(String(property))) return (...args: any[]) => builder(member.apply(target, args), { kind: String(property), table: property === "select" ? undefined : args[0] });
        return typeof member === "function" ? member.bind(target) : member;
      } });
      return body(wrapped);
    }, config),
    // Native duplicate precheck is outside the association callback transaction.
    select: database.select.bind(database),
  };
  const modules: Record<string, any> = { "@/lib/db": { db: forwardedDb }, "@/lib/db/schema": schema, "@/lib/workflow-validation": workflow };
  const native = createRequire(path.join(process.cwd(), "package.json"));
  const allowed = new Set(["@/lib/tag-mutations", "@/lib/tag-validation", "@/lib/project-history"]);
  function load(id: string): any {
    if (id in modules) return modules[id];
    if (!id.startsWith("@/")) { expect(id).toBe("drizzle-orm"); return native(id); }
    if (!allowed.has(id)) throw new Error(`Unreviewed forwarding dependency ${id}`);
    const mod = { exports: {} }; modules[id] = mod.exports;
    new Function("require", "module", "exports", transformSync(readFileSync(`${id.slice(2)}.ts`, "utf8"), { loader: "ts", format: "cjs" }).code)(load, mod, mod.exports);
    return modules[id] = mod.exports;
  }
  return { tags: load("@/lib/tag-mutations"), projects: load("@/lib/project-history"), reached: () => deadline(reachedPromise, 6000, `Actual forwarding phase ${phase} was not reached`), release() { clearTimeout(emergency); release(true); }, abort() { clearTimeout(emergency); release(false); } };
}

for (const surface of ["native", "public"] as const) {
  test(`${surface}: HTTP CRUD/auth/scopes/usage and reference-only historical strings persist`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
    const s = await f.seed(), foreign = await f.login(), foreignProject = await f.project(foreign.request, foreign.owner), foreignTag = await f.tag(foreign.request, foreign.owner, foreignProject);
    const foreignBefore = await f.tags(foreign.owner.workspaceId);
    const entryId = crypto.randomUUID(), historyProject = await f.project(s.request, s.owner);
    await database.insert(schema.timeEntries).values({ id: entryId, workspaceId: s.owner.workspaceId, userId: s.owner.userId, taskId: "historical tag work", projectId: historyProject, tags: ["historical-label"], startedAt: new Date("2026-10-01T09:00:00Z"), stoppedAt: new Date("2026-10-01T10:00:00Z"), durationSeconds: 3600 });
    const created = await write(s.request, surface, s.key.headers, "POST", { name: " Historical-label ", color: " rebeccapurple ", projectId: s.projectId, isSOWLedgerDefault: false, status: "archived" });
    const { tag } = await expectStatus(created, surface === "native" ? 200 : 201); f.tagIds.push({ workspaceId: s.owner.workspaceId, id: tag.id });
    expect(tag).toMatchObject({ workspaceId: s.owner.workspaceId, name: "historical-label", color: "rebeccapurple", projectId: s.projectId, isSOWLedgerDefault: false, status: "active" });
    expect(await f.saved(s.owner.workspaceId, tag.id)).toMatchObject({ name: "historical-label", color: "rebeccapurple", project_id: s.projectId, is_billable_default: false });
    await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: tag.id, name: " Mixed Case ", isSOWLedgerDefault: true }), 200);
    expect(await f.saved(s.owner.workspaceId, tag.id)).toMatchObject({ name: surface === "native" ? "mixed case" : "Mixed Case", project_id: s.projectId, color: "rebeccapurple", is_billable_default: true });
    for (const projectId of ["", null]) await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: tag.id, projectId, isSOWLedgerDefault: false }), 200);
    expect(await f.saved(s.owner.workspaceId, tag.id)).toMatchObject({ project_id: null, is_billable_default: false });
    for (const projectId of [foreignProject, crypto.randomUUID()]) expect((await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: tag.id, projectId }), 400)).error).toBe("projectId is not in this workspace");
    for (const absentId of [foreignTag, crypto.randomUUID()]) {
      expect((await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: absentId, name: "No" }), 404)).error).toBe("Tag not found.");
      const route = surface === "native" ? "/api/settings/tags" : "/api/v1/tags";
      expect((await expectStatus(await s.request.delete(`${route}?id=${absentId}`, { headers: surface === "public" ? s.key.headers : {} }), 404)).error).toBe("Tag not found.");
    }
    for (const fields of [{ unknown: true }, { name: " " }, { color: "x".repeat(51) }, { projectId: " " }, { isSOWLedgerDefault: "false" }, { status: "closed" }]) await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: tag.id, ...fields }), 400);
    const readKey = await f.key(s.owner, ["read:tags"]);
    await expectStatus(await s.request.patch("/api/v1/tags", { headers: readKey.headers, data: { tagId: tag.id, color: "cyan" } }), 403);
    const manager = await f.login("manager", s.owner.slug), member = await f.login("member", s.owner.slug);
    await expectStatus(await manager.request.patch("/api/settings/tags", { data: { tagId: tag.id, color: "cyan" } }), 200);
    await expectStatus(await member.request.get("/api/settings/tags"), 200);
    await expectStatus(await member.request.patch("/api/settings/tags", { data: { tagId: tag.id, color: "red" } }), 403);
    const anonymous = await f.context();
    expect((await anonymous.get("/api/settings/tags", { maxRedirects: 0 })).status()).toBe(307);
    await expectStatus(await anonymous.patch("/api/settings/tags", { headers: { cookie: "sowledger_session=invalid" }, data: { tagId: tag.id, color: "red" }, maxRedirects: 0 }), 401);
    await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: tag.id, status: "archived" }), 200);
    const route = surface === "native" ? "/api/settings/tags" : "/api/v1/tags";
    expect(await expectStatus(await s.request.delete(`${route}?id=${tag.id}`, { headers: surface === "public" ? s.key.headers : {} }), 200)).toEqual(surface === "native" ? { ok: true } : { ok: true, id: tag.id });
    if (surface === "native") expect(await f.saved(s.owner.workspaceId, tag.id)).toBeUndefined();
    else { expect(await f.saved(s.owner.workspaceId, tag.id)).toMatchObject({ status: "archived" }); await expectStatus(await s.request.delete(`${route}?id=${tag.id}`, { headers: s.key.headers }), 200); }
    expect((await pool.query('select tags from "sowledger"."time_entries" where workspace_id=$1 and id=$2', [s.owner.workspaceId, entryId])).rows).toEqual([{ tags: ["historical-label"] }]);
    expect(await f.tags(foreign.owner.workspaceId)).toEqual(foreignBefore);
    await expectStatus(await s.request.get("/api/v1/tags", { headers: s.key.headers }), 200);
    await expectStatus(await s.request.get("/api/v1/tags", { headers: { authorization: "Bearer invalid-synthetic" } }), 401);
    const usage = (await pool.query('select status from "sowledger"."api_key_requests" where workspace_id=$1 and api_key_id=$2', [s.owner.workspaceId, s.key.id])).rows.map(r => r.status);
    expect(usage).toEqual(expect.arrayContaining(surface === "public" ? [201, 200, 400, 404] : [200]));
    expect((await pool.query('select status from "sowledger"."api_key_requests" where workspace_id=$1 and api_key_id=$2', [s.owner.workspaceId, readKey.id])).rows).toEqual([{ status: 403 }]);
    await pool.query('update "sowledger"."api_keys" set revoked_at=now() where workspace_id=$1 and id=$2', [s.owner.workspaceId, s.key.id]);
    await expectStatus(await s.request.get("/api/v1/tags", { headers: s.key.headers }), 401);
    expect((await pool.query('select status from "sowledger"."api_key_requests" where workspace_id=$1 and api_key_id=$2', [s.owner.workspaceId, s.key.id])).rows.map(r => r.status)).toContain(401);
  }));

  for (const method of ["POST", "PATCH"] as const) {
    test(`${surface} ${method} actually waits on scoped project lock before writing`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
      const s = await f.seed(), holder = await holdRow(s.owner.workspaceId, s.projectId, "projects"), observer = await pool.connect();
      try {
        const before = await f.tags(s.owner.workspaceId);
        const op = f.ops.start(() => write(s.request, surface, s.key.headers, method, { tagId: s.tagId, name: `gate-${crypto.randomUUID()}`, projectId: s.projectId }));
        await waitBlocked(observer, holder.pid, "projects", op); expect(await f.tags(s.owner.workspaceId)).toEqual(before);
        await holder.release(true); expect(holder.forced()).toBe(false);
        const { tag } = await expectStatus(await f.ops.finish(op), method === "POST" && surface === "public" ? 201 : 200);
        f.tagIds.push({ workspaceId: s.owner.workspaceId, id: tag.id }); expect((await f.saved(s.owner.workspaceId, tag.id)).project_id).toBe(s.projectId);
      } finally { await holder.release(); observer.release(); }
    }));

    for (const phase of ["project-locked", "tags-cleared"] as const) test(`${surface} ${method} delete-first at ${phase} rejects late association, including previously unrelated tag`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
      const s = await f.seed(), observer = await pool.connect(), gate = forwardedService(phase);
      const deletion = f.ops.start(() => gate.projects.deleteUnusedWorkspaceProject(s.owner.workspaceId, s.projectId));
      try {
        const reached = await gate.reached();
        const association = f.ops.start(() => write(s.request, surface, s.key.headers, method, { tagId: s.tagId, name: `late-${crypto.randomUUID()}`, projectId: s.projectId }));
        await waitBlocked(observer, reached.pid, "projects", association);
        gate.release(); await f.ops.finish(deletion);
        expect((await expectStatus(await f.ops.finish(association), 400)).error).toBe("projectId is not in this workspace");
        expect((await pool.query('select id from "sowledger"."projects" where workspace_id=$1 and id=$2', [s.owner.workspaceId, s.projectId])).rows).toEqual([]);
        expect((await f.tags(s.owner.workspaceId)).some(t => t.project_id === s.projectId)).toBe(false);
      } finally { gate.abort(); try { await f.ops.drain(); } finally { observer.release(); } }
    }));

    test(`${surface} ${method} association-first saved before waiting deletion clears it`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
      const s = await f.seed(), observer = await pool.connect(), gate = forwardedService("tag-returned");
      const association = f.ops.start(() => method === "POST" ? gate.tags.createWorkspaceTag(s.owner.workspaceId, { name: `first-${crypto.randomUUID()}`, projectId: s.projectId }, surface === "native") : gate.tags.updateWorkspaceTag(s.owner.workspaceId, { tagId: s.tagId, projectId: s.projectId }, surface));
      try {
        const reached = await gate.reached();
        const deletion = f.ops.start(() => s.request.delete(`/api/projects?projectId=${s.projectId}`));
        await waitBlocked(observer, reached.pid, "projects", deletion);
        gate.release(); const saved = await f.ops.finish(association) as { id: string; projectId: string }; expect(saved.projectId).toBe(s.projectId); f.tagIds.push({ workspaceId: s.owner.workspaceId, id: saved.id });
        await expectStatus(await f.ops.finish(deletion), 200); expect((await f.saved(s.owner.workspaceId, saved.id)).project_id).toBeNull();
      } finally { gate.abort(); try { await f.ops.drain(); } finally { observer.release(); } }
    }));
  }

  for (const deleting of ["A", "B"] as const) test(`${surface} A-to-B committed before delete${deleting} preserves B only when appropriate; tag predicate rechecked after wait`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
    const s = await f.seed(); await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, projectId: s.projectId }), 200);
    const observer = await pool.connect(), gate = forwardedService("tag-returned");
    const move = f.ops.start(() => gate.tags.updateWorkspaceTag(s.owner.workspaceId, { tagId: s.tagId, projectId: s.otherProjectId }, surface));
    try {
      const reached = await gate.reached(), removedId = deleting === "A" ? s.projectId : s.otherProjectId;
      const deletion = f.ops.start(() => s.request.delete(`/api/projects?projectId=${removedId}`));
      await waitBlocked(observer, reached.pid, deleting === "A" ? "workspace_tags" : "projects", deletion);
      gate.release(); const saved = await f.ops.finish(move) as { projectId: string }; expect(saved.projectId).toBe(s.otherProjectId);
      await expectStatus(await f.ops.finish(deletion), 200); expect((await f.saved(s.owner.workspaceId, s.tagId)).project_id).toBe(deleting === "A" ? s.otherProjectId : null);
    } finally { gate.abort(); try { await f.ops.drain(); } finally { observer.release(); } }
  }));

  test(`${surface} A-to-B waits for deleteA tag-clear then sets only B, without restoring A`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
    const s = await f.seed(); await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, projectId: s.projectId }), 200);
    const observer = await pool.connect(), gate = forwardedService("tags-cleared");
    const deletion = f.ops.start(() => gate.projects.deleteUnusedWorkspaceProject(s.owner.workspaceId, s.projectId));
    try {
      const reached = await gate.reached();
      const move = f.ops.start(() => write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, projectId: s.otherProjectId }));
      await waitBlocked(observer, reached.pid, "workspace_tags", move);
      gate.release(); await f.ops.finish(deletion); await expectStatus(await f.ops.finish(move), 200);
      expect((await f.saved(s.owner.workspaceId, s.tagId)).project_id).toBe(s.otherProjectId);
    } finally { gate.abort(); try { await f.ops.drain(); } finally { observer.release(); } }
  }));

  test(`${surface} deleteB-first after clear rejects A-to-B and preserves the existing A association`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
    const s = await f.seed(); await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, projectId: s.projectId }), 200);
    const observer = await pool.connect(), gate = forwardedService("tags-cleared");
    const deletion = f.ops.start(() => gate.projects.deleteUnusedWorkspaceProject(s.owner.workspaceId, s.otherProjectId));
    try {
      const reached = await gate.reached();
      const move = f.ops.start(() => write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, projectId: s.otherProjectId }));
      await waitBlocked(observer, reached.pid, "projects", move);
      gate.release(); await f.ops.finish(deletion);
      expect((await expectStatus(await f.ops.finish(move), 400)).error).toBe("projectId is not in this workspace");
      expect((await f.saved(s.owner.workspaceId, s.tagId)).project_id).toBe(s.projectId);
    } finally { gate.abort(); try { await f.ops.drain(); } finally { observer.release(); } }
  }));

  for (const fields of [{ projectId: null }, { color: "cyan" }, { status: "archived" }]) test(`${surface} ${JSON.stringify(fields)} completes while associated old project is held`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
    const s = await f.seed(); await expectStatus(await write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, projectId: s.projectId }), 200);
    const holder = await holdRow(s.owner.workspaceId, s.projectId, "projects");
    try {
      const op = f.ops.start(() => write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, ...fields }));
      await expectStatus(await deadline(f.ops.finish(op), 5000, "Unrelated metadata unexpectedly waited for old project"), 200);
      expect(holder.forced()).toBe(false); expect((await f.saved(s.owner.workspaceId, s.tagId)).project_id).toBe("projectId" in fields ? null : s.projectId);
    } finally { await holder.release(); }
  }));

  for (const method of ["PATCH", "DELETE"] as const) test(`${surface} ${method} actual tag-row wait followed by delete commit returns404`, async ({ playwright, baseURL }) => withFixture(playwright, baseURL, async f => {
    const s = await f.seed(), holder = await holdRow(s.owner.workspaceId, s.tagId, "workspace_tags"), observer = await pool.connect();
    try {
      const route = surface === "native" ? "/api/settings/tags" : "/api/v1/tags";
      const op = f.ops.start(() => method === "PATCH" ? write(s.request, surface, s.key.headers, "PATCH", { tagId: s.tagId, color: "cyan" }) : s.request.delete(`${route}?id=${s.tagId}`, { headers: surface === "public" ? s.key.headers : {} }));
      await waitBlocked(observer, holder.pid, "workspace_tags", op);
      await holder.client.query('delete from "sowledger"."workspace_tags" where workspace_id=$1 and id=$2', [s.owner.workspaceId, s.tagId]);
      await holder.release(true); expect(holder.forced()).toBe(false);
      expect((await expectStatus(await f.ops.finish(op), 404)).error).toBe("Tag not found."); expect(await f.saved(s.owner.workspaceId, s.tagId)).toBeUndefined();
    } finally { await holder.release(); observer.release(); }
  }));
}

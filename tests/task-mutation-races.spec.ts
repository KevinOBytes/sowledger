/* eslint-disable @typescript-eslint/no-explicit-any -- Test-only instrumentation forwards actual pg/Drizzle operations; no production hook. */
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { Pool, type PoolClient } from "pg";
import { and, eq } from "drizzle-orm";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { db } from "../lib/db";
import { clients, organizations, apiKeys } from "../lib/db/schema";
import { generateApiKeyMaterial } from "../lib/api-keys";

type Owner = { workspaceId: string; userId: string };
type Seed = { owner: Owner; projectId: string; a: string; b: string; headers: Record<string, string> };
type Pending = { settled: boolean; result: Promise<APIResponse> };
const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}

test.describe("task writes: actual HTTP competitors and observed same-project PostgreSQL barriers", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable PostgreSQL wrapper only; no operator database.");
  test.setTimeout(45_000);
  let pool: Pool;
  test.beforeAll(() => { pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 3000, query_timeout: 10_000 }); });
  test.afterAll(async () => { await pool?.end(); });

  async function seed(request: APIRequestContext): Promise<Seed> {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace: `task-race-${crypto.randomUUID()}`, email: `race-${crypto.randomUUID()}@example.com`, plan: "smb" })}`);
    expect(response.ok(), await response.text()).toBeTruthy(); const owner = await response.json() as Owner;
    const project = await request.post("/api/projects", { data: { name: "Serialized tasks" } }); expect(project.ok(), await project.text()).toBeTruthy(); const projectId = (await project.json()).project.id as string;
    const ids: string[] = [];
    for (const title of ["A", "B"]) { const made = await request.post("/api/tasks", { data: { projectId, title } }); expect(made.ok(), await made.text()).toBeTruthy(); ids.push((await made.json()).task.id); }
    const material = generateApiKeyMaterial(); await db.insert(apiKeys).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, createdByUserId: owner.userId, name: "Disposable race key", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes: ["write:tasks"] });
    return { owner, projectId, a: ids[0], b: ids[1], headers: { authorization: `Bearer ${material.rawKey}` } };
  }

  async function persisted(observer: PoolClient, s: Seed) {
    return (await observer.query<{ id: string; parent_id: string | null; blocked_by_task_ids: string[] | null; status: string }>('select id,parent_id,blocked_by_task_ids,status from "sowledger"."project_tasks" where workspace_id=$1 and project_id=$2 order by id', [s.owner.workspaceId, s.projectId])).rows;
  }

  async function waitForProjectWaiters(observer: PoolClient, holderPid: number, count: number, pending: Pending[]) {
    const end = Date.now() + 6500;
    while (Date.now() < end) {
      expect(pending.every(op => !op.settled), "Requests must still be waiting, not failed early").toBe(true);
      // Restrict observation to row-locking users of this relation and their
      // blocking PIDs. Never inspect SQL text, credentials, or unrelated rows.
      const locks = (await observer.query<{ pid: number; blockers: number[] }>(`select distinct l.pid,pg_blocking_pids(l.pid) as blockers from pg_locks l where l.database=(select oid from pg_database where datname=current_database()) and l.relation='"sowledger"."projects"'::regclass and l.mode='RowShareLock' and l.pid<>$1`, [holderPid])).rows;
      const chained = new Set<number>([holderPid]);
      for (let pass = 0; pass <= locks.length; pass++) for (const row of locks) if (row.blockers.some(pid => chained.has(pid))) chained.add(row.pid);
      if (chained.size - 1 >= count) return [...chained].filter(pid => pid !== holderPid);
      await yieldLoop();
    }
    throw new Error(`Did not observe ${count} actual request connections waiting on the held project row`);
  }

  async function barrier(s: Seed, first: () => Promise<APIResponse>, second: () => Promise<APIResponse>) {
    const holder = await pool.connect(), observer = await pool.connect(); let released = false;
    const pending: Pending[] = [];
    const start = (action: () => Promise<APIResponse>) => { const op = { settled: false } as Pending; op.result = action().finally(() => { op.settled = true; }); pending.push(op); };
    let forced = false;
    const emergency = setTimeout(() => { forced = true; void holder.query("rollback").then(() => { released = true; }); }, 15_000);
    try {
      await holder.query("begin isolation level read committed");
      const holderPid = Number((await holder.query("select pg_backend_pid() as pid")).rows[0].pid);
      const observerPid = Number((await observer.query("select pg_backend_pid() as pid")).rows[0].pid); expect(observerPid).not.toBe(holderPid);
      const locked = await holder.query('select id from "sowledger"."projects" where workspace_id=$1 and id=$2 for update', [s.owner.workspaceId, s.projectId]); expect(locked.rowCount).toBe(1);
      const before = await persisted(observer, s);
      start(first); const one = await waitForProjectWaiters(observer, holderPid, 1, pending); expect(one).toHaveLength(1);
      start(second); const both = await waitForProjectWaiters(observer, holderPid, 2, pending); expect(both.length).toBeGreaterThanOrEqual(2);
      expect(await persisted(observer, s)).toEqual(before); expect(forced).toBe(false);
      await holder.query("commit"); released = true;
      const responses = await deadline(Promise.all(pending.map(op => op.result)), 15_000, "Task HTTP competitors did not finish after project release");
      expect(forced).toBe(false); return { responses, rows: await persisted(observer, s) };
    } finally {
      clearTimeout(emergency);
      if (!released) await holder.query("rollback");
      try { await deadline(Promise.allSettled(pending.map(op => op.result)), 15_000, "Owned HTTP competitors did not settle during barrier cleanup"); }
      finally { holder.release(); observer.release(); }
    }
  }

  for (const kind of ["parentId", "blockedByTaskIds"] as const) test(`opposite ${kind} assignments cannot commit a multi-node cycle after observed project contention`, async ({ request }) => {
    const s = await seed(request), edge = (id: string) => kind === "parentId" ? id : [id];
    const run = await barrier(s,
      () => request.patch("/api/tasks", { data: { taskId: s.a, [kind]: edge(s.b) } }),
      () => request.patch("/api/tasks", { data: { taskId: s.b, [kind]: edge(s.a) } }));
    expect(run.responses.map(r => r.status()).sort()).toEqual([200, 400]);
    const a = run.rows.find(row => row.id === s.a)!, b = run.rows.find(row => row.id === s.b)!;
    expect(kind === "parentId" ? a.parent_id === s.b && b.parent_id === s.a : a.blocked_by_task_ids?.includes(s.b) && b.blocked_by_task_ids?.includes(s.a)).toBeFalsy();
  });

  for (const kind of ["parentId", "blockedByTaskIds"] as const) for (const deletionFirst of [false, true]) test(`${kind} native link versus public DELETE, deletionFirst=${deletionFirst}, cannot leave an adopted dangling reference`, async ({ request }) => {
    const s = await seed(request);
    const link = () => request.patch("/api/tasks", { data: { taskId: s.a, [kind]: kind === "parentId" ? s.b : [s.b] } });
    const remove = () => request.delete(`/api/v1/tasks?id=${s.b}`, { headers: s.headers });
    const run = await barrier(s, deletionFirst ? remove : link, deletionFirst ? link : remove);
    const statuses = run.responses.map(r => r.status()).sort(); expect([[200, 404], [200, 409]]).toContainEqual(statuses);
    const a = run.rows.find(row => row.id === s.a)!, b = run.rows.find(row => row.id === s.b);
    if (kind === "parentId" ? a.parent_id === s.b : a.blocked_by_task_ids?.includes(s.b)) expect(b).toBeTruthy();
    else expect(b).toBeUndefined();
  });

  for (const completionFirst of [false, true]) test(`native completion versus public blocker reopen observes a valid serial order, completionFirst=${completionFirst}`, async ({ request }) => {
    const s = await seed(request);
    expect((await request.patch("/api/tasks", { data: { taskId: s.b, status: "done" } })).status()).toBe(200);
    expect((await request.patch("/api/tasks", { data: { taskId: s.a, blockedByTaskIds: [s.b] } })).status()).toBe(200);
    const complete = () => request.patch("/api/tasks", { data: { taskId: s.a, status: "done" } });
    const reopen = () => request.patch("/api/v1/tasks", { headers: s.headers, data: { taskId: s.b, status: "todo" } });
    const run = await barrier(s, completionFirst ? complete : reopen, completionFirst ? reopen : complete);
    expect(run.rows.find(row => row.id === s.b)!.status).toBe("todo");
    const completion = run.responses[completionFirst ? 0 : 1]; expect([200, 409]).toContain(completion.status());
    expect(run.rows.find(row => row.id === s.a)!.status).toBe(completion.status() === 200 ? "done" : "todo");
  });

  for (const deletionFirst of [false, true]) test(`project DELETE versus public task creation serializes without orphans, deletionFirst=${deletionFirst}`, async ({ request }) => {
    const s = await seed(request);
    const create = () => request.post("/api/v1/tasks", { headers: s.headers, data: { projectId: s.projectId, title: "Concurrent new task" } });
    const remove = () => request.delete(`/api/projects?projectId=${s.projectId}`);
    const run = await barrier(s, deletionFirst ? remove : create, deletionFirst ? create : remove);
    const creation = run.responses[deletionFirst ? 1 : 0], deletion = run.responses[deletionFirst ? 0 : 1]; expect(deletion.status(), await deletion.text()).toBe(200); expect([201, 404]).toContain(creation.status()); expect(run.rows).toEqual([]);
  });

  test("public/native task creates share the exact project barrier and preserve both writes", async ({ request }) => {
    const s = await seed(request);
    const run = await barrier(s, () => request.post("/api/tasks", { data: { projectId: s.projectId, title: "Native after gate" } }), () => request.post("/api/v1/tasks", { headers: s.headers, data: { projectId: s.projectId, title: "Public after gate" } }));
    expect(run.responses.map(r => r.status())).toEqual([200, 201]); expect(run.rows).toHaveLength(4);
  });

  for (const action of ["create", "rename"] as const) test(`actual client ${action} rolls back its mutation when linked organization write fails`, async ({ request }) => {
    const s = await seed(request);
    const existing = await request.post("/api/clients", { data: { name: "Before failure" } }); expect(existing.ok()).toBeTruthy(); const clientId = (await existing.json()).client.id;
    const observer = await pool.connect(); let orgReached = false;
    const snapshot = async () => ({ clients: (await observer.query('select * from "sowledger"."clients" where workspace_id=$1 order by id', [s.owner.workspaceId])).rows, organizations: (await observer.query('select * from "sowledger"."organizations" where workspace_id=$1 order by id', [s.owner.workspaceId])).rows });
    const before = await snapshot();
    const instrumentedDb = { transaction: (body: (tx: any) => Promise<unknown>, config: any) => db.transaction(tx => body(new Proxy(tx, { get(target, property, receiver) {
      if (property === "insert" || property === "update") return (table: unknown) => {
        if (table === organizations) { orgReached = true; throw new Error("Disposable organization-write failure after actual client returning"); }
        return (Reflect.get(target, property) as any).call(target, table);
      };
      const value = Reflect.get(target, property, receiver); return typeof value === "function" ? value.bind(target) : value;
    } })), config) };
    const modules: Record<string, any> = { "@/lib/db": { db: instrumentedDb } };
    function load(id: string): any {
      if (id in modules) return modules[id];
      if (id !== "@/lib/client-mutations" && id !== "@/lib/client-validation") return nativeRequire(id.startsWith("@/") ? `./${id.slice(2)}` : id);
      const mod = { exports: {} }; const source = readFileSync(path.join(process.cwd(), `${id.slice(2)}.ts`), "utf8");
      new Function("require", "module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(load, mod, mod.exports); return modules[id] = mod.exports;
    }
    try {
      const service = load("@/lib/client-mutations");
      await expect(action === "create" ? service.createWorkspaceClient(s.owner.workspaceId, { name: "Rolled back create" }) : service.updateWorkspaceClient(s.owner.workspaceId, { clientId, name: "Rolled back rename" })).rejects.toThrow("Disposable organization-write failure");
      expect(orgReached).toBe(true); expect(await snapshot()).toEqual(before);
      expect(await db.select().from(clients).where(and(eq(clients.workspaceId, s.owner.workspaceId), eq(clients.id, clientId)))).toMatchObject([{ name: "Before failure" }]);
    } finally { observer.release(); }
  });
});

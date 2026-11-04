import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "../lib/db/schema";
import * as workflow from "../lib/workflow-validation";
import * as dateInput from "../lib/date-input";
import { requireApiScope } from "../lib/api-keys";
import { ForbiddenError, UnauthorizedError } from "../lib/auth";
import { taskWrite } from "../lib/task-validation";
import { clientUpdates } from "../lib/client-validation";
import { diagnostics } from "./helpers/error-boundary-fixtures";

type Row = Record<string, unknown>;
type Surface = "native" | "public";
type Resource = "tasks" | "clients";
type Handler = (req: NextRequest, ctx?: { params: Promise<{ resource: string }> }) => Promise<Response>;
const task = (id = "target", extra: Row = {}): Row => ({ id, workspaceId: "workspace", projectId: "project", title: id, status: "todo", position: 0, description: null, dueDate: null, estimatedHours: null, assigneeId: null, parentId: null, blockedByTaskIds: [], attachments: [], ...extra });

// Actual source executes with only auth/schema bootstrap and storage I/O controlled.
// Predicates are compiled by the real Drizzle dialect, then evaluated against rows.
function fixture(surface: Surface, resource: Resource, options: { rows?: Row[]; missingProject?: boolean; vanished?: boolean; failure?: boolean; ioError?: Error; scopes?: string[]; role?: string } = {}) {
  const tables = new Map<unknown, Row[]>([
    [schema.projectTasks, options.rows ?? [task()]],
    [schema.projects, options.missingProject ? [] : [{ id: "project", workspaceId: "workspace" }]],
    [schema.workspacePeople, [{ id: "person", linkedUserId: "user-alias", workspaceId: "workspace" }]],
    [schema.clients, [{ id: "client", workspaceId: "workspace", name: "Before", email: "before@example.com", address: "Before", currencyOverride: "USD", status: "active" }]],
    [schema.organizations, [{ id: "org", workspaceId: "workspace", clientId: "client", name: "Before", type: "client" }]],
  ]);
  const events: string[] = [], predicates: Array<{ table: unknown; query: ReturnType<PgDialect["sqlToQuery"]>; selected?: string[] }> = [], writes: Array<{ table: unknown; values?: Row }> = [], usage: number[] = [];
  function match(row: Row, predicate: SQL) {
    const q = new PgDialect().sqlToQuery(predicate);
    const field = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    let expr = q.sql.replace(/(?:"[^"]+"\.)+"([^"]+)" = \$(\d+)/g, (_, name: string, n: string) => String(row[field(name)] === q.params[Number(n) - 1]));
    expr = expr.replace(/\band\b/gi, "&&").replace(/\bor\b/gi, "||");
    assert.match(expr, /^[()\s&|truefals]+$/, `Unsupported controlled predicate: ${q.sql}`);
    return new Function(`return ${expr}`)();
  }
  const fakeDb = {
    select(fields?: Row) { return { from(table: unknown) { return { where(predicate: SQL) {
      const q = new PgDialect().sqlToQuery(predicate); predicates.push({ table, query: q, selected: fields && Object.keys(fields) }); events.push(`read:${getTableName(table as typeof schema.projects)}`);
      const read = () => { if (options.failure || options.ioError) throw options.ioError ?? new Error("private SQL secret"); return (tables.get(table) ?? []).filter(row => match(row, predicate)).map(row => fields ? Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[(column as { name: string }).name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())]])) : { ...row }); };
      return { then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(read).then(resolve, reject); }, async for(mode: string) { events.push(`lock:${getTableName(table as typeof schema.projects)}:${mode}`); return read(); }, async limit(n: number) { return read().slice(0, n); } };
    } }; } }; },
    insert(table: unknown) { return { values(values: Row) { writes.push({ table, values }); events.push(`insert:${getTableName(table as typeof schema.projects)}`); if (options.failure) throw new Error("private SQL secret"); const row = { ...values }; tables.get(table)!.push(row); return { async returning() { return options.vanished ? [] : [row]; } }; } }; },
    update(table: unknown) { return { set(values: Row) { return { where(predicate: SQL) {
      predicates.push({ table, query: new PgDialect().sqlToQuery(predicate) }); writes.push({ table, values }); events.push(`update:${getTableName(table as typeof schema.projects)}`);
      const rows = (tables.get(table) ?? []).filter(row => match(row, predicate));
      if (!options.vanished) for (const row of rows) Object.assign(row, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)));
      return { then(resolve: (value: unknown) => unknown) { return Promise.resolve().then(() => { if (options.failure || options.ioError) throw options.ioError ?? new Error("private SQL secret"); return []; }).then(resolve); }, async returning() { if (options.failure || options.ioError) throw options.ioError ?? new Error("private SQL secret"); return options.vanished ? [] : rows; } };
    } }; } }; },
    delete(table: unknown) { return { where(predicate: SQL) { predicates.push({ table, query: new PgDialect().sqlToQuery(predicate) }); writes.push({ table }); const rows = tables.get(table)!.filter(row => match(row, predicate)); tables.set(table, tables.get(table)!.filter(row => !match(row, predicate))); return { then(resolve: (value: unknown) => unknown) { return Promise.resolve([]).then(resolve); }, async returning() { return options.vanished ? [] : rows; } }; } }; },
    async transaction<T>(fn: (tx: unknown) => Promise<T>, config: unknown) { events.push(`transaction:${JSON.stringify(config)}`); return fn(fakeDb); },
  };
  const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const deps: Record<string, unknown> = {
    "@/lib/db": { db: fakeDb }, "@/lib/db/schema": schema, "@/lib/workflow-validation": workflow, "@/lib/date-input": dateInput,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "@/lib/auth": { ForbiddenError, UnauthorizedError, requireSession: async () => ({ workspaceId: "workspace", sub: "owner", role: options.role ?? "owner" }), requireRole: (min: string, role: string) => { if (role === "client" || (min === "manager" && role === "member")) throw new ForbiddenError("Forbidden"); } },
    "@/lib/api-keys": { getApiKeyErrorContext: () => null, authenticateApiKey: async () => ({ id: "key", workspaceId: "workspace", createdByUserId: "owner", scopes: options.scopes ?? ["write:tasks", "write:clients"] }), requireApiScope, recordApiKeyRequest: async (_ctx: unknown, _req: unknown, status: number) => { usage.push(status); } },
  };
  function load(id: string): unknown {
    if (id in deps) return deps[id];
    if (id.startsWith("@/")) {
      const file = path.join(process.cwd(), `${id.slice(2)}.ts`);
      if (!existsSync(file)) return {};
      const mod = { exports: {} };
      new Function("require", "module", "exports", transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs" }).code)(load, mod, mod.exports);
      return deps[id] = mod.exports;
    }
    return nativeRequire(id);
  }
  // Unrelated public-resource services are not exercised and cannot perform I/O.
  for (const name of ["export-data", "invoice-proof-pack", "project-creation", "project-history", "schedule-mutations", "revenue-intelligence", "scheduled-block-entry", "scheduled-block-guards", "security", "time-capacity"]) deps[`@/lib/${name}`] = {};
  const mod = { exports: {} as Record<string, Handler> };
  const filename = surface === "public" ? "app/api/v1/[resource]/route.ts" : `app/api/${resource}/route.ts`;
  new Function("require", "module", "exports", transformSync(readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code)(load, mod, mod.exports);
  return { events, predicates, writes, usage, rows: (table = schema.projectTasks as unknown) => tables.get(table)!, async call(body?: unknown, method = "PATCH", raw?: string) {
    const query = method === "DELETE" ? surface === "public" ? "?id=target" : "?taskId=target" : "";
    const req = new NextRequest(`https://fixture.test/api/${resource}${query}`, { method, ...(method === "DELETE" ? {} : { headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }) });
    return mod.exports[method](req, { params: Promise.resolve({ resource }) });
  } };
}

for (const surface of ["native", "public"] as const) {
  test(`${surface} relationship validation reads only graph fields under scoped project lock`, async () => {
    const f = fixture(surface, "tasks", { rows: [task(), task("blocker", { status: "done" })] });
    assert.equal((await f.call({ taskId: "target", status: "review", blockedByTaskIds: ["blocker"] })).status, 200);
    const graph = f.predicates.find(p => p.table === schema.projectTasks && p.query.params.length === 2 && p.query.params.includes("project"));
    assert.ok(graph); assert.deepEqual(graph.selected, ["id", "parentId", "blockedByTaskIds", "status"]); assert.ok(graph.query.params.includes("workspace"));
    assert.ok(f.events.indexOf("lock:projects:update") < f.events.lastIndexOf("read:project_tasks"));
  });
  test(`${surface} task create preserves zero, defaults, canonical dates and full returning record`, async () => {
    const f = fixture(surface, "tasks"); const response = await f.call({ projectId: "project", title: " Work ", estimatedHours: 0, dueDate: "2028-02-29", description: "" }, "POST");
    assert.equal(response.status, surface === "native" ? 200 : 201); const { task: saved } = await response.json();
    assert.equal(saved.estimatedHours, 0); assert.equal(saved.title, "Work"); assert.equal(saved.description, ""); assert.equal(saved.dueDate, "2028-02-29T00:00:00.000Z");
    assert.deepEqual(saved.blockedByTaskIds, surface === "native" ? null : []); assert.deepEqual(saved.attachments, surface === "native" ? null : []); assert.equal(saved.workspaceId, "workspace");
    assert.equal(f.events[0], 'transaction:{"isolationLevel":"read committed"}'); assert.ok(f.events.indexOf("lock:projects:update") < f.events.indexOf("insert:project_tasks"));
  });
  for (const body of [null, [], 1, {}, { taskId: "target" }, { taskId: "target", unknown: 1 }, { taskId: "target", title: " " }, { taskId: "target", title: 5 }, { taskId: "target", status: "closed" }, { taskId: "target", estimatedHours: "0" }, { taskId: "target", estimatedHours: -1 }, { taskId: "target", estimatedHours: 1e40 }, { taskId: "target", estimatedHours: 1e-50 }, { taskId: "target", dueDate: "2027-02-29" }, { taskId: "target", dueDate: false }]) test(`${surface} task PATCH rejects ${JSON.stringify(body)}`, async () => {
    const f = fixture(surface, "tasks"); const response = await f.call(body); assert.equal(response.status, 400); assert.equal(f.writes.length, 0); if (surface === "public") { assert.deepEqual(f.usage, [400]); assert.equal((await response.json()).resource, "tasks"); }
  });
  test(`${surface} task date omission/clears/offsets and nullable zero updates`, async () => {
    const f = fixture(surface, "tasks", { rows: [task("target", { dueDate: new Date("2028-02-29Z"), estimatedHours: 3 })] });
    await f.call({ taskId: "target", title: "New" }); assert.equal((f.rows()[0].dueDate as Date).toISOString(), "2028-02-29T00:00:00.000Z");
    for (const dueDate of [null, "", "  "]) { const response = await f.call({ taskId: "target", dueDate, estimatedHours: 0 }); assert.equal(response.status, 200); assert.equal((await response.json()).task.dueDate, null); assert.equal(f.rows()[0].estimatedHours, 0); }
    const response = await f.call({ taskId: "target", dueDate: "2026-10-31T23:30:00-04:00", estimatedHours: null, assigneeId: " " });
    assert.equal(response.status, 200); assert.equal((await response.json()).task.dueDate, "2026-11-01T03:30:00.000Z"); assert.equal(f.rows()[0].estimatedHours, null); assert.equal(f.rows()[0].assigneeId, null);
  });
  test(`${surface} missing/vanished task and client writes return 404 and safe unexpected errors`, async () => {
    for (const resource of ["tasks", "clients"] as const) {
      const body = resource === "tasks" ? { taskId: "target", title: "New" } : { clientId: "client", name: "New" };
      const f = fixture(surface, resource, { vanished: true }); assert.equal((await f.call(body)).status, 404); if (surface === "public") assert.deepEqual(f.usage, [404]);
      const failing = fixture(surface, resource, { failure: true }); const { value: response, logs } = await diagnostics(() => failing.call(body)); assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /SQL|secret|private/); if (surface === "public") assert.deepEqual(failing.usage, [500]);
      assert.deepEqual(logs, [["sowledger_request_failed", { route: surface === "public" ? "/api/v1/[resource]" : `/api/${resource}`, method: "PATCH", category: "unexpected" }]]);
      const missing = fixture(surface, resource); assert.equal((await missing.call(resource === "tasks" ? { taskId: "absent", title: "New" } : { clientId: "absent", name: "New" })).status, 404);
    }
  });
  test(`${surface} task create validates relationships and assignee aliases`, async () => {
    for (const [fields, rows, status] of [
      [{ parentId: "other" }, [task("other", { projectId: "other-project" })], 400],
      [{ blockedByTaskIds: ["foreign"] }, [task("foreign", { workspaceId: "foreign" })], 404],
      [{ parentId: "absent" }, [], 404],
      [{ assigneeId: "absent" }, [], 404],
      [{ assigneeId: "user-alias", parentId: "other" }, [task("other")], surface === "native" ? 200 : 201],
    ] as Array<[Row, Row[], number]>) { const f = fixture(surface, "tasks", { rows }); const response = await f.call({ projectId: "project", title: "New", ...fields }, "POST"); assert.equal(response.status, status); if (status >= 400) assert.equal(f.writes.length, 0); else assert.equal((await response.json()).task.assigneeId, "user-alias"); }
  });
  test(`${surface} task DELETE refuses all inbound references, including legacy other-project links`, async () => {
    for (const extra of [{ parentId: "target" }, { blockedByTaskIds: ["target"] }, { projectId: "other-project", blockedByTaskIds: ["target"] }]) { const f = fixture(surface, "tasks", { rows: [task(), task("dependent", extra)] }); const response = await f.call(undefined, "DELETE"); assert.equal(response.status, 409); assert.equal(f.rows().length, 2); assert.equal(f.writes.length, 0); assert.doesNotMatch(await response.text(), /dependent|other-project/); }
    const f = fixture(surface, "tasks", { rows: [task(), task("unrelated")] }); const response = await f.call(undefined, "DELETE"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), surface === "native" ? { ok: true, deletedTaskId: "target" } : { ok: true, id: "target" }); assert.deepEqual(f.rows().map(row => row.id), ["unrelated"]);
    assert.equal((await fixture(surface, "tasks", { rows: [] }).call(undefined, "DELETE")).status, 404);
  });
  test(`${surface} completion checks effective blockers only on transitions`, async () => {
    for (const status of ["review", "done"]) {
      const f = fixture(surface, "tasks", { rows: [task("target", { blockedByTaskIds: ["blocker"] }), task("blocker")] }); assert.equal((await f.call({ taskId: "target", status })).status, 409); assert.equal(f.writes.length, 0);
      const create = fixture(surface, "tasks", { rows: [task("blocker")] }); assert.equal((await create.call({ projectId: "project", title: "New", status, blockedByTaskIds: ["blocker"] }, "POST")).status, 409);
    }
    const f = fixture(surface, "tasks", { rows: [task("target", { status: "done", blockedByTaskIds: ["blocker"] }), task("blocker")] });
    assert.equal((await f.call({ taskId: "target", title: "Still done" })).status, 200); assert.equal((await f.call({ taskId: "target", status: "done" })).status, 200); assert.equal((await f.call({ taskId: "target", status: "review" })).status, 409);
    assert.equal((await f.call({ taskId: "blocker", status: "in_progress" })).status, 200); assert.equal(f.rows()[0].status, "done");
    const complete = fixture(surface, "tasks", { rows: [task("target", { blockedByTaskIds: ["blocker"] }), task("blocker", { status: "done" })] }); assert.equal((await complete.call({ taskId: "target", status: "review" })).status, 200);
  });
  for (const body of [null, [], {}, { name: " " }, { name: 5 }, { name: "x".repeat(256) }, { name: "New", email: 7 }, { name: "New", email: "bad" }, { name: "New", address: [] }, { name: "New", currencyOverride: "x".repeat(11) }]) test(`${surface} client POST validates ${JSON.stringify(body)}`, async () => { const f = fixture(surface, "clients"); assert.equal((await f.call(body, "POST")).status, 400); assert.equal(f.writes.length, 0); });
  test(`${surface} client canonical fields, atomic organization create/rename, omission and clearing`, async () => {
    const f = fixture(surface, "clients"); const response = await f.call({ name: " New ", email: " BILLING@EXAMPLE.COM ", address: "", currencyOverride: null, status: "archived" }, "POST"); assert.equal(response.status, surface === "native" ? 200 : 201); const { client } = await response.json(); assert.equal(client.name, "New"); assert.equal(client.email, "billing@example.com"); assert.equal(client.address, ""); assert.equal(f.writes[1].table, schema.organizations); assert.equal(f.writes[1].values?.clientId, client.id); assert.equal(f.writes[1].values?.workspaceId, "workspace");
    const patch = fixture(surface, "clients"); assert.equal((await patch.call({ clientId: "client", name: " Renamed " })).status, 200); assert.equal(patch.rows(schema.clients)[0].email, "before@example.com"); assert.equal(patch.rows(schema.organizations)[0].name, "Renamed");
    for (const email of ["", "  ", null]) { assert.equal((await patch.call({ clientId: "client", email })).status, 200); assert.equal(patch.rows(schema.clients)[0].email, null); }
    for (const fields of [{ email: 3 }, { address: 5 }, { status: "deleted" }, { unknown: 1 }]) { const invalid = fixture(surface, "clients"); assert.equal((await invalid.call({ clientId: "client", ...fields })).status, 400); assert.equal(invalid.writes.length, 0); }
  });
  test(`${surface} malformed task/client JSON is 400, not unsafe adapter failure`, async () => { for (const resource of ["tasks", "clients"] as const) { const f = fixture(surface, resource); const response = await f.call(undefined, "POST", "{"); assert.equal(response.status, 400); assert.equal(f.writes.length, 0); if (surface === "public") assert.deepEqual(f.usage, [400]); } });
}

test("native validates cycles, legacy graphs, relationship clearing and defensive budgets", async () => {
  for (const fields of [{ parentId: "target" }, { blockedByTaskIds: ["target"] }, { parentId: "b" }, { blockedByTaskIds: ["b"] }]) { const f = fixture("native", "tasks", { rows: [task(), task("b", { parentId: "c", blockedByTaskIds: ["c"] }), task("c", { parentId: "target", blockedByTaskIds: ["target"] })] }); assert.equal((await f.call({ taskId: "target", ...fields })).status, 400); assert.equal(f.writes.length, 0); }
  const legacy = fixture("native", "tasks", { rows: [task("target", { parentId: "missing", blockedByTaskIds: ["missing"] })] }); assert.equal((await legacy.call({ taskId: "target", title: "Preserve" })).status, 200); assert.equal((await legacy.call({ taskId: "target", parentId: "missing" })).status, 409); assert.equal((await legacy.call({ taskId: "target", parentId: null, blockedByTaskIds: [] })).status, 200);
  for (const fields of [{ blockedByTaskIds: "bad" }, { blockedByTaskIds: [1] }, { blockedByTaskIds: ["b", "b"] }, { blockedByTaskIds: Array.from({ length: 101 }, (_, i) => `b${i}`) }, { attachments: Array.from({ length: 101 }, () => ({ name: "Link", url: "https://example.com" })) }, ...["javascript:alert(1)", "data:text/html,test", "/relative", "//example.com", "https://user:pass@example.com", `https://example.com/${"x".repeat(2048)}`, "https://example.com/\npath"].map(url => ({ attachments: [{ name: "Link", url }] })), { attachments: [{ name: "", url: "https://example.com" }] }, { attachments: [{ name: "Link", url: "https://example.com", size: -1 }] }, { position: 1e40 }, { position: 1e-50 }]) { const f = fixture("native", "tasks"); assert.equal((await f.call({ taskId: "target", ...fields })).status, 400); assert.equal(f.writes.length, 0); }
  const f = fixture("native", "tasks"); const response = await f.call({ taskId: "target", position: -0.5, attachments: [{ name: " Link ", url: " https://example.com/a ", size: 0, ignored: "not persisted" }] }); assert.equal(response.status, 200); assert.deepEqual((await response.json()).task.attachments, [{ name: "Link", url: "https://example.com/a", size: 0 }]);
});

test("public task PATCH relationships remain unwritable and scope guard records final denial", async () => {
  for (const fields of [{ parentId: "b" }, { blockedByTaskIds: [] }, { attachments: [] }, { position: 0 }]) { const f = fixture("public", "tasks"); assert.equal((await f.call({ taskId: "target", ...fields })).status, 400); assert.equal(f.writes.length, 0); }
  const f = fixture("public", "tasks", { scopes: ["read:tasks"] }); assert.equal((await f.call({ taskId: "target", title: "New" })).status, 403); assert.deepEqual(f.usage, [403]); assert.equal(f.writes.length, 0);
});

test("operational task reads/writes always use workspace; project lock precedes task authority and mutations", async () => {
  const f = fixture("native", "tasks"); assert.equal((await f.call({ taskId: "target", title: "New" })).status, 200);
  assert.equal(f.events[0], 'transaction:{"isolationLevel":"read committed"}'); const lock = f.events.indexOf("lock:projects:update"); assert.ok(lock > 0); assert.ok(f.events.lastIndexOf("read:project_tasks") > lock); assert.ok(f.events.indexOf("update:project_tasks") > lock);
  for (const { table, query } of f.predicates) { assert.ok(query.params.includes("workspace")); if (table === schema.projects || query.sql.includes('"project_tasks"."title"')) assert.ok(query.params.includes("project")); }
});

test("malformed saved blocker data can be explicitly repaired without coercion or a 500", async () => {
  for (const blockedByTaskIds of [{ invalid: true }, "broken", [7], ["missing"]]) {
    const f = fixture("native", "tasks", { rows: [task("target", { status: "done", blockedByTaskIds })] });
    assert.equal((await f.call({ taskId: "target", title: "Unrelated" })).status, 200);
    assert.equal((await f.call({ taskId: "target", status: "review" })).status, 409);
    assert.equal((await f.call({ taskId: "target", blockedByTaskIds: [] })).status, 200);
    assert.deepEqual(f.rows()[0].blockedByTaskIds, []);
  }
});

test("task/client write boundaries do not expose or misclassify unexpected I/O SyntaxError or status-shaped failures", async () => {
  for (const surface of ["native", "public"] as const) for (const resource of ["tasks", "clients"] as const) for (const error of [new SyntaxError("private SQL syntax secret"), Object.assign(new Error("private auth-shaped secret"), { status: 403 }), Object.assign(new Error("private auth-shaped secret"), { statusCode: 401 })]) {
    const f = fixture(surface, resource, { ioError: error }); const { value: response, logs } = await diagnostics(() => f.call(resource === "tasks" ? { taskId: "target", title: "New" } : { clientId: "client", name: "New" }));
    assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private|secret|SQL/); if (surface === "public") assert.deepEqual(f.usage, [500]);
    assert.deepEqual(logs, [["sowledger_request_failed", { route: surface === "public" ? "/api/v1/[resource]" : `/api/${resource}`, method: "PATCH", category: "unexpected" }]]);
  }
});

test("supplied unchanged legacy cycles conflict safely; clearing and valid replacement can repair malformed roots", async () => {
  for (const kind of ["parentId", "blockedByTaskIds"] as const) {
    const edge = (id: string) => kind === "parentId" ? id : [id];
    const oldCycle = fixture("native", "tasks", { rows: [task("target", { [kind]: edge("b") }), task("b", { [kind]: edge("target") })] });
    assert.equal((await oldCycle.call({ taskId: "target", [kind]: edge("b") })).status, 409);
    assert.equal((await oldCycle.call({ taskId: "target", [kind]: kind === "parentId" ? null : [] })).status, 200);
    const reachable = fixture("native", "tasks", { rows: [task(), task("b", { [kind]: edge("c") }), task("c", { [kind]: edge("b") })] });
    assert.equal((await reachable.call({ taskId: "target", [kind]: edge("b") })).status, 409);
    const malformed = fixture("native", "tasks", { rows: [task("target", { [kind]: 42 }), task("valid")] });
    assert.equal((await malformed.call({ taskId: "target", [kind]: edge("missing-new") })).status, 404);
    assert.equal((await malformed.call({ taskId: "target", [kind]: edge("valid") })).status, 200);
  }
});

test("plain objects, real-number precision and accepted bound endpoints use the actual parsers", () => {
  for (const value of [Infinity, -Infinity, NaN, 1e40, 1e-50]) for (const field of ["position", "estimatedHours"]) assert.throws(() => taskWrite({ projectId: "project", title: "Work", [field]: value }, true, "native"), { status: 400 });
  for (const input of [Object.assign(Object.create({ inherited: true }), { title: "Work", projectId: "project" }), new Date()]) assert.throws(() => taskWrite(input, true, "native"), { status: 400 });
  assert.throws(() => clientUpdates(Object.assign(Object.create({ inherited: true }), { name: "Client" }), true), { status: 400 });
  const url = `https://example.com/${"x".repeat(2028)}`; assert.equal(url.length, 2048);
  const values = taskWrite({ projectId: "p".repeat(255), title: "t".repeat(255), description: " ", position: -0.25, estimatedHours: Math.fround(2 ** -149), blockedByTaskIds: Array.from({ length: 100 }, (_, i) => `b${i}`), attachments: Array.from({ length: 100 }, () => ({ name: "n".repeat(255), url, size: Number.MAX_SAFE_INTEGER })) }, true, "public").values;
  assert.equal(values.position, -0.25); assert.equal(values.estimatedHours, 2 ** -149); assert.equal(values.description, " "); assert.equal(values.attachments?.length, 100); assert.equal(values.blockedByTaskIds?.length, 100);
  assert.equal(taskWrite({ taskId: "target", estimatedHours: 1.123456789 }, false, "public").values.estimatedHours, Math.fround(1.123456789));
});

test("both create adapters reject all typed/budget boundaries before writes and retain explicit null/empty arrays", async () => {
  for (const surface of ["native", "public"] as const) {
    for (const fields of [{ projectId: " " }, { projectId: 1 }, { projectId: "p".repeat(256) }, { title: null }, { title: "x".repeat(256) }, { description: {} }, { status: null }, { status: "Todo" }, { position: null }, { position: "0" }, { assigneeId: [] }, { parentId: 1 }, { blockedByTaskIds: [""] }, { blockedByTaskIds: [" b ", "b"] }, { blockedByTaskIds: null, attachments: {} }, { blockedByTaskIds: Array.from({ length: 101 }, (_, i) => `b${i}`) }, { attachments: [{ name: "Link", url: "//example.com" }] }, { attachments: [{ name: "Link", url: "https://example.com", size: "0" }] }, { attachments: [{ name: "Link", url: "https://example.com", size: Number.MAX_SAFE_INTEGER + 1 }] }]) {
      const f = fixture(surface, "tasks"); assert.equal((await f.call({ projectId: "project", title: "Valid", ...fields }, "POST")).status, 400); assert.equal(f.writes.length, 0);
    }
    for (const arrays of [null, []]) { const f = fixture(surface, "tasks"); const response = await f.call({ projectId: "project", title: "Null/empty", blockedByTaskIds: arrays, attachments: arrays }, "POST"); assert.equal(response.status, surface === "native" ? 200 : 201); assert.deepEqual((await response.json()).task.attachments, arrays); }
    for (const resource of ["tasks", "clients"] as const) { const f = fixture(surface, resource, { vanished: true }); assert.equal((await f.call(resource === "tasks" ? { projectId: "project", title: "New" } : { name: "New" }, "POST")).status, 404); }
  }
});

test("completed tasks re-gate only actual blocker changes; all effective relationships are validated together", async () => {
  const f = fixture("native", "tasks", { rows: [task("target", { status: "done" }), task("blocker")] });
  assert.equal((await f.call({ taskId: "target", status: "done", blockedByTaskIds: ["blocker"] })).status, 409); assert.equal(f.writes.length, 0);
  const malformed = fixture("native", "tasks", { rows: [task("target", { blockedByTaskIds: ["missing"] }), task("parent")] });
  assert.equal((await malformed.call({ taskId: "target", parentId: "parent" })).status, 409); assert.equal((await malformed.call({ taskId: "target", parentId: "parent", blockedByTaskIds: [] })).status, 200);
  const reordered = fixture("native", "tasks", { rows: [task("target", { status: "done", blockedByTaskIds: ["a", "b"] }), task("a"), task("b")] });
  assert.equal((await reordered.call({ taskId: "target", blockedByTaskIds: ["b", "a"] })).status, 200);
});

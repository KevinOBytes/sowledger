import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { apiKeys, apiKeyRequests, projectTasks, clients, organizations } from "../lib/db/schema";
import { generateApiKeyMaterial, type ApiScope } from "../lib/api-keys";

type Owner = { workspaceId: string; userId: string; workspace: string };
type Surface = "native" | "public";
type Resource = "tasks" | "clients";
test.beforeAll(() => expect(process.env.SOWLEDGER_TEST_DATABASE, "Root-owned disposable database wrapper required").toBe("true"));
test.setTimeout(90_000);

async function login(request: APIRequestContext, workspace = `task-contract-${crypto.randomUUID()}`, role = "owner"): Promise<Owner> {
  const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, role, plan: "smb", email: `contract-${crypto.randomUUID()}@example.com` })}`);
  expect(response.ok(), await response.text()).toBeTruthy(); return { ...await response.json(), workspace };
}
async function project(request: APIRequestContext) {
  const response = await request.post("/api/projects", { data: { name: `Contract ${crypto.randomUUID()}` } }); expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).project.id as string;
}
async function key(owner: Owner, scopes: ApiScope[] = ["write:tasks", "write:clients", "read:tasks", "read:clients"]) {
  const material = generateApiKeyMaterial(), id = crypto.randomUUID();
  await db.insert(apiKeys).values({ id, workspaceId: owner.workspaceId, createdByUserId: owner.userId, name: "Disposable task/client contract", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes });
  return { id, headers: { authorization: `Bearer ${material.rawKey}` } };
}
function writer(request: APIRequestContext, surface: Surface, headers: Record<string, string>) {
  const route = (resource: Resource) => surface === "public" ? `/api/v1/${resource}` : `/api/${resource}`;
  return {
    post: (resource: Resource, data: unknown) => request.post(route(resource), { data, headers: surface === "public" ? headers : {} }),
    patch: (resource: Resource, data: unknown) => request.patch(route(resource), { data, headers: surface === "public" ? headers : {} }),
    delete: (id: string) => request.delete(`${route("tasks")}?${surface === "public" ? "id" : "taskId"}=${id}`, { headers: surface === "public" ? headers : {} }),
    malformed: (resource: Resource) => request.post(route(resource), { data: Buffer.from("{"), headers: { ...(surface === "public" ? headers : {}), "content-type": "application/json" } }),
  };
}
async function savedTask(owner: Owner, id: string) { return (await db.select().from(projectTasks).where(and(eq(projectTasks.workspaceId, owner.workspaceId), eq(projectTasks.id, id))))[0]; }

for (const surface of ["native", "public"] as const) {
  test(`${surface} task dates/estimates/arrays persist canonical values and omission/clear semantics`, async ({ request }) => {
    const owner = await login(request), projectId = await project(request), apiKey = await key(owner), api = writer(request, surface, apiKey.headers);
    const response = await api.post("tasks", { projectId, title: " Date and zero ", description: "", estimatedHours: 0, dueDate: "2028-02-29" }); expect(response.status(), await response.text()).toBe(surface === "native" ? 200 : 201);
    const { task } = await response.json(); expect(task).toMatchObject({ title: "Date and zero", description: "", dueDate: "2028-02-29T00:00:00.000Z", estimatedHours: 0, workspaceId: owner.workspaceId });
    expect(task.attachments).toEqual(surface === "native" ? null : []); expect(task.blockedByTaskIds).toEqual(surface === "native" ? null : []);
    expect((await savedTask(owner, task.id)).dueDate?.toISOString()).toBe("2028-02-29T00:00:00.000Z"); expect((await savedTask(owner, task.id)).estimatedHours).toBe(0);
    expect((await api.patch("tasks", { taskId: task.id, title: "Omitted date" })).status()).toBe(200); expect((await savedTask(owner, task.id)).dueDate?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    for (const clear of [null, "", "  "]) { expect((await api.patch("tasks", { taskId: task.id, dueDate: clear, estimatedHours: 0 })).status()).toBe(200); expect((await savedTask(owner, task.id)).dueDate).toBeNull(); }
    const offset = await api.patch("tasks", { taskId: task.id, dueDate: "2026-10-31T23:30:00-04:00", estimatedHours: 1.123456789 }); expect(offset.status()).toBe(200);
    const returnedEstimate = (await offset.json()).task.estimatedHours;
    const persisted = await savedTask(owner, task.id);
    for (const estimate of [returnedEstimate, persisted.estimatedHours]) { expect(typeof estimate).toBe("number"); expect(Number.isFinite(estimate)).toBe(true); expect(Math.fround(estimate)).toBe(Math.fround(1.123456789)); }
    expect(returnedEstimate).toBe(persisted.estimatedHours); expect(persisted.dueDate?.toISOString()).toBe("2026-11-01T03:30:00.000Z");
    for (const fields of [{ dueDate: "2027-02-29" }, { estimatedHours: 1e40 }, { estimatedHours: 1e-50 }, { estimatedHours: "0" }, { unknown: true }]) expect((await api.patch("tasks", { taskId: task.id, ...fields })).status()).toBe(400);
    expect((await api.patch("tasks", { taskId: task.id, estimatedHours: null })).status()).toBe(200); expect((await savedTask(owner, task.id)).estimatedHours).toBeNull();
    const explicit = await api.post("tasks", { projectId, title: "Null arrays", attachments: null, blockedByTaskIds: null }); expect(explicit.status()).toBe(surface === "native" ? 200 : 201); expect((await explicit.json()).task).toMatchObject({ attachments: null, blockedByTaskIds: null });
    expect((await api.malformed("tasks")).status()).toBe(400); expect((await api.patch("tasks", { taskId: "missing-task", title: "Absent" })).status()).toBe(404);
  });

  test(`${surface} client validation and organization create/rename are persisted with safe omission/clearing`, async ({ request }) => {
    const owner = await login(request), apiKey = await key(owner), api = writer(request, surface, apiKey.headers);
    const response = await api.post("clients", { name: " Example ", email: " BILLING@EXAMPLE.COM ", address: "123 Main", currencyOverride: "USD", status: "archived" }); expect(response.status(), await response.text()).toBe(surface === "native" ? 200 : 201);
    const { client } = await response.json(); expect(client).toMatchObject({ name: "Example", email: "billing@example.com", status: "active" });
    const orgs = () => db.select().from(organizations).where(and(eq(organizations.workspaceId, owner.workspaceId), eq(organizations.clientId, client.id)));
    expect(await orgs()).toHaveLength(1); expect((await orgs())[0]).toMatchObject({ name: "Example", type: "client" });
    expect((await api.patch("clients", { clientId: client.id, name: " Revised " })).status()).toBe(200); expect((await orgs())[0].name).toBe("Revised");
    const saved = () => db.select().from(clients).where(and(eq(clients.workspaceId, owner.workspaceId), eq(clients.id, client.id)));
    expect((await saved())[0].email).toBe("billing@example.com");
    for (const email of [null, "", "  "]) { expect((await api.patch("clients", { clientId: client.id, email })).status()).toBe(200); expect((await saved())[0].email).toBeNull(); }
    for (const data of [{ name: "No", email: 7 }, { name: "No", email: "invalid" }, { name: "No", address: [] }, { name: "No", currencyOverride: "x".repeat(11) }]) expect((await api.post("clients", data)).status()).toBe(400);
    expect((await api.patch("clients", { clientId: client.id, unknown: true })).status()).toBe(400); expect((await api.patch("clients", { clientId: "absent-client", name: "No" })).status()).toBe(404); expect((await api.malformed("clients")).status()).toBe(400);
    expect((await saved())[0].name).toBe("Revised"); expect((await orgs())[0].name).toBe("Revised");
  });

  test(`${surface} relationship/lifecycle/delete rules persist without cross-project or cascading mutations`, async ({ request }) => {
    const owner = await login(request), projectId = await project(request), otherProject = await project(request), apiKey = await key(owner), api = writer(request, surface, apiKey.headers);
    const make = async (title: string, fields = {}) => { const response = await api.post("tasks", { projectId, title, ...fields }); expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).task as { id: string }; };
    const blocker = await make("Blocker"), dependent = await make("Dependent", { blockedByTaskIds: [blocker.id] });
    expect((await api.patch("tasks", { taskId: dependent.id, status: "review" })).status()).toBe(409); expect((await api.post("tasks", { projectId, title: "Blocked create", status: "done", blockedByTaskIds: [blocker.id] })).status()).toBe(409);
    expect((await api.patch("tasks", { taskId: blocker.id, status: "done" })).status()).toBe(200); expect((await api.patch("tasks", { taskId: dependent.id, status: "review" })).status()).toBe(200);
    expect((await api.patch("tasks", { taskId: blocker.id, status: "todo" })).status()).toBe(200); expect((await savedTask(owner, dependent.id)).status).toBe("review");
    expect((await api.patch("tasks", { taskId: dependent.id, status: "review", title: "Unrelated allowed" })).status()).toBe(200); expect((await api.patch("tasks", { taskId: dependent.id, status: "done" })).status()).toBe(409);
    expect((await api.delete(blocker.id)).status()).toBe(409); expect(await savedTask(owner, blocker.id)).toBeTruthy();
    const foreign = await api.post("tasks", { projectId: otherProject, title: "Other project" }); const foreignId = (await foreign.json()).task.id;
    expect((await api.post("tasks", { projectId, title: "Cross parent", parentId: foreignId })).status()).toBe(400); expect((await api.post("tasks", { projectId, title: "Cross blocker", blockedByTaskIds: [foreignId] })).status()).toBe(400);
    if (surface === "public") for (const fields of [{ parentId: null }, { blockedByTaskIds: [] }, { position: 0 }, { attachments: [] }]) expect((await api.patch("tasks", { taskId: dependent.id, ...fields })).status()).toBe(400);
    // Native PATCH is intentionally required to unlink dependency fields.
    expect((await request.patch("/api/tasks", { data: { taskId: dependent.id, blockedByTaskIds: [] } })).status()).toBe(200); expect((await api.delete(blocker.id)).status()).toBe(200); expect(await savedTask(owner, blocker.id)).toBeUndefined(); expect(await savedTask(owner, dependent.id)).toBeTruthy();
    // Disposable legacy fixture proves workspace-wide inbound refusal without
    // allowing an adopted writer to create that invalid cross-project link.
    await db.update(projectTasks).set({ parentId: dependent.id }).where(and(eq(projectTasks.workspaceId, owner.workspaceId), eq(projectTasks.id, foreignId)));
    expect((await api.delete(dependent.id)).status()).toBe(409); expect((await savedTask(owner, foreignId)).parentId).toBe(dependent.id);
    expect((await request.patch("/api/tasks", { data: { taskId: foreignId, parentId: null } })).status()).toBe(200); expect((await api.delete(dependent.id)).status()).toBe(200);
  });
}

test("native parent/blocker multi-node cycles reject, and explicit clearing repairs legacy graph data", async ({ request }) => {
  const owner = await login(request), projectId = await project(request);
  const make = async (title: string) => (await (await request.post("/api/tasks", { data: { projectId, title } })).json()).task.id as string;
  const a = await make("A"), b = await make("B"), c = await make("C");
  for (const field of ["parentId", "blockedByTaskIds"]) {
    const edge = (id: string) => field === "parentId" ? id : [id];
    expect((await request.patch("/api/tasks", { data: { taskId: b, [field]: edge(c) } })).status()).toBe(200); expect((await request.patch("/api/tasks", { data: { taskId: c, [field]: edge(a) } })).status()).toBe(200); expect((await request.patch("/api/tasks", { data: { taskId: a, [field]: edge(b) } })).status()).toBe(400);
    expect((await request.patch("/api/tasks", { data: { taskId: a, [field]: edge(a) } })).status()).toBe(400);
  }
  await db.update(projectTasks).set({ parentId: "missing-parent", blockedByTaskIds: ["missing-blocker"] }).where(and(eq(projectTasks.workspaceId, owner.workspaceId), eq(projectTasks.id, a)));
  expect((await request.patch("/api/tasks", { data: { taskId: a, title: "Preserve malformed legacy" } })).status()).toBe(200); expect((await request.patch("/api/tasks", { data: { taskId: a, status: "done" } })).status()).toBe(409);
  expect((await request.patch("/api/tasks", { data: { taskId: a, parentId: null, blockedByTaskIds: [] } })).status()).toBe(200); expect(await savedTask(owner, a)).toMatchObject({ parentId: null, blockedByTaskIds: [] });
});

test("current public scopes/revocation/usage, native roles and tenant isolation remain authoritative", async ({ request, playwright, baseURL }) => {
  const owner = await login(request), projectId = await project(request), write = await key(owner), read = await key(owner, ["read:tasks", "read:clients"]);
  const task = (await (await request.post("/api/tasks", { data: { projectId, title: "Private task" } })).json()).task;
  const client = (await (await request.post("/api/clients", { data: { name: "Private client" } })).json()).client;
  for (const [resource, data] of [["tasks", { taskId: task.id, title: "Denied" }], ["clients", { clientId: client.id, name: "Denied" }]] as const) expect((await request.patch(`/api/v1/${resource}`, { headers: read.headers, data })).status()).toBe(403);
  const noCookie = await playwright.request.newContext({ baseURL }); const foreign = await playwright.request.newContext({ baseURL });
  try {
    const anon = await noCookie.post("/api/tasks", { data: { projectId, title: "No" }, maxRedirects: 0 }); expect(anon.status()).toBe(307); expect(new URL(anon.headers().location, anon.url()).href).toBe(`${baseURL}/login`);
    expect((await noCookie.post("/api/tasks", { headers: { cookie: "sowledger_session=invalid" }, data: { projectId, title: "Invalid session" }, maxRedirects: 0 })).status()).toBe(401);
    const other = await login(foreign), foreignKey = await key(other);
    for (const surface of ["native", "public"] as const) {
      const api = writer(foreign, surface, foreignKey.headers);
      expect((await api.patch("tasks", { taskId: task.id, title: "Foreign" })).status()).toBe(404); expect((await api.delete(task.id)).status()).toBe(404); expect((await api.post("tasks", { projectId, title: "Foreign" })).status()).toBe(404); expect((await api.patch("clients", { clientId: client.id, name: "Foreign" })).status()).toBe(404);
    }
    await login(foreign, owner.workspace, "member"); expect((await foreign.patch("/api/clients", { data: { clientId: client.id, name: "Denied" } })).status()).toBe(403);
    await login(foreign, owner.workspace, "client"); expect((await foreign.patch("/api/tasks", { data: { taskId: task.id, title: "Denied" } })).status()).toBe(403);
    const api = writer(request, "public", write.headers); expect((await api.patch("tasks", { taskId: task.id, title: "Allowed" })).status()).toBe(200); expect((await api.patch("tasks", { taskId: task.id, unknown: true })).status()).toBe(400); expect((await api.patch("tasks", { taskId: "absent", title: "No" })).status()).toBe(404);
    const usage = await db.select().from(apiKeyRequests).where(and(eq(apiKeyRequests.workspaceId, owner.workspaceId), eq(apiKeyRequests.apiKeyId, write.id))); expect(usage.map(row => row.status)).toEqual(expect.arrayContaining([200, 400, 404]));
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.workspaceId, owner.workspaceId), eq(apiKeys.id, write.id)));
    expect((await api.patch("tasks", { taskId: task.id, title: "Revoked" })).status()).toBe(401); expect((await savedTask(owner, task.id)).title).toBe("Allowed");
  } finally { await noCookie.dispose(); await foreign.dispose(); }
});

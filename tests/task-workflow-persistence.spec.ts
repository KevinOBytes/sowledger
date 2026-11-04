import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { projectTasks } from "../lib/db/schema";

// Controller-owned actual-app checks. An available server is not authorization.
test.beforeAll(() => expect(process.env.SOWLEDGER_TEST_DATABASE, "Requires the root-owned disposable database wrapper").toBe("true"));
test.setTimeout(120_000);

async function login(request: APIRequestContext, options: { workspace?: string; role?: string } = {}) {
  const suffix = crypto.randomUUID();
  const workspace = options.workspace ?? `task-workflow-${suffix}`;
  const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email: `task-workflow-${suffix}@example.com`, role: options.role ?? "owner", plan: "smb" })}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return { ...await response.json() as { workspaceId: string; userId: string }, workspace };
}
async function createProject(request: APIRequestContext) {
  const response = await request.post("/api/projects", { data: { name: `Task workflow ${crypto.randomUUID()}` } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).project as { id: string };
}
async function apiTasks(request: APIRequestContext, projectId: string) {
  const response = await request.get(`/api/tasks?projectId=${encodeURIComponent(projectId)}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).tasks as Array<{ id: string; projectId: string; title: string; description: string | null; dueDate: string | null; estimatedHours: number | null; status: string; attachments: Array<{ name: string; url: string }> | null }>;
}
async function write(page: Page, action: () => Promise<unknown>, method = "PATCH", beforeSuccess?: (response: Response) => Promise<void>) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/tasks" && response.request().method() === method);
  await action(); const response = await pending;
  expect(response.ok(), await response.text()).toBeTruthy();
  if (beforeSuccess) await beforeSuccess(response);
  await expect(page.getByRole("status").filter({ hasText: method === "POST" ? "Task created" : "Task saved" })).toBeVisible();
  return await response.json();
}

for (const view of ["list", "board"]) for (const width of [390, 1440]) test(`${view} create/edit/date clear/zero/status/attachments/delete persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const state = await login(page.request); const project = await createProject(page.request);
  const originalTitle = `UI work ${crypto.randomUUID()}`; const title = `${originalTitle} revised`;
  const route = `/projects/${project.id}?tab=${view}`;
  await page.goto(route);
  await page.getByRole("button", { name: view === "list" ? "New task" : "Add task to To Do", exact: true }).click();
  await page.getByLabel("New task title", { exact: true }).fill(originalTitle);
  const { task } = await write(page, () => page.getByRole("button", { name: "Add task", exact: true }).click(), "POST");
  expect((await apiTasks(page.request, project.id)).find(row => row.id === task.id)?.title).toBe(originalTitle);
  const row = async () => (await db.select().from(projectTasks).where(and(eq(projectTasks.workspaceId, state.workspaceId), eq(projectTasks.id, task.id))))[0];
  expect((await row()).title).toBe(originalTitle);
  await page.getByRole("button", { name: `Open task: ${originalTitle}`, exact: true }).click();
  if (view === "board") {
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
    await page.getByLabel("Title", { exact: true }).fill(`  ${title}  `);
    await write(page, () => page.getByLabel("Title", { exact: true }).blur());
    await page.getByLabel("Description", { exact: true }).fill("Persisted delivery notes");
    await write(page, () => page.getByLabel("Description", { exact: true }).blur());
    await page.getByLabel("Estimated hours", { exact: true }).fill("0");
    await write(page, () => page.getByLabel("Estimated hours", { exact: true }).blur());
  } else {
    await page.getByLabel("Title", { exact: true }).fill(`  ${title}  `);
    await page.getByLabel("Description", { exact: true }).fill("Persisted delivery notes");
    await page.getByLabel("Estimated hours", { exact: true }).fill("0");
    await write(page, () => page.getByRole("button", { name: "Save task", exact: true }).click());
  }
  expect(await row()).toMatchObject({ title, description: "Persisted delivery notes", estimatedHours: 0 });
  await page.getByLabel("Estimated hours", { exact: true }).fill("1.123456789");
  await write(page, () => view === "board"
    ? page.getByLabel("Estimated hours", { exact: true }).blur()
    : page.getByRole("button", { name: "Save task", exact: true }).click(), "PATCH", async response => {
    expect(response.request().postDataJSON().estimatedHours).toBe(1.123456789);
    const saved = await response.json();
    expect(saved.ok).toBe(true); expect(saved.task.id).toBe(task.id); expect(saved.task.projectId).toBe(project.id); expect(saved.task.estimatedHours).toBe(1.1234568);
    expect((await row()).estimatedHours, "DB float32 estimate immediately after response, before UI confirmation").toBe(1.1234568);
    expect((await apiTasks(page.request, project.id)).find(row => row.id === task.id)?.estimatedHours, "API float32 estimate immediately after response, before UI confirmation").toBe(1.1234568);
  });
  await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("1.1234568");
  await page.reload(); await page.getByRole("button", { name: `Open task: ${title}`, exact: true }).click();
  await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("1.1234568");
  await page.getByLabel("Estimated hours", { exact: true }).fill("0");
  await write(page, () => view === "board"
    ? page.getByLabel("Estimated hours", { exact: true }).blur()
    : page.getByRole("button", { name: "Save task", exact: true }).click());
  expect((await row()).estimatedHours).toBe(0);
  for (const dueDate of ["2026-11-01", ""]) {
    if (view === "board") await write(page, () => page.getByLabel("Due date", { exact: true }).fill(dueDate));
    else { await page.getByLabel("Due date", { exact: true }).fill(dueDate); await write(page, () => page.getByRole("button", { name: "Save task", exact: true }).click()); }
    expect((await row()).dueDate?.toISOString() ?? null).toBe(dueDate ? "2026-11-01T00:00:00.000Z" : null);
    expect((await apiTasks(page.request, project.id)).find(row => row.id === task.id)?.dueDate).toBe(dueDate ? "2026-11-01T00:00:00.000Z" : null);
    await page.reload(); await page.getByRole("button", { name: `Open task: ${title}`, exact: true }).click();
    await expect(page.getByLabel("Due date", { exact: true })).toHaveValue(dueDate);
    await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("0");
  }
  if (view === "board") await write(page, () => page.getByLabel("Status", { exact: true }).selectOption("in_progress"));
  else { await page.getByLabel("Status", { exact: true }).selectOption("in_progress"); await write(page, () => page.getByRole("button", { name: "Save task", exact: true }).click()); }
  expect((await row()).status).toBe("in_progress");
  if (view === "board") { await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: `Open task: ${title}`, exact: true })).toBeFocused(); }
  await page.goto(`/projects/${project.id}?tab=board`);
  await page.getByRole("button", { name: `Open task: ${title}`, exact: true }).click();
  await page.getByLabel("Asset name", { exact: true }).fill("Delivery plan"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/delivery-plan");
  await write(page, () => page.getByRole("button", { name: "Attach Asset", exact: true }).click(), "PATCH", async response => {
    const expected = [{ name: "Delivery plan", url: "https://example.com/delivery-plan" }];
    expect(response.request().postDataJSON()).toEqual({ taskId: task.id, attachments: expected });
    const saved = await response.json();
    expect(saved.ok).toBe(true); expect(saved.task.id).toBe(task.id); expect(saved.task.projectId).toBe(project.id); expect(saved.task.attachments).toEqual(expected);
    expect((await row()).attachments, "DB immediately after HTTP attachment response, before UI confirmation").toEqual(expected);
    expect((await apiTasks(page.request, project.id)).find(row => row.id === task.id)?.attachments, "API immediately after HTTP attachment response, before UI confirmation").toEqual(expected);
  });
  expect((await row()).attachments).toEqual([{ name: "Delivery plan", url: "https://example.com/delivery-plan" }]);
  await page.reload(); await page.getByRole("button", { name: `Open task: ${title}`, exact: true }).click();
  await expect(page.getByRole("link", { name: "https://example.com/delivery-plan", exact: true })).toBeVisible();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("in_progress");
  await write(page, () => page.getByRole("button", { name: "Remove attachment: Delivery plan", exact: true }).click(), "PATCH", async response => {
    expect(response.request().postDataJSON()).toEqual({ taskId: task.id, attachments: [] });
    const saved = await response.json();
    expect(saved.ok).toBe(true); expect(saved.task.id).toBe(task.id); expect(saved.task.projectId).toBe(project.id); expect(saved.task.attachments).toEqual([]);
    expect((await row()).attachments, "DB immediately after attachment removal, before UI confirmation").toEqual([]);
    expect((await apiTasks(page.request, project.id)).find(row => row.id === task.id)?.attachments, "API immediately after attachment removal, before UI confirmation").toEqual([]);
  });
  expect((await row()).attachments).toEqual([]);
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: `Open task: ${title}`, exact: true })).toBeFocused();
  const removed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/tasks" && response.request().method() === "DELETE");
  await page.getByRole("button", { name: `Delete task: ${title}`, exact: true }).click();
  const response = await removed; expect(response.ok(), await response.text()).toBeTruthy(); expect(await response.json()).toMatchObject({ ok: true, deletedTaskId: task.id });
  await expect(page.getByRole("status").filter({ hasText: "Task deleted" })).toBeVisible();
  expect(await row()).toBeUndefined(); expect((await apiTasks(page.request, project.id)).some(row => row.id === task.id)).toBeFalsy();
  await page.reload(); await expect(page.getByRole("button", { name: `Open task: ${title}`, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("native task authorization and foreign project/task IDs stay server-authoritative", async ({ request, playwright, baseURL }) => {
  const state = await login(request); const project = await createProject(request);
  const created = await request.post("/api/tasks", { data: { projectId: project.id, title: "Protected task" } }); expect(created.ok(), await created.text()).toBeTruthy();
  const { task } = await created.json(); const other = await playwright.request.newContext({ baseURL }); const anonymous = await playwright.request.newContext({ baseURL });
  try {
    await login(other);
    expect((await apiTasks(other, project.id))).toEqual([]);
    expect((await other.post("/api/tasks", { data: { projectId: project.id, title: "Foreign create" } })).status()).toBe(404);
    expect((await other.patch("/api/tasks", { data: { taskId: task.id, title: "Foreign edit" } })).status()).toBe(404);
    expect((await other.delete(`/api/tasks?taskId=${task.id}`)).status()).toBe(404);
    const denied = await anonymous.post("/api/tasks", { data: { projectId: project.id, title: "Anonymous" }, maxRedirects: 0 }); expect(denied.status()).toBe(307);
    expect(new URL(denied.headers().location, denied.url()).pathname).toBe("/login");
    await login(other, { workspace: state.workspace, role: "client" });
    expect((await other.post("/api/tasks", { data: { projectId: project.id, title: "Client create" } })).status()).toBe(403);
    expect((await other.patch("/api/tasks", { data: { taskId: task.id, title: "Client edit" } })).status()).toBe(403);
    expect((await other.delete(`/api/tasks?taskId=${task.id}`)).status()).toBe(403);
    expect((await apiTasks(request, project.id)).find(row => row.id === task.id)?.title).toBe("Protected task");
    const [persisted] = await db.select().from(projectTasks).where(and(eq(projectTasks.workspaceId, state.workspaceId), eq(projectTasks.id, task.id)));
    expect(persisted.title).toBe("Protected task");
  } finally { await other.dispose(); await anonymous.dispose(); }
});

import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { draftPatch, readSavedTask } from "../lib/task-client-state";

const root = path.resolve(__dirname, "..");
const origin = "http://task-workflow.test";
let script: string;
let css: string;
const original = { id: "task", workspaceId: "workspace", projectId: "project", parentId: null, title: "Client delivery", description: "Saved notes", status: "todo", position: 1, dueDate: "2026-11-01T00:00:00.000Z" as string | null, assigneeId: "person", estimatedHours: 0, blockedByTaskIds: [] as string[], attachments: [{ name: "Plan", url: "https://example.com/plan", size: 5 }], createdAt: "2026-10-31T00:00:00.000Z" };
type FixtureTask = typeof original;
type Write = { method: string; body: Record<string, unknown> };

test.beforeAll(async () => {
  script = (await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { ProjectTaskList } from "./components/project-task-list";
import { KanbanBoard } from "./components/kanban-board";
window.renderFixture = (projectId = "project") => { const board = new URLSearchParams(location.search).has("board"); window.fixtureRoot ||= createRoot(document.getElementById("root")); window.fixtureRoot.render(<StrictMode><main className="min-w-0 p-4 sm:p-8">{board ? <KanbanBoard projectId={projectId}/> : <ProjectTaskList projectId={projectId}/>}</main></StrictMode>); }; window.renderFixture();` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

async function mount(page: Page, board: boolean, initialMode = "success", initialTasks = [original]) {
  let mode = initialMode;
  let tasks = structuredClone(initialTasks);
  const writes: Write[] = [];
  const errors: string[] = [];
  let reads = 0;
  let peopleReads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (req.method() === "GET") {
      if (url.pathname === "/api/people") {
        peopleReads++;
        const personName = mode === "other-people" ? "Other owner" : "Kevin";
        if (mode === "late-people" && peopleReads === 1) await gate;
        if (mode === "people-http") return route.fulfill({ status: 500, json: { error: "private SQL" } });
        if (mode === "people-malformed") return route.fulfill({ json: { ok: true, people: [{ id: 3 }] } });
        return route.fulfill({ json: { ok: true, people: [{ id: "person", linkedUserId: null, displayName: personName, email: "kevin@example.com", status: "active", organizationId: "org" }] } });
      }
      reads++;
      const snapshot = structuredClone(tasks);
      if (mode === "refresh-update") for (const task of snapshot) { task.dueDate = null; task.description = "Changed elsewhere"; }
      if ((mode === "late-initial" || mode === "late-project") && reads === 1) await gate;
      if (mode === "load-http" || mode === "refresh-http") return route.fulfill({ status: 500, json: { error: "private SQL" } });
      if (mode === "load-network") return route.abort("failed");
      if (mode === "load-malformed") return route.fulfill({ json: { ok: true, tasks: [{ id: "task" }] } });
      if (url.searchParams.get("projectId") === "other") return route.fulfill({ json: { ok: true, tasks: [{ ...original, id: "other-task", projectId: "other", title: "Other project task" }] } });
      return route.fulfill({ json: { ok: true, tasks: snapshot } });
    }
    const body = req.method() === "DELETE" ? { taskId: url.searchParams.get("taskId") } : req.postDataJSON();
    writes.push({ method: req.method(), body });
    if (mode === "pending") await gate;
    if (mode === "http") return route.fulfill({ status: 500, json: { error: "private SQL" } });
    if (mode === "network") return route.abort("failed");
    if (mode === "json") return route.fulfill({ contentType: "application/json", body: "{" });
    if (mode === "malformed") return route.fulfill({ json: { ok: true, task: { id: "task" } } });
    if (req.method() === "DELETE") {
      if (mode === "delete-mismatch") return route.fulfill({ json: { ok: true, deletedTaskId: "wrong" } });
      tasks = tasks.filter(t => t.id !== body.taskId && t.parentId !== body.taskId);
      return route.fulfill({ json: { ok: true, deletedTaskId: body.taskId } });
    }
    const current = tasks.find(t => t.id === body.taskId) ?? original;
    const task = { ...current, ...(req.method() === "POST" ? { id: "created", dueDate: null, assigneeId: null, estimatedHours: null } : {}), ...body } as FixtureTask;
    if (Object.hasOwn(body, "dueDate")) task.dueDate = body.dueDate ? `${body.dueDate}T00:00:00.000Z` : null;
    if (mode === "mismatch-project") task.projectId = "wrong";
    if (mode === "mismatch-id") task.id = "wrong";
    if (mode === "mismatch-value") { if (Object.hasOwn(body, "dueDate")) task.dueDate = "2027-01-01T00:00:00.000Z"; else task.title = "Wrong title"; }
    if (mode === "wrong-attachments") task.attachments = [];
    if (mode === "float32-estimate") task.estimatedHours = 1.1234568;
    if (mode === "wrong-float32-estimate") task.estimatedHours = 1.1234569;
    if (mode === "reordered-attachments") task.attachments = task.attachments.map(attachment => ({ url: attachment.url, ...(attachment.size === undefined ? {} : { size: attachment.size }), name: attachment.name })) as FixtureTask["attachments"];
    if (mode === "reversed-attachments") task.attachments = [...task.attachments].reverse();
    if (mode === "wrong-attachment-name") task.attachments[0] = { ...task.attachments[0], name: "Different name" };
    if (mode === "wrong-attachment-url") task.attachments[0] = { ...task.attachments[0], url: "https://example.com/different" };
    if (mode === "wrong-attachment-size") task.attachments[0] = { ...task.attachments[0], size: 6 };
    if (mode === "missing-attachment-size") task.attachments[0] = { name: task.attachments[0].name, url: task.attachments[0].url } as FixtureTask["attachments"][number];
    if (mode === "extra-attachment-size") task.attachments[1] = { ...task.attachments[1], size: 0 };
    if (mode === "missing-attachment-name") task.attachments[0] = { url: task.attachments[0].url, size: task.attachments[0].size } as FixtureTask["attachments"][number];
    if (mode === "missing-attachment-url") task.attachments[0] = { name: task.attachments[0].name, size: task.attachments[0].size } as FixtureTask["attachments"][number];
    if (mode === "concurrent") { if (!Object.hasOwn(body, "description")) task.description = "Changed elsewhere"; if (!Object.hasOwn(body, "status")) task.status = "in_progress"; }
    tasks = req.method() === "POST" ? [...tasks, task] : tasks.map(t => t.id === task.id ? task : t);
    return route.fulfill({ json: { ok: true, task } });
  });
  await page.goto(`${origin}/fixture${board ? "?board" : ""}`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  return { writes, errors, release, mode: (next: string) => { mode = next; }, reads: () => reads, tasks: () => tasks,
    project: async (id: string) => page.evaluate(id => (window as unknown as { renderFixture: (id: string) => void }).renderFixture(id), id) };
}
async function open(page: Page) { await page.getByRole("button", { name: /Open task: Client delivery/ }).click(); }

test("board task save reflects clean, canonical no-change and independent attachment drafts without no-op requests", async ({ page }) => {
  const f = await mount(page, true); await open(page);
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await page.getByLabel("Title", { exact: true }).fill("  Client delivery  ");
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await page.getByLabel("Title", { exact: true }).press("Tab");
  await page.getByLabel("Asset name", { exact: true }).fill("Separate draft"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/separate");
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Attach Asset", exact: true })).toBeEnabled(); expect(f.writes).toEqual([]);
  f.mode("http"); await page.getByRole("button", { name: "Attach Asset", exact: true }).click(); await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await page.getByLabel("Description", { exact: true }).fill("New task draft"); await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled(); expect(f.errors).toEqual([]);
});
test("board dirty valid/invalid/error/retry/pending state is correctable and tied to the failed task draft", async ({ page }) => {
  const f = await mount(page, true, "http"); await open(page);
  await page.getByLabel("Title", { exact: true }).fill("");
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.getByRole("alert")).toContainText(/title/i); expect(f.writes).toEqual([]);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await page.getByLabel("Title", { exact: true }).fill("Actual failed draft");
  await page.getByRole("button", { name: "Save changes", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.getByRole("alert")).toContainText(/could not confirm/i); await expect(page.getByRole("button", { name: "Retry unsaved changes", exact: true })).toBeEnabled();
  await page.getByLabel("Title", { exact: true }).fill("Different unsaved draft"); await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  f.mode("pending"); await page.getByRole("button", { name: "Save changes", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled(); await expect(page.getByLabel("Title", { exact: true })).toBeDisabled(); expect(f.writes).toHaveLength(2);
  f.release(); await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled(); expect(f.tasks()[0].title).toBe("Different unsaved draft"); expect(f.errors).toEqual([]);
});
test.describe("board explicit save ownership", () => {
  test.use({ hasTouch: true });
  for (const method of ["click", "tap", "Enter", "Space"] as const) test(`${method} saves the complete retained task draft once and owns field blur`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 }); const f = await mount(page, true, "http"); await open(page);
    await page.getByLabel("Description", { exact: true }).fill("Retained unsaved notes"); await page.getByLabel("Description", { exact: true }).blur();
    await expect(page.getByRole("alert")).toContainText(/could not confirm/i); expect(f.writes).toHaveLength(1);
    f.mode("pending"); await page.getByLabel("Title", { exact: true }).fill("Complete explicit draft");
    await page.evaluate(() => {
      (window as unknown as { taskSaveFocus: unknown[] }).taskSaveFocus = [];
      document.addEventListener("focusin", event => {
        const element = event.target;
        if (element instanceof HTMLButtonElement && element.textContent === "Save changes") (window as unknown as { taskSaveFocus: unknown[] }).taskSaveFocus.push({ text: element.textContent, disabled: element.disabled });
      });
    });
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    if (method === "click" || method === "tap") await save[method]();
    else { await save.focus(); await page.keyboard.press(method); }
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled(); await expect.poll(() => f.writes.length).toBe(2);
    expect(f.writes[1].body).toEqual({ taskId: "task", title: "Complete explicit draft", description: "Retained unsaved notes" });
    const focus = await page.evaluate(() => (window as unknown as { taskSaveFocus: unknown[] }).taskSaveFocus);
    expect(focus.length).toBeGreaterThan(0);
    // WebKit may refocus the same enabled target during native pointer defaults;
    // the contract is focus ownership before disabling, not one focus event.
    for (const event of focus) expect(event).toEqual({ text: "Save changes", disabled: false });
    f.release(); await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Complete explicit draft"); await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Retained unsaved notes"); expect(f.errors).toEqual([]);
  });
});

test("failed list save keeps edits when the same task is opened again", async ({ page }) => {
  await mount(page, false, "http"); await page.getByText("Client delivery", { exact: true }).first().click();
  await page.getByLabel("Title", { exact: true }).fill("Retained work");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByText("Client delivery", { exact: true }).first().click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Retained work");
});
test("failed board attachment response never presents the attachment as saved", async ({ page }) => {
  await mount(page, true, "http"); await page.getByText("Client delivery", { exact: true }).first().click();
  await page.getByLabel("Asset name", { exact: true }).fill("Unconfirmed asset");
  await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/unconfirmed");
  await page.getByRole("button", { name: "Attach Asset", exact: true }).click();
  await expect(page.getByRole("link", { name: /example.com\/unconfirmed/ })).toHaveCount(0);
  await expect(page.getByLabel("Asset name", { exact: true })).toHaveValue("Unconfirmed asset");
});
test("list repeated save clicks produce one pending request", async ({ page }) => {
  const f = await mount(page, false, "pending"); await page.getByText("Client delivery", { exact: true }).first().click();
  await page.getByRole("button", { name: "Save task", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => f.writes.length).toBeGreaterThan(0); expect(f.writes).toHaveLength(1);
  f.release();
});

for (const board of [false, true]) {
  const view = board ? "board" : "list";
  for (const mode of ["load-http", "load-network", "load-malformed", "people-http", "people-malformed"]) test(`${view} ${mode} is an actionable failure, not empty success`, async ({ page }) => {
    const f = await mount(page, board, mode);
    await expect(page.getByRole("alert")).toContainText(/could not load/i);
    await expect(page.getByText("No tasks yet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /New task|Add task to/ }).first()).toBeDisabled();
    f.mode("success"); await page.getByRole("button", { name: "Retry loading tasks" }).click();
    await expect(page.getByRole("button", { name: /Open task: Client delivery/ })).toBeVisible();
    expect(f.errors).toEqual([]);
  });
  test(`${view} displays zero and retains failed clear/zero drafts on reopen`, async ({ page }) => {
    const f = await mount(page, board, "http"); await page.getByText("Client delivery", { exact: true }).first().click();
    await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("0");
    await page.getByLabel("Due date", { exact: true }).fill("");
    if (!board) await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
    await page.getByRole("button", { name: board ? "Close task details" : "Collapse task" }).first().click(); await open(page);
    await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("");
    expect(f.writes[0].body.dueDate).toBeNull();
    f.mode("success"); await page.getByRole("button", { name: board ? "Retry unsaved changes" : "Save task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
    expect(f.errors).toEqual([]);
  });
  for (const mode of ["http", "network", "json", "malformed", "mismatch-project", "mismatch-id", "mismatch-value"]) test(`${view} ${mode} never confirms an invalid saved response`, async ({ page }) => {
    const f = await mount(page, board, mode); await open(page);
    await page.getByLabel("Due date", { exact: true }).fill("2026-12-01");
    if (!board) await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
    await expect(page.getByRole("alert")).not.toContainText("private SQL");
    await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("2026-12-01");
    await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toHaveCount(0);
    expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]);
  });
  test(`${view} pending guard prevents repeated writes, editor switches and close`, async ({ page }) => {
    const f = await mount(page, board, "pending"); await open(page);
    if (board) await page.getByLabel("Due date", { exact: true }).fill("");
    else await page.getByRole("button", { name: "Save task", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => f.writes.length).toBe(1);
    await expect(page.getByLabel("Due date", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: board ? "Close task details" : "Collapse task" }).first()).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(page.getByLabel("Due date", { exact: true })).toBeVisible();
    f.release(); await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
    expect(f.errors).toEqual([]);
  });
  test(`${view} StrictMode abandoned read cannot replace a settled mutation`, async ({ page }) => {
    const f = await mount(page, board, "late-initial"); await open(page);
    await page.getByLabel("Due date", { exact: true }).fill("");
    if (!board) await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
    f.release(); await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("");
  });
  test(`${view} late project reads and mutations cannot enter the new project`, async ({ page }) => {
    const f = await mount(page, board, "pending"); await open(page);
    await page.getByLabel("Due date", { exact: true }).fill(""); if (!board) await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect.poll(() => f.writes.length).toBe(1); await f.project("other");
    await expect(page.getByRole("button", { name: /Open task: Other project task/ })).toBeVisible();
    f.release(); await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /Open task: Client delivery/ })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
  test(`${view} refresh failure preserves known tasks and owner without enabling writes`, async ({ page }) => {
    const f = await mount(page, board); await expect(page.getByRole("button", { name: /Open task: Client delivery/ })).toBeVisible();
    f.mode("refresh-http"); await page.getByRole("button", { name: "Refresh tasks" }).click();
    await expect(page.getByRole("alert")).toContainText(/previously loaded/i);
    await expect(page.getByText("Kevin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete task: Client delivery/ })).toBeDisabled();
  });
  test(`${view} failed and unconfirmed creates retain title/assignee and guard duplicate Enter`, async ({ page }) => {
    const f = await mount(page, board, "pending");
    await page.getByRole("button", { name: board ? "Add task to To Do" : "New task", exact: true }).click();
    await page.getByLabel("New task title", { exact: true }).fill("New work");
    await page.getByLabel("New task assignee", { exact: true }).selectOption("person");
    await page.getByLabel("New task title", { exact: true }).evaluate(input => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await expect.poll(() => f.writes.length).toBe(1);
    await expect(page.getByLabel("New task title", { exact: true })).toHaveValue("New work");
    await expect(page.getByRole("button", { name: /Open task: New work/ })).toHaveCount(0);
    f.mode("malformed"); f.release(); await expect(page.getByRole("alert")).toContainText(/check existing tasks before retrying/i);
    await expect(page.getByLabel("New task title", { exact: true })).toHaveValue("New work");
    await expect(page.getByLabel("New task assignee", { exact: true })).toHaveValue("person");
    f.mode("success"); await page.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(page.getByRole("button", { name: /Open task: New work/ })).toBeVisible();
  });
  test(`${view} delete requires exact acknowledgement and never opens detail`, async ({ page }) => {
    const f = await mount(page, board, "delete-mismatch");
    await page.getByRole("button", { name: "Delete task: Client delivery", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
    await expect(page.getByLabel("Due date", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open task: Client delivery/ })).toBeVisible();
    f.mode("success"); await page.getByRole("button", { name: "Delete task: Client delivery", exact: true }).click();
    await expect(page.getByRole("button", { name: /Open task: Client delivery/ })).toHaveCount(0);
  });
}

test("board keyboard modal traps focus, preserves independent drafts and validates attachment links", async ({ page }) => {
  const f = await mount(page, true, "http", [{ ...original, attachments: [...original.attachments, { name: "Unsafe", url: "javascript:alert(1)", size: 1 }] }]);
  const opener = page.getByRole("button", { name: "Open task: Client delivery", exact: true });
  await opener.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Task details: Client delivery" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await expect(page.getByRole("link", { name: /javascript:/ })).toHaveCount(0);
  await expect(page.getByText(/unavailable link/i)).toBeVisible();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved independent notes"); await page.getByLabel("Description", { exact: true }).blur();
  await expect(page.getByRole("alert")).toBeVisible(); f.mode("concurrent");
  await page.getByLabel("Due date", { exact: true }).fill("");
  await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved independent notes");
  f.mode("http"); await page.getByLabel("Asset name", { exact: true }).fill("Draft asset"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/new");
  await page.getByRole("button", { name: "Attach Asset", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByLabel("Asset name", { exact: true })).toHaveValue("Draft asset");
  await expect(page.getByRole("link", { name: "https://example.com/new", exact: true })).toHaveCount(0);
  f.mode("success"); await page.getByRole("button", { name: "Attach Asset", exact: true }).click();
  await expect(page.getByRole("link", { name: "https://example.com/new", exact: true })).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved independent notes");
  await page.getByRole("button", { name: "Close task details", exact: true }).last().focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close task details", exact: true }).first()).toBeFocused();
  await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
});

for (const board of [false, true]) for (const width of [320, 390, 1440]) test(`${board ? "board" : "list"} controls and modal fit ${width}px without document overflow`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 }); await mount(page, board); await open(page);
  await expect(page.getByLabel("Due date", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  if (board) {
    const bounds = await page.getByRole("dialog").boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "Close task details" }).last()).toBeInViewport();
  }
});

for (const board of [false, true]) {
  const view = board ? "board" : "list";
  test(`${view} late task and people reads stay inert after changing project`, async ({ page }) => {
    for (const mode of ["late-project", "late-people"]) {
      const f = await mount(page, board, mode); await expect(page.getByRole("button", { name: "Open task: Client delivery", exact: true })).toBeVisible();
      f.mode("other-people"); await f.project("other");
      await expect(page.getByRole("button", { name: "Open task: Other project task", exact: true })).toBeVisible();
      await expect(page.getByText("Other owner", { exact: true })).toBeVisible();
      f.release(); await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: "Open task: Client delivery", exact: true })).toHaveCount(0);
      await expect(page.getByText("Other owner", { exact: true })).toBeVisible();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
  test(`${view} zero and blank estimates save distinctly and invalid estimates never write`, async ({ page }) => {
    const f = await mount(page, board); await open(page);
    for (const value of ["", "0"]) {
      await page.getByLabel("Estimated hours", { exact: true }).fill(value);
      if (board) await page.getByLabel("Estimated hours", { exact: true }).blur();
      else await page.getByRole("button", { name: "Save task", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
      expect(f.writes.at(-1)!.body.estimatedHours).toBe(value === "" ? null : 0);
      await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue(value);
    }
    const count = f.writes.length;
    await page.getByLabel("Estimated hours", { exact: true }).fill("-1");
    if (board) { await page.getByLabel("Estimated hours", { exact: true }).blur(); await expect(page.getByRole("alert")).toContainText(/nonnegative/i); }
    else await page.getByRole("button", { name: "Save task", exact: true }).click();
    expect(f.writes).toHaveLength(count);
  });
  test(`${view} successful canonical trim is adopted and title constraints block invalid writes`, async ({ page }) => {
    const f = await mount(page, board); await open(page);
    await page.getByLabel("Title", { exact: true }).fill("  Canonical title  ");
    if (board) await page.getByLabel("Title", { exact: true }).blur(); else await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Canonical title");
    await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute("maxlength", "255");
    const count = f.writes.length; await page.getByLabel("Title", { exact: true }).fill("   ");
    if (board) { await page.getByLabel("Title", { exact: true }).blur(); await expect(page.getByRole("alert")).toContainText(/title/i); }
    else await expect(page.getByRole("button", { name: "Save task", exact: true })).toBeDisabled();
    expect(f.writes).toHaveLength(count);
  });
  test(`${view} status select warns about current-view incomplete blockers without sending`, async ({ page }) => {
    const f = await mount(page, board, "success", [{ ...original, blockedByTaskIds: ["blocker"] }, { ...original, id: "blocker", title: "Prerequisite" }]); await open(page);
    await page.getByLabel("Status", { exact: true }).selectOption("review");
    if (!board) await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Finish the incomplete blockers shown here before moving this task to Review or Done.");
    expect(f.writes).toHaveLength(0);
    await page.getByLabel("Status", { exact: true }).selectOption("in_progress");
    if (!board) await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible(); expect(f.writes.at(-1)!.body.status).toBe("in_progress");
  });
  test(`${view} empty successful load gives a next action`, async ({ page }) => {
    await mount(page, board, "success", []);
    await expect(page.getByRole("button", { name: board ? "Add task to To Do" : "New task", exact: true })).toBeEnabled();
    await expect(page.getByText(board ? "Use + to add a task." : "No tasks yet", { exact: true }).first()).toBeVisible();
  });
}

test("board unchanged blur makes no write or false success; clean unsubmitted server changes are adopted", async ({ page }) => {
  const f = await mount(page, true, "concurrent"); await open(page);
  await page.getByLabel("Description", { exact: true }).focus(); await page.getByLabel("Description", { exact: true }).blur();
  expect(f.writes).toHaveLength(0); await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toHaveCount(0);
  await page.getByLabel("Due date", { exact: true }).fill(""); await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Changed elsewhere"); await expect(page.getByLabel("Status", { exact: true })).toHaveValue("in_progress");
});
test("board failed attachment removal preserves metadata and independent notes", async ({ page }) => {
  const f = await mount(page, true, "http"); await open(page);
  await page.getByLabel("Description", { exact: true }).fill("Keep unsaved notes"); await page.getByLabel("Description", { exact: true }).blur(); await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Remove attachment: Plan", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.com/plan", exact: true })).toBeVisible();
  expect(f.tasks()[0].attachments[0].size).toBe(5);
  f.mode("success"); await page.getByRole("button", { name: "Remove attachment: Plan", exact: true }).click();
  await expect(page.getByRole("link", { name: "https://example.com/plan", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep unsaved notes");
});
test("board drag stays truthful on failure and is not required for status changes", async ({ page }) => {
  const f = await mount(page, true, "http"); const card = page.getByRole("article").first(); const progress = page.getByRole("region", { name: "In Progress", exact: true });
  const data = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent("dragstart", { dataTransfer: data }); await progress.dispatchEvent("drop", { dataTransfer: data });
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("region", { name: "To Do", exact: true }).getByRole("button", { name: "Open task: Client delivery", exact: true })).toBeVisible();
  f.mode("success"); await open(page); await page.getByLabel("Status", { exact: true }).selectOption("in_progress");
  await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible(); await page.keyboard.press("Escape");
  await expect(progress.getByRole("button", { name: "Open task: Client delivery", exact: true })).toBeFocused();
});

for (const board of [false, true]) for (const mode of ["http", "network", "json", "malformed", "mismatch-project", "mismatch-value"]) test(`${board ? "board" : "list"} unconfirmed ${mode} create preserves entered work`, async ({ page }) => {
  const f = await mount(page, board, mode);
  await page.getByRole("button", { name: board ? "Add task to To Do" : "New task", exact: true }).click();
  await page.getByLabel("New task title", { exact: true }).fill("Retained creation"); await page.getByLabel("New task assignee", { exact: true }).selectOption("person");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/check existing tasks before retrying/i);
  await expect(page.getByLabel("New task title", { exact: true })).toHaveValue("Retained creation"); await expect(page.getByLabel("New task assignee", { exact: true })).toHaveValue("person");
  await expect(page.getByRole("button", { name: "Open task: Retained creation", exact: true })).toHaveCount(0);
  expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]);
});
for (const mode of ["network", "json", "malformed", "mismatch-project", "mismatch-id", "wrong-attachments"]) test(`board unconfirmed ${mode} attachment response preserves inputs and saved list`, async ({ page }) => {
  const f = await mount(page, true, mode); await open(page);
  await page.getByLabel("Asset name", { exact: true }).fill("Retained attachment"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/retained");
  await page.getByRole("button", { name: "Attach Asset", exact: true }).click(); await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
  await expect(page.getByLabel("Asset name", { exact: true })).toHaveValue("Retained attachment"); await expect(page.getByRole("link", { name: "https://example.com/retained", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "https://example.com/plan", exact: true })).toBeVisible(); expect(f.errors).toEqual([]);
});
test("board attachment Enter guard blocks duplicates and pending modal close", async ({ page }) => {
  const f = await mount(page, true, "pending"); await open(page);
  await page.getByLabel("Asset name", { exact: true }).fill("Pending attachment"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/pending");
  await page.getByLabel("Public URL", { exact: true }).evaluate(input => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await expect.poll(() => f.writes.length).toBe(1); await expect(page.getByLabel("Asset name", { exact: true })).toBeDisabled(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeVisible();
  f.release(); await expect(page.getByRole("link", { name: "https://example.com/pending", exact: true })).toBeVisible(); expect(f.writes).toHaveLength(1);
});

for (const board of [false, true]) test(`${board ? "board" : "list"} refresh adopts clean fields without erasing retained drafts`, async ({ page }) => {
  const f = await mount(page, board, "http"); await open(page);
  await page.getByLabel("Description", { exact: true }).fill("Retained draft notes");
  if (board) { await page.getByLabel("Description", { exact: true }).blur(); await expect(page.getByRole("alert")).toBeVisible(); }
  await page.getByRole("button", { name: board ? "Close task details" : "Collapse task", exact: true }).first().click();
  f.mode("refresh-update"); await page.getByRole("button", { name: "Refresh tasks", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh tasks", exact: true })).toBeEnabled(); await open(page);
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Retained draft notes");
  await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("");
});

for (const board of [false, true]) test(`${board ? "board" : "list"} nonfinite estimate is not silently saved as a blank clear`, async ({ page }) => {
  const f = await mount(page, board); await open(page);
  await page.getByLabel("Estimated hours", { exact: true }).fill("");
  await page.getByLabel("Estimated hours", { exact: true }).pressSequentially("1e9999");
  if (board) await page.getByLabel("Estimated hours", { exact: true }).blur(); else await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/nonnegative/i); expect(f.writes).toHaveLength(0);
  await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("1e9999");
});
test("board keyboard delete never opens the task and modal body scroll keeps header and footer reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 650 }); const f = await mount(page, true); await open(page);
  await page.getByRole("button", { name: "Attach Asset", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Close task details", exact: true }).first()).toBeInViewport();
  await expect(page.getByRole("button", { name: "Close task details", exact: true }).last()).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete task: Client delivery", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Task deleted" })).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(f.writes).toHaveLength(1);
});

test("board accepts semantically identical reordered attachment objects and preserves optional size", async ({ page }) => {
  const f = await mount(page, true, "reordered-attachments"); await open(page);
  await page.getByLabel("Asset name", { exact: true }).fill("Reordered asset"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/reordered");
  await page.getByRole("button", { name: "Attach Asset", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "https://example.com/reordered", exact: true })).toBeVisible();
  await expect(page.getByLabel("Asset name", { exact: true })).toHaveValue("");
  expect(f.writes[0].body.attachments).toEqual([{ name: "Plan", url: "https://example.com/plan", size: 5 }, { name: "Reordered asset", url: "https://example.com/reordered" }]);
  expect(f.tasks()[0].attachments).toEqual([{ url: "https://example.com/plan", size: 5, name: "Plan" }, { url: "https://example.com/reordered", name: "Reordered asset" }]);
  expect(f.errors).toEqual([]);
});

for (const mode of ["reversed-attachments", "wrong-attachment-name", "wrong-attachment-url", "wrong-attachment-size", "missing-attachment-size", "extra-attachment-size", "missing-attachment-name", "missing-attachment-url"]) test(`board rejects semantic attachment mismatch: ${mode}`, async ({ page }) => {
  const f = await mount(page, true, mode); await open(page);
  await page.getByLabel("Asset name", { exact: true }).fill("Unconfirmed semantic asset"); await page.getByLabel("Public URL", { exact: true }).fill("https://example.com/semantic");
  await page.getByRole("button", { name: "Attach Asset", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
  await expect(page.getByRole("link", { name: "https://example.com/semantic", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "https://example.com/plan", exact: true })).toBeVisible();
  await expect(page.getByLabel("Asset name", { exact: true })).toHaveValue("Unconfirmed semantic asset");
  expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]);
});

for (const board of [false, true]) test(`${board ? "board" : "list"} accepts float32 estimate roundtrip and adopts the actual canonical value`, async ({ page }) => {
  const f = await mount(page, board, "float32-estimate"); await open(page);
  await page.getByLabel("Estimated hours", { exact: true }).fill("1.123456789");
  if (board) await page.getByLabel("Estimated hours", { exact: true }).blur(); else await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("1.1234568");
  expect(f.writes[0].body.estimatedHours).toBe(1.123456789);
  await page.getByRole("button", { name: board ? "Close task details" : "Collapse task", exact: true }).first().click(); await open(page);
  await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("1.1234568");
});
for (const board of [false, true]) test(`${board ? "board" : "list"} rejects a different representable estimate and retains entered precision`, async ({ page }) => {
  const f = await mount(page, board, "wrong-float32-estimate"); await open(page);
  await page.getByLabel("Estimated hours", { exact: true }).fill("1.123456789");
  if (board) await page.getByLabel("Estimated hours", { exact: true }).blur(); else await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
  await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue("1.123456789"); expect(f.writes).toHaveLength(1);
});
for (const board of [false, true]) for (const value of ["1e39", "1e-50"]) test(`${board ? "board" : "list"} rejects float32-unrepresentable estimate ${value} before writing`, async ({ page }) => {
  const f = await mount(page, board); await open(page); await page.getByLabel("Estimated hours", { exact: true }).fill(value);
  if (board) await page.getByLabel("Estimated hours", { exact: true }).blur(); else await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/estimate/i); await expect(page.getByLabel("Estimated hours", { exact: true })).toHaveValue(value); expect(f.writes).toHaveLength(0);
});
test("estimate helper preserves null/zero distinction and rejects unsafe float32 responses", () => {
  const saved = (estimatedHours: number | null) => ({ ok: true, task: { ...original, estimatedHours } });
  expect(readSavedTask(saved(0), "project", "task", { estimatedHours: 0 }).estimatedHours).toBe(0);
  expect(readSavedTask(saved(null), "project", "task", { estimatedHours: null }).estimatedHours).toBeNull();
  expect(() => readSavedTask(saved(null), "project", "task", { estimatedHours: 0 })).toThrow();
  expect(() => readSavedTask(saved(0), "project", "task", { estimatedHours: null })).toThrow();
  for (const value of [1e39, 1e-50]) {
    expect(() => readSavedTask(saved(value), "project", "task", { estimatedHours: value })).toThrow();
    expect(() => draftPatch({ title: "Task", description: "", status: "todo", assigneeId: "", dueDate: "", estimatedHours: String(value) })).toThrow();
  }
});

const discardCases = [
  { field: "Title", draft: "I intend to discard this title", saved: "Client delivery" },
  { field: "Description", draft: "I intend to discard these notes", saved: "Saved notes" },
  { field: "Estimated hours", draft: "3.25", saved: "0" },
];
test.describe("board deliberate discard", () => {
  test.use({ hasTouch: true });
  for (const method of ["click", "tap"] as const) for (const entry of discardCases) test(`${method} discards focused dirty ${entry.field} without a blur save`, async ({ page }) => {
    const f = await mount(page, true); await open(page);
    await page.getByLabel(entry.field, { exact: true }).fill(entry.draft);
    await page.getByRole("button", { name: "Cancel / discard changes", exact: true })[method]();
    await page.waitForLoadState("networkidle");
    expect(f.writes).toHaveLength(0);
    await expect(page.getByLabel(entry.field, { exact: true })).toHaveValue(entry.saved);
    await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toHaveCount(0);
    await page.keyboard.press("Escape"); await open(page);
    await expect(page.getByLabel(entry.field, { exact: true })).toHaveValue(entry.saved);
    expect(f.errors).toEqual([]);
  });
  for (const key of ["Enter", "Space"]) for (const entry of discardCases) test(`${key} on discard after direct focus from dirty ${entry.field} does not save`, async ({ page }) => {
    const f = await mount(page, true); await open(page);
    await page.getByLabel(entry.field, { exact: true }).fill(entry.draft);
    // Direct control navigation (e.g. assistive technology) causes real focusout before activation.
    const discard = page.getByRole("button", { name: "Cancel / discard changes", exact: true });
    await discard.focus(); await page.keyboard.press(key);
    await page.waitForLoadState("networkidle");
    expect(f.writes).toHaveLength(0); await expect(page.getByLabel(entry.field, { exact: true })).toHaveValue(entry.saved);
    expect(f.errors).toEqual([]);
  });
});
test("board ordinary Tab blur still saves and disables pending discard", async ({ page }) => {
  const f = await mount(page, true, "pending"); await open(page);
  await page.getByLabel("Description", { exact: true }).fill("Ordinary blur should save");
  await page.keyboard.press("Tab"); await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].body.description).toBe("Ordinary blur should save");
  const discard = page.getByRole("button", { name: "Cancel / discard changes", exact: true });
  await expect(discard).toBeDisabled(); const bounds = await discard.boundingBox();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeVisible();
  f.release(); await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Ordinary blur should save"); expect(f.writes).toHaveLength(1);
});
test("board canceled discard pointer does not poison the next ordinary blur", async ({ page, browserName }) => {
  const f = await mount(page, true); await open(page); await page.getByLabel("Description", { exact: true }).fill("Save after canceled pointer");
  const discard = page.getByRole("button", { name: "Cancel / discard changes", exact: true }); const bounds = await discard.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2); await page.mouse.down();
  await page.mouse.move(bounds!.x - 15, bounds!.y - 15); await page.mouse.up();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Save after canceled pointer");
  await page.getByLabel("Title", { exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task saved" })).toBeVisible();
  expect(f.writes).toHaveLength(1); expect(f.writes[0].body.description).toBe("Save after canceled pointer");
  if (browserName === "chromium") {
    // Chromium exposes real touch-drag injection; WebKit is covered by native tap and mouse cancellation above.
    await page.getByLabel("Description", { exact: true }).fill("Save after canceled touch");
    const touchBounds = await discard.boundingBox();
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchBounds!.x + touchBounds!.width / 2, y: touchBounds!.y + touchBounds!.height / 2 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchBounds!.x - 20, y: touchBounds!.y - 20 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Save after canceled touch");
    await page.getByLabel("Description", { exact: true }).focus(); await page.getByLabel("Title", { exact: true }).click();
    await expect.poll(() => f.writes.length).toBe(2);
    expect(f.writes[1].body.description).toBe("Save after canceled touch");
    await session.detach();
  }
});

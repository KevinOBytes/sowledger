import type { ProjectTask } from "@/lib/store";

export type TaskRecord = Omit<ProjectTask, "dueDate" | "createdAt"> & { dueDate: string | null; createdAt: string };
export type TaskPerson = { id: string; linkedUserId?: string | null; displayName?: string | null; email?: string | null; status?: "active" | "archived" };
export type TaskDraft = { title: string; description: string; status: ProjectTask["status"]; assigneeId: string; dueDate: string; estimatedHours: string };
export type TaskPatch = Partial<Pick<TaskRecord, "title" | "description" | "status" | "assigneeId" | "estimatedHours" | "attachments">> & { dueDate?: string | null };
export const TASK_STATUSES = [{ value: "todo", label: "To Do" }, { value: "in_progress", label: "In Progress" }, { value: "review", label: "Review" }, { value: "done", label: "Done" }] as const;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nullableText(value: unknown) { return value === null || typeof value === "string"; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function storableEstimate(value: unknown): value is number {
  if (!finite(value) || value < 0) return false;
  const stored = Math.fround(value);
  return Number.isFinite(stored) && (value === 0 || stored !== 0);
}
function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const day = value.slice(0, 10); const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}
export function isTask(value: unknown, projectId: string): value is TaskRecord {
  if (!object(value)) return false;
  return text(value.id) && text(value.workspaceId) && value.projectId === projectId && nullableText(value.parentId)
    && typeof value.title === "string" && !!value.title.trim() && value.title.length <= 255 && nullableText(value.description)
    && TASK_STATUSES.some(status => status.value === value.status) && finite(value.position)
    && (value.dueDate === null || date(value.dueDate)) && nullableText(value.assigneeId)
    && (value.estimatedHours === null || storableEstimate(value.estimatedHours))
    && (value.blockedByTaskIds === null || (Array.isArray(value.blockedByTaskIds) && value.blockedByTaskIds.every(text)))
    && (value.attachments === null || (Array.isArray(value.attachments) && value.attachments.every(a => object(a) && typeof a.name === "string" && typeof a.url === "string" && (a.size === undefined || (finite(a.size) && a.size >= 0)))))
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}
export function readTasks(data: unknown, projectId: string): TaskRecord[] {
  if (!object(data) || data.ok !== true || !Array.isArray(data.tasks) || !data.tasks.every(task => isTask(task, projectId)) || new Set(data.tasks.map(task => task.id)).size !== data.tasks.length) throw new Error("Invalid tasks");
  return data.tasks;
}
export function readPeople(data: unknown): TaskPerson[] {
  if (!object(data) || data.ok !== true || !Array.isArray(data.people) || !data.people.every(p => object(p) && text(p.id) && ["linkedUserId", "displayName", "email"].every(key => p[key] === undefined || nullableText(p[key])) && (p.status === undefined || p.status === "active" || p.status === "archived"))) throw new Error("Invalid people");
  return data.people;
}
export function taskDraft(task: TaskRecord): TaskDraft {
  return { title: task.title, description: task.description ?? "", status: task.status, assigneeId: task.assigneeId ?? "", dueDate: task.dueDate?.slice(0, 10) ?? "", estimatedHours: task.estimatedHours === null ? "" : String(task.estimatedHours) };
}
export function draftPatch(draft: TaskDraft): TaskPatch {
  const title = draft.title.trim();
  if (!title || title.length > 255) throw new Error("Enter a task title of 1–255 characters.");
  const estimate = draft.estimatedHours.trim() === "" ? null : Number(draft.estimatedHours);
  if (estimate !== null && !storableEstimate(estimate)) throw new Error("Enter a nonnegative estimate in the supported numeric range, or leave it blank.");
  if (draft.dueDate && !date(draft.dueDate)) throw new Error("Choose a valid due date.");
  return { title, description: draft.description.trim() || null, status: draft.status, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null, estimatedHours: estimate };
}
function sameAttachments(actual: TaskRecord["attachments"], submitted: TaskPatch["attachments"]) {
  if (actual === null || submitted === null) return actual === submitted;
  if (!Array.isArray(actual) || !Array.isArray(submitted) || actual.length !== submitted.length) return false;
  // JSONB may reorder object keys. Attachment order and each semantic value still matter.
  return actual.every((attachment, index) => attachment.name === submitted[index].name
    && attachment.url === submitted[index].url && attachment.size === submitted[index].size);
}
function sameEstimate(actual: TaskRecord["estimatedHours"], submitted: TaskPatch["estimatedHours"]) {
  if (actual === null || submitted === null) return actual === submitted;
  // PostgreSQL real returns a decimal representation of the stored float32 value.
  return storableEstimate(actual) && storableEstimate(submitted) && Math.fround(actual) === Math.fround(submitted);
}
export function readSavedTask(data: unknown, projectId: string, taskId: string | null, submitted: TaskPatch): TaskRecord {
  if (!object(data) || data.ok !== true || !isTask(data.task, projectId) || (taskId !== null && data.task.id !== taskId)) throw new Error("Unconfirmed task");
  const task = data.task;
  for (const key of Object.keys(submitted) as Array<keyof TaskPatch>) {
    const actual = key === "dueDate" ? task.dueDate?.slice(0, 10) ?? null : task[key];
    const matches = key === "attachments" ? sameAttachments(task.attachments, submitted.attachments)
      : key === "estimatedHours" ? sameEstimate(task.estimatedHours, submitted.estimatedHours) : actual === submitted[key];
    if (!matches) throw new Error("Unconfirmed values");
  }
  return task;
}
export function readDeletedTask(data: unknown, id: string) { if (!object(data) || data.ok !== true || data.deletedTaskId !== id) throw new Error("Unconfirmed delete"); }
export function mergeTaskDraft(draft: TaskDraft, before: TaskRecord, saved: TaskRecord, submitted: TaskPatch): TaskDraft {
  const old = taskDraft(before); const next = taskDraft(saved); const merged = { ...draft };
  for (const key of Object.keys(next) as Array<keyof TaskDraft>) if (Object.hasOwn(submitted, key) || draft[key] === old[key]) Object.assign(merged, { [key]: next[key] });
  return merged;
}
export function unsavedPatch(draft: TaskDraft, saved: TaskRecord): TaskPatch {
  const patch = draftPatch(draft); const old = draftPatch(taskDraft(saved));
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== old[key as keyof TaskPatch])) as TaskPatch;
}
export function hasIncompleteBlocker(task: TaskRecord, tasks: TaskRecord[]) { return task.blockedByTaskIds?.some(id => tasks.some(blocker => blocker.id === id && blocker.status !== "done")) ?? false; }
export function personLabel(person: TaskPerson) { return person.displayName || person.email || "Unnamed person"; }
export function assigneeLabel(id: string | null, people: TaskPerson[]) { if (!id) return "Unassigned"; const p = people.find(p => p.id === id || p.linkedUserId === id); return p ? personLabel(p) : "Assigned person unavailable"; }
export function safeAttachmentUrl(value: string) { try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password; } catch { return false; } }

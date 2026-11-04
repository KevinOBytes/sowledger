import type { projectTasks } from "@/lib/db/schema";
import { parseDueDate } from "@/lib/date-input";
import { WorkflowError } from "@/lib/workflow-validation";

export type TaskSurface = "native" | "public";
export type TaskValues = Partial<typeof projectTasks.$inferInsert>;
const statuses = new Set(["todo", "in_progress", "review", "done"]);

export function taskIdFrom(value: unknown, field = "taskId") {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 255) throw new WorkflowError(`${field} must be a nonempty string of at most 255 characters.`, 400);
  return value.trim();
}

function nullableId(value: unknown, field: string) {
  return value === null || (typeof value === "string" && !value.trim()) ? null : taskIdFrom(value, field);
}

function realNumber(value: unknown, field: string, nonnegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)) || (value !== 0 && Math.fround(value) === 0) || (nonnegative && value < 0)) {
    throw new WorkflowError(`${field} must be a finite${nonnegative ? " nonnegative" : ""} number supported by saved task precision.`, 400);
  }
  return Math.fround(value);
}

function blockers(value: unknown) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 100) throw new WorkflowError("Use at most 100 different blocker task IDs, or null to clear them.", 400);
  const ids = value.map(id => taskIdFrom(id, "Blocker task ID"));
  if (new Set(ids).size !== ids.length) throw new WorkflowError("Blocker task IDs must be different.", 400);
  return ids;
}

function attachments(value: unknown) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 100) throw new WorkflowError("Use at most 100 attachment links, or null to clear them.", 400);
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new WorkflowError("Each attachment must contain a name and an HTTP or HTTPS URL.", 400);
    const { name, url, size } = raw as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 255) throw new WorkflowError("Attachment names must be nonempty strings of at most 255 characters.", 400);
    if (typeof url !== "string" || /[\u0000-\u001f\u007f]/.test(url) || url.trim().length > 2048) throw new WorkflowError("Attachment URLs must be HTTP or HTTPS links of at most 2048 characters, without credentials or control characters.", 400);
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { throw new WorkflowError("Use an absolute HTTP or HTTPS attachment URL.", 400); }
    if (!/^https?:\/\//i.test(url.trim()) || !["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new WorkflowError("Use an absolute HTTP or HTTPS attachment URL without credentials.", 400);
    if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) throw new WorkflowError("Attachment size must be a nonnegative safe integer.", 400);
    return { name: name.trim(), url: url.trim(), ...(size !== undefined ? { size: size as number } : {}) };
  });
}

/** Explicit allowlists preserve the deliberately narrower public PATCH API. */
export function taskWrite(raw: unknown, creating: boolean, surface: TaskSurface) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new WorkflowError("Send a task object with the fields to save.", 400);
  const body = raw as Record<string, unknown>;
  const taskId = creating ? undefined : taskIdFrom(body.taskId);
  const projectId = creating ? taskIdFrom(body.projectId, "projectId") : undefined;
  const values: TaskValues = {};
  const has = (field: string) => Object.hasOwn(body, field);
  if (creating || has("title")) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 255) throw new WorkflowError("Task title must be a nonempty string of at most 255 characters.", 400);
    values.title = body.title.trim();
  }
  if (has("description")) {
    if (body.description !== null && typeof body.description !== "string") throw new WorkflowError("Task description must be a string or null.", 400);
    values.description = body.description;
  } else if (creating) values.description = null;
  if (has("status")) {
    if (typeof body.status !== "string" || !statuses.has(body.status)) throw new WorkflowError("Task status must be todo, in_progress, review, or done.", 400);
    values.status = body.status as typeof projectTasks.$inferInsert.status;
  } else if (creating) values.status = "todo";
  if (has("dueDate")) values.dueDate = parseDueDate(body.dueDate);
  else if (creating) values.dueDate = null;
  if (has("assigneeId")) values.assigneeId = nullableId(body.assigneeId, "assigneeId");
  else if (creating) values.assigneeId = null;
  if (has("estimatedHours")) values.estimatedHours = body.estimatedHours === null ? null : realNumber(body.estimatedHours, "Estimated hours", true);
  else if (creating) values.estimatedHours = null;
  if (creating || surface === "native") {
    if (has("position")) values.position = realNumber(body.position, "Position");
    else if (creating) values.position = Date.now();
    if (has("parentId")) values.parentId = nullableId(body.parentId, "parentId");
    else if (creating) values.parentId = null;
    if (has("blockedByTaskIds")) values.blockedByTaskIds = blockers(body.blockedByTaskIds);
    else if (creating) values.blockedByTaskIds = surface === "native" ? null : [];
    if (has("attachments")) values.attachments = attachments(body.attachments);
    else if (creating) values.attachments = surface === "native" ? null : [];
  }
  if (!Object.keys(values).length) throw new WorkflowError("Include a writable task field to update.", 400);
  return { taskId, projectId, values };
}

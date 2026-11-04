import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectTasks, projects, workspacePeople } from "@/lib/db/schema";
import { taskIdFrom, taskWrite, type TaskSurface, type TaskValues } from "@/lib/task-validation";
import { WorkflowError } from "@/lib/workflow-validation";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Task = typeof projectTasks.$inferSelect;
type GraphTask = Pick<Task, "id" | "parentId" | "blockedByTaskIds" | "status">;
const legacyConflict = () => new WorkflowError("This task has invalid saved relationships. Remove or reassign those relationships before continuing.", 409);
const validSavedId = (id: unknown): id is string => typeof id === "string" && !!id.trim() && id === id.trim() && id.length <= 255;

function edges(row: GraphTask, kind: "parentId" | "blockedByTaskIds"): string[] {
  const value: unknown = row[kind];
  if (value === null) return [];
  if (kind === "parentId") { if (!validSavedId(value)) throw legacyConflict(); return [value]; }
  if (!Array.isArray(value) || value.some(id => !validSavedId(id)) || new Set(value).size !== value.length) throw legacyConflict();
  return value;
}

async function lockProject(tx: Transaction, workspaceId: string, projectId: string) {
  const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId))).for("update");
  if (!project) throw new WorkflowError("Project not found", 404);
}

async function assignee(tx: Transaction, workspaceId: string, id: string | null | undefined) {
  if (!id) return;
  const [person] = await tx.select({ id: workspacePeople.id }).from(workspacePeople).where(and(eq(workspacePeople.workspaceId, workspaceId), or(eq(workspacePeople.id, id), eq(workspacePeople.linkedUserId, id))));
  if (!person) throw new WorkflowError("Assigned person not found", 404);
}

/** Iterative DFS is linear in the reachable same-project graph, with no recursive stack or second project lock. */
function acyclic(rows: Map<string, GraphTask>, root: GraphTask, kind: "parentId" | "blockedByTaskIds", introduced: boolean) {
  const visited = new Set<string>(), active = new Set<string>();
  const stack: Array<{ id: string; exiting: boolean }> = [{ id: root.id, exiting: false }];
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.exiting) { active.delete(frame.id); visited.add(frame.id); continue; }
    if (active.has(frame.id)) {
      if (frame.id === root.id && introduced) throw new WorkflowError("Task relationships cannot create a cycle. Remove or reassign the relationship.", 400);
      throw legacyConflict();
    }
    if (visited.has(frame.id)) continue;
    const row = rows.get(frame.id);
    if (!row) throw legacyConflict();
    active.add(frame.id); stack.push({ id: frame.id, exiting: true });
    for (const id of edges(row, kind)) stack.push({ id, exiting: false });
  }
}

function sameBlockers(left: unknown, right: unknown) {
  const a = left === null ? [] : left, b = right === null ? [] : right;
  if (!Array.isArray(a) || !Array.isArray(b) || a.some(id => !validSavedId(id)) || b.some(id => !validSavedId(id))) return false;
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

async function validateRelationships(tx: Transaction, workspaceId: string, projectId: string, current: Task | undefined, next: GraphTask, values: TaskValues) {
  const relationsSupplied = Object.hasOwn(values, "parentId") || Object.hasOwn(values, "blockedByTaskIds");
  const completed = next.status === "review" || next.status === "done";
  // Null and [] both mean no effective blockers; reordering is not a lifecycle change.
  const blockerChange = Object.hasOwn(values, "blockedByTaskIds") && (!current || !sameBlockers(current.blockedByTaskIds, next.blockedByTaskIds));
  const gate = completed && (!current || next.status !== current.status || blockerChange);
  if (!relationsSupplied && !gate) return;
  const projectRows = await tx.select({ id: projectTasks.id, parentId: projectTasks.parentId, blockedByTaskIds: projectTasks.blockedByTaskIds, status: projectTasks.status }).from(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.projectId, projectId)));
  const rows = new Map<string, GraphTask>(projectRows.map(row => [row.id, row])); rows.set(next.id, next);
  if (relationsSupplied) {
    for (const kind of ["parentId", "blockedByTaskIds"] as const) {
      const introduced = !current || (kind === "parentId" ? current.parentId !== next.parentId : !sameBlockers(current.blockedByTaskIds, next.blockedByTaskIds));
      for (const id of edges(next, kind)) {
        if (id === next.id) { if (!introduced) throw legacyConflict(); throw new WorkflowError("A task cannot be its own parent or blocker.", 400); }
        if (rows.has(id)) continue;
        // A supplied new missing/foreign reference has input semantics. Saved
        // malformed references fail closed, even when resent unchanged.
        const wasSaved = current && (kind === "parentId" ? current.parentId === id : Array.isArray(current.blockedByTaskIds) && current.blockedByTaskIds.includes(id));
        if (!Object.hasOwn(values, kind) || wasSaved) throw legacyConflict();
        const [foreignProject] = await tx.select({ id: projectTasks.id }).from(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.id, id)));
        if (foreignProject) throw new WorkflowError("Task relationships must stay in the same project.", 400);
        throw new WorkflowError("Referenced task not found", 404);
      }
      acyclic(rows, next, kind, introduced);
    }
  }
  if (gate) for (const id of edges(next, "blockedByTaskIds")) {
    const blocker = rows.get(id);
    if (!blocker || id === next.id) throw legacyConflict();
    if (blocker.status !== "done") throw new WorkflowError("Complete all blocker tasks before moving this task to Review or Done.", 409);
  }
}

export async function createWorkspaceTask(workspaceId: string, raw: unknown, surface: TaskSurface) {
  const { projectId, values } = taskWrite(raw, true, surface);
  return db.transaction(async tx => {
    await lockProject(tx, workspaceId, projectId!);
    const id = crypto.randomUUID();
    await assignee(tx, workspaceId, values.assigneeId);
    await validateRelationships(tx, workspaceId, projectId!, undefined, { id, parentId: values.parentId ?? null, blockedByTaskIds: values.blockedByTaskIds ?? null, status: values.status! }, values);
    const [task] = await tx.insert(projectTasks).values({ ...values, id, workspaceId, projectId: projectId!, title: values.title!, position: values.position! }).returning();
    if (!task) throw new WorkflowError("Task not found", 404);
    return task;
  }, { isolationLevel: "read committed" });
}

async function lockedTarget(tx: Transaction, workspaceId: string, taskId: string) {
  // This nonlocking lookup discovers only the immutable project ID. Nothing
  // else read before the project lock is used as mutation authority.
  const [locator] = await tx.select({ projectId: projectTasks.projectId }).from(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.id, taskId)));
  if (!locator) throw new WorkflowError("Task not found", 404);
  await lockProject(tx, workspaceId, locator.projectId);
  const [current] = await tx.select().from(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.projectId, locator.projectId), eq(projectTasks.id, taskId)));
  if (!current) throw new WorkflowError("Task not found", 404);
  return current;
}

export async function updateWorkspaceTask(workspaceId: string, raw: unknown, surface: TaskSurface) {
  const { taskId, values } = taskWrite(raw, false, surface);
  return db.transaction(async tx => {
    const current = await lockedTarget(tx, workspaceId, taskId!);
    await assignee(tx, workspaceId, values.assigneeId);
    await validateRelationships(tx, workspaceId, current.projectId, current, { ...current, ...values } as Task, values);
    const [task] = await tx.update(projectTasks).set(values).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.projectId, current.projectId), eq(projectTasks.id, taskId!))).returning();
    if (!task) throw new WorkflowError("Task not found", 404);
    return task;
  }, { isolationLevel: "read committed" });
}

export async function deleteWorkspaceTask(workspaceId: string, rawId: unknown) {
  const taskId = taskIdFrom(rawId);
  return db.transaction(async tx => {
    const current = await lockedTarget(tx, workspaceId, taskId);
    // Read-only workspace-wide detection also protects inbound legacy links
    // from other projects without acquiring a second project lock.
    const inbound = await tx.select({ id: projectTasks.id, parentId: projectTasks.parentId, blockedByTaskIds: projectTasks.blockedByTaskIds }).from(projectTasks).where(eq(projectTasks.workspaceId, workspaceId));
    if (inbound.some(row => row.id !== taskId && (row.parentId === taskId || (Array.isArray(row.blockedByTaskIds) && row.blockedByTaskIds.includes(taskId))))) {
      throw new WorkflowError("Remove or reassign subtasks and task dependencies before deleting this task.", 409);
    }
    const [deleted] = await tx.delete(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.projectId, current.projectId), eq(projectTasks.id, taskId))).returning();
    if (!deleted) throw new WorkflowError("Task not found", 404);
    return deleted.id;
  }, { isolationLevel: "read committed" });
}

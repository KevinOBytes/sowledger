import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNotNull, lt, or } from "drizzle-orm";

import { authenticateApiKey, requireApiScope, recordApiKeyRequest, type ApiKeyContext, type ApiScope } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import {
  clients,
  goals,
  invoices,
  memberships,
  projectTasks,
  projects,
  scheduledWorkBlocks,
  timeEntries,
  workspacePeople,
  workspaceTags,
} from "@/lib/db/schema";
import { createExportResponse, loadExportData } from "@/lib/export-data";
import { createTimeEntry } from "@/lib/security";
import { normalizeTags } from "@/lib/validators";

type Resource = "clients" | "projects" | "tags" | "tasks" | "schedule" | "time-entries" | "analytics" | "invoices" | "export";
type Ctx = { params: Promise<{ resource: string }> };
type KanbanColumn = "todo" | "in_progress" | "review" | "done";

const READ_SCOPES: Record<Resource, ApiScope> = {
  clients: "read:clients",
  projects: "read:projects",
  tags: "read:tags",
  tasks: "read:tasks",
  schedule: "read:schedule",
  "time-entries": "read:time",
  analytics: "read:analytics",
  invoices: "read:invoices",
  export: "export:data",
};

const WRITE_SCOPES: Partial<Record<Resource, ApiScope>> = {
  clients: "write:clients",
  projects: "write:projects",
  tags: "write:tags",
  tasks: "write:tasks",
  schedule: "write:schedule",
  "time-entries": "write:time",
};

function normalizeResource(raw: string): Resource | null {
  return (["clients", "projects", "tags", "tasks", "schedule", "time-entries", "analytics", "invoices", "export"] as Resource[]).includes(raw as Resource) ? raw as Resource : null;
}

function statusFrom(error: unknown) {
  const err = error as { status?: number; statusCode?: number };
  return err.status ?? err.statusCode ?? 500;
}

function endExclusive(value: string) {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date.setDate(date.getDate() + 1);
  return date;
}

async function guarded(req: NextRequest, resource: Resource, scope: ApiScope, handler: (context: ApiKeyContext) => Promise<Response>) {
  let context: ApiKeyContext | null = null;
  let status = 200;
  try {
    await ensureWorkspaceSchema();
    context = await authenticateApiKey(req);
    requireApiScope(context, scope);
    const response = await handler(context);
    status = response.status;
    return response;
  } catch (error) {
    status = statusFrom(error);
    context = context ?? (error as { apiKeyContext?: ApiKeyContext }).apiKeyContext ?? null;
    return NextResponse.json({ error: (error as Error).message, resource }, { status });
  } finally {
    await recordApiKeyRequest(context, req, status).catch(() => null);
  }
}

function projectConditions(workspaceId: string, req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  return projectId ? and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)) : eq(projects.workspaceId, workspaceId);
}

function entryConditions(workspaceId: string, req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filters = [eq(timeEntries.workspaceId, workspaceId)];
  const projectId = searchParams.get("projectId");
  const userId = searchParams.get("userId");
  const status = searchParams.get("status");
  const source = searchParams.get("source");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (projectId) filters.push(eq(timeEntries.projectId, projectId));
  if (userId) filters.push(eq(timeEntries.userId, userId));
  if (status && ["draft", "submitted", "approved", "invoiced"].includes(status)) filters.push(eq(timeEntries.status, status as "draft" | "submitted" | "approved" | "invoiced"));
  if (source === "scheduled") filters.push(isNotNull(timeEntries.scheduledBlockId));
  else if (source === "timer") filters.push(eq(timeEntries.source, "web"));
  else if (source && ["web", "calendar", "manual"].includes(source)) filters.push(eq(timeEntries.source, source as "web" | "calendar" | "manual"));
  if (start) filters.push(gte(timeEntries.startedAt, new Date(start)));
  if (end) filters.push(lt(timeEntries.startedAt, endExclusive(end)));
  return and(...filters);
}

async function assertWorkspaceMember(workspaceId: string, userId: string) {
  const [membership] = await db.select().from(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  if (!membership) throw new Error("userId is not a workspace member");
}

async function assertWorkspaceClient(workspaceId: string, clientId?: string | null) {
  if (!clientId) return;
  const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)));
  if (!client) throw new Error("clientId is not in this workspace");
}

async function assertWorkspaceProject(workspaceId: string, projectId?: string | null) {
  if (!projectId) return;
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
  if (!project) throw new Error("projectId is not in this workspace");
}

async function assertWorkspaceGoal(workspaceId: string, goalId?: string | null) {
  if (!goalId) return;
  const [goal] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.workspaceId, workspaceId), eq(goals.id, goalId)));
  if (!goal) throw new Error("goalId is not in this workspace");
}

async function assertWorkspaceScheduleBlock(workspaceId: string, scheduledBlockId?: string | null) {
  if (!scheduledBlockId) return;
  const [block] = await db.select({ id: scheduledWorkBlocks.id }).from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, workspaceId), eq(scheduledWorkBlocks.id, scheduledBlockId)));
  if (!block) throw new Error("scheduledBlockId is not in this workspace");
}

async function assertWorkspacePerson(workspaceId: string, assigneeId?: string | null) {
  if (!assigneeId) return;
  const [person] = await db
    .select({ id: workspacePeople.id })
    .from(workspacePeople)
    .where(and(eq(workspacePeople.workspaceId, workspaceId), or(eq(workspacePeople.id, assigneeId), eq(workspacePeople.linkedUserId, assigneeId))));
  if (!person) throw new Error("assigneeId is not in this workspace");
}

async function analytics(workspaceId: string, req: NextRequest) {
  const entries = await db.select().from(timeEntries).where(entryConditions(workspaceId, req));
  const scheduled = await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.workspaceId, workspaceId));

  const totalSeconds = entries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const manualSeconds = entries.filter((entry) => entry.source === "manual").reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const timerSeconds = entries.filter((entry) => entry.source === "web").reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const billableAmount = entries.reduce((sum, entry) => sum + ((entry.durationSeconds ?? 0) / 3600) * (entry.hourlyRate ?? 0), 0);
  const plannedSeconds = scheduled.reduce((sum, block) => sum + Math.max(0, (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000), 0);
  const missedBlocks = scheduled.filter((block) => block.status === "planned" && new Date(block.endsAt).getTime() < Date.now()).length;

  const byProject = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.projectId) continue;
    byProject.set(entry.projectId, (byProject.get(entry.projectId) ?? 0) + (entry.durationSeconds ?? 0));
  }

  return {
    totalHours: totalSeconds / 3600,
    manualHours: manualSeconds / 3600,
    timerHours: timerSeconds / 3600,
    plannedHours: plannedSeconds / 3600,
    billableAmount,
    utilization: plannedSeconds > 0 ? totalSeconds / plannedSeconds : null,
    missedBlocks,
    projectDistribution: [...byProject.entries()].map(([projectId, seconds]) => ({ projectId, hours: seconds / 3600 })),
  };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource) return NextResponse.json({ error: "Unknown API resource" }, { status: 404 });

  return guarded(req, resource, READ_SCOPES[resource], async (context) => {
    if (resource === "clients") {
      const rows = await db.select().from(clients).where(eq(clients.workspaceId, context.workspaceId));
      return NextResponse.json({ ok: true, clients: rows });
    }
    if (resource === "projects") {
      const rows = await db.select().from(projects).where(projectConditions(context.workspaceId, req));
      return NextResponse.json({ ok: true, projects: rows });
    }
    if (resource === "tags") {
      const rows = await db.select().from(workspaceTags).where(eq(workspaceTags.workspaceId, context.workspaceId));
      return NextResponse.json({ ok: true, tags: rows });
    }
    if (resource === "tasks") {
      const projectId = req.nextUrl.searchParams.get("projectId");
      const condition = projectId ? and(eq(projectTasks.workspaceId, context.workspaceId), eq(projectTasks.projectId, projectId)) : eq(projectTasks.workspaceId, context.workspaceId);
      const rows = await db.select().from(projectTasks).where(condition);
      return NextResponse.json({ ok: true, tasks: rows });
    }
    if (resource === "schedule") {
      const rows = await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.workspaceId, context.workspaceId)).orderBy(desc(scheduledWorkBlocks.startsAt));
      return NextResponse.json({ ok: true, blocks: rows });
    }
    if (resource === "time-entries") {
      const rows = await db.select().from(timeEntries).where(entryConditions(context.workspaceId, req)).orderBy(desc(timeEntries.startedAt)).limit(500);
      return NextResponse.json({ ok: true, entries: rows });
    }
    if (resource === "analytics") {
      return NextResponse.json({ ok: true, analytics: await analytics(context.workspaceId, req) });
    }
    if (resource === "invoices") {
      const rows = await db.select().from(invoices).where(eq(invoices.workspaceId, context.workspaceId)).orderBy(desc(invoices.createdAt));
      return NextResponse.json({ ok: true, invoices: rows });
    }

    const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
    const data = await loadExportData(context.workspaceId, Object.fromEntries(req.nextUrl.searchParams.entries()));
    return createExportResponse(data, format, `billabled-${context.workspaceId}-${new Date().toISOString().slice(0, 10)}`);
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource || !WRITE_SCOPES[resource]) return NextResponse.json({ error: "Resource is not writable" }, { status: 405 });

  return guarded(req, resource, WRITE_SCOPES[resource], async (context) => {
    const body = await req.json();
    if (resource === "clients") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
      const [client] = await db.insert(clients).values({ id: crypto.randomUUID(), workspaceId: context.workspaceId, name, email: body.email, address: body.address, currencyOverride: body.currencyOverride }).returning();
      return NextResponse.json({ ok: true, client }, { status: 201 });
    }
    if (resource === "projects") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
      await assertWorkspaceClient(context.workspaceId, body.clientId);
      const [project] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: context.workspaceId, name, clientId: body.clientId || null, description: body.description || null, color: body.color || "#3b82f6", billingModel: body.billingModel ?? "hourly", hourlyRate: body.hourlyRate ?? null, budgetType: body.budgetType ?? "none", budgetAmount: body.budgetAmount ?? null }).returning();
      return NextResponse.json({ ok: true, project }, { status: 201 });
    }
    if (resource === "tags") {
      const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
      await assertWorkspaceProject(context.workspaceId, body.projectId);
      const [tag] = await db.insert(workspaceTags).values({ id: crypto.randomUUID(), workspaceId: context.workspaceId, name, color: body.color || "#3b82f6", projectId: body.projectId || null, isBillableDefault: body.isBillableDefault ?? true }).returning();
      return NextResponse.json({ ok: true, tag }, { status: 201 });
    }
    if (resource === "tasks") {
      if (!body.projectId || !body.title) return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
      await assertWorkspaceProject(context.workspaceId, body.projectId);
      await assertWorkspacePerson(context.workspaceId, body.assigneeId);
      const [task] = await db.insert(projectTasks).values({ id: crypto.randomUUID(), workspaceId: context.workspaceId, projectId: body.projectId, title: body.title, status: body.status ?? "todo", position: body.position ?? Date.now(), description: body.description || null, parentId: body.parentId || null, dueDate: body.dueDate ? new Date(body.dueDate) : null, assigneeId: body.assigneeId || null, estimatedHours: body.estimatedHours ?? null, blockedByTaskIds: body.blockedByTaskIds ?? [], attachments: body.attachments ?? [] }).returning();
      return NextResponse.json({ ok: true, task }, { status: 201 });
    }
    if (resource === "schedule") {
      if (!body.userId || !body.title || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "userId, title, startsAt, and endsAt are required" }, { status: 400 });
      await assertWorkspaceMember(context.workspaceId, body.userId);
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(body.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return NextResponse.json({ error: "Invalid schedule window" }, { status: 400 });
      await assertWorkspaceProject(context.workspaceId, body.projectId);
      const [block] = await db.insert(scheduledWorkBlocks).values({ id: crypto.randomUUID(), workspaceId: context.workspaceId, userId: body.userId, projectId: body.projectId || null, taskId: body.taskId || null, actionId: body.actionId || null, title: body.title, notes: body.notes || null, tags: normalizeTags(body.tags), startsAt, endsAt, createdByUserId: body.userId }).returning();
      return NextResponse.json({ ok: true, block }, { status: 201 });
    }

    if (!body.userId || !body.startedAt || !body.stoppedAt) return NextResponse.json({ error: "userId, startedAt, and stoppedAt are required" }, { status: 400 });
    await assertWorkspaceMember(context.workspaceId, body.userId);
    await assertWorkspaceProject(context.workspaceId, body.projectId);
    await assertWorkspaceGoal(context.workspaceId, body.goalId);
    await assertWorkspaceScheduleBlock(context.workspaceId, body.scheduledBlockId);
    const startedAt = new Date(body.startedAt);
    const stoppedAt = new Date(body.stoppedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime()) || stoppedAt <= startedAt) return NextResponse.json({ error: "Invalid time window" }, { status: 400 });
    const entry = await createTimeEntry({
      workspaceId: context.workspaceId,
      userId: body.userId,
      scheduledBlockId: body.scheduledBlockId || null,
      taskId: body.taskId || "api-entry",
      projectId: body.projectId || null,
      goalId: body.goalId || null,
      tags: normalizeTags(body.tags),
      startedAt,
      stoppedAt,
      durationSeconds: Math.max(1, Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000)),
      description: body.description || null,
      action: body.action || null,
      hourlyRate: body.hourlyRate ?? null,
      status: body.status ?? "draft",
      source: "manual",
      collaborators: [],
      expenses: [],
    });
    return NextResponse.json({ ok: true, entry }, { status: 201 });
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource || !WRITE_SCOPES[resource]) return NextResponse.json({ error: "Resource is not writable" }, { status: 405 });

  return guarded(req, resource, WRITE_SCOPES[resource], async (context) => {
    const body = await req.json();
    if (resource === "clients") {
      if (!body.clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
      const [client] = await db.update(clients).set({ name: body.name, email: body.email, address: body.address, currencyOverride: body.currencyOverride, status: body.status }).where(and(eq(clients.id, body.clientId), eq(clients.workspaceId, context.workspaceId))).returning();
      return NextResponse.json({ ok: true, client });
    }
    if (resource === "projects") {
      if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
      await assertWorkspaceClient(context.workspaceId, body.clientId);
      const [project] = await db.update(projects).set({ name: body.name, clientId: body.clientId, description: body.description, status: body.status, percentComplete: body.percentComplete, hourlyRate: body.hourlyRate, budgetAmount: body.budgetAmount }).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, context.workspaceId))).returning();
      return NextResponse.json({ ok: true, project });
    }
    if (resource === "tags") {
      if (!body.tagId) return NextResponse.json({ error: "tagId is required" }, { status: 400 });
      await assertWorkspaceProject(context.workspaceId, body.projectId);
      const [tag] = await db.update(workspaceTags).set({ name: body.name, color: body.color, projectId: body.projectId, isBillableDefault: body.isBillableDefault, status: body.status }).where(and(eq(workspaceTags.id, body.tagId), eq(workspaceTags.workspaceId, context.workspaceId))).returning();
      return NextResponse.json({ ok: true, tag });
    }
    if (resource === "tasks") {
      if (!body.taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
      await assertWorkspacePerson(context.workspaceId, body.assigneeId);
      const [task] = await db.update(projectTasks).set({ title: body.title, description: body.description, status: body.status as KanbanColumn | undefined, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, assigneeId: body.assigneeId, estimatedHours: body.estimatedHours }).where(and(eq(projectTasks.id, body.taskId), eq(projectTasks.workspaceId, context.workspaceId))).returning();
      return NextResponse.json({ ok: true, task });
    }
    if (resource === "schedule") {
      if (!body.blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });
      await assertWorkspaceProject(context.workspaceId, body.projectId);
      const [block] = await db.update(scheduledWorkBlocks).set({ title: body.title, notes: body.notes, status: body.status, startsAt: body.startsAt ? new Date(body.startsAt) : undefined, endsAt: body.endsAt ? new Date(body.endsAt) : undefined, projectId: body.projectId, taskId: body.taskId, tags: body.tags ? normalizeTags(body.tags) : undefined, updatedAt: new Date() }).where(and(eq(scheduledWorkBlocks.id, body.blockId), eq(scheduledWorkBlocks.workspaceId, context.workspaceId))).returning();
      return NextResponse.json({ ok: true, block });
    }
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    await assertWorkspaceProject(context.workspaceId, body.projectId);
    const [entry] = await db.update(timeEntries).set({ description: body.description, projectId: body.projectId, tags: body.tags ? normalizeTags(body.tags) : undefined, status: body.status }).where(and(eq(timeEntries.id, body.entryId), eq(timeEntries.workspaceId, context.workspaceId))).returning();
    return NextResponse.json({ ok: true, entry });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource || !WRITE_SCOPES[resource]) return NextResponse.json({ error: "Resource is not deletable" }, { status: 405 });

  return guarded(req, resource, WRITE_SCOPES[resource], async (context) => {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (resource === "clients") await db.update(clients).set({ status: "archived" }).where(and(eq(clients.id, id), eq(clients.workspaceId, context.workspaceId)));
    else if (resource === "projects") await db.update(projects).set({ status: "archived" }).where(and(eq(projects.id, id), eq(projects.workspaceId, context.workspaceId)));
    else if (resource === "tags") await db.update(workspaceTags).set({ status: "archived" }).where(and(eq(workspaceTags.id, id), eq(workspaceTags.workspaceId, context.workspaceId)));
    else if (resource === "tasks") await db.delete(projectTasks).where(and(eq(projectTasks.id, id), eq(projectTasks.workspaceId, context.workspaceId)));
    else if (resource === "schedule") await db.update(scheduledWorkBlocks).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(scheduledWorkBlocks.id, id), eq(scheduledWorkBlocks.workspaceId, context.workspaceId)));
    else return NextResponse.json({ error: "Delete is not supported for this resource" }, { status: 405 });
    return NextResponse.json({ ok: true, id });
  });
}

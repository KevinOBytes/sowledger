import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";

import { authenticateApiKey, requireApiScope, recordApiKeyRequest, getApiKeyErrorContext, type ApiKeyContext, type ApiScope } from "@/lib/api-keys";
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
  userActions,
  workspaceTags,
} from "@/lib/db/schema";
import { createExportResponse, loadExportData } from "@/lib/export-data";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { exposeFinancialRows, exposeInvoice, lockInvoiceLifecycle } from "@/lib/invoice-lifecycle";
import { createWorkspaceProject } from "@/lib/project-creation";
import { updateWorkspaceProject } from "@/lib/project-history";
import { updateScheduledBlock } from "@/lib/schedule-mutations";
import { buildRevenueIntelligence } from "@/lib/revenue-intelligence";
import { loadEligiblePlannedWork } from "@/lib/planned-work";
import { overlappingSeconds } from "@/lib/date-input";
import { lockScheduledBlockForEntry } from "@/lib/scheduled-block-entry";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import { normalizeTags } from "@/lib/validators";
import { ensurePeriodUnlocked, PeriodLockedError } from "@/lib/security";
import { withTimeCapacity, assertBucketReplacement, storedDuration, TimeCapacityError, TimePrecisionError, TimeDataError, type TimeTransaction } from "@/lib/time-capacity";
import { WorkflowError, classifyWorkflowError, readRequestJson, reportUnexpectedRequestFailure } from "@/lib/workflow-validation";
import { createWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask } from "@/lib/task-mutations";
import { createWorkspaceClient, updateWorkspaceClient } from "@/lib/client-mutations";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { createWorkspaceTag, updateWorkspaceTag, deleteWorkspaceTag } from "@/lib/tag-mutations";

type Resource = "clients" | "projects" | "tags" | "tasks" | "schedule" | "time-entries" | "analytics" | "invoices" | "proof-packs" | "revenue-intelligence" | "export";
type Ctx = { params: Promise<{ resource: string }> };
type PublicWritableTimeStatus = "draft" | "submitted";

const PUBLIC_WRITABLE_TIME_STATUSES = new Set(["draft", "submitted"]);

const READ_SCOPES: Record<Resource, ApiScope> = {
  clients: "read:clients",
  projects: "read:projects",
  tags: "read:tags",
  tasks: "read:tasks",
  schedule: "read:schedule",
  "time-entries": "read:time",
  analytics: "read:analytics",
  invoices: "read:invoices",
  "proof-packs": "read:proof-packs",
  "revenue-intelligence": "read:revenue-intelligence",
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
  return (["clients", "projects", "tags", "tasks", "schedule", "time-entries", "analytics", "invoices", "proof-packs", "revenue-intelligence", "export"] as Resource[]).includes(raw as Resource) ? raw as Resource : null;
}

function validationError(message: string, status = 400) {
  return new WorkflowError(message, status);
}

function endExclusive(value: string) {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date.setDate(date.getDate() + 1);
  return date;
}

type PublicMethod = "GET" | "POST" | "PATCH" | "DELETE";
const PUBLIC_FALLBACKS: Record<PublicMethod, string> = {
  GET: "We couldn't load this API resource. Please try again.",
  POST: "We couldn't confirm this API resource was created. Check the resource before trying again.",
  PATCH: "We couldn't confirm this API resource was updated. Check the resource before trying again.",
  DELETE: "We couldn't confirm this API resource was deleted. Check the resource before trying again.",
};

function classifyPublicError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return { status: 401, message: "Use a valid, active API key.", unexpected: false };
  if (error instanceof ForbiddenError) return { status: 403, message: "This API key does not have the required scope.", unexpected: false };
  return classifyWorkflowError(error, fallback);
}

async function guarded(req: NextRequest, resource: Resource, scope: ApiScope, method: PublicMethod, handler: (context: ApiKeyContext) => Promise<Response>) {
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
    const result = classifyPublicError(error, PUBLIC_FALLBACKS[method]);
    if (result.unexpected) reportUnexpectedRequestFailure({ route: "/api/v1/[resource]", method });
    context = context ?? getApiKeyErrorContext(error);
    const response = NextResponse.json({ error: result.message, resource }, { status: result.status });
    status = response.status;
    return response;
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
  if (!userId) throw validationError("userId is required");
  const [membership] = await db.select().from(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  if (!membership) throw validationError("userId is not a workspace member");
}

async function assertWorkspaceClient(workspaceId: string, clientId?: string | null) {
  if (!clientId) return;
  const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)));
  if (!client) throw validationError("clientId is not in this workspace");
}

async function assertWorkspaceProject(workspaceId: string, projectId?: string | null) {
  if (!projectId) return;
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
  if (!project) throw validationError("projectId is not in this workspace");
}

async function assertTimeCreateSchedule(tx: TimeTransaction, workspaceId: string, userId: string, blockId: string) {
  const [block] = await tx.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, workspaceId), eq(scheduledWorkBlocks.id, blockId)));
  if (!block) throw new WorkflowError("scheduledBlockId is not in this workspace", 400);
  if (isUnavailableScheduledBlock(block)) throw new WorkflowError("Unavailable, OOO, and external-calendar blocks cannot be logged as time entries", 400);
  if (block.userId !== userId) throw new WorkflowError("scheduledBlockId must belong to the time entry userId", 400);
  // Retain the preexisting public input statuses. The following locked helper
  // still rechecks current availability/ownership/consumption before any write.
  await lockScheduledBlockForEntry(tx, { blockId, workspaceId, userId });
}

async function assertWorkspaceAction(workspaceId: string, userId: string, actionId?: string | null) {
  if (!actionId) return;
  const [action] = await db
    .select({ id: userActions.id })
    .from(userActions)
    .where(and(eq(userActions.workspaceId, workspaceId), eq(userActions.userId, userId), eq(userActions.id, actionId)));
  if (!action) throw validationError("actionId is not available for this scheduled user");
}

function safePublicTimeStatus(status: unknown): PublicWritableTimeStatus | null {
  if (status === undefined || status === null || status === "") return "draft";
  return typeof status === "string" && PUBLIC_WRITABLE_TIME_STATUSES.has(status)
    ? status as PublicWritableTimeStatus
    : null;
}

async function analytics(workspaceId: string, req: NextRequest) {
  const entries = await db.select().from(timeEntries).where(entryConditions(workspaceId, req));
  const params = req.nextUrl.searchParams;
  const start = params.get("start") ? new Date(params.get("start")!) : null;
  const end = params.get("end") ? endExclusive(params.get("end")!) : null;
  const scheduled = await loadEligiblePlannedWork(workspaceId, { userId: params.get("userId"), projectId: params.get("projectId"), start, end });

  const totalSeconds = entries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const manualSeconds = entries.filter((entry) => entry.source === "manual").reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const timerSeconds = entries.filter((entry) => entry.source === "web").reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const billableAmount = entries.reduce((sum, entry) => sum + ((entry.durationSeconds ?? 0) / 3600) * (entry.hourlyRate ?? 0), 0);
  const plannedSeconds = scheduled.reduce((sum, block) => sum + overlappingSeconds(block.startsAt, block.endsAt, start, end), 0);
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

  return guarded(req, resource, READ_SCOPES[resource], "GET", async (context) => {
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
      const rows = await db.transaction(async tx => {
        await lockInvoiceLifecycle(tx, context.workspaceId);
        const rows = await tx.select().from(timeEntries).where(entryConditions(context.workspaceId, req)).orderBy(desc(timeEntries.startedAt)).limit(500);
        await exposeFinancialRows(tx, context.workspaceId, context.createdByUserId, [], rows.map(row => row.id), "Public API time-entry read");
        return rows;
      }, { isolationLevel: "repeatable read" });
      return NextResponse.json({ ok: true, entries: rows });
    }
    if (resource === "analytics") {
      return NextResponse.json({ ok: true, analytics: await analytics(context.workspaceId, req) });
    }
    if (resource === "invoices") {
      const rows = await db.transaction(async tx => {
        await lockInvoiceLifecycle(tx, context.workspaceId);
        const rows = await tx.select().from(invoices).where(eq(invoices.workspaceId, context.workspaceId)).orderBy(desc(invoices.createdAt));
        await exposeFinancialRows(tx, context.workspaceId, context.createdByUserId, rows.map(row => row.id), [], "Public API invoice read");
        return rows;
      }, { isolationLevel: "repeatable read" });
      return NextResponse.json({ ok: true, invoices: rows });
    }
    if (resource === "proof-packs") {
      const invoiceId = req.nextUrl.searchParams.get("invoiceId");
      if (!invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
      const result = await db.transaction(async tx => {
        await lockInvoiceLifecycle(tx, context.workspaceId);
        const proof = await buildInvoiceProofPack(context.workspaceId, invoiceId, tx);
        if (proof) await exposeInvoice(tx, context.workspaceId, invoiceId, context.createdByUserId, "Public API proof export");
        return proof;
      }, { isolationLevel: "repeatable read" });
      if (!result) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      return NextResponse.json(
        { ok: true, proofPack: result.proofPack, digest: result.digest },
        { headers: { "x-sowledger-proof-sha256": result.digest } },
      );
    }
    if (resource === "revenue-intelligence") {
      const intelligence = await db.transaction(async tx => {
        await lockInvoiceLifecycle(tx, context.workspaceId);
        const result = await buildRevenueIntelligence(context.workspaceId, {
          scope: "team",
          projectId: req.nextUrl.searchParams.get("projectId"),
          start: req.nextUrl.searchParams.get("start"),
          end: req.nextUrl.searchParams.get("end"),
        }, tx);
        // Only the individual financial lines in the final, truncated response
        // were shared; filtered-out entries and aggregate metrics are not lines.
        const entryIds = result.recoveryOpportunities
          .filter(item => item.type === "approved_uninvoiced_entry")
          .map(item => item.id.slice("approved-".length));
        await exposeFinancialRows(tx, context.workspaceId, context.createdByUserId, [], entryIds, "Public API revenue-intelligence read");
        return result;
      }, { isolationLevel: "repeatable read" });
      return NextResponse.json(intelligence);
    }

    const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
    const data = await loadExportData(context.workspaceId, Object.fromEntries(req.nextUrl.searchParams.entries()), { actorUserId: context.createdByUserId, format });
    return createExportResponse(data, format, `sowledger-${context.workspaceId}-${new Date().toISOString().slice(0, 10)}`);
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource || !WRITE_SCOPES[resource]) return NextResponse.json({ error: "Resource is not writable" }, { status: 405 });

  return guarded(req, resource, WRITE_SCOPES[resource], "POST", async (context) => {
    const body = await readRequestJson(req);
    if (resource !== "tasks" && resource !== "clients" && (!body || typeof body !== "object" || Array.isArray(body))) throw new WorkflowError("Send a JSON object.", 400);
    if (resource === "clients") {
      const client = await createWorkspaceClient(context.workspaceId, body);
      return NextResponse.json({ ok: true, client }, { status: 201 });
    }
    if (resource === "projects") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
      await assertWorkspaceClient(context.workspaceId, body.clientId);
      const result = await createWorkspaceProject({ id: crypto.randomUUID(), workspaceId: context.workspaceId, name, clientId: body.clientId || null, description: body.description || null, color: body.color || "#3b82f6", billingModel: body.billingModel ?? "hourly", hourlyRate: body.hourlyRate ?? null, budgetType: body.budgetType ?? "none", budgetAmount: body.budgetAmount ?? null });
      if (!result.allowed) return NextResponse.json({ error: result.error }, { status: 402 });
      return NextResponse.json({ ok: true, project: result.project }, { status: 201 });
    }
    if (resource === "tags") {
      const tag = await createWorkspaceTag(context.workspaceId, body);
      return NextResponse.json({ ok: true, tag }, { status: 201 });
    }
    if (resource === "tasks") {
      const task = await createWorkspaceTask(context.workspaceId, body, "public");
      return NextResponse.json({ ok: true, task }, { status: 201 });
    }
    if (resource === "schedule") {
      if (!body.userId || !body.title || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "userId, title, startsAt, and endsAt are required" }, { status: 400 });
      if (body.userId !== context.createdByUserId) requireApiScope(context, "impersonate:user");
      await assertWorkspaceMember(context.workspaceId, body.userId);
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(body.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return NextResponse.json({ error: "Invalid schedule window" }, { status: 400 });
      await assertWorkspaceProject(context.workspaceId, body.projectId);
      await assertWorkspaceAction(context.workspaceId, body.userId, body.actionId);
      const [block] = await db.insert(scheduledWorkBlocks).values({ id: crypto.randomUUID(), workspaceId: context.workspaceId, userId: body.userId, projectId: body.projectId || null, taskId: body.taskId || null, actionId: body.actionId || null, title: body.title, notes: body.notes || null, tags: normalizeTags(body.tags), startsAt, endsAt, createdByUserId: body.userId }).returning();
      return NextResponse.json({ ok: true, block }, { status: 201 });
    }

    try {
      if (typeof body.userId !== "string" || !body.userId || !body.startedAt || !body.stoppedAt) return NextResponse.json({ error: "userId, startedAt, and stoppedAt are required" }, { status: 400 });
      if (body.userId !== context.createdByUserId) requireApiScope(context, "impersonate:user");
      const status = safePublicTimeStatus(body.status);
      if (!status) return NextResponse.json({ error: "Public API time entries can only be created as draft or submitted" }, { status: 400 });
      const startedAt = new Date(body.startedAt);
      const stoppedAt = new Date(body.stoppedAt);
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime()) || stoppedAt <= startedAt) return NextResponse.json({ error: "Invalid time window" }, { status: 400 });
      const durationSeconds = storedDuration(Math.max(1, Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000))).seconds;
      const entry = await withTimeCapacity({ workspaceId: context.workspaceId, userId: body.userId }, async (capacity) => {
        const { tx } = capacity;
        const [member] = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.workspaceId, context.workspaceId), eq(memberships.userId, body.userId)));
        if (!member) throw new WorkflowError("userId is not a workspace member", 400);
        if (body.projectId) {
          const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, context.workspaceId), eq(projects.id, body.projectId)));
          if (!project) throw new WorkflowError("projectId is not in this workspace", 400);
        }
        if (body.goalId) {
          const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.workspaceId, context.workspaceId), eq(goals.id, body.goalId)));
          if (!goal) throw new WorkflowError("goalId is not in this workspace", 400);
        }
        await ensurePeriodUnlocked(context.workspaceId, startedAt, stoppedAt, tx);
        const id = crypto.randomUUID();
        await assertBucketReplacement(capacity, { before: [], after: [{ id, workspaceId: context.workspaceId, userId: body.userId, startedAt, durationSeconds }] });
        if (body.scheduledBlockId) {
          await assertTimeCreateSchedule(tx, context.workspaceId, body.userId, body.scheduledBlockId);
        }
        const [created] = await tx.insert(timeEntries).values({
          id,
          workspaceId: context.workspaceId,
          userId: body.userId,
          scheduledBlockId: body.scheduledBlockId || null,
          taskId: body.taskId || "api-entry",
          projectId: body.projectId || null,
          goalId: body.goalId || null,
          tags: normalizeTags(body.tags),
          startedAt,
          stoppedAt,
          durationSeconds,
          description: body.description || null,
          action: body.action || null,
          hourlyRate: body.hourlyRate ?? null,
          status,
          source: "manual",
          collaborators: [],
          expenses: [],
        }).returning();
        if (body.scheduledBlockId) {
          await tx.update(scheduledWorkBlocks).set({ status: "completed", linkedTimeEntryId: created.id, updatedAt: new Date() })
            .where(and(eq(scheduledWorkBlocks.id, body.scheduledBlockId), eq(scheduledWorkBlocks.workspaceId, context.workspaceId), eq(scheduledWorkBlocks.userId, body.userId)));
        }
        return { ...created, durationSeconds };
      });
      return NextResponse.json({ ok: true, entry }, { status: 201 });
    } catch (error) {
      if (error instanceof PeriodLockedError || error instanceof TimeDataError) return NextResponse.json({ error: error.message, resource }, { status: 409 });
      if (error instanceof TimeCapacityError || error instanceof TimePrecisionError) return NextResponse.json({ error: error.message, resource }, { status: 400 });
      const result = classifyPublicError(error, "Could not create this time entry. Please try again.");
      if (result.unexpected) reportUnexpectedRequestFailure({ route: "/api/v1/[resource]", method: "POST" });
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource || !WRITE_SCOPES[resource]) return NextResponse.json({ error: "Resource is not writable" }, { status: 405 });

  return guarded(req, resource, WRITE_SCOPES[resource], "PATCH", async (context) => {
    const body = await readRequestJson(req);
    if (resource !== "tasks" && resource !== "clients" && (!body || typeof body !== "object" || Array.isArray(body))) throw new WorkflowError("Send a JSON object.", 400);
    if (resource === "clients") {
      const client = await updateWorkspaceClient(context.workspaceId, body);
      return NextResponse.json({ ok: true, client });
    }
    if (resource === "projects") {
      if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
      await assertWorkspaceClient(context.workspaceId, body.clientId);
      const project = await updateWorkspaceProject(context.workspaceId, body.projectId, { name: body.name, clientId: body.clientId, description: body.description, status: body.status, percentComplete: body.percentComplete, hourlyRate: body.hourlyRate, budgetAmount: body.budgetAmount });
      return NextResponse.json({ ok: true, project });
    }
    if (resource === "tags") {
      const tag = await updateWorkspaceTag(context.workspaceId, body, "public");
      return NextResponse.json({ ok: true, tag });
    }
    if (resource === "tasks") {
      const task = await updateWorkspaceTask(context.workspaceId, body, "public");
      return NextResponse.json({ ok: true, task });
    }
    if (resource === "schedule") {
      if (!body.blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });
      if ((body.startsAt !== undefined && typeof body.startsAt !== "string") || (body.endsAt !== undefined && typeof body.endsAt !== "string")) return NextResponse.json({ error: "Schedule dates must be valid date strings" }, { status: 400 });
      const block = await updateScheduledBlock({
        workspaceId: context.workspaceId, blockId: body.blockId, actorUserId: context.createdByUserId,
        canManageOthers: context.scopes.includes("impersonate:user"),
        updates: { title: body.title, notes: body.notes, status: body.status,
          startsAt: body.startsAt !== undefined ? new Date(body.startsAt) : undefined,
          endsAt: body.endsAt !== undefined ? new Date(body.endsAt) : undefined,
          userId: body.userId, projectId: body.projectId, taskId: body.taskId, actionId: body.actionId,
          linkedTimeEntryId: body.linkedTimeEntryId,
          tags: body.tags !== undefined ? normalizeTags(body.tags) : undefined },
      });
      return NextResponse.json({ ok: true, block });
    }
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    const requestedStatus = body.status === undefined ? undefined : safePublicTimeStatus(body.status);
    if (body.status !== undefined && !requestedStatus) {
      return NextResponse.json({ error: "Public API time entries can only transition to draft or submitted" }, { status: 400 });
    }
    const status = requestedStatus ?? undefined;
    await assertWorkspaceProject(context.workspaceId, body.projectId);
    const [entry] = await db.update(timeEntries)
      .set({ description: body.description, projectId: body.projectId, tags: body.tags ? normalizeTags(body.tags) : undefined, status })
      .where(and(
        eq(timeEntries.id, body.entryId),
        eq(timeEntries.workspaceId, context.workspaceId),
        context.scopes.includes("impersonate:user") ? undefined : eq(timeEntries.userId, context.createdByUserId),
        inArray(timeEntries.status, ["draft", "submitted"]),
      ))
      .returning();
    if (!entry) {
      const [existingEntry] = await db
        .select({ id: timeEntries.id, status: timeEntries.status, userId: timeEntries.userId })
        .from(timeEntries)
        .where(and(eq(timeEntries.id, body.entryId), eq(timeEntries.workspaceId, context.workspaceId)));
      if (!existingEntry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      if (existingEntry.userId !== context.createdByUserId) requireApiScope(context, "impersonate:user");
      const message = PUBLIC_WRITABLE_TIME_STATUSES.has(existingEntry.status)
        ? "Entry changed. Refresh and try again."
        : "Approved or invoiced entries are locked";
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ ok: true, entry });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { resource: raw } = await ctx.params;
  const resource = normalizeResource(raw);
  if (!resource || !WRITE_SCOPES[resource]) return NextResponse.json({ error: "Resource is not deletable" }, { status: 405 });

  return guarded(req, resource, WRITE_SCOPES[resource], "DELETE", async (context) => {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      if (resource === "tags") await deleteWorkspaceTag(context.workspaceId, id, true);
      if (resource === "tasks") throw new WorkflowError("taskId must be a nonempty string of at most 255 characters.", 400);
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (resource === "clients") await db.update(clients).set({ status: "archived" }).where(and(eq(clients.id, id), eq(clients.workspaceId, context.workspaceId)));
    else if (resource === "projects") await db.update(projects).set({ status: "archived" }).where(and(eq(projects.id, id), eq(projects.workspaceId, context.workspaceId)));
    else if (resource === "tags") {
      const deletedId = await deleteWorkspaceTag(context.workspaceId, id, true);
      return NextResponse.json({ ok: true, id: deletedId });
    }
    else if (resource === "tasks") {
      const deletedId = await deleteWorkspaceTask(context.workspaceId, id);
      return NextResponse.json({ ok: true, id: deletedId });
    }
    else if (resource === "schedule") {
      await updateScheduledBlock({ workspaceId: context.workspaceId, blockId: id, actorUserId: context.createdByUserId, canManageOthers: context.scopes.includes("impersonate:user"), updates: { status: "canceled" } });
    }
    else return NextResponse.json({ error: "Delete is not supported for this resource" }, { status: 405 });
    return NextResponse.json({ ok: true, id });
  });
}

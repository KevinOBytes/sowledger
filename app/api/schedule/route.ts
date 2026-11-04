import { NextRequest, NextResponse, after } from "next/server";
import { getAppOrigin } from "@/lib/app-url";
import { and, desc, eq, exists, getTableColumns, gt, lt, sql } from "drizzle-orm";

import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { integrationSyncRecords, memberships, projects, scheduledWorkBlocks, timeEntries, userActions } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { createScheduledBatch } from "@/lib/schedule-batch";
import { updateScheduledBlock } from "@/lib/schedule-mutations";
import { normalizeTags } from "@/lib/validators";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

type ScheduleStatus = "planned" | "in_progress" | "completed" | "skipped" | "canceled";

const SCHEDULE_STATUSES: ScheduleStatus[] = ["planned", "in_progress", "completed", "skipped", "canceled"];

function isScheduleStatus(value: unknown): value is ScheduleStatus {
  return typeof value === "string" && SCHEDULE_STATUSES.includes(value as ScheduleStatus);
}

function parseDate(value: unknown, label: string) {
  if (typeof value !== "string") throw new WorkflowError(`${label} is required`, 400);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new WorkflowError(`${label} must be a valid date`, 400);
  return date;
}

async function validateProject(workspaceId: string, projectId?: string | null) {
  if (!projectId) return;
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
  if (!project) throw new WorkflowError("Invalid projectId", 400);
}

async function validateAction(workspaceId: string, userId: string, actionId?: string | null) {
  if (!actionId) return;
  const [action] = await db.select().from(userActions).where(and(eq(userActions.id, actionId), eq(userActions.workspaceId, workspaceId), eq(userActions.userId, userId)));
  if (!action) throw new WorkflowError("Invalid actionId", 400);
}

async function validateUserAccess(workspaceId: string, actorRole: string, actorUserId: string, requestedUserId?: string | null) {
  const userId = requestedUserId || actorUserId;
  if (userId !== actorUserId && actorRole !== "manager" && actorRole !== "owner") throw new WorkflowError("Cannot schedule another user's time", 403);
  const [membership] = await db.select().from(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  if (!membership) throw new WorkflowError("User is not in this workspace", 400);
  return userId;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const { searchParams } = req.nextUrl;
    const scope = searchParams.get("scope") ?? "mine";
    const projectId = searchParams.get("projectId");
    const status = searchParams.get("status") as ScheduleStatus | null;
    const start = searchParams.has("start") ? parseDate(searchParams.get("start"), "start") : null;
    const end = searchParams.has("end") ? parseDate(searchParams.get("end"), "end") : null;
    if (start && end && end <= start) throw new WorkflowError("end must be after start", 400);

    const conditions = [eq(scheduledWorkBlocks.workspaceId, session.workspaceId)];
    if (scope !== "team" || (session.role !== "manager" && session.role !== "owner")) {
      conditions.push(eq(scheduledWorkBlocks.userId, session.sub));
    }
    if (projectId) conditions.push(eq(scheduledWorkBlocks.projectId, projectId));
    if (status && isScheduleStatus(status)) conditions.push(eq(scheduledWorkBlocks.status, status));
    if (start) conditions.push(gt(scheduledWorkBlocks.endsAt, start));
    if (end) conditions.push(lt(scheduledWorkBlocks.startsAt, end));

    const blocks = await db.select({
      ...getTableColumns(scheduledWorkBlocks),
      // Editable status/labels can be stale; affordances also use durable links.
      hasRecordedTime: exists(db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.workspaceId, scheduledWorkBlocks.workspaceId), eq(timeEntries.scheduledBlockId, scheduledWorkBlocks.id)))),
      isImported: exists(db.select({ id: integrationSyncRecords.id }).from(integrationSyncRecords).where(and(eq(integrationSyncRecords.workspaceId, scheduledWorkBlocks.workspaceId), eq(integrationSyncRecords.provider, "google_calendar"), eq(integrationSyncRecords.resourceType, "scheduled_work_block"), eq(integrationSyncRecords.resourceId, scheduledWorkBlocks.id), sql`${integrationSyncRecords.metadata}->>'direction' = 'google_busy_to_sowledger'`))),
    }).from(scheduledWorkBlocks).where(and(...conditions)).orderBy(desc(scheduledWorkBlocks.startsAt));
    return NextResponse.json({ ok: true, blocks });
  } catch (error) {
    return workflowErrorResponse(error, "Could not load your schedule. Please try again.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const body = await readRequestJson(req) as {
      operationId?: unknown;
      occurrences?: unknown;
      replace?: unknown;
      title?: string;
      startsAt?: string;
      endsAt?: string;
      userId?: string;
      projectId?: string;
      taskId?: string;
      actionId?: string;
      notes?: string;
      tags?: string[];
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a valid scheduling request.", 400);
    if ("operationId" in body || "occurrences" in body || "replace" in body) {
      const { createdBlocks, ...receipt } = await createScheduledBatch({ workspaceId: session.workspaceId, actorUserId: session.sub, canManageOthers: session.role === "manager" || session.role === "owner", body });
      if (createdBlocks.length > 0) after(async () => {
        await Promise.all(createdBlocks.map(block => dispatchIntegrationNotification(session.workspaceId, "scheduled_block.created", {
          title: `Scheduled: ${block.title}`,
          body: `${block.startsAt.toLocaleString()} - ${block.endsAt.toLocaleString()}`,
          url: `${getAppOrigin()}/calendar`,
        }).catch(() => {})));
      });
      return NextResponse.json({ ok: true, ...receipt });
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    if (title.length > 255) throw new WorkflowError("Keep the title to 255 characters or fewer.", 400);
    const startsAt = parseDate(body.startsAt, "startsAt");
    const endsAt = parseDate(body.endsAt, "endsAt");
    if (endsAt <= startsAt) return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });

    const userId = await validateUserAccess(session.workspaceId, session.role, session.sub, body.userId);
    await validateProject(session.workspaceId, body.projectId);
    await validateAction(session.workspaceId, userId, body.actionId);

    const [block] = await db.insert(scheduledWorkBlocks).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      userId,
      projectId: body.projectId || null,
      taskId: body.taskId || null,
      actionId: body.actionId || null,
      title,
      notes: body.notes || null,
      tags: normalizeTags(body.tags),
      startsAt,
      endsAt,
      createdByUserId: session.sub,
    }).returning();

    after(() => {
      dispatchIntegrationNotification(session.workspaceId, "scheduled_block.created", {
        title: `Scheduled: ${block.title}`,
        body: `${new Date(block.startsAt).toLocaleString()} - ${new Date(block.endsAt).toLocaleString()}`,
        url: `${getAppOrigin()}/calendar`,
      }).catch(() => {});
    });

    return NextResponse.json({ ok: true, block });
  } catch (error) {
    return workflowErrorResponse(error, "Could not schedule this work. Please try again.", { route: "/api/schedule", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const body = await readRequestJson(req) as {
      blockId?: string;
      title?: string;
      startsAt?: string;
      endsAt?: string;
      userId?: string | null;
      projectId?: string | null;
      taskId?: string | null;
      actionId?: string | null;
      notes?: string | null;
      tags?: string[];
      status?: ScheduleStatus;
      linkedTimeEntryId?: string | null;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    if (!body.blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });

    const updates: Parameters<typeof updateScheduledBlock>[0]["updates"] = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.startsAt !== undefined) updates.startsAt = parseDate(body.startsAt, "startsAt");
    if (body.endsAt !== undefined) updates.endsAt = parseDate(body.endsAt, "endsAt");
    if (body.userId !== undefined) updates.userId = body.userId || session.sub;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.taskId !== undefined) updates.taskId = body.taskId;
    if (body.actionId !== undefined) updates.actionId = body.actionId;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.tags !== undefined) updates.tags = normalizeTags(body.tags);
    if (body.linkedTimeEntryId !== undefined) updates.linkedTimeEntryId = body.linkedTimeEntryId;
    if (body.status !== undefined) {
      if (!isScheduleStatus(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      updates.status = body.status;
    }

    const block = await updateScheduledBlock({ workspaceId: session.workspaceId, blockId: body.blockId, actorUserId: session.sub, canManageOthers: session.role === "manager" || session.role === "owner", updates });
    return NextResponse.json({ ok: true, block });
  } catch (error) {
    return workflowErrorResponse(error, "Could not update this scheduled work. Please try again.", { route: "/api/schedule", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const blockId = req.nextUrl.searchParams.get("blockId");
    if (!blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });
    await updateScheduledBlock({ workspaceId: session.workspaceId, blockId, actorUserId: session.sub, canManageOthers: session.role === "manager" || session.role === "owner", updates: { status: "canceled" } });
    return NextResponse.json({ ok: true, blockId });
  } catch (error) {
    return workflowErrorResponse(error, "Could not cancel this scheduled work. Please try again.");
  }
}

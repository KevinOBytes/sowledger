import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { memberships, projects, scheduledWorkBlocks, timeEntries, userActions } from "@/lib/db/schema";
import { normalizeTags } from "@/lib/validators";

type ScheduleStatus = "planned" | "in_progress" | "completed" | "skipped" | "canceled";

function statusFrom(error: unknown) {
  const err = error as { status?: number; statusCode?: number };
  return err.status ?? err.statusCode ?? 500;
}

function parseDate(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

async function validateProject(workspaceId: string, projectId?: string | null) {
  if (!projectId) return;
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
  if (!project) throw new Error("Invalid projectId");
}

async function validateAction(workspaceId: string, userId: string, actionId?: string | null) {
  if (!actionId) return;
  const [action] = await db.select().from(userActions).where(and(eq(userActions.id, actionId), eq(userActions.workspaceId, workspaceId), eq(userActions.userId, userId)));
  if (!action) throw new Error("Invalid actionId");
}

async function validateUserAccess(workspaceId: string, actorRole: string, actorUserId: string, requestedUserId?: string | null) {
  const userId = requestedUserId || actorUserId;
  if (userId !== actorUserId && actorRole !== "manager" && actorRole !== "owner") throw new Error("Cannot schedule another user's time");
  const [membership] = await db.select().from(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  if (!membership) throw new Error("User is not in this workspace");
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
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const conditions = [eq(scheduledWorkBlocks.workspaceId, session.workspaceId)];
    if (scope !== "team" || (session.role !== "manager" && session.role !== "owner")) {
      conditions.push(eq(scheduledWorkBlocks.userId, session.sub));
    }
    if (projectId) conditions.push(eq(scheduledWorkBlocks.projectId, projectId));
    if (status && ["planned", "in_progress", "completed", "skipped", "canceled"].includes(status)) conditions.push(eq(scheduledWorkBlocks.status, status));
    if (start) conditions.push(gte(scheduledWorkBlocks.startsAt, new Date(start)));
    if (end) conditions.push(lte(scheduledWorkBlocks.startsAt, new Date(end)));

    const blocks = await db.select().from(scheduledWorkBlocks).where(and(...conditions)).orderBy(desc(scheduledWorkBlocks.startsAt));
    return NextResponse.json({ ok: true, blocks });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: statusFrom(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const body = await req.json() as {
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

    const title = body.title?.trim();
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
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

    return NextResponse.json({ ok: true, block });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("required") || message.includes("Invalid") || message.includes("after") ? 400 : statusFrom(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const body = await req.json() as {
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
    if (!body.blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });

    const [existing] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, body.blockId), eq(scheduledWorkBlocks.workspaceId, session.workspaceId)));
    if (!existing) return NextResponse.json({ error: "Scheduled block not found" }, { status: 404 });
    if (existing.userId !== session.sub && session.role !== "manager" && session.role !== "owner") return NextResponse.json({ error: "Cannot edit another user's schedule" }, { status: 403 });

    const nextUserId = body.userId !== undefined ? await validateUserAccess(session.workspaceId, session.role, session.sub, body.userId) : existing.userId;
    const nextProjectId = body.projectId !== undefined ? body.projectId : existing.projectId;
    const nextActionId = body.actionId !== undefined ? body.actionId : existing.actionId;
    if (body.linkedTimeEntryId) {
      const [entry] = await db
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(and(eq(timeEntries.id, body.linkedTimeEntryId), eq(timeEntries.workspaceId, session.workspaceId)));
      if (!entry) return NextResponse.json({ error: "Invalid linkedTimeEntryId" }, { status: 400 });
    }
    await validateProject(session.workspaceId, nextProjectId);
    await validateAction(session.workspaceId, nextUserId, nextActionId);

    const updates: Partial<typeof scheduledWorkBlocks.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.startsAt !== undefined) updates.startsAt = parseDate(body.startsAt, "startsAt");
    if (body.endsAt !== undefined) updates.endsAt = parseDate(body.endsAt, "endsAt");
    if (body.userId !== undefined) updates.userId = nextUserId;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.taskId !== undefined) updates.taskId = body.taskId;
    if (body.actionId !== undefined) updates.actionId = body.actionId;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.tags !== undefined) updates.tags = normalizeTags(body.tags);
    if (body.linkedTimeEntryId !== undefined) updates.linkedTimeEntryId = body.linkedTimeEntryId;
    if (body.status !== undefined) updates.status = body.status;

    const startForCheck = updates.startsAt ?? existing.startsAt;
    const endForCheck = updates.endsAt ?? existing.endsAt;
    if (endForCheck <= startForCheck) return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });

    const [block] = await db
      .update(scheduledWorkBlocks)
      .set(updates)
      .where(and(eq(scheduledWorkBlocks.id, body.blockId), eq(scheduledWorkBlocks.workspaceId, session.workspaceId)))
      .returning();
    return NextResponse.json({ ok: true, block });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("required") || message.includes("Invalid") || message.includes("after") ? 400 : statusFrom(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const blockId = req.nextUrl.searchParams.get("blockId");
    if (!blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });
    const [existing] = await db.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.id, blockId), eq(scheduledWorkBlocks.workspaceId, session.workspaceId)));
    if (!existing) return NextResponse.json({ error: "Scheduled block not found" }, { status: 404 });
    if (existing.userId !== session.sub && session.role !== "manager" && session.role !== "owner") return NextResponse.json({ error: "Cannot delete another user's schedule" }, { status: 403 });

    await db
      .update(scheduledWorkBlocks)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(scheduledWorkBlocks.id, blockId), eq(scheduledWorkBlocks.workspaceId, session.workspaceId)));
    return NextResponse.json({ ok: true, blockId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: statusFrom(error) });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { createTimeEntry, ensurePeriodUnlocked, enforceDailyHoursLimit } from "@/lib/security";
import { db } from "@/lib/db";
import { projects, goals, userActions, scheduledWorkBlocks } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      taskId?: string;
      description?: string;
      collaborators?: string[];
      projectId?: string;
      goalId?: string;
      tags?: string[];
      actionId?: string;
      startedAt: string;
      stoppedAt: string;
      scheduledBlockId?: string;
      source?: "manual" | "calendar";
    };

    if (!body.startedAt || !body.stoppedAt) {
      return NextResponse.json({ error: "startedAt and stoppedAt are required for manual entries" }, { status: 400 });
    }

    const startedAt = new Date(body.startedAt);
    const stoppedAt = new Date(body.stoppedAt);

    if (isNaN(startedAt.getTime()) || isNaN(stoppedAt.getTime())) {
      return NextResponse.json({ error: "Invalid date formats" }, { status: 400 });
    }

    if (stoppedAt <= startedAt) {
      return NextResponse.json({ error: "stoppedAt must be after startedAt" }, { status: 400 });
    }

    const durationSeconds = Math.max(1, Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000));

    // Security constraints
    await ensurePeriodUnlocked(session.workspaceId, startedAt, stoppedAt);
    await enforceDailyHoursLimit(session.workspaceId, session.sub, startedAt, durationSeconds);

    if (body.projectId) {
      const [project] = await db.select().from(projects).where(eq(projects.id, body.projectId));
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    if (body.goalId) {
      const [goal] = await db.select().from(goals).where(eq(goals.id, body.goalId));
      if (!goal || goal.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid goalId" }, { status: 400 });
      }
    }

    let actionName: string | undefined;
    let hourlyRate: number | undefined;

    if (body.actionId) {
      const [uAction] = await db.select().from(userActions).where(eq(userActions.id, body.actionId));
      if (!uAction || uAction.workspaceId !== session.workspaceId || uAction.userId !== session.sub) {
        return NextResponse.json({ error: "Invalid actionId" }, { status: 400 });
      }
      actionName = uAction.name;
      hourlyRate = uAction.hourlyRate || undefined;
    }

    if (body.scheduledBlockId) {
      const [block] = await db.select().from(scheduledWorkBlocks).where(eq(scheduledWorkBlocks.id, body.scheduledBlockId));
      if (!block || block.workspaceId !== session.workspaceId || block.userId !== session.sub) {
        return NextResponse.json({ error: "Invalid scheduledBlockId" }, { status: 400 });
      }
    }

    const entry = await createTimeEntry({
      workspaceId: session.workspaceId,
      userId: session.sub,
      scheduledBlockId: body.scheduledBlockId || null,
      taskId: body.taskId || "manual-entry",
      projectId: body.projectId || null,
      goalId: body.goalId || null,
      tags: normalizeTags(body.tags),
      startedAt,
      stoppedAt,
      durationSeconds,
      description: body.description || null,
      status: "draft",
      source: body.source === "calendar" ? "calendar" : "manual",
      collaborators: body.collaborators ?? [],
      expenses: [],
      action: actionName || null,
      hourlyRate: hourlyRate || null,
    });

    if (body.scheduledBlockId) {
      await db.update(scheduledWorkBlocks).set({
        status: "completed",
        linkedTimeEntryId: entry.id,
        updatedAt: new Date(),
      }).where(eq(scheduledWorkBlocks.id, body.scheduledBlockId));
    }

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status =
      typeof err?.status === "number"
        ? err.status
        : typeof err?.statusCode === "number"
        ? err.statusCode
        : 500;
    const message = typeof err?.message === "string" ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}

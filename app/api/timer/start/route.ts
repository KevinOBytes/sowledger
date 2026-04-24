import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { createTimeEntry } from "@/lib/security";
import { db } from "@/lib/db";
import { projects, goals, userActions, scheduledWorkBlocks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
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
      scheduledBlockId?: string;
    };

    if (!body.taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

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
      taskId: body.taskId,
      projectId: body.projectId || null,
      goalId: body.goalId || null,
      tags: normalizeTags(body.tags),
      startedAt: new Date(),
      stoppedAt: null,
      durationSeconds: null,
      description: body.description || null,
      status: "draft",
      source: "web",
      collaborators: body.collaborators ?? [],
      expenses: [],
      action: actionName || null,
      hourlyRate: hourlyRate || null,
    });

    if (body.scheduledBlockId) {
      await db.update(scheduledWorkBlocks).set({
        status: "in_progress",
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

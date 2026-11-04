import { workflowErrorResponse } from "@/lib/workflow-validation";
import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, timeEntries } from "@/lib/db/schema";
import { eq, and, isNotNull, isNull } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    // Get all running timers for the current user in this workspace
    const activeEntries = await db.select({
      id: timeEntries.id,
      workspaceId: timeEntries.workspaceId,
      userId: timeEntries.userId,
      scheduledBlockId: timeEntries.scheduledBlockId,
      taskId: timeEntries.taskId,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      goalId: timeEntries.goalId,
      action: timeEntries.action,
      tags: timeEntries.tags,
      startedAt: timeEntries.startedAt,
      isPaused: timeEntries.isPaused,
      pausedAt: timeEntries.pausedAt,
      accumulatedSeconds: timeEntries.accumulatedSeconds,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(
        eq(timeEntries.workspaceId, session.workspaceId),
        eq(timeEntries.userId, session.sub),
        isNotNull(timeEntries.startedAt),
        isNull(timeEntries.stoppedAt)
    ));

    return NextResponse.json({ ok: true, activeEntries });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your active timers. Please try again.", { route: "/api/timer/active", method: "GET" });
  }
}

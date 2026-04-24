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
    const err: unknown = error;
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? Number((err as Record<string, unknown>).status)
        : typeof (err as Record<string, unknown>)?.statusCode === "number"
        ? Number((err as Record<string, unknown>).statusCode)
        : 500;
    const message = (err as Error)?.message || "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}

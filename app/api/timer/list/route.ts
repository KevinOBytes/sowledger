import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projects, goals } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Allow any workspace member
    requireRole("member", session.role);

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const statusParam = searchParams.get("status");

    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    const conditions = [
      eq(timeEntries.workspaceId, session.workspaceId),
      eq(timeEntries.userId, session.sub)
    ];

    if (statusParam) {
      if (!["draft", "submitted", "approved", "invoiced"].includes(statusParam)) {
         return NextResponse.json({ error: "Invalid status parameter" }, { status: 400 });
      }
      conditions.push(eq(timeEntries.status, statusParam as "draft" | "submitted" | "approved" | "invoiced"));
    }

    const entries = await db.select({
      id: timeEntries.id,
      taskId: timeEntries.taskId,
      startedAt: timeEntries.startedAt,
      stoppedAt: timeEntries.stoppedAt,
      durationSeconds: timeEntries.durationSeconds,
      description: timeEntries.description,
      status: timeEntries.status,
      source: timeEntries.source,
      tags: timeEntries.tags,
      projectId: timeEntries.projectId,
      goalId: timeEntries.goalId,
      projectName: projects.name,
      goalName: goals.name,
      action: timeEntries.action,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(goals, eq(timeEntries.goalId, goals.id))
    .where(and(...conditions))
    .orderBy(desc(timeEntries.startedAt))
    .limit(limit)
    .offset(offset);

    // Get a total count? Usually helpful for pagination
    // const countResult = await db.select({ count: count() }).from(timeEntries).where(and(...conditions));
    // const total = countResult[0].count;

    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode || 500;
    return NextResponse.json({ error: (error as Error).message || "Internal Server Error" }, { status });
  }
}

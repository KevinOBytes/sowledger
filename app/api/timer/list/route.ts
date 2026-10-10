import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projects, goals } from "@/lib/db/schema";
import { eq, desc, and, count, gte, lte, isNotNull } from "drizzle-orm";
import { workflowErrorResponse } from "@/lib/workflow-validation";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Allow any workspace member
    requireRole("member", session.role);

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const statusParam = searchParams.get("status");

    const limit = limitParam ? Number(limitParam) : 50;
    const offset = offsetParam ? Number(offsetParam) : 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) return NextResponse.json({ error: "Invalid page size or offset." }, { status: 400 });

    const conditions = [
      eq(timeEntries.workspaceId, session.workspaceId),
      eq(timeEntries.userId, session.sub)
    ];

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))) || (from && to && new Date(from) > new Date(to))) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
    if (from) conditions.push(gte(timeEntries.startedAt, new Date(from)));
    if (to) conditions.push(lte(timeEntries.startedAt, new Date(to)));
    if (statusParam === "rejected") {
      conditions.push(eq(timeEntries.status, "draft"), isNotNull(timeEntries.rejectionReason));
    } else if (statusParam && statusParam !== "all") {
      if (!["draft", "submitted", "approved", "invoiced"].includes(statusParam)) {
         return NextResponse.json({ error: "Invalid status parameter" }, { status: 400 });
      }
      conditions.push(eq(timeEntries.status, statusParam as "draft" | "submitted" | "approved" | "invoiced"));
    }

    const entries = await db.select({
      id: timeEntries.id,
      scheduledBlockId: timeEntries.scheduledBlockId,
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
      rejectionReason: timeEntries.rejectionReason,
    })
    .from(timeEntries)
    .leftJoin(projects, and(eq(timeEntries.projectId, projects.id), eq(projects.workspaceId, session.workspaceId)))
    .leftJoin(goals, and(eq(timeEntries.goalId, goals.id), eq(goals.workspaceId, session.workspaceId)))
    .where(and(...conditions))
    .orderBy(desc(timeEntries.startedAt), desc(timeEntries.id))
    .limit(limit)
    .offset(offset);

    const [result] = await db.select({ total: count() }).from(timeEntries).where(and(...conditions));
    const total = result?.total ?? 0;
    return NextResponse.json({ ok: true, entries, total, limit, offset, hasMore: offset + entries.length < total });
  } catch (error) {
    return workflowErrorResponse(error, "Could not load time entries. Please try again.");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, users, projects } from "@/lib/db/schema";
import { eq, and, notInArray, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Only managers/owners can view approvals
    requireRole("manager", session.role);

    const statusFilter = req.nextUrl.searchParams.get("status");

    let condition = eq(timeEntries.workspaceId, session.workspaceId);
    if (statusFilter !== "all") {
      condition = and(condition, notInArray(timeEntries.status, ["approved", "invoiced"]))!;
    }

    const pendingEntriesData = await db.select().from(timeEntries)
      .where(condition)
      .orderBy(desc(timeEntries.startedAt));

    const workspaceUsers = await db.select().from(users); 
    const workspaceProjects = await db.select().from(projects).where(eq(projects.workspaceId, session.workspaceId));

    const pendingEntries = pendingEntriesData.map((e) => {
        const user = workspaceUsers.find(u => u.id === e.userId);
        const project = e.projectId ? workspaceProjects.find(p => p.id === e.projectId) : null;
        return {
          ...e,
          userEmail: user?.email || "Unknown User",
          projectName: project?.name || "No Project",
        };
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return NextResponse.json({ ok: true, entries: pendingEntries });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberships, timeEntries, users, projects } from "@/lib/db/schema";
import { eq, and, desc, inArray, or, isNotNull } from "drizzle-orm";
import { workflowErrorResponse } from "@/lib/workflow-validation";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Only managers/owners can view approvals
    requireRole("manager", session.role);

    const statusFilter = req.nextUrl.searchParams.get("status");

    let condition = eq(timeEntries.workspaceId, session.workspaceId);
    if (statusFilter === "pending") {
      condition = and(condition, eq(timeEntries.status, "submitted"))!;
    } else {
      condition = and(condition, or(inArray(timeEntries.status, ["submitted", "approved", "invoiced"]), and(eq(timeEntries.status, "draft"), isNotNull(timeEntries.rejectionReason))))!;
    }

    const pendingEntriesData = await db.select().from(timeEntries)
      .where(condition)
      .orderBy(desc(timeEntries.startedAt));

    const workspaceMemberships = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.workspaceId, session.workspaceId));
    const workspaceUserIds = workspaceMemberships.map((membership) => membership.userId);
    const workspaceUsers = workspaceUserIds.length > 0 ? await db.select().from(users).where(inArray(users.id, workspaceUserIds)) : [];
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
    return workflowErrorResponse(error, "Could not load approvals. Please try again.");
  }
}

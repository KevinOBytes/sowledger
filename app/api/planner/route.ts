import { workflowErrorResponse } from "@/lib/workflow-validation";
import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectTasks, goals } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { listWorkspacePeopleDirectory } from "@/lib/people-directory";
import { eq, ne, and } from "drizzle-orm";

export async function GET() {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    // Allow any member to view the planner
    requireRole("member", session.role);

    const workspaceId = session.workspaceId;
    const directory = await listWorkspacePeopleDirectory(workspaceId);

    const tasks = await db.select().from(projectTasks).where(
      and(
        eq(projectTasks.workspaceId, workspaceId),
        ne(projectTasks.status, "done")
      )
    );

    const workspaceGoals = await db.select().from(goals).where(
      and(
        eq(goals.workspaceId, workspaceId),
        eq(goals.completed, false)
      )
    );

    return NextResponse.json({
      ok: true,
      people: directory.people,
      organizations: directory.organizations,
      tasks,
      goals: workspaceGoals,
    });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your plan. Please try again.", { route: "/api/planner", method: "GET" });
  }
}

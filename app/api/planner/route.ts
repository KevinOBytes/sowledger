import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectTasks, goals } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { listWorkspacePeopleDirectory } from "@/lib/people-directory";
import { eq, ne, and } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    // Allow any member to view the planner
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

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
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

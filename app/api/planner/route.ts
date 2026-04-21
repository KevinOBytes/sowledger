import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberships, users, projectTasks, goals } from "@/lib/db/schema";
import { eq, ne, and } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    // Allow any member to view the planner
    requireRole("member", session.role);

    const workspaceId = session.workspaceId;

    const workspaceMemberships = await db.select().from(memberships).where(eq(memberships.workspaceId, workspaceId));
    const allUsers = await db.select().from(users);
    
    const memberIds = workspaceMemberships.map((m) => m.userId);

    const members = memberIds.map((id) => {
      const u = allUsers.find(user => user.id === id);
      return {
        id,
        email: u?.email ?? "Unknown",
        displayName: u?.displayName ?? null,
      };
    });

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

    return NextResponse.json({ ok: true, members, tasks, goals: workspaceGoals });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

import { workflowErrorResponse } from "@/lib/workflow-validation";
import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projectTasks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const entries = await db.select().from(timeEntries).where(and(
      eq(timeEntries.workspaceId, session.workspaceId),
      session.role === "member" ? eq(timeEntries.userId, session.sub) : undefined,
    ));
    const tasks = await db.select().from(projectTasks).where(eq(projectTasks.workspaceId, session.workspaceId));

    return NextResponse.json({ ok: true, entries, tasks });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your calendar. Please try again.", { route: "/api/calendar", method: "GET" });
  }
}

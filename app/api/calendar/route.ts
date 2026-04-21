import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projectTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, session.workspaceId));
    const tasks = await db.select().from(projectTasks).where(eq(projectTasks.workspaceId, session.workspaceId));

    return NextResponse.json({ ok: true, entries, tasks });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, users, timeEntries } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const projectId = req.nextUrl.searchParams.get("projectId");

    const baseQuery = db.select({
      id: auditLogs.id,
      eventType: auditLogs.eventType,
      diff: auditLogs.diff,
      createdAt: auditLogs.createdAt,
      actorUserId: auditLogs.actorUserId,
      actorDisplayName: users.displayName,
      actorEmail: users.email,
      targetEntryId: auditLogs.timeEntryId,
      targetDescription: timeEntries.description
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(timeEntries, eq(timeEntries.id, auditLogs.timeEntryId));

    const condition = projectId 
      ? and(eq(auditLogs.workspaceId, session.workspaceId), eq(timeEntries.projectId, projectId))
      : eq(auditLogs.workspaceId, session.workspaceId);

    const results = await baseQuery.where(condition).orderBy(desc(auditLogs.createdAt)).limit(50);

    const activities = results.map(row => ({
      id: row.id,
      eventType: row.eventType,
      diff: row.diff,
      createdAt: row.createdAt,
      actor: {
        name: row.actorDisplayName || row.actorEmail || "Unknown User",
        id: row.actorUserId,
      },
      target: {
        id: row.targetEntryId,
        description: row.targetDescription || "a time entry",
      }
    }));

    return NextResponse.json({ ok: true, activities });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

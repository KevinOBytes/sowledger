import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, users, timeEntries } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { workflowErrorResponse } from "@/lib/workflow-validation";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Audit diffs can contain complete invoice proof snapshots. Client access
    // stays on the entitlement-checked client endpoints, not this team feed.
    requireRole("member", session.role);
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
    .leftJoin(timeEntries, and(eq(timeEntries.id, auditLogs.timeEntryId), eq(timeEntries.workspaceId, session.workspaceId)));

    // Ownership follows the target entry, not the actor who made a change.
    // The WHERE owner predicate also excludes audits without a scoped entry.
    const condition = and(
      eq(auditLogs.workspaceId, session.workspaceId),
      session.role === "member" ? eq(timeEntries.userId, session.sub) : undefined,
      projectId ? eq(timeEntries.projectId, projectId) : undefined,
    );

    const results = await baseQuery.where(condition).orderBy(desc(auditLogs.createdAt)).limit(50);

    const activities = results.map(row => ({
      id: row.id,
      eventType: row.eventType,
      diff: session.role === "member" ? {} : row.diff,
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
    return workflowErrorResponse(error, "Could not load activity. Please try again.");
  }
}

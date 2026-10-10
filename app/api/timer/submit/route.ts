import { NextRequest, NextResponse, after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { appendAuditLog, dispatchWebhook, ensurePeriodUnlocked } from "@/lib/security";
import { entryIdsFrom, WorkflowError, workflowErrorResponse } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const body = await req.json();
    const entryIds = entryIdsFrom(body?.entryIds);
    const canManage = session.role === "manager" || session.role === "owner";
    const events = await db.transaction(async (tx) => {
      const entries = await tx.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, session.workspaceId), inArray(timeEntries.id, entryIds))).orderBy(timeEntries.id).for("update");
      if (entries.length !== entryIds.length) throw new WorkflowError("One or more entries were not found.", 404);
      for (const entry of entries) {
        if (!canManage && entry.userId !== session.sub) throw new WorkflowError("You can only submit your own time.", 403);
        if (entry.status !== "draft" || !entry.stoppedAt || entry.durationSeconds === null || entry.durationSeconds <= 0) {
          throw new WorkflowError("Only completed draft or sent-back entries with recorded time can be submitted.", 409);
        }
        try { await ensurePeriodUnlocked(session.workspaceId, entry.startedAt, entry.stoppedAt); }
        catch { throw new WorkflowError("One or more entries are in a locked period.", 409); }
      }
      await tx.update(timeEntries).set({ status: "submitted", rejectionReason: null }).where(and(eq(timeEntries.workspaceId, session.workspaceId), inArray(timeEntries.id, entryIds), eq(timeEntries.status, "draft")));
      const events = [];
      for (const entry of entries) {
        const event = {
          workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub,
          eventType: entry.rejectionReason ? "entry_resubmitted" : "entry_submitted",
          diff: { status: { before: "draft", after: "submitted" }, rejectionReason: { before: entry.rejectionReason, after: null } },
        };
        await appendAuditLog(event, tx);
        events.push(event);
      }
      return events;
    });
    after(async () => { for (const event of events) await dispatchWebhook(session.workspaceId, event.eventType, event.diff); });
    return NextResponse.json({ ok: true, submitted: entryIds.length });
  } catch (error) { return workflowErrorResponse(error, "Could not submit time. Please try again."); }
}

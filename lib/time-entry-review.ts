import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { appendAuditLog, dispatchWebhook } from "@/lib/security";
import { WorkflowError } from "@/lib/workflow-validation";

export async function reviewTimeEntry(input: { workspaceId: string; actorUserId: string; entryId: string; decision: "approved" | "rejected"; reason?: string }) {
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, input.entryId), eq(timeEntries.workspaceId, input.workspaceId))).for("update");
    if (!entry) throw new WorkflowError("Time entry not found.", 404);
    if (!entry.stoppedAt || entry.status !== "submitted") throw new WorkflowError("Only completed, submitted time can be approved or sent back.", 409);
    if (input.decision === "approved" && (!entry.durationSeconds || entry.durationSeconds < 0)) throw new WorkflowError("Time must have a positive duration before approval.", 409);
    const status = input.decision === "approved" ? "approved" : "draft";
    const rejectionReason = input.decision === "rejected" ? input.reason?.trim() || "Please review this entry before resubmitting." : null;
    await tx.update(timeEntries).set({ status, rejectionReason }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, input.workspaceId), eq(timeEntries.status, "submitted")));
    const event = {
      workspaceId: input.workspaceId, timeEntryId: entry.id, actorUserId: input.actorUserId,
      eventType: input.decision === "approved" ? "entry_approved" : "entry_rejected",
      diff: { status: { before: entry.status, after: status }, rejectionReason: { before: entry.rejectionReason, after: rejectionReason } },
    };
    await appendAuditLog(event, tx);
    return { status, rejectionReason, event };
  });
  after(async () => { await dispatchWebhook(input.workspaceId, result.event.eventType, result.event.diff); });
  return { ok: true, entryId: input.entryId, status: result.status, rejectionReason: result.rejectionReason };
}

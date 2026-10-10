import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, dispatchWebhook } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries, lockPeriods } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { WorkflowError, workflowErrorResponse } from "@/lib/workflow-validation";

/** Legacy entry-only invoicing marker. Creating an invoice uses /api/invoices. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await req.json() as { entryId?: string; reason?: string };
    if (typeof body?.entryId !== "string" || !body.entryId || body.entryId.length > 255 || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 2000))) throw new WorkflowError("Choose a time entry and a valid reason.", 400);
    const diff = await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, body.entryId!), eq(timeEntries.workspaceId, session.workspaceId))).for("update");
      if (!entry) throw new WorkflowError("Time entry not found.", 404);
      if (!entry.stoppedAt || entry.status !== "approved") throw new WorkflowError("Only completed, approved time can be marked as invoiced.", 409);
      await tx.update(timeEntries).set({ status: "invoiced" }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.status, "approved")));
      await tx.insert(lockPeriods).values({ id: crypto.randomUUID(), workspaceId: session.workspaceId, periodStart: entry.startedAt, periodEnd: entry.stoppedAt, reason: body.reason || "Invoiced period", lockedByUserId: session.sub });
      const diff = { status: { before: "approved", after: "invoiced" } };
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub, eventType: "entry_invoiced", diff }, tx);
      return diff;
    });
    after(async () => { await dispatchWebhook(session.workspaceId, "entry_invoiced", diff); });
    return NextResponse.json({ ok: true, entryId: body.entryId, status: "invoiced" });
  } catch (error) { return workflowErrorResponse(error, "Could not mark this entry as invoiced. Please try again."); }
}

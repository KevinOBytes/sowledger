import { NextRequest, NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { appendAuditLog, dispatchWebhook } from "@/lib/security";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { duplicateInvoiceConflict, hasDuplicateInvoiceLinks } from "@/lib/invoice-client-state";
import { exposeInvoice, lockInvoiceLifecycle } from "@/lib/invoice-lifecycle";

export async function PATCH(req: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { invoiceId } = await context.params;
    const body = await readRequestJson(req);
    if (body?.status !== "sent" && body?.status !== "paid") throw new WorkflowError("Choose sent or paid as the next invoice status.", 400);
    const status = body.status as "sent" | "paid";
    const previous = status === "sent" ? "draft" : "sent";
    const invoice = await db.transaction(async (tx) => {
      await lockInvoiceLifecycle(tx, session.workspaceId);
      const [existing] = await tx.select().from(invoices).where(and(eq(invoices.workspaceId, session.workspaceId), eq(invoices.id, invoiceId))).for("update");
      if (!existing) throw new WorkflowError("Invoice not found.", 404);
      if (hasDuplicateInvoiceLinks(existing.timeEntryIds)) throw new WorkflowError(duplicateInvoiceConflict, 409);
      if (existing.status !== previous) throw new WorkflowError(status === "sent" ? "Only draft invoices can be marked as sent." : "Mark the invoice as sent before recording payment.", 409);
      await exposeInvoice(tx, session.workspaceId, invoiceId, session.sub, `Invoice marked ${status}`);
      const [updated] = await tx.update(invoices).set({ status }).where(and(eq(invoices.workspaceId, session.workspaceId), eq(invoices.id, invoiceId), eq(invoices.status, previous))).returning();
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: invoiceId, actorUserId: session.sub, eventType: "invoice_status_changed", diff: { status: { before: previous, after: status }, recordedAt: { before: null, after: new Date().toISOString() } } }, tx);
      return updated;
    });
    after(async () => { await dispatchWebhook(session.workspaceId, `invoice.${status}`, { invoiceId, number: invoice.number, status, amount: invoice.amount }); });
    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    return workflowErrorResponse(error, "Could not update this invoice. Please try again.", { route: "/api/invoices/[invoiceId]", method: "PATCH" });
  }
}

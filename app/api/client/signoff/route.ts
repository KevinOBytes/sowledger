import { NextRequest, NextResponse, after } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireRole, requireSession } from "@/lib/auth";
import { getClientEntitlementIds, isInvoiceClientEntitled } from "@/lib/client-entitlements";
import { db } from "@/lib/db";
import { auditLogs, invoices } from "@/lib/db/schema";
import { appendAuditLog, dispatchWebhook } from "@/lib/security";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { invoiceApprovalFromDiff } from "@/lib/invoice-approval";
import { WorkflowError, workflowErrorResponse } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("client", session.role);
    const body = await req.json() as { invoiceId?: string; digest?: string };
    if (typeof body?.invoiceId !== "string" || !body.invoiceId || body.invoiceId.length > 255 || typeof body.digest !== "string" || !/^[a-f0-9]{64}$/.test(body.digest)) throw new WorkflowError("Open the invoice details before approving this version.", 400);
    const invoiceId = body.invoiceId;
    const clientIds = await getClientEntitlementIds(session);
    if (!(await isInvoiceClientEntitled(session.workspaceId, invoiceId, clientIds))) throw new WorkflowError("Invoice not found.", 404);

    const approval = await db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, session.workspaceId))).for("update");
      if (!invoice || invoice.status === "draft") throw new WorkflowError("Invoice not found.", 404);
      const proof = await buildInvoiceProofPack(session.workspaceId, invoice.id, tx);
      if (!proof || proof.digest !== body.digest) throw new WorkflowError("The invoice details changed. Open the latest version and review it before approving.", 409);
      const prior = await tx.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, session.workspaceId), eq(auditLogs.timeEntryId, invoice.id), eq(auditLogs.eventType, "client_invoice_signed_off"))).orderBy(desc(auditLogs.createdAt));
      const existing = prior.map((row) => invoiceApprovalFromDiff(row.diff)).find((value) => value?.digest === proof.digest);
      if (existing) return { ...existing, alreadyApproved: true, diff: null };

      const snapshot = { invoiceId: invoice.id, invoiceNumber: invoice.number, amount: invoice.amount, status: invoice.status, signedOffAt: new Date().toISOString(), digest: proof.digest, snapshot: proof.proofPack };
      const diff = { clientSignoff: { before: null, after: snapshot } };
      await appendAuditLog({
        workspaceId: session.workspaceId, timeEntryId: invoice.id, actorUserId: session.sub, eventType: "client_invoice_signed_off",
        diff,
      }, tx);
      return { ...snapshot, alreadyApproved: false, diff };
    }, { isolationLevel: "repeatable read" });

    if (!approval.alreadyApproved) after(async () => {
      await dispatchWebhook(session.workspaceId, "client_invoice_signed_off", approval.diff);
    });
    return NextResponse.json({ ok: true, signoff: { invoiceId, invoiceNumber: approval.invoiceNumber, signedOffAt: approval.signedOffAt, digest: approval.digest } });
  } catch (error) { return workflowErrorResponse(error, "Could not approve this invoice. Please try again."); }
}

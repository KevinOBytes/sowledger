import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { getClientEntitlementIds, isInvoiceClientEntitled } from "@/lib/client-entitlements";
import { db } from "@/lib/db";
import { auditLogs, invoices } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { invoiceApprovalFromDiff } from "@/lib/invoice-approval";
import { workflowErrorResponse } from "@/lib/workflow-validation";
import { exposeInvoice, lockInvoiceLifecycle } from "@/lib/invoice-lifecycle";

type Ctx = { params: Promise<{ invoiceId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    requireRole("client", session.role);
    // Full documents can include coworkers' detail and historical signed
    // snapshots. Deny members before loading either current or saved evidence.
    if (session.role !== "client") requireRole("manager", session.role);
    const { invoiceId } = await ctx.params;
    if (session.role === "client" && !(await isInvoiceClientEntitled(session.workspaceId, invoiceId, await getClientEntitlementIds(session)))) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const snapshot = await db.transaction(async tx => {
      await lockInvoiceLifecycle(tx, session.workspaceId);
      if (session.role === "client") {
        const [invoice] = await tx.select({ status: invoices.status }).from(invoices).where(and(eq(invoices.workspaceId, session.workspaceId), eq(invoices.id, invoiceId)));
        if (!invoice || !["sent", "paid"].includes(invoice.status)) return null;
      }
      const proof = await buildInvoiceProofPack(session.workspaceId, invoiceId, tx);
      if (!proof || (session.role === "client" && !["sent", "paid"].includes(proof.proofPack.invoice.status))) return null;
      const signoffs = await tx.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, session.workspaceId), eq(auditLogs.timeEntryId, invoiceId), eq(auditLogs.eventType, "client_invoice_signed_off"))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
      await exposeInvoice(tx, session.workspaceId, invoiceId, session.sub, "Full invoice proof or print");
      return { proof, signoffs };
    }, { isolationLevel: "repeatable read" });
    let result = snapshot?.proof;
    if (!result || (session.role === "client" && result.proofPack.invoice.status !== "sent" && result.proofPack.invoice.status !== "paid")) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const approval = snapshot!.signoffs.map((event) => invoiceApprovalFromDiff(event.diff)).find((value) => value !== null);
    const approvalCurrent = approval?.digest === result.digest;
    if (req.nextUrl.searchParams.get("approved") === "true") {
      if (!approval) return NextResponse.json({ error: "No reviewed version has been approved yet." }, { status: 404 });
      result = { proofPack: approval.snapshot, digest: approval.digest };
    }
    return NextResponse.json(
      { ok: true, proofPack: result.proofPack, digest: result.digest, approval: approval ? { digest: approval.digest, signedOffAt: approval.signedOffAt, current: approvalCurrent } : null },
      { headers: { "x-sowledger-proof-sha256": result.digest, "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return workflowErrorResponse(error, "Could not load invoice details. Please try again.");
  }
}

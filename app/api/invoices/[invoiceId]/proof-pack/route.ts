import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { getClientEntitlementIds, isInvoiceClientEntitled } from "@/lib/client-entitlements";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { invoiceApprovalFromDiff } from "@/lib/invoice-approval";
import { workflowErrorResponse } from "@/lib/workflow-validation";

type Ctx = { params: Promise<{ invoiceId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    requireRole("client", session.role);
    const { invoiceId } = await ctx.params;
    if (session.role === "client" && !(await isInvoiceClientEntitled(session.workspaceId, invoiceId, await getClientEntitlementIds(session)))) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    let result = await db.transaction((tx) => buildInvoiceProofPack(session.workspaceId, invoiceId, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
    if (!result || (session.role === "client" && result.proofPack.invoice.status === "draft")) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const signoffs = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, session.workspaceId), eq(auditLogs.timeEntryId, invoiceId), eq(auditLogs.eventType, "client_invoice_signed_off"))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
    const approval = signoffs.map((event) => invoiceApprovalFromDiff(event.diff)).find((value) => value !== null);
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

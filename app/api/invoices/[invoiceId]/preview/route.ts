import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

/** Internal manager review only. Not a print/export/public API capability. */
export async function GET(_req: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { invoiceId } = await context.params;
    const result = await db.transaction(async tx => {
      const proof = await buildInvoiceProofPack(session.workspaceId, invoiceId, tx);
      if (!proof) throw new WorkflowError("Invoice not found.", 404);
      if (proof.proofPack.invoice.status !== "draft") throw new WorkflowError("Only draft invoices can be reviewed here. Use the full proof export for sent or paid invoices.", 409);
      return proof;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store", "x-sowledger-proof-sha256": result.digest } });
  } catch (error) {
    return workflowErrorResponse(error, "Could not review this draft. Please refresh invoices.");
  }
}

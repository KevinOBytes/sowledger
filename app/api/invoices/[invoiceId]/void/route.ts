import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { parseInvoiceVoidRequest, voidDraftInvoice } from "@/lib/invoice-lifecycle";
import { readRequestJson, workflowErrorResponse } from "@/lib/workflow-validation";

export async function POST(req: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { invoiceId } = await context.params;
    const { reason } = parseInvoiceVoidRequest(await readRequestJson(req));
    const result = await voidDraftInvoice({ workspaceId: session.workspaceId, actorUserId: session.sub, invoiceId, reason });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the invoice was voided. Refresh invoices before trying again.", { route: "/api/invoices/[invoiceId]/void", method: "POST" });
  }
}

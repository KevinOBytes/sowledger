import { NextRequest, NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { pushInvoiceToQuickBooks } from "@/lib/integrations/quickbooks";
import { WorkflowError, readRequestJson } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await readRequestJson(req) as { invoiceId?: string; customerRefId?: string | null; serviceItemRefId?: string | null };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    if (!body.invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
    const result = await pushInvoiceToQuickBooks({
      workspaceId: session.workspaceId,
      invoiceId: body.invoiceId,
      customerRefId: body.customerRefId,
      serviceItemRefId: body.serviceItemRefId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't confirm the invoice push. Check QuickBooks and your integrations before trying again.", { route: "/api/integrations/quickbooks/push-invoice", method: "POST" });
  }
}

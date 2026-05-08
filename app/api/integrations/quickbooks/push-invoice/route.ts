import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { pushInvoiceToQuickBooks } from "@/lib/integrations/quickbooks";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await req.json() as { invoiceId?: string; customerRefId?: string | null; serviceItemRefId?: string | null };
    if (!body.invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
    const result = await pushInvoiceToQuickBooks({
      workspaceId: session.workspaceId,
      invoiceId: body.invoiceId,
      customerRefId: body.customerRefId,
      serviceItemRefId: body.serviceItemRefId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, requireSession } from "@/lib/auth";
import { getClientEntitlementIds, isInvoiceClientEntitled } from "@/lib/client-entitlements";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { appendAuditLog } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("client", session.role);
    const body = await req.json().catch(() => ({})) as { invoiceId?: string };
    if (!body.invoiceId || typeof body.invoiceId !== "string") {
      return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
    }

    const [invoice] = await db
      .select({ id: invoices.id, number: invoices.number, amount: invoices.amount, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.id, body.invoiceId), eq(invoices.workspaceId, session.workspaceId)));

    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const clientIds = await getClientEntitlementIds(session);
    if (!(await isInvoiceClientEntitled(session.workspaceId, invoice.id, clientIds))) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const signedOffAt = new Date().toISOString();
    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: invoice.id,
      actorUserId: session.sub,
      eventType: "client_invoice_signed_off",
      diff: {
        clientSignoff: {
          before: null,
          after: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amount: invoice.amount,
            status: invoice.status,
            signedOffAt,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      signoff: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        signedOffAt,
      },
    });
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 403;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

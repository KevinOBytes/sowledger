import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";

type Ctx = { params: Promise<{ invoiceId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const { invoiceId } = await ctx.params;
    const result = await buildInvoiceProofPack(session.workspaceId, invoiceId);
    if (!result) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    return NextResponse.json(
      { ok: true, proofPack: result.proofPack, digest: result.digest },
      { headers: { "x-billabled-proof-sha256": result.digest } },
    );
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 403;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

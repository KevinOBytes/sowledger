import { NextRequest, NextResponse } from "next/server";
import { GET as getProof } from "../proof-pack/route";
import { renderInvoicePrint } from "@/lib/invoice-print";
import type { InvoiceProofPackResult } from "@/lib/invoice-proof-pack";

export async function GET(req: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const response = await getProof(req, context);
  if (!response.ok) return response;
  const result = await response.json() as InvoiceProofPackResult;
  return new NextResponse(renderInvoicePrint(result.proofPack, result.digest), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "x-sowledger-proof-sha256": result.digest, "X-Content-Type-Options": "nosniff" },
  });
}

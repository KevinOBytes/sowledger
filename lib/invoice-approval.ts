import type { InvoiceProofPack } from "@/lib/invoice-proof-pack";

export type InvoiceApproval = {
  invoiceId: string; invoiceNumber: string; signedOffAt: string;
  digest: string; snapshot: InvoiceProofPack;
};

/** Legacy signoffs without a reviewed snapshot are not treated as proof approval. */
export function invoiceApprovalFromDiff(diff: unknown): InvoiceApproval | null {
  if (!diff || typeof diff !== "object") return null;
  const value = (diff as { clientSignoff?: { after?: unknown } }).clientSignoff?.after;
  if (!value || typeof value !== "object") return null;
  const approval = value as Partial<InvoiceApproval>;
  if (typeof approval.invoiceId !== "string" || typeof approval.invoiceNumber !== "string" || typeof approval.signedOffAt !== "string" || typeof approval.digest !== "string" || !/^[a-f0-9]{64}$/.test(approval.digest) || !approval.snapshot?.invoice || approval.snapshot.invoice.id !== approval.invoiceId) return null;
  return approval as InvoiceApproval;
}

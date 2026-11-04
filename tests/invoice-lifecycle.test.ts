import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceHistoryCents, readInvoiceList, type InvoiceRecord } from "../lib/invoice-client-state";
import { appendAuditLog } from "../lib/security";

// Removing the void exclusion would double count a corrected and rebilled $125 invoice.
test("active history value excludes void but retains its visible history record", () => {
  const rows = [{ amount: 125, status: "void" }, { amount: 125, status: "draft" }, { amount: 10.25, status: "paid" }] as InvoiceRecord[];
  assert.equal(invoiceHistoryCents(rows), 13525);
  assert.equal(rows.length, 3);
});

// The import is deferred so RED is an assertion about the missing contract,
// not a module-resolution crash that hides the accounting regression above.
const lifecycle = import("../lib/invoice-lifecycle").catch(() => null);
const invoice = { id: "i", workspaceId: "w", number: "INV-1", projectId: null, amount: 125, timeEntryIds: ["a", "b"], status: "draft" as const, dueDate: null, createdAt: new Date("2026-10-31T12:00:00Z") };
test("invoice DTO rejects malformed advisory eligibility rather than enabling actions from truthy data", () => {
  const row = { ...invoice, createdAt: invoice.createdAt.toISOString(), billingAudience: "internal", clientId: null, clientName: null };
  for (const voidEligibility of [true, { eligible: "true", reason: null }, { eligible: true, reason: "blocked" }, { eligible: false, reason: null }]) assert.throws(() => readInvoiceList({ ok: true, workspaceId: "w", canManage: true, invoices: [{ ...row, voidEligibility }], billableEntries: [] }));
});
test("release request requires literal true, rejects extra keys and bounds reason", async () => {
  const m = await lifecycle; assert.ok(m, "invoice lifecycle contract must exist");
  for (const value of [null, [], {}, { confirmNotBilledElsewhere: false }, { confirmNotBilledElsewhere: "true" }, { confirmNotBilledElsewhere: true, other: true }, { confirmNotBilledElsewhere: true, reason: 7 }, { confirmNotBilledElsewhere: true, reason: "x".repeat(501) }]) assert.throws(() => m.parseInvoiceVoidRequest(value));
  assert.deepEqual(m.parseInvoiceVoidRequest({ confirmNotBilledElsewhere: true }), { reason: "" });
  assert.deepEqual(m.parseInvoiceVoidRequest({ confirmNotBilledElsewhere: true, reason: "  Incorrect selection  " }), { reason: "Incorrect selection" });
});
test("immutable financial fingerprint covers identity, exact original order and money, not lifecycle status", async () => {
  const m = await lifecycle; assert.ok(m, "invoice lifecycle contract must exist");
  const fingerprint = m.invoiceFingerprint(invoice);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(m.invoiceFingerprint({ ...invoice, status: "void" }), fingerprint);
  for (const change of [{ amount: 126 }, { id: "j" }, { workspaceId: "other" }, { number: "INV-2" }, { projectId: "p" }, { timeEntryIds: ["b", "a"] }, { dueDate: new Date("2026-11-01Z") }, { createdAt: new Date("2026-10-30Z") }]) assert.notEqual(m.invoiceFingerprint({ ...invoice, ...change }), fingerprint);
});
test("release verification is complete, signed, workspace bound and insensitive to JSONB object key order", async () => {
  const m = await lifecycle; assert.ok(m, "invoice lifecycle contract must exist");
  const saved = { invoiceId: "i", workspaceId: "w", originalTimeEntryIds: ["a", "b"], invoiceFingerprint: m.invoiceFingerprint(invoice), createdBy: "owner", createdAt: invoice.createdAt, exposedAt: null, exposureReason: null, voidedAt: new Date("2026-10-31T12:01:00Z"), voidedBy: "owner", voidReason: "mistake", releaseAuditId: "release" };
  const diff = m.invoiceReleaseDiff(saved);
  let signature = "";
  // Capture the production signer's output without reading any environment value.
  const capture = { insert: () => ({ values: async (value: { signature: string }) => { signature = value.signature; } }) } as unknown as NonNullable<Parameters<typeof appendAuditLog>[1]>;
  await appendAuditLog({ workspaceId: "w", timeEntryId: "i", actorUserId: "owner", eventType: "invoice_voided", diff }, capture);
  const audit = { id: "release", workspaceId: "w", timeEntryId: "i", actorUserId: "owner", eventType: "invoice_voided", signature, diff: JSON.parse(JSON.stringify(diff)), createdAt: saved.voidedAt };
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)])) : value;
  assert.equal(m.verifiedInvoiceRelease({ ...invoice, status: "void" }, saved, { ...audit, diff: reorder(audit.diff) } as typeof audit), true);
  for (const change of [{ status: "draft" }, { amount: 126 }, { timeEntryIds: ["a", "a"] }, { workspaceId: "foreign" }]) assert.equal(m.verifiedInvoiceRelease({ ...invoice, status: "void", ...change }, saved, audit), false);
  for (const change of [{ releaseAuditId: null }, { voidedAt: null }, { voidedBy: null }, { voidReason: null }, { originalTimeEntryIds: ["b", "a"] }, { invoiceFingerprint: "0".repeat(64) }, { exposedAt: new Date() }]) assert.equal(m.verifiedInvoiceRelease({ ...invoice, status: "void" }, { ...saved, ...change }, audit), false);
  for (const change of [{ signature: "0".repeat(64) }, { actorUserId: "other" }, { workspaceId: "foreign" }, { diff: {} }]) assert.equal(m.verifiedInvoiceRelease({ ...invoice, status: "void" }, saved, { ...audit, ...change }), false);
});

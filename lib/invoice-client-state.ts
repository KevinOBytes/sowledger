// Browser-safe DTO and selection checks. No database/service imports belong here.
import { displayAmountCents, sumDisplayCents } from "@/lib/invoice-amount";

export type InvoiceRecord = { id: string; workspaceId: string; number: string; projectName?: string; amount: number; status: string; dueDate: string | null; createdAt: string; timeEntryIds: string[]; billingAudience: "client" | "internal" | "unknown"; clientId: string | null; clientName: string | null; amountCents?: number };
export type InvoiceHistoryRecord = InvoiceRecord & { historyIssue?: "duplicate-linked-ids"; voidEligibility?: { eligible: boolean; reason: string | null } };
export type BillableEntry = { id: string; workspaceId: string; userEmail: string; projectName: string; description: string | null; startedAt: string; durationSeconds: number | null; hourlyRate: number | null; amount: number | null; amountCents: number | null; clientId: string | null; clientName: string | null; billingAudience: "client" | "internal" | null; eligible: boolean; ineligibleReason: string | null };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableNumber = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);
const cents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
// Inspect persisted links, never a wire-provided history issue. Shared guards
// depend only on this browser-safe module and its pure money helpers.
export function hasDuplicateInvoiceLinks(value: unknown) { return Array.isArray(value) && new Set(value).size !== value.length; }
export const duplicateInvoiceConflict = "Some time entries are listed more than once on this invoice. Ask a workspace manager to review it before changing its status or pushing it to QuickBooks.";

function invoiceRecord(value: unknown, workspaceId: string): value is InvoiceRecord {
  if (!object(value) || !id(value.id) || value.workspaceId !== workspaceId || !text(value.number) || !text(value.status) || typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount < 0 || !instant(value.createdAt) || !(value.dueDate === null || instant(value.dueDate)) || !ids(value.timeEntryIds)) return false;
  if (value.billingAudience === "client") return id(value.clientId) && text(value.clientName);
  return (value.billingAudience === "internal" || value.billingAudience === "unknown") && value.clientId === null && value.clientName === null;
}

function billableRecord(value: unknown, workspaceId: string): value is BillableEntry {
  if (!object(value) || !id(value.id) || value.workspaceId !== workspaceId || !text(value.userEmail) || !text(value.projectName) || !(value.description === null || typeof value.description === "string") || !instant(value.startedAt) || !nullableNumber(value.durationSeconds) || !nullableNumber(value.hourlyRate)) return false;
  if (value.eligible === false) return value.amountCents === null && value.amount === null && text(value.ineligibleReason) && value.billingAudience === null && value.clientId === null && value.clientName === null;
  if (value.eligible !== true || value.ineligibleReason !== null || !cents(value.amountCents) || value.amount !== value.amountCents / 100 || typeof value.durationSeconds !== "number" || value.durationSeconds <= 0 || typeof value.hourlyRate !== "number" || value.hourlyRate < 0) return false;
  return value.billingAudience === "client" ? id(value.clientId) && text(value.clientName) : value.billingAudience === "internal" && value.clientId === null && value.clientName === null;
}

export function readInvoiceList(value: unknown) {
  if (!object(value) || value.ok !== true || !id(value.workspaceId) || typeof value.canManage !== "boolean" || !Array.isArray(value.invoices) || !Array.isArray(value.billableEntries)) throw new Error("Invalid invoice response.");
  const workspaceId = value.workspaceId;
  const invoices = value.invoices.map((invoice): InvoiceHistoryRecord => {
    if (object(invoice) && invoice.voidEligibility !== undefined) {
      const eligibility = invoice.voidEligibility;
      if (!object(eligibility) || !(eligibility.eligible === true && eligibility.reason === null || eligibility.eligible === false && text(eligibility.reason))) throw new Error("Invalid invoice response.");
    }
    // Even healthy wire markers are ignored. Only checked duplicate-only rows
    // with the producer's explicit unknown/null classification get the variant.
    if (invoiceRecord(invoice, workspaceId)) { const clean = { ...invoice } as InvoiceHistoryRecord; delete clean.historyIssue; return clean; }
    if (object(invoice) && invoice.billingAudience === "unknown" && invoice.clientId === null && invoice.clientName === null
      && Array.isArray(invoice.timeEntryIds) && invoice.timeEntryIds.every(id) && hasDuplicateInvoiceLinks(invoice.timeEntryIds)
      && invoiceRecord({ ...invoice, timeEntryIds: [] }, workspaceId)) return { ...invoice, historyIssue: "duplicate-linked-ids" } as InvoiceHistoryRecord;
    throw new Error("Invalid invoice response.");
  });
  if (!value.billableEntries.every(entry => billableRecord(entry, workspaceId)) || new Set(invoices.map(invoice => invoice.id)).size !== invoices.length || new Set(value.billableEntries.map(entry => entry.id)).size !== value.billableEntries.length) throw new Error("Invalid invoice response.");
  return { workspaceId, canManage: value.canManage, invoices, billableEntries: value.billableEntries as BillableEntry[] };
}

export function invoiceGroupKey(entry: BillableEntry) { return entry.billingAudience === "client" ? `client:${entry.clientId}` : "internal"; }
export function reconcileInvoiceSelection(selected: ReadonlySet<string>, entries: readonly BillableEntry[]) {
  const candidates = entries.filter(entry => selected.has(entry.id) && entry.eligible).sort((a, b) => a.id.localeCompare(b.id));
  const group = candidates[0] ? invoiceGroupKey(candidates[0]) : null;
  return new Set(candidates.filter(entry => invoiceGroupKey(entry) === group).slice(0, 100).map(entry => entry.id));
}
export function invoiceSelectionCents(selected: ReadonlySet<string>, entries: readonly BillableEntry[]) {
  const rows = entries.filter(entry => selected.has(entry.id));
  if (rows.length !== selected.size || rows.some(entry => !entry.eligible) || rows.some(entry => invoiceGroupKey(entry) !== invoiceGroupKey(rows[0]))) return null;
  return sumDisplayCents(rows.map(entry => entry.amountCents));
}
export function invoiceHistoryCents(invoices: readonly InvoiceRecord[]) { return sumDisplayCents(invoices.filter(invoice => invoice.status !== "void").map(invoice => displayAmountCents(invoice.amount))); }
export function readCreatedInvoice(value: unknown, expected: { workspaceId: string; ids: string[]; amountCents: number; group: BillableEntry; existingIds: string[] }) {
  if (!object(value) || value.ok !== true || !invoiceRecord(value.invoice, expected.workspaceId)) throw new Error("Unconfirmed invoice response.");
  const invoice = value.invoice;
  if (invoice.status !== "draft" || expected.existingIds.includes(invoice.id) || invoice.amountCents !== expected.amountCents || invoice.amount !== expected.amountCents / 100 || displayAmountCents(invoice.amount) !== expected.amountCents || invoice.timeEntryIds.length !== expected.ids.length || !invoice.timeEntryIds.every(id => expected.ids.includes(id)) || invoice.billingAudience !== expected.group.billingAudience || invoice.clientId !== expected.group.clientId) throw new Error("Unconfirmed invoice response.");
  return invoice;
}

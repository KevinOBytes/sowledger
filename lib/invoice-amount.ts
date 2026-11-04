// Use the same per-line rounding for stored invoices, reviewed details, and print.
export function timeEntryAmountCents(durationSeconds: number, hourlyRate: number) {
  return Math.round((durationSeconds / 3600) * hourlyRate * 100);
}

export function checkedInvoiceCents(entries: readonly { durationSeconds: number | null; hourlyRate: number | null }[]) {
  let total = 0;
  for (const entry of entries) {
    if (entry.durationSeconds === null || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0 || entry.hourlyRate === null || !Number.isFinite(entry.hourlyRate) || entry.hourlyRate < 0) throw new RangeError("Invalid saved invoice line.");
    const line = timeEntryAmountCents(entry.durationSeconds, entry.hourlyRate);
    if (!Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(total + line)) throw new RangeError("Invalid invoice cents.");
    total += line;
  }
  return total;
}

export class InvoiceAmountError extends Error {
  readonly status = 422;
  readonly code = "INVOICE_AMOUNT_NOT_REPRESENTABLE";
  constructor() { super("This total cannot be stored without changing a cent. No invoice was created and your time remains approved. Choose a smaller selection or contact your workspace administrator."); }
}

function decimalCents(text: string) {
  const match = /^(\d+)\.(\d{2})$/.exec(text);
  return match ? BigInt(match[1]) * BigInt(100) + BigInt(match[2]) : null;
}

/** Exact candidate text, not an approximate epsilon or a magnitude threshold. */
export function invoiceAmountCandidate(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new InvoiceAmountError();
  const exact = BigInt(cents);
  const decimal = `${exact / BigInt(100)}.${String(exact % BigInt(100)).padStart(2, "0")}`;
  const dollars = cents / 100;
  if (!Number.isFinite(dollars) || Math.round(dollars * 100) !== cents || decimalCents(dollars.toFixed(2)) !== exact) throw new InvoiceAmountError();
  return { cents, dollars, decimal };
}

/** Use on the actual pg decoder's probe, RETURNING and scoped persisted read. */
export function assertInvoiceAmountReadback(value: unknown, candidate: ReturnType<typeof invoiceAmountCandidate>) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value !== candidate.dollars || Math.round(value * 100) !== candidate.cents || decimalCents(value.toFixed(2)) !== BigInt(candidate.cents)) throw new InvoiceAmountError();
}

/** Legacy display only: do not claim a recovered originally intended amount. */
export function displayAmountCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  try { const candidate = invoiceAmountCandidate(Math.round(value * 100)); assertInvoiceAmountReadback(value, candidate); return candidate.cents; } catch { return null; }
}

export function sumDisplayCents(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value === null || !Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) return null;
    sum += value;
  }
  return sum;
}

export function formatInvoiceCents(value: number | null) {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return "Amount unavailable";
  const cents = BigInt(value);
  return `$${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}

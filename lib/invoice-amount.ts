// Use the same per-line rounding for stored invoices, reviewed details, and print.
export function timeEntryAmountCents(durationSeconds: number, hourlyRate: number) {
  return Math.round((durationSeconds / 3600) * hourlyRate * 100);
}

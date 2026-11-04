/** Calendar dates are not instants. Keep date-only values separate from timezone conversion. */
export class DateInputError extends Error {
  readonly status = 400;
}

function checkedDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DateInputError("Choose a valid calendar date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DateInputError("Choose a valid calendar date.");
  return date;
}

export function localDateKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDateTimeValue(date: Date) {
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Preserve untouched instants, including seconds and the second repeated DST hour. */
export function parseLocalDateTime(value: string, original?: string | Date | null) {
  if (original) {
    const date = new Date(original);
    if (Number.isFinite(date.getTime()) && localDateTimeValue(date) === value) return date;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new DateInputError("Choose a valid date and time.");
  checkedDateKey(value.slice(0, 10));
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateTimeValue(date) !== value) {
    throw new DateInputError("That local time does not exist. Choose another time; the clocks may change on this date.");
  }
  return date;
}

/** Browser controls send explicit instants; end is the next local midnight, including on DST days. */
export function localDateRange(startValue: string, endValue: string) {
  if (startValue) checkedDateKey(startValue);
  if (endValue) checkedDateKey(endValue);
  if (startValue && endValue && endValue < startValue) throw new DateInputError("Choose an end date on or after the start date.");
  const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
  const end = endValue ? new Date(`${endValue}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  return { start: start?.toISOString(), end: end?.toISOString() };
}

function parseInstant(value: unknown, endOfDate = false) {
  if (typeof value !== "string") throw new DateInputError("Choose a valid date or a timestamp with a timezone.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = checkedDateKey(value);
    if (endOfDate) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match || Number(match[2]) > 23) throw new DateInputError("Choose a valid date or a timestamp with a timezone.");
  checkedDateKey(match[1]);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new DateInputError("Choose a valid date or a timestamp with a timezone.");
  return date;
}

/** API compatibility: YYYY-MM-DD remains a UTC day, and date-only ends remain inclusive. */
export function parseDateRange(startValue?: string | null, endValue?: string | null) {
  const start = startValue ? parseInstant(startValue) : null;
  const end = endValue ? parseInstant(endValue, true) : null;
  if (start && end && start >= end) throw new DateInputError("Choose an end date on or after the start date.");
  return { start, end };
}

export function parseDueDate(value: unknown): Date | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  return parseInstant(typeof value === "string" ? value.trim() : value);
}

export function formatDueDate(value: string | Date) {
  const key = (value instanceof Date ? value.toISOString() : value).slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(checkedDateKey(key));
}

export function checkedTimeZone(value: string | null | undefined) {
  const timeZone = value || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
  catch { throw new DateInputError("Choose a valid timezone."); }
  return timeZone;
}

export function dateKeyInZone(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function overlappingSeconds(startsAt: Date | string, endsAt: Date | string, start: Date | null, end: Date | null) {
  return Math.max(0, (Math.min(new Date(endsAt).getTime(), end?.getTime() ?? Infinity) - Math.max(new Date(startsAt).getTime(), start?.getTime() ?? -Infinity)) / 1000);
}

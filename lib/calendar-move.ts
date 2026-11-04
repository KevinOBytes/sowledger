/** Move wall-clock position without rounding saved elapsed duration or seconds.
 * In a repeated hour prefer the source offset when that occurrence exists;
 * otherwise use the first occurrence. Missing target wall times are rejected.
 */
export function moveCalendarRange(originalStart: string | Date, originalEnd: string | Date, day: Date, minute: number) {
  const original = new Date(originalStart);
  const target = new Date(day);
  target.setHours(0, minute, original.getSeconds(), original.getMilliseconds());
  const requested = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute, original.getSeconds(), original.getMilliseconds()));
  const matches = (date: Date) => date.getFullYear() === requested.getUTCFullYear()
    && date.getMonth() === requested.getUTCMonth() && date.getDate() === requested.getUTCDate()
    && date.getHours() === requested.getUTCHours() && date.getMinutes() === requested.getUTCMinutes();
  const sameOffset = new Date(requested.getTime() + original.getTimezoneOffset() * 60_000);
  const startsAt = matches(sameOffset) ? sameOffset : target;
  const endsAt = new Date(startsAt.getTime() + new Date(originalEnd).getTime() - original.getTime());
  return { startsAt, endsAt, clockError: matches(startsAt) ? undefined : "The selected start or end time does not exist because the clocks move forward. Choose another slot." };
}

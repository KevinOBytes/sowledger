import assert from "node:assert/strict";
import { test } from "node:test";
import { localDateTimeValue, parseLocalDateTime } from "../lib/date-input";

test("local datetime inputs reject nonexistent clock times rather than silently moving work", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const input of ["2026-03-08T02:30", "2026-02-30T09:00", "2026-10-30T24:00", "2026-10-30T09:60", "2026-10-30", ""]) {
      assert.throws(() => parseLocalDateTime(input), { status: 400 });
    }
    assert.equal(parseLocalDateTime("2026-03-08T03:30").toISOString(), "2026-03-08T07:30:00.000Z");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("unchanged inputs retain the original seconds and later repeated hour", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const original = "2026-11-01T06:30:42.123Z";
    assert.equal(localDateTimeValue(new Date(original)), "2026-11-01T01:30");
    assert.equal(parseLocalDateTime("2026-11-01T01:30", original).toISOString(), original);
    assert.equal(parseLocalDateTime("2026-11-01T01:30").toISOString(), "2026-11-01T05:30:00.000Z");
    assert.equal(parseLocalDateTime("2026-11-01T01:45", original).toISOString(), "2026-11-01T05:45:00.000Z");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

export type CalendarSyncFeedback = {
  tone: "success" | "warning" | "error";
  title: string;
  description: string;
};

export const calendarSyncFailure: CalendarSyncFeedback = {
  tone: "error",
  title: "Calendar sync failed",
  description: "We couldn't confirm the latest sync. Try again, or check the connection in integration settings.",
};

/** A successful HTTP request alone does not confirm a completed calendar sync. */
export function calendarSyncFeedback(value: unknown): CalendarSyncFeedback {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Calendar sync result is missing");
  const result = value as Record<string, unknown>;
  const counts = ["exported", "imported", "updated", "canceled", "skipped", "removed"].map((key) => {
    // Older successful receipts predate outbound cancellation support.
    const count = key === "removed" && result[key] === undefined ? 0 : result[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error("Calendar sync result is invalid");
    return count;
  });
  if (!Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("Calendar sync warnings are invalid");
  }
  const warnings = (result.warnings as string[]).map((warning) => warning.trim()).filter(Boolean);
  const [exported, imported, updated, canceled, skipped, removed] = counts;
  const needsAttention = skipped > 0 || warnings.length > 0;
  const summary = `${exported} sent to Google, ${removed} SOWLedger ${removed === 1 ? "event" : "events"} removed from Google, ${imported} busy ${imported === 1 ? "event" : "events"} added, ${updated} updated, ${canceled} outdated busy ${canceled === 1 ? "block" : "blocks"} cleared, ${skipped} left unchanged.`;
  return {
    tone: needsAttention ? "warning" : "success",
    title: needsAttention ? "Calendar sync needs attention" : "Calendar sync complete",
    description: [summary, ...warnings].join(" "),
  };
}

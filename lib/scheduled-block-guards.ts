type GuardableScheduledBlock = {
  title?: string | null;
  notes?: string | null;
  tags?: string[] | null;
};

export function isUnavailableScheduledBlock(block: GuardableScheduledBlock) {
  const tags = block.tags ?? [];
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  const title = (block.title ?? "").toLowerCase();
  const notes = (block.notes ?? "").toLowerCase();

  return normalizedTags.includes("unavailable")
    || normalizedTags.includes("external-calendar")
    || normalizedTags.includes("ooo")
    || title.includes("unavailable")
    || title.includes("out of office")
    || title.includes("ooo")
    || notes.includes("unavailable")
    || notes.includes("out of office")
    || notes.includes("ooo");
}


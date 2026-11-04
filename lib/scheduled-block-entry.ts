import { and, eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { integrationSyncRecords, scheduledWorkBlocks, timeEntries } from "@/lib/db/schema";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import { WorkflowError } from "@/lib/workflow-validation";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Hold this lock until the time entry and its calendar link commit together. */
export async function lockScheduledBlockForEntry(tx: Transaction, input: {
  blockId: string;
  workspaceId: string;
  userId: string;
}) {
  const [block] = await tx.select().from(scheduledWorkBlocks).where(and(
    eq(scheduledWorkBlocks.id, input.blockId),
    eq(scheduledWorkBlocks.workspaceId, input.workspaceId),
    eq(scheduledWorkBlocks.userId, input.userId),
  )).for("update");
  if (!block) throw new WorkflowError("Invalid scheduledBlockId", 400);
  if (isUnavailableScheduledBlock(block)) {
    throw new WorkflowError("Unavailable, OOO, and external-calendar blocks cannot be logged as work.", 409);
  }
  const [providerLink] = await tx.select({ metadata: integrationSyncRecords.metadata }).from(integrationSyncRecords).where(and(
    eq(integrationSyncRecords.workspaceId, input.workspaceId),
    eq(integrationSyncRecords.provider, "google_calendar"),
    eq(integrationSyncRecords.resourceType, "scheduled_work_block"),
    eq(integrationSyncRecords.resourceId, block.id),
  )).limit(1);
  if (providerLink?.metadata.direction === "google_busy_to_sowledger") {
    throw new WorkflowError("Imported calendar availability cannot be logged as work. Create a separate work block.", 409);
  }
  if (block.status === "in_progress") {
    throw new WorkflowError("This work block already has a timer. Stop it from the dashboard before logging more time.", 409);
  }
  if (block.status !== "planned") {
    throw new WorkflowError("This work block is no longer planned. Refresh the calendar before logging time.", 409);
  }
  if (block.linkedTimeEntryId) {
    throw new WorkflowError("This work block already has a time entry. Review it in Activity.", 409);
  }

  // Calendar metadata can be edited independently. A cleared or stale reverse
  // link must not make previously recorded work available to log a second time.
  const [existingEntry] = await tx.select({ id: timeEntries.id }).from(timeEntries).where(and(
    eq(timeEntries.workspaceId, input.workspaceId),
    eq(timeEntries.scheduledBlockId, block.id),
  )).limit(1);
  if (existingEntry) {
    throw new WorkflowError("This work block already has a time entry. Review it in Activity.", 409);
  }
  return block;
}

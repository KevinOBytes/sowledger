import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationSyncRecords, scheduledWorkBlocks } from "@/lib/db/schema";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";

/** Recorded-entry status/source filters have no equivalent scheduling meaning. */
export async function loadEligiblePlannedWork(workspaceId: string, scope: {
  userId?: string | null;
  projectId?: string | null;
  start?: Date | null;
  end?: Date | null;
} = {}, client: Pick<typeof db, "select"> = db) {
  const conditions = [eq(scheduledWorkBlocks.workspaceId, workspaceId)];
  if (scope.userId) conditions.push(eq(scheduledWorkBlocks.userId, scope.userId));
  if (scope.projectId) conditions.push(eq(scheduledWorkBlocks.projectId, scope.projectId));
  if (scope.start) conditions.push(gt(scheduledWorkBlocks.endsAt, scope.start));
  if (scope.end) conditions.push(lt(scheduledWorkBlocks.startsAt, scope.end));
  const rows = await client.select().from(scheduledWorkBlocks).where(and(...conditions));
  if (!rows.length) return rows;
  const imported = new Set<string>();
  // All-time reports may select more rows than PostgreSQL accepts bind values.
  // Bound each lookup without dropping any selected row or its provenance.
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const links = await client.select().from(integrationSyncRecords).where(and(
      eq(integrationSyncRecords.workspaceId, workspaceId),
      eq(integrationSyncRecords.provider, "google_calendar"),
      eq(integrationSyncRecords.resourceType, "scheduled_work_block"),
      inArray(integrationSyncRecords.resourceId, rows.slice(offset, offset + 1000).map(block => block.id)),
    ));
    for (const link of links) if (link.metadata.direction === "google_busy_to_sowledger") imported.add(link.resourceId);
  }
  return rows.filter(block => block.status !== "canceled"
    && !imported.has(block.id)
    && !isUnavailableScheduledBlock(block)
    && !/^busy(?:\b|:)/i.test(block.title.trim())
    && !block.tags.some(tag => tag.toLowerCase() === "busy"));
}

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationSyncRecords, memberships, projects, scheduledWorkBlocks, timeEntries, userActions } from "@/lib/db/schema";
import { WorkflowError } from "@/lib/workflow-validation";

type BlockUpdates = Partial<Pick<typeof scheduledWorkBlocks.$inferInsert,
  "title" | "notes" | "tags" | "startsAt" | "endsAt" | "userId" | "projectId" | "taskId" | "actionId" | "status" | "linkedTimeEntryId"
>>;

export async function updateScheduledBlock(input: {
  workspaceId: string;
  blockId: string;
  actorUserId: string;
  canManageOthers: boolean;
  updates: BlockUpdates;
}) {
  return db.transaction(async (tx) => {
    const condition = and(eq(scheduledWorkBlocks.id, input.blockId), eq(scheduledWorkBlocks.workspaceId, input.workspaceId));
    const [existing] = await tx.select().from(scheduledWorkBlocks).where(condition).for("update");
    if (!existing) throw new WorkflowError("Scheduled block not found.", 404);
    if (existing.userId !== input.actorUserId && !input.canManageOthers) throw new WorkflowError("You cannot change another member's schedule without permission.", 403);
    const updates = { ...input.updates };
    if (updates.userId !== undefined && (typeof updates.userId !== "string" || !updates.userId.trim())) throw new WorkflowError("Choose a workspace member to assign this work.", 400);
    if (updates.linkedTimeEntryId !== undefined) throw new WorkflowError("Time links are managed when you start or log scheduled work.", 400);
    const [providerLink] = await tx.select({ metadata: integrationSyncRecords.metadata }).from(integrationSyncRecords).where(and(
      eq(integrationSyncRecords.workspaceId, input.workspaceId),
      eq(integrationSyncRecords.provider, "google_calendar"),
      eq(integrationSyncRecords.resourceType, "scheduled_work_block"),
      eq(integrationSyncRecords.resourceId, existing.id),
    )).limit(1);
    if (existing.tags.some((tag) => tag.toLowerCase() === "external-calendar") || providerLink?.metadata.direction === "google_busy_to_sowledger") {
      throw new WorkflowError("This event comes from a connected calendar. Change it there, then sync again.", 409);
    }
    if (updates.status !== undefined && !["planned", "skipped", "canceled"].includes(updates.status) && updates.status !== existing.status) {
      throw new WorkflowError("Start a timer or log completed work to change its tracking status.", 400);
    }

    const [recordedEntry] = await tx.select({ id: timeEntries.id }).from(timeEntries)
      .where(and(eq(timeEntries.workspaceId, input.workspaceId), eq(timeEntries.scheduledBlockId, existing.id))).limit(1);
    const hasRecordedTime = existing.status === "in_progress" || existing.status === "completed" || Boolean(existing.linkedTimeEntryId || recordedEntry);
    const structuralFields = ["startsAt", "endsAt", "userId", "projectId", "taskId", "actionId", "status"] as const;
    if (hasRecordedTime && structuralFields.some((field) => {
      const next = updates[field];
      if (next === undefined) return false;
      const previous = existing[field];
      return next instanceof Date && previous instanceof Date ? next.getTime() !== previous.getTime() : next !== previous;
    })) {
      throw new WorkflowError("This block already has tracked work. Stop its timer in Dashboard or review the recorded time in Activity. Duplicate it to plan new work.", 409);
    }

    if (updates.title !== undefined) {
      if (typeof updates.title !== "string" || !updates.title.trim() || updates.title.trim().length > 255) throw new WorkflowError("Enter a title between 1 and 255 characters.", 400);
      updates.title = updates.title.trim();
    }
    const startsAt = updates.startsAt ?? existing.startsAt;
    const endsAt = updates.endsAt ?? existing.endsAt;
    if (!(startsAt instanceof Date) || !(endsAt instanceof Date) || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new WorkflowError("Choose a valid start and end time, with the end after the start.", 400);
    const userId = updates.userId ?? existing.userId;
    if (userId !== input.actorUserId && !input.canManageOthers) throw new WorkflowError("You cannot schedule another member without permission.", 403);
    if (updates.userId !== undefined) {
      const [member] = await tx.select({ userId: memberships.userId }).from(memberships)
        .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, userId)));
      if (!member) throw new WorkflowError("User is not in this workspace.", 400);
    }
    const projectId = updates.projectId !== undefined ? updates.projectId : existing.projectId;
    if (projectId) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, input.workspaceId)));
      if (!project) throw new WorkflowError("Invalid projectId.", 400);
    }
    const actionId = updates.actionId !== undefined ? updates.actionId : existing.actionId;
    if (actionId) {
      const [action] = await tx.select({ id: userActions.id }).from(userActions).where(and(eq(userActions.id, actionId), eq(userActions.workspaceId, input.workspaceId), eq(userActions.userId, userId)));
      if (!action) throw new WorkflowError("Choose a work type belonging to the assigned member.", 400);
    }
    const [block] = await tx.update(scheduledWorkBlocks).set({ ...updates, updatedAt: new Date() }).where(and(condition, eq(scheduledWorkBlocks.userId, existing.userId))).returning();
    if (!block) throw new WorkflowError("This block changed. Refresh the calendar and try again.", 409);
    return block;
  });
}

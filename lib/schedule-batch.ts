import { createHash } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationSyncRecords, memberships, projects, scheduledWorkBlocks, timeEntries, userActions } from "@/lib/db/schema";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import { normalizeTags } from "@/lib/validators";
import { WorkflowError } from "@/lib/workflow-validation";

type ScheduledBlock = typeof scheduledWorkBlocks.$inferSelect;
type Occurrence = { startsAt: Date; endsAt: Date };

function record(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowError(message, 400);
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string, maxLength?: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || (maxLength !== undefined && value.length > maxLength)) throw new WorkflowError(`Enter a valid ${label}.`, 400);
  return value;
}

function timestamp(value: unknown, label: string) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(value) : null;
  if (!match) throw new WorkflowError(`${label} must be a full date and time with a timezone.`, 400);
  const date = new Date(value as string);
  const offset = match[7].toUpperCase() === "Z" ? 0 : (match[8] === "-" ? -1 : 1) * (Number(match[9]) * 60 + Number(match[10]));
  const wall = new Date(date.getTime() + offset * 60000);
  if (!Number.isFinite(date.getTime()) || Number(match[9] ?? 0) > 23 || Number(match[10] ?? 0) > 59
    || wall.getUTCFullYear() !== Number(match[1]) || wall.getUTCMonth() + 1 !== Number(match[2]) || wall.getUTCDate() !== Number(match[3])
    || wall.getUTCHours() !== Number(match[4]) || wall.getUTCMinutes() !== Number(match[5]) || wall.getUTCSeconds() !== Number(match[6])) {
    throw new WorkflowError(`${label} must be a valid date and time.`, 400);
  }
  return date;
}

function parseBatch(body: unknown, actorUserId: string) {
  const input = record(body, "Send a valid scheduling request.");
  if (typeof input.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)) {
    throw new WorkflowError("A valid operationId is required for a scheduling batch.", 400);
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 255) throw new WorkflowError("Enter a title between 1 and 255 characters.", 400);
  if (!Array.isArray(input.occurrences) || input.occurrences.length < 1 || input.occurrences.length > 12) throw new WorkflowError("Schedule between 1 and 12 occurrences at a time.", 400);
  const seen = new Set<string>();
  const occurrences = input.occurrences.map((value): Occurrence => {
    const occurrence = record(value, "Each occurrence needs a start and end time.");
    const startsAt = timestamp(occurrence.startsAt, "startsAt");
    const endsAt = timestamp(occurrence.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new WorkflowError("Each occurrence must end after it starts.", 400);
    const key = `${startsAt.toISOString()}/${endsAt.toISOString()}`;
    if (seen.has(key)) throw new WorkflowError("Each occurrence must have a different time range.", 400);
    seen.add(key);
    return { startsAt, endsAt };
  });
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== "string"))) throw new WorkflowError("Tags must be a list of names.", 400);
  const replacements = input.replace ?? [];
  if (!Array.isArray(replacements) || replacements.length > 100 || (replacements.length > 0 && occurrences.length !== 1)) throw new WorkflowError("Replace up to 100 planned blocks with one new occurrence.", 400);
  const replace = replacements.map(value => {
    const replacement = record(value, "Each replacement needs a block ID and its last update time.");
    const blockId = optionalString(replacement.blockId, "replacement block ID", 255);
    if (!blockId || !blockId.trim()) throw new WorkflowError("A replacement block ID is required.", 400);
    return { blockId, expectedUpdatedAt: timestamp(replacement.expectedUpdatedAt, "expectedUpdatedAt") };
  }).sort((left, right) => left.blockId.localeCompare(right.blockId));
  if (new Set(replace.map(item => item.blockId)).size !== replace.length) throw new WorkflowError("Select each replacement block only once.", 400);
  const userId = optionalString(input.userId, "assigned member", 255) ?? actorUserId;
  if (!userId.trim()) throw new WorkflowError("Choose a workspace member to assign this work.", 400);
  return {
    operationId: input.operationId.toLowerCase(), title, userId,
    projectId: optionalString(input.projectId, "project ID", 255),
    actionId: optionalString(input.actionId, "work type ID", 255),
    taskId: optionalString(input.taskId, "task ID", 255),
    notes: optionalString(input.notes, "notes"),
    tags: normalizeTags(input.tags as string[] | undefined).sort(), occurrences, replace,
  };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const overlaps = (left: Occurrence, right: Occurrence) => left.startsAt < right.endsAt && left.endsAt > right.startsAt;

/**
 * A committed batch's immutable row IDs are its retry receipt. Cancellation and
 * later edits do not erase it. This deliberately fails closed if an operator has
 * hard-deleted only part of a receipt; no separate idempotency schema is needed.
 */
export async function createScheduledBatch(input: { workspaceId: string; actorUserId: string; canManageOthers: boolean; body: unknown }) {
  const batch = parseBatch(input.body, input.actorUserId);
  const key = digest([input.workspaceId, input.actorUserId, batch.operationId]);
  const payloadDigest = digest(batch);
  const receiptPrefix = `sb-${key}-`;
  const blockIds = batch.occurrences.map((_, index) => `${receiptPrefix}${payloadDigest}-${batch.occurrences.length}-${index}`);
  const replacedBlockIds = batch.replace.map(item => item.blockId);
  const hasInternalOverlap = batch.occurrences.some((item, index) => batch.occurrences.slice(index + 1).some(other => overlaps(item, other)));
  const warnings = hasInternalOverlap ? ["Some of these work blocks overlap. They were saved as requested."] : [];

  return db.transaction(async tx => {
    // Lock in a common order even when two managers schedule each other. The
    // actor lock also serializes same-key requests with different assignees.
    const members = await tx.select().from(memberships).where(and(eq(memberships.workspaceId, input.workspaceId), inArray(memberships.userId, [...new Set([input.actorUserId, batch.userId])]))).orderBy(asc(memberships.userId)).for("update");
    const actor = members.find(member => member.userId === input.actorUserId);
    if (!actor || !["member", "manager", "owner"].includes(actor.role)) throw new WorkflowError("Your workspace role cannot schedule work.", 403);
    const canManageOthers = input.canManageOthers && ["manager", "owner"].includes(actor.role);
    if (batch.userId !== input.actorUserId && !canManageOthers) throw new WorkflowError("Cannot schedule another user's time.", 403);

    const prior = await tx.select({ id: scheduledWorkBlocks.id }).from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, input.workspaceId), like(scheduledWorkBlocks.id, `${receiptPrefix}%`)));
    if (prior.length > 0) {
      if (prior.some(block => !blockIds.includes(block.id))) throw new WorkflowError("This save request already completed with different details. Review the calendar before starting a new save.", 409);
      if (prior.length !== blockIds.length) throw new WorkflowError("This saved batch is incomplete. Review the calendar before scheduling it again.", 409);
      return { blockIds, replacedBlockIds, replayed: true, warnings, createdBlocks: [] as ScheduledBlock[] };
    }

    if (!members.some(member => member.userId === batch.userId)) throw new WorkflowError("User is not in this workspace.", 400);
    if (batch.projectId) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.id, batch.projectId))).for("share");
      if (!project) throw new WorkflowError("Invalid projectId.", 400);
    }
    if (batch.actionId) {
      const [action] = await tx.select({ id: userActions.id }).from(userActions).where(and(eq(userActions.workspaceId, input.workspaceId), eq(userActions.userId, batch.userId), eq(userActions.id, batch.actionId))).for("share");
      if (!action) throw new WorkflowError("Choose a work type belonging to the assigned member.", 400);
    }

    if (replacedBlockIds.length > 0) {
      const replaceBlocks = await tx.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, input.workspaceId), inArray(scheduledWorkBlocks.id, replacedBlockIds))).orderBy(asc(scheduledWorkBlocks.id)).for("update");
      if (replaceBlocks.length !== replacedBlockIds.length) throw new WorkflowError("A planned block could not be found. Refresh the calendar before replacing it.", 404);
      const entries = await tx.select({ scheduledBlockId: timeEntries.scheduledBlockId }).from(timeEntries).where(and(eq(timeEntries.workspaceId, input.workspaceId), inArray(timeEntries.scheduledBlockId, replacedBlockIds)));
      const recorded = new Set(entries.map(entry => entry.scheduledBlockId));
      const links = await tx.select().from(integrationSyncRecords).where(and(eq(integrationSyncRecords.workspaceId, input.workspaceId), eq(integrationSyncRecords.resourceType, "scheduled_work_block"), inArray(integrationSyncRecords.resourceId, replacedBlockIds)));
      const imported = new Set(links.filter(link => link.metadata.direction === "google_busy_to_sowledger").map(link => link.resourceId));
      for (const block of replaceBlocks) {
        const expected = batch.replace.find(item => item.blockId === block.id)!;
        if (block.userId !== batch.userId) throw new WorkflowError("Replace only plans belonging to the assigned member.", 409);
        if (block.updatedAt.getTime() !== expected.expectedUpdatedAt.getTime()) throw new WorkflowError("A planned block changed. Refresh the calendar before replacing it.", 409);
        if (block.status !== "planned" || block.linkedTimeEntryId || recorded.has(block.id)) throw new WorkflowError("This block already changed or has tracked work. Refresh the calendar before replacing it.", 409);
        if (isUnavailableScheduledBlock(block) || imported.has(block.id)) throw new WorkflowError("Unavailable or imported calendar blocks cannot be replaced with planned work.", 409);
        if (!overlaps(batch.occurrences[0], block)) throw new WorkflowError("A replacement block no longer overlaps this plan. Refresh the calendar.", 409);
      }
      await tx.update(scheduledWorkBlocks).set({ status: "skipped", updatedAt: new Date() }).where(and(eq(scheduledWorkBlocks.workspaceId, input.workspaceId), inArray(scheduledWorkBlocks.id, replacedBlockIds)));
    }

    const createdBlocks: ScheduledBlock[] = [];
    for (const [index, occurrence] of batch.occurrences.entries()) {
      const [block] = await tx.insert(scheduledWorkBlocks).values({
        id: blockIds[index], workspaceId: input.workspaceId, createdByUserId: input.actorUserId,
        userId: batch.userId, title: batch.title, projectId: batch.projectId, actionId: batch.actionId,
        taskId: batch.taskId, notes: batch.notes, tags: batch.tags, ...occurrence,
      }).returning();
      createdBlocks.push(block);
    }
    return { blockIds, replacedBlockIds, replayed: false, warnings, createdBlocks };
  });
}

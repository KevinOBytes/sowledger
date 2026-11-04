import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { withTimeCapacity, fitStoppedSegments, savedDuration, TimeDataError } from "@/lib/time-capacity";
import { scheduledWorkBlocks, timeEntries } from "@/lib/db/schema";
import { appendAuditLog, dispatchWebhook, ensurePeriodUnlocked, splitTimeWindowByUtcDay } from "@/lib/security";
import { WorkflowError } from "@/lib/workflow-validation";

type AuditEvent = Parameters<typeof appendAuditLog>[0];

export async function stopTimer(input: { workspaceId: string; userId: string; entryId: string; endedAt: Date }) {
  const result = await withTimeCapacity({ workspaceId: input.workspaceId, userId: input.userId }, async (capacity) => {
    const { tx } = capacity;
    // Competing stop requests must read the current row after the winner commits.
    // All fragments, the calendar link and audit records use this same connection.
    const [entry] = await tx.select().from(timeEntries).where(and(
      eq(timeEntries.id, input.entryId),
      eq(timeEntries.workspaceId, input.workspaceId),
      eq(timeEntries.userId, input.userId),
    )).for("update");
    if (!entry || entry.stoppedAt) throw new WorkflowError("No active timer found for entry", 404);
    if (!Number.isFinite(entry.startedAt.getTime())) throw new TimeDataError();
    if (entry.durationSeconds !== null) savedDuration(entry.durationSeconds);

    const endedAt = input.endedAt;
    const startedAt = entry.startedAt;
    if (Number.isNaN(endedAt.getTime())) throw new WorkflowError("endedAt must be a valid date", 400);
    if (endedAt < startedAt) throw new WorkflowError("endedAt must be greater than or equal to startedAt", 400);
    if (endedAt.getTime() > Date.now()) throw new WorkflowError("endedAt cannot be in the future", 400);

    if (!Number.isFinite(entry.accumulatedSeconds) || entry.accumulatedSeconds < 0
      || (entry.isPaused && (!entry.pausedAt || !Number.isFinite(entry.pausedAt.getTime())))) {
      throw new WorkflowError("The pause time for this timer is invalid. Contact support for help.", 409);
    }
    entry.accumulatedSeconds = savedDuration(entry.accumulatedSeconds).seconds;
    const rawSegments = splitTimeWindowByUtcDay(startedAt, endedAt);
    const elapsedSeconds = rawSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const totalPausedSeconds = entry.accumulatedSeconds + (entry.isPaused && entry.pausedAt ? Math.max(0, Math.floor((endedAt.getTime() - entry.pausedAt.getTime()) / 1000)) : 0);
    if (!Number.isFinite(totalPausedSeconds)) throw new WorkflowError("The pause time for this timer is invalid. Contact support for help.", 409);
    const excludedPauseSeconds = Math.min(elapsedSeconds, totalPausedSeconds);
    let remainingPaused = excludedPauseSeconds;
    // Preserve the current aggregate-break allocation. Exact daily placement of
    // historical pauses requires pause intervals, which are not stored today.
    for (let i = rawSegments.length - 1; i >= 0; i--) {
      const deduct = Math.min(rawSegments[i].durationSeconds, remainingPaused);
      rawSegments[i].durationSeconds -= deduct;
      remainingPaused -= deduct;
    }
    const originalSegments = rawSegments.filter((segment) => segment.durationSeconds > 0);
    const originalDurationSeconds = originalSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

    await ensurePeriodUnlocked(input.workspaceId, startedAt, endedAt, tx);
    const events: AuditEvent[] = [];
    const recordEvent = async (event: AuditEvent) => {
      await appendAuditLog(event, tx);
      events.push(event);
    };
    const entryCondition = and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, input.workspaceId), eq(timeEntries.userId, input.userId));
    const completeScheduledBlock = async () => {
      if (!entry.scheduledBlockId) return;
      await tx.update(scheduledWorkBlocks).set({
        status: "completed", linkedTimeEntryId: entry.id, updatedAt: new Date(),
      }).where(and(eq(scheduledWorkBlocks.id, entry.scheduledBlockId), eq(scheduledWorkBlocks.workspaceId, input.workspaceId), eq(scheduledWorkBlocks.userId, input.userId)));
    };

    // A zero-net window is a real stop at the requested endpoint, not a daily
    // capacity rejection. Keep its original identity, geometry and schedule.
    if (originalDurationSeconds === 0) {
      await tx.update(timeEntries).set({ stoppedAt: endedAt, durationSeconds: 0 }).where(entryCondition);
      await completeScheduledBlock();
      await recordEvent({
        workspaceId: input.workspaceId, timeEntryId: entry.id, actorUserId: input.userId,
        eventType: "timer_stopped_no_recorded_time",
        diff: {
          stoppedAt: { before: null, after: endedAt.toISOString() },
          durationSeconds: { before: null, after: 0 },
          requestedStoppedAt: { before: null, after: endedAt.toISOString() },
          totalPausedSeconds: { before: 0, after: totalPausedSeconds },
          excludedPauseSeconds: { before: 0, after: excludedPauseSeconds },
        },
      });
      return { events, response: {
        ok: true, entryId: entry.id, entryIds: [entry.id], durationSeconds: 0,
        splitAcrossDays: false, adjustedForDailyLimit: false, trimmedSeconds: 0,
        message: "Timer stopped. No additional time was recorded.",
      } };
    }

    const fitted = await fitStoppedSegments(capacity, { segments: originalSegments, originalEntry: entry });
    const durationSeconds = fitted.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const adjustedForDailyLimit = fitted.trimmedSeconds > 0;
    const [firstSegment, ...continuationSegments] = fitted.segments;

    if (!firstSegment) {
      await tx.update(timeEntries).set({ stoppedAt: startedAt, durationSeconds: 0 }).where(entryCondition);
      await completeScheduledBlock();
      await recordEvent({
        workspaceId: input.workspaceId, timeEntryId: entry.id, actorUserId: input.userId,
        eventType: "timer_stopped_no_daily_capacity",
        diff: {
          stoppedAt: { before: null, after: startedAt.toISOString() },
          durationSeconds: { before: null, after: 0 },
          requestedStoppedAt: { before: null, after: endedAt.toISOString() },
          trimmedSeconds: { before: 0, after: fitted.trimmedSeconds },
        },
      });
      return { events, response: {
        ok: true, entryId: entry.id, entryIds: [entry.id], durationSeconds: 0,
        splitAcrossDays: false, adjustedForDailyLimit: true, trimmedSeconds: fitted.trimmedSeconds,
        message: "Timer stopped. No additional time was logged because the affected day already has 24 hours recorded.",
      } };
    }

    await tx.update(timeEntries).set({
      startedAt: firstSegment.startedAt, stoppedAt: firstSegment.stoppedAt, durationSeconds: firstSegment.durationSeconds,
    }).where(entryCondition);
    const continuationEntries: Array<typeof timeEntries.$inferSelect> = [];
    for (const segment of continuationSegments) {
      const [continued] = await tx.insert(timeEntries).values({
        id: crypto.randomUUID(),
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        scheduledBlockId: null,
        taskId: entry.taskId,
        projectId: entry.projectId,
        goalId: entry.goalId,
        tags: entry.tags,
        startedAt: segment.startedAt,
        stoppedAt: segment.stoppedAt,
        durationSeconds: segment.durationSeconds,
        description: entry.description,
        status: entry.status,
        source: entry.source,
        collaborators: entry.collaborators,
        expenses: entry.expenses,
        action: entry.action,
        hourlyRate: entry.hourlyRate,
      }).returning();
      continuationEntries.push(continued);
    }
    await completeScheduledBlock();
    await recordEvent({
      workspaceId: input.workspaceId, timeEntryId: entry.id, actorUserId: input.userId,
      eventType: adjustedForDailyLimit ? "timer_stopped_adjusted_daily_limit" : continuationEntries.length > 0 ? "timer_stopped_split" : "timer_stopped",
      diff: {
        startedAt: { before: entry.startedAt, after: firstSegment.startedAt.toISOString() },
        stoppedAt: { before: null, after: firstSegment.stoppedAt.toISOString() },
        durationSeconds: { before: null, after: firstSegment.durationSeconds },
        requestedStoppedAt: { before: null, after: endedAt.toISOString() },
        trimmedSeconds: { before: 0, after: fitted.trimmedSeconds },
        continuationEntryIds: { before: [], after: continuationEntries.map((continued) => continued.id) },
      },
    });
    for (const continued of continuationEntries) {
      await recordEvent({
        workspaceId: input.workspaceId, timeEntryId: continued.id, actorUserId: input.userId,
        eventType: "timer_continued_after_midnight",
        diff: {
          sourceEntryId: { before: null, after: entry.id },
          stoppedAt: { before: null, after: continued.stoppedAt?.toISOString() ?? endedAt.toISOString() },
          durationSeconds: { before: null, after: continued.durationSeconds === null ? null : savedDuration(continued.durationSeconds).seconds },
        },
      });
    }
    return { events, response: {
      ok: true,
      entryId: entry.id,
      entryIds: [entry.id, ...continuationEntries.map((continued) => continued.id)],
      durationSeconds,
      splitAcrossDays: continuationEntries.length > 0,
      adjustedForDailyLimit,
      trimmedSeconds: fitted.trimmedSeconds,
      message: adjustedForDailyLimit
        ? "Timer stopped and adjusted so no day exceeds 24 logged hours. Review the draft entry if the stale timer needs a different allocation."
        : undefined,
    } };
  });

  // Audit events become externally visible only after the database commits.
  after(async () => {
    for (const event of result.events) await dispatchWebhook(event.workspaceId, event.eventType, event.diff);
  });
  return result.response;
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, createTimeEntry, enforceStopRateLimit, ensurePeriodUnlocked, fitTimeWindowSegmentsToDailyLimit, splitTimeWindowByUtcDay } from "@/lib/security";
import { db } from "@/lib/db";
import { scheduledWorkBlocks, timeEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await enforceStopRateLimit(session.sub);

    const body = await req.json() as { entryId?: string; endedAt?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, body.entryId));
    if (!entry || entry.workspaceId !== session.workspaceId || entry.userId !== session.sub || entry.stoppedAt) {
      return NextResponse.json({ error: "No active timer found for entry" }, { status: 404 });
    }

    const endedAt = body.endedAt ? new Date(body.endedAt) : new Date();
    const startedAt = new Date(entry.startedAt!);

    if (Number.isNaN(endedAt.getTime())) {
      return NextResponse.json({ error: "endedAt must be a valid date" }, { status: 400 });
    }

    if (endedAt.getTime() < startedAt.getTime()) {
      return NextResponse.json({ error: "endedAt must be greater than or equal to startedAt" }, { status: 400 });
    }

    if (endedAt.getTime() > Date.now()) {
      return NextResponse.json({ error: "endedAt cannot be in the future" }, { status: 400 });
    }

    const originalSegments = splitTimeWindowByUtcDay(startedAt, endedAt);
    const originalDurationSeconds = originalSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

    await ensurePeriodUnlocked(session.workspaceId, startedAt, endedAt);
    const fitted = await fitTimeWindowSegmentsToDailyLimit({
      workspaceId: session.workspaceId,
      userId: session.sub,
      segments: originalSegments,
      excludeEntryId: entry.id,
    });
    const segments = fitted.segments;
    const durationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const adjustedForDailyLimit = fitted.trimmedSeconds > 0;
    const [firstSegment, ...continuationSegments] = segments;

    if (!firstSegment) {
      await db.update(timeEntries).set({
        stoppedAt: startedAt,
        durationSeconds: 0,
      }).where(eq(timeEntries.id, entry.id));

      if (entry.scheduledBlockId) {
        await db.update(scheduledWorkBlocks).set({
          status: "completed",
          linkedTimeEntryId: entry.id,
          updatedAt: new Date(),
        }).where(eq(scheduledWorkBlocks.id, entry.scheduledBlockId));
      }

      await appendAuditLog({
        workspaceId: session.workspaceId,
        timeEntryId: entry.id,
        actorUserId: session.sub,
        eventType: "timer_stopped_no_daily_capacity",
        diff: {
          stoppedAt: { before: null, after: startedAt.toISOString() },
          durationSeconds: { before: null, after: 0 },
          requestedStoppedAt: { before: null, after: endedAt.toISOString() },
          trimmedSeconds: { before: 0, after: originalDurationSeconds },
        },
      });

      return NextResponse.json({
        ok: true,
        entryId: entry.id,
        entryIds: [entry.id],
        durationSeconds: 0,
        splitAcrossDays: false,
        adjustedForDailyLimit: true,
        trimmedSeconds: originalDurationSeconds,
        message: "Timer stopped. No additional time was logged because the affected day already has 24 hours recorded.",
      });
    }

    const stoppedAtIso = endedAt.toISOString();
    
    await db.update(timeEntries).set({
      startedAt: firstSegment.startedAt,
      stoppedAt: firstSegment.stoppedAt,
      durationSeconds: firstSegment.durationSeconds,
    }).where(eq(timeEntries.id, entry.id));

    const continuationEntries = [];
    for (const segment of continuationSegments) {
      continuationEntries.push(await createTimeEntry({
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
      }));
    }

    if (entry.scheduledBlockId) {
      await db.update(scheduledWorkBlocks).set({
        status: "completed",
        linkedTimeEntryId: entry.id,
        updatedAt: new Date(),
      }).where(eq(scheduledWorkBlocks.id, entry.scheduledBlockId));
    }

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: adjustedForDailyLimit
        ? "timer_stopped_adjusted_daily_limit"
        : continuationEntries.length > 0
        ? "timer_stopped_split"
        : "timer_stopped",
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
      await appendAuditLog({
        workspaceId: session.workspaceId,
        timeEntryId: continued.id,
        actorUserId: session.sub,
        eventType: "timer_continued_after_midnight",
        diff: {
          sourceEntryId: { before: null, after: entry.id },
          stoppedAt: { before: null, after: continued.stoppedAt?.toISOString() ?? stoppedAtIso },
          durationSeconds: { before: null, after: continued.durationSeconds },
        },
      });
    }

    return NextResponse.json({
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
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

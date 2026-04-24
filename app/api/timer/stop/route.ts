import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, createTimeEntry, enforceDailyHoursLimitForWindow, enforceStopRateLimit, ensurePeriodUnlocked, splitTimeWindowByUtcDay } from "@/lib/security";
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

    const segments = splitTimeWindowByUtcDay(startedAt, endedAt);
    const durationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const [firstSegment, ...continuationSegments] = segments;
    if (!firstSegment) return NextResponse.json({ error: "Unable to calculate timer duration" }, { status: 400 });

    await ensurePeriodUnlocked(session.workspaceId, startedAt, endedAt);
    await enforceDailyHoursLimitForWindow(session.sub, startedAt, endedAt, entry.id);

    const stoppedAtIso = endedAt.toISOString();
    
    await db.update(timeEntries).set({
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
      eventType: continuationEntries.length > 0 ? "timer_stopped_split" : "timer_stopped",
      diff: {
        stoppedAt: { before: null, after: firstSegment.stoppedAt.toISOString() },
        durationSeconds: { before: null, after: firstSegment.durationSeconds },
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
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

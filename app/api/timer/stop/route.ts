import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceDailyHoursLimit, enforceStopRateLimit, ensurePeriodUnlocked } from "@/lib/security";
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

    const durationSeconds = Math.max(1, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

    await ensurePeriodUnlocked(session.workspaceId, startedAt, endedAt);
    await enforceDailyHoursLimit(session.sub, startedAt, durationSeconds);

    const stoppedAtIso = endedAt.toISOString();
    
    await db.update(timeEntries).set({
      stoppedAt: endedAt,
      durationSeconds,
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
      eventType: "timer_stopped",
      diff: {
        stoppedAt: { before: null, after: stoppedAtIso },
        durationSeconds: { before: null, after: durationSeconds },
      },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, durationSeconds });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

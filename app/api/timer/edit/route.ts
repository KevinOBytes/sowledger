import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceDailyHoursLimit, ensurePeriodUnlocked } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries, projects, goals, userActions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json() as {
      entryId?: string;
      startedAt?: string;
      stoppedAt?: string;
      description?: string;
      projectId?: string;
      goalId?: string;
      tags?: string[];
      actionId?: string;
    };

    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, body.entryId));
    if (!entry || entry.workspaceId !== session.workspaceId) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const canManageOthers = session.role === "manager" || session.role === "owner";
    if (!canManageOthers && entry.userId !== session.sub) {
      return NextResponse.json({ error: "Cannot edit other users entries" }, { status: 403 });
    }
    requireRole("member", session.role);

    if (entry.status === "approved" || entry.status === "invoiced") {
      return NextResponse.json({ error: "Approved or invoiced entries are locked" }, { status: 409 });
    }

    if (body.projectId) {
      const [project] = await db.select().from(projects).where(eq(projects.id, body.projectId));
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    if (body.goalId) {
      const [goal] = await db.select().from(goals).where(eq(goals.id, body.goalId));
      if (!goal || goal.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid goalId" }, { status: 400 });
      }
    }

    let nextActionName = entry.action;
    let nextHourlyRate = entry.hourlyRate;

    if (body.actionId !== undefined) {
      if (body.actionId === "") {
        nextActionName = null;
        nextHourlyRate = null;
      } else {
        const [uAction] = await db.select().from(userActions).where(eq(userActions.id, body.actionId));
        if (!uAction || uAction.workspaceId !== session.workspaceId || uAction.userId !== entry.userId) {
          return NextResponse.json({ error: "Invalid actionId" }, { status: 400 });
        }
        nextActionName = uAction.name;
        nextHourlyRate = uAction.hourlyRate;
      }
    }

    const rawStartedAt = body.startedAt ?? entry.startedAt;
    const rawStoppedAt = body.stoppedAt ?? entry.stoppedAt;
    if (!rawStoppedAt) return NextResponse.json({ error: "Cannot edit open timer with this endpoint" }, { status: 400 });

    const nextStartedAt = new Date(rawStartedAt!);
    const nextStoppedAt = new Date(rawStoppedAt);
    if (isNaN(nextStartedAt.getTime())) return NextResponse.json({ error: "Invalid startedAt date" }, { status: 400 });
    if (isNaN(nextStoppedAt.getTime())) return NextResponse.json({ error: "Invalid stoppedAt date" }, { status: 400 });
    if (nextStoppedAt <= nextStartedAt) return NextResponse.json({ error: "stoppedAt must be after startedAt" }, { status: 400 });

    await ensurePeriodUnlocked(session.workspaceId, nextStartedAt, nextStoppedAt);
    const nextDurationSeconds = Math.max(1, Math.floor((nextStoppedAt.getTime() - nextStartedAt.getTime()) / 1000));
    await enforceDailyHoursLimit(entry.workspaceId, entry.userId, nextStartedAt, nextDurationSeconds, entry.id);

    const updates: Partial<typeof timeEntries.$inferInsert> = {};
    updates.startedAt = nextStartedAt;
    updates.stoppedAt = nextStoppedAt;
    updates.durationSeconds = nextDurationSeconds;
    updates.description = body.description ?? entry.description;
    updates.projectId = body.projectId ?? entry.projectId;
    updates.goalId = body.goalId ?? entry.goalId;
    updates.tags = body.tags ? normalizeTags(body.tags) : entry.tags;
    updates.action = nextActionName;
    updates.hourlyRate = nextHourlyRate;

    await db.update(timeEntries).set(updates).where(eq(timeEntries.id, entry.id));

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "manual_edit",
      diff: {
        startedAt: { before: entry.startedAt, after: updates.startedAt },
        stoppedAt: { before: entry.stoppedAt, after: updates.stoppedAt },
        durationSeconds: { before: entry.durationSeconds, after: updates.durationSeconds },
        description: { before: entry.description ?? null, after: updates.description ?? null },
        projectId: { before: entry.projectId ?? null, after: updates.projectId ?? null },
        goalId: { before: entry.goalId ?? null, after: updates.goalId ?? null },
        tags: { before: entry.tags, after: updates.tags },
        action: { before: entry.action ?? null, after: updates.action ?? null },
        hourlyRate: { before: entry.hourlyRate ?? null, after: updates.hourlyRate ?? null },
      },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, nextDurationSeconds });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceAuthKey, enforceDailyHoursLimit, ensurePeriodUnlocked } from "@/lib/security";
import { store } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";

export async function PATCH(req: NextRequest) {
  try {
    await enforceAuthKey(req);
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

    const entry = store.entries.get(body.entryId);
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
      const project = store.projects.get(body.projectId);
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    if (body.goalId) {
      const goal = store.goals.get(body.goalId);
      if (!goal || goal.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid goalId" }, { status: 400 });
      }
    }

    let nextActionName = entry.action;
    let nextHourlyRate = entry.hourlyRate;

    if (body.actionId !== undefined) {
      if (body.actionId === "") {
        nextActionName = undefined;
        nextHourlyRate = undefined;
      } else {
        const uAction = store.userActions.get(body.actionId);
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

    const nextStartedAt = new Date(rawStartedAt);
    const nextStoppedAt = new Date(rawStoppedAt);
    if (isNaN(nextStartedAt.getTime())) return NextResponse.json({ error: "Invalid startedAt date" }, { status: 400 });
    if (isNaN(nextStoppedAt.getTime())) return NextResponse.json({ error: "Invalid stoppedAt date" }, { status: 400 });
    if (nextStoppedAt <= nextStartedAt) return NextResponse.json({ error: "stoppedAt must be after startedAt" }, { status: 400 });

    await ensurePeriodUnlocked(session.workspaceId, nextStartedAt, nextStoppedAt);
    const nextDurationSeconds = Math.max(1, Math.floor((nextStoppedAt.getTime() - nextStartedAt.getTime()) / 1000));
    await enforceDailyHoursLimit(entry.userId, nextStartedAt, nextDurationSeconds, entry.id);

    const previous = { ...entry };
    entry.startedAt = nextStartedAt.toISOString();
    entry.stoppedAt = nextStoppedAt.toISOString();
    entry.durationSeconds = nextDurationSeconds;
    entry.description = body.description ?? entry.description;
    entry.projectId = body.projectId ?? entry.projectId;
    entry.goalId = body.goalId ?? entry.goalId;
    entry.tags = body.tags ? normalizeTags(body.tags) : entry.tags;
    entry.action = nextActionName;
    entry.hourlyRate = nextHourlyRate;

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "manual_edit",
      diff: {
        startedAt: { before: previous.startedAt, after: entry.startedAt },
        stoppedAt: { before: previous.stoppedAt, after: entry.stoppedAt },
        durationSeconds: { before: previous.durationSeconds, after: entry.durationSeconds },
        description: { before: previous.description ?? null, after: entry.description ?? null },
        projectId: { before: previous.projectId ?? null, after: entry.projectId ?? null },
        goalId: { before: previous.goalId ?? null, after: entry.goalId ?? null },
        tags: { before: previous.tags, after: entry.tags },
        action: { before: previous.action ?? null, after: entry.action ?? null },
        hourlyRate: { before: previous.hourlyRate ?? null, after: entry.hourlyRate ?? null },
      },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, nextDurationSeconds });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

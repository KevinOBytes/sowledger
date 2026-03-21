import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceAuthKey, ensurePeriodUnlocked, createTimeEntry } from "@/lib/security";
import { store, calculateEffectiveRate } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    const body = await req.json() as {
      entryId?: string;
      fractionSeconds?: number;
      taskId?: string;
      projectId?: string;
      action?: string;
      description?: string;
      tags?: string[];
      goalId?: string;
    };

    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    if (!body.fractionSeconds || body.fractionSeconds <= 0) {
      return NextResponse.json({ error: "fractionSeconds must be greater than 0" }, { status: 400 });
    }

    const entry = store.entries.get(body.entryId);
    if (!entry || entry.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const canManageOthers = session.role === "manager" || session.role === "owner";
    if (!canManageOthers && entry.userId !== session.sub) {
      return NextResponse.json({ error: "Cannot edit other users entries" }, { status: 403 });
    }
    requireRole("member", session.role);

    if (entry.status === "approved" || entry.status === "invoiced") {
      return NextResponse.json({ error: "Approved or invoiced entries are locked" }, { status: 409 });
    }

    if (!entry.stoppedAt || !entry.durationSeconds) {
      return NextResponse.json({ error: "Cannot split an open timer" }, { status: 400 });
    }

    if (body.fractionSeconds >= entry.durationSeconds) {
      return NextResponse.json({ error: "fractionSeconds must be strictly less than the original duration" }, { status: 400 });
    }

    if (body.projectId) {
      const project = store.projects.get(body.projectId);
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    const originalStartedAt = new Date(entry.startedAt);
    const originalStoppedAt = new Date(entry.stoppedAt);

    // Calculate new times
    // We trim the fraction from the END of the original entry.
    // So the original entry ends earlier by `fractionSeconds`.
    // The new entry starts where the original now ends, and stops at the original stop time.
    const splitPoint = new Date(originalStoppedAt.getTime() - body.fractionSeconds * 1000);

    await ensurePeriodUnlocked(session.workspaceId, originalStartedAt, originalStoppedAt);

    const previous = { ...entry };

    // Update original entry
    const newOriginalDuration = entry.durationSeconds - body.fractionSeconds;
    entry.stoppedAt = splitPoint.toISOString();
    entry.durationSeconds = newOriginalDuration;

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "split_original",
      diff: {
        stoppedAt: { before: previous.stoppedAt, after: entry.stoppedAt },
        durationSeconds: { before: previous.durationSeconds, after: entry.durationSeconds },
      },
    });

    // Create the new split entry
    const newEntry = createTimeEntry({
      workspaceId: session.workspaceId,
      userId: entry.userId, // keep same user
      taskId: body.taskId ?? entry.taskId,
      projectId: body.projectId ?? entry.projectId,
      goalId: body.goalId ?? entry.goalId,
      tags: body.tags ? normalizeTags(body.tags) : [...entry.tags],
      startedAt: splitPoint.toISOString(),
      stoppedAt: originalStoppedAt.toISOString(),
      durationSeconds: body.fractionSeconds,
      description: body.description ?? entry.description,
      action: body.action ?? entry.action,
      hourlyRate: body.action ? calculateEffectiveRate(entry.userId, session.workspaceId, body.action) : entry.hourlyRate,
      status: entry.status,
      source: "manual", // mark as manual since it was split
      collaborators: [...entry.collaborators],
      expenses: [], // usually we don't duplicate expenses on a split
    });

    return NextResponse.json({ ok: true, originalEntryId: entry.id, newEntryId: newEntry.id });
  } catch (error) {
    const err: unknown = error;
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? Number((err as Record<string, unknown>).status)
        : typeof (err as Record<string, unknown>)?.statusCode === "number"
        ? Number((err as Record<string, unknown>).statusCode)
        : 500;
    const message = (err as Error)?.message || "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}

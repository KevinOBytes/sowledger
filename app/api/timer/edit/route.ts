import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, dispatchWebhook, ensurePeriodUnlocked, PeriodLockedError } from "@/lib/security";
import { withTimeCapacity, assertBucketReplacement, TimeCapacityError, TimePrecisionError, TimeDataError, savedDuration } from "@/lib/time-capacity";
import { db } from "@/lib/db";
import { timeEntries, projects, goals, userActions, memberships } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { and, eq } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";
import { readRequestJson, workflowErrorResponse, WorkflowError, editedTimeDuration } from "@/lib/workflow-validation";

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();
    const body = await readRequestJson(req) as {
      entryId?: string; taskId?: string; startedAt?: string; stoppedAt?: string;
      description?: string; projectId?: string | null; goalId?: string | null;
      tags?: string[]; actionId?: string;
    };
    if (typeof body?.entryId !== "string" || !body.entryId || body.entryId.length > 255) throw new WorkflowError("Choose a time entry to edit.", 400);
    for (const key of ["projectId", "goalId"] as const) {
      if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== "string" || !body[key] || body[key]!.length > 255)) throw new WorkflowError("Choose a valid project or goal.", 400);
    }
    for (const key of ["taskId", "actionId", "startedAt", "stoppedAt", "description"] as const) {
      if (body[key] !== undefined && typeof body[key] !== "string") throw new WorkflowError("Entry details must be text.", 400);
    }
    if (body.description && body.description.length > 10000) throw new WorkflowError("Keep notes under 10,000 characters.", 400);
    if (body.taskId !== undefined && (!body.taskId.trim() || body.taskId.length > 255)) throw new WorkflowError("Enter a work label under 255 characters.", 400);
    if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((tag) => typeof tag !== "string" || tag.length > 255))) throw new WorkflowError("Choose valid tags.", 400);

    const [discovered] = await db.select({ userId: timeEntries.userId }).from(timeEntries).where(and(eq(timeEntries.id, body.entryId), eq(timeEntries.workspaceId, session.workspaceId)));
    if (!discovered) throw new WorkflowError("Time entry not found.", 404);
    const result = await withTimeCapacity({ workspaceId: session.workspaceId, userId: discovered.userId }, async (capacity) => {
      const { tx } = capacity;
      const [actor] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, session.sub))).for("share");
      if (!actor || !["member", "manager", "owner"].includes(actor.role)) throw new WorkflowError("Your workspace membership cannot edit time entries.", 403);
      const [entry] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, body.entryId!), eq(timeEntries.workspaceId, session.workspaceId))).for("update");
      if (!entry) throw new WorkflowError("Time entry not found.", 404);
      if (entry.userId !== discovered.userId) throw new WorkflowError("This entry's owner changed. Reload it before editing.", 409);
      const canManageOthers = actor.role === "manager" || actor.role === "owner";
      if (!canManageOthers && entry.userId !== session.sub) throw new WorkflowError("You can only edit your own time.", 403);
      if (entry.status === "approved" || entry.status === "invoiced") throw new WorkflowError("Approved or invoiced entries are locked.", 409);
      if (!entry.stoppedAt) throw new WorkflowError("Stop the timer before editing its time.", 409);
      if (!(entry.startedAt instanceof Date) || !(entry.stoppedAt instanceof Date) || !Number.isFinite(entry.startedAt.getTime()) || !Number.isFinite(entry.stoppedAt.getTime()) || entry.stoppedAt < entry.startedAt) throw new TimeDataError();
      entry.durationSeconds = entry.durationSeconds === null ? null : savedDuration(entry.durationSeconds).seconds;
      entry.accumulatedSeconds = savedDuration(entry.accumulatedSeconds).seconds;
      if (body.projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
        if (!project) throw new WorkflowError("Project not found.", 400);
      }
      if (body.goalId) {
        const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId)));
        if (!goal) throw new WorkflowError("Goal not found.", 400);
      }
      let action = entry.action;
      let hourlyRate = entry.hourlyRate;
      if (body.actionId !== undefined) {
        if (body.actionId === "") { action = null; hourlyRate = null; }
        else {
          const [rate] = await tx.select().from(userActions).where(and(eq(userActions.id, body.actionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, entry.userId)));
          if (!rate) throw new WorkflowError("Rate not found for this person.", 400);
          action = rate.name;
          hourlyRate = rate.hourlyRate;
        }
      }
      const startedAt = new Date(body.startedAt ?? entry.startedAt);
      const stoppedAt = new Date(body.stoppedAt ?? entry.stoppedAt);
      if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(stoppedAt.getTime()) || stoppedAt < startedAt) throw new WorkflowError("Choose a valid start and end time.", 400);
      const duration = editedTimeDuration({ ...entry, stoppedAt: entry.stoppedAt }, startedAt, stoppedAt);
      await ensurePeriodUnlocked(session.workspaceId, entry.startedAt, entry.stoppedAt, tx);
      await ensurePeriodUnlocked(session.workspaceId, startedAt, stoppedAt, tx);
      await assertBucketReplacement(capacity, { before: [entry], after: [{ ...entry, startedAt, durationSeconds: duration.durationSeconds }] });
      const updates = {
        taskId: body.taskId?.trim() ?? entry.taskId,
        startedAt, stoppedAt, durationSeconds: duration.durationSeconds,
        description: body.description !== undefined ? body.description : entry.description,
        projectId: body.projectId !== undefined ? body.projectId : entry.projectId,
        goalId: body.goalId !== undefined ? body.goalId : entry.goalId,
        tags: body.tags !== undefined ? normalizeTags(body.tags) : entry.tags,
        action, hourlyRate, isPaused: false, pausedAt: null,
        accumulatedSeconds: duration.accumulatedSeconds,
        status: "draft" as const,
      };
      const [updated] = await tx.update(timeEntries).set(updates).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.userId, discovered.userId))).returning({ id: timeEntries.id });
      if (!updated) throw new WorkflowError("This entry changed. Reload it before editing.", 409);
      const diff: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of Object.keys(updates) as Array<keyof typeof updates>) diff[key] = { before: entry[key], after: updates[key] };
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub, eventType: "manual_edit", diff }, tx);
      return { entryId: entry.id, nextDurationSeconds: duration.durationSeconds, diff };
    });
    after(async () => { await dispatchWebhook(session.workspaceId, "manual_edit", result.diff); });
    return NextResponse.json({ ok: true, entryId: result.entryId, nextDurationSeconds: result.nextDurationSeconds, status: "draft" });
  } catch (error) {
    if (error instanceof PeriodLockedError || error instanceof TimeDataError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof TimeCapacityError || error instanceof TimePrecisionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return workflowErrorResponse(error, "Could not save this entry. Please try again.", { route: "/api/timer/edit", method: "PATCH" });
  }
}

import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, dispatchWebhook, ensurePeriodUnlocked, PeriodLockedError } from "@/lib/security";
import { withTimeCapacity, assertBucketReplacement, storedDuration, savedDuration, TimeCapacityError, TimePrecisionError, TimeDataError } from "@/lib/time-capacity";
import { db } from "@/lib/db";
import { timeEntries, projects, goals, memberships } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { calculateEffectiveRate } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const body = await readRequestJson(req) as {
      entryId?: string; fractionSeconds?: number; taskId?: string; projectId?: string;
      action?: string; description?: string; tags?: string[]; goalId?: string;
    };
    if (typeof body?.entryId !== "string" || !body.entryId || body.entryId.length > 255 || typeof body.fractionSeconds !== "number" || !Number.isFinite(body.fractionSeconds) || body.fractionSeconds <= 0) throw new WorkflowError("Choose an entry and a positive duration to split.", 400);
    for (const key of ["taskId", "projectId", "goalId", "action", "description"] as const) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || body[key]!.length > (key === "description" ? 10000 : 255))) throw new WorkflowError("Enter valid details for the split entry.", 400);
    }
    if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((tag) => typeof tag !== "string" || tag.length > 255))) throw new WorkflowError("Choose valid tags.", 400);
    const fractionSeconds = body.fractionSeconds;
    const [discovered] = await db.select({ userId: timeEntries.userId }).from(timeEntries).where(and(eq(timeEntries.id, body.entryId), eq(timeEntries.workspaceId, session.workspaceId)));
    if (!discovered) throw new WorkflowError("Time entry not found.", 404);
    const result = await withTimeCapacity({ workspaceId: session.workspaceId, userId: discovered.userId }, async (capacity) => {
      const { tx } = capacity;
      const [actor] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, session.sub))).for("share");
      if (!actor || !["member", "manager", "owner"].includes(actor.role)) throw new WorkflowError("Your workspace membership cannot split time entries.", 403);
      const [entry] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, body.entryId!), eq(timeEntries.workspaceId, session.workspaceId))).for("update");
      if (!entry) throw new WorkflowError("Time entry not found.", 404);
      if (entry.userId !== discovered.userId) throw new WorkflowError("This entry's owner changed. Reload it before splitting.", 409);
      if (actor.role !== "manager" && actor.role !== "owner" && entry.userId !== session.sub) throw new WorkflowError("You can only split your own time.", 403);
      if (entry.status === "approved" || entry.status === "invoiced") throw new WorkflowError("Approved or invoiced entries are locked.", 409);
      entry.durationSeconds = entry.durationSeconds === null ? null : savedDuration(entry.durationSeconds).seconds;
      entry.accumulatedSeconds = savedDuration(entry.accumulatedSeconds).seconds;
      if (!Number.isFinite(entry.startedAt.getTime()) || (entry.stoppedAt && (!Number.isFinite(entry.stoppedAt.getTime()) || entry.stoppedAt < entry.startedAt))) throw new TimeDataError();
      if (!entry.stoppedAt || !entry.durationSeconds || fractionSeconds >= entry.durationSeconds) throw new WorkflowError("The split must be shorter than the completed entry.", 400);
      if (body.projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
        if (!project) throw new WorkflowError("Project not found.", 400);
      }
      if (body.goalId) {
        const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId)));
        if (!goal) throw new WorkflowError("Goal not found.", 400);
      }
      await ensurePeriodUnlocked(session.workspaceId, entry.startedAt, entry.stoppedAt, tx);
      const splitPoint = new Date(entry.stoppedAt.getTime() - fractionSeconds * 1000);
      if (!Number.isFinite(splitPoint.getTime()) || splitPoint <= entry.startedAt || splitPoint >= entry.stoppedAt) throw new WorkflowError("Choose a split point strictly inside the completed time range.", 400);
      const tail = storedDuration(fractionSeconds);
      const original = storedDuration(entry.durationSeconds);
      const head = storedDuration(original.seconds - fractionSeconds);
      if (head.units === BigInt("0") || tail.units === BigInt("0") || head.units + tail.units !== original.units) throw new TimePrecisionError("This split cannot preserve the recorded duration at the supported precision. Choose a different split duration.");
      const nextDuration = head.seconds;
      const hourlyRate = body.action ? await calculateEffectiveRate(entry.userId, session.workspaceId, body.action) : entry.hourlyRate;
      const newId = crypto.randomUUID();
      await assertBucketReplacement(capacity, { before: [entry], after: [{ ...entry, durationSeconds: nextDuration }, { ...entry, id: newId, startedAt: splitPoint, durationSeconds: tail.seconds }] });
      const [updated] = await tx.update(timeEntries).set({ stoppedAt: splitPoint, durationSeconds: nextDuration, status: "draft", isPaused: false, pausedAt: null }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.userId, discovered.userId))).returning({ id: timeEntries.id });
      if (!updated) throw new WorkflowError("This entry changed. Reload it before splitting.", 409);
      await tx.insert(timeEntries).values({
        id: newId, workspaceId: session.workspaceId, userId: entry.userId,
        taskId: body.taskId?.trim() || entry.taskId, projectId: body.projectId ?? entry.projectId,
        goalId: body.goalId ?? entry.goalId, tags: body.tags ? normalizeTags(body.tags) : entry.tags,
        startedAt: splitPoint, stoppedAt: entry.stoppedAt, durationSeconds: tail.seconds,
        description: body.description ?? entry.description, action: body.action ?? entry.action,
        hourlyRate: hourlyRate ?? null, status: "draft", source: "manual", collaborators: entry.collaborators, expenses: [],
      });
      const diff = {
        stoppedAt: { before: entry.stoppedAt, after: splitPoint }, durationSeconds: { before: entry.durationSeconds, after: nextDuration }, status: { before: entry.status, after: "draft" }, splitEntryId: { before: null, after: newId },
      };
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub, eventType: "split_original", diff }, tx);
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: newId, actorUserId: session.sub, eventType: "split_created", diff: {
        sourceEntryId: { before: null, after: entry.id }, durationSeconds: { before: null, after: tail.seconds },
      } }, tx);
      return { originalEntryId: entry.id, newEntryId: newId, diff };
    });
    after(async () => { await dispatchWebhook(session.workspaceId, "split_original", result.diff); });
    return NextResponse.json({ ok: true, originalEntryId: result.originalEntryId, newEntryId: result.newEntryId });
  } catch (error) {
    if (error instanceof PeriodLockedError || error instanceof TimeDataError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof TimeCapacityError || error instanceof TimePrecisionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return workflowErrorResponse(error, "Could not split this entry. Please try again.", { route: "/api/timer/split", method: "POST" });
  }
}

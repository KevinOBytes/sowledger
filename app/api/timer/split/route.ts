import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, dispatchWebhook, ensurePeriodUnlocked } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries, projects, goals } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { calculateEffectiveRate } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";
import { WorkflowError, workflowErrorResponse } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const body = await req.json() as {
      entryId?: string; fractionSeconds?: number; taskId?: string; projectId?: string;
      action?: string; description?: string; tags?: string[]; goalId?: string;
    };
    if (typeof body?.entryId !== "string" || !body.entryId || body.entryId.length > 255 || typeof body.fractionSeconds !== "number" || !Number.isFinite(body.fractionSeconds) || body.fractionSeconds <= 0) throw new WorkflowError("Choose an entry and a positive duration to split.", 400);
    for (const key of ["taskId", "projectId", "goalId", "action", "description"] as const) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || body[key]!.length > (key === "description" ? 10000 : 255))) throw new WorkflowError("Enter valid details for the split entry.", 400);
    }
    if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((tag) => typeof tag !== "string" || tag.length > 255))) throw new WorkflowError("Choose valid tags.", 400);
    const fractionSeconds = body.fractionSeconds;
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, body.entryId!), eq(timeEntries.workspaceId, session.workspaceId))).for("update");
      if (!entry) throw new WorkflowError("Time entry not found.", 404);
      if (session.role !== "manager" && session.role !== "owner" && entry.userId !== session.sub) throw new WorkflowError("You can only split your own time.", 403);
      if (entry.status === "approved" || entry.status === "invoiced") throw new WorkflowError("Approved or invoiced entries are locked.", 409);
      if (!entry.stoppedAt || !entry.durationSeconds || fractionSeconds >= entry.durationSeconds) throw new WorkflowError("The split must be shorter than the completed entry.", 400);
      if (body.projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
        if (!project) throw new WorkflowError("Project not found.", 400);
      }
      if (body.goalId) {
        const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId)));
        if (!goal) throw new WorkflowError("Goal not found.", 400);
      }
      try { await ensurePeriodUnlocked(session.workspaceId, entry.startedAt, entry.stoppedAt); }
      catch { throw new WorkflowError("This entry is in a locked period.", 409); }
      const splitPoint = new Date(entry.stoppedAt.getTime() - fractionSeconds * 1000);
      const nextDuration = entry.durationSeconds - fractionSeconds;
      const hourlyRate = body.action ? await calculateEffectiveRate(entry.userId, session.workspaceId, body.action) : entry.hourlyRate;
      const newId = crypto.randomUUID();
      await tx.update(timeEntries).set({ stoppedAt: splitPoint, durationSeconds: nextDuration, status: "draft", isPaused: false, pausedAt: null }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId)));
      await tx.insert(timeEntries).values({
        id: newId, workspaceId: session.workspaceId, userId: entry.userId,
        taskId: body.taskId?.trim() || entry.taskId, projectId: body.projectId ?? entry.projectId,
        goalId: body.goalId ?? entry.goalId, tags: body.tags ? normalizeTags(body.tags) : entry.tags,
        startedAt: splitPoint, stoppedAt: entry.stoppedAt, durationSeconds: fractionSeconds,
        description: body.description ?? entry.description, action: body.action ?? entry.action,
        hourlyRate: hourlyRate ?? null, status: "draft", source: "manual", collaborators: entry.collaborators, expenses: [],
      });
      const diff = {
        stoppedAt: { before: entry.stoppedAt, after: splitPoint }, durationSeconds: { before: entry.durationSeconds, after: nextDuration }, status: { before: entry.status, after: "draft" }, splitEntryId: { before: null, after: newId },
      };
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub, eventType: "split_original", diff }, tx);
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: newId, actorUserId: session.sub, eventType: "split_created", diff: {
        sourceEntryId: { before: null, after: entry.id }, durationSeconds: { before: null, after: fractionSeconds },
      } }, tx);
      return { originalEntryId: entry.id, newEntryId: newId, diff };
    });
    after(async () => { await dispatchWebhook(session.workspaceId, "split_original", result.diff); });
    return NextResponse.json({ ok: true, originalEntryId: result.originalEntryId, newEntryId: result.newEntryId });
  } catch (error) { return workflowErrorResponse(error, "Could not split this entry. Please try again."); }
}

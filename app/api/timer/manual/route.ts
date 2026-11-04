import { NextRequest, NextResponse, after } from "next/server";
import { getAppOrigin } from "@/lib/app-url";
import { requireSession, requireRole } from "@/lib/auth";
import { ensurePeriodUnlocked, PeriodLockedError } from "@/lib/security";
import { withTimeCapacity, assertBucketReplacement, storedDuration, TimeCapacityError, TimePrecisionError, TimeDataError } from "@/lib/time-capacity";
import { db } from "@/lib/db";
import { projects, goals, userActions, scheduledWorkBlocks } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { timeEntries } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { lockScheduledBlockForEntry } from "@/lib/scheduled-block-entry";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { and, eq } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await readRequestJson(req) as {
      taskId?: string;
      description?: string;
      collaborators?: string[];
      projectId?: string;
      goalId?: string;
      tags?: string[];
      actionId?: string;
      startedAt: string;
      stoppedAt: string;
      scheduledBlockId?: string;
      source?: "manual" | "calendar";
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (!body.startedAt || !body.stoppedAt) {
      return NextResponse.json({ error: "startedAt and stoppedAt are required for manual entries" }, { status: 400 });
    }

    const startedAt = new Date(body.startedAt);
    const stoppedAt = new Date(body.stoppedAt);

    if (isNaN(startedAt.getTime()) || isNaN(stoppedAt.getTime())) {
      return NextResponse.json({ error: "Invalid date formats" }, { status: 400 });
    }

    if (stoppedAt <= startedAt) {
      return NextResponse.json({ error: "stoppedAt must be after startedAt" }, { status: 400 });
    }

    const durationSeconds = storedDuration(Math.max(1, Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000))).seconds;

    if (body.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
      if (!project) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    if (body.goalId) {
      const [goal] = await db.select().from(goals).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId)));
      if (!goal) {
        return NextResponse.json({ error: "Invalid goalId" }, { status: 400 });
      }
    }

    const entry = await withTimeCapacity({ workspaceId: session.workspaceId, userId: session.sub }, async (capacity) => {
      const { tx } = capacity;
      const id = crypto.randomUUID();
      await ensurePeriodUnlocked(session.workspaceId, startedAt, stoppedAt, tx);
      await assertBucketReplacement(capacity, { before: [], after: [{ id, workspaceId: session.workspaceId, userId: session.sub, startedAt, durationSeconds }] });
      const block = body.scheduledBlockId
        ? await lockScheduledBlockForEntry(tx, { blockId: body.scheduledBlockId, workspaceId: session.workspaceId, userId: session.sub })
        : undefined;
      // Omission inherits the schedule's work type; an explicit empty string
      // clears it. Read it after locking so a concurrent edit cannot go stale.
      const inheritedActionId = body.actionId ?? block?.actionId;
      let actionName: string | null = null;
      let hourlyRate: number | null = null;
      if (inheritedActionId) {
        const [uAction] = await tx.select().from(userActions).where(and(eq(userActions.id, inheritedActionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub)));
        if (!uAction) throw new WorkflowError("Invalid actionId", 400);
        actionName = uAction.name;
        hourlyRate = uAction.hourlyRate;
      }

      const [newEntry] = await tx.insert(timeEntries).values({
        id,
        workspaceId: session.workspaceId,
        userId: session.sub,
        scheduledBlockId: body.scheduledBlockId || null,
        taskId: body.taskId || "manual-entry",
        projectId: body.projectId || null,
        goalId: body.goalId || null,
        tags: normalizeTags(body.tags),
        startedAt,
        stoppedAt,
        durationSeconds,
        description: body.description || null,
        status: "draft",
        source: body.source === "calendar" ? "calendar" : "manual",
        collaborators: body.collaborators ?? [],
        expenses: [],
        action: actionName,
        hourlyRate,
      }).returning();

      if (body.scheduledBlockId) {
        await tx.update(scheduledWorkBlocks).set({
          status: "completed",
          linkedTimeEntryId: newEntry.id,
          updatedAt: new Date(),
        }).where(and(eq(scheduledWorkBlocks.id, body.scheduledBlockId), eq(scheduledWorkBlocks.workspaceId, session.workspaceId), eq(scheduledWorkBlocks.userId, session.sub)));
      }

      return { ...newEntry, durationSeconds };
    });

    after(() => {
      dispatchIntegrationNotification(session.workspaceId, "time_entry.created", {
        title: "Completed work logged",
        body: `${entry.description || entry.taskId} (${Math.round(durationSeconds / 60)} min, ${entry.source})`,
        url: `${getAppOrigin()}/activity`,
      }).catch(() => {});
    });

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    if (error instanceof PeriodLockedError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof TimeCapacityError || error instanceof TimePrecisionError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof TimeDataError) return NextResponse.json({ error: error.message }, { status: 409 });
    return workflowErrorResponse(error, "Could not save this time entry. Please try again.", { route: "/api/timer/manual", method: "POST" });
  }
}

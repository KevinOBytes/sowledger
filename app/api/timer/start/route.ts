import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse, after } from "next/server";
import { getAppOrigin } from "@/lib/app-url";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, goals, userActions, scheduledWorkBlocks, timeEntries } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { lockScheduledBlockForEntry } from "@/lib/scheduled-block-entry";
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
      scheduledBlockId?: string;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (!body.taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

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

    let actionName: string | undefined;
    let hourlyRate: number | undefined;

    if (body.actionId) {
      const [uAction] = await db.select().from(userActions).where(and(eq(userActions.id, body.actionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub)));
      if (!uAction) {
        return NextResponse.json({ error: "Invalid actionId" }, { status: 400 });
      }
      actionName = uAction.name;
      hourlyRate = uAction.hourlyRate ?? undefined;
    }

    const entryData = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      userId: session.sub,
      scheduledBlockId: body.scheduledBlockId || null,
      taskId: body.taskId,
      projectId: body.projectId || null,
      goalId: body.goalId || null,
      tags: normalizeTags(body.tags),
      startedAt: new Date(),
      stoppedAt: null,
      durationSeconds: null,
      description: body.description || null,
      status: "draft" as const,
      source: "web" as const,
      collaborators: body.collaborators ?? [],
      expenses: [],
      action: actionName || null,
      hourlyRate: hourlyRate ?? null,
    };

    const entry = await db.transaction(async (tx) => {
      if (body.scheduledBlockId) {
        await lockScheduledBlockForEntry(tx, { blockId: body.scheduledBlockId, workspaceId: session.workspaceId, userId: session.sub });
      }
      const [newEntry] = await tx.insert(timeEntries).values(entryData).returning();

      if (body.scheduledBlockId) {
        await tx.update(scheduledWorkBlocks).set({
          status: "in_progress",
          linkedTimeEntryId: newEntry.id,
          updatedAt: new Date(),
        }).where(and(eq(scheduledWorkBlocks.id, body.scheduledBlockId), eq(scheduledWorkBlocks.workspaceId, session.workspaceId), eq(scheduledWorkBlocks.userId, session.sub)));
      }

      return newEntry;
    });

    after(() => {
      dispatchIntegrationNotification(session.workspaceId, "time_entry.created", {
        title: "Timer started",
        body: entry.description || entry.taskId,
        url: `${getAppOrigin()}/dashboard`,
      }).catch(() => {});
    });

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the timer started. Check your active timers before trying again.", { route: "/api/timer/start", method: "POST" });
  }
}

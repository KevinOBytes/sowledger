import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { createTimeEntry, enforceAuthKey } from "@/lib/security";
import { store } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      taskId?: string;
      description?: string;
      collaborators?: string[];
      projectId?: string;
      goalId?: string;
      tags?: string[];
      actionId?: string;
    };

    if (!body.taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

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

    let actionName: string | undefined;
    let hourlyRate: number | undefined;

    if (body.actionId) {
      const uAction = store.userActions.get(body.actionId);
      if (!uAction || uAction.workspaceId !== session.workspaceId || uAction.userId !== session.sub) {
        return NextResponse.json({ error: "Invalid actionId" }, { status: 400 });
      }
      actionName = uAction.name;
      hourlyRate = uAction.hourlyRate;
    }

    const entry = createTimeEntry({
      workspaceId: session.workspaceId,
      userId: session.sub,
      taskId: body.taskId,
      projectId: body.projectId,
      goalId: body.goalId,
      tags: normalizeTags(body.tags),
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      durationSeconds: null,
      description: body.description,
      status: "draft",
      source: "web",
      collaborators: body.collaborators ?? [],
      expenses: [],
      action: actionName,
      hourlyRate: hourlyRate,
    });

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status =
      typeof err?.status === "number"
        ? err.status
        : typeof err?.statusCode === "number"
        ? err.statusCode
        : 500;
    const message = typeof err?.message === "string" ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}

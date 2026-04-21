import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { createTimeEntry, enforceAuthKey } from "@/lib/security";
import { store } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      provider?: "google" | "outlook";
      events?: Array<{ id: string; title: string; startsAt: string; endsAt: string }>;
      assigneeUserId?: string;
      projectId?: string;
      goalId?: string;
      tags?: string[];
    };

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

    const importedIds: string[] = [];
    for (const event of body.events ?? []) {
      const started = new Date(event.startsAt);
      const ended = new Date(event.endsAt);
      const durationSeconds = Math.max(0, Math.floor((ended.getTime() - started.getTime()) / 1000));

      const draft = createTimeEntry({
        workspaceId: session.workspaceId,
        userId: body.assigneeUserId ?? session.sub,
        taskId: `calendar:${event.id}`,
        projectId: body.projectId,
        goalId: body.goalId,
        tags: normalizeTags(body.tags),
        billable: false,
        description: event.title,
        startedAt: started.toISOString(),
        stoppedAt: ended.toISOString(),
        durationSeconds,
        status: "draft",
        source: "calendar",
        collaborators: [],
        expenses: [],
      });
      importedIds.push(draft.id);
    }

    return NextResponse.json({
      ok: true,
      provider: body.provider ?? "google",
      imported: importedIds.length,
      importedIds,
      message: "Events imported as suggested draft entries.",
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

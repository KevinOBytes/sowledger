import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const goals = [...store.goals.values()].filter((item) => item.workspaceId === session.workspaceId);
    return NextResponse.json({ ok: true, goals });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      name?: string;
      projectId?: string;
      targetHours?: number;
      dueDate?: string;
    };

    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (body.projectId) {
      const project = store.projects.get(body.projectId);
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    const goal = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: body.name,
      projectId: body.projectId,
      targetHours: body.targetHours,
      dueDate: body.dueDate,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    store.goals.set(goal.id, goal);
    return NextResponse.json({ ok: true, goal });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      goalId?: string;
      name?: string;
      projectId?: string;
      targetHours?: number;
      dueDate?: string;
      completed?: boolean;
    };

    if (!body.goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 });

    const goal = store.goals.get(body.goalId);
    if (!goal || goal.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    if (body.projectId) {
      const project = store.projects.get(body.projectId);
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    goal.name = body.name ?? goal.name;
    goal.projectId = body.projectId ?? goal.projectId;
    goal.targetHours = body.targetHours ?? goal.targetHours;
    goal.dueDate = body.dueDate ?? goal.dueDate;
    goal.completed = body.completed ?? goal.completed;

    return NextResponse.json({ ok: true, goal });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const goalId = req.nextUrl.searchParams.get("goalId");
    if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 });

    const goal = store.goals.get(goalId);
    if (!goal || goal.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    store.goals.delete(goalId);
    for (const entry of store.entries.values()) {
      if (entry.workspaceId === session.workspaceId && entry.goalId === goalId) {
        entry.goalId = undefined;
      }
    }

    return NextResponse.json({ ok: true, deletedGoalId: goalId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { store, KanbanColumn, ProjectTask } from "@/lib/store";

function getAuthStatus(error: unknown): number {
  const err: unknown = error;
  if (err && ((err as Record<string, unknown>).code === "FORBIDDEN" || (err as Record<string, unknown>).status === 403 || (err as Record<string, unknown>).message === "Forbidden")) {
    return 403;
  }
  return 401;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const projectId = req.nextUrl.searchParams.get("projectId");
    let tasks = [...store.tasks.values()].filter((t) => t.workspaceId === session.workspaceId);
    
    if (projectId) {
       tasks = tasks.filter(t => t.projectId === projectId);
    }

    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      projectId: string;
      parentId?: string;
      title?: string;
      description?: string;
      status?: KanbanColumn;
      position?: number;
      dueDate?: string;
      assigneeId?: string;
      estimatedHours?: number;
      blockedByTaskIds?: string[];
    };

    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const task: ProjectTask = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      projectId: body.projectId,
      parentId: body.parentId,
      title: body.title,
      description: body.description,
      status: body.status ?? "todo",
      position: body.position ?? Date.now(),
      dueDate: body.dueDate,
      assigneeId: body.assigneeId,
      estimatedHours: body.estimatedHours,
      blockedByTaskIds: body.blockedByTaskIds,
      createdAt: new Date().toISOString(),
    };

    store.tasks.set(task.id, task);
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      taskId: string;
      title?: string;
      description?: string;
      status?: KanbanColumn;
      position?: number;
      dueDate?: string;
      assigneeId?: string;
      parentId?: string;
      estimatedHours?: number | null;
      blockedByTaskIds?: string[];
    };

    if (!body.taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

    const task = store.tasks.get(body.taskId);
    if (!task || task.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (body.title !== undefined) task.title = body.title;
    if (body.description !== undefined) task.description = body.description;
    if (body.status !== undefined) task.status = body.status;
    if (body.position !== undefined) task.position = body.position;
    if (body.dueDate !== undefined && (body.dueDate === "" || body.dueDate.trim() !== "")) task.dueDate = body.dueDate || undefined;
    if (body.assigneeId !== undefined && (body.assigneeId === "" || body.assigneeId.trim() !== "")) task.assigneeId = body.assigneeId || undefined;
    if (body.parentId !== undefined && (body.parentId === "" || body.parentId.trim() !== "")) task.parentId = body.parentId || undefined;
    if (body.estimatedHours !== undefined) task.estimatedHours = body.estimatedHours === null ? undefined : body.estimatedHours;
    if (body.blockedByTaskIds !== undefined) task.blockedByTaskIds = body.blockedByTaskIds;

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const taskId = req.nextUrl.searchParams.get("taskId");
    if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

    const task = store.tasks.get(taskId);
    if (!task || task.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Delete task itself
    store.tasks.delete(taskId);

    // Naive cascading delete for subtasks
    for (const t of store.tasks.values()) {
        if (t.workspaceId === session.workspaceId && t.parentId === taskId) {
            store.tasks.delete(t.id);
        }
    }

    return NextResponse.json({ ok: true, deletedTaskId: taskId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

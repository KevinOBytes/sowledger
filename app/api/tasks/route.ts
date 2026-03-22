import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { KanbanColumn } from "@/lib/store";

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
    
    let query = db.select().from(projectTasks).where(eq(projectTasks.workspaceId, session.workspaceId));
    
    if (projectId) {
       query = db.select().from(projectTasks).where(and(eq(projectTasks.workspaceId, session.workspaceId), eq(projectTasks.projectId, projectId)));
    }

    const tasks = await query;
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
      attachments?: { name: string; url: string; size?: number }[];
    };

    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const newTask = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      projectId: body.projectId,
      parentId: body.parentId || null,
      title: body.title,
      description: body.description || null,
      status: body.status ?? "todo",
      position: body.position ?? Date.now(),
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      assigneeId: body.assigneeId || null,
      estimatedHours: body.estimatedHours || null,
      blockedByTaskIds: body.blockedByTaskIds || null,
      attachments: body.attachments || null,
    };

    const [task] = await db.insert(projectTasks).values(newTask).returning();
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
      description?: string | null;
      status?: KanbanColumn;
      position?: number;
      dueDate?: string | null;
      assigneeId?: string | null;
      parentId?: string | null;
      estimatedHours?: number | null;
      blockedByTaskIds?: string[] | null;
      attachments?: { name: string; url: string; size?: number }[] | null;
    };

    if (!body.taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

    const [existing] = await db.select().from(projectTasks).where(eq(projectTasks.id, body.taskId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const updates: Partial<typeof projectTasks.$inferInsert> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.position !== undefined) updates.position = body.position;
    if (body.dueDate !== undefined) updates.dueDate = (body.dueDate === "" || body.dueDate?.trim() === "") ? null : new Date(body.dueDate!);
    if (body.assigneeId !== undefined) updates.assigneeId = (body.assigneeId === "" || body.assigneeId?.trim() === "") ? null : body.assigneeId;
    if (body.parentId !== undefined) updates.parentId = (body.parentId === "" || body.parentId?.trim() === "") ? null : body.parentId;
    if (body.estimatedHours !== undefined) updates.estimatedHours = body.estimatedHours;
    if (body.blockedByTaskIds !== undefined) updates.blockedByTaskIds = body.blockedByTaskIds;
    if (body.attachments !== undefined) updates.attachments = body.attachments;

    const [task] = await db.update(projectTasks).set(updates).where(eq(projectTasks.id, body.taskId)).returning();
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

    const [existing] = await db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Delete task itself
    await db.delete(projectTasks).where(eq(projectTasks.id, taskId));

    // Naive cascading delete for subtasks
    await db.delete(projectTasks).where(and(eq(projectTasks.workspaceId, session.workspaceId), eq(projectTasks.parentId, taskId)));

    return NextResponse.json({ ok: true, deletedTaskId: taskId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

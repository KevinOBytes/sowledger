import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { projectTasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask } from "@/lib/task-mutations";
import { readRequestJson, workflowErrorResponse } from "@/lib/workflow-validation";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const projectId = req.nextUrl.searchParams.get("projectId");
    
    let query = db.select().from(projectTasks).where(eq(projectTasks.workspaceId, session.workspaceId));
    
    if (projectId) {
       query = db.select().from(projectTasks).where(and(eq(projectTasks.workspaceId, session.workspaceId), eq(projectTasks.projectId, projectId)));
    }

    const tasks = await query;
    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your tasks. Please try again.", { route: "/api/tasks", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const task = await createWorkspaceTask(session.workspaceId, await readRequestJson(req), "native");
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return workflowErrorResponse(error, "Could not create this task. Please try again.", { route: "/api/tasks", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const task = await updateWorkspaceTask(session.workspaceId, await readRequestJson(req), "native");
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return workflowErrorResponse(error, "Could not update this task. Please try again.", { route: "/api/tasks", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const taskId = await deleteWorkspaceTask(session.workspaceId, req.nextUrl.searchParams.get("taskId"));
    return NextResponse.json({ ok: true, deletedTaskId: taskId });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the task was deleted. Check your task list before trying again.", { route: "/api/tasks", method: "DELETE" });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { goals, memberships, projects, timeEntries } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq, and } from "drizzle-orm";
import { parseDueDate } from "@/lib/date-input";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

async function validateAssignedUser(workspaceId: string, assignedUserId?: string | null) {
  if (!assignedUserId) return true;
  const [membership] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, assignedUserId)));
  return Boolean(membership);
}

export async function GET() {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("member", session.role);

    const data = await db.select().from(goals).where(eq(goals.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, goals: data });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your goals. Please try again.", { route: "/api/goals", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await readRequestJson(req) as {
      name?: string;
      projectId?: string;
      assignedUserId?: string;
      description?: string;
      recurrence?: "none" | "weekly" | "monthly" | "quarterly" | "yearly";
      targetHours?: number;
      targetAmount?: number;
      targetType?: "hours" | "amount";
      dueDate?: string;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    const normalizedName = body.name?.trim();
    if (!normalizedName) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (normalizedName.length > 120) return NextResponse.json({ error: "name must be 120 chars or fewer" }, { status: 400 });
    
    if (body.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
      if (!project) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }
    if (!(await validateAssignedUser(session.workspaceId, body.assignedUserId))) {
      return NextResponse.json({ error: "Invalid assignedUserId" }, { status: 400 });
    }

    const newGoal = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: normalizedName,
      projectId: body.projectId || null,
      assignedUserId: body.assignedUserId || null,
      description: body.description || null,
      recurrence: body.recurrence || "none",
      targetHours: body.targetHours || null,
      targetAmount: body.targetAmount || null,
      targetType: body.targetType || "hours",
      dueDate: parseDueDate(body.dueDate),
      completed: false,
    };

    const [goal] = await db.insert(goals).values(newGoal).returning();
    return NextResponse.json({ ok: true, goal });
  } catch (error) {
    return workflowErrorResponse(error, "Could not create this goal. Please try again.", { route: "/api/goals", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await readRequestJson(req) as {
      goalId?: string;
      name?: string;
      projectId?: string | null;
      assignedUserId?: string | null;
      description?: string | null;
      recurrence?: "none" | "weekly" | "monthly" | "quarterly" | "yearly";
      targetHours?: number | null;
      targetAmount?: number | null;
      targetType?: "hours" | "amount";
      dueDate?: string | null;
      completed?: boolean;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (!body.goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 });

    const [existing] = await db.select().from(goals).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId)));
    if (!existing) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    if (body.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
      if (!project) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }
    if (body.assignedUserId !== undefined && !(await validateAssignedUser(session.workspaceId, body.assignedUserId))) {
      return NextResponse.json({ error: "Invalid assignedUserId" }, { status: 400 });
    }

    const updates: Partial<typeof goals.$inferInsert> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json({ error: "name must be a string" }, { status: 400 });
      }
      const normalizedName = body.name.trim();
      if (!normalizedName) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      if (normalizedName.length > 120) return NextResponse.json({ error: "name must be 120 chars or fewer" }, { status: 400 });
      updates.name = normalizedName;
    }
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.assignedUserId !== undefined) updates.assignedUserId = body.assignedUserId;
    if (body.description !== undefined) updates.description = body.description;
    if (body.recurrence !== undefined) updates.recurrence = body.recurrence;
    if (body.targetHours !== undefined) updates.targetHours = body.targetHours;
    if (body.targetAmount !== undefined) updates.targetAmount = body.targetAmount;
    if (body.targetType !== undefined) updates.targetType = body.targetType;
    if (body.dueDate !== undefined) updates.dueDate = parseDueDate(body.dueDate);
    if (body.completed !== undefined) updates.completed = body.completed;

    const [goal] = await db.update(goals).set(updates).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId))).returning();
    return NextResponse.json({ ok: true, goal });
  } catch (error) {
    return workflowErrorResponse(error, "Could not update this goal. Please try again.", { route: "/api/goals", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("manager", session.role);

    const goalId = req.nextUrl.searchParams.get("goalId");
    if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 });

    const [existing] = await db.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, session.workspaceId)));
    if (!existing) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    await db.delete(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, session.workspaceId)));

    await db.update(timeEntries).set({ goalId: null }).where(and(eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.goalId, goalId)));

    return NextResponse.json({ ok: true, deletedGoalId: goalId });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the goal was deleted. Check your goals before trying again.", { route: "/api/goals", method: "DELETE" });
  }
}

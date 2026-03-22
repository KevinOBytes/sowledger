import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { goals, projects, timeEntries } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

function getAuthStatus(error: unknown): number {
  const err: unknown = error;
  if (err && ((err as Record<string, unknown>).code === "FORBIDDEN" || (err as Record<string, unknown>).status === 403 || (err as Record<string, unknown>).message === "Forbidden")) {
    return 403;
  }
  return 401;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const data = await db.select().from(goals).where(eq(goals.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, goals: data });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
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
      const [project] = await db.select().from(projects).where(eq(projects.id, body.projectId));
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    const newGoal = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: body.name,
      projectId: body.projectId || null,
      targetHours: body.targetHours || null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      completed: false,
    };

    const [goal] = await db.insert(goals).values(newGoal).returning();
    return NextResponse.json({ ok: true, goal });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      goalId?: string;
      name?: string;
      projectId?: string | null;
      targetHours?: number | null;
      dueDate?: string | null;
      completed?: boolean;
    };

    if (!body.goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 });

    const [existing] = await db.select().from(goals).where(eq(goals.id, body.goalId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    if (body.projectId) {
      const [project] = await db.select().from(projects).where(eq(projects.id, body.projectId));
      if (!project || project.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    const updates: Partial<typeof goals.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.targetHours !== undefined) updates.targetHours = body.targetHours;
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.completed !== undefined) updates.completed = body.completed;

    const [goal] = await db.update(goals).set(updates).where(eq(goals.id, body.goalId)).returning();
    return NextResponse.json({ ok: true, goal });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const goalId = req.nextUrl.searchParams.get("goalId");
    if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 });

    const [existing] = await db.select().from(goals).where(eq(goals.id, goalId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    await db.delete(goals).where(eq(goals.id, goalId));

    await db.update(timeEntries).set({ goalId: null }).where(and(eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.goalId, goalId)));

    return NextResponse.json({ ok: true, deletedGoalId: goalId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

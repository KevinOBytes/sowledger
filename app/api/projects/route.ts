import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
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

    const data = await db.select().from(projects).where(eq(projects.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, projects: data });
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
      billingModel?: "hourly" | "fixed_fee" | "hybrid";
      percentComplete?: number;
      clientId?: string;
      description?: string;
      color?: string;
      hourlyRate?: number;
      budgetType?: "hours" | "fees" | "none";
      budgetAmount?: number;
      budgetAlertThreshold?: number;
      startDate?: string;
      endDate?: string;
      isPrivate?: boolean;
    };

    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "projects");
    if (!limits.allowed) {
      return NextResponse.json({ error: limits.error }, { status: 402 }); // 402 Payment Required
    }

    const newProject = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      clientId: body.clientId || null,
      name: body.name,
      description: body.description || null,
      color: body.color || "#3b82f6",
      billingModel: body.billingModel ?? "hourly",
      hourlyRate: body.hourlyRate || null,
      budgetType: body.budgetType || "none",
      budgetAmount: body.budgetAmount || null,
      budgetAlertThreshold: body.budgetAlertThreshold ?? 80,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      isPrivate: body.isPrivate ?? false,
      percentComplete: Math.max(0, Math.min(100, body.percentComplete ?? 0)),
    };

    const [project] = await db.insert(projects).values(newProject).returning();
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      projectId?: string;
      name?: string;
      clientId?: string;
      description?: string;
      color?: string;
      billingModel?: "hourly" | "fixed_fee" | "hybrid";
      hourlyRate?: number;
      budgetType?: "hours" | "fees" | "none";
      budgetAmount?: number;
      budgetAlertThreshold?: number;
      startDate?: string;
      endDate?: string;
      isPrivate?: boolean;
      status?: "active" | "archived";
      percentComplete?: number;
    };

    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const [existing] = await db.select().from(projects).where(eq(projects.id, body.projectId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updates: Partial<typeof projects.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.clientId !== undefined) updates.clientId = body.clientId;
    if (body.description !== undefined) updates.description = body.description;
    if (body.color !== undefined) updates.color = body.color;
    if (body.billingModel !== undefined) updates.billingModel = body.billingModel;
    if (body.hourlyRate !== undefined) updates.hourlyRate = body.hourlyRate;
    if (body.budgetType !== undefined) updates.budgetType = body.budgetType;
    if (body.budgetAmount !== undefined) updates.budgetAmount = body.budgetAmount;
    if (body.budgetAlertThreshold !== undefined) updates.budgetAlertThreshold = body.budgetAlertThreshold;
    if (body.startDate !== undefined) updates.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) updates.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.isPrivate !== undefined) updates.isPrivate = body.isPrivate;
    if (body.status !== undefined) updates.status = body.status;
    if (body.percentComplete !== undefined) updates.percentComplete = Math.max(0, Math.min(100, body.percentComplete));

    const [project] = await db.update(projects).set(updates).where(eq(projects.id, body.projectId)).returning();
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const [existing] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await db.delete(projects).where(eq(projects.id, projectId));

    // Also need to clear projectId from time entries and goals
    // Wait, let's keep it simple by querying them
    // Actually, in schema.ts, projectId doesn't have ON DELETE SET NULL for time entries and goals, we must do it manually or let schema handle it?
    // In lib/store.ts: 
    // for (const entry of ...) entry.projectId = undefined;
    
    // We can do this with Drizzle:
    const { timeEntries, goals } = await import("@/lib/db/schema");
    await db.update(timeEntries).set({ projectId: null }).where(and(eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.projectId, projectId)));
    await db.update(goals).set({ projectId: null }).where(and(eq(goals.workspaceId, session.workspaceId), eq(goals.projectId, projectId)));

    return NextResponse.json({ ok: true, deletedProjectId: projectId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

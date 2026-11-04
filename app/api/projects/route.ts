import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { createWorkspaceProject } from "@/lib/project-creation";
import { deleteUnusedWorkspaceProject, updateWorkspaceProject } from "@/lib/project-history";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { eq, and } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const data = await db.select().from(projects).where(eq(projects.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, projects: data });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your projects. Please try again.", { route: "/api/projects", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = await readRequestJson(req) as {
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
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    const normalizedName = body.name?.trim();
    if (!normalizedName) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (normalizedName.length > 120) return NextResponse.json({ error: "name must be 120 chars or fewer" }, { status: 400 });

    if (body.clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, body.clientId), eq(clients.workspaceId, session.workspaceId)));
      if (!client) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    const newProject = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      clientId: body.clientId || null,
      name: normalizedName,
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

    const result = await createWorkspaceProject(newProject);
    if (!result.allowed) return NextResponse.json({ error: result.error }, { status: 402 });
    return NextResponse.json({ ok: true, project: result.project });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the project was created. Check your project list before trying again.", { route: "/api/projects", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = await readRequestJson(req) as {
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
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const [existing] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updates: Partial<typeof projects.$inferInsert> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json({ error: "name must be a string" }, { status: 400 });
      }
      const normalizedName = body.name.trim();
      if (!normalizedName) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      if (normalizedName.length > 120) return NextResponse.json({ error: "name must be 120 chars or fewer" }, { status: 400 });
      updates.name = normalizedName;
    }
    if (body.clientId !== undefined) {
      if (body.clientId) {
        const [client] = await db
          .select({ id: clients.id })
          .from(clients)
          .where(and(eq(clients.id, body.clientId), eq(clients.workspaceId, session.workspaceId)));
        if (!client) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
      }
      updates.clientId = body.clientId;
    }
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

    const project = await updateWorkspaceProject(session.workspaceId, body.projectId, updates);
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return workflowErrorResponse(error, "Could not update the project. Please try again.", { route: "/api/projects", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    await deleteUnusedWorkspaceProject(session.workspaceId, projectId);

    return NextResponse.json({ ok: true, deletedProjectId: projectId });
  } catch (error) {
    return workflowErrorResponse(error, "Could not delete the project. Please try again.");
  }
}

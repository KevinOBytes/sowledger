import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { store } from "@/lib/store";

function getAuthStatus(error: unknown): number {
  const err = error as any;

  if (err && (err.code === "FORBIDDEN" || err.status === 403 || err.message === "Forbidden")) {
    return 403;
  }

  return 401;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const projects = [...store.projects.values()].filter((item) => item.workspaceId === session.workspaceId);
    return NextResponse.json({ ok: true, projects });
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
    };

    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const project = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: body.name,
      billingModel: body.billingModel ?? "hourly",
      percentComplete: Math.max(0, Math.min(100, body.percentComplete ?? 0)),
      createdAt: new Date().toISOString(),
    };

    store.projects.set(project.id, project);
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
      billingModel?: "hourly" | "fixed_fee" | "hybrid";
      percentComplete?: number;
    };

    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const project = store.projects.get(body.projectId);
    if (!project || project.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    project.name = body.name ?? project.name;
    project.billingModel = body.billingModel ?? project.billingModel;
    project.percentComplete = body.percentComplete !== undefined
      ? Math.max(0, Math.min(100, body.percentComplete))
      : project.percentComplete;

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

    const project = store.projects.get(projectId);
    if (!project || project.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    store.projects.delete(projectId);
    for (const entry of store.entries.values()) {
      if (entry.workspaceId === session.workspaceId && entry.projectId === projectId) {
        entry.projectId = undefined;
      }
    }
    for (const goal of store.goals.values()) {
      if (goal.workspaceId === session.workspaceId && goal.projectId === projectId) {
        goal.projectId = undefined;
      }
    }

    return NextResponse.json({ ok: true, deletedProjectId: projectId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

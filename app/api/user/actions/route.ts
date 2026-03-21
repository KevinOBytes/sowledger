import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store, UserAction } from "@/lib/store";

function getAuthStatus(error: unknown): number {
  const err: unknown = error;
  if (err && (err as Record<string, unknown>).code === "FORBIDDEN" || (err as Record<string, unknown>).status === 403 || (err as Record<string, unknown>).message === "Forbidden") {
    return 403;
  }
  return 401;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const actions = [...store.userActions.values()].filter(
      (item) => item.workspaceId === session.workspaceId && item.userId === session.sub
    );
    return NextResponse.json({ ok: true, actions });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      name?: string;
      hourlyRate?: number;
    };

    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const existingNames = [...store.userActions.values()]
      .filter((a) => a.workspaceId === session.workspaceId && a.userId === session.sub)
      .map(a => a.name.toLowerCase());

    if (existingNames.includes(body.name.toLowerCase())) {
        return NextResponse.json({ error: "An action with this name already exists" }, { status: 400 });
    }

    const action: UserAction = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      userId: session.sub,
      name: body.name,
      hourlyRate: body.hourlyRate,
    };

    store.userActions.set(action.id, action);
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      actionId?: string;
      name?: string;
      hourlyRate?: number;
    };

    if (!body.actionId) return NextResponse.json({ error: "actionId is required" }, { status: 400 });

    const action = store.userActions.get(body.actionId);
    if (!action || action.workspaceId !== session.workspaceId || action.userId !== session.sub) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    if (body.name) {
       const existingNames = [...store.userActions.values()]
      .filter((a) => a.workspaceId === session.workspaceId && a.userId === session.sub && a.id !== body.actionId)
      .map(a => a.name.toLowerCase());

      if (existingNames.includes(body.name.toLowerCase())) {
          return NextResponse.json({ error: "An action with this name already exists" }, { status: 400 });
      }
      action.name = body.name;
    }
    
    if (body.hourlyRate !== undefined) action.hourlyRate = body.hourlyRate;
    // to unset rate, could pass null, but we don't handle null gracefully here yet, so keeping it simple.

    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const actionId = req.nextUrl.searchParams.get("actionId");
    if (!actionId) return NextResponse.json({ error: "actionId is required" }, { status: 400 });

    const action = store.userActions.get(actionId);
    if (!action || action.workspaceId !== session.workspaceId || action.userId !== session.sub) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    store.userActions.delete(actionId);

    return NextResponse.json({ ok: true, deletedActionId: actionId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getAuthStatus(error) });
  }
}

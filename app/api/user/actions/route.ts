import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberships, userActions } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";

export async function GET(req?: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const userId = req?.nextUrl.searchParams.get("userId") || session.sub;
    if (userId !== session.sub) {
      requireRole("manager", session.role);
      const [member] = await db.select().from(memberships).where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, userId)));
      if (!member) throw new WorkflowError("This assignee is not a member of this workspace.", 404);
    }

    const actions = await db.select().from(userActions)
      .where(and(eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, userId)));
    return NextResponse.json({ ok: true, actions });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your work types. Please try again.", { route: "/api/user/actions", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await readRequestJson(req) as {
      name?: string;
      hourlyRate?: number;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const existingNames = await db.select({ name: userActions.name }).from(userActions)
      .where(and(eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub)));
    
    if (existingNames.some(a => a.name.toLowerCase() === body.name!.toLowerCase())) {
        return NextResponse.json({ error: "An action with this name already exists" }, { status: 400 });
    }

    const newAction = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      userId: session.sub,
      name: body.name,
      hourlyRate: body.hourlyRate ?? null,
    };

    const [action] = await db.insert(userActions).values(newAction).returning();
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the work type was created. Check your work types before trying again.", { route: "/api/user/actions", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await readRequestJson(req) as {
      actionId?: string;
      name?: string;
      hourlyRate?: number | null;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (!body.actionId) return NextResponse.json({ error: "actionId is required" }, { status: 400 });

    const [action] = await db.select().from(userActions).where(and(eq(userActions.id, body.actionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub)));
    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    const updates: Partial<typeof userActions.$inferInsert> = {};

    if (body.name) {
       const existingNames = await db.select({ name: userActions.name }).from(userActions)
         .where(and(
           eq(userActions.workspaceId, session.workspaceId),
           eq(userActions.userId, session.sub),
           ne(userActions.id, body.actionId)
         ));

      if (existingNames.some(a => a.name.toLowerCase() === body.name!.toLowerCase())) {
          return NextResponse.json({ error: "An action with this name already exists" }, { status: 400 });
      }
      updates.name = body.name;
    }
    
    if (body.hourlyRate !== undefined) updates.hourlyRate = body.hourlyRate;

    const [updatedAction] = await db.update(userActions).set(updates).where(and(eq(userActions.id, body.actionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub))).returning();
    return NextResponse.json({ ok: true, action: updatedAction });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the work type was changed. Check your work types before trying again.", { route: "/api/user/actions", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const actionId = req.nextUrl.searchParams.get("actionId");
    if (!actionId) return NextResponse.json({ error: "actionId is required" }, { status: 400 });

    const [action] = await db.select().from(userActions).where(and(eq(userActions.id, actionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub)));
    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    await db.delete(userActions).where(and(eq(userActions.id, actionId), eq(userActions.workspaceId, session.workspaceId), eq(userActions.userId, session.sub)));

    return NextResponse.json({ ok: true, deletedActionId: actionId });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the work type was deleted. Check your work types before trying again.", { route: "/api/user/actions", method: "DELETE" });
  }
}

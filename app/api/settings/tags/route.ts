import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceTags } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const data = await db.select().from(workspaceTags).where(eq(workspaceTags.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, tags: data });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      name?: string;
      color?: string;
      projectId?: string;
      isBillableDefault?: boolean;
    };
    if (!body.name || typeof body.name !== "string") return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    
    // Check if tag exists (globally or for this project)
    const existing = await db.select().from(workspaceTags)
      .where(and(eq(workspaceTags.workspaceId, session.workspaceId), eq(workspaceTags.name, body.name.trim().toLowerCase())));
    
    if (existing.length > 0) {
      return NextResponse.json({ error: "Tag with this name already exists" }, { status: 400 });
    }

    const [tag] = await db.insert(workspaceTags).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: body.name.trim().toLowerCase(),
      color: body.color || "#3b82f6",
      projectId: body.projectId || null,
      isBillableDefault: body.isBillableDefault ?? true,
    }).returning();

    return NextResponse.json({ ok: true, tag });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as {
      tagId?: string;
      name?: string;
      color?: string;
      projectId?: string | null;
      isBillableDefault?: boolean;
      status?: "active" | "archived";
    };

    if (!body.tagId) return NextResponse.json({ error: "tagId is required" }, { status: 400 });

    const [existing] = await db.select().from(workspaceTags).where(eq(workspaceTags.id, body.tagId));
    if (!existing || existing.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    const updates: Partial<typeof workspaceTags.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name.trim().toLowerCase();
    if (body.color !== undefined) updates.color = body.color;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.isBillableDefault !== undefined) updates.isBillableDefault = body.isBillableDefault;
    if (body.status !== undefined) updates.status = body.status;

    const [tag] = await db.update(workspaceTags).set(updates).where(eq(workspaceTags.id, body.tagId)).returning();
    return NextResponse.json({ ok: true, tag });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const [existing] = await db.select().from(workspaceTags).where(eq(workspaceTags.id, id));
    if (!existing || existing.workspaceId !== session.workspaceId) {
       return NextResponse.json({ error: "Tag metadata not found" }, { status: 404 });
    }

    await db.delete(workspaceTags).where(eq(workspaceTags.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
     return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

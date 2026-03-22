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

    const { name, color } = await req.json();
    if (!name || typeof name !== "string") return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    
    // Check if tag exists
    const existing = await db.select().from(workspaceTags).where(and(eq(workspaceTags.workspaceId, session.workspaceId), eq(workspaceTags.name, name.trim().toLowerCase())));
    
    if (existing.length > 0) {
      const [updated] = await db.update(workspaceTags).set({ color: color || "#3b82f6" }).where(eq(workspaceTags.id, existing[0].id)).returning();
      return NextResponse.json({ ok: true, tag: updated });
    }

    const [tag] = await db.insert(workspaceTags).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: name.trim().toLowerCase(),
      color: color || "#3b82f6",
    }).returning();

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

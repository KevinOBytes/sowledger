import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { organizations } from "@/lib/db/schema";

function getErrorStatus(error: unknown, fallback = 500): number {
  const err = error as Record<string, unknown>;
  if (err.code === "FORBIDDEN" || err.status === 403 || err.message === "Forbidden") return 403;
  if (err.code === "UNAUTHORIZED" || err.status === 401) return 401;
  return fallback;
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = (await req.json()) as {
      organizationId?: string;
      name?: string;
      type?: "internal" | "client" | "vendor" | "partner" | "other";
    };

    if (!body.organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, body.organizationId), eq(organizations.workspaceId, session.workspaceId)));

    if (!existing) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const updates: Partial<typeof organizations.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.type !== undefined) updates.type = body.type;

    const [organization] = await db
      .update(organizations)
      .set(updates)
      .where(and(eq(organizations.id, body.organizationId), eq(organizations.workspaceId, session.workspaceId)))
      .returning();
    return NextResponse.json({ ok: true, organization });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

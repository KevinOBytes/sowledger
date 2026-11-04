import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { organizations } from "@/lib/db/schema";

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = (await readRequestJson(req)) as {
      organizationId?: string;
      name?: string;
      type?: "internal" | "client" | "vendor" | "partner" | "other";
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

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
    return workflowErrorResponse(error, "We couldn't confirm the organization was updated. Check your organizations before trying again.", { route: "/api/organizations", method: "PATCH" });
  }
}

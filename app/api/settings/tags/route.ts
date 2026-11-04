import { readRequestJson, workflowErrorResponse } from "@/lib/workflow-validation";
import { createWorkspaceTag, updateWorkspaceTag, deleteWorkspaceTag } from "@/lib/tag-mutations";
import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceTags } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();
    const data = await db.select().from(workspaceTags).where(eq(workspaceTags.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, tags: data });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your tag settings. Please try again.", { route: "/api/settings/tags", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const tag = await createWorkspaceTag(session.workspaceId, await readRequestJson(req), true);

    return NextResponse.json({ ok: true, tag });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the tag was created. Check your tag list before trying again.", { route: "/api/settings/tags", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const tag = await updateWorkspaceTag(session.workspaceId, await readRequestJson(req), "native");
    return NextResponse.json({ ok: true, tag });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the tag was updated. Check your tag list before trying again.", { route: "/api/settings/tags", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();
    await deleteWorkspaceTag(session.workspaceId, req.nextUrl.searchParams.get("id"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the tag was deleted. Check your tag list before trying again.", { route: "/api/settings/tags", method: "DELETE" });
  }
}

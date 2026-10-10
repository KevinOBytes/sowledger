import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { reviewTimeEntry } from "@/lib/time-entry-review";
import { workflowErrorResponse } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { entryId?: string };
    if (typeof body?.entryId !== "string" || !body.entryId || body.entryId.length > 255) return NextResponse.json({ error: "Choose a time entry to approve." }, { status: 400 });
    return NextResponse.json(await reviewTimeEntry({ workspaceId: session.workspaceId, actorUserId: session.sub, entryId: body.entryId, decision: "approved" }));
  } catch (error) {
    return workflowErrorResponse(error, "Could not approve time. Please try again.");
  }
}

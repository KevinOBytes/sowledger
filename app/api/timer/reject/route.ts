import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { reviewTimeEntry } from "@/lib/time-entry-review";
import { workflowErrorResponse } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { entryId?: string; reason?: string };
    if (typeof body?.entryId !== "string" || !body.entryId || body.entryId.length > 255 || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 2000))) return NextResponse.json({ error: "Choose a time entry and keep the reason under 2,000 characters." }, { status: 400 });
    return NextResponse.json(await reviewTimeEntry({ workspaceId: session.workspaceId, actorUserId: session.sub, entryId: body.entryId, decision: "rejected", reason: body.reason }));
  } catch (error) {
    return workflowErrorResponse(error, "Could not send time back. Please try again.");
  }
}

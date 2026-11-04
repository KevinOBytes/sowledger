import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { enforceAuthKey, appendAuditLog } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await readRequestJson(req) as { businessDate?: string; submitted?: boolean };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    const businessDate = body.businessDate ? new Date(body.businessDate) : new Date();

    // Replaced in-memory store dailySubmissions tracking with an audit log
    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: "system", // Generic since it doesn't belong to a time entry
      actorUserId: session.sub,
      eventType: "compliance_check",
      diff: {
        businessDate: { before: null, after: businessDate.toISOString().slice(0, 10) },
        submitted: { before: null, after: body.submitted ?? true }
      }
    });

    return NextResponse.json({ ok: true, businessDate: businessDate.toISOString(), submitted: body.submitted ?? true });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the daily check was recorded. Check your daily check before trying again.", { route: "/api/compliance/daily-check", method: "POST" });
  }
}

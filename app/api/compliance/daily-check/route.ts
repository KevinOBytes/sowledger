import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError, requireSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { enforceAuthKey, appendAuditLog } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as { businessDate?: string; submitted?: boolean };
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
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

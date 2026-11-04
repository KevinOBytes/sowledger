import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { enforceStopRateLimit, PeriodLockedError, TimerStopRateLimitError } from "@/lib/security";
import { TimeDataError, TimePrecisionError } from "@/lib/time-capacity";
import { stopTimer } from "@/lib/timer-stop";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await enforceStopRateLimit(session.sub);

    const body = await readRequestJson(req) as { entryId?: string; endedAt?: string };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const result = await stopTimer({
      workspaceId: session.workspaceId,
      userId: session.sub,
      entryId: body.entryId,
      endedAt: body.endedAt ? new Date(body.endedAt) : new Date(),
    });
    return NextResponse.json(result);
  } catch (error) {
    // Preserve the existing user-facing lock/rate-limit responses, but never
    // send an unexpected database error (including query text) to the browser.
    if (error instanceof PeriodLockedError || error instanceof TimerStopRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof TimeDataError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof TimePrecisionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return workflowErrorResponse(error, "Could not stop this timer. Please try again.", { route: "/api/timer/stop", method: "POST" });
  }
}

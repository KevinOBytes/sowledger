import { NextRequest, NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { syncGoogleCalendar } from "@/lib/integrations/google-calendar";
import { WorkflowError, readRequestJson } from "@/lib/workflow-validation";

function parseOptionalDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new WorkflowError("Invalid sync date range", 400);
  return date;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await readRequestJson(req) as { start?: string; end?: string };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    const result = await syncGoogleCalendar({
      workspaceId: session.workspaceId,
      userId: session.sub,
      start: parseOptionalDate(body.start ?? null),
      end: parseOptionalDate(body.end ?? null),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't confirm the calendar sync. Review your calendar and integrations before trying again.", { route: "/api/integrations/google-calendar/sync", method: "POST" });
  }
}

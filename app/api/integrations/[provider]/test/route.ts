import { NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { testGoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { testQuickBooksConnection } from "@/lib/integrations/quickbooks";
import { testSlackConnection } from "@/lib/integrations/slack";

export async function POST(_req: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { provider } = await context.params;
    if (provider === "google_calendar") await testGoogleCalendarConnection(session.workspaceId);
    else if (provider === "slack") await testSlackConnection(session.workspaceId);
    else if (provider === "quickbooks") await testQuickBooksConnection(session.workspaceId);
    else return NextResponse.json({ error: "Unsupported integration provider" }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Connection test succeeded" });
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't test this integration. Please try again.", { route: "/api/integrations/[provider]/test", method: "POST" });
  }
}

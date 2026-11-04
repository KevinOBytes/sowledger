import { NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { createIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { buildGoogleCalendarAuthUrl, googleCalendarConfigured } from "@/lib/integrations/google-calendar";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    if (!googleCalendarConfigured()) return NextResponse.json({ error: "Google Calendar OAuth is not configured" }, { status: 503 });
    const state = createIntegrationOAuthState({ provider: "google_calendar", workspaceId: session.workspaceId, userId: session.sub, returnTo: "/integrations" });
    return NextResponse.redirect(buildGoogleCalendarAuthUrl(state));
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't start Google Calendar setup. Please try again.", { route: "/api/integrations/google-calendar/oauth/start", method: "GET" });
  }
}

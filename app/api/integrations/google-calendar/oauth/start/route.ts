import { NextResponse } from "next/server";

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
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

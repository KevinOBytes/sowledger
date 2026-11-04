import { NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { createIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { buildSlackAuthUrl, slackConfigured } from "@/lib/integrations/slack";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    if (!slackConfigured()) return NextResponse.json({ error: "Slack OAuth is not configured" }, { status: 503 });
    const state = createIntegrationOAuthState({ provider: "slack", workspaceId: session.workspaceId, userId: session.sub, returnTo: "/integrations" });
    return NextResponse.redirect(buildSlackAuthUrl(state));
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't start Slack setup. Please try again.", { route: "/api/integrations/slack/oauth/start", method: "GET" });
  }
}

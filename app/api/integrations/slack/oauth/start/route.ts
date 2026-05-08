import { NextResponse } from "next/server";

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
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

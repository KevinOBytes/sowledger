import { NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { createIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { buildQuickBooksAuthUrl, quickBooksConfigured } from "@/lib/integrations/quickbooks";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    if (!quickBooksConfigured()) return NextResponse.json({ error: "QuickBooks OAuth is not configured" }, { status: 503 });
    const state = createIntegrationOAuthState({ provider: "quickbooks", workspaceId: session.workspaceId, userId: session.sub, returnTo: "/integrations" });
    return NextResponse.redirect(buildQuickBooksAuthUrl(state));
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't start QuickBooks setup. Please try again.", { route: "/api/integrations/quickbooks/oauth/start", method: "GET" });
  }
}

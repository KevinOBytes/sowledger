import { NextResponse } from "next/server";

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
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

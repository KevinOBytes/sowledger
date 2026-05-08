import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { verifyIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { exchangeQuickBooksAuthorizationCode, storeQuickBooksConnection } from "@/lib/integrations/quickbooks";

function redirectTo(req: NextRequest, status: "connected" | "error", message?: string) {
  const url = new URL("/integrations", req.url);
  url.searchParams.set(status, "quickbooks");
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    const error = req.nextUrl.searchParams.get("error");
    if (error) return redirectTo(req, "error", error);
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const realmId = req.nextUrl.searchParams.get("realmId");
    if (!code || !state || !realmId) return redirectTo(req, "error", "Missing QuickBooks OAuth code, state, or realmId");
    const payload = verifyIntegrationOAuthState(state, "quickbooks");
    const session = await requireSession();
    requireRole("manager", session.role);
    if (session.workspaceId !== payload.workspaceId || session.sub !== payload.userId) {
      return redirectTo(req, "error", "QuickBooks OAuth state does not match the active session");
    }
    const token = await exchangeQuickBooksAuthorizationCode(code);
    await storeQuickBooksConnection({ workspaceId: session.workspaceId, userId: session.sub, realmId, token });
    return redirectTo(req, "connected");
  } catch (error) {
    return redirectTo(req, "error", error instanceof Error ? error.message : "QuickBooks connection failed");
  }
}

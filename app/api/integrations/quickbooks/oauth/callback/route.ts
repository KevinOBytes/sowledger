import { IntegrationProviderError } from "@/lib/integrations/errors";
import { reportUnexpectedRequestFailure } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { IntegrationOAuthStateError, verifyIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { exchangeQuickBooksAuthorizationCode, storeQuickBooksConnection } from "@/lib/integrations/quickbooks";

function redirectTo(req: NextRequest, status: "connected" | "error", message?: string) {
  const url = new URL("/integrations", req.url);
  url.searchParams.set(status, "quickbooks");
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url);
}

function redirectToLogin(req: NextRequest, message?: string) {
  const url = new URL("/login", req.url);
  if (message) url.searchParams.set("error", message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.has("error")) return redirectTo(req, "error", "QuickBooks setup was not completed. Start the connection again.");
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const realmId = req.nextUrl.searchParams.get("realmId");
    if (!code || !state || !realmId) return redirectTo(req, "error", "QuickBooks setup was not completed. Start the connection again.");
    const payload = verifyIntegrationOAuthState(state, "quickbooks");
    const session = await requireSession();
    requireRole("manager", session.role);
    if (session.workspaceId !== payload.workspaceId || session.sub !== payload.userId) {
      return redirectTo(req, "error", "QuickBooks setup was not completed. Start the connection again.");
    }
    const token = await exchangeQuickBooksAuthorizationCode(code);
    await storeQuickBooksConnection({ workspaceId: session.workspaceId, userId: session.sub, realmId, token });
    return redirectTo(req, "connected");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return redirectToLogin(req, "Your session expired during QuickBooks setup. Please log in and try again.");
    }
    if (error instanceof ForbiddenError) return redirectTo(req, "error", "QuickBooks setup needs workspace manager permission. Start the connection again.");
    if (error instanceof IntegrationOAuthStateError) return redirectTo(req, "error", "QuickBooks setup was not completed. Start the connection again.");
    reportUnexpectedRequestFailure({ route: "/api/integrations/quickbooks/oauth/callback", method: "GET" }, error instanceof IntegrationProviderError ? "upstream" : "unexpected");
    return redirectTo(req, "error", "We couldn't complete QuickBooks setup. Start the connection again.");
  }
}

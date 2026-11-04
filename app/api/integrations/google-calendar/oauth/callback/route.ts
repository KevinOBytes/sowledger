import { IntegrationProviderError } from "@/lib/integrations/errors";
import { reportUnexpectedRequestFailure } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/app-url";

import { requireRole, requireSession, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { exchangeGoogleAuthorizationCode, storeGoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { IntegrationOAuthStateError, verifyIntegrationOAuthState } from "@/lib/integrations/oauth-state";

function redirectTo(req: NextRequest, status: "connected" | "error", message?: string) {
  const base = getAppOrigin(undefined, req.nextUrl.origin);
  const url = new URL("/integrations", base);
  url.searchParams.set(status, "google_calendar");
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url);
}

function redirectToLogin(req: NextRequest, message?: string) {
  const base = getAppOrigin(undefined, req.nextUrl.origin);
  const url = new URL("/login", base);
  if (message) url.searchParams.set("error", message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.has("error")) return redirectTo(req, "error", "Google Calendar setup was not completed. Start the connection again.");
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    if (!code || !state) return redirectTo(req, "error", "Google Calendar setup was not completed. Start the connection again.");
    const payload = verifyIntegrationOAuthState(state, "google_calendar");
    const session = await requireSession();
    requireRole("manager", session.role);
    if (session.workspaceId !== payload.workspaceId || session.sub !== payload.userId) {
      return redirectTo(req, "error", "Google Calendar setup was not completed. Start the connection again.");
    }
    const token = await exchangeGoogleAuthorizationCode(code);
    await storeGoogleCalendarConnection({ workspaceId: session.workspaceId, userId: session.sub, token });
    return redirectTo(req, "connected");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return redirectToLogin(req, "Your session expired during the Google Calendar setup. Please log in and try again.");
    }
    if (error instanceof ForbiddenError) return redirectTo(req, "error", "Google Calendar setup needs workspace manager permission. Start the connection again.");
    if (error instanceof IntegrationOAuthStateError) return redirectTo(req, "error", "Google Calendar setup was not completed. Start the connection again.");
    reportUnexpectedRequestFailure({ route: "/api/integrations/google-calendar/oauth/callback", method: "GET" }, error instanceof IntegrationProviderError ? "upstream" : "unexpected");
    return redirectTo(req, "error", "We couldn't complete Google Calendar setup. Start the connection again.");
  }
}

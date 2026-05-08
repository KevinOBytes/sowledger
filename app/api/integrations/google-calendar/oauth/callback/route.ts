import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { getIntegrationConnection } from "@/lib/integrations/connections";
import { decryptSecret } from "@/lib/integrations/crypto";
import { exchangeGoogleAuthorizationCode, storeGoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { verifyIntegrationOAuthState } from "@/lib/integrations/oauth-state";

function redirectTo(req: NextRequest, status: "connected" | "error", message?: string) {
  const url = new URL("/integrations", req.url);
  url.searchParams.set(status, "google_calendar");
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    const error = req.nextUrl.searchParams.get("error");
    if (error) return redirectTo(req, "error", error);
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    if (!code || !state) return redirectTo(req, "error", "Missing Google OAuth code or state");
    const payload = verifyIntegrationOAuthState(state, "google_calendar");
    const session = await requireSession();
    requireRole("manager", session.role);
    if (session.workspaceId !== payload.workspaceId || session.sub !== payload.userId) {
      return redirectTo(req, "error", "Google OAuth state does not match the active session");
    }
    const existing = await getIntegrationConnection(session.workspaceId, "google_calendar");
    const token = await exchangeGoogleAuthorizationCode(code);
    const existingRefreshToken = existing ? decryptSecret(existing.credentials.refreshToken) : null;
    await storeGoogleCalendarConnection({ workspaceId: session.workspaceId, userId: session.sub, token, existingRefreshToken });
    return redirectTo(req, "connected");
  } catch (error) {
    return redirectTo(req, "error", error instanceof Error ? error.message : "Google Calendar connection failed");
  }
}

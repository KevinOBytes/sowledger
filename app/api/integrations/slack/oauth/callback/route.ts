import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { verifyIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { exchangeSlackAuthorizationCode, storeSlackOAuthConnection } from "@/lib/integrations/slack";

function redirectTo(req: NextRequest, status: "connected" | "error", message?: string) {
  const url = new URL("/integrations", req.url);
  url.searchParams.set(status, "slack");
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    const error = req.nextUrl.searchParams.get("error");
    if (error) return redirectTo(req, "error", error);
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    if (!code || !state) return redirectTo(req, "error", "Missing Slack OAuth code or state");
    const payload = verifyIntegrationOAuthState(state, "slack");
    const session = await requireSession();
    requireRole("manager", session.role);
    if (session.workspaceId !== payload.workspaceId || session.sub !== payload.userId) {
      return redirectTo(req, "error", "Slack OAuth state does not match the active session");
    }
    const oauth = await exchangeSlackAuthorizationCode(code);
    await storeSlackOAuthConnection({ workspaceId: session.workspaceId, userId: session.sub, oauth });
    return redirectTo(req, "connected");
  } catch (error) {
    return redirectTo(req, "error", error instanceof Error ? error.message : "Slack connection failed");
  }
}

import { NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { listIntegrationConnections, toPublicConnection } from "@/lib/integrations/connections";
import { googleCalendarConfigured } from "@/lib/integrations/google-calendar";
import { quickBooksConfigured } from "@/lib/integrations/quickbooks";
import { slackConfigured } from "@/lib/integrations/slack";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const connections = await listIntegrationConnections(session.workspaceId);
    return NextResponse.json({
      ok: true,
      canManage: session.role === "manager" || session.role === "owner",
      connections: connections.map(toPublicConnection),
      readiness: {
        googleCalendarOAuth: googleCalendarConfigured(),
        slackOAuth: slackConfigured(),
        slackManualWebhook: true,
        quickBooksOAuth: quickBooksConfigured(),
      },
    });
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't load your integrations. Please try again.", { route: "/api/integrations", method: "GET" });
  }
}

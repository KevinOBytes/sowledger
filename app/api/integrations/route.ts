import { NextResponse } from "next/server";

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
      connections: connections.map(toPublicConnection),
      readiness: {
        googleCalendarOAuth: googleCalendarConfigured(),
        slackOAuth: slackConfigured(),
        slackManualWebhook: true,
        quickBooksOAuth: quickBooksConfigured(),
      },
    });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 401 });
  }
}

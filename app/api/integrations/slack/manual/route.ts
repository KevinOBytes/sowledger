import { NextRequest, NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { toPublicConnection } from "@/lib/integrations/connections";
import { storeSlackWebhookConnection } from "@/lib/integrations/slack";
import { readRequestJson, WorkflowError } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await readRequestJson(req) as { webhookUrl?: string; channelLabel?: string };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    if (!body.webhookUrl) return NextResponse.json({ error: "Slack webhook URL is required" }, { status: 400 });
    const connection = await storeSlackWebhookConnection({ workspaceId: session.workspaceId, userId: session.sub, webhookUrl: body.webhookUrl, channelLabel: body.channelLabel ?? null });
    return NextResponse.json({ ok: true, connection: toPublicConnection(connection) });
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't confirm Slack was connected. Reload your integrations before trying again.", { route: "/api/integrations/slack/manual", method: "POST" });
  }
}

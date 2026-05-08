import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { toPublicConnection } from "@/lib/integrations/connections";
import { storeSlackWebhookConnection } from "@/lib/integrations/slack";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await req.json() as { webhookUrl?: string; channelLabel?: string };
    if (!body.webhookUrl) return NextResponse.json({ error: "Slack webhook URL is required" }, { status: 400 });
    const connection = await storeSlackWebhookConnection({ workspaceId: session.workspaceId, userId: session.sub, webhookUrl: body.webhookUrl, channelLabel: body.channelLabel ?? null });
    return NextResponse.json({ ok: true, connection: toPublicConnection(connection) });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

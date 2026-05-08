import { NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { testGoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { testQuickBooksConnection } from "@/lib/integrations/quickbooks";
import { testSlackConnection } from "@/lib/integrations/slack";

export async function POST(_req: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { provider } = await context.params;
    if (provider === "google_calendar") await testGoogleCalendarConnection(session.workspaceId);
    else if (provider === "slack") await testSlackConnection(session.workspaceId);
    else if (provider === "quickbooks") await testQuickBooksConnection(session.workspaceId);
    else return NextResponse.json({ error: "Unsupported integration provider" }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Connection test succeeded" });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

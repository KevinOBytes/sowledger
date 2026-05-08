import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { syncGoogleCalendar } from "@/lib/integrations/google-calendar";

function parseOptionalDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid sync date range");
  return date;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await req.json().catch(() => ({})) as { start?: string; end?: string };
    const result = await syncGoogleCalendar({
      workspaceId: session.workspaceId,
      userId: session.sub,
      start: parseOptionalDate(body.start ?? null),
      end: parseOptionalDate(body.end ?? null),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}

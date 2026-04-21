import { NextRequest, NextResponse } from "next/server";
import { enforceAuthKey } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { isNull, lt, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    await enforceAuthKey(req);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const thresholdDate = new Date(Date.now() - 1000 * 60 * 60 * 8);
  
  const stale = await db.select({
    id: timeEntries.id,
    workspaceId: timeEntries.workspaceId,
    userId: timeEntries.userId,
    startedAt: timeEntries.startedAt,
  }).from(timeEntries).where(and(
    isNull(timeEntries.stoppedAt),
    lt(timeEntries.startedAt, thresholdDate)
  )).limit(250);

  return NextResponse.json({
    ok: true,
    count: stale.length,
    stale,
    action: "Trigger email/slack alerts via Vercel Cron or Upstash Workflow",
  });
}

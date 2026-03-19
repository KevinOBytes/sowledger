import { NextRequest, NextResponse } from "next/server";
import { enforceAuthKey } from "@/lib/security";
import { store } from "@/lib/store";

export async function GET(req: NextRequest) {
  await enforceAuthKey(req);

  const threshold = Date.now() - 1000 * 60 * 60 * 8;
  const stale = [...store.entries.values()]
    .filter((entry) => !entry.stoppedAt && new Date(entry.startedAt).getTime() < threshold)
    .slice(0, 250)
    .map(({ id, workspaceId, userId, startedAt }) => ({ id, workspaceId, userId, startedAt }));

  return NextResponse.json({
    ok: true,
    count: stale.length,
    stale,
    action: "Trigger email/slack alerts via Vercel Cron or Upstash Workflow",
  });
}

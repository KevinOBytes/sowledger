import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as { entryId?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, body.entryId));
    if (!entry || entry.workspaceId !== session.workspaceId || entry.userId !== session.sub || entry.stoppedAt) {
      return NextResponse.json({ error: "No active timer found for entry" }, { status: 404 });
    }

    if (!entry.isPaused) {
      return NextResponse.json({ ok: true, message: "Timer is already running" });
    }

    const resumedAt = new Date();
    const pausedSeconds = entry.pausedAt ? Math.max(0, Math.floor((resumedAt.getTime() - entry.pausedAt.getTime()) / 1000)) : 0;

    await db.update(timeEntries).set({
      isPaused: false,
      pausedAt: null,
      accumulatedSeconds: entry.accumulatedSeconds + pausedSeconds,
    }).where(eq(timeEntries.id, body.entryId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}
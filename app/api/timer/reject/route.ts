import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { entryId?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, body.entryId), eq(timeEntries.workspaceId, session.workspaceId)));
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    if (!entry.stoppedAt) return NextResponse.json({ error: "Cannot reject running timer" }, { status: 409 });

    const before = entry.status;
    
    // Setting back to draft so user can edit and resubmit
    await db.update(timeEntries).set({ status: "draft" }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId)));

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "entry_rejected",
      diff: { status: { before, after: "draft" } },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, status: "draft" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

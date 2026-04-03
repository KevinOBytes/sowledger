import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { entryId?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, body.entryId));
    if (!entry || entry.workspaceId !== session.workspaceId) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    if (!entry.stoppedAt) return NextResponse.json({ error: "Cannot reject running timer" }, { status: 409 });

    const before = entry.status;
    
    // Setting back to draft so user can edit and resubmit
    await db.update(timeEntries).set({ status: "draft" }).where(eq(timeEntries.id, entry.id));

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

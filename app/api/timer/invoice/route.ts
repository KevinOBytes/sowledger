import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceAuthKey } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries, lockPeriods } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { entryId?: string; reason?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, body.entryId));
    if (!entry || entry.workspaceId !== session.workspaceId) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    if (!entry.stoppedAt) {
      return NextResponse.json(
        { error: "Cannot invoice a running entry. Stop the timer first." },
        { status: 400 },
      );
    }

    const before = entry.status;
    
    await db.update(timeEntries).set({ status: "invoiced" }).where(eq(timeEntries.id, entry.id));

    await db.insert(lockPeriods).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      periodStart: entry.startedAt!,
      periodEnd: entry.stoppedAt ?? entry.startedAt!,
      reason: body.reason ?? "Invoiced period",
      lockedByUserId: session.sub,
    });

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "entry_invoiced",
      diff: { status: { before, after: "invoiced" } },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, status: "invoiced" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceAuthKey } from "@/lib/security";
import { store } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { entryId?: string; reason?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const entry = store.entries.get(body.entryId);
    if (!entry || entry.workspaceId !== session.workspaceId) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const before = entry.status;
    entry.status = "invoiced";

    store.locks.push({
      workspaceId: session.workspaceId,
      periodStart: entry.startedAt,
      periodEnd: entry.stoppedAt ?? entry.startedAt,
      reason: body.reason ?? "Invoiced period",
      lockedByUserId: session.sub,
    });

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "entry_invoiced",
      diff: { status: { before, after: entry.status } },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, status: entry.status });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

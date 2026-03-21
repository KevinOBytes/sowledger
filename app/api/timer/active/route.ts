import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    // Get all running timers for the current user in this workspace
    const activeEntries = [...store.entries.values()].filter(
      (entry) =>
        entry.workspaceId === session.workspaceId &&
        entry.userId === session.sub &&
        entry.startedAt &&
        !entry.stoppedAt
    );

    return NextResponse.json({ ok: true, activeEntries });
  } catch (error) {
    const err: unknown = error;
    const status =
      typeof (err as Record<string, unknown>)?.status === "number"
        ? Number((err as Record<string, unknown>).status)
        : typeof (err as Record<string, unknown>)?.statusCode === "number"
        ? Number((err as Record<string, unknown>).statusCode)
        : 500;
    const message = (err as Error)?.message || "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}

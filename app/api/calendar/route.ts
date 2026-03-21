import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const entries = [...store.entries.values()].filter(e => e.workspaceId === session.workspaceId);
    const tasks = [...store.tasks.values()].filter(t => t.workspaceId === session.workspaceId);

    return NextResponse.json({ ok: true, entries, tasks });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

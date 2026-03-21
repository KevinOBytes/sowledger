import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    // Allow any member to view the planner
    requireRole("member", session.role);

    const workspaceId = session.workspaceId;

    // 1. Get all members of the workspace
    const memberIds = store.memberships
      .filter((m) => m.workspaceId === workspaceId)
      .map((m) => m.userId);

    const members = memberIds.map((id) => {
      const u = store.users.get(id);
      return {
        id,
        email: u?.email ?? "Unknown",
        displayName: u?.displayName,
      };
    });

    // 2. Get all unfinished tasks in the workspace
    const tasks = [...store.tasks.values()].filter(
      (t) => t.workspaceId === workspaceId && t.status !== "done"
    );

    return NextResponse.json({ ok: true, members, tasks });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

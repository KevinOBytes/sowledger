import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    // Only managers/owners can view approvals
    requireRole("manager", session.role);

    const pendingEntries = Array.from(store.entries.values())
      .filter((e) => e.workspaceId === session.workspaceId && e.status !== "approved" && e.status !== "invoiced")
      .map((e) => {
        const user = store.users.get(e.userId);
        const project = e.projectId ? store.projects.get(e.projectId) : null;
        return {
          ...e,
          userEmail: user?.email || "Unknown User",
          projectName: project?.name || "No Project",
        };
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return NextResponse.json({ ok: true, entries: pendingEntries });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

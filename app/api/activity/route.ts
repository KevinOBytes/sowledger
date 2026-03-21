import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const projectId = req.nextUrl.searchParams.get("projectId");

    let audits = store.audits.filter(a => a.workspaceId === session.workspaceId);

    if (projectId) {
      audits = audits.filter(a => {
        const entry = store.entries.get(a.timeEntryId);
        return entry?.projectId === projectId;
      });
    }

    const activities = audits
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50)
      .map(audit => {
        const user = store.users.get(audit.actorUserId);
        const entry = store.entries.get(audit.timeEntryId);
        return {
          id: audit.id,
          eventType: audit.eventType,
          diff: audit.diff,
          createdAt: audit.createdAt,
          actor: {
            name: user?.displayName || user?.email || "Unknown User",
            id: user?.id,
          },
          target: {
            id: entry?.id,
            description: entry?.description || "a time entry",
          }
        };
      });

    return NextResponse.json({ ok: true, activities });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

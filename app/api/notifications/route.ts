import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    const notifications = [...store.notifications.values()]
      .filter((n) => n.userId === session.sub && n.workspaceId === session.workspaceId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
    return NextResponse.json({ ok: true, notifications });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => ({}));
    const { notificationId, markAllRead } = body;

    const notifications = [...store.notifications.values()]
      .filter((n) => n.userId === session.sub && n.workspaceId === session.workspaceId);

    if (markAllRead) {
      for (const n of notifications) {
        n.read = true;
      }
    } else if (notificationId) {
      const target = store.notifications.get(notificationId);
      if (target && target.userId === session.sub) {
        target.read = true;
      } else {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    const notifs = await db.select().from(notifications).where(and(
      eq(notifications.workspaceId, session.workspaceId),
      eq(notifications.userId, session.sub)
    )).orderBy(desc(notifications.createdAt));
      
    return NextResponse.json({ ok: true, notifications: notifs });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => ({}));
    const { notificationId, markAllRead } = body;

    if (markAllRead) {
      await db.update(notifications)
        .set({ read: true })
        .where(and(
          eq(notifications.workspaceId, session.workspaceId),
          eq(notifications.userId, session.sub)
        ));
    } else if (notificationId) {
      const [target] = await db.select().from(notifications).where(eq(notifications.id, notificationId));
      if (target && target.userId === session.sub && target.workspaceId === session.workspaceId) {
        await db.update(notifications)
          .set({ read: true })
          .where(eq(notifications.id, notificationId));
      } else {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

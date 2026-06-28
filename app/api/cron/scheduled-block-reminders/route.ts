import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { scheduledWorkBlocks } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { enforceAuthKey } from "@/lib/security";

function isUnavailableReminderBlock(block: typeof scheduledWorkBlocks.$inferSelect) {
  const tags = Array.isArray(block.tags) ? block.tags.map((tag) => tag.toLowerCase()) : [];
  const title = block.title.toLowerCase();
  return tags.includes("unavailable")
    || tags.includes("external-calendar")
    || title.includes("out of office")
    || title.includes("unavailable")
    || title.startsWith("busy");
}

export async function GET(req: NextRequest) {
  try {
    await enforceAuthKey(req);
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 401 });
  }

  const now = new Date();
  const reminderWindowEnd = new Date(now.getTime() + 10 * 60 * 1000);
  const candidateBlocks = await db
    .select()
    .from(scheduledWorkBlocks)
    .where(and(
      eq(scheduledWorkBlocks.status, "planned"),
      isNull(scheduledWorkBlocks.reminderSentAt),
      gte(scheduledWorkBlocks.startsAt, now),
      lte(scheduledWorkBlocks.startsAt, reminderWindowEnd),
    ))
    .limit(200);
  const dueSoon = candidateBlocks.filter((block) => !isUnavailableReminderBlock(block)).slice(0, 100);

  for (const block of dueSoon) {
    await dispatchIntegrationNotification(block.workspaceId, "scheduled_block.reminder", {
      title: `Starting soon: ${block.title}`,
      body: `${new Date(block.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${new Date(block.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Open SOWLedger to start the timer, log it manually, reschedule, or skip.`,
      url: `${process.env.NEXT_PUBLIC_APP_URL || ""}/calendar`,
    });
    await db
      .update(scheduledWorkBlocks)
      .set({ reminderSentAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledWorkBlocks.id, block.id), eq(scheduledWorkBlocks.workspaceId, block.workspaceId)));
  }

  return NextResponse.json({ ok: true, reminded: dueSoon.length });
}

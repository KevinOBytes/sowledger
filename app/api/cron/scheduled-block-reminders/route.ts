import { NextRequest, NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/app-url";
import { and, asc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationSyncRecords, scheduledWorkBlocks } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { enforceAuthKey } from "@/lib/security";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import { UnauthorizedError } from "@/lib/auth";
import { reportUnexpectedRequestFailure } from "@/lib/workflow-validation";

function isUnavailableReminderBlock(block: typeof scheduledWorkBlocks.$inferSelect) {
  return isUnavailableScheduledBlock(block)
    || /^busy(?:\b|:)/i.test(block.title.trim())
    || block.tags.some((tag) => tag.trim().toLowerCase() === "busy");
}

export async function GET(req: NextRequest) {
  try {
    await enforceAuthKey(req);
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    reportUnexpectedRequestFailure({ route: "/api/cron/scheduled-block-reminders", method: "GET" });
    return NextResponse.json({ ok: false, error: "We couldn't authorize the reminder check. Please try again." }, { status: 500 });
  }

  const now = new Date();
  const deadline = Date.now() + 45_000;
  const reminderWindowEnd = new Date(now.getTime() + 10 * 60 * 1000);
  const pageSize = 200;
  let reminded = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  let recordingFailures = 0;
  let hasMore = false;
  let cursor: { startsAt: Date; id: string } | undefined;

  // Cursor pagination visits unavailable and unconfigured rows without letting
  // a permanently skipped first page hide later work. Provider acceptances and
  // elapsed time remain bounded; hasMore signals an uncounted later page.
  scan: while (true) {
    if (Date.now() >= deadline || reminded >= 100) { hasMore = true; break; }
    const candidateBlocks = await db.select().from(scheduledWorkBlocks).where(and(
      eq(scheduledWorkBlocks.status, "planned"),
      isNull(scheduledWorkBlocks.reminderSentAt),
      gte(scheduledWorkBlocks.startsAt, now),
      lte(scheduledWorkBlocks.startsAt, reminderWindowEnd),
      ...(cursor ? [or(
        gt(scheduledWorkBlocks.startsAt, cursor.startsAt),
        and(eq(scheduledWorkBlocks.startsAt, cursor.startsAt), gt(scheduledWorkBlocks.id, cursor.id)),
      )] : []),
    )).orderBy(asc(scheduledWorkBlocks.startsAt), asc(scheduledWorkBlocks.id)).limit(pageSize);

    for (const [index, candidate] of candidateBlocks.entries()) {
      if (Date.now() >= deadline || reminded >= 100) {
        deferred += candidateBlocks.length - index;
        hasMore = true;
        break scan;
      }
      cursor = { startsAt: candidate.startsAt, id: candidate.id };
      if (isUnavailableReminderBlock(candidate)) { skipped++; continue; }
      let accepted = false;
      try {
        const result = await db.transaction(async (tx) => {
          // Serialize reminders within this workspace without holding a row lock
          // across the provider call. Another workspace can still make progress.
          const lock = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('sowledger:scheduled-reminders'), hashtext(${candidate.workspaceId})) as acquired`);
          if (!lock.rows[0]?.acquired) return "deferred";
          const [block] = await tx.select().from(scheduledWorkBlocks).where(and(
            eq(scheduledWorkBlocks.id, candidate.id), eq(scheduledWorkBlocks.workspaceId, candidate.workspaceId),
            eq(scheduledWorkBlocks.status, "planned"), isNull(scheduledWorkBlocks.reminderSentAt),
            gte(scheduledWorkBlocks.startsAt, new Date()), lte(scheduledWorkBlocks.startsAt, reminderWindowEnd),
          )).limit(1);
          if (!block || isUnavailableReminderBlock(block)) return "skipped";
          const [providerLink] = await tx.select({ metadata: integrationSyncRecords.metadata }).from(integrationSyncRecords).where(and(
            eq(integrationSyncRecords.workspaceId, block.workspaceId),
            eq(integrationSyncRecords.provider, "google_calendar"),
            eq(integrationSyncRecords.resourceType, "scheduled_work_block"),
            eq(integrationSyncRecords.resourceId, block.id),
          )).limit(1);
          if (providerLink?.metadata.direction === "google_busy_to_sowledger") return "skipped";
          const remaining = deadline - Date.now();
          if (remaining <= 0) return "deferred";
          const delivery = await dispatchIntegrationNotification(block.workspaceId, "scheduled_block.reminder", {
            title: `Starting soon: ${block.title}`,
            body: `${new Date(block.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} - ${new Date(block.endsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC. Open SOWLedger to start the timer, log it manually, reschedule, or skip.`,
            url: `${getAppOrigin()}/calendar`,
          }, { signal: AbortSignal.timeout(remaining) });
          if (delivery.sent === 0) return delivery.failed > 0 ? "failed" : "skipped";
          accepted = true;
          const [recorded] = await tx.update(scheduledWorkBlocks)
            .set({ reminderSentAt: new Date(), updatedAt: new Date() })
            .where(and(
              eq(scheduledWorkBlocks.id, block.id), eq(scheduledWorkBlocks.workspaceId, block.workspaceId),
              eq(scheduledWorkBlocks.status, "planned"), isNull(scheduledWorkBlocks.reminderSentAt),
              eq(scheduledWorkBlocks.startsAt, block.startsAt),
            )).returning({ id: scheduledWorkBlocks.id });
          if (!recorded) throw new Error("Reminder block changed before acceptance could be recorded");
          return "sent";
        });
        if (result === "deferred") deferred++;
        else if (result === "skipped") skipped++;
        else if (result === "failed") failed++;
      } catch {
        if (accepted) recordingFailures++;
        else failed++;
        reportUnexpectedRequestFailure({ route: "/api/cron/scheduled-block-reminders", method: "GET" });
      }
      if (accepted) reminded++;
    }
    if (candidateBlocks.length < pageSize) break;
  }

  // "Reminded" means a configured provider accepted the notification, not
  // that a person received/read it. A lost response or failed stamp can still
  // require a retry; the advisory lock does not promise exactly-once delivery.
  return NextResponse.json({ ok: true, reminded, failed, skipped, deferred, hasMore, recordingFailures });
}

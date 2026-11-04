import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireSession, requireRole } from "@/lib/auth";
import { ensurePeriodUnlocked, PeriodLockedError, splitTimeWindowByUtcDay } from "@/lib/security";
import { withTimeCapacity, assertBucketReplacement, storedDuration, TimeCapacityError, TimePrecisionError, TimeDataError } from "@/lib/time-capacity";
import { db } from "@/lib/db";
import { goals, memberships, projects, timeEntries } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { and, eq, like, or } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

export async function POST(req: NextRequest) {
  try {
    await ensureWorkspaceSchema();
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await readRequestJson(req) as {
      provider?: "google" | "outlook";
      events?: Array<{ id: string; title: string; startsAt: string; endsAt: string }>;
      assigneeUserId?: string;
      projectId?: string;
      goalId?: string;
      tags?: string[];
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    const provider = body.provider ?? "google";
    if (provider !== "google" && provider !== "outlook") throw new WorkflowError("Choose Google or Outlook as the calendar provider.", 400);
    const rawEvents = body.events ?? [];
    if (!Array.isArray(rawEvents) || rawEvents.length > 100) throw new WorkflowError("Import no more than 100 calendar events at a time.", 400);
    const seen = new Set<string>();
    const events = rawEvents.map((event) => {
      if (!event || typeof event.id !== "string" || !event.id.trim() || event.id.length > 512 || typeof event.title !== "string" || !event.title.trim() || event.title.length > 1000 || typeof event.startsAt !== "string" || typeof event.endsAt !== "string") throw new WorkflowError("Each event needs an ID, title, and valid start and end times.", 400);
      if (seen.has(event.id)) throw new WorkflowError("Each calendar event can appear only once in a batch.", 400);
      seen.add(event.id);
      const startedAt = new Date(event.startsAt);
      const stoppedAt = new Date(event.endsAt);
      if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(stoppedAt.getTime()) || stoppedAt <= startedAt || stoppedAt.getTime() - startedAt.getTime() > 31 * 86400000) throw new WorkflowError("Each event needs a valid time range of no more than 31 days, ending after it starts.", 400);
      return { ...event, title: event.title.trim(), startedAt, stoppedAt };
    });

    if (body.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.workspaceId, session.workspaceId)));
      if (!project) {
        return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
      }
    }

    if (body.goalId) {
      const [goal] = await db.select().from(goals).where(and(eq(goals.id, body.goalId), eq(goals.workspaceId, session.workspaceId)));
      if (!goal) {
        return NextResponse.json({ error: "Invalid goalId" }, { status: 400 });
      }
    }

    const assigneeUserId = body.assigneeUserId ?? session.sub;
    const result = await withTimeCapacity({ workspaceId: session.workspaceId, userId: assigneeUserId }, async (capacity) => {
      const { tx } = capacity;
      // Serialize imports for this member so simultaneous retries see committed
      // provider identities and earlier entries in the batch count toward limits.
      const [assignee] = await tx.select({ userId: memberships.userId }).from(memberships)
        .where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, assigneeUserId))).for("update");
      if (!assignee) throw new WorkflowError("Invalid assigneeUserId", 400);
      const importedIds: string[] = [];
      let imported = 0;
      let skipped = 0;
      for (const event of events) {
        const identity = createHash("sha256").update(JSON.stringify([session.workspaceId, assigneeUserId, provider, event.id])).digest("hex");
        const taskId = `calendar:${provider}:${identity}`;
        const [existing] = await tx.select({ id: timeEntries.id }).from(timeEntries)
          .where(and(eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.userId, assigneeUserId), or(eq(timeEntries.taskId, taskId), like(timeEntries.id, `calendar-${identity}-%`)))).limit(1);
        if (existing) { skipped++; continue; }
        // Older imports did not persist the provider identity. Do not guess
        // their provider or silently create another copy of possibly billed work.
        const [legacy] = await tx.select({ id: timeEntries.id }).from(timeEntries)
          .where(and(eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.userId, assigneeUserId), eq(timeEntries.taskId, `calendar:${event.id}`))).limit(1);
        if (legacy) throw new WorkflowError("This event may already have been imported by an older calendar connection. Review its time entry in Activity before importing it again.", 409);
        try {
          await ensurePeriodUnlocked(session.workspaceId, event.startedAt, event.stoppedAt, tx);
        } catch (error) {
          if (error instanceof PeriodLockedError) throw new WorkflowError("A calendar event overlaps a locked billing period. No events from this batch were imported.", 409);
          throw error;
        }
        const segments = splitTimeWindowByUtcDay(event.startedAt, event.stoppedAt);
        for (const [index, segment] of segments.entries()) {
          // Keep the original geometric index in provider identities, even
          // when whole-window rounding gives a midnight fragment no seconds.
          if (segment.durationSeconds === 0) continue;
          const id = `calendar-${identity}-${index}`;
          segment.durationSeconds = storedDuration(segment.durationSeconds).seconds;
          await assertBucketReplacement(capacity, { before: [], after: [{ ...segment, id, workspaceId: session.workspaceId, userId: assigneeUserId }] });
          await tx.insert(timeEntries).values({
            id, workspaceId: session.workspaceId, userId: assigneeUserId, taskId,
            projectId: body.projectId || null, goalId: body.goalId || null,
            tags: normalizeTags(body.tags), description: event.title,
            ...segment, action: null, hourlyRate: null, status: "draft", source: "calendar", collaborators: [], expenses: [],
          });
          importedIds.push(id);
        }
        imported++;
      }
      return { imported, skipped, importedIds };
    });

    return NextResponse.json({
      ok: true,
      provider,
      ...result,
      message: "Events imported as draft time entries. Review the time before approval. Previously imported events were left unchanged.",
    });
  } catch (error) {
    if (error instanceof TimeCapacityError) return NextResponse.json({ error: "These events would exceed 24 logged hours in a day. No events from this batch were imported." }, { status: 409 });
    if (error instanceof TimePrecisionError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof TimeDataError) return NextResponse.json({ error: error.message }, { status: 409 });
    return workflowErrorResponse(error, "Could not import these calendar events. No changes were saved; please try again.", { route: "/api/integrations/calendar/import", method: "POST" });
  }
}

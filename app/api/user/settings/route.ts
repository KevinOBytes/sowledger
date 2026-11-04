import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isValidTimezone, normalizeTags } from "@/lib/validators";
import { eq } from "drizzle-orm";
import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";

type CalendarPreferences = {
  visibleStartHour?: number;
  visibleEndHour?: number;
};

function normalizeCalendarPreferences(value: unknown): CalendarPreferences | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError("calendarPreferences must be an object", 400);
  }

  const raw = value as Record<string, unknown>;
  const visibleStartHour = raw.visibleStartHour;
  const visibleEndHour = raw.visibleEndHour;

  if (
    typeof visibleStartHour !== "number" || typeof visibleEndHour !== "number" ||
    !Number.isInteger(visibleStartHour) ||
    !Number.isInteger(visibleEndHour) ||
    visibleStartHour < 0 ||
    visibleEndHour > 24 ||
    visibleEndHour <= visibleStartHour
  ) {
    throw new WorkflowError("calendarPreferences visible hours must be integers from 0 to 24, with the end after the start", 400);
  }

  return { visibleStartHour, visibleEndHour };
}

function publicProfile(user: typeof users.$inferSelect) {
  return { id: user.id, email: user.email, displayName: user.displayName ?? "", timezone: user.timezone, preferredTags: user.preferredTags, calendarPreferences: user.calendarPreferences };
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const [user] = await db.select().from(users).where(eq(users.id, session.sub));
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      user: publicProfile(user),
    });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your settings. Please try again.", { route: "/api/user/settings", method: "GET" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const [user] = await db.select().from(users).where(eq(users.id, session.sub));
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const raw: unknown = await readRequestJson(req);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WorkflowError("Send a settings object with the fields to update.", 400);
    const body = raw as Record<string, unknown>;

    const updates: Partial<typeof users.$inferInsert> = {};
    if (Object.hasOwn(body, "displayName")) {
      if (typeof body.displayName !== "string" || body.displayName.trim().length > 255) throw new WorkflowError("Display name must be a string of at most 255 characters; use an empty string to clear it.", 400);
      updates.displayName = body.displayName.trim();
    }
    if (Object.hasOwn(body, "timezone")) {
      if (typeof body.timezone !== "string" || !body.timezone.trim() || body.timezone.length > 100 || /^[+-]/.test(body.timezone) || !isValidTimezone(body.timezone)) throw new WorkflowError("Use a valid IANA timezone of at most 100 characters, such as America/New_York.", 400);
      updates.timezone = body.timezone;
    }
    if (Object.hasOwn(body, "preferredTags")) {
      if (!Array.isArray(body.preferredTags) || body.preferredTags.some(tag => typeof tag !== "string")) throw new WorkflowError("preferredTags must be an array of strings.", 400);
      updates.preferredTags = normalizeTags(body.preferredTags);
    }
    const calendarPreferences = normalizeCalendarPreferences(body.calendarPreferences);
    if (calendarPreferences !== null) updates.calendarPreferences = calendarPreferences;
    if (!Object.keys(updates).length) throw new WorkflowError("Include a profile field to update.", 400);

    const [updatedUser] = await db.update(users).set(updates).where(eq(users.id, session.sub)).returning();

    if (!updatedUser) throw new WorkflowError("User not found", 404);
    return NextResponse.json({ ok: true, user: publicProfile(updatedUser) });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't save your settings. Please try again.", { route: "/api/user/settings", method: "PATCH" });
  }
}

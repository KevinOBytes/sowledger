import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError, requireSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isValidTimezone, normalizeTags } from "@/lib/validators";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const [user] = await db.select().from(users).where(eq(users.id, session.sub));
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? "",
        timezone: user.timezone,
        preferredTags: user.preferredTags,
      },
    });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const [user] = await db.select().from(users).where(eq(users.id, session.sub));
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = await req.json() as { displayName?: string; timezone?: string; preferredTags?: string[] };

    if (body.timezone && !isValidTimezone(body.timezone)) {
      return NextResponse.json({ error: "Invalid IANA timezone" }, { status: 400 });
    }

    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    if (body.preferredTags !== undefined) updates.preferredTags = normalizeTags(body.preferredTags);

    const [updatedUser] = await db.update(users).set(updates).where(eq(users.id, session.sub)).returning();

    return NextResponse.json({ ok: true, user: updatedUser });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

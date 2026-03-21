import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError, requireSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { store } from "@/lib/store";
import { isValidTimezone, normalizeTags } from "@/lib/validators";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const user = store.users.get(session.sub);
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

    const user = store.users.get(session.sub);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = await req.json() as { displayName?: string; timezone?: string; preferredTags?: string[] };

    if (body.timezone && !isValidTimezone(body.timezone)) {
      return NextResponse.json({ error: "Invalid IANA timezone" }, { status: 400 });
    }

    user.displayName = body.displayName ?? user.displayName;
    user.timezone = body.timezone ?? user.timezone;
    user.preferredTags = body.preferredTags ? normalizeTags(body.preferredTags) : user.preferredTags;

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

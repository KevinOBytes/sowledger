import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { transitionTimer, timerTransitionEntryId, TimerTransitionError } from "@/lib/timer-transition";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 }); }
    const entryId = timerTransitionEntryId(body);
    return NextResponse.json(await transitionTimer({ workspaceId: session.workspaceId, userId: session.sub, entryId, action: "pause" }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "Your workspace role cannot perform this action." }, { status: 403 });
    if (error instanceof TimerTransitionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not pause this timer. Please try again." }, { status: 500 });
  }
}

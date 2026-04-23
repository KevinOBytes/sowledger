import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError, inviteUser, requireRole, requireSession, UnauthorizedError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { email?: string; role?: "client" | "member" | "manager" };
    const email = body.email?.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
    const role = body.role ?? "member";
    if (!["client", "member", "manager"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (role === "manager" && session.role !== "owner") {
      return NextResponse.json({ error: "Only owners can invite managers" }, { status: 403 });
    }

    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "members");
    if (!limits.allowed) {
      return NextResponse.json({ error: limits.error }, { status: 402 });
    }

    const invitation = await inviteUser({
      email,
      workspaceId: session.workspaceId,
      role,
      invitedByUserId: session.sub,
    });

    return NextResponse.json({ ok: true, invitationId: invitation.id, expiresAt: invitation.expiresAt });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

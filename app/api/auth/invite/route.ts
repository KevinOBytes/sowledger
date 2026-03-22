import { NextRequest, NextResponse } from "next/server";
import { inviteUser, requireRole, requireSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { email?: string; role?: "client" | "member" | "manager" };
    if (!body.email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const invitation = await inviteUser({
      email: body.email,
      workspaceId: session.workspaceId,
      role: body.role ?? "member",
      invitedByUserId: session.sub,
    });

    return NextResponse.json({ ok: true, invitationId: invitation.id, expiresAt: invitation.expiresAt });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}

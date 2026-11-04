import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";
import { inviteUser, requireRole, requireSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await readRequestJson(req) as { email?: string; role?: "client" | "member" | "manager" };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    const email = body.email?.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: "email is invalid" }, { status: 400 });
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
    return workflowErrorResponse(error, "We couldn't confirm the invitation was created. Check your invitations before trying again.", { route: "/api/auth/invite", method: "POST" });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { ForbiddenError, requireSession, setSessionCookie, UnauthorizedError } from "@/lib/auth";
import { db } from "@/lib/db";
import { invitations, memberships, users, workspaces } from "@/lib/db/schema";
import type { WorkspaceRole } from "@/lib/store";

const roleWeight: Record<WorkspaceRole, number> = { client: 0, member: 1, manager: 2, owner: 3 };

function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  console.error("Workspace selection failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "We couldn't load your workspaces. Please try again." }, { status: 503 });
}

export async function GET() {
  try {
    const session = await requireSession();
    // This is an account-level list: only this user's memberships and invitations.
    const joined = await db.select({ id: workspaces.id, name: workspaces.name, role: memberships.role })
      .from(memberships).innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, session.sub)).orderBy(asc(workspaces.name), asc(workspaces.id));
    const invited = await db.select({ id: workspaces.id, name: workspaces.name, role: invitations.role })
      .from(invitations).innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
      .where(and(eq(invitations.email, session.email), isNull(invitations.acceptedAt), gt(invitations.expiresAt, Date.now())))
      .orderBy(desc(invitations.expiresAt));
    const options = new Map(joined.map((workspace) => [workspace.id, { ...workspace, invited: false }]));
    for (const workspace of invited) if (!options.has(workspace.id)) options.set(workspace.id, { ...workspace, invited: true });
    return NextResponse.json({ currentWorkspaceId: session.workspaceId, workspaces: [...options.values()] });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => null) as { workspaceId?: unknown } | null;
    if (typeof body?.workspaceId !== "string" || !body.workspaceId || body.workspaceId.length > 255) {
      return NextResponse.json({ error: "Choose a workspace." }, { status: 400 });
    }
    const workspaceId = body.workspaceId;
    const membership = await db.transaction(async (tx) => {
      // Serialize acceptance for this account; never infer membership from a slug.
      const [user] = await tx.select().from(users).where(eq(users.id, session.sub)).for("update");
      if (!user || user.email !== session.email) throw new UnauthorizedError("Please sign in again.");
      const [existing] = await tx.select().from(memberships)
        .where(and(eq(memberships.userId, session.sub), eq(memberships.workspaceId, workspaceId))).for("update");
      if (existing) return existing;
      const [invite] = await tx.select().from(invitations).where(and(
        eq(invitations.workspaceId, workspaceId), eq(invitations.email, user.email),
        isNull(invitations.acceptedAt), gt(invitations.expiresAt, Date.now()),
      )).orderBy(desc(invitations.expiresAt)).limit(1).for("update");
      if (!invite) throw new ForbiddenError("You need an invitation to join this workspace.");
      if (!(invite.role in roleWeight)) throw new ForbiddenError("This invitation is no longer available.");
      const [accepted] = await tx.insert(memberships).values({ workspaceId, userId: user.id, role: invite.role }).returning();
      await tx.update(invitations).set({ acceptedAt: Date.now() }).where(and(eq(invitations.id, invite.id), eq(invitations.workspaceId, workspaceId)));
      return accepted;
    });
    await setSessionCookie({ sub: session.sub, email: session.email, workspaceId, role: membership.role });
    return NextResponse.json({ ok: true, redirectTo: membership.role === "client" ? "/client" : "/dashboard" });
  } catch (error) { return failure(error); }
}

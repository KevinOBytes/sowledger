import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { inviteUser, requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { memberships, organizations, workspacePeople } from "@/lib/db/schema";
import { createOrganization, listWorkspacePeopleDirectory } from "@/lib/people-directory";
import { isValidEmail } from "@/lib/validators";

function getErrorStatus(error: unknown, fallback = 500): number {
  const err = error as Record<string, unknown>;
  if (err.code === "FORBIDDEN" || err.status === 403 || err.message === "Forbidden") return 403;
  if (err.code === "UNAUTHORIZED" || err.status === 401) return 401;
  return fallback;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const directory = await listWorkspacePeopleDirectory(session.workspaceId);
    return NextResponse.json({ ok: true, ...directory });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = (await req.json()) as {
      organizationId?: string;
      organizationName?: string;
      organizationType?: "internal" | "client" | "vendor" | "partner" | "other";
      displayName?: string;
      email?: string;
      title?: string;
      personType?: "member" | "client" | "contractor" | "contact";
      invite?: boolean;
      inviteRole?: "client" | "member" | "manager";
    };

    let organizationId = body.organizationId?.trim() || "";
    if (!organizationId) {
      const organizationName = body.organizationName?.trim();
      if (!organizationName) {
        return NextResponse.json({ error: "organizationId or organizationName is required" }, { status: 400 });
      }
      const createdOrg = await createOrganization({
        workspaceId: session.workspaceId,
        name: organizationName,
        type: body.organizationType ?? "other",
      });
      organizationId = createdOrg.id;
    } else {
      const [organization] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, session.workspaceId)));
      if (!organization) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 });
      }
    }

    const normalizedEmail = body.email?.trim().toLowerCase() || null;
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: "email is invalid" }, { status: 400 });
    }

    const displayName = body.displayName?.trim() || normalizedEmail?.split("@")[0] || "New person";
    const personType = body.personType ?? "contact";
    const inviteRole = body.inviteRole ?? (personType === "client" ? "client" : "member");

    if (body.invite && !normalizedEmail) {
      return NextResponse.json({ error: "email is required to send an invite" }, { status: 400 });
    }

    if (body.invite && inviteRole === "manager" && session.role !== "owner") {
      return NextResponse.json({ error: "Only owners can invite managers" }, { status: 403 });
    }

    let invitationStatus: "none" | "pending" | "accepted" = "none";
    if (body.invite && normalizedEmail) {
      await inviteUser({
        email: normalizedEmail,
        workspaceId: session.workspaceId,
        role: inviteRole,
        invitedByUserId: session.sub,
      });
      invitationStatus = "pending";
    }

    const [person] = await db
      .insert(workspacePeople)
      .values({
        id: crypto.randomUUID(),
        workspaceId: session.workspaceId,
        organizationId,
        displayName,
        email: normalizedEmail,
        title: body.title?.trim() || null,
        personType,
        invitationStatus,
        inviteRole: invitationStatus === "pending" ? inviteRole : null,
        status: "active",
      })
      .returning();

    return NextResponse.json({ ok: true, person });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = (await req.json()) as {
      personId?: string;
      organizationId?: string;
      displayName?: string;
      email?: string | null;
      title?: string | null;
      personType?: "member" | "client" | "contractor" | "contact";
      status?: "active" | "archived";
      inviteRole?: "client" | "member" | "manager" | "owner";
      resendInvite?: boolean;
      workspaceRole?: "client" | "member" | "manager" | "owner";
    };

    if (!body.personId) {
      return NextResponse.json({ error: "personId is required" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(workspacePeople)
      .where(and(eq(workspacePeople.id, body.personId), eq(workspacePeople.workspaceId, session.workspaceId)));

    if (!existing) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const updates: Partial<typeof workspacePeople.$inferInsert> = {};
    if (body.organizationId !== undefined) {
      const [organization] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, body.organizationId), eq(organizations.workspaceId, session.workspaceId)));
      if (!organization) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 });
      }
      updates.organizationId = body.organizationId;
    }
    if (body.displayName !== undefined) updates.displayName = body.displayName?.trim() || null;
    if (body.email !== undefined) {
      const normalizedEmail = body.email?.trim().toLowerCase() || null;
      if (normalizedEmail && !isValidEmail(normalizedEmail)) {
        return NextResponse.json({ error: "email is invalid" }, { status: 400 });
      }
      updates.email = normalizedEmail;
    }
    if (body.title !== undefined) updates.title = body.title?.trim() || null;
    if (body.personType !== undefined) updates.personType = body.personType;
    if (body.status !== undefined) updates.status = body.status;
    if (body.inviteRole !== undefined) {
      if (body.inviteRole === "owner" && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can assign owner invites" }, { status: 403 });
      }
      updates.inviteRole = body.inviteRole;
    }

    if (body.workspaceRole !== undefined) {
      if (body.workspaceRole === "owner" && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can promote owners" }, { status: 403 });
      }
      if (!existing.linkedUserId) {
        return NextResponse.json({ error: "Person is not linked to a workspace member" }, { status: 400 });
      }
      await db
        .update(memberships)
        .set({ role: body.workspaceRole })
        .where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, existing.linkedUserId)));
      updates.inviteRole = body.workspaceRole;
      updates.invitationStatus = "accepted";
    }

    if (body.resendInvite) {
      const email = (body.email ?? existing.email)?.trim().toLowerCase();
      if (!email) {
        return NextResponse.json({ error: "Email is required to resend an invite" }, { status: 400 });
      }
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: "email is invalid" }, { status: 400 });
      }
      const role = body.inviteRole ?? existing.inviteRole ?? "member";
      if ((role === "manager" || role === "owner") && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can resend elevated invites" }, { status: 403 });
      }
      await inviteUser({
        email,
        workspaceId: session.workspaceId,
        role,
        invitedByUserId: session.sub,
      });
      updates.email = email;
      updates.invitationStatus = existing.linkedUserId ? "accepted" : "pending";
      updates.inviteRole = role;
      updates.status = "active";
    }

    const [person] = await db.update(workspacePeople).set(updates).where(eq(workspacePeople.id, body.personId)).returning();
    return NextResponse.json({ ok: true, person });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

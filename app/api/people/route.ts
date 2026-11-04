import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { inviteUser, isWorkspaceRole, requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { memberships, organizations, workspacePeople } from "@/lib/db/schema";
import { createOrganization, listWorkspacePeopleDirectory } from "@/lib/people-directory";
import { isValidEmail } from "@/lib/validators";

function isElevatedRole(role: string | null | undefined) {
  return role === "manager" || role === "owner";
}

function readRole(value: unknown) {
  if (!isWorkspaceRole(value)) throw new WorkflowError("Choose a valid workspace role.", 400);
  return value;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const directory = await listWorkspacePeopleDirectory(session.workspaceId);
    return NextResponse.json({ ok: true, ...directory });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your people. Please try again.", { route: "/api/people", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = (await readRequestJson(req)) as {
      organizationId?: string;
      organizationName?: string;
      organizationType?: "internal" | "client" | "vendor" | "partner" | "other";
      displayName?: string;
      email?: string;
      title?: string;
      personType?: "member" | "client" | "contractor" | "contact";
      invite?: boolean;
      inviteRole?: unknown;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    const personType = body.personType ?? "contact";
    const inviteRole = body.inviteRole === undefined ? (personType === "client" ? "client" : "member") : readRole(body.inviteRole);
    if (body.invite && isElevatedRole(inviteRole) && session.role !== "owner") {
      return NextResponse.json({ error: "Only owners can invite elevated roles" }, { status: 403 });
    }

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
    if (body.invite && !normalizedEmail) {
      return NextResponse.json({ error: "email is required to send an invite" }, { status: 400 });
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
    return workflowErrorResponse(error, "We couldn't confirm the person or invitation was saved. Check your people list before trying again.", { route: "/api/people", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = (await readRequestJson(req)) as {
      personId?: string;
      organizationId?: string;
      displayName?: string;
      email?: string | null;
      title?: string | null;
      personType?: "member" | "client" | "contractor" | "contact";
      status?: "active" | "archived";
      inviteRole?: unknown;
      resendInvite?: boolean;
      workspaceRole?: unknown;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    const inviteRole = body.inviteRole === undefined ? undefined : readRole(body.inviteRole);
    const workspaceRole = body.workspaceRole === undefined ? undefined : readRole(body.workspaceRole);

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

    // Check resend policy before a requested membership update can write.
    const resendRole = body.resendInvite ? readRole(inviteRole ?? existing.inviteRole ?? "member") : undefined;
    if (resendRole && isElevatedRole(resendRole) && session.role !== "owner") {
      return NextResponse.json({ error: "Only owners can resend elevated invites" }, { status: 403 });
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
    if (inviteRole !== undefined) {
      if (isElevatedRole(inviteRole) && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can assign elevated invites" }, { status: 403 });
      }
      if (isElevatedRole(existing.inviteRole) && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can change elevated invites" }, { status: 403 });
      }
      updates.inviteRole = inviteRole;
    }

    if (workspaceRole !== undefined) {
      if (isElevatedRole(workspaceRole) && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can promote elevated roles" }, { status: 403 });
      }
      if (!existing.linkedUserId) {
        return NextResponse.json({ error: "Person is not linked to a workspace member" }, { status: 400 });
      }
      const [currentMembership] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, existing.linkedUserId)));
      if (!currentMembership) {
        return NextResponse.json({ error: "Membership not found" }, { status: 404 });
      }
      if (!isWorkspaceRole(currentMembership.role)) {
        return NextResponse.json({ error: "This membership's role is not valid. Contact support before changing it." }, { status: 403 });
      }
      if (isElevatedRole(currentMembership.role) && session.role !== "owner") {
        return NextResponse.json({ error: "Only owners can change elevated roles" }, { status: 403 });
      }
      
      if (currentMembership.role === "owner" && workspaceRole !== "owner") {
        const owners = await db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.role, "owner")));
        if (owners.length <= 1) {
          return NextResponse.json({ error: "Cannot demote the last owner of the workspace" }, { status: 400 });
        }
      }
      await db
        .update(memberships)
        .set({ role: workspaceRole })
        .where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, existing.linkedUserId)));
      updates.inviteRole = workspaceRole;
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
      const role = resendRole!;
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

    const [person] = await db
      .update(workspacePeople)
      .set(updates)
      .where(and(eq(workspacePeople.id, body.personId), eq(workspacePeople.workspaceId, session.workspaceId)))
      .returning();
    return NextResponse.json({ ok: true, person });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the person's changes were saved. Check your people list before trying again.", { route: "/api/people", method: "PATCH" });
  }
}

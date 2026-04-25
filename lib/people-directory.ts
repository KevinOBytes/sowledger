import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { invitations, memberships, organizations, users, workspacePeople } from "@/lib/db/schema";

type OrganizationRecord = typeof organizations.$inferSelect;

export async function ensureInternalOrganization(workspaceId: string) {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.workspaceId, workspaceId), eq(organizations.type, "internal")))
    .orderBy(desc(organizations.createdAt));

  if (existing) return existing;

  const [created] = await db
    .insert(organizations)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      name: "Workspace Team",
      type: "internal",
    })
    .returning();

  return created;
}

export async function createOrganization(input: {
  workspaceId: string;
  name: string;
  type?: OrganizationRecord["type"];
  clientId?: string | null;
}) {
  const [created] = await db
    .insert(organizations)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      clientId: input.clientId ?? null,
      name: input.name.trim(),
      type: input.type ?? "other",
    })
    .returning();

  return created;
}

export async function ensureWorkspacePeopleDirectory(workspaceId: string) {
  const internalOrg = await ensureInternalOrganization(workspaceId);

  const existingPeople = await db.select().from(workspacePeople).where(eq(workspacePeople.workspaceId, workspaceId));
  const peopleByLinkedUserId = new Map(existingPeople.filter((person) => person.linkedUserId).map((person) => [person.linkedUserId!, person]));
  const peopleByEmail = new Map(existingPeople.filter((person) => person.email).map((person) => [person.email!.toLowerCase(), person]));

  const workspaceMembers = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      email: users.email,
      displayName: users.displayName,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.workspaceId, workspaceId));

  for (const member of workspaceMembers) {
    const existing = peopleByLinkedUserId.get(member.userId) ?? peopleByEmail.get(member.email.toLowerCase());
    if (!existing) {
      const [created] = await db
        .insert(workspacePeople)
        .values({
          id: crypto.randomUUID(),
          workspaceId,
          organizationId: internalOrg.id,
          linkedUserId: member.userId,
          displayName: member.displayName ?? null,
          email: member.email,
          personType: "member",
          invitationStatus: "accepted",
          inviteRole: member.role,
          status: "active",
        })
        .returning();
      peopleByLinkedUserId.set(member.userId, created);
      peopleByEmail.set(member.email.toLowerCase(), created);
      continue;
    }

    const [updated] = await db
      .update(workspacePeople)
      .set({
        organizationId: existing.organizationId || internalOrg.id,
        linkedUserId: member.userId,
        displayName: existing.displayName ?? member.displayName ?? null,
        email: existing.email ?? member.email,
        personType: "member",
        invitationStatus: "accepted",
        inviteRole: member.role,
        status: "active",
      })
      .where(eq(workspacePeople.id, existing.id))
      .returning();
    peopleByLinkedUserId.set(member.userId, updated);
    peopleByEmail.set(member.email.toLowerCase(), updated);
  }

  const pendingInvitations = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, Date.now()),
      ),
    )
    .orderBy(desc(invitations.expiresAt));

  for (const invitation of pendingInvitations) {
    const normalizedEmail = invitation.email.toLowerCase();
    const existing = peopleByEmail.get(normalizedEmail);
    if (existing) {
      await db
        .update(workspacePeople)
        .set({
          invitationStatus: existing.invitationStatus === "accepted" ? "accepted" : "pending",
          inviteRole: invitation.role,
          status: "active",
        })
        .where(eq(workspacePeople.id, existing.id));
      continue;
    }

    const [created] = await db
      .insert(workspacePeople)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        organizationId: internalOrg.id,
        email: normalizedEmail,
        displayName: normalizedEmail.split("@")[0],
        personType: "member",
        invitationStatus: "pending",
        inviteRole: invitation.role,
        status: "active",
      })
      .returning();
    peopleByEmail.set(normalizedEmail, created);
  }
}

export async function listWorkspacePeopleDirectory(workspaceId: string) {
  await ensureWorkspacePeopleDirectory(workspaceId);

  const organizationsData = await db
    .select()
    .from(organizations)
    .where(eq(organizations.workspaceId, workspaceId))
    .orderBy(desc(organizations.createdAt));

  const peopleData = await db
    .select()
    .from(workspacePeople)
    .where(eq(workspacePeople.workspaceId, workspaceId))
    .orderBy(desc(workspacePeople.createdAt));

  return {
    organizations: organizationsData,
    people: peopleData,
  };
}

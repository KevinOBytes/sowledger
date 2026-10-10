import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import { isAdminEmail } from "./admin";
import {
  createInvitation,
  getMembership,
  type WorkspaceRole,
} from "./store";
import { db } from "./db";
import { users, memberships, workspaces, magicLinks, invitations } from "./db/schema";
import { asc, desc, eq, and, gt, isNull } from "drizzle-orm";

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

const AUTH_COOKIE_NAME = "sowledger_session";

type SessionPayload = {
  sub: string;
  email: string;
  workspaceId: string;
  role: WorkspaceRole;
  exp: number;
};

const roleWeights: Record<WorkspaceRole, number> = { client: 0, member: 1, manager: 2, owner: 3 };

function secret() {
  const value = env.AUTH_COOKIE_SECRET;
  if (!value || value.length < 24) throw new Error("AUTH_COOKIE_SECRET must be at least 24 chars");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function encode(payload: SessionPayload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${raw}.${sign(raw)}`;
}

async function decode(token: string): Promise<SessionPayload> {
  const parts = token.split(".");
  const [raw, mac] = parts;
  // Match the rate-limit identity grammar. Buffer's hex parser alone accepts
  // non-canonical suffixes and casing, which could select a different bucket.
  if (token.length > 4096 || parts.length !== 2 || !raw || !/^[a-f0-9]{64}$/.test(mac ?? "")) {
    throw new UnauthorizedError("Malformed token");
  }

  const expected = sign(raw);
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) {
    throw new UnauthorizedError("Invalid token signature");
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    throw new UnauthorizedError("Please sign in again.");
  }
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.workspaceId !== "string" || !payload.workspaceId ||
    typeof payload.email !== "string" || !payload.email || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    throw new UnauthorizedError("Please sign in again.");
  }

  let membership = await getMembership(payload.sub, payload.workspaceId);
  if (!membership) throw new UnauthorizedError("Membership revoked");
  membership = await repairSetupRole(payload.email, membership);

  return { ...payload, role: membership.role as WorkspaceRole };
}

async function workspaceHasManager(workspaceId: string) {
  const records = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.workspaceId, workspaceId));
  return records.some((record) => record.role === "manager" || record.role === "owner");
}

async function updateMembershipRole(userId: string, workspaceId: string, role: WorkspaceRole) {
  const [membership] = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .returning();
  return membership;
}

async function repairSetupRole(email: string, membership: typeof memberships.$inferSelect) {
  if (isAdminEmail(email) && membership.role !== "owner") {
    return await updateMembershipRole(membership.userId, membership.workspaceId, "owner") ?? membership;
  }

  if (membership.role === "client" || roleWeights[membership.role as WorkspaceRole] >= roleWeights.manager || !env.ALLOW_BOOTSTRAP_OWNER) {
    return membership;
  }

  // A workspace with no manager/owner is otherwise impossible to set up.
  // Promote the signed-in member only when bootstrap mode is enabled and no elevated role exists.
  if (!(await workspaceHasManager(membership.workspaceId))) {
    return await updateMembershipRole(membership.userId, membership.workspaceId, "owner") ?? membership;
  }

  return membership;
}

function hashMagic(tokenSecret: string) {
  return createHash("sha256").update(`${tokenSecret}:${secret()}`).digest("hex");
}

export function generatedWorkspaceSlug(email: string) {
  const normalized = email.trim().toLowerCase();
  const label = normalized.split("@")[0].replace(/[^a-z0-9-]/g, "").slice(0, 48) || "personal";
  // Include the complete address in the identity. alex@one.example and
  // alex@two.example must never be enrolled into the same workspace.
  const identity = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `${label}-${identity}-workspace`;
}

async function resolveMagicLinkWorkspace(email: string) {
  const normEmail = email.trim().toLowerCase();

  // A new invitation must remain reachable for people who already belong
  // to another workspace. Membership is validated again when the link is used.
  const [pendingInvite] = await db
    .select({ workspaceSlug: workspaces.slug, workspaceId: workspaces.id, workspaceName: workspaces.name })
    .from(invitations)
    .innerJoin(workspaces, eq(invitations.workspaceId, workspaces.id))
    .where(and(eq(invitations.email, normEmail), gt(invitations.expiresAt, Date.now()), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.expiresAt));

  if (pendingInvite) {
    return {
      email: normEmail,
      workspaceSlug: pendingInvite.workspaceSlug,
      reason: "pending_invite" as const,
      workspace: { id: pendingInvite.workspaceId, slug: pendingInvite.workspaceSlug, name: pendingInvite.workspaceName },
    };
  }

  const [existing] = await db
    .select({ workspace: workspaces })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(users.email, normEmail))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
    .limit(1);
  if (existing) {
    return { email: normEmail, workspaceSlug: existing.workspace.slug, reason: "existing_member" as const, workspace: existing.workspace };
  }

  // If no existing workspace, dynamically generate one
  const workspaceSlug = generatedWorkspaceSlug(normEmail);
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug));
  return { email: normEmail, workspaceSlug, reason: "generated" as const, workspace: workspace ?? null };
}

export async function checkMagicLinkEligibility(email: string) {
  const resolved = await resolveMagicLinkWorkspace(email);

  if (resolved.reason === "existing_member" || resolved.reason === "pending_invite") {
    return { eligible: true as const, email: resolved.email, workspaceSlug: resolved.workspaceSlug };
  }

  if (isAdminEmail(resolved.email)) {
    return { eligible: true as const, email: resolved.email, workspaceSlug: resolved.workspaceSlug };
  }

  if (env.ALLOW_SELF_REGISTRATION || env.ALLOW_BOOTSTRAP_OWNER) {
    return { eligible: true as const, email: resolved.email, workspaceSlug: resolved.workspaceSlug };
  }

  return {
    eligible: false as const,
    email: resolved.email,
    workspaceSlug: resolved.workspaceSlug,
    error: "Sign-up is invite-only. Ask your workspace owner to invite this email address, then try again.",
  };
}

export async function createMagicLink(email: string) {
  const eligibility = await checkMagicLinkEligibility(email);
  if (!eligibility.eligible) throw new ForbiddenError(eligibility.error);

  const tokenId = crypto.randomUUID();
  const tokenSecret = randomBytes(24).toString("base64url");
  const tokenHash = hashMagic(tokenSecret);
  
  await db.insert(magicLinks).values({
    tokenId,
    tokenHash,
    email: eligibility.email,
    workspaceSlug: eligibility.workspaceSlug,
    // expires in 20 minutes
    expiresAt: Date.now() + 1000 * 60 * 20,
    usedAt: null,
  });

  const serialized = JSON.stringify({ tid: tokenId, sec: tokenSecret });
  return Buffer.from(serialized).toString("base64url");
}

export async function inviteUser(input: { email: string; workspaceId: string; role: WorkspaceRole; invitedByUserId: string }) {
  return createInvitation({
    email: input.email.trim().toLowerCase(),
    workspaceId: input.workspaceId,
    role: input.role,
    invitedByUserId: input.invitedByUserId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
}

export async function consumeMagicLink(token: string) {
  let parsed: { tid: string; sec: string };
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (typeof parsed.tid !== "string" || typeof parsed.sec !== "string") throw new Error();
  } catch {
    throw new UnauthorizedError("This sign-in link is invalid. Request a new one.");
  }

  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(magicLinks).where(eq(magicLinks.tokenId, parsed.tid)).for("update");
    if (!record || record.expiresAt < Date.now()) throw new UnauthorizedError("This sign-in link has expired. Request a new one.");
    if (record.usedAt) throw new UnauthorizedError("This sign-in link has already been used. Request a new one.");
    const hashBuf = Buffer.from(record.tokenHash, "hex");
    const computedBuf = Buffer.from(hashMagic(parsed.sec), "hex");
    if (hashBuf.length !== computedBuf.length || !timingSafeEqual(hashBuf, computedBuf)) {
      throw new UnauthorizedError("This sign-in link is invalid. Request a new one.");
    }

    await tx.insert(users).values({ id: crypto.randomUUID(), email: record.email }).onConflictDoNothing({ target: users.email });
    const [user] = await tx.select().from(users).where(eq(users.email, record.email));
    if (!user) throw new Error("Account setup did not complete");

    let [workspace] = await tx.select().from(workspaces).where(eq(workspaces.slug, record.workspaceSlug)).for("update");
    const ownsGeneratedSlug = record.workspaceSlug === generatedWorkspaceSlug(record.email);
    const canCreate = env.ALLOW_SELF_REGISTRATION || env.ALLOW_BOOTSTRAP_OWNER || isAdminEmail(record.email);
    if (!workspace) {
      if (!ownsGeneratedSlug || !canCreate) throw new ForbiddenError("This invitation is no longer available. Ask the workspace owner for a new invitation.");
      await tx.insert(workspaces).values({ id: crypto.randomUUID(), slug: record.workspaceSlug, name: "My workspace", baseCurrency: "USD" }).onConflictDoNothing({ target: workspaces.slug });
      [workspace] = await tx.select().from(workspaces).where(eq(workspaces.slug, record.workspaceSlug)).for("update");
    }
    if (!workspace) throw new Error("Workspace setup did not complete");

    const [existing] = await tx.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.workspaceId, workspace.id))).for("update");
    const [invite] = await tx.select().from(invitations).where(and(
      eq(invitations.email, user.email), eq(invitations.workspaceId, workspace.id),
      gt(invitations.expiresAt, Date.now()), isNull(invitations.acceptedAt),
    )).orderBy(desc(invitations.expiresAt)).limit(1).for("update");

    let role: WorkspaceRole;
    if (existing) {
      role = existing.role;
      if (invite && roleWeights[invite.role] > roleWeights[role]) role = invite.role;
    } else if (invite) {
      // Invitation roles take precedence over open sign-up.
      role = invite.role;
    } else {
      const [anyMember] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, workspace.id)).limit(1);
      if (!ownsGeneratedSlug || !canCreate || anyMember) {
        throw new ForbiddenError("You need an invitation to join this workspace.");
      }
      role = "owner";
    }
    if (isAdminEmail(user.email)) role = "owner";
    // Ordinary sign-in must not write back a stale role over a manager's change.
    let membership = existing;
    if (!membership) {
      [membership] = await tx.insert(memberships).values({ userId: user.id, workspaceId: workspace.id, role }).returning();
    } else if (membership.role !== role) {
      [membership] = await tx.update(memberships).set({ role })
        .where(and(eq(memberships.userId, user.id), eq(memberships.workspaceId, workspace.id))).returning();
    }
    if (invite) await tx.update(invitations).set({ acceptedAt: Date.now() }).where(eq(invitations.id, invite.id));
    // Claim the link atomically with setup: a failed transaction leaves it usable.
    await tx.update(magicLinks).set({ usedAt: Date.now() }).where(eq(magicLinks.tokenId, record.tokenId));
    return { user, workspace, membership };
  });
}

export async function createSessionToken(payload: { sub: string; email: string; workspaceId: string; role: WorkspaceRole }) {
  return encode({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
}

export async function setSessionCookie(payload: { sub: string; email: string; workspaceId: string; role: WorkspaceRole }) {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
}

export async function requireSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) throw new UnauthorizedError("Not authenticated");
  return await decode(token);
}

export { isAdminEmail } from "./admin";

export function requireRole(role: WorkspaceRole, actualRole: WorkspaceRole) {
  if (roleWeights[actualRole] < roleWeights[role]) throw new ForbiddenError(`Requires ${role} role`);
}

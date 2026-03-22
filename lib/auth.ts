import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import { isAdminEmail } from "./admin";
import {
  createInvitation,
  ensureMembership,
  ensureUser,
  ensureWorkspace,
  findPendingInvitation,
  getMembership,
  type WorkspaceRole,
} from "./store";
import { db } from "./db";
import { users, memberships, workspaces, magicLinks, invitations } from "./db/schema";
import { eq, and } from "drizzle-orm";

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

const AUTH_COOKIE_NAME = "timed_session";

type SessionPayload = {
  sub: string;
  email: string;
  workspaceId: string;
  role: WorkspaceRole;
  exp: number;
};

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
  const [raw, mac] = token.split(".");
  if (!raw || !mac) throw new UnauthorizedError("Malformed token");

  const expected = sign(raw);
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) {
    throw new UnauthorizedError("Invalid token signature");
  }

  const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SessionPayload;
  if (payload.exp < Date.now()) throw new UnauthorizedError("Expired token");

  const membership = await getMembership(payload.sub, payload.workspaceId);
  if (!membership) throw new UnauthorizedError("Membership revoked");

  return { ...payload, role: membership.role as WorkspaceRole };
}

function hashMagic(tokenSecret: string) {
  return createHash("sha256").update(`${tokenSecret}:${secret()}`).digest("hex");
}

export async function createMagicLink(email: string) {
  const normEmail = email.trim().toLowerCase();
  
  // Find their existing workspace if they have one
  let resolvedSlug = "";
  const [userResult] = await db.select().from(users).where(eq(users.email, normEmail));
  
  if (userResult) {
    const mems = await db.select().from(memberships).where(eq(memberships.userId, userResult.id));
    if (mems.length > 0) {
       const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, mems[0].workspaceId));
       if (ws) resolvedSlug = ws.slug;
    }
  }
  
  // If no existing workspace, dynamically generate one
  if (!resolvedSlug) {
      resolvedSlug = normEmail.split("@")[0].replace(/[^a-z0-9-]/g, "") + "-workspace";
  }

  const tokenId = crypto.randomUUID();
  const tokenSecret = randomBytes(24).toString("base64url");
  const tokenHash = hashMagic(tokenSecret);
  
  await db.insert(magicLinks).values({
    tokenId,
    tokenHash,
    email: normEmail,
    workspaceSlug: resolvedSlug,
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
  const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { tid: string; sec: string };
  const [record] = await db.select().from(magicLinks).where(eq(magicLinks.tokenId, parsed.tid));
  
  if (!record) throw new Error("Magic link not found");
  if (record.usedAt) throw new Error("Magic link already used");
  if (record.expiresAt < Date.now()) throw new Error("Magic link expired");

  const computed = hashMagic(parsed.sec);
  const hashBuf = Buffer.from(record.tokenHash, "hex");
  const computedBuf = Buffer.from(computed, "hex");
  if (hashBuf.length !== computedBuf.length || !timingSafeEqual(hashBuf, computedBuf)) {
    throw new UnauthorizedError("Magic link validation failed");
  }

  await db.update(magicLinks).set({ usedAt: Date.now() }).where(eq(magicLinks.tokenId, record.tokenId));

  const user = await ensureUser(record.email);
  const workspace = await ensureWorkspace(record.workspaceSlug);

  const existingMembership = await getMembership(user.id, workspace.id);
  if (existingMembership) {
    // Ensure @kevinbytes.com users always retain owner-level access.
    if (isAdminEmail(user.email) && existingMembership.role !== "owner") {
      await db.update(memberships).set({ role: "owner" }).where(and(eq(memberships.userId, user.id), eq(memberships.workspaceId, workspace.id)));
      existingMembership.role = "owner";
    }
    return { user, workspace, membership: existingMembership };
  }

  // @kevinbytes.com users always get owner role on first join.
  if (isAdminEmail(user.email)) {
    const adminMembership = await ensureMembership(user.id, workspace.id, "owner");
    return { user, workspace, membership: adminMembership };
  }

  const hasAnyMember = (await db.select().from(memberships).where(eq(memberships.workspaceId, workspace.id))).length > 0;
  if (!hasAnyMember && env.ALLOW_BOOTSTRAP_OWNER) {
    const bootstrap = await ensureMembership(user.id, workspace.id, "owner");
    return { user, workspace, membership: bootstrap };
  }

  if (env.ALLOW_SELF_REGISTRATION) {
    const member = await ensureMembership(user.id, workspace.id, "member");
    return { user, workspace, membership: member };
  }

  const invite = await findPendingInvitation(user.email, workspace.id);
  if (!invite) {
    throw new Error("Registration disabled: user must be invited by workspace manager/owner.");
  }

  await db.update(invitations).set({ acceptedAt: Date.now() }).where(eq(invitations.id, invite.id));
  const membership = await ensureMembership(user.id, workspace.id, invite.role as WorkspaceRole);
  return { user, workspace, membership };
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
  const weights: Record<WorkspaceRole, number> = { client: 0, member: 1, manager: 2, owner: 3 };
  if (weights[actualRole] < weights[role]) throw new ForbiddenError(`Requires ${role} role`);
}

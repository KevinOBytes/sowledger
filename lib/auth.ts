import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import {
  createInvitation,
  ensureMembership,
  ensureUser,
  ensureWorkspace,
  findPendingInvitation,
  getMembership,
  store,
  type WorkspaceRole,
} from "./store";

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

const AUTH_COOKIE_NAME = "timely_session";

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

function decode(token: string): SessionPayload {
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

  const membership = getMembership(payload.sub, payload.workspaceId);
  if (!membership) throw new UnauthorizedError("Membership revoked");

  return { ...payload, role: membership.role };
}

function hashMagic(tokenSecret: string) {
  return createHash("sha256").update(`${tokenSecret}:${secret()}`).digest("hex");
}

export function createMagicLink(email: string, workspaceSlug: string) {
  const tokenId = crypto.randomUUID();
  const tokenSecret = randomBytes(24).toString("base64url");
  const tokenHash = hashMagic(tokenSecret);
  store.magicLinks.set(tokenId, {
    tokenId,
    tokenHash,
    email: email.toLowerCase(),
    workspaceSlug: workspaceSlug.toLowerCase(),
    expiresAt: Date.now() + 1000 * 60 * 20,
    usedAt: null,
  });

  const serialized = JSON.stringify({ tid: tokenId, sec: tokenSecret });
  return Buffer.from(serialized).toString("base64url");
}

export function inviteUser(input: { email: string; workspaceId: string; role: WorkspaceRole; invitedByUserId: string }) {
  return createInvitation({
    email: input.email.trim().toLowerCase(),
    workspaceId: input.workspaceId,
    role: input.role,
    invitedByUserId: input.invitedByUserId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
}

export function consumeMagicLink(token: string) {
  const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { tid: string; sec: string };
  const record = store.magicLinks.get(parsed.tid);
  if (!record) throw new Error("Magic link not found");
  if (record.usedAt) throw new Error("Magic link already used");
  if (record.expiresAt < Date.now()) throw new Error("Magic link expired");

  const computed = hashMagic(parsed.sec);
  const hashBuf = Buffer.from(record.tokenHash, "hex");
  const computedBuf = Buffer.from(computed, "hex");
  if (hashBuf.length !== computedBuf.length || !timingSafeEqual(hashBuf, computedBuf)) {
    throw new UnauthorizedError("Magic link validation failed");
  }

  record.usedAt = Date.now();
  store.magicLinks.set(record.tokenId, record);

  const user = ensureUser(record.email);
  const workspace = ensureWorkspace(record.workspaceSlug);

  const existingMembership = getMembership(user.id, workspace.id);
  if (existingMembership) {
    return { user, workspace, membership: existingMembership };
  }

  const hasAnyMember = store.memberships.some((item) => item.workspaceId === workspace.id);
  if (!hasAnyMember && env.ALLOW_BOOTSTRAP_OWNER) {
    const bootstrap = ensureMembership(user.id, workspace.id, "owner");
    return { user, workspace, membership: bootstrap };
  }

  if (env.ALLOW_SELF_REGISTRATION) {
    const member = ensureMembership(user.id, workspace.id, "member");
    return { user, workspace, membership: member };
  }

  const invite = findPendingInvitation(user.email, workspace.id);
  if (!invite) {
    throw new Error("Registration disabled: user must be invited by workspace manager/owner.");
  }

  invite.acceptedAt = Date.now();
  store.invitations.set(invite.id, invite);
  const membership = ensureMembership(user.id, workspace.id, invite.role);
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
  return decode(token);
}

export function requireRole(role: WorkspaceRole, actualRole: WorkspaceRole) {
  const weights: Record<WorkspaceRole, number> = { member: 1, manager: 2, owner: 3 };
  if (weights[actualRole] < weights[role]) throw new ForbiddenError(`Requires ${role} role`);
}

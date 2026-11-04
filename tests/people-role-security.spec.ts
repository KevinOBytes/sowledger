import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { consumeMagicLink, createMagicLink } from "../lib/auth";
import { db } from "../lib/db";
import { invitations, magicLinks, memberships, organizations, workspacePeople, workspaces } from "../lib/db/schema";
import { ensureMembership, ensureUser, ensureWorkspace } from "../lib/store";

test.describe("People role policy with real invitation acceptance", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Only root may execute this suite through the disposable database wrapper.");

  async function login(request: APIRequestContext, role: "manager" | "owner" = "manager", plan = "smb") {
    const suffix = crypto.randomUUID();
    const email = `role-policy-${suffix}@example.com`;
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace: `role-policy-${suffix}`, email, role, plan })}`);
    expect(response.status()).toBe(200);
    return { ...(await response.json() as { userId: string; workspaceId: string }), email };
  }

  async function membership(workspaceId: string, userId: string) {
    return (await db.select().from(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId))))[0];
  }

  async function targetWorkspace() {
    const suffix = crypto.randomUUID();
    const workspace = await ensureWorkspace(`role-target-${suffix}`);
    const owner = await ensureUser(`role-target-owner-${suffix}@example.com`);
    await ensureMembership(owner.id, workspace.id, "owner");
    await db.update(workspaces).set({ plan: "smb" }).where(eq(workspaces.id, workspace.id));
    return { workspace, owner };
  }

  // Catch: the JSON "owner" literal bypassing only-manager checks and being
  // honored by the real magic-link transaction for the attacker's existing seat.
  test("a manager self-owner invitation is refused and later sign-in stays manager", async ({ request }) => {
    const state = await login(request, "manager", "free");
    const response = await request.post("/api/people", { data: { organizationName: "Rejected role organization", email: state.email, invite: true, inviteRole: "owner" } });
    expect([400, 403]).toContain(response.status());
    expect(await db.select().from(invitations).where(eq(invitations.workspaceId, state.workspaceId))).toHaveLength(0);
    expect(await db.select().from(workspacePeople).where(eq(workspacePeople.workspaceId, state.workspaceId))).toHaveLength(0);
    expect(await db.select().from(organizations).where(eq(organizations.workspaceId, state.workspaceId))).toHaveLength(0);
    expect((await consumeMagicLink(await createMagicLink(state.email))).membership.role).toBe("manager");
    expect((await membership(state.workspaceId, state.userId)).role).toBe("manager");
    expect((await (await request.get("/api/auth/me")).json()).session.role).toBe("manager");
  });

  for (const role of ["client", "member", "manager"] as const) {
    test(`the accepted ${role} invitation persists exactly that role`, async ({ request }) => {
      const state = await login(request, role === "manager" ? "owner" : "manager");
      const email = `accepted-${crypto.randomUUID()}@example.com`;
      const response = await request.post("/api/people", { data: { organizationName: "Accepted role organization", email, invite: true, inviteRole: role } });
      expect(response.status()).toBe(200);
      const accepted = await consumeMagicLink(await createMagicLink(email));
      expect(accepted.workspace.id).toBe(state.workspaceId);
      expect(accepted.membership.role).toBe(role);
      expect((await membership(state.workspaceId, accepted.user.id)).role).toBe(role);
      const [invitation] = await db.select().from(invitations).where(and(eq(invitations.workspaceId, state.workspaceId), eq(invitations.email, email)));
      expect(invitation.acceptedAt).not.toBeNull();
    });
  }

  test("an invalid stored membership cannot authenticate even with an otherwise valid cookie", async ({ request }) => {
    const state = await login(request);
    await db.update(memberships).set({ role: "unknown-role" as "member" }).where(and(eq(memberships.workspaceId, state.workspaceId), eq(memberships.userId, state.userId)));
    try {
      const response = await request.get("/api/auth/me");
      expect([401, 403]).toContain(response.status());
      expect((await response.json()).session).toBeFalsy();
      expect([401, 403]).toContain((await request.get("/api/people")).status());
    } finally {
      await db.update(memberships).set({ role: "manager" }).where(and(eq(memberships.workspaceId, state.workspaceId), eq(memberships.userId, state.userId)));
    }
  });

  test("an invalid stored invitation cannot create membership and leaves its sign-in token unused", async ({ request }) => {
    const state = await login(request);
    const email = `invalid-stored-role-${crypto.randomUUID()}@example.com`;
    const invitationId = crypto.randomUUID();
    await db.insert(invitations).values({ id: invitationId, workspaceId: state.workspaceId, email, role: "unknown-role" as "member", invitedByUserId: state.userId, expiresAt: Date.now() + 60_000, acceptedAt: null });
    const token = await createMagicLink(email);
    const { tid } = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { tid: string };
    const refusal = await consumeMagicLink(token).then(() => null, (error: unknown) => error);
    expect(refusal).not.toBeNull();
    expect([400, 401, 403]).toContain((refusal as { status?: number }).status);
    expect((await db.select().from(invitations).where(eq(invitations.id, invitationId)))[0].acceptedAt).toBeNull();
    expect((await db.select().from(magicLinks).where(eq(magicLinks.tokenId, tid)))[0].usedAt).toBeNull();
    const roles = await db.select().from(memberships).where(eq(memberships.workspaceId, state.workspaceId));
    expect(roles).toHaveLength(1);
    expect(roles[0].role).toBe("manager");
  });

  // Catch: `role in weights` accepting inherited Object properties, rather
  // than exact supported role strings, at the second acceptance surface.
  for (const role of ["unknown-role", "__proto__", "constructor", "toString"]) {
    test(`workspace selection refuses invalid stored invitation role ${role} without joining or switching`, async ({ request }) => {
      const state = await login(request);
      const target = await targetWorkspace();
      const invitationId = crypto.randomUUID();
      await db.insert(invitations).values({ id: invitationId, workspaceId: target.workspace.id, email: state.email, role: role as "member", invitedByUserId: target.owner.id, expiresAt: Date.now() + 60_000, acceptedAt: null });

      const response = await request.post("/api/auth/workspaces", { data: { workspaceId: target.workspace.id } });
      expect([400, 401, 403]).toContain(response.status());
      expect(await membership(target.workspace.id, state.userId)).toBeUndefined();
      expect((await db.select().from(invitations).where(eq(invitations.id, invitationId)))[0].acceptedAt).toBeNull();
      const current = await request.get("/api/auth/me");
      expect(current.status()).toBe(200);
      expect((await current.json()).session.workspaceId).toBe(state.workspaceId);
    });
  }

  test("workspace selection refuses an existing target membership with an invalid role without switching", async ({ request }) => {
    const state = await login(request);
    const target = await targetWorkspace();
    await db.insert(memberships).values({ userId: state.userId, workspaceId: target.workspace.id, role: "unknown-role" as "member" });

    const response = await request.post("/api/auth/workspaces", { data: { workspaceId: target.workspace.id } });
    expect([401, 403]).toContain(response.status());
    expect((await membership(target.workspace.id, state.userId)).role).toBe("unknown-role");
    const current = await request.get("/api/auth/me");
    expect(current.status()).toBe(200);
    expect((await current.json()).session.workspaceId).toBe(state.workspaceId);
  });
});

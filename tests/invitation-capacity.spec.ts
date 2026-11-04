import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { consumeMagicLink, createMagicLink, inviteUser } from "../lib/auth";
import { db } from "../lib/db";
import { invitations, magicLinks, memberships, workspaces } from "../lib/db/schema";
import { ensureMembership, ensureUser, ensureWorkspace } from "../lib/store";

test.describe("invitation acceptance capacity", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");
  test.setTimeout(90000);

  async function fixture(plan: "free" | "pro" = "pro") {
    const suffix = crypto.randomUUID();
    const owner = await ensureUser(`seat-owner-${suffix}@example.com`);
    const workspace = await ensureWorkspace(`seat-capacity-${suffix}`);
    await ensureMembership(owner.id, workspace.id, "owner");
    await db.update(workspaces).set({ plan }).where(eq(workspaces.id, workspace.id));
    return { owner, workspace };
  }

  async function invite(state: Awaited<ReturnType<typeof fixture>>, email = `seat-invite-${crypto.randomUUID()}@example.com`) {
    const invitation = await inviteUser({ email, workspaceId: state.workspace.id, invitedByUserId: state.owner.id, role: "client" });
    const token = await createMagicLink(email);
    const { tid } = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { tid: string };
    return { email, invitation, token, tokenId: tid };
  }

  async function memberCount(workspaceId: string) {
    return (await db.select().from(memberships).where(eq(memberships.workspaceId, workspaceId))).length;
  }

  async function signInHome(request: APIRequestContext, email: string) {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace: `seat-home-${crypto.randomUUID()}`, email, plan: "free" })}`);
    expect(response.ok()).toBeTruthy();
    return await response.json() as { userId: string; workspaceId: string };
  }

  test("magic-link acceptance rechecks seats and leaves a refused invitation and link reusable", async () => {
    const state = await fixture();
    const first = await invite(state);
    const second = await invite(state);
    expect((await consumeMagicLink(first.token)).membership.role).toBe("client");
    await expect(consumeMagicLink(second.token)).rejects.toMatchObject({ status: 402 });
    expect(await memberCount(state.workspace.id)).toBe(2);
    expect((await db.select().from(invitations).where(eq(invitations.id, second.invitation.id)))[0].acceptedAt).toBeNull();
    expect((await db.select().from(magicLinks).where(eq(magicLinks.tokenId, second.tokenId)))[0].usedAt).toBeNull();
    await db.update(workspaces).set({ plan: "smb" }).where(eq(workspaces.id, state.workspace.id));
    expect((await consumeMagicLink(second.token)).membership.role).toBe("client");
    expect(await memberCount(state.workspace.id)).toBe(3);
  });

  test("two simultaneous magic links cannot both take the last seat", async () => {
    const state = await fixture();
    const first = await invite(state);
    const second = await invite(state);
    const results = await Promise.allSettled([consumeMagicLink(first.token), consumeMagicLink(second.token)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 402 });
    expect(await memberCount(state.workspace.id)).toBe(2);
  });

  test("workspace selection rechecks seats without consuming the invitation or changing session", async ({ request }) => {
    const state = await fixture();
    const first = await invite(state);
    await consumeMagicLink(first.token);
    const email = `seat-existing-${crypto.randomUUID()}@example.com`;
    const home = await signInHome(request, email);
    const pending = await invite(state, email);
    const denied = await request.post("/api/auth/workspaces", { data: { workspaceId: state.workspace.id } });
    expect(denied.status()).toBe(402);
    expect((await denied.json()).error).toMatch(/member limit/);
    expect((await (await request.get("/api/auth/me")).json()).session.workspaceId).toBe(home.workspaceId);
    expect((await db.select().from(invitations).where(eq(invitations.id, pending.invitation.id)))[0].acceptedAt).toBeNull();
    expect(await db.select().from(memberships).where(and(eq(memberships.workspaceId, state.workspace.id), eq(memberships.userId, home.userId)))).toHaveLength(0);
    await db.update(workspaces).set({ plan: "smb" }).where(eq(workspaces.id, state.workspace.id));
    const accepted = await request.post("/api/auth/workspaces", { data: { workspaceId: state.workspace.id } });
    expect(accepted.status()).toBe(200);
    expect((await accepted.json()).redirectTo).toBe("/client");
  });

  test("magic-link and workspace selection acceptance share one last-seat lock", async ({ request }) => {
    const state = await fixture();
    const existingEmail = `seat-switch-${crypto.randomUUID()}@example.com`;
    await signInHome(request, existingEmail);
    await invite(state, existingEmail);
    const magic = await invite(state);
    const [selection, link] = await Promise.all([
      request.post("/api/auth/workspaces", { data: { workspaceId: state.workspace.id } }),
      consumeMagicLink(magic.token).then(() => 200, (error: { status?: number }) => error.status),
    ]);
    expect([selection.status(), link].sort()).toEqual([200, 402]);
    expect(await memberCount(state.workspace.id)).toBe(2);
  });

  test("existing members can sign in and switch back when their workspace is at capacity", async ({ request }) => {
    const state = await fixture("free");
    expect(await memberCount(state.workspace.id)).toBe(1);
    const login = await consumeMagicLink(await createMagicLink(state.owner.email));
    expect(login.membership.role).toBe("owner");
    const home = await signInHome(request, state.owner.email);
    expect((await request.post("/api/auth/workspaces", { data: { workspaceId: state.workspace.id } })).status()).toBe(200);
    expect((await request.post("/api/auth/workspaces", { data: { workspaceId: home.workspaceId } })).status()).toBe(200);
    expect((await request.post("/api/auth/workspaces", { data: { workspaceId: state.workspace.id } })).status()).toBe(200);
    expect(await memberCount(state.workspace.id)).toBe(1);
  });

  test("the sign-in redirect explains a full workspace instead of reporting a service failure", async ({ request, page }) => {
    const state = await fixture();
    const pending = await invite(state);
    // Invitations issued while there was room must also respect a later downgrade.
    await db.update(workspaces).set({ plan: "free" }).where(eq(workspaces.id, state.workspace.id));
    const response = await request.get(`/api/auth/verify?token=${encodeURIComponent(pending.token)}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const destination = new URL(response.headers().location);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("error")).toBe("workspace_full");
    expect((await db.select().from(magicLinks).where(eq(magicLinks.tokenId, pending.tokenId)))[0].usedAt).toBeNull();
    await page.goto("/login?error=workspace_full");
    const capacityAlert = page.getByRole("alert").filter({ hasText: /member limit/ });
    await expect(capacityAlert).toContainText(/member limit/);
    await expect(capacityAlert).toContainText(/try the same invitation/);
    await expect(capacityAlert).not.toContainText(/expired|no longer available/);
  });
});

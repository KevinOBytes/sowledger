import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as requestLink } from "../app/api/auth/request-link/route";
import { GET as testLogin } from "../app/api/test/login/route";
import { consumeMagicLink, createMagicLink, generatedWorkspaceSlug, inviteUser } from "../lib/auth";
import { getAppOrigin } from "../lib/app-url";
import { db } from "../lib/db";
import { invitations, magicLinks, memberships, users } from "../lib/db/schema";
import { env } from "../lib/env";
import { ensureMembership, ensureUser, ensureWorkspace } from "../lib/store";

test.beforeAll(() => {
  if (process.env.SOWLEDGER_TEST_DATABASE !== "true") throw new Error("Run these tests through scripts/with-test-database.mjs with a disposable branch.");
});

test("test fixture login is disabled without an explicitly isolated database", async () => {
  const previous = process.env.SOWLEDGER_TEST_DATABASE;
  delete process.env.SOWLEDGER_TEST_DATABASE;
  try {
    const response = await testLogin(new Request("http://localhost:3008/api/test/login?clean=true"));
    expect(response.status).toBe(403);
  } finally {
    if (previous === undefined) delete process.env.SOWLEDGER_TEST_DATABASE;
    else process.env.SOWLEDGER_TEST_DATABASE = previous;
  }
});

test("equal email names on different domains create separate workspaces", async () => {
  const label = `identity-${randomUUID()}`;
  const firstEmail = `${label}@one.example`;
  const secondEmail = `${label}@two.example`;
  expect(generatedWorkspaceSlug(firstEmail)).not.toBe(generatedWorkspaceSlug(secondEmail));
  const first = await consumeMagicLink(await createMagicLink(firstEmail));
  const second = await consumeMagicLink(await createMagicLink(secondEmail));
  expect(first.workspace.id).not.toBe(second.workspace.id);
  expect(first.membership.role).toBe("owner");
  expect(second.membership.role).toBe("owner");
  const wrongMembership = await db.select().from(memberships).where(and(eq(memberships.userId, second.user.id), eq(memberships.workspaceId, first.workspace.id)));
  expect(wrongMembership).toHaveLength(0);
});

test("a pending invitation is reachable for an existing account and keeps its client role", async () => {
  const email = `invited-${randomUUID()}@example.com`;
  const original = await consumeMagicLink(await createMagicLink(email));
  const other = await ensureWorkspace(`invitation-${randomUUID()}`);
  const invitation = await inviteUser({ email, workspaceId: other.id, role: "client", invitedByUserId: original.user.id });
  const accepted = await consumeMagicLink(await createMagicLink(email));
  expect(accepted.workspace.id).toBe(other.id);
  expect(accepted.membership.role).toBe("client");
  expect((await db.select().from(invitations).where(eq(invitations.id, invitation.id)))[0].acceptedAt).not.toBeNull();
});

test("a failed workspace setup rolls back the account and leaves the sign-in link unused", async () => {
  const email = `rollback-${randomUUID()}@example.com`;
  const owner = await ensureUser(`owner-${randomUUID()}@example.com`);
  const workspace = await ensureWorkspace(`rollback-${randomUUID()}`);
  await ensureMembership(owner.id, workspace.id, "owner");
  const invitation = await inviteUser({ email, workspaceId: workspace.id, role: "member", invitedByUserId: owner.id });
  const token = await createMagicLink(email);
  await db.update(invitations).set({ expiresAt: Date.now() - 1 }).where(eq(invitations.id, invitation.id));
  await expect(consumeMagicLink(token)).rejects.toThrow(/invitation/);
  const { tid } = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  expect((await db.select().from(magicLinks).where(eq(magicLinks.tokenId, tid)))[0].usedAt).toBeNull();
  expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  // Restoring the invitation makes the same unconsumed link usable.
  await db.update(invitations).set({ expiresAt: Date.now() + 60000 }).where(eq(invitations.id, invitation.id));
  expect((await consumeMagicLink(token)).membership.role).toBe("member");
});

test("a sign-in link can be consumed only once, including simultaneous requests", async () => {
  const token = await createMagicLink(`single-use-${randomUUID()}@example.com`);
  const results = await Promise.allSettled([consumeMagicLink(token), consumeMagicLink(token)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
});

test("sign-in keeps an existing account's current role", async () => {
  const original = await consumeMagicLink(await createMagicLink(`role-${randomUUID()}@example.com`));
  await db.update(memberships).set({ role: "manager" }).where(and(eq(memberships.userId, original.user.id), eq(memberships.workspaceId, original.workspace.id)));
  const token = await createMagicLink(original.user.email);
  await db.update(memberships).set({ role: "member" }).where(and(eq(memberships.userId, original.user.id), eq(memberships.workspaceId, original.workspace.id)));
  expect((await consumeMagicLink(token)).membership.role).toBe("member");
});

test("unconfigured development sign-in uses the request origin", async () => {
  const previousOrigin = env.NEXT_PUBLIC_APP_URL;
  const processOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const previousKey = env.RESEND_API_KEY;
  env.NEXT_PUBLIC_APP_URL = undefined;
  delete process.env.NEXT_PUBLIC_APP_URL;
  env.RESEND_API_KEY = undefined;
  try {
    const response = await requestLink(new NextRequest("http://localhost:3000/api/auth/request-link", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `local-origin-${randomUUID()}@example.com` }),
    }));
    expect(response.status).toBe(200);
    expect(new URL((await response.json()).verifyUrl).origin).toBe("http://localhost:3000");
  } finally {
    env.NEXT_PUBLIC_APP_URL = previousOrigin;
    if (processOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = processOrigin;
    env.RESEND_API_KEY = previousKey;
  }
});

test("workspace selection lists only memberships and invitations and enforces the invited role", async ({ page }) => {
  const suffix = randomUUID();
  const email = `switch-${suffix}@example.com`;
  const login = await page.request.get(`/api/test/login?workspace=switch-${suffix}&email=${email}&plan=smb`);
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  const invited = await ensureWorkspace(`invited-${suffix}`);
  const unrelated = await ensureWorkspace(`unrelated-${suffix}`);
  await inviteUser({ email, workspaceId: invited.id, role: "client", invitedByUserId: session.userId });
  const list = await page.request.get("/api/auth/workspaces");
  expect(list.ok()).toBeTruthy();
  const choices = await list.json();
  expect(choices.workspaces.map((workspace: { id: string }) => workspace.id).sort()).toEqual([session.workspaceId, invited.id].sort());
  expect((await page.request.post("/api/auth/workspaces", { data: { workspaceId: unrelated.id } })).status()).toBe(403);
  const join = await page.request.post("/api/auth/workspaces", { data: { workspaceId: invited.id } });
  expect(join.ok()).toBeTruthy();
  expect((await join.json()).redirectTo).toBe("/client");
  const active = await (await page.request.get("/api/auth/me")).json();
  expect(active.session.workspaceId).toBe(invited.id);
  expect(active.session.role).toBe("client");
  const back = await page.request.post("/api/auth/workspaces", { data: { workspaceId: session.workspaceId } });
  expect(back.ok()).toBeTruthy();
  expect((await back.json()).redirectTo).toBe("/dashboard");
});

test("a rejected email-provider response is an error, never a successful email notification", async () => {
  const previousKey = env.RESEND_API_KEY;
  const originalFetch = globalThis.fetch;
  env.RESEND_API_KEY = "re_test_invalid_not_a_real_key";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.resend.com/")) return Response.json({ name: "validation_error", message: "Test rejection" }, { status: 403 });
    return originalFetch(input, init);
  };
  try {
    const response = await requestLink(new NextRequest("http://localhost:3008/api/auth/request-link", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `delivery-${randomUUID()}@example.com` }),
    }));
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toMatch(/couldn't send/);
    expect(data.ok).toBeUndefined();
    expect(data.verifyUrl).toBeUndefined();
  } finally { env.RESEND_API_KEY = previousKey; globalThis.fetch = originalFetch; }
});

test("invalid email bodies return a useful validation error", async ({ request }) => {
  for (const email of [null, {}, 17, "not-an-email"]) {
    const response = await request.post("/api/auth/request-link", { data: { email } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/email address/);
  }
});

test("the sign-in screen explains the next step and legacy origins point to SOWLedger", async ({ page }) => {
  expect(getAppOrigin("https://www.billabled.com")).toBe("https://www.sowledger.com");
  expect(getAppOrigin("https://billabled.com/path")).toBe("https://www.sowledger.com");
  expect(getAppOrigin("https://www.sowledger.com/path")).toBe("https://www.sowledger.com");
  await page.goto("/login?error=service_unavailable");
  await expect(page.getByRole("heading", { name: "Sign in to SOWLedger" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't finish signing you in." })).toHaveText(/Try the link in your email again/);
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  await expect(page.getByText("What happens next")).toHaveCount(0);
});

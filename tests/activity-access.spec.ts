import { expect, test, type APIRequestContext } from "@playwright/test";
import { db } from "../lib/db";
import { auditLogs, organizations, users, workspacePeople, workspaces } from "../lib/db/schema";
import { eq } from "drizzle-orm";

test.describe("workspace activity access", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");
  const ownedWorkspaces = new Set<string>(), ownedUsers = new Set<string>();
  test.afterEach(async () => {
    for (const workspaceId of ownedWorkspaces) {
      await db.delete(workspacePeople).where(eq(workspacePeople.workspaceId, workspaceId));
      await db.delete(organizations).where(eq(organizations.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    for (const userId of ownedUsers) await db.delete(users).where(eq(users.id, userId));
    ownedWorkspaces.clear(); ownedUsers.clear();
  });

  async function login(request: APIRequestContext, workspace: string, role = "owner") {
    const query = new URLSearchParams({ workspace, email: `activity-${crypto.randomUUID()}@example.com`, role, plan: "smb" });
    const response = await request.get(`/api/test/login?${query}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const session = await response.json() as { userId: string; workspaceId: string };
    ownedWorkspaces.add(session.workspaceId); ownedUsers.add(session.userId);
    return session;
  }

  async function seedActivity(session: { userId: string; workspaceId: string }) {
    const id = crypto.randomUUID();
    const confidential = `another-client-proof-${crypto.randomUUID()}`;
    await db.insert(auditLogs).values({
      id, workspaceId: session.workspaceId, timeEntryId: crypto.randomUUID(), actorUserId: session.userId,
      eventType: "client_invoice_signed_off", signature: "synthetic-test-signature",
      diff: { clientSignoff: { before: null, after: { snapshot: { privateClientNotes: confidential } } } },
    });
    return { id, confidential };
  }

  test("clients cannot read workspace audit data even with a project filter", async ({ request }) => {
    const workspace = `activity-private-${crypto.randomUUID()}`;
    const owner = await login(request, workspace);
    const activity = await seedActivity(owner);
    await login(request, workspace, "client");
    for (const path of ["/api/activity", `/api/activity?projectId=${crypto.randomUUID()}`]) {
      const response = await request.get(path);
      expect(response.status()).toBe(403);
      const body = await response.text();
      expect(body).not.toContain(activity.confidential);
      expect(body).not.toContain(activity.id);
      expect(body).not.toContain("activities");
    }
  });

  test("workspace managers retain activity access without seeing other workspaces", async ({ request }) => {
    const first = await login(request, `activity-foreign-${crypto.randomUUID()}`);
    const foreignActivity = await seedActivity(first);
    const workspace = `activity-member-${crypto.randomUUID()}`;
    const owner = await login(request, workspace);
    const ownActivity = await seedActivity(owner);
    for (const role of ["owner", "manager"]) {
      await login(request, workspace, role);
      const response = await request.get("/api/activity");
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.activities.map((item: { id: string }) => item.id)).toContain(ownActivity.id);
      expect(JSON.stringify(body)).not.toContain(foreignActivity.id);
      expect(JSON.stringify(body)).not.toContain(foreignActivity.confidential);
    }
  });

  test("anonymous requests cannot read the activity feed", async ({ request }) => {
    const response = await request.get("/api/activity", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/login");
    expect(await response.text()).not.toContain("activities");
  });
});

import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test.describe("selective workspace exports", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");

  test("users-only export includes this workspace's users without including memberships", async ({ request }) => {
    const suffix = crypto.randomUUID();
    const foreignEmail = `export-foreign-${suffix}@example.com`;
    const ownEmail = `export-member-${suffix}@example.com`;
    expect((await request.get(`/api/test/login?workspace=export-foreign-${suffix}&email=${foreignEmail}`)).ok()).toBeTruthy();
    const login = await request.get(`/api/test/login?workspace=export-selection-${suffix}&email=${ownEmail}`);
    expect(login.ok()).toBeTruthy();
    const session = await login.json();

    const response = await request.get("/api/export/csv?format=json&include=users");
    expect(response.status()).toBe(200);
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data.users.map((user: { id: string }) => user.id)).toEqual([session.userId]);
    expect(data.users[0].email).toBe(ownEmail);
    expect(text).not.toContain(foreignEmail);
    expect(data.memberships).toEqual([]);
    expect(data.workspace).toBeNull();
    expect(response.headers()["x-sowledger-export-sha256"]).toBe(createHash("sha256").update(text).digest("hex"));

    const memberships = await request.get("/api/export/csv?format=json&include=memberships");
    expect(memberships.status()).toBe(200);
    const membershipData = await memberships.json();
    expect(membershipData.memberships.map((member: { userId: string }) => member.userId)).toEqual([session.userId]);
    expect(membershipData.users).toEqual([]);
  });
});

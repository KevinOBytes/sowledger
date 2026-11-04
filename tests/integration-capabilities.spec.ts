import { expect, test } from "@playwright/test";

test("integration management capability follows the current workspace role", async ({ request }) => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Only create role fixtures in the disposable database.");
  const workspace = `integration-capability-${crypto.randomUUID()}`;
  for (const role of ["owner", "manager", "member", "client"]) {
    expect((await request.get(`/api/test/login?${new URLSearchParams({ workspace, role, plan: "smb", email: `${role}-${workspace}@example.com` })}`)).ok()).toBeTruthy();
    const response = await request.get("/api/integrations");
    if (role === "client") {
      expect(response.status()).toBe(403);
      continue;
    }
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).canManage).toBe(role === "owner" || role === "manager");
    if (role === "member") {
      expect((await request.post("/api/integrations/google-calendar/sync", { data: {} })).status()).toBe(403);
      expect((await request.get("/api/integrations/google-calendar/oauth/start", { maxRedirects: 0 })).status()).toBe(403);
    }
  }
});

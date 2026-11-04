import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { clients, organizations, users } from "../lib/db/schema";

// Root owns the disposable database and port 3008. Fail closed if called outside
// its wrapper; these tests never infer permission from an available app server.
test.beforeAll(() => expect(process.env.SOWLEDGER_TEST_DATABASE, "Requires the root-owned disposable database wrapper").toBe("true"));
test.setTimeout(120_000);

async function login(request: APIRequestContext, options: { workspace?: string; email?: string; role?: string } = {}) {
  const suffix = crypto.randomUUID();
  const workspace = options.workspace ?? `profile-client-${suffix}`;
  const email = options.email ?? `profile-client-${suffix}@example.com`;
  const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email, role: options.role ?? "owner", plan: "smb" })}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return { ...await response.json() as { userId: string; workspaceId: string }, workspace, email };
}

async function createClient(request: APIRequestContext, name = "Persistence client") {
  const response = await request.post("/api/clients", { data: { name, email: "BILLING@EXAMPLE.COM", address: "123 Main", currencyOverride: "USD" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).client as { id: string; name: string; email: string | null; status: string };
}

test("profile clear persists while timezone, tags and calendar visible hours remain intact", async ({ request }) => {
  const state = await login(request);
  const initial = await request.patch("/api/user/settings", { data: { displayName: " Kevin ", timezone: "America/New_York", preferredTags: [" Focus ", "focus"], calendarPreferences: { visibleStartHour: 7, visibleEndHour: 19 } } });
  expect(initial.ok(), await initial.text()).toBeTruthy();
  const cleared = await request.patch("/api/user/settings", { data: { displayName: "" } });
  expect(cleared.ok(), await cleared.text()).toBeTruthy();
  const saved = (await cleared.json()).user;
  expect(saved.displayName).toBe("");
  expect(saved.timezone).toBe("America/New_York");
  expect(saved.preferredTags).toEqual(["focus"]);
  expect(saved.calendarPreferences).toEqual({ visibleStartHour: 7, visibleEndHour: 19 });
  const read = (await (await request.get("/api/user/settings")).json()).user;
  expect(read).toEqual(saved);
  expect(Object.keys(read).sort()).toEqual(["id", "email", "displayName", "timezone", "preferredTags", "calendarPreferences"].sort());
  const [persisted] = await db.select().from(users).where(eq(users.id, state.userId));
  expect(persisted.displayName).toBe("");
  expect(persisted.calendarPreferences).toEqual({ visibleStartHour: 7, visibleEndHour: 19 });
  expect((await request.patch("/api/user/settings", { data: { timezone: "Europe/London" } })).ok()).toBeTruthy();
  const omittedName = (await (await request.get("/api/user/settings")).json()).user;
  expect(omittedName.displayName).toBe("");
  expect(omittedName.timezone).toBe("Europe/London");
  expect(omittedName.calendarPreferences).toEqual({ visibleStartHour: 7, visibleEndHour: 19 });
});

test("client omitted email preserves; explicit blank/whitespace/null clears, and organization rename follows", async ({ request }) => {
  const state = await login(request);
  const client = await createClient(request);
  const renamed = await request.patch("/api/clients", { data: { clientId: client.id, name: " Renamed client " } });
  expect(renamed.ok(), await renamed.text()).toBeTruthy();
  expect((await renamed.json()).client).toMatchObject({ name: "Renamed client", email: "billing@example.com" });
  const [organization] = await db.select().from(organizations).where(and(eq(organizations.workspaceId, state.workspaceId), eq(organizations.clientId, client.id)));
  expect(organization.name).toBe("Renamed client");
  for (const email of ["", "  ", null]) {
    expect((await request.patch("/api/clients", { data: { clientId: client.id, email: " NEW@EXAMPLE.COM " } })).ok()).toBeTruthy();
    const clear = await request.patch("/api/clients", { data: { clientId: client.id, email } });
    expect(clear.ok(), await clear.text()).toBeTruthy();
    expect((await clear.json()).client.email).toBeNull();
    const [persisted] = await db.select().from(clients).where(and(eq(clients.workspaceId, state.workspaceId), eq(clients.id, client.id)));
    expect(persisted.email).toBeNull();
    expect(persisted.address).toBe("123 Main");
    expect(persisted.currencyOverride).toBe("USD");
    const apiClients = (await (await request.get("/api/clients")).json()).clients;
    expect(apiClients.find((item: { id: string }) => item.id === client.id).email).toBeNull();
  }
});

test("malformed shapes fail with actionable 400 and leave both stored records unchanged", async ({ request }) => {
  const state = await login(request);
  const client = await createClient(request);
  const beforeUser = (await (await request.get("/api/user/settings")).json()).user;
  for (const data of [null, [], {}, { displayName: null }, { displayName: 7 }, { timezone: null }, { timezone: "" }, { timezone: 42 }, { timezone: "Not/AZone" }, { preferredTags: [1] }, { calendarPreferences: { visibleStartHour: "7", visibleEndHour: "19" } }]) {
    const response = await request.patch("/api/user/settings", { headers: { "content-type": "application/json" }, data: JSON.stringify(data) });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
  }
  for (const data of [null, [], {}, { clientId: client.id }, { clientId: client.id, email: 1 }, { clientId: client.id, name: " " }, { clientId: client.id, status: "deleted" }, { clientId: client.id, address: {} }, { clientId: client.id, currencyOverride: "TOO-LONG-CURRENCY" }]) {
    const response = await request.patch("/api/clients", { headers: { "content-type": "application/json" }, data: JSON.stringify(data) });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
  }
  for (const path of ["/api/user/settings", "/api/clients"]) expect((await request.patch(path, { headers: { "content-type": "application/json" }, data: "{" })).status()).toBe(400);
  expect((await (await request.get("/api/user/settings")).json()).user).toEqual(beforeUser);
  const [stored] = await db.select().from(clients).where(and(eq(clients.workspaceId, state.workspaceId), eq(clients.id, client.id)));
  expect(stored).toMatchObject({ name: client.name, email: "billing@example.com", status: "active", address: "123 Main", currencyOverride: "USD" });
});

test("auth, current role, foreign IDs and own-global-profile boundaries remain authoritative", async ({ request, playwright, baseURL }) => {
  const state = await login(request);
  const client = await createClient(request);
  const other = await playwright.request.newContext({ baseURL });
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    for (const pathname of ["/api/clients", "/api/user/settings"]) {
      const denied = await anonymous.patch(pathname, { data: {}, maxRedirects: 0 });
      expect(denied.status()).toBe(307);
      expect(new URL(denied.headers().location, denied.url()).href).toBe(new URL("/login", denied.url()).href);
    }
    const foreign = await login(other);
    expect((await other.patch("/api/clients", { data: { clientId: client.id, email: "foreign@example.com" } })).status()).toBe(404);
    const foreignBefore = (await (await other.get("/api/user/settings")).json()).user;
    expect((await request.patch("/api/user/settings", { data: { userId: foreign.userId, displayName: "Only my profile" } })).ok()).toBeTruthy();
    expect((await (await other.get("/api/user/settings")).json()).user).toEqual(foreignBefore);
    for (const role of ["member", "client"]) {
      await login(other, { workspace: state.workspace, role });
      expect((await other.post("/api/clients", { data: { name: "Unauthorized create" } })).status()).toBe(403);
      expect((await other.patch("/api/clients", { data: { clientId: client.id, email: "forbidden@example.com" } })).status()).toBe(403);
      expect((await other.patch("/api/user/settings", { data: { displayName: "My profile" } })).status()).toBe(role === "member" ? 200 : 403);
    }
    const [stored] = await db.select().from(clients).where(and(eq(clients.workspaceId, state.workspaceId), eq(clients.id, client.id)));
    expect(stored.email).toBe("billing@example.com");
    await login(other, { workspace: state.workspace, role: "manager" });
    expect((await other.patch("/api/clients", { data: { clientId: client.id, name: "Manager rename" } })).status()).toBe(200);
  } finally { await other.dispose(); await anonymous.dispose(); }
});

for (const width of [390, 1440]) test(`profile/client clear and archive/restore survive actual UI reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const state = await login(page.request);
  await page.request.patch("/api/user/settings", { data: { displayName: "Kevin", timezone: "America/New_York", calendarPreferences: { visibleStartHour: 7, visibleEndHour: 19 } } });
  const client = await createClient(page.request, "UI persistence client");
  await page.goto("/settings");
  await page.getByLabel("Display name").fill("");
  const savedProfileResponse = page.waitForResponse(response => response.url().endsWith("/api/user/settings") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  const savedResponse = await savedProfileResponse;
  expect(savedResponse.request().postDataJSON()).toMatchObject({ displayName: "" });
  expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy();
  expect((await savedResponse.json()).user.displayName).toBe("");
  await expect(page.getByRole("status")).toContainText("Settings saved");
  const [savedProfile] = await db.select().from(users).where(eq(users.id, state.userId));
  expect(savedProfile.displayName, "DB immediately after profile save").toBe("");
  expect(savedProfile.calendarPreferences).toEqual({ visibleStartHour: 7, visibleEndHour: 19 });
  expect((await (await page.request.get("/api/user/settings")).json()).user.displayName, "GET immediately after profile save").toBe("");
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("");
  await expect(page.getByLabel("Timezone")).toHaveValue("America/New_York");
  await page.goto("/clients");
  await page.getByRole("button", { name: "Edit Client", exact: true }).click();
  await page.getByLabel("Client name").fill("UI renamed client");
  await page.getByLabel("Billing email", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await expect(page.getByRole("heading", { name: "UI renamed client", exact: true })).toBeVisible();
  await expect(page.getByText("No billing email", { exact: true })).toBeVisible();
  const [persisted] = await db.select().from(clients).where(and(eq(clients.workspaceId, state.workspaceId), eq(clients.id, client.id)));
  expect(persisted.email).toBeNull();
  const [org] = await db.select().from(organizations).where(and(eq(organizations.workspaceId, state.workspaceId), eq(organizations.clientId, client.id)));
  expect(org.name).toBe("UI renamed client");
  await page.getByRole("button", { name: "Archive Client", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("archived");
  await page.reload();
  await page.getByRole("button", { name: "Restore Client", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("restored");
  await page.reload();
  await expect(page.getByRole("button", { name: "Restore Client", exact: true })).toHaveCount(0);
  await login(page.request, { workspace: state.workspace, role: "member" });
  await page.goto("/clients");
  for (const name of ["New Client", "Edit Client", "Archive Client", "Restore Client"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View projects", exact: true })).toBeVisible();
});

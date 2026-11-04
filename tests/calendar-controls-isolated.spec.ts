import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { integrationConnections, users, workspaces } from "../lib/db/schema";

// Root owns execution with the disposable database/application wrapper.
test.use({ timezoneId: "America/New_York" });
test.beforeAll(() => expect(process.env.SOWLEDGER_TEST_DATABASE, "Never seed calendar config fixtures outside the disposable database").toBe("true"));

async function login(request: APIRequestContext) {
  const slug = `calendar-config-ui-${crypto.randomUUID()}`;
  const email = `${slug}@example.com`;
  const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace: slug, email, plan: "smb" })}`);
  expect(response.status()).toBe(200);
  return { ...await response.json() as { workspaceId: string; userId: string }, slug, email };
}

for (const width of [390, 1280]) test(`Google config browser save, workspace readback and reload persist at ${width}px`, async ({ page, playwright, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 900 });
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", domain: "localhost", path: "/" }]);
  const other = await playwright.request.newContext({ baseURL });
  const fixtures: Awaited<ReturnType<typeof login>>[] = [];
  const errors: string[] = [];
  const mutations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/integrations") && request.method() !== "GET") mutations.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  try {
    const actor = await login(page.request); fixtures.push(actor);
    const outsider = await login(other); fixtures.push(outsider);
    const connectionId = crypto.randomUUID(); const otherConnectionId = crypto.randomUUID();
    const generation = crypto.randomUUID();
    const initialSync = new Date("2026-10-20T12:00:00.000Z");
    await db.insert(integrationConnections).values([
      { id: connectionId, workspaceId: actor.workspaceId, createdByUserId: actor.userId, provider: "google_calendar", status: "connected", displayName: "Synthetic calendar config fixture", credentials: {}, config: { connectionGeneration: generation, calendarId: "primary", importBusy: true, syncScheduled: true }, lastSyncedAt: initialSync, lastError: "Synthetic prior failure" },
      { id: otherConnectionId, workspaceId: outsider.workspaceId, createdByUserId: outsider.userId, provider: "google_calendar", status: "connected", displayName: "Other synthetic calendar", credentials: {}, config: { connectionGeneration: crypto.randomUUID(), calendarId: "other-calendar", importBusy: true, syncScheduled: true }, lastSyncedAt: initialSync },
    ]);
    const row = async (workspaceId: string, id: string) => (await db.select({ id: integrationConnections.id, workspaceId: integrationConnections.workspaceId, config: integrationConnections.config, lastSyncedAt: integrationConnections.lastSyncedAt, lastError: integrationConnections.lastError, status: integrationConnections.status, updatedAt: integrationConnections.updatedAt }).from(integrationConnections).where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.id, id))))[0];
    const untouched = await row(outsider.workspaceId, otherConnectionId);
    const publicRead = async () => {
      const response = await page.request.get("/api/integrations"); expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.canManage).toBe(true);
      expect(data.connections.map((connection: { id: string }) => connection.id)).toEqual([connectionId]);
      return data.connections[0];
    };
    await page.goto("/integrations");
    const input = page.getByLabel("Google calendar ID", { exact: true });
    await expect(input).toHaveValue("primary");
    await input.fill("synthetic-planning@example.com");
    await page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true }).uncheck();
    await page.getByLabel("Import external busy events as unavailable blocks", { exact: true }).uncheck();
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/integrations/google_calendar/config" && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const response = await pending;
    expect(response.request().postDataJSON()).toEqual({ calendarId: "synthetic-planning@example.com", importBusy: false, syncScheduled: false });
    expect(response.status()).toBe(200);
    const saved = await response.json();
    const config = { connectionGeneration: generation, calendarId: "synthetic-planning@example.com", importBusy: false, syncScheduled: false };
    expect(saved).toMatchObject({ ok: true, connection: { id: connectionId, provider: "google_calendar", status: "connected", config, lastSyncedAt: null, lastError: null } });
    expect(saved.connection).not.toHaveProperty("credentials");
    expect(await row(actor.workspaceId, connectionId)).toMatchObject({ workspaceId: actor.workspaceId, config, lastSyncedAt: null, lastError: null, status: "connected" });
    expect(await publicRead()).toMatchObject({ id: connectionId, config, lastSyncedAt: null, lastError: null });
    expect(await row(outsider.workspaceId, otherConnectionId)).toEqual(untouched);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.reload();
    await expect(input).toHaveValue("synthetic-planning@example.com");
    await expect(page.getByLabel("Push SOWLedger planned blocks to Google Calendar", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Import external busy events as unavailable blocks", { exact: true })).not.toBeChecked();
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Google Calendar", exact: true }) });
    await expect(card.locator("dd").filter({ hasText: "Never" })).toHaveCount(1);
    await expect(card.getByText("Last error", { exact: true })).toHaveCount(0);
    await input.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`calendar-config-saved-${width}.png`), fullPage: true });
    expect(mutations).toEqual(["PATCH /api/integrations/google_calendar/config"]);
    expect(errors).toEqual([]);
  } finally {
    await other.dispose();
    for (const fixture of fixtures.reverse()) {
      await db.delete(workspaces).where(and(eq(workspaces.id, fixture.workspaceId), eq(workspaces.slug, fixture.slug)));
      await db.delete(users).where(and(eq(users.id, fixture.userId), eq(users.email, fixture.email)));
    }
  }
});

import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./helpers/stream-diagnostic-fixture";
import { completeActionRefresh, finishResponse, mutationResponse } from "./helpers/request-completion";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { apiKeys, clients, invoices, projects, timeEntries } from "../lib/db/schema";
import { generateApiKeyMaterial } from "../lib/api-keys";
import { getClientEntitledInvoiceIds } from "../lib/client-entitlements";

test.describe("project financial history", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never write fixtures to production.");

  async function fixture(request: APIRequestContext) {
    const suffix = crypto.randomUUID();
    const response = await request.get(`/api/test/login?workspace=project-history-${suffix}&email=history-${suffix}@example.com&plan=smb`);
    expect(response.ok()).toBeTruthy();
    const owner = await response.json() as { userId: string; workspaceId: string };
    const [clientA, clientB] = await db.insert(clients).values([
      { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Original client" },
      { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Different client" },
    ]).returning();
    const [project] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Recorded client work", clientId: clientA.id }).returning();
    const [entry] = await db.insert(timeEntries).values({
      id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId, projectId: project.id,
      taskId: "private-work", description: "Private work for the original client", startedAt: new Date("2026-10-01T09:00:00Z"), stoppedAt: new Date("2026-10-01T10:00:00Z"), durationSeconds: 3600,
      status: "invoiced", hourlyRate: 125,
    }).returning();
    const [invoice] = await db.insert(invoices).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, projectId: project.id, number: `PRIVATE-${suffix}`, amount: 125, status: "sent", timeEntryIds: [entry.id] }).returning();
    const material = generateApiKeyMaterial();
    await db.insert(apiKeys).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, createdByUserId: owner.userId, name: "History regression", keyHash: material.keyHash, keyPrefix: material.keyPrefix, scopes: ["write:projects"] });
    return { ...owner, project, entry, invoice, clientA, clientB, headers: { authorization: `Bearer ${material.rawKey}` } };
  }

  for (const path of ["/api/projects", "/api/v1/projects"]) {
    test(`${path} cannot transfer or remove the client on recorded work`, async ({ request }) => {
      const state = await fixture(request);
      expect(await getClientEntitledInvoiceIds(state.workspaceId, [state.clientA.id])).toContain(state.invoice.id);
      for (const clientId of [state.clientB.id, null]) {
        const response = await request.patch(path, { headers: path.includes("/v1/") ? state.headers : undefined, data: { projectId: state.project.id, clientId } });
        expect(response.status()).toBe(409);
      }
      const [project] = await db.select().from(projects).where(and(eq(projects.id, state.project.id), eq(projects.workspaceId, state.workspaceId)));
      expect(project.clientId).toBe(state.clientA.id);
      expect(await getClientEntitledInvoiceIds(state.workspaceId, [state.clientA.id])).toContain(state.invoice.id);
      expect(await getClientEntitledInvoiceIds(state.workspaceId, [state.clientB.id])).not.toContain(state.invoice.id);
      const unchanged = await request.patch(path, { headers: path.includes("/v1/") ? state.headers : undefined, data: { projectId: state.project.id, clientId: state.clientA.id, name: "Renamed safely", status: "archived" } });
      expect(unchanged.status()).toBe(200);
      expect(await getClientEntitledInvoiceIds(state.workspaceId, [state.clientA.id])).toContain(state.invoice.id);
    });
  }

  test("deleting recorded work is refused without changing entries or client access", async ({ request }) => {
    const state = await fixture(request);
    const response = await request.delete(`/api/projects?projectId=${state.project.id}`);
    expect(response.status()).toBe(409);
    expect(await response.text()).toMatch(/archive/i);
    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, state.entry.id), eq(timeEntries.workspaceId, state.workspaceId)));
    expect(entry.projectId).toBe(state.project.id);
    expect(await getClientEntitledInvoiceIds(state.workspaceId, [state.clientA.id])).toContain(state.invoice.id);
  });

  test("unused projects can still change client and be deleted", async ({ request }) => {
    const state = await fixture(request);
    const create = await request.post("/api/projects", { data: { name: "Unused", clientId: state.clientA.id } });
    expect(create.ok()).toBeTruthy();
    const { project } = await create.json();
    expect((await request.patch("/api/projects", { data: { projectId: project.id, clientId: state.clientB.id } })).status()).toBe(200);
    expect((await request.patch("/api/v1/projects", { headers: state.headers, data: { projectId: project.id, clientId: null } })).status()).toBe(200);
    expect((await request.delete(`/api/projects?projectId=${project.id}`)).status()).toBe(200);
    expect(await db.select().from(projects).where(and(eq(projects.id, project.id), eq(projects.workspaceId, state.workspaceId)))).toHaveLength(0);
  });

  test("draft time also fixes the client boundary before approval can race it", async ({ request }) => {
    const state = await fixture(request);
    const [project] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, name: "Draft time", clientId: state.clientA.id }).returning();
    await db.insert(timeEntries).values({ id: crypto.randomUUID(), workspaceId: state.workspaceId, userId: state.userId, projectId: project.id, taskId: "draft", startedAt: new Date(), status: "draft" });
    expect((await request.patch("/api/projects", { data: { projectId: project.id, clientId: state.clientB.id } })).status()).toBe(409);
    expect((await request.delete(`/api/projects?projectId=${project.id}`)).status()).toBe(409);
  });

  test("a refused delete explains the archive alternative in the project menu", async ({ page }) => {
    const state = await fixture(page.request);
    await page.goto(`/projects/${state.project.id}`);
    const archivedBadge = page.getByText("Archived", { exact: true });
    await expect(archivedBadge).toHaveCount(0);
    const decline = page.getByRole("button", { name: "Decline", exact: true });
    if (await decline.isVisible()) await decline.click();
    await page.getByRole("button", { name: "Project actions", exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Delete Project", exact: true }).click();
    const error = page.getByRole("alert").filter({ hasText: /recorded time/i });
    await expect(error).toContainText(/archive.*billing history/i);
    await expect(page.getByRole("button", { name: "Archive Project", exact: true })).toBeVisible();
    await completeActionRefresh(page, async () => {
      const archived = page.waitForResponse(mutationResponse(page.url(), "/api/projects", "PATCH", { projectId: state.project.id, status: "archived" }));
      await page.getByRole("button", { name: "Archive Project", exact: true }).click();
      const response = await archived;
      expect(response.status()).toBe(200);
      await finishResponse(response);
      expect(await response.json()).toMatchObject({ ok: true, project: { id: state.project.id, status: "archived" } });
    }, async () => {
      // This badge is derived from the server page's project query, not menu state.
      await expect(archivedBadge).toBeVisible();
    });
    await expect(error).toHaveCount(0);
    await expect.poll(async () => {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, state.project.id), eq(projects.workspaceId, state.workspaceId)));
      return project.status;
    }).toBe("archived");
    expect((await page.reload())?.status()).toBe(200);
    await expect(archivedBadge).toBeVisible();
    await page.getByRole("button", { name: "Project actions", exact: true }).click();
    await expect(page.getByRole("button", { name: "Restore Project", exact: true })).toBeVisible();
  });
});

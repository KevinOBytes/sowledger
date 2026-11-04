import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import { gotoApp } from "./helpers/navigation";

test.describe("draft correction UI: disposable persistence", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Controller-owned disposable runtime required");
  for (const width of [390, 1440]) test(`${width}px review, cancel, error, pending and confirmed correction`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const login = await page.request.get(`/api/test/login?${new URLSearchParams({ workspace: `void-ui-${crypto.randomUUID()}`, email: `void-${crypto.randomUUID()}@example.com`, plan: "smb" })}`);
    expect(login.ok()).toBe(true); const owner = await login.json();
    try {
      const id = crypto.randomUUID();
      await db.insert(schema.timeEntries).values({ id, ...owner, taskId: "Correction UI", description: "Incorrect selection", startedAt: new Date("2026-10-31T10:00:00Z"), stoppedAt: new Date("2026-10-31T11:00:00Z"), durationSeconds: 3600, hourlyRate: 125, status: "approved", source: "manual" });
      const create = await page.request.post("/api/invoices", { data: { timeEntryIds: [id] } }); expect(create.ok()).toBe(true); const { invoice } = await create.json();
      await gotoApp(page, "/invoices");
      await page.getByRole("button", { name: "Review draft", exact: true }).click();
      await expect(page.getByText("Details SHA-256:", { exact: false })).toBeVisible();
      const open = page.getByRole("button", { name: "Void draft", exact: true });
      await open.focus(); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Void draft invoice" });
      await expect(dialog).toContainText("does not cancel anything in QuickBooks");
      const confirm = dialog.getByRole("button", { name: "Void invoice", exact: true });
      await expect(confirm).toBeDisabled();
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
      await open.click();
      await dialog.getByRole("checkbox", { name: "I confirm this invoice has not been billed elsewhere." }).check();
      await page.route(`**/api/invoices/${invoice.id}/void`, route => route.fulfill({ status: 409, json: { error: "The invoice was exported. Refresh invoices." } }), { times: 1 });
      await confirm.click(); await expect(dialog.getByRole("alert")).toContainText("exported"); await expect(confirm).toBeEnabled();
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route(`**/api/invoices/${invoice.id}/void`, async route => { await gate; await route.continue(); }, { times: 1 });
      await confirm.click(); await expect(dialog.getByRole("button", { name: "Voiding..." })).toBeDisabled();
      await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); release();
      await expect(dialog).toHaveCount(0); await expect(page.getByRole("status").filter({ hasText: "Invoice voided" })).toBeVisible();
      await expect(page.getByText("Details SHA-256:", { exact: false })).toHaveCount(0);
      await expect(page.getByText("$0.00 across active invoices.")).toBeVisible();
      await expect(page.getByText(invoice.number, { exact: true })).toBeVisible();
      const [saved] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id)); expect(saved.status).toBe("approved");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, owner.workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, owner.userId));
    }
  });
});

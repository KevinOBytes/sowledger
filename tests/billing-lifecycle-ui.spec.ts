import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { users, workspaces } from "../lib/db/schema";

test.describe("billing renewal recovery interface", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Disposable login fixtures only");
  for (const owner of [true, false]) for (const internal of [false, true]) for (const status of ["grace", "expired", "payment_required", "reconciliation_pending"]) {
    const expired = status === "expired", pending = status === "reconciliation_pending";
    test(`final-wave: ${internal ? "internal" : "Stripe"} ${owner ? "owner" : "member"} sees accurate ${status} billing notice`, async ({ page }) => {
      const workspace = `billing-ui-${crypto.randomUUID()}`;
      const email = `${workspace}@example.com`;
      // page.request shares this browser's authenticated cookie jar.
      const login = await page.request.get(`/api/test/login?${new URLSearchParams({ workspace, role: owner ? "owner" : "member", plan: "pro", email })}`);
      expect(login.ok()).toBeTruthy();
      const owned = await login.json() as { userId: string; workspaceId: string };
      expect(typeof owned.workspaceId).toBe("string"); expect(typeof owned.userId).toBe("string");
      try {
        let portalCalls = 0;
        await page.route("**/api/billing", route => route.fulfill({ json: {
          ok: true, plan: internal ? "enterprise" : status === "grace" ? "pro" : "free", storedPlan: "pro", planSource: internal ? "internal" : "stripe",
          billingStatus: expired ? "past_due" : status, graceEndsAt: status === "grace" || expired ? "2026-11-06T16:00:00.000Z" : null, graceExpired: expired,
          hasStripeCustomer: true, isOwner: owner, usage: { members: 1, projects: 1 }, limits: { members: 2, projects: 10, storageMB: 1000, goals: 10 }, plans: [],
        } }));
        await page.route("**/api/stripe/portal", route => { portalCalls++; return route.fulfill({ status: 400, json: { error: "Synthetic portal boundary reached" } }); });
        await page.goto("/settings/billing");
        const notice = page.getByRole("status").filter({ hasText: "Your workspace data hasn't been deleted" });
        await expect(notice).toBeVisible();
        if (pending) {
          await expect(notice).toContainText("Stripe payment verification is still in progress.");
          await expect(notice).toContainText(internal ? "Your internal Business access remains available." : "Paid access is temporarily unavailable while we check your billing status.");
          await expect(notice).not.toContainText(/unpaid invoice|successful payment|payment failed|restore paid access|Paid access returns|Paid access ended/);
          await expect(notice.locator("time")).toHaveCount(0);
          await expect(notice).toContainText(owner ? "Use Manage subscription to review your Stripe billing details." : "Your workspace owner can review the Stripe billing details.");
        } else {
          if (internal) {
            await expect(notice).toContainText("Your internal Business access remains available.");
            await expect(notice).not.toContainText(/Paid access ended|Paid access ends|restore paid access|Paid access returns/);
          } else {
            await expect(notice).toContainText(expired ? "grace period has expired" : status === "grace" ? "seven-day grace period" : "successful payment");
          }
          if (status === "grace" || expired) {
            await expect(notice.locator("time")).toHaveAttribute("datetime", "2026-11-06T16:00:00.000Z");
            if (internal) await expect(notice).toContainText("Stripe renewal grace");
          } else await expect(notice.locator("time")).toHaveCount(0);
        }
        await expect(page.getByText("Business access", { exact: true })).toHaveCount(internal ? 1 : 0);
        const portal = page.getByRole("button", { name: "Manage subscription" });
        if (owner) {
          await expect(portal).toBeVisible(); await portal.click();
          await expect.poll(() => portalCalls).toBe(1); await expect(portal).toBeEnabled();
        } else {
          await expect(portal).toHaveCount(0); if (!pending) await expect(notice).toContainText("Ask your workspace owner"); expect(portalCalls).toBe(0);
        }
      } finally {
        // Exact returned IDs plus the UUID-owned slug/email: never broad cleanup.
        await db.delete(workspaces).where(and(eq(workspaces.id, owned.workspaceId), eq(workspaces.slug, workspace)));
        await db.delete(users).where(and(eq(users.id, owned.userId), eq(users.email, email)));
        await page.context().clearCookies();
      }
    });
  }
});

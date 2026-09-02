import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers/navigation";

const industryRoutes = [
  { slug: "freelance-developers", name: "Freelance Developers" },
  { slug: "marketing-agencies", name: "Marketing Agencies" },
  { slug: "seo-consultants", name: "SEO Consultants" },
  { slug: "graphic-designers", name: "Graphic Designers" },
  { slug: "legal-consultants", name: "Legal Consultants" },
  { slug: "accounting-firms", name: "Accounting Firms" },
  { slug: "video-editors", name: "Video Editors" },
  { slug: "copywriters", name: "Copywriters" },
  { slug: "pr-agencies", name: "PR Agencies" },
  { slug: "it-consultants", name: "IT Consultants" },
  { slug: "management-consultants", name: "Management Consultants" },
  { slug: "web-design-studios", name: "Web Design Studios" },
];

test.describe("Built-for marketing routes", () => {
  test("keeps the audience hub and every audience page public", async ({ page }) => {
    const hubResponse = await gotoApp(page, "/for");
    expect(hubResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/for$/);
    await expect(page.getByRole("heading", { level: 1, name: "Proof-backed billing built for the way you work." })).toBeVisible();

    for (const industry of industryRoutes) {
      const response = await page.request.get(`/for/${industry.slug}`);
      expect(response.status(), `/${industry.slug} should remain public`).toBe(200);

      await gotoApp(page, `/for/${industry.slug}`);
      await expect(page).toHaveURL(new RegExp(`/for/${industry.slug}$`));
      await expect(page.getByRole("heading", { level: 1 })).toContainText(industry.name);
    }
  });

  test("makes every audience discoverable from the hub, navigation, and sitemap", async ({ page }, testInfo) => {
    await gotoApp(page, "/for");
    const audienceLinks = page.locator("main a[href^='/for/']");
    await expect(audienceLinks).toHaveCount(industryRoutes.length);

    if (testInfo.project.name === "mobile-safari") {
      await page.getByRole("button", { name: "Open marketing menu" }).click();
      const mobileNavigation = page.getByRole("navigation", { name: "Mobile marketing navigation" });
      await expect(mobileNavigation.getByRole("link", { name: "Built for", exact: true })).toBeVisible();
      await mobileNavigation.getByRole("link", { name: "Built for", exact: true }).click();
      await expect(page).toHaveURL(/\/for$/);
    } else {
      const desktopNavigation = page.getByRole("navigation", { name: "Marketing navigation" });
      await expect(desktopNavigation.getByRole("link", { name: "Built for", exact: true })).toHaveAttribute("href", "/for");
    }

    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapXml = await sitemap.text();
    expect(sitemapXml).toContain("https://www.sowledger.com/for");
    expect(sitemapXml).toContain("https://www.sowledger.com/support/api");
    for (const industry of industryRoutes) {
      expect(sitemapXml).toContain(`https://www.sowledger.com/for/${industry.slug}`);
    }
  });

  test("keeps representative audience pages distinct and technically truthful", async ({ page }) => {
    for (const industry of industryRoutes.slice(0, 2)) {
      await gotoApp(page, `/for/${industry.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(industry.name);
      await expect(page.getByRole("heading", { name: "Common work to capture", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Proof you can hand off", exact: true })).toBeVisible();
      await expect(page.locator("details summary")).toHaveCount(3);
    }

    await gotoApp(page, "/for/freelance-developers");
    await expect(page.getByText("Prove every commit", { exact: false })).toHaveCount(0);
    await expect(page.getByText("connects your PRs", { exact: false })).toHaveCount(0);
  });
});

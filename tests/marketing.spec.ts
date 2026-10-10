import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers/navigation";
import { STRIPE_PLANS } from "../lib/billing-plans";

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

test.describe("Public marketing", () => {
  test("connects the homepage to signup, product details, and accurate workspace plans", async ({ page }) => {
    const response = await gotoApp(page, "/");
    expect(response?.status()).toBe(200);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(main.getByRole("link", { name: "Start free", exact: true }).first()).toHaveAttribute("href", "/login");
    await expect(main.getByRole("link", { name: "Read API docs", exact: true })).toHaveAttribute("href", "/support/api");

    const productLinks = page.getByRole("navigation", { name: "SOWLedger capability navigation" }).getByRole("link");
    await expect(productLinks).toHaveCount(5);
    for (const link of await productLinks.all()) {
      const href = await link.getAttribute("href");
      expect(href).toMatch(/^#/);
      await expect(page.locator(href!)).toHaveCount(1);
    }

    const planRows = page.getByTestId("pricing-plan");
    await expect(planRows).toHaveCount(4);
    for (const plan of Object.values(STRIPE_PLANS)) {
      const row = planRows.filter({ has: page.getByRole("heading", { name: plan.name, exact: true }) });
      await expect(row).toContainText(`$${plan.price}`);
      await expect(row).toContainText(`${plan.limits.members} ${plan.limits.members === 1 ? "person" : "people"}`);
      await expect(row).toContainText(`${plan.limits.projects} projects`);
      await expect(row.getByRole("link")).toHaveAttribute("href", "/login");
      if (plan.planId !== "free") await expect(row.getByText(plan.planId, { exact: true })).toHaveCount(0);
    }
    await expect(main).not.toContainText(/proof-backed|retainer leak radar|likelihood proxy|x-sowledger-export-sha256/i);
    await expect(main.getByRole("link", { name: /sample proof pack/i })).toHaveCount(0);
    await expect(main.getByText(/illustrative example, not customer data/i)).toBeVisible();
  });

  test("explains estimate assumptions and supports zero unlogged hours", async ({ page }) => {
    await gotoApp(page, "/");
    const estimate = page.getByRole("region", { name: "Unlogged time estimate" });
    await expect(estimate.getByRole("slider")).toHaveCount(3);
    const hours = estimate.getByRole("slider", { name: /unlogged hours per person/i });
    await hours.focus();
    await hours.press("Home");
    await expect(hours).toHaveValue("0");
    await expect(estimate.getByText("$0", { exact: true })).toBeVisible();
    await expect(estimate).toContainText("not a forecast");
    await expect(estimate).not.toContainText(/dispute risk|likelihood|critical/i);
    await hours.press("ArrowRight");
    await expect(hours).toHaveValue("1");
    await expect(estimate.getByText("$3,250", { exact: true })).toBeVisible();
  });

  test("keeps the audience hub and every audience page public", async ({ page }) => {
    test.setTimeout(90_000);
    const hubResponse = await gotoApp(page, "/for");
    expect(hubResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/for$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    for (const industry of industryRoutes) {
      const response = await page.request.get(`/for/${industry.slug}`);
      expect(response.status(), `/${industry.slug} should remain public`).toBe(200);

      await gotoApp(page, `/for/${industry.slug}`);
      await expect(page).toHaveURL(new RegExp(`/for/${industry.slug}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(industry.name);
      await expect(page).toHaveTitle(new RegExp(industry.name));
      await expect(page.getByRole("link", { name: "Start free", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Integrate", exact: true })).toBeVisible();
    }
  });

  test("makes every audience discoverable from the hub, navigation, and sitemap", async ({ page }, testInfo) => {
    await gotoApp(page, "/for");
    const audienceLinks = page.locator("main a[href^='/for/']");
    await expect(audienceLinks).toHaveCount(industryRoutes.length);
    expect(await audienceLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(
      industryRoutes.map((industry) => `/for/${industry.slug}`),
    );

    if (testInfo.project.name === "mobile-safari") {
      await page.getByRole("button", { name: "Open marketing menu" }).click();
      await expect(page.getByRole("button", { name: "Close marketing menu" })).toHaveAttribute("aria-expanded", "true");
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
    const headlines: string[] = [];
    for (const industry of industryRoutes.slice(0, 2)) {
      await gotoApp(page, `/for/${industry.slug}`);
      headlines.push(await page.getByRole("heading", { level: 1 }).innerText());
      await expect(page.locator("#common-work-heading")).toBeVisible();
      await expect(page.locator("#proof-heading")).toBeVisible();
      await expect(page.locator("section[aria-labelledby='workflow-heading'] li")).toHaveCount(6);
      await expect(page.locator("details summary")).toHaveCount(3);
    }
    expect(new Set(headlines).size).toBe(2);

    await expect(page.locator("section[aria-labelledby='common-work-heading']")).toContainText(/campaign/i);

    await gotoApp(page, "/for/freelance-developers");
    await expect(page.locator("section[aria-labelledby='common-work-heading']")).toContainText(/debugging/i);
    await page.getByText("Does SOWLedger connect to GitHub?", { exact: true }).click();
    await expect(page.getByText(/There is no native GitHub integration/)).toBeVisible();

    await gotoApp(page, "/for/web-design-studios");
    await page.getByText("Does SOWLedger support milestone billing?", { exact: true }).click();
    await expect(page.getByText(/Not currently.*approved billable time/)).toBeVisible();
  });

  test("keeps support routes useful and API instructions within implemented capabilities", async ({ page }) => {
    for (const route of ["/support", "/contact", "/security", "/support/api"]) {
      const response = await gotoApp(page, route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    const apiContent = page.getByRole("main");
    await expect(apiContent).toContainText("Authorization: Bearer");
    await expect(apiContent).toContainText("impersonate:user");
    await expect(apiContent).toContainText("x-sowledger-export-sha256");
    await expect(apiContent).toContainText("does not start or stop a live timer");
    await expect(apiContent).not.toContainText(/@sowledger\/mcp|MCP Server/);
    await expect(apiContent.getByRole("link", { name: "Support home", exact: true })).toHaveAttribute("href", "/support");

    await gotoApp(page, "/support");
    await expect(page.getByRole("main")).toContainText("does not send an email");
    await expect(page.getByRole("main").getByRole("link", { name: "Contact support", exact: true })).toHaveAttribute("href", "/contact");

    await gotoApp(page, "/contact");
    await expect(page.getByRole("link", { name: "support@sowledger.com", exact: true })).toHaveAttribute("href", "mailto:support@sowledger.com");
  });

  test("keeps public content within the viewport", async ({ page }) => {
    for (const route of ["/", "/for/freelance-developers", "/support/api"]) {
      await gotoApp(page, route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${route} should not overflow horizontally`).toBeLessThanOrEqual(1);
    }
  });
});

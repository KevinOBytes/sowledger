import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers/navigation";
import { STRIPE_PLANS } from "../lib/billing-plans";
import { industries } from "../lib/content/industries";

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
    test.setTimeout(120_000);
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
      await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link")).toHaveCount(4);
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
    for (const route of ["/", "/for/freelance-developers", "/for/seo-consultants", "/support/api"]) {
      await gotoApp(page, route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${route} should not overflow horizontally`).toBeLessThanOrEqual(1);
    }
  });

  test("publishes exact public metadata, a real robots file, and a branded social image", async ({ page }) => {
    test.setTimeout(120_000);
    const routes = ["/", "/for", ...industryRoutes.map(({ slug }) => `/for/${slug}`), "/support", "/support/api", "/security", "/privacy", "/terms", "/billing-policy", "/contact"];
    for (const route of routes) {
      await gotoApp(page, route);
      // Next normalizes the root URL without a trailing slash.
      const canonical = route === "/" ? "https://www.sowledger.com" : new URL(route, "https://www.sowledger.com").href;
      const title = await page.title();
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", description!);
      await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", title);
      await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute("content", description!);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
      await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /^https:\/\/www\.sowledger\.com\/opengraph-image(?:\?|$)/);
      await expect(page.locator('meta[name="twitter:image"]').first()).toHaveAttribute("content", /^https:\/\/www\.sowledger\.com\/opengraph-image(?:\?|$)/);
    }

    const robots = await page.request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toContain("text/plain");
    expect(await robots.text()).toContain("Sitemap: https://www.sowledger.com/sitemap.xml");
    expect(await robots.text()).toContain("Disallow: /api/");
    expect(await robots.text()).not.toContain("Disallow: /login");
    const socialImage = await page.request.get("/opengraph-image");
    expect(socialImage.status()).toBe(200);
    expect(socialImage.headers()["content-type"]).toContain("image/png");

    await gotoApp(page, "/login");
    await expect(page).toHaveTitle("Sign in | SOWLedger");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.sowledger.com/login");
    expect((await page.request.get("/for/not-a-real-audience")).status()).toBe(404);
  });

  test("keeps essential hero content visible without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      for (const route of ["/", "/for/seo-consultants"]) {
        await gotoApp(page, route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("h1").locator("..")).toHaveCSS("opacity", "1");
        await expect(page.locator("main figure")).toHaveCSS("opacity", "1");
        await expect(page.getByRole("main").getByRole("link", { name: "Start free", exact: true }).first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test("keeps every audience hero word intact and content within responsive bounds", async ({ page }) => {
    test.setTimeout(120_000);
    for (const width of [320, 390, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ["/", ...industryRoutes.map(({ slug }) => `/for/${slug}`)]) {
        await gotoApp(page, route);
        await page.evaluate(() => document.fonts.ready);
        const wordLayout = await page.getByRole("heading", { level: 1 }).evaluate((heading) => {
          const bounds = heading.getBoundingClientRect();
          const splitWords: string[] = [];
          const overflowingWords: string[] = [];
          const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
          let wordsMeasured = 0;
          let node: Node | null;
          while ((node = walker.nextNode())) {
            for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(node, match.index!);
              range.setEnd(node, match.index! + match[0].length);
              const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
              wordsMeasured += 1;
              // A heading can fit the viewport while overflow-wrap splits a word.
              if (rects.some((rect) => Math.abs(rect.top - rects[0].top) > 1)) splitWords.push(match[0]);
              // Normal word wrapping must not let a word spill into the adjacent invoice.
              if (rects.some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) overflowingWords.push(match[0]);
            }
          }
          return { splitWords, overflowingWords, wordsMeasured };
        });
        expect(wordLayout.wordsMeasured, `${route} headline should contain measurable words`).toBeGreaterThan(0);
        expect(wordLayout.splitWords, `${route} should keep whole words at ${width}px`).toEqual([]);
        expect(wordLayout.overflowingWords, `${route} headline should fit its own column at ${width}px`).toEqual([]);
        const clipped = await page.locator("main section").first().evaluate((section) => {
          // overflow-hidden can mask clipping from document.scrollWidth checks.
          return [...section.querySelectorAll("h1, p, a, figure")].flatMap((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [element.getBoundingClientRect(), ...range.getClientRects()];
            return rects.some((rect) => rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1))
              ? [element.textContent?.slice(0, 100)] : [];
          });
        });
        expect(clipped, `${route} should not clip at ${width}px`).toEqual([]);
        const header = await page.locator("header").evaluate((element) => {
          const brand = element.querySelector("a")!.getBoundingClientRect();
          const actions = [...element.querySelectorAll("a, button")].slice(1)
            .map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0);
          return { brandRight: brand.right, firstActionLeft: Math.min(...actions.map((rect) => rect.left)), right: Math.max(...actions.map((rect) => rect.right)) };
        });
        expect(header.brandRight).toBeLessThanOrEqual(header.firstActionLeft);
        expect(header.right).toBeLessThanOrEqual(width);
      }
      if (width < 768) {
        await gotoApp(page, "/");
        const navigation = await page.getByRole("navigation", { name: "SOWLedger capability navigation" }).boundingBox();
        expect(navigation!.height).toBeLessThan(220);
      }
    }
  });

  test("supports skip navigation, Escape, and keyboard-accessible API examples", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/");
    await expect(page.getByRole("region", { name: "Cookie preferences", exact: true })).toBeVisible();
    // Safari uses Option-Tab to include links in keyboard navigation.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();

    const menu = page.getByRole("button", { name: "Open marketing menu" });
    await menu.click();
    const navigation = page.getByRole("navigation", { name: "Mobile marketing navigation" });
    await expect(navigation.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Built for", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(navigation).toHaveCount(0);
    await expect(menu).toBeFocused();

    await gotoApp(page, "/support/api");
    for (const region of await page.locator("main pre, main div[aria-label='API version 1 endpoints']").all()) {
      await expect(region).toHaveAttribute("tabindex", "0");
      await expect(region).toHaveAttribute("aria-label", /.+/);
      await region.focus();
      await expect(region).toBeFocused();
    }
    await expect(page.getByRole("region", { name: "Cookie preferences", exact: true })).toBeVisible();
  });

  test("uses audience-relevant illustrations and related links without customer claims", async ({ page }) => {
    for (const industry of industries) {
      expect(industry.relatedSlugs.length).toBeGreaterThan(0);
      expect(new Set(industry.relatedSlugs).size).toBe(industry.relatedSlugs.length);
      for (const slug of industry.relatedSlugs) {
        expect(slug).not.toBe(industry.slug);
        expect(industries.some((item) => item.slug === slug)).toBe(true);
      }
    }
    await gotoApp(page, "/for/legal-consultants");
    await expect(page.getByRole("heading", { name: "Advisory engagement", exact: true })).toBeVisible();
    await expect(page.locator("main figure")).toContainText("Research and drafting");
    await expect(page.locator("main figure")).toContainText("Illustrative example, not customer data or an app screenshot.");
    const related = page.locator("section[aria-labelledby='next-audience-heading']");
    await expect(related.locator("a")).toHaveCount(2);
    await expect(related.locator('a[href="/for/accounting-firms"]')).toBeVisible();
    await expect(related.locator('a[href="/for/management-consultants"]')).toBeVisible();

    await gotoApp(page, "/");
    const pricing = page.locator("#pricing");
    await expect(pricing).toContainText("Every plan includes planning, timers, manual entries, analytics, exports, API keys, and time review.");
    const free = pricing.getByTestId("pricing-plan").filter({ has: page.getByRole("heading", { name: "Free", exact: true }) });
    await expect(free).toContainText("API keys");
    await expect(free).not.toContainText(/invoices|webhooks/i);
    const starter = pricing.getByTestId("pricing-plan").filter({ has: page.getByRole("heading", { name: "Starter", exact: true }) });
    await expect(starter).toContainText("Invoices");
    await expect(starter).not.toContainText(/webhooks/i);
    await expect(pricing).not.toContainText(/SAML|advanced reports/i);
  });
});

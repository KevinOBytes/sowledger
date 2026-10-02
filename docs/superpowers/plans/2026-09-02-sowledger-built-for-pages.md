# SOWLedger Built for Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SOWLedger’s 12 audience pages public, discoverable under a “Built for” navigation path, and substantively tailored to each audience.

**Architecture:** Keep audience content in the existing `lib/content/industries.ts` data module. Add a small shared marketing header and a reusable detail-page renderer so the 12 pages have consistent structure without repeating markup. Add a server-rendered `/for` hub and a metadata sitemap, while preserving existing homepage sections and product claims.

**Tech Stack:** Next.js 16.2.6 App Router, TypeScript, Tailwind CSS v4, Lucide React, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-sowledger-built-for-design.md`

## Global Constraints

- Confirm and preserve the repo root `/Users/kevo/Projects/sowledger` (the case-insensitive checkout is `/Users/kevo/Projects/SOWLedger`).
- Treat workspace isolation as mandatory; do not alter unrelated user changes in the main checkout.
- Use Next.js 16.2.6 conventions and read relevant local docs before changing proxy, metadata, or sitemap behavior.
- Keep the warm light operational design system: `#f6f3ee`, white rounded panels, slate hierarchy, cyan as the functional accent, and restrained shadows.
- Every main page needs a clear header, one obvious job, and a primary action.
- Public marketing copy must describe only implemented product capabilities: planning/calendar blocks, live timers, manual logging, analytics, approvals/client sign-off, invoice proof packs, CSV/JSON exports with digest headers, scoped API keys, and webhooks.
- Preserve the connected workflow: plan work, track live timers, log manual or calendar time, review analytics, approve/invoice/export, then integrate by API.
- Use `git diff --check` and the narrowest meaningful Playwright test plus `npm run build` before reporting completion; report unrelated baseline lint failures honestly.

### Task 1: Public route foundation and discovery navigation

**Files:**
- Modify: `proxy.ts`
- Modify: `app/(marketing)/layout.tsx`
- Create: `components/marketing/marketing-header.tsx`
- Create: `app/sitemap.ts`
- Modify: `package.json` only if the baseline build requires it

**Interfaces:**
- Consumes: `industries` from `lib/content/industries.ts`.
- Produces: a public `/for` prefix, a `MarketingHeader` component used by the marketing layout, and a `MetadataRoute.Sitemap` default export containing the canonical public URLs.

- [ ] **Step 1: Verify the current route gate and type baseline**

Run `rg -n 'PUBLIC_PREFIXES|pathname ===|MarketingLayout|industries' proxy.ts 'app/(marketing)/layout.tsx' lib/content/industries.ts` and `npm run build`. Confirm the audience prefix is not public and capture any type error that blocks the build.

- [ ] **Step 2: Make the audience prefix public**

Add `"/for"` to `PUBLIC_PREFIXES` in `proxy.ts` so both `/for` and `/for/<slug>` bypass the session redirect. Keep all authenticated and API routes unchanged.

- [ ] **Step 3: Add the shared header and visible Built for discovery**

Create `components/marketing/marketing-header.tsx` as a client component with the existing logo/auth actions, desktop links for Proof, Recovery, Sign-off, API, Pricing, and a visible `Built for` link to `/for`. On screens below `lg`, expose a button named `Open marketing menu`, render the same links plus the `/for` link inside a labeled mobile navigation region, and close the menu after a link click. Keep the menu keyboard accessible with `aria-expanded`, `aria-controls`, and a stable panel id.

Replace the inline `<header>` in `app/(marketing)/layout.tsx` with `<MarketingHeader />`; keep the existing footer audience links and the `pt-16` main offset.

- [ ] **Step 4: Add the canonical sitemap**

Create `app/sitemap.ts` with:

```ts
import type { MetadataRoute } from "next";
import { industries } from "@/lib/content/industries";

const SITE_URL = "https://www.sowledger.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const fixedRoutes = ["/", "/for", "/support", "/support/api", "/security", "/privacy", "/terms", "/billing-policy", "/contact"];
  return [
    ...fixedRoutes.map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "monthly" as const, priority: path === "/" ? 1 : 0.6 })),
    ...industries.map((industry) => ({ url: `${SITE_URL}/for/${industry.slug}`, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
```

- [ ] **Step 5: Restore the build type prerequisite if needed**

If `npm run build` reports that `pg` has no declarations, add `"@types/pg": "^8.15.5"` under `devDependencies` in `package.json`, run `npm install --no-package-lock`, and do not add `package-lock.json`.

- [ ] **Step 6: Verify and commit**

Run `npm run build` and `git diff --check`. Commit with `feat(marketing): expose built-for discovery`.

### Task 2: Audience hub and substantive audience landing pages

**Files:**
- Modify: `lib/content/industries.ts`
- Modify: `app/(marketing)/for/[industry]/page.tsx`
- Create: `app/(marketing)/for/page.tsx`
- Create: `components/marketing/industry-landing-content.tsx`

**Interfaces:**
- Consumes: `IndustryContent` records from `lib/content/industries.ts`; `MarketingHeader` and the existing marketing layout.
- Produces: `/for` hub cards and the detail-page renderer. Each record must expose `slug`, `name`, `category`, `heroLabel`, `heroHeadline`, `heroSubhead`, `workflowHeadline`, `workflowSubhead`, `challenges`, `workflow`, `proofOutputs`, and `faqs`.

- [ ] **Step 1: Expand the content model with audience-specific proof**

Extend `IndustryContent` with:

```ts
category: string;
challenges: string[];
workflow: { stage: string; detail: string }[];
proofOutputs: string[];
faqs: { question: string; answer: string }[];
```

Populate all 12 existing records with three concrete challenges, six workflow mappings covering Plan/Track/Log/Review/Approve or Export/Integrate, four proof outputs, and three FAQs. Keep the copy specific to the audience and within the product-truth rules; do not use automatic commit/PR synchronization claims.

- [ ] **Step 2: Build the `/for` hub**

Create a server page with metadata title `Built for service teams | SOWLedger`, an H1 `Proof-backed billing built for the way you work.`, an explanatory paragraph, a 12-card grid, and a CTA to `/login`. Every card must link to its exact `/for/<slug>` route and expose the audience name, category, and a concise audience-specific outcome.

- [ ] **Step 3: Build the reusable detail-page content**

Create `IndustryLandingContent` to render, in order: breadcrumb back to `/for`; the existing `HeroSection` with record-specific values; a “Common work to capture” three-item challenge panel; a six-row “How the workflow fits” section using `workflow`; a “Proof you can hand off” four-item list using `proofOutputs`; three FAQ disclosures; neighboring audience links; and a final `/login` CTA. Use semantic headings, accessible links, and existing Tailwind tokens. Do not duplicate the full homepage pricing/screenshots sections.

- [ ] **Step 4: Wire the dynamic route and metadata**

Update `app/(marketing)/for/[industry]/page.tsx` to keep `generateStaticParams`, return a unique metadata title/description/canonical URL from the record, call `notFound()` for unknown slugs, and render `IndustryLandingContent` with the selected record. Add `revalidate = 3600` only if the implementation needs it; static content should otherwise remain static.

- [ ] **Step 5: Verify and commit**

Run `npm run build`, inspect representative routes with the dev server if needed, and run `git diff --check`. Commit with `feat(marketing): add substantive built-for pages`.

### Task 3: Browser regression coverage and final truth checks

**Files:**
- Create: `tests/marketing.spec.ts`
- Modify: `lib/content/industries.ts` only if a test exposes an incomplete record
- Modify: `app/(marketing)/for/page.tsx` or `components/marketing/industry-landing-content.tsx` only if a test exposes a missing accessible label or link

**Interfaces:**
- Consumes: public routes, navigation labels, and the `industries` data list.
- Produces: Playwright evidence for public reachability and audience discovery without requiring authentication.

- [ ] **Step 1: Add public route assertions**

Create a Playwright suite using `gotoApp` and `page.request`. Assert `/for` is not redirected and has the H1 `Proof-backed billing built for the way you work.`. Iterate through `industries` (or the exact route list) and assert each route response is `200`, the final URL is the route, and the page H1 contains the audience name.

- [ ] **Step 2: Add hub/navigation/sitemap assertions**

Assert the hub has exactly 12 audience links. At desktop, assert `Built for` links to `/for`. At the iPhone viewport, open `Open marketing menu`, assert the mobile panel contains `Built for`, click it, and assert `/for` loads. Request `/sitemap.xml`, assert `200`, and assert the XML contains `/for`, all 12 audience paths, and `/support/api`.

- [ ] **Step 3: Add representative uniqueness and truth checks**

Visit `/for/freelance-developers` and `/for/marketing-agencies`; assert each contains its unique H1, a “Common work to capture” heading, “Proof you can hand off”, and three FAQ questions. Assert the developer page does not contain `Prove every commit` or `connects your PRs`, preventing unsupported integration claims from returning.

- [ ] **Step 4: Run focused and full validation**

Run `npx playwright test tests/marketing.spec.ts --project=chromium`, `npx playwright test tests/marketing.spec.ts --project=mobile-safari`, `npm run build`, `npm run agentic:check`, and `git diff --check`. Run `npm run lint` and report the pre-existing unrelated failures if they remain.

- [ ] **Step 5: Commit**

Commit with `test(marketing): cover built-for routes and discovery`.

# SOWLedger Built for Audience Pages

## Problem

SOWLedger currently links 12 audience pages from the footer, but unauthenticated visitors are redirected to `/login` before the pages render. When rendered locally, the pages customize only a hero and workflow sentence before repeating the generic homepage. The audience routes need to be public, discoverable, and useful enough to explain how the existing SOWLedger workflow applies to each audience.

## Audience routes

These exact routes remain canonical:

- `/for/freelance-developers`
- `/for/marketing-agencies`
- `/for/seo-consultants`
- `/for/graphic-designers`
- `/for/legal-consultants`
- `/for/accounting-firms`
- `/for/video-editors`
- `/for/copywriters`
- `/for/pr-agencies`
- `/for/it-consultants`
- `/for/management-consultants`
- `/for/web-design-studios`

Add `/for` as the public hub. Use “Built for” as the navigation label because the set includes people, agencies, firms, and studios.

## Acceptance criteria

1. An unauthenticated `GET /for` and unauthenticated `GET` for every audience route return HTTP 200 and do not redirect to `/login`.
2. The marketing header exposes a visible “Built for” link to `/for` on desktop and in the mobile menu. The hub links to all 12 audience routes, and every detail page links back to the hub and at least two neighboring audiences.
3. Every detail page has a unique title, hero headline, hero subhead, three audience-specific work challenges, a role-specific mapping to the connected workflow, four proof outputs, and three FAQ entries. The page must name the audience in its H1 and include a primary “Start free” action.
4. Audience copy may claim only product capabilities present in the repository: planning/calendar blocks, live timers, manual logging, analytics, approvals/client sign-off, invoice proof packs, CSV/JSON exports with digest headers, scoped API keys, and webhooks. Do not claim automatic GitHub/PR/commit synchronization or other unimplemented integrations.
5. Use the existing warm light marketing system (`#f6f3ee` background, white panels, slate copy, cyan accents, restrained shadows) and preserve mobile access to the header, audience navigation, and primary CTA.
6. Add `app/sitemap.ts` using Next.js 16 metadata route conventions. It must include `/`, `/for`, every audience route, `/support`, `/support/api`, `/security`, `/privacy`, `/terms`, `/billing-policy`, and `/contact` with the canonical `https://www.sowledger.com` origin.
7. Add Playwright coverage that verifies public reachability, the hub’s 12 links, desktop/mobile discovery, unique page content for representative audiences, and sitemap inclusion.
8. The production build must type-check. If the baseline still lacks PostgreSQL declarations, add `@types/pg` as a dev dependency without introducing a package lock file because this repository does not track one.

## Product truth

The pages should tell one connected story: plan work, track live timers, log manual or calendar time, review analytics, approve/invoice/export, then integrate by API. Audience-specific language describes the work being captured; it must not imply that a provider sync exists unless the current product exposes it.

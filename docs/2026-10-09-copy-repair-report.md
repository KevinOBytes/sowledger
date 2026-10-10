# Copy repair report — October 9, 2026

## Scope and approach

Rewrote the public site and the assigned settings, client, people, project, planner, notification, export, integration, and analytics surfaces. The local product-UX and development skills guided the pass: keep the warm light/cyan design, explain the next customer action, preserve the connected workflow, and avoid unsupported capability claims. Internal plan IDs, API permissions, response keys, and pricing logic are unchanged.

## Public site

- Replaced the repetitive proof/recovery pitch with concrete time tracking, planning, review, invoicing, and client-review language. Kept all 12 audience routes, distinct role-specific detail, the Built for navigation, and existing section anchors.
- Documented the actual invoice sequence: approve billable time, create a draft invoice, mark it sent, share the portal link separately, then client review. Marking an invoice sent does not email the client.
- Removed claims of automated recurring retainers, milestone billing, native GitHub integration, and unsupported MCP setup. API documentation retains real scope names and endpoint details where technically useful.
- Replaced the stale screenshot placements with an explicitly labeled invoice illustration. Source images and the sample PDF are preserved, but outdated placements are no longer presented as current product evidence. Fresh authenticated screenshots remain a separate verification task.
- Replaced the synthetic dispute-risk calculator with a transparent estimate of unlogged time. Zero unlogged hours now produces zero estimated value; the result is not a revenue forecast.
- Added `lib/content/marketing-plans.ts` to derive plan names, prices, member limits, and project limits from `STRIPE_PLANS`, with curated supported feature labels. Business now reflects the shared 200-project limit rather than the previous hardcoded 500. Stripe price IDs stay server-side.
- Updated metadata and used the shared `getAppOrigin()` helper supplied by the main agent.

## Application surfaces

- Simplified settings, billing, developer, integration, people, client, project, planner, notification, and export copy. Kept technical identifiers only where users need them to configure an integration or API key.
- Removed the nonworking MCP setup panel from Developers. Provider setup is described as conditional on the deployment; test/sandbox configuration is not advertised as a verified live connection.
- Renamed the analytics panels to **Budget review** and **Time awaiting review**. The value card is **Logged time value**; it explicitly includes all logged entries, including drafts, rejected entries, and non-billable work, and is not an invoice or payment total. Revenue-review titles, reasons, and notes are plain-language checks; their API keys and calculations are unchanged.
- Replaced misleading Retainer/Milestone/NTE project presets with example tracking setups. Explained that budgets do not cap timers or invoices and that recurring/milestone billing is not automated.
- Added `workspaceId` to the existing project and time-entry predicates in `ProjectFinancials`, passing it from the validated project page session. Its calculations remain unchanged, with accurate labels and an explanation of included records.
- Explained planner hours as task estimates plus assigned hourly goals, not weekly availability. Explained its fixed 40-hour warning threshold.
- Added shared `DataLoadNotice` retry UI and visible failed-load handling to Settings, Billing, Developers, Integrations, Webhooks, Work types, Clients, Projects, Tags, Planner, Notifications, and Exports. Export downloads are paused if their people/project filters cannot load. Added explicit request-failure messages for settings saves, notification updates, webhook changes, and work-type changes.
- Changed People’s “Resend invite” to **Renew invitation**, and “Send an invite…” to **Create an invitation…**: `inviteUser` currently creates the invitation record but does not send an email.
- Clarified that CSV contains time-entry rows and JSON may contain workspace-wide data despite a project/person/date filter. No export integrity headers were changed.

## Final review follow-up

- Work types now model `hourlyRate` as nullable and guard both formatting and editing. Missing rates render **No rate**, zero remains `$0.00/hr`, and clearing an existing rate explicitly sends `null` through the API's existing PATCH contract.
- The **Check planned work** suggestion now links to `/calendar`, not the marketing homepage.
- Preferred-tags help now states that tags are saved to the profile, without implying that timers automatically consume them.
- CSV downloads no longer send JSON dataset selections in the `include` query parameter. Both CSV buttons remain available when all JSON datasets are unchecked; JSON still requires at least one selected dataset.

## Final headings

| Surface | Heading |
| --- | --- |
| Home | Your work, your time, your invoices. Together. |
| Built for | For people who do client work. |
| Support | How can we help? |
| API docs | Connect your work records. |
| Contact | Get in touch. |
| Security | How access and data are handled. |
| Analytics | Analytics |
| Exports | Exports |
| Integrations | Integrations |
| Developers | Developers |
| Billing / Settings / Webhooks / Tags | Same as the route label |
| Work types | Work types and rates |
| People / Planner | People & organizations / Resource Planner |
| Clients / Projects | Clients / Projects |

## Validation

- Scoped ESLint across the owned public/app files and `git diff --check`: passed after correcting one JSX apostrophe.
- `tests/marketing.spec.ts`, Chromium: 7 passed.
- `tests/marketing.spec.ts`, mobile Safari: 7 passed after installing the missing Playwright WebKit runtime. The first mobile attempt failed only because that local browser runtime was absent.
- Public tests cover routes, CTA destinations, plan limits, role-specific audience detail, truthful capability boundaries, calculator behavior, sitemap/navigation discoverability, and narrow-screen overflow.
- `npx playwright test --config=tests/copy-regressions.config.ts`: **5 passed**. These isolated tests mount the real Work types/Exports components with mocked browser requests and exercise the revenue-review generator with mocked reads. They cover null-rate loading/editing, rate-free creation, explicit rate clearing, CSV after clearing all JSON datasets (including absence of the `include` parameter), and the generated `/calendar` destination. No Next server or database fixtures are used. The browser run required the normal local-browser sandbox exception; an initial exact-label selector in the export test was corrected before the passing run.
- Focused ESLint for the follow-up files and `git diff --check`: passed.
- No production build, authenticated database fixtures, commit, deployment, or provider operation was run by this agent. The main agent owns the consolidated build/authenticated test gate; app error-state changes need that gate before a release claim.

## Remaining boundaries

- Legal terms/policies were not rewritten by this agent. The main agent corrected the technical instructions for deletion requests and provider revocation, and clarified which QuickBooks invoices are exported. Liability, deletion timing, and rights policies were preserved. Operational fulfillment of deletion deadlines, policy-change email notices, provider data-use assurances, and mailbox delivery cannot be verified from this copy pass.
- Native provider delivery/sync, production authentication, and real customer workflows were not verified by these public-page tests. Removing an unsupported marketing claim does not repair the underlying MCP package or establish production integration readiness.
- Error handling added here is bounded to the named surfaces; this is not a claim that every network-failure path in project task editing, tags, or client mutations was repaired.

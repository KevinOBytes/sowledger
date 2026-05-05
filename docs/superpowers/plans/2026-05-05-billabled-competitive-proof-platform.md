# Billabled Competitive Proof Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Billabled's competitive proof-backed billing platform: invoice proof packs, retainer leak radar, client sign-off, missing billable recovery, agency integrations, and a rebuilt marketing homepage.

**Architecture:** Add focused server modules for proof-pack and revenue-intelligence derivation, expose them through authenticated app routes and scoped API-key routes, then wire the internal app, client portal, developer docs, and homepage to the new product story. Use existing audit logs for sign-off records to avoid an unnecessary schema expansion.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM, PostgreSQL/Neon, existing API-key auth, existing audit/export helpers, Playwright, ESLint.

---

### Task 1: Backend Evidence And Revenue APIs

**Files:**
- Create: `lib/invoice-proof-pack.ts`
- Create: `lib/revenue-intelligence.ts`
- Create: `app/api/invoices/[invoiceId]/proof-pack/route.ts`
- Create: `app/api/revenue-intelligence/route.ts`
- Create: `app/api/client/signoff/route.ts`
- Modify: `app/api/v1/[resource]/route.ts`
- Modify: `lib/api-keys.ts`

- [ ] **Step 1: Add proof-pack builder**

Create `lib/invoice-proof-pack.ts` with exported types and `buildInvoiceProofPack(workspaceId, invoiceId)`. It must load the invoice scoped by workspace, linked time entries, projects, users, schedule blocks, and audit logs. Return `null` when the invoice is not in the workspace. Include totals, source mix, linked entries, planned seconds for linked schedule blocks, audit events, and a deterministic SHA-256 digest over the proof payload.

- [ ] **Step 2: Add revenue intelligence builder**

Create `lib/revenue-intelligence.ts` with `buildRevenueIntelligence(workspaceId, options)`. It must return `retainerRisks`, `recoveryOpportunities`, and `summary`. Risks come from project budget usage, unbilled approved value, invoiced value, missing rates, and missed planned work. Recovery opportunities include missed scheduled blocks, approved but uninvoiced entries, missing-rate entries, and stale draft entries.

- [ ] **Step 3: Add authenticated app routes**

Create app routes for invoice proof packs, revenue intelligence, and client sign-off. App proof packs require `member`. Revenue intelligence requires `member` for personal scope and `manager` for team scope. Client sign-off requires `client`, validates invoice workspace scope, writes an audit log event, and returns `{ ok: true, signoff }`.

- [ ] **Step 4: Extend API-key resources**

Add API scopes `read:proof-packs` and `read:revenue-intelligence` to `lib/api-keys.ts` and the developer UI scope lists. Add `/api/v1/proof-packs` and `/api/v1/revenue-intelligence` to `app/api/v1/[resource]/route.ts`. Proof packs require `read:proof-packs`; revenue intelligence requires `read:revenue-intelligence`.

- [ ] **Step 5: Verify backend locally**

Run `npm run lint` and `npm run build` after backend work is integrated with UI tasks. If failures are unrelated pre-existing issues, capture exact messages and keep changes narrow.

### Task 2: Internal App And Client Portal UI

**Files:**
- Modify: `app/(app)/invoices/page.tsx`
- Modify: `components/reports-page-client.tsx`
- Modify: `app/client/page.tsx`

- [ ] **Step 1: Upgrade Invoices page to proof workflow**

Add client state for selected proof packs, fetch `/api/invoices/{invoiceId}/proof-pack`, display digest, linked entries count, source mix, planned vs actual, audit event count, and recovery hints. Replace generic "Print PDF" as the primary invoice action with "Open proof pack" while keeping print as a secondary action.

- [ ] **Step 2: Add Retainer Leak Radar and Missing Billable Recovery to Analytics**

Fetch `/api/revenue-intelligence` alongside existing reports. Render a top section with Retainer Leak Radar cards and Missing Billable Recovery cards. Include clear empty states when no risks or opportunities exist.

- [ ] **Step 3: Add client sign-off workflow**

Update `app/client/page.tsx` so invoices show proof language and an "Approve proof" button. POST to `/api/client/signoff` with `invoiceId` and show the approved state locally.

- [ ] **Step 4: Preserve mobile and empty-state behavior**

Keep existing warm SaaS styling, rounded cards, slate text, cyan accents, and scan-friendly mobile stacks. Every new section must have a useful empty state.

### Task 3: Marketing And Developer Positioning

**Files:**
- Modify: `app/(marketing)/page.tsx`
- Modify: `app/(marketing)/support/api/page.tsx`
- Modify: `app/(app)/settings/developers/page.tsx`
- Modify: `tests/e2e.spec.ts`
- Modify: `tests/e2e-advanced.spec.ts`

- [ ] **Step 1: Rebuild homepage around the competitive story**

Rewrite homepage hero and feature sections around "Recover revenue. Prove every invoice." Include the five capabilities: Invoice Proof Packs, Retainer Leak Radar, Client Sign-Off Portal, Missing Billable Recovery, and Developer/Agency Integration Layer. Preserve flat pricing plan IDs and existing design language.

- [ ] **Step 2: Update developer settings and API docs**

Add new scopes to developer settings. Add proof-pack and revenue-intelligence endpoints to public API docs, including example requests and the digest-backed proof/export story.

- [ ] **Step 3: Update browser tests**

Update existing Playwright expectations so marketing and app tests look for the new headings/actions while preserving coverage for export digest headers, API keys, invoices, and calendar.

### Task 4: Integration Review And Validation

**Files:**
- Review all files changed in Tasks 1-3.

- [ ] **Step 1: Review git diff for unrelated edits**

Run `git status --short` and `git diff --stat`. Confirm existing unrelated calendar/DB edits remain untouched except where explicitly required.

- [ ] **Step 2: Run validation gate**

Run:

```bash
npm run lint
npm run build
npx playwright test --project=chromium
npm run agentic:check
```

- [ ] **Step 3: Fix integration issues**

Fix only issues caused by this implementation. Do not revert unrelated user changes.

- [ ] **Step 4: Final product smoke**

If a dev server is needed, start it and provide the URL. Check homepage, invoices, analytics, client portal, and developer docs in-browser when practical.

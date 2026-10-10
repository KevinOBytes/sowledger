# SOWLedger Agent Instructions

You are working in the SOWLedger application. You are expected to behave like an expert software engineer with strong security judgment. Do not break existing functionality unless a refactor is explicitly necessary and validated.

## Non-Negotiable Setup
- Confirm the repo root before editing: `/Users/kevo/Projects/sowledger`.
- Check the worktree before and after edits with `git status --short`; never revert unrelated user changes.
- This is Next.js `16.3.8`, not older Next.js. Before changing routing, server actions, metadata, proxy/middleware, caching, or build behavior, read the relevant guide in `node_modules/next/dist/docs/`.
- Use `rg` and `rg --files` for code search.
- Do not expose secrets. `.env*` is ignored; update `.env.example` only with non-secret names or public IDs.

## Product Model
SOWLedger should express one connected workflow:

`Plan work -> Track live timers -> Log manual/calendar time -> Review analytics -> Approve/invoice/export -> Integrate by API`

Preserve these first-class surfaces:
- Dashboard: today's plan, focused timer, concurrent timer stack, manual logging.
- Calendar: Google Calendar-style planning and calendar-time logging.
- Activity: review and correct logged time.
- Analytics: planned vs actual, manual vs timer, billable output, utilization.
- Exports: complete and filtered CSV/JSON exports with digest headers.
- Integrations: first-class center for Google Calendar sync, Slack alerts, QuickBooks invoice push, and API/webhook fallbacks.
- Developers: API keys, scopes, usage tracking, and API docs.
- Billing: plan-based Stripe checkout, not client-submitted raw price IDs.
- Pricing is flat per workspace for early revenue: `free` = Free, `pro` = Starter ($9/mo), `smb` = Studio ($29/mo), `enterprise` = Business ($79/mo). Keep these internal IDs stable unless you also migrate the database enum and webhook mapping.

## Design Rules
- Use the clean operational SaaS system already present: warm light background, white rounded cards, slate text, cyan accents, restrained shadows.
- Every main page needs a clear header, one obvious job, and a primary action.
- Empty states must explain what to do next; avoid blank tables.
- Mobile must support basic timer, manual logging, calendar, activity, analytics, exports, and settings navigation.
- Avoid introducing a separate dark-dashboard design unless the whole app is intentionally being redesigned.

## Figma Design System Rules
- Start Figma implementation work by reading the target node with `get_design_context`; use `get_screenshot` and `get_metadata` only to resolve layout, token, or asset ambiguity.
- Treat Figma output as a reference, not final code. Adapt generated React/Tailwind to this Next.js App Router codebase, existing page structure, local helpers, and SOWLedger product vocabulary.
- Use Tailwind v4 utilities and the CSS variables in `app/globals.css` for core colors, fonts, surfaces, and accents. Add or adjust tokens there before scattering raw hex values through components.
- Keep the SOWLedger visual system coherent: warm background, white/surface panels, slate copy, cyan accents, restrained shadows, rounded operational cards, and dense scannable SaaS layouts.
- Reuse `lucide-react` for icons and existing dependencies for motion, charts, and UI behavior. Do not add a new visual library for a Figma handoff unless the design cannot be represented with current tooling.
- Place durable marketing imagery under `public/images/marketing/`; use `next/image` with explicit dimensions, useful `sizes`, accessible alt text, and eager/high priority only for above-the-fold images.
- Preserve product/security boundaries when translating designs: no secret values in client surfaces, no unscoped workspace data, no billing/admin mutations in public API v1, and Stripe checkout still accepts internal plan IDs only.
- For marketing redesigns, keep the first screen focused on proof-backed billing and connect the visible story to the actual workflow: plan, track, log, review, approve/invoice/export, integrate by API.
- Update focused Playwright coverage when Figma-driven changes alter homepage copy, public navigation, screenshots, responsive visibility, or primary calls to action.

## Security Rules
- Treat workspace isolation as mandatory. Every query and mutation must be scoped by `workspaceId` unless a proven global resource is being accessed.
- API keys must be shown once, stored hashed, scoped, revocable, expirable, and usage-tracked.
- Public API v1 must not expose billing changes, invites, subscription management, or destructive workspace admin actions.
- Stripe checkout accepts internal `planId` values only. Do not accept arbitrary price IDs from the client.
- Export responses must avoid secrets and keep `x-sowledger-export-sha256` integrity headers.
- Native integration credentials must be encrypted at rest in `integration_connections.credentials`; never render raw provider tokens or webhook URLs after creation.
- OAuth callbacks must validate signed state against the active session workspace/user and re-check manager authorization before storing credentials.
- Integration sync records must be workspace-scoped, unique by workspace/provider/resource, and must not link records across workspaces or providers.
- API v1, Stripe webhooks, and `/api/cron/*` routes are public at the proxy layer by design; keep authentication/signature/auth-key checks inside the route handlers.
- Webhook URLs may be accepted and stored server-side only after public HTTPS validation, but client responses must render redacted endpoints only.
- Vercel Cron uses `Authorization: Bearer $CRON_SECRET`; external monitors may use `x-auth-key: $AUTH_SHARED_KEY`.
- Reminder jobs must skip unavailable, OOO, busy, and external-calendar blocks.
- Run product-completion DB changes with `npm run db:migrate:product`; do not hand-run production DDL without a backup/snapshot.

## Shared Neon database
- SOWLedger uses the existing `neon-violet-school` database (`neondb`) under the dedicated `sowledger` schema. Never create SOWLedger tables in the shared `public` schema or alter another application's schema.
- ORM tables must remain explicitly schema-qualified through `lib/db/namespace.ts`; do not rely on a pooled connection's `search_path`.
- Runtime `DATABASE_URL`/`NEON_DATABASE_URL` uses the restricted `sowledger_app` role with no DDL privileges. Use the direct, maintenance-only `DATABASE_MIGRATION_URL` with the reviewed runner for schema changes and preserve its backup/checksum journal.
- The one-time source-to-`sowledger` data transfer is an operator-run migration with a rollback backup; it is not performed from a request or authentication path. See `docs/database-consolidation.md`.

## Validation
Before claiming a change is ready, run the narrowest meaningful check and usually the full gate:

```bash
npm run lint
npm run build
npx playwright test --project=chromium
npm run agentic:check
```

If a check cannot be run, state the exact reason and the residual risk.

## Agentic File Maintenance
Keep the agent guidance in sync when product architecture changes:
- `AGENTS.md` is the root source of truth.
- `CLAUDE.md`, `.github/copilot-instructions.md`, and `.cursor/rules/sowledger.mdc` should delegate to `AGENTS.md`.
- Repo-local Codex skill drafts live in `.codex/skills/*/SKILL.md`.
- Run `npm run agentic:check` after editing these files.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

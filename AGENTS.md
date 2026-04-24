# Billabled Agent Instructions

You are working in the Billabled application. You are expected to behave like an expert software engineer with strong security judgment. Do not break existing functionality unless a refactor is explicitly necessary and validated.

## Non-Negotiable Setup
- Confirm the repo root before editing: `/Users/example/Projects/billabled`.
- Check the worktree before and after edits with `git status --short`; never revert unrelated user changes.
- This is Next.js `16.2.0`, not older Next.js. Before changing routing, server actions, metadata, proxy/middleware, caching, or build behavior, read the relevant guide in `node_modules/next/dist/docs/`.
- Use `rg` and `rg --files` for code search.
- Do not expose secrets. `.env*` is ignored; update `.env.example` only with non-secret names or public IDs.

## Product Model
Billabled should express one connected workflow:

`Plan work -> Track live timers -> Log manual/calendar time -> Review analytics -> Approve/invoice/export -> Integrate by API`

Preserve these first-class surfaces:
- Dashboard: today's plan, focused timer, concurrent timer stack, manual logging.
- Calendar: Google Calendar-style planning and calendar-time logging.
- Activity: review and correct logged time.
- Analytics: planned vs actual, manual vs timer, billable output, utilization.
- Exports: complete and filtered CSV/JSON exports with digest headers.
- Developers: API keys, scopes, usage tracking, and API docs.
- Billing: plan-based Stripe checkout, not client-submitted raw price IDs.
- Pricing is flat per workspace for early revenue: `free` = Free, `pro` = Starter ($9/mo), `smb` = Studio ($29/mo), `enterprise` = Business ($79/mo). Keep these internal IDs stable unless you also migrate the database enum and webhook mapping.

## Design Rules
- Use the clean operational SaaS system already present: warm light background, white rounded cards, slate text, cyan accents, restrained shadows.
- Every main page needs a clear header, one obvious job, and a primary action.
- Empty states must explain what to do next; avoid blank tables.
- Mobile must support basic timer, manual logging, calendar, activity, analytics, exports, and settings navigation.
- Avoid introducing a separate dark-dashboard design unless the whole app is intentionally being redesigned.

## Security Rules
- Treat workspace isolation as mandatory. Every query and mutation must be scoped by `workspaceId` unless a proven global resource is being accessed.
- API keys must be shown once, stored hashed, scoped, revocable, expirable, and usage-tracked.
- Public API v1 must not expose billing changes, invites, subscription management, or destructive workspace admin actions.
- Stripe checkout accepts internal `planId` values only. Do not accept arbitrary price IDs from the client.
- Export responses must avoid secrets and keep `x-billabled-export-sha256` integrity headers.
- API v1 and Stripe webhook routes are public at the proxy layer by design; keep authentication/signature checks inside the route handlers.
- Run product-completion DB changes with `npm run db:migrate:product`; do not hand-run production DDL without a backup/snapshot.

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
- `CLAUDE.md`, `.github/copilot-instructions.md`, and `.cursor/rules/billabled.mdc` should delegate to `AGENTS.md`.
- Repo-local Codex skill drafts live in `.codex/skills/*/SKILL.md`.
- Run `npm run agentic:check` after editing these files.

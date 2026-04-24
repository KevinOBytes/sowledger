# Billabled

Security-focused workforce intelligence starter on Next.js (App Router) with role-based auth, immutable audit logs, compliance controls, user settings, and local-first timer resilience.

## Registration safety
- `ALLOW_SELF_REGISTRATION=false` (default) = invite-only access.
- `ALLOW_BOOTSTRAP_OWNER=true` allows controlled first-owner bootstrap when workspace has zero users.
- Magic links are one-time, expiring, and replay-protected.
- Session cookies are signed + HTTP-only.

## Manageability of tags, projects, goals
Yes — you can now **create, update, and delete** all of them via API:
- Projects: `GET`, `POST`, `PATCH`, `DELETE /api/projects`
- Goals: `GET`, `POST`, `PATCH`, `DELETE /api/goals`
- Tags: `GET`, `PATCH` (rename), `DELETE /api/tags`

When a project/goal is deleted, linked time entries are cleaned by unsetting the corresponding foreign reference in the runtime model.

## Added in this update
- User settings API with timezone management and preferred tags.
- Project and Goal APIs for time allocation context.
- Optional `projectId`, `goalId`, and `tags` on time entries.
- Tags API for workspace-level tag discovery + rename/remove.
- CSV export includes project/goal/tag fields.

## Vercel + Neon + Upstash readiness
- `GET /api/deployment/readiness` checks env wiring for Vercel deployment with Neon + Upstash.
- SQL migration for Postgres remains included at `db/migrations/0001_init.sql`.
- Launch/deploy runbook lives at [`docs/launch-readiness.md`](docs/launch-readiness.md).
- Product-completion schema changes are applied with `npm run db:migrate:product`, which backs up schema metadata and records migration checksums.

## Current persistence note
This branch currently uses an in-memory runtime store for API state so it remains compile-safe in restricted CI environments. SQL-first schema is included and adapter wiring to Neon can be done behind current API contracts.

## Quick start
```bash
npm install
npm run dev
```

## Required environment variables
```bash
NEXT_PUBLIC_APP_URL=https://billabled.tkoresearch.com
AUTH_SHARED_KEY=replace_with_internal_service_key
AUTH_COOKIE_SECRET=replace_with_long_random_secret_min_24_chars
AUDIT_SIGNING_SECRET=replace_with_long_random_secret
RESEND_API_KEY=re_xxx
RESEND_LOGIN_FROM=logins@kevinbytes.com
DATABASE_URL=postgres://...
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
EXCHANGE_RATE_API_URL=https://api.exchangerate.host/latest
ALLOW_SELF_REGISTRATION=false
ALLOW_BOOTSTRAP_OWNER=true
```

## API surface
- Auth
  - `POST /api/auth/request-link`
  - `GET /api/auth/verify?token=...`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - `POST /api/auth/invite`
- User settings
  - `GET /api/user/settings`
  - `PATCH /api/user/settings`
- Projects / Goals / Tags
  - `GET /api/projects`
  - `POST /api/projects`
  - `PATCH /api/projects`
  - `DELETE /api/projects?projectId=...`
  - `GET /api/goals`
  - `POST /api/goals`
  - `PATCH /api/goals`
  - `DELETE /api/goals?goalId=...`
  - `GET /api/tags`
  - `PATCH /api/tags`
  - `DELETE /api/tags?tag=...`
- Timers
  - `POST /api/timer/start`
  - `POST /api/timer/stop`
  - `PATCH /api/timer/edit`
  - `POST /api/timer/approve`
  - `POST /api/timer/invoice`
- Compliance/Finance/Integrations
  - `POST /api/compliance/daily-check`
  - `GET /api/currency/rates`
  - `POST /api/expenses/attach`
  - `GET /api/export/csv`
  - `POST /api/integrations/calendar/import`
  - `GET /api/cron/unfinished-timers`
- Deployment
  - `GET /api/deployment/readiness`

## Docs
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Launch readiness: [`docs/launch-readiness.md`](docs/launch-readiness.md)

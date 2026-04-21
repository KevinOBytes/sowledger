# Timely

Timely is a production-oriented, Clockify-inspired (but unique) time tracking app with role-based auth, workspace metadata (projects/goals/tags), compliance controls, and an intuitive tracker UI.

## Production-ready UX update
- New split-layout tracker experience with:
  - left navigation rail,
  - top quick-entry row,
  - grouped daily time rows,
  - week/day totals,
  - one-click CRUD actions for projects/goals/tags.
- Added `GET /api/timer/list` for grouped time-entry retrieval used by the tracker UI.

## Manageability of tags, projects, goals
Yes — full management lifecycle is available:
- Projects: `GET`, `POST`, `PATCH`, `DELETE /api/projects`
- Goals: `GET`, `POST`, `PATCH`, `DELETE /api/goals`
- Tags: `GET`, `PATCH` (rename), `DELETE /api/tags`

Deleting project/goal detaches linked references from entries/goals in the runtime model.

## Security and auth
- Invite-first registration by default.
- One-time expiring magic links.
- Signed HTTP-only session cookies.
- Role checks across mutating endpoints.

## Deployment model
- Vercel + Neon + Upstash compatible env contract.
- Readiness probe: `GET /api/deployment/readiness`.
- SQL-first schema present in `db/migrations/0001_init.sql`.

## Current persistence note
Runtime state is in-memory for this environment. SQL schema/migration are included for Neon/Postgres adapter wiring without breaking current API contracts.

## Quick start
```bash
npm install
npm run dev
```

## Required environment variables
```bash
NEXT_PUBLIC_APP_URL=https://timely.tkoresearch.com
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

## Core API surface
- Auth: `/api/auth/*`
- User settings: `/api/user/settings`
- Projects / Goals / Tags: `/api/projects`, `/api/goals`, `/api/tags`
- Timers: `/api/timer/start`, `/api/timer/stop`, `/api/timer/edit`, `/api/timer/list`
- Compliance/Finance/Integrations: `/api/compliance/daily-check`, `/api/export/csv`, `/api/integrations/calendar/import`, etc.
- Deployment: `/api/deployment/readiness`

## Docs
- Architecture: [`docs/architecture.md`](docs/architecture.md)

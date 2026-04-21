# Timely Architecture (Production Tracker UX)

## BLUF
This iteration moves the app toward production-readiness with a Clockify-like (but unique) workflow:
- fast top-row timer start/stop,
- grouped daily logs,
- clear weekly total visibility,
- inline CRUD management for projects/goals/tags.

## UX architecture
- Primary screen is a tracker workspace with:
  - left rail navigation,
  - top quick-entry row,
  - grouped date sections,
  - per-day + week duration totals,
  - metadata controls for projects/goals/tags.
- Data source for time rows: `GET /api/timer/list`.

## Metadata lifecycle management
- Projects (`/api/projects`): list/create/update/delete
- Goals (`/api/goals`): list/create/update/delete
- Tags (`/api/tags`): list/rename/delete

Deletion behavior:
- removing a project clears related `projectId` references,
- removing a goal clears related `goalId` references,
- tag rename/delete propagates across entry tags and preferred tags.

## Security and controls
- Role-based guards (`member`, `manager`, `owner`).
- Manager+ required for metadata mutations.
- Invite-first registration and signed session cookies remain enforced.

## Deployment readiness
- Vercel + Neon + Upstash env contract remains unchanged.
- Readiness endpoint: `GET /api/deployment/readiness`.

## Environment
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

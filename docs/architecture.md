# Timed Architecture (Settings + Projects/Goals/Tags CRUD)

## BLUF
This update adds complete management lifecycle support for time metadata objects:
- Projects: create/update/delete
- Goals: create/update/delete
- Tags: list/rename/delete

## User settings
- Endpoint: `GET/PATCH /api/user/settings`
- Fields:
  - `displayName`
  - `timezone` (validated as IANA timezone)
  - `preferredTags`

## Projects, goals, tags management
- Projects API (`/api/projects`)
  - `GET`: list projects in workspace
  - `POST`: create project
  - `PATCH`: modify project name/billing model/percent complete
  - `DELETE`: remove project and detach it from linked goals/time entries

- Goals API (`/api/goals`)
  - `GET`: list goals in workspace
  - `POST`: create goal
  - `PATCH`: modify goal metadata and completion state
  - `DELETE`: remove goal and detach it from linked time entries

- Tags API (`/api/tags`)
  - `GET`: list workspace tags derived from entries
  - `PATCH`: rename tag across entries and user preferred tags
  - `DELETE`: remove tag across entries and user preferred tags

## Time entry semantics
Time entries support optional:
- `projectId`
- `goalId`
- `tags[]`

These are validated against workspace scope on write endpoints.

## Security & authorization
- Role model (`member`, `manager`, `owner`) enforced.
- Modifying/deleting projects, goals, and tags requires manager+ role.
- Registration remains invite-first unless `ALLOW_SELF_REGISTRATION=true`.

## Deployment readiness
- `GET /api/deployment/readiness` surfaces environment readiness for:
  - Vercel deployment
  - Neon Postgres
  - Upstash KV
  - auth/audit secrets

## Environment
```bash
NEXT_PUBLIC_APP_URL=https://timed.tkoresearch.com
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

# FEATURES.md

This file maps implemented/planned features to `REQUIREMENTS.md`.

## MVP Features
- [ ] Workspace-based authentication and authorization.
- [ ] Secure firmware upload flow (size/type checks, malware-safe handling assumptions, private storage).
- [ ] Scan job orchestration (queued background jobs).
- [ ] CVE correlation engine for extracted firmware components.
- [ ] Insecure pattern heuristics (configurable ruleset).
- [ ] Findings UI with severity, component, and CVE filters.
- [ ] Scan result exports (CSV first, JSON optional).
- [ ] Webhook delivery for scan lifecycle events.

## Platform & Ops
- [ ] Vercel web deployment.
- [ ] Dockerized worker deployment.
- [ ] Postgres migrations with Drizzle.
- [ ] Scheduled CVE feed refresh.
- [ ] Audit logging and rate limiting.

## Testing Scope (Major Things)
- [ ] Upload API integration tests.
- [ ] Scan pipeline end-to-end happy path.
- [ ] Tenant isolation security tests for findings queries.
- [ ] Export format contract tests.

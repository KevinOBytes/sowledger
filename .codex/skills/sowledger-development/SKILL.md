---
name: sowledger-development
description: Use when modifying the SOWLedger Next.js application, database schema, routes, tests, or project configuration.
---

# SOWLedger Development

## Overview
SOWLedger is a Next.js 16.4.1 App Router application for planning, tracking, billing, exporting, and integrating time data. Treat framework version drift, workspace isolation, and product workflow continuity as primary risks.

## Quick Start
1. Confirm the repo root is `/Users/example/Projects/sowledger`.
2. Run `git status --short` and preserve unrelated changes.
3. Read relevant local Next.js docs in `node_modules/next/dist/docs/` before editing Next-specific APIs.
4. Locate existing patterns with `rg` before adding new ones.
5. Validate with `npm run lint`, `npm run build`, and targeted Playwright when UI or routes change.

## Project Map
- `app/(app)`: authenticated app surfaces.
- `app/(marketing)`: public marketing, support, and API docs.
- `app/api`: authenticated app API, public API v1, Stripe, exports, timers, schedule.
- `app/api/cron`: Vercel/external cron endpoints; these are public at the proxy layer and must enforce `CRON_SECRET` or `x-auth-key` in handlers.
- `components`: shared client/server UI components.
- `lib/db/schema.ts`: Drizzle schema source.
- `lib/integrations`: provider helpers for encrypted credentials, OAuth state, Google Calendar, Slack, and QuickBooks.
- `lib/db/ensure-workspace-schema.ts`: compatibility no-op; requests never run schema DDL.
- `db/migrations`: SQL migrations.
- `vercel.json`: production cron registration for reminders and unfinished timer checks.
- `tests`: Playwright user-flow coverage.

## Common Mistakes
- Do not assume older Next.js behavior. Check local docs first.
- Do not add runtime dependencies where the existing stack already has a pattern.
- Do not bypass `workspaceId` filters for convenience.
- Do not claim UI work is done without checking reachability from navigation.
- Do not return provider tokens, webhook URLs, or other bearer-like integration secrets from app APIs.
- Keep ORM tables explicitly qualified in the shared database's dedicated `sowledger` schema through `lib/db/namespace.ts`; never create SOWLedger tables in shared `public` or alter another application's schema.
- Runtime `DATABASE_URL`/`NEON_DATABASE_URL` uses restricted `sowledger_app` with no DDL privileges. Schema changes use maintenance-only direct `DATABASE_MIGRATION_URL` and reviewed migrations (`npm run db:migrate:product` for product changes), preserving the runner's backup/checksum journal. Never run DDL from authentication or request paths.

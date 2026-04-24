---
name: billabled-development
description: Use when modifying the Billabled Next.js application, database schema, routes, tests, or project configuration.
---

# Billabled Development

## Overview
Billabled is a Next.js 16.2 App Router application for planning, tracking, billing, exporting, and integrating time data. Treat framework version drift, workspace isolation, and product workflow continuity as primary risks.

## Quick Start
1. Confirm the repo root is `/Users/example/Projects/billabled`.
2. Run `git status --short` and preserve unrelated changes.
3. Read relevant local Next.js docs in `node_modules/next/dist/docs/` before editing Next-specific APIs.
4. Locate existing patterns with `rg` before adding new ones.
5. Validate with `npm run lint`, `npm run build`, and targeted Playwright when UI or routes change.

## Project Map
- `app/(app)`: authenticated app surfaces.
- `app/(marketing)`: public marketing, support, and API docs.
- `app/api`: authenticated app API, public API v1, Stripe, exports, timers, schedule.
- `components`: shared client/server UI components.
- `lib/db/schema.ts`: Drizzle schema source.
- `lib/db/ensure-workspace-schema.ts`: runtime schema hardening for existing databases.
- `db/migrations`: SQL migrations.
- `tests`: Playwright user-flow coverage.

## Common Mistakes
- Do not assume older Next.js behavior. Check local docs first.
- Do not add runtime dependencies where the existing stack already has a pattern.
- Do not bypass `workspaceId` filters for convenience.
- Do not claim UI work is done without checking reachability from navigation.

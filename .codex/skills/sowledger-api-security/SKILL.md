---
name: sowledger-api-security
description: Use when modifying SOWLedger public API v1, API keys, exports, webhooks, authentication, authorization, billing, or Stripe integration.
---

# SOWLedger API Security

## Overview
SOWLedger exposes operational workspace data. Security work must preserve tenant isolation, least privilege, auditability, and safe billing boundaries.

## Rules
- Scope every operational read/write by `workspaceId`.
- Public API calls authenticate with `Authorization: Bearer <key>`.
- Store only API key hashes, visible prefixes, scopes, creator, expiry, revoke state, last-used timestamp, and safe request metadata.
- Enforce scopes per endpoint. Missing scopes return 403.
- Track public API usage for both successful and failed authenticated requests.
- Do not expose subscription changes, billing admin, invites, or destructive workspace admin actions in public API v1.
- Stripe checkout accepts `planId`; never trust raw price IDs from the client.
- Webhooks must verify Stripe signatures and update workspace subscription state idempotently.
- Exports must exclude secrets and include SHA-256 digest headers.
- Native integration credentials must be encrypted at rest, redacted from all client responses, revocable via disconnect, and bound to workspace-scoped sync records.
- OAuth provider callbacks must validate signed state, active session workspace/user, and current manager authorization before credential storage.
- `/api/cron/*` routes are intentionally public in `proxy.ts`; route handlers must enforce `Authorization: Bearer $CRON_SECRET` for Vercel Cron or `x-auth-key` for external monitors with `enforceAuthKey`.
- Custom webhook endpoints must never expose raw URLs after creation. Dispatch must validate public HTTPS destinations, reject private/reserved IPv4 and IPv6 including IPv4-mapped IPv6, and avoid DNS rebinding to private hosts at connection time.

## Risk Review
Before finishing, inspect for accidental cross-workspace queries, secret leakage, over-broad public writes, missing role checks, unauthenticated admin paths, and provider-token exposure.

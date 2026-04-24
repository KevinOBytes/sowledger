---
name: billabled-api-security
description: Use when modifying Billabled public API v1, API keys, exports, webhooks, authentication, authorization, billing, or Stripe integration.
---

# Billabled API Security

## Overview
Billabled exposes operational workspace data. Security work must preserve tenant isolation, least privilege, auditability, and safe billing boundaries.

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

## Risk Review
Before finishing, inspect for accidental cross-workspace queries, secret leakage, over-broad public writes, missing role checks, and unauthenticated admin paths.

# Security Launch Review

Date: 2026-04-24
Scope: Billabled launch pass covering Next.js proxy boundaries, public API, Stripe billing/webhooks, API keys, exports, readiness, and production observability.

## Executive Summary
The highest-risk launch issues found in this pass were fixed before deployment: public API v1 and Stripe webhook routes were session-gated by the app proxy, sensitive endpoints had no app-level rate limiting, and production readiness/health checks were not suitable for operational verification. The remaining launch risks are operational: production env values, Sentry/Upstash wiring, and live Stripe event verification must be confirmed after deployment.

## Fixed Findings

### F-1: Public API v1 was blocked by session proxy
- Severity: High
- Location: `proxy.ts:5-18`, `app/api/v1/[resource]/route.ts:61-76`
- Evidence: `/api/v1/*` is now explicitly public at the proxy layer, and each request is authenticated by `Authorization: Bearer <key>` inside the route handler.
- Impact: Before this fix, external API users would be redirected to login instead of reaching API-key auth.
- Fix: Added `/api/v1/` to public proxy prefixes and retained scoped API-key enforcement in the route handler.

### F-2: Stripe webhook endpoints were blocked by session proxy
- Severity: High
- Location: `proxy.ts:12-15`, `app/api/webhooks/stripe/route.ts:38-58`
- Evidence: `/api/webhooks/stripe` and `/api/stripe/webhook` are now public at the proxy layer; the route verifies the `stripe-signature` header with `STRIPE_WEBHOOK_SECRET` before processing.
- Impact: Stripe could not reliably deliver subscription events, so checkout success might not update workspace plans.
- Fix: Added webhook route exceptions and preserved signature verification.

### F-3: Sensitive endpoints lacked shared rate limiting
- Severity: Medium
- Location: `proxy.ts:27-105`
- Evidence: Auth request-link, public API, checkout, API-key management, and export endpoints now have bounded windows with Upstash REST support and local fallback.
- Impact: Attackers could spam auth links, API auth attempts, checkout creation, API key management, or exports.
- Fix: Added proxy-level rate limiting with `429`, `Retry-After`, and rate limit headers.

### F-4: Baseline security headers were missing at app proxy
- Severity: Medium
- Location: `proxy.ts:37-44`, `proxy.ts:113-126`
- Evidence: Responses passing through the proxy now receive `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`.
- Impact: Missing browser hardening increased clickjacking/content-sniffing/privacy risk.
- Fix: Added conservative security headers without adding HSTS yet, because HSTS should be enabled only after the production domain/TLS posture is final.

### F-5: Readiness checks were not production-safe
- Severity: Medium
- Location: `app/api/deployment/readiness/route.ts:12-39`, `app/api/health/route.ts`
- Evidence: `/api/health` returns anonymous liveness only; detailed readiness requires `x-auth-key` matching `AUTH_SHARED_KEY` outside development.
- Impact: Operators needed launch verification, but detailed env checks should not be public.
- Fix: Added public health and protected detailed readiness.

### F-6: API-key hashing depended on a dev fallback in production
- Severity: Medium
- Location: `lib/api-keys.ts:36-42`
- Evidence: Production now throws if `AUTH_COOKIE_SECRET` is missing before hashing API keys.
- Impact: A misconfigured production environment could hash API keys with a known development pepper.
- Fix: Fail closed in production if the key pepper is not configured.

## Residual Risks To Verify After Deploy

### R-1: Production env readiness
- Severity: High until verified
- Evidence: App code now checks required env through protected readiness, but the deployed environment must actually have `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Sentry, Upstash, Resend, and DB values configured.
- Required verification: Call `/api/deployment/readiness` with `x-auth-key` after deploy and require `ok: true`.

### R-2: Live Stripe webhook delivery
- Severity: High until verified
- Evidence: Code-level signature handling is present, but live webhook endpoint registration and secret pairing must match the deployed URL.
- Required verification: Send a Stripe CLI or Dashboard test event to `/api/webhooks/stripe`, then perform real checkout and confirm workspace plan mutation.

### R-3: Public API abuse controls depend on Upstash in production
- Severity: Medium until verified
- Evidence: Proxy rate limiting uses Upstash when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set; otherwise it falls back to process-local counters.
- Required verification: Confirm Upstash env is present in production readiness.

### R-4: Workspace isolation should remain part of CI review
- Severity: Medium
- Evidence: Core public API filters by `workspaceId` through API-key context, and app routes use session workspace filters. Future route additions can regress this.
- Required verification: Keep Playwright/API regression coverage for cross-workspace reads and writes as the API expands.

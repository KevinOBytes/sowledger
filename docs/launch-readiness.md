# Billabled Launch Readiness Runbook

## Production Gate
Run this gate before every production deploy:

```bash
npm run lint
npm run build
npm run agentic:check
git diff --check
npx playwright test --project=chromium
```

## Database Migration
Use the tracked safe runner for product-completion schema changes:

```bash
npm run db:migrate:product
```

The runner:
- loads `DATABASE_URL` from the environment;
- writes a schema backup with `pg_dump` when the local client supports the server version;
- falls back to a catalog snapshot when `pg_dump` is unavailable or version-mismatched;
- records applied migrations in `billabled_migrations` with a SHA-256 checksum;
- refuses to run if the same migration ID was applied with different contents.

## Required Production Env
- `NEXT_PUBLIC_APP_URL`
- `AUTH_COOKIE_SECRET`
- `AUDIT_SIGNING_SECRET`
- `RESEND_API_KEY`
- `DATABASE_URL`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or Vercel KV aliases `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_SMB_PRICE_ID`
- `STRIPE_ENTERPRISE_PRICE_ID`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`

## Post-Deploy Checks
- `GET /api/health` returns `{ ok: true }` and is safe for uptime checks.
- `GET /api/deployment/readiness` returns public liveness only by default.
- `GET /api/deployment/readiness` with `x-auth-key: $AUTH_SHARED_KEY` returns detailed env readiness.
- Stripe webhook endpoint must be configured to `/api/webhooks/stripe`; `/api/stripe/webhook` remains a compatibility alias.
- Public API consumers call `/api/v1/*` with `Authorization: Bearer <key>` and do not need a browser session cookie.

## Stripe Verification
- Confirm the live prices are configured in production env:
  - Starter: `STRIPE_PRO_PRICE_ID`
  - Studio: `STRIPE_SMB_PRICE_ID`
  - Business: `STRIPE_ENTERPRISE_PRICE_ID`
- Run a real checkout from `Settings -> Billing` with an owner account.
- Confirm `checkout.session.completed` updates the workspace plan.
- Open the customer portal from `Settings -> Billing` on the paid workspace.
- Send a Stripe CLI/webhook test event to `/api/webhooks/stripe` and verify a `200` response.

## Security Checks
- API v1, Stripe webhooks, health, and readiness are intentionally public at the proxy layer; route handlers must enforce their own authentication or signature validation.
- Sensitive API routes are rate-limited at proxy level with Upstash REST when configured and in-memory fallback for local/dev.
- Baseline security headers are added in `proxy.ts`.
- Production readiness details require `x-auth-key` and are not disclosed anonymously.

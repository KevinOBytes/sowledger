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
- `AUTH_SHARED_KEY`
- `CRON_SECRET`
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

## Optional Production Env
Billabled runs without Sentry and without native provider integrations. When these values are missing or misconfigured, readiness reports them as degraded instead of failing the app.

- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_REDIRECT_URI`
- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_REDIRECT_URI`
- `QUICKBOOKS_ENVIRONMENT` (`sandbox` or `production`)

## Post-Deploy Checks
- `GET /api/health` returns `{ ok: true }` and is safe for uptime checks.
- `GET /api/deployment/readiness` returns public liveness only by default.
- `GET /api/deployment/readiness` with `x-auth-key: $AUTH_SHARED_KEY` returns detailed required checks plus optional degraded checks.
- Stripe webhook endpoint must be configured to `https://www.billabled.com/api/webhooks/stripe`; `/api/stripe/webhook` remains a compatibility alias.
- Public API consumers call `/api/v1/*` with `Authorization: Bearer <key>` and do not need a browser session cookie.
- Integration Center is available at `/integrations`.
- Google Calendar OAuth callback must be registered as `https://www.billabled.com/api/integrations/google-calendar/oauth/callback`.
- Slack OAuth callback must be registered as `https://www.billabled.com/api/integrations/slack/oauth/callback`; manual incoming webhooks are supported as a fallback.
- QuickBooks OAuth callback must be registered as `https://www.billabled.com/api/integrations/quickbooks/oauth/callback`.
- Vercel Cron is registered in `vercel.json` for `/api/cron/scheduled-block-reminders` and `/api/cron/unfinished-timers`. Set `CRON_SECRET` so Vercel sends `Authorization: Bearer $CRON_SECRET`; external monitors may use `x-auth-key: $AUTH_SHARED_KEY`.

## Integration Verification
- Connect Google Calendar from `/integrations`, then run `Sync now` from `/calendar`.
- Confirm Billabled planned blocks appear in Google Calendar with Billabled private extended properties.
- Confirm external Google Calendar busy events import as unavailable blocks, not completed time.
- Connect Slack with OAuth or a manual incoming webhook, then run `Test`.
- Create a scheduled work block and confirm Slack receives reminder-capable event delivery after cron runs; imported unavailable/OOO/busy blocks must not produce reminders.
- Connect QuickBooks in sandbox first, set `customerRefId` and `serviceItemRefId`, then push a test invoice from `/invoices`.
- Confirm provider credentials are never visible after connection and are stored only in `integration_connections.credentials`.

## Stripe Verification
- Confirm the live prices are configured in production env:
  - Starter: `STRIPE_PRO_PRICE_ID`
  - Studio: `STRIPE_SMB_PRICE_ID`
  - Business: `STRIPE_ENTERPRISE_PRICE_ID`
- Run a real checkout from `Settings -> Billing` with an owner account.
- Confirm `checkout.session.completed` updates the workspace plan.
- Confirm `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` events keep the workspace subscription state synchronized.
- Open the customer portal from `Settings -> Billing` on the paid workspace.
- Send a Stripe CLI/webhook test event to `/api/webhooks/stripe` and verify a `200` response.

## Security Checks
- API v1, Stripe webhooks, health, and readiness are intentionally public at the proxy layer; route handlers must enforce their own authentication or signature validation.
- Sensitive API routes are rate-limited at proxy level with Upstash REST when configured and in-memory fallback for local/dev.
- Baseline security headers are added in `proxy.ts`.
- Production readiness details require `x-auth-key` and are not disclosed anonymously.

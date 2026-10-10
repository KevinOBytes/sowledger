# SOWLedger copy and workflow repairs

Request: audit the interface and missing features with subagents, then fix the copy throughout the product and the functional issues found in the audit.

Baseline: `a0d727aa4066d40631f849fbf8feb262143aac72`, clean main, matching GitHub and production. Lint, production build and agentic checks passed before changes. Those checks did not exercise the full customer workflow.

## Scope and constraints

- Write in plain, natural English. Explain what a person can do, what happened, and what to do next. Remove internal implementation language, unsupported claims, synthetic risk statistics, repeated slogans and internal plan IDs from customer surfaces.
- Preserve plan IDs, workspace isolation, signed audit records, encrypted integration credentials and the dedicated `sowledger` schema.
- Repair the existing time, approval, invoice, calendar, navigation and login workflows. Unimplemented roadmap items such as full SOW authoring and recurring retainer billing must not be advertised as available.
- Use a separate test database for authenticated tests. Never run test-login fixtures or test mutations against production.
- No old database deletion, no unrelated changes, and no secrets in reports or source control.

## Work packages

| Package | Owner | Work | Status |
| --- | --- | --- | --- |
| Public copy | Copy agent | Homepage, all 12 audience pages, navigation, support, accurate plan limits and metadata | Implemented; focused desktop/mobile tests passed |
| Operational interface | UX agent/controller | Timer-first dashboard; visible failures/retry; phone dialogs, calendar and navigation; Activity submit/pagination; independent timer loading | Implemented; included in passing final gate |
| Time and billing | Workflow agent/controller | Submit/resubmit; pause-safe corrections; atomic approvals; invoice lifecycle/print; exact client-reviewed snapshot; consistent cent rounding; analytics exclusions | Implemented; included in passing final gate |
| Authentication and configuration | Controller | Atomic one-use sign-in; unique workspace identity; invitation roles and workspace switching; safe infrastructure/email failures; canonical origin; protected DB readiness | Implemented; 11 auth regressions included in final gate; production settings not changed |
| Remaining copy and delivery | Copy agent/controller | Remaining app copy and truthful legal technical descriptions; failed-load states; awaited webhook delivery; nullable work rates and CSV format controls | Implemented and reviewed; five mocked regressions included in final gate |
| Verification and review | Controller/review agents | Isolated full regression gate, desktop/mobile browser review, independent source review | Local verification complete; publication not performed |

## Interface agreements

- Activity submits with `POST /api/timer/submit`, JSON `{ entryIds: string[] }`. Only completed draft/rejected entries owned by the user (or managed within their workspace) may be submitted. Returns `{ ok: true, submitted: number }`; failures return safe `{ error }` messages and meaningful HTTP status.
- Clearing notes sends `description: ""`; clearing a project sends `projectId: null`. Omitted values mean unchanged. Duration remains unchanged when timestamps do not change, including paused entries.
- Calendar refresh after sync uses `sowledger:calendar-updated`.
- No agent commits while other packages are in progress. The combined tree must build and run before any commit.

## Confirmed deployment configuration observations

- Production currently uses the released commit above.
- Production has `DATABASE_URL`; there is no stale `NEON_DATABASE_URL` override in the current variable inventory.
- The configured public app origin is still `https://www.billabled.com`, which the magic-link handler uses. It must be corrected to the SOWLedger domain.
- Production self-registration and bootstrap-owner mode are enabled. The email-local-part workspace collision and invitation role ordering therefore require repair.
- No production `CRON_SECRET` or Slack OAuth credentials were listed. Google Calendar and QuickBooks credentials exist; QuickBooks is configured for sandbox. Provider availability is distinct from a workspace connection.
- Vercel cannot export production sensitive values, and the Neon connector returned an authorization error. Use the existing authenticated operator CLI for database inspection/testing when available; do not replace credentials or create a new production project.

## Progress and verification

Implementation is local on `codex/sowledger-workflow-and-copy`. No commit, push, merge, deployment, production environment change, or production data mutation has been made by this repair batch.

Authenticated checks use a schema-only, disposable Neon branch with synthetic records and the restricted `sowledger_app` role. `scripts/with-test-database.mjs` validates the selected branch and keeps credentials in process memory. It clears email, billing, and provider credentials before launching checks. The original source database and shared production main branch remain untouched.

The independent reviews identified and prompted corrections for role changes racing with sign-in, invoice line/total rounding, local-origin defaults, partial dashboard failures, calendar rate selection/clearing, cookie-overlay stacking, optional-rate rendering/clearing, and CSV dataset-selection behavior. Test wording was updated to the new UI without removing the underlying workflow and access-boundary assertions.

## Final local verification

| Check | Final result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run agentic:check` | Passed |
| `npx tsc --noEmit` | Passed; production build also completed TypeScript |
| `npm run build` | Passed on Next.js 16.2.6; all 118 pages generated without the earlier session-loading log noise |
| Isolated Playwright, Chromium + mobile Safari | **104 passed in 2.2 minutes** in the final combined run: 96 Chromium, 8 mobile Safari; no skipped/failed tests |
| `git diff --check` and runner syntax check | Passed |
| Local compiled app, `next start` on port 3009 | Started successfully; no runtime error messages during the manual smoke check |

The final browser run used a fresh server owned by Playwright. Its checks include public routes, all audience pages, plan limits, core phone navigation, real database-backed time/approval/invoice/client flows, authorization boundaries, invitation roles, single-use sign-in links, scheduled-rate changes and clearing, partial-load recovery, and optional-rate/CSV component regressions. Mocked provider responses and isolated components are not live-provider verification.

The dev-server test log contains a `pg` query-concurrency deprecation warning and a request-aborted `ECONNRESET` during rapid test navigation. Neither failed a test or stopped the server; the exact abort cause was not established. The local production-mode manual check did not produce these errors. An earlier form-edit failure was not reproduced across 15 repeats or a deliberately delayed-options/parent-refresh probe; it passed in both frozen-source full runs. Do not describe the earlier hot-reload hypothesis as a confirmed root cause.

### Compiled-app and visual evidence

- Public `/`, `/for`, a representative audience page, `/login`, `/api/health`, and public readiness returned 200.
- An unauthenticated `/dashboard` request redirected to `/login`; production-mode test login returned 403.
- Protected readiness confirmed real access to the isolated SOWLedger database. Its overall 503 was expected because live email/payment/provider credentials were deliberately disabled; the provider flags were verified false.
- Manual browser checks used a synthetic account, not a customer account. Phone timer start/stop persisted an 18-second entry and Activity displayed it without a reload. Earlier manual submission/approval also succeeded.
- Screenshots were saved outside the repository: `sowledger-home-desktop.jpg` and `sowledger-timer-mobile.jpg` under the task's visualization directory. They show the locally compiled application, not a deployment.
- Browser viewport overrides were reset. Both local servers were stopped after verification.
- The disposable `codex-sowledger-repair-20261009` branch (`br-silent-fog-ahwcl7b4`) was deleted after testing. Readback confirmed it was absent and production main remained present. Only synthetic fixture data was removed; recreate fixtures in a new test branch when needed. The old production/source rollback databases were not deleted.

### Release boundary

At the end of the repair pass, the code and reports remained on `codex/sowledger-workflow-and-copy`, uncommitted and unpublished. No new schema migration is required for this repair batch.

### October 10 release preflight

The user authorized committing and pushing this repair batch, merging it into `main`, and verifying Vercel deployment and the public domain. GitHub's `main` still matches the original baseline; no unrelated branch work was folded into this repair release.

- Refreshed lint and agentic checks passed. A fresh production build passed, including TypeScript and all 118 generated pages. The first sandboxed build was blocked from opening a local worker port; the same build succeeded with the required execution access and no source changes.
- The 104-test isolated Chromium/mobile Safari gate above covers the unchanged application source being released. Production data was not used for test fixtures.
- Vercel confirms `KevinOBytes/sowledger` is linked to `tkoresearch/sowledger`, with `main` as its production branch.
- Both `sowledger.com` and `www.sowledger.com` are verified project domains. Cloudflare's authoritative nameservers resolve the apex to Vercel and `www` to the project's assigned Vercel CNAME. Vercel reports both domains correctly configured; live HTTPS returns 308 from the apex to `https://www.sowledger.com/` and 200 at `www`. No DNS rewrite is necessary.
- The production public-origin setting was corrected to `https://www.sowledger.com`, and the missing production credential for the already-registered Vercel cron jobs was added as a production-only secret. Readback confirmed the URL and secret metadata without exposing the secret value.
- Merge status, deployment state, exact release SHA, and post-deployment checks must be verified after publication; this preflight does not claim they have happened.

Slack OAuth setup, QuickBooks production-provider setup (currently sandbox), and live email/provider acceptance checks remain separate from release verification. Existing rollback databases and unrelated DNS/email records are retained.

# Repair release — November 3, 2026

This batch connects the planning, timer, manual-time, review, billing, export and integration workflows. It preserves workspace isolation and the existing workspace plan IDs. The accompanying tests cover both successful work and refusal, rollback, race, privacy and accessibility boundaries.

## Main changes

- Calendar navigation, local dates and daylight-saving boundaries, overlap layouts, keyboard movement, mobile controls, and manual/calendar-time logging. A regular member receives only their own detailed time records.
- Timer transitions, concurrent capacity, manual entry, submitted-time corrections, client/project/task/tag persistence, filtered exports and clearer error recovery.
- Explicit cookie consent for optional browser analytics and replay, including withdrawal. Newly created or rotated API keys are excluded from Datadog replay while remaining available to copy once.
- Exact role validation in invitation, sign-in and workspace selection paths. Elevated invitations require an owner; malformed roles fail closed.
- Durable seven-day renewal grace for previously active customers, based on verified payment evidence. Unknown failure dates do not create a new grace period, and incomplete reconciliation remains retryable without granting unverified access.
- Confirmed draft-invoice voiding with provenance, audit and external-exposure safeguards. Exported financial lines cannot later be treated as unshared. Expense changes are atomic, respect approved/invoiced/closed periods, and withdraw submitted entries to Draft for resubmission.
- Google Calendar, Slack and QuickBooks error/ownership handling and synchronization safeguards. These changes do not certify a customer's live provider configuration or perform an external invoice cancellation.

## Database and recovery

Apply the reviewed additive migrations in order: `0012_billing_invoice_lifecycle.sql`, then `0013_billing_failure_evidence.sql`. Use the maintenance runner, never runtime credentials or authentication paths. The migrations create only SOWLedger lifecycle storage, preserve existing records and legacy plan behavior, and retain the restricted application's no-DDL boundary. See [financial lifecycle operations](financial-lifecycle-migration.md).

A provider recovery branch and a private full backup were created for this release. The full backup was restored into a separate disposable database: all 9,327 rows (including migration history), columns, indexes and table grants matched. Private backups, connection details and operational receipts are deliberately excluded from this public repository. Do not restore the entire shared Neon project to roll back one application's deployment.

Both migrations were applied to the shared production database after their dry runs passed. Independent readbacks confirmed that each dry run rolled back, each applied checksum matched, and replaying each migration made no changes. The four intended lifecycle tables were added; all 9,325 existing application rows and neighboring application schemas remained unchanged. Read-only checks with the restricted application role confirmed access to the new tables, no schema-creation privilege, and no access to the maintenance journal.

## Dependency security

The release uses Next.js 16.4.1, Sentry 10.78.0, Zod 4.6.7 and patched URI, request-body and address parsing dependencies. Modern Glob/Minimatch upgrades are scoped to compatible consumers. Production dependencies and the MCP package have clean npm audits at the release check.

The full development audit still reports 15 moderate transitive warnings for the retained Minimatch 3.1.5 used by ESLint and older plugins. The npm advisory range includes all versions below 11.0.1, but the [upstream advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) describes `firstPhasePreProcess` amplification at optimization level 2. The installed 3.1.5 implementation has no such preprocessing path. The affected modern implementation was upgraded. This is an advisory-specific not-affected assessment, not a claim that the full audit is empty or that legacy matching has no other possible risks.

Do not force every Minimatch consumer to version 11: older ESLint plugins require a callable CommonJS/default API that version 11 does not provide. The scoped Sentry Glob and TypeScript-estree overrides were checked against their actual imports, options and engine requirements, and the installed Sentry file-discovery adapter was exercised locally.

## Acceptance boundaries

Independent product/dependency, security and financial reviews cover the repaired paths. The final pre-commit checks passed:

- Lint, production build and TypeScript, MCP build, and agent-guidance consistency.
- All 1,040 Node tests and all 1,081 Chromium tests, with no browser retries.
- All 124 calendar-accessibility cases across Chromium and WebKit, plus both actual-SDK replay-privacy cases.
- Disposable migration, rollback, replay, constraints and application-permission checks; production dry-run, migration and read-only permission verification.
- Production-mode local startup, protected-route behavior, database access and test-login denial, with live provider credentials disabled.
- A scan of the staged release diff found no secrets. Private recovery files and operational captures are excluded from Git.

The Next.js security upgrade changed its streamed navigation format and exposed a mismatch in two browser-test completion helpers. The helpers were updated against captured responses and independently reviewed; privacy checks, exact redirect destinations, server-rendered update evidence and persistence checks remain required. The complete browser suite passed after those test-only corrections.

Local tests deliberately disable live provider credentials. They do not establish hosted Stripe delivery, third-party retention of older telemetry, every customer's OAuth setup, or a real customer's authenticated production journey. Production migration and deployment readback are separate operator checks. Preserve the effective audit-signing key; a normal application rollback after new financial writes is not automatically a financially safe rollback.

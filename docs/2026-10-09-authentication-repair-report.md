# Authentication and operational repairs — October 9, 2026

## Implemented locally

- Sign-in now resolves an existing membership or pending invitation before considering a new personal workspace. New workspace slugs include a hash of the complete normalized email address, so identical names on different domains do not collide.
- Consuming a magic link locks the link, workspace, membership, and accepted invitation within a transaction. A failed setup rolls back account changes and leaves the link unused. Normal sign-in does not rewrite an existing member's role. Pending client invitations preserve the client role rather than bootstrapping an owner.
- A workspace selector lists only the current user's memberships and invitations. Switching requires an existing membership or a valid invitation for that user's email and uses a fixed app/client destination. The full reload clears the previous workspace's client-side state.
- The sign-in form distinguishes unavailable infrastructure from an expired/invalid link. Rejected email-provider responses return a failure instead of falsely saying an email was sent. Development-only local sign-in remains unavailable in production.
- `getAppOrigin()` supplies the canonical SOWLedger origin, maps the previous Billabled hostnames, validates configured URLs, and preserves a local request's development origin when no explicit app URL exists. Production configuration still needs the public-origin variable corrected at release time.
- Database connections have bounded connect/query timeouts. Protected deployment readiness checks query the actual, explicitly qualified SOWLedger schema. Public health output does not disclose protected database/configuration details.
- Webhook work is awaited within Next's post-response lifetime. Transactional callers dispatch after commit, and existing event payload structures are preserved. Logs omit endpoint URLs and payloads. This is not a durable delivery queue, and failures are not automatically retried.
- Invoice totals and displayed/reviewed line amounts share one cent-rounding helper. Existing active billing is checked before a missing new-plan price can mask the correct duplicate-subscription response.

## Independent review

Two bounded source-review passes found and prompted fixes for a concurrent membership-role overwrite, development-origin defaults, invoice rounding differences, transactional webhook payload compatibility, and provider-environment isolation in the test runner. Reviewer confirmation is source evidence, not production customer or provider delivery evidence.

## Safe test execution

The database-backed suite uses a schema-only disposable Neon branch with synthetic records. Production's dedicated `sowledger` schema, restricted runtime role, original migration journal, and retained rollback source remain unchanged.

`scripts/with-test-database.mjs` checks the disposable branch name and rejects primary/default/protected branches. It loads the restricted-role connection into process memory, replaces both runtime database variables, and blanks known provider credentials before Next can read local dotenv files. No connection strings are written to source or reports.

For an isolated run, Playwright must launch its own server; it cannot reuse an unrelated localhost server. The test fixture login also requires `SOWLEDGER_TEST_DATABASE=true` and remains blocked in production. Stop any manual server on port 3008 before running:

```sh
SOWLEDGER_TEST_PROJECT=<project-id> SOWLEDGER_TEST_BRANCH=<disposable-branch-id> \
  node scripts/with-test-database.mjs -- npx playwright test --project=chromium
```

Use `NEON_CLI_PATH` when the authenticated Neon CLI is installed outside PATH. Create a fresh disposable branch if the earlier one has been removed; never substitute the production branch.

The final consolidated results are recorded in `docs/2026-10-09-product-repair-plan.md`.

## Production observations and remaining boundaries

The production configuration audit found the old public origin, no listed `CRON_SECRET`, absent Slack OAuth configuration, and QuickBooks sandbox mode. Existing Google Calendar and QuickBooks client credentials were present. Provider configuration and successful connection/delivery are different facts.

No live email, customer approval, payment collection, external webhook delivery, or provider sync was exercised by the synthetic checks. Invoice “Mark as sent” records an operator action; it does not send email. Invitation creation/renewal does not send an invitation email. Terms and privacy changes correct technical instructions only; existing liability, deletion timing, and data-rights commitments still require the owner's operational/legal review.

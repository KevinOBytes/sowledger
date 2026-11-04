# Financial lifecycle migrations (0012, then 0013)

This additive migration creates four app tables in `sowledger`, adds an invoice/workspace unique index for the provenance foreign key, and grants only SELECT/INSERT/UPDATE/DELETE on the four tables to the existing `sowledger_app` role. It neither creates roles nor grants schema CREATE. The migration journal remains maintenance-only in `sowledger_migrations`. It does not touch foreign application schemas, backfill provenance or provider facts, change workspace plans, or rewrite invoice statuses. `void` is an ORM varchar union addition, not a PostgreSQL enum alteration.

Rows absent from `workspace_billing_state` and `invoice_lifecycle` are deliberately unknown legacy history. Callers must not interpret their absence, a paid plan, or a bare `void` invoice status as verified activation or authorization to release time. Release actor, timestamp, reason and audit reference are all-or-none in storage. New timestamps use `timestamptz` to preserve elapsed-time billing deadlines.

Migration `0013_billing_failure_evidence.sql` must follow `0012`. It only drops `NOT NULL` from `sowledger.billing_payment_failures.first_failed_at`; it does not rewrite rows, backfill timestamps, change grants, or alter foreign schemas. Keep applied `0012` unchanged, including its checksum. A failure row with `first_failed_at = NULL` and `resolved_at = NULL` means this exact workspace/subscription/invoice is verified unpaid but its first failure time is unknown. It is durable debt evidence, not an absent failure or permission to start a new grace period. Invoice rollover cannot discard it: canonical unpaid verification blocks both a newer grace window and paid recovery until an authentic first-attempt event supplies its original anchor or canonical payment resolves that invoice. No receipt or retry time is substituted as the missing anchor.

## Disposable branch workflow

The controller must supply an explicitly approved project, branch ID, existing maintenance role and absolute backup destination. The launcher does not load `.env` target URLs or run login. Fresh Neon CLI branch metadata must be explicitly nonprimary/nondefault/unprotected, future-expiring and named `codex-sowledger-repair-*`. Missing flags or expiry fail closed. The requested maintenance role is checked against the branch role list and cannot be `sowledger_app`. The exact branch ID selects a direct `neondb` connection whose returned role, database, TLS mode and nonpooled host are checked before starting the child.

```bash
SOWLEDGER_TEST_PROJECT='<approved-project>' \
SOWLEDGER_TEST_BRANCH='<approved-branch-id>' \
SOWLEDGER_TEST_MIGRATION_ROLE='<approved-existing-maintenance-role>' \
MIGRATION_BACKUP_PATH='/absolute/private/backup-0012-dry-run.sql' \
node scripts/with-test-migration.mjs --dry-run
```

After independent review and successful disposable-target dry-run readback, use the same invocation without `--dry-run` to apply; use a fresh backup destination. Repeat apply to verify checksum no-op. Production authority is not implied. The launcher accepts only `--dry-run` or no arguments; it cannot run an arbitrary elevated command, accept a migration path, or start the app. Optional `SOWLEDGER_TEST_MIGRATION_ID` has an exact allowlist: `0012` selects `db/migrations/0012_billing_invoice_lifecycle.sql` and `0013` selects `db/migrations/0013_billing_failure_evidence.sql`. Omission defaults to `0012` for compatibility; empty, unknown, path-like, or command-like values fail before Neon CLI/credential retrieval. It invokes only `npm run db:migrate:product -- <the-fixed-selected-path> [--dry-run]` with npm lifecycle hooks disabled. Maintenance credentials stay in child memory; runtime/provider credentials and Node injection options are not inherited. No env file is written and URLs are never printed by the launcher.

For `0013`, retain the same explicit approved project, branch and role selection, choose a fresh backup path, and set the selector before the launcher:

```bash
SOWLEDGER_TEST_PROJECT='<approved-project>' \
SOWLEDGER_TEST_BRANCH='<approved-branch-id>' \
SOWLEDGER_TEST_MIGRATION_ROLE='<approved-existing-maintenance-role>' \
SOWLEDGER_TEST_MIGRATION_ID='0013' \
MIGRATION_BACKUP_PATH='/absolute/private/backup-0013-dry-run.sql' \
node scripts/with-test-migration.mjs --dry-run
```

The controller independently reviews `0013` before dry-run/apply. Read back unchanged existing failure rows, unchanged other schemas and journal after rollback, then verify only the intended column becomes nullable after apply, the new checksum journal entry exists, repeated apply is a checksum no-op, and the restricted runtime can persist an unknown-anchor failure row without gaining DDL privileges. Run consumers and browser acceptance only after `0013` is installed on the disposable target. No production migration or operator replay is authorized by this document.

## Transaction and backup contract

The reviewed runner still supports positional migration path and optional migration ID, with `--dry-run` before or after them. Unknown flags and extra positionals fail before connection. A preflight `pg_dump --schema-only` targets only `sowledger`; if unavailable/incompatible (for example pg_dump 15 against PostgreSQL 17), a schema catalog JSON snapshot records tables, columns, indexes and constraints instead. Keep the backup or catalog receipt. Schema creation, journal creation, migration DDL and journal insertion all occur after BEGIN and the shared advisory transaction lock. Dry-run executes them and ROLLBACKs, including the journal row and newly created schemas. Errors also roll back. A matching checksum skips migration SQL; a mismatch refuses execution.

The backup is not a full recovery point: schema-only dumps exclude customer rows, do not capture the journal or grants here, and `--no-owner/--no-privileges` excludes ownership/ACL restoration. Catalog JSON is an inspection snapshot, not executable rollback SQL; it also omits functions, triggers, policies and other objects. Dry-run still writes a local backup artifact. Backups precede the lock and cannot establish a point-in-time data guarantee if other writers operate concurrently. Use a provider branch/snapshot or full data backup for destructive recovery. No destructive down migration is provided for this additive change.

## Required operator acceptance

Offline tests substitute only PostgreSQL/Neon boundaries; they do not prove PostgreSQL accepts the DDL or the selected branch is unchanged. Before apply, record schema/journal/data baseline and other-schema inventories; after dry-run confirm unchanged readback, not just an exit code. After apply verify all columns/constraints/indexes and checksum no-op, cross-workspace FK refusal, partial-release CHECK refusal, and runtime CRUD on all four tables. Verify runtime cannot CREATE or access the maintenance journal and other schemas are unchanged. Test release/entitlement consumers separately; this migration adds storage only.

## Bounded billing reconciliation and delivery receipts

Billing reconciliation keeps workspace serialization and a maximum of eight provider reads within a 12-second provider deadline per delivery. Each provider request has a timeout of at most five seconds and no automatic network retries. Large unresolved histories are processed in bounded batches. Canonically verified paid invoices may persist their resolution along with a conservative `reconciliation_pending` state, but an unfinished batch writes **no completed event receipt** and returns HTTP 503 so the same delivery can retry. Pending verification denies paid access except for the existing internal entitlement override. It retains the original/minimum grace anchor, with no usable grace deadline while required debt is unread; it never invents another seven-day window or assumes unread invoices are paid.

Once all required debt has been read, ordinary entitlement rules apply. Paid recovery requires the current canonical subscription/latest invoice and all known required debt to meet the payment policy. Final state and completed receipt commit in the same transaction; duplicates of a completed event do no further work. Genuine provider, identity, deadline-overrun or storage failures roll back the current request, including its partial resolutions, and remain retryable. Previously committed verified progress is retained. With finite debt, stable all-paid provider facts and successful repeated deliveries, unresolved rows drain and recovery completes. This is not a guarantee about hosted Stripe retry scheduling or delivery retention; there is no new background reconciliation worker.

A canonically verified terminal cancellation commits without draining old debt or requiring an offered price or available invoice provider. It clears active workspace subscription fields and retains retired binding/debt history. Only a separately verified new checkout can replace that binding; its own price/invoices are fully validated, and retired-subscription debt is not reused for the new subscription.

## Audit signing keys and historical invoice releases

**Do not change the effective audit signing key without a separately reviewed historical-key verification and migration strategy.** Release verification currently uses `AUDIT_SIGNING_SECRET`, falling back to `AUTH_COOKIE_SECRET` when the audit secret is absent. Changing that effective value invalidates verification of existing release signatures. This includes introducing `AUDIT_SIGNING_SECRET` for the first time after historical releases used the cookie-secret fallback, and changing `AUTH_COOKIE_SECRET` while that fallback remains effective.

The failure is conservative but operationally significant: old invoice references can again block rebilling and billable-list eligibility, and retries of completed void operations can return conflicts. This does not undo an already-created replacement invoice or release time again. Before rotating the effective key, review a historical-key/key-ID verification design and migration/retention strategy that preserves verification of authorized existing releases. Key rotation support is separate scope, not provided by these migrations. Keep verification fail-closed: never accept unsigned history or treat an unverified `void` status as a completed release.

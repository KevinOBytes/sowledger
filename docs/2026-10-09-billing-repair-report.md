# Time, approval and invoice workflow repairs

Implemented on `codex/sowledger-workflow-and-copy` in `/Users/kevo/Projects/SOWLedger`. No commits, deployments, production database writes, schema changes or new dependencies were made by this work package. Existing concurrent work was preserved.

## Changes

- `POST /api/timer/submit` accepts `{ entryIds: string[] }` and returns `{ ok: true, submitted: number }`. Batches are all-or-nothing, capped at 100 unique entries, workspace-scoped, and limited to a member's own time or manager/owner-managed time. Only completed drafts with positive recorded time are eligible. Sent-back time remains `draft` with `rejectionReason`, so no enum migration is needed. Resubmission clears the reason and records an audit event.
- Approval and send-back operations require a completed submitted entry. Row locks and transaction-bound signed audits prevent duplicate or racing decisions. Approved/invoiced entries cannot be sent back through the rejection endpoint. The legacy entry-only invoice marker now also requires completed approved time and writes its lock and audit atomically; it remains distinct from invoice creation.
- Editing unchanged timestamps preserves the recorded net duration, including pauses. Edited ranges preserve the original excluded seconds rather than converting breaks into billable time; ranges shorter than those breaks are rejected. Explicit `projectId: null` and `description: ""` clear values. Editing or splitting submitted time returns it to draft for another review. Splits are atomic and preserve the total recorded duration.
- `GET /api/timer/list` supports validated `from`, `to`, `limit`, `offset` and `status` filters, returns `total` and `hasMore`, and adds workspace filters to project/goal joins. `status=rejected` means draft plus a rejection reason.
- The Approvals screen shows send-back notes, retains sent-back entries in history, and distinguishes role restrictions from retryable loading failures.
- Invoice creation locks and validates the approved entries inside one transaction, rounds each line in cents, writes invoice/entry audits, and infers the invoice project when every entry belongs to one project. After commit, it emits the general `invoice.created` webhook and the native integration notification. Callback links use the canonical-origin helper.
- `PATCH /api/invoices/[invoiceId]` allows manager/owner transitions from draft to sent and sent to paid. Repeated, backward, or skipped transitions are rejected. The UI explicitly says that these record external actions: SOWLedger does not email the invoice or process payment.
- Invoices have an isolated authenticated printable HTML view at `/api/invoices/[invoiceId]/print`. It includes that invoice's entries, rates, total, dates and digest, escapes all customer-entered HTML, and has no app navigation. Print/save-PDF is user-initiated. Client entitlement checks apply to the print view as well as the details endpoint.
- The client portal hides drafts until marked sent and displays the actual work descriptions, people, dates, net hours, rates, amounts, planned work and change history. The approval button appears only after details load, and requires an explicit review checkbox.
- `POST /api/client/signoff` now requires `{ invoiceId, digest }`. It compares the reviewed digest with a current repeatable-read snapshot, rejects stale reviews, and stores the complete approved snapshot plus digest in the existing signed audit JSON in the same transaction. Same-version repeats are idempotent. Approval audit events are excluded from the proof hash to avoid self-invalidating approvals and recursive snapshots; all proof arrays use stable ordering.
- Both clients and workspace members can see the approved digest. `/proof-pack?approved=true` and `/print?approved=true` return the historical reviewed version. Legacy signoffs without a digest and snapshot are not presented as verified version approvals.
- Analytics exclude unavailable, external-calendar, OOO, busy and canceled blocks from planned hours, missed blocks and the utilization denominator. Proof-pack planned hours use the same exclusion rules.

## Verification

All authenticated test writes used the controller-provisioned disposable Neon branch `codex-sowledger-repair-20261009` (`br-silent-fog-ahwcl7b4`) and local app server on port 3008. The test fixture suite explicitly skips authenticated writes unless `SOWLEDGER_TEST_DATABASE=true`; the wrapper validates the disposable branch and supplies credentials only to child-process memory.

- **Focused Playwright:** `tests/workflow-repairs.spec.ts`, Chromium, **5 passed in 12.4 seconds** on the final run. Includes a real client-portal browser review/checkbox/approval flow, not just API calls.
- Coverage includes invalid-batch rollback, duplicate IDs, member restrictions, foreign-workspace denial, send-back/resubmit, concurrent approval and invoice creation, protected statuses, legacy invoicing guard, unchanged and edited paused durations, explicit clearing, atomic split totals, invoice lifecycle validation, client entitlement and draft hiding, stale-digest rejection, idempotent persisted snapshots, unchanged digest after approval, historical retrieval, escaped standalone printing, report exclusions and paginated/filterable lists.
- Scoped ESLint across all changed workflow routes, owned screens, helper files and the new test: **passed**.
- `npx tsc --noEmit --incremental false`: **passed** on the combined tree at verification time.
- `git diff --check`: **passed**.

## Boundaries and remaining controller checks

- The controller owns the full production build, full shared test suite, `agentic:check`, independent review, broader mobile/desktop visual checks and any release. No build or deployment was run by this package.
- Provider delivery, email delivery, QuickBooks behavior and payment collection were not tested or claimed. General webhook routing is implemented, but third-party receipt was not proven by these tests.
- Existing shared tests need the new client contract: mark drafts as sent, load the proof digest, and send it with signoff. Invoice status conflicts now return 409. The controller is updating those tests.
- The stored timer model has aggregate excluded seconds rather than exact historical pause intervals. Timestamp edits preserve that aggregate; they cannot reconstruct when each break happened.
- A later change to invoice details, including status or supporting project/audit data, changes the current proof digest. The previous approved snapshot remains available and is clearly labeled as a previous version; approval is never silently transferred to changed details.
- The legacy `/api/timer/invoice` endpoint remains an entry-only invoicing marker for compatibility. The Invoices screen uses `/api/invoices` to create actual invoice records.

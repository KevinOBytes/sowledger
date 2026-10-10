# Interface repair report — October 9, 2026

## Implemented

- Corrected the shared workflow links: Track opens `/dashboard`, Review opens `/reports`, and Integrate opens `/integrations`.
- Put the focused timer immediately after the dashboard header. Setup, overview cards, and workflow shortcuts are now in a collapsed section below the working area. Every dashboard “Schedule work” button opens the form, scrolls it into view, and focuses its title field.
- Shortened dashboard, navigation, calendar, integration, manual-time, and Activity copy. Removed repeated product slogans and implementation language from these screens.
- Added Notifications and a pinned Sign out action to mobile More. Integrated the controller's workspace switcher in desktop navigation and mobile More.
- Reduced calendar header duplication, moved Google Calendar sync below the calendar in a disclosure, and collapsed reminder details and working-hour settings. The calendar grid has a bounded scroll area. Phones default to a single-day view with tap-to-schedule; desktop week/team/month views and drag/resize controls remain available.
- Successful Google Calendar sync emits `sowledger:calendar-updated`. Calendar and dashboard listen and reload their data. Calendar uses the shared unavailable-block guard, including imported external-calendar blocks.
- Dashboard, Calendar, and Activity now show a safe visible failure message and retry action when their main data request fails. They do not replace a failed request with a successful empty-state message. Dashboard consumes timers, scheduled work, and form choices independently: a project, rate, or schedule failure cannot hide Stop/Pause controls or falsely imply the schedule is empty. Request sequencing prevents an older refresh from overwriting newer timer state. Network failures in the dashboard's timer/schedule actions also produce a retry-oriented message.
- Activity uses 25-entry pages, next/previous controls, date and status filters, matching-entry totals, individual submission/resubmission, and a “Submit page for approval” action. Only completed draft entries appear as submittable; sent-back entries are draft entries with a rejection reason. Running, approved, and invoiced entries do not expose submission controls.
- Manual-time dialogs have a viewport-bounded, scrollable form with fixed header/footer controls, Escape handling, focus containment, and focus restoration. Their layer, the calendar composer and block-action/selection layers, and the mobile drawer now sit above the cookie notice so the notice cannot intercept their controls. Clearing notes sends `description: ""`; clearing the project sends `projectId: null`. Unchanged timestamp fields are omitted, preserving original seconds and recorded breaks. The duration preview uses the recorded net time, and unchanged entries shorter than one minute can be corrected.
- Completing a calendar block uses the current form's work-rate choice, including a changed rate. Calendar completion and dashboard scheduled manual logging send `actionId: ""` when the user clears the scheduled rate. This intentionally uses the existing manual API contract; omitted or null rates inherit from the scheduled block. No backend semantics were changed by this package.
- Preserved the controller's timer start/stop `sowledger:time-saved` events and regression for navigating to Activity while a stop request is still saving.

## Interface contracts

- Activity reads `GET /api/timer/list` with `limit`, `offset`, optional `from`/`to` ISO timestamps, and optional `status`. It consumes `entries`, `total`, and `hasMore`. The backend package owns validation, workspace scoping, and the `rejected` filter.
- Submission posts `{ entryIds: string[] }` to `/api/timer/submit` and consumes `{ ok: true, submitted: number }`. Authorization and transactional mutation remain in the backend package.
- Editing keeps the existing `/api/timer/edit` endpoint and adds no client-side authorization assumptions.

## Verification

Passed scoped ESLint for the eight owned UI files and `tests/workflow-interface.spec.ts`. `git diff --check` also passed. No build, server, production database mutation, commit, or deployment was run by this package.

The focused Playwright suite in `tests/workflow-interface.spec.ts` now contains fifteen tests covering dashboard ordering/form focus and rail routes; phone manual controls and account navigation; phone day scheduling and block-action clicks with the cookie notice present; dashboard/calendar/Activity error recovery; continued timer control during auxiliary failures; calendar rate replacement and clearing; dashboard scheduled-rate clearing; Activity pagination/filter parameters; eligible approval submissions; explicit clearing and break-preserving timestamp omission; sub-minute edits; refresh after calendar sync; and the controller's delayed-stop-to-Activity regression.

These tests require `SOWLEDGER_TEST_DATABASE=true` before their test-login fixture runs. Ran them through `scripts/with-test-database.mjs` against the controller-validated disposable branch `codex-sowledger-repair-20261009` (`br-silent-fog-ahwcl7b4`) and the controller's existing local server. The latest complete run of `npx playwright test tests/workflow-interface.spec.ts --project=chromium --reporter=line` passed **15 of 15 tests in 29.8 seconds**. The fixtures created test-only records in that isolated branch. Rate-change/clearing checks use the real API and verify returned persisted entries; the auxiliary-failure check pauses and stops a real timer while mocking failed project/schedule reads. Other tests mock API responses to verify client behavior and contract payloads; those tests do not establish backend authorization, live Google provider delivery, or production readiness. Phone checks used 390-pixel Chromium viewports, not a physical phone or Safari.

The initial browser pass identified the cookie notice overlapping the manual dialog; that application defect was fixed. Follow-up failures were test-only exact-label selectors and desktop mouse hover pausing a toast in the simulated phone viewport; the tests now use accessible combobox names and wait for toast removal without hovering it. The independent-review pass additionally corrected the timer partial-load coupling, scheduled-rate selection, and calendar action layers. Its first test run passed 14 tests; the phone cancellation assertion had incorrectly expected PATCH instead of the existing DELETE endpoint. Correcting that test assertion produced the final 15-test pass.

The combined production build and full cross-package regression suite remain the controller's responsibility. The controller owns shared-test copy/disclosure updates and the later compact mobile workflow rail; those changes were preserved.

## Files owned by this package

- `components/app-page-shell.tsx`
- `components/sidebar.tsx`
- `components/timer-dashboard.tsx`
- `components/calendar-view.tsx`
- `components/calendar-integration-panel.tsx`
- `components/manual-time-dialog.tsx`
- `app/(app)/activity/page.tsx`
- `app/(app)/calendar/page.tsx`
- `tests/workflow-interface.spec.ts`
- This report

Changes from the other repair packages were left in place. No unrelated work was reverted.

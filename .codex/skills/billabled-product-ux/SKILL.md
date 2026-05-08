---
name: billabled-product-ux
description: Use when changing Billabled planning, timer, manual time, calendar, activity, analytics, exports, or navigation UX.
---

# Billabled Product UX

## Overview
Every product change should reinforce the connected workflow: plan work, track live timers, log manual or calendar time, review analytics, approve or export, then integrate by API.

## UX Checks
- Dashboard exposes today's plan, focused timer, concurrent timer stack, and manual logging.
- Calendar behaves like a scheduling surface: drag empty time to create blocks, resize/move blocks, duplicate or move to next open slot, log completed time, mark unavailable time, edit/reschedule/cancel planned blocks, and start timers from planned blocks.
- Calendar pages must give the grid a reachable working area. Do not stack fixed-height headers above the calendar in a way that clips slots below the viewport.
- Calendar time labels use the browser timezone; when the account/workspace timezone differs, show the account timezone as a secondary cue instead of implying converted labels.
- Imported external calendar busy/unavailable blocks should prevent scheduling conflicts but must not trigger work-start reminders.
- Activity makes corrections and status/source review obvious.
- Analytics includes clear scope, date range, planned vs actual, manual vs timer, billable output, and export action.
- Exports provide complete and filtered CSV/JSON with project/date/user/status/source filters.
- Integrations exposes calendar sync, Slack alerts, QuickBooks invoice push, and API/webhook fallbacks from one obvious center.
- Developers exposes API keys, scopes, usage, and support docs.

## Design Rules
- Keep the warm light operational design system: `#f6f3ee`, white rounded panels, slate hierarchy, cyan as the functional accent.
- Use one primary action per page header and make secondary actions visibly lower priority.
- Replace blank states with next-step empty states.
- Preserve mobile access to start/stop timers, log time, navigate calendar/activity, export, and settings.

## Validation
Use browser or Playwright coverage for changed workflows. For calendar changes, verify drag-create, planned block creation, completed time logging, edit/reschedule/cancel, duplicate or next-slot movement, and start timer from planned block.

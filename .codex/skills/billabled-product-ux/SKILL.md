---
name: billabled-product-ux
description: Use when changing Billabled planning, timer, manual time, calendar, activity, analytics, exports, or navigation UX.
---

# Billabled Product UX

## Overview
Every product change should reinforce the connected workflow: plan work, track live timers, log manual or calendar time, review analytics, approve or export, then integrate by API.

## UX Checks
- Dashboard exposes today's plan, focused timer, concurrent timer stack, and manual logging.
- Calendar behaves like a scheduling surface: click a day, create planned work, log completed time, edit/reschedule/cancel planned blocks, start timers from planned blocks.
- Activity makes corrections and status/source review obvious.
- Analytics includes clear scope, date range, planned vs actual, manual vs timer, billable output, and export action.
- Exports provide complete and filtered CSV/JSON with project/date/user/status/source filters.
- Developers exposes API keys, scopes, usage, and support docs.

## Design Rules
- Keep the warm light operational design system: `#f6f3ee`, white rounded panels, slate hierarchy, cyan as the functional accent.
- Use one primary action per page header and make secondary actions visibly lower priority.
- Replace blank states with next-step empty states.
- Preserve mobile access to start/stop timers, log time, navigate calendar/activity, export, and settings.

## Validation
Use browser or Playwright coverage for changed workflows. For calendar changes, verify day-plus composer, planned block creation, completed time logging, edit/reschedule/cancel, and start timer from planned block.

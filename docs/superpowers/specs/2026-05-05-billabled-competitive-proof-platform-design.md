# Billabled Competitive Proof Platform Design

## Goal

Turn Billabled from a credible time tracker into a proof-backed billing platform for service teams that need to recover missed billables, defend invoices, prevent retainer leakage, get client sign-off, and integrate trusted billing data into agency systems.

## Positioning

Billabled should sell as "proof-backed billing operations" rather than "time tracking." The first buyer is a small agency, consultancy, or technical services shop that already tracks time somewhere but loses revenue through missed work, scope drift, client disputes, weak approval trails, and disconnected operational systems.

## Scope

This implementation ships a practical MVP of five connected product surfaces:

1. Invoice Proof Pack: every generated invoice has a structured proof endpoint and UI affordance showing invoice totals, linked time entries, source mix, planned vs actual coverage, audit events, and export digest.
2. Retainer Leak Radar: analytics identifies projects with budget or retainer risk, unbilled approved time, effective rate pressure, missing rates, missed planned work, and suggested actions.
3. Client Sign-Off Portal: client users can review invoices and submit sign-off events that are recorded in the workspace audit trail without granting internal workspace controls.
4. Missing Billable Recovery: reports surface scheduled work that ended without linked completed time, billable entries missing rates, approved-but-uninvoiced work, and manual/calendar/timer gaps.
5. Developer and Agency Integration Layer: API v1 exposes proof packs and revenue intelligence using scoped API keys, usage tracking, and explicit docs.

The marketing homepage must be rebuilt around this competitive story and make these five capabilities first-viewport or near-first-viewport signals.

## Architecture

Add two focused server modules:

- `lib/invoice-proof-pack.ts` builds proof-pack data for one invoice or client portal views. It owns digest calculation, invoice-entry joins, source breakdown, planned vs actual totals, and audit event projection.
- `lib/revenue-intelligence.ts` builds workspace revenue-risk and billable-recovery summaries. It owns project risk scoring, unbilled value, missing-rate detection, missed planned work, and action recommendations.

Expose the modules through narrow routes:

- `GET /api/invoices/[invoiceId]/proof-pack` for authenticated app users with member access.
- `GET /api/revenue-intelligence` for authenticated app users; team scope requires manager.
- `POST /api/client/signoff` for client users to sign off on invoice proof.
- `GET /api/v1/proof-packs` and `GET /api/v1/revenue-intelligence` for API-key integrations with `read:invoices` and `read:analytics`.

No new database table is required for the first pass. Client sign-off is recorded as an `audit_logs` event with `timeEntryId` set to the invoice ID. This keeps the change small, workspace-scoped, exportable, and compatible with the current audit export model.

## Product Data Flow

Invoice creation marks selected approved time entries as invoiced. A proof-pack request loads the invoice, verifies workspace scope, loads linked time entries, projects, users, scheduled blocks, and audit logs, then returns a sanitized proof object plus a SHA-256 digest header. The client portal uses the same invoice list and records sign-off as an audit event. Revenue intelligence loads projects, invoices, time entries, and scheduled blocks for the requested date range, then derives risk cards and recovery opportunities without mutating data.

## UI Design

The internal Invoices page should move from simple invoice printing to a proof workflow:

- The approved billables pipeline stays.
- Issued invoices show Proof Pack, client status, amount, and supporting facts.
- A proof drawer or expanded panel can fetch and display digest, entries, source mix, audit events, and export action.

The Analytics page should add a Revenue Intelligence section above or near the existing charts:

- Retainer Leak Radar cards with severity, project, risk reason, value at risk, and next action.
- Missing Billable Recovery cards for unlinked schedule blocks, missing rates, approved-but-uninvoiced value, and stale drafts.

The Client Portal should show invoices as approval-ready packets with amount, proof digest when available, and an "Approve proof" action that records sign-off.

The Developers page and public API docs should advertise proof packs, revenue intelligence, scoped keys, webhooks, usage tracking, and digest-backed exports as the agency integration layer.

The marketing homepage should be rewritten around the competitive value proposition:

- Hero: "Recover revenue. Prove every invoice."
- First visual: pipeline from Plan -> Track -> Recover -> Prove -> Sign off -> Integrate.
- Feature bands for proof packs, leak radar, sign-off portal, recovery, and integration.
- Pricing stays flat per workspace using existing internal plan IDs.

## Security

Every route must require session or API-key authentication appropriate to its surface. All DB reads and writes must be scoped by `workspaceId`. API-key routes must use existing usage tracking. Proof pack responses must not expose API key secrets, webhook secrets, raw IP hashes, or unrelated workspace records. Client sign-off must only accept invoice IDs in the current client user's workspace and must not allow clients to mutate invoice amount, status, billing, invites, API keys, or workspace administration.

## Error Handling

Missing invoices return 404. Missing scopes return 403. Unsupported sign-off payloads return 400. Proof-pack and revenue-intelligence routes return empty arrays rather than failing when a workspace has no invoices, projects, schedule, or time entries. Digest generation is deterministic for the returned JSON payload.

## Testing

Add focused coverage for:

- Proof-pack route returns linked invoice evidence and `x-billabled-proof-sha256`.
- Revenue-intelligence route returns risk/recovery structures without leaking other workspaces.
- API v1 resources require scoped keys and expose proof/revenue endpoints.
- Client portal renders sign-off controls.
- Marketing homepage renders the new competitive feature set.

Run the repo gate after implementation: `npm run lint`, `npm run build`, `npx playwright test --project=chromium`, and `npm run agentic:check`.

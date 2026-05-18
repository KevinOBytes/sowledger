# API Outline

## Auth
- Session auth for dashboard access.
- API tokens (scoped, hashed at rest) for programmatic access.

## Planned Endpoints
- `POST /api/uploads` — request signed upload URL + create scan record.
- `POST /api/scans/:id/start` — enqueue scan job.
- `GET /api/scans/:id` — scan status + summary.
- `GET /api/findings` — paginated findings with filters.
- `GET /api/exports/findings.csv` — CSV export for filtered findings.
- `POST /api/webhooks/test` — test webhook delivery.

## Event Types
- `scan.queued`
- `scan.started`
- `scan.completed`
- `scan.failed`
- `finding.critical_detected`

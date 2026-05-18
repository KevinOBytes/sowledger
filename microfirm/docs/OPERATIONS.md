# Operations

## Environments
- Local: Docker Compose for Postgres + optional worker.
- Staging: Vercel preview + staging DB/storage.
- Production: Vercel + managed Postgres + containerized workers.

## Routine Jobs
- CVE feed refresh schedule (daily minimum).
- Artifact retention cleanup.
- Failed-job retry with capped backoff.

## Observability
- Track queue depth, scan latency, error rate, and webhook delivery success.
- Alert on sustained worker failures and high critical-finding rates.

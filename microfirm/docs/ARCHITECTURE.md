# Architecture

## High-Level System
1. Next.js web app handles auth, uploads, findings UI, exports.
2. Postgres stores workspace, firmware metadata, scan jobs, findings.
3. Object storage (R2/S3 compatible) stores encrypted/private binary artifacts.
4. Background worker (Python) fetches artifacts, runs analysis, writes findings.
5. Webhook subsystem sends signed event notifications.

## Data Flow
- User uploads firmware -> API validates -> artifact stored -> scan job queued.
- Worker consumes job -> extracts indicators/components -> CVE/pattern analysis.
- Findings persisted with severity + references.
- UI polls/streams status and renders remediation guidance.

## Deployment Topology
- Vercel: Next.js app and API endpoints.
- Container service: Python workers and optional queue processors.
- Managed Postgres (Neon preferred for Vercel integration).

# REQUIREMENTS.md

## Product
**Automated Firmware Vulnerability Scanner** for hardware enthusiasts and small IoT manufacturers.

## Core Jobs To Be Done
1. Upload firmware binaries safely.
2. Automatically scan binaries for known CVEs and insecure patterns.
3. Deliver prioritized findings with remediation guidance.
4. Export scan history and findings for compliance/incident workflows.

## Functional Requirements
- User authentication and organization/workspace support.
- Binary upload with size/type validation.
- Asynchronous scan pipeline with queue + worker model.
- CVE matching against regularly updated vulnerability sources.
- Pattern detection for insecure embedded practices (hardcoded creds, unsafe crypto use markers, outdated libraries where detectable).
- Findings dashboard with severity filters and scan history.
- CSV export of findings and scan summaries.
- Webhook notifications for scan completion and high severity findings.

## Non-Functional Requirements
- Tenant isolation for all persisted records.
- Private artifact storage using signed URL access.
- Encryption in transit and at rest for sensitive metadata.
- Auditable event logs for uploads, scans, and exports.
- Reliable operation on Vercel + managed Postgres + R2/S3-compatible storage.

## Preferred Technology
- TypeScript, Python, PostgreSQL, Drizzle, Tailwind CSS, ESLint.
- Docker support for worker/runtime portability.

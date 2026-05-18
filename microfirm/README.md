# Microfirm

Automated Firmware Vulnerability Scanner — a micro-SaaS that analyzes uploaded binary blobs for known CVEs and insecure coding patterns.

## Who it's for
- Hardware enthusiasts shipping hobby firmware.
- Small IoT manufacturers without full in-house AppSec teams.

## What it does
- Secure firmware upload and storage.
- Automated vulnerability scanning.
- CVE-linked findings with severity and remediation suggestions.
- Exportable reports and webhook-driven notifications.

## Planned Stack
- **Frontend/API:** Next.js + TypeScript + Tailwind CSS.
- **Database:** PostgreSQL (Neon or Docker-hosted Postgres).
- **ORM:** Drizzle.
- **Object Storage:** Cloudflare R2 / S3-compatible.
- **Worker Pipeline:** Python scanning worker(s).
- **Hosting:** Vercel for web, Docker/container service for workers.

## Repo Documentation
- `REQUIREMENTS.md`: product and technical requirements.
- `FEATURES.md`: tracked feature checklist aligned with requirements.
- `DESIGN_GUIDE.md`: product and UX design standards.
- `docs/`: architecture, security, APIs, operations, and testing notes.
- `AGENTS.md`: engineering/agent workflow rules.

## Initial Milestones
1. Scaffold Next.js + TypeScript app and auth.
2. Implement secure firmware upload and metadata persistence.
3. Build async scanning pipeline and CVE matching integration.
4. Ship findings dashboard and CSV export.
5. Add webhook notifications and audit logs.

## Development Conventions
- Prefer TypeScript over JavaScript.
- Use ESLint and keep dependencies updated.
- Keep docs (`README.md`, `/docs`, `FEATURES.md`) updated in every meaningful change.
- Prioritize secure-by-default design and tenant isolation.

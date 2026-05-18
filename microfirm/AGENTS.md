# Microfirm Agent Instructions

This repository is **Microfirm**, an Automated Firmware Vulnerability Scanner micro-SaaS.

## Product Statement
Microfirm analyzes uploaded firmware binaries to detect known CVEs, vulnerable components, and insecure binary patterns. Primary customers are hardware enthusiasts and small IoT manufacturers that need lightweight, actionable firmware security checks.

## Platform Defaults
- Primary app stack: **Next.js (App Router) + TypeScript + Tailwind CSS**.
- Primary database: **PostgreSQL** (prefer Neon for Vercel-hosted production).
- ORM: **Drizzle ORM**.
- Storage: **Cloudflare R2 (S3-compatible)** or equivalent S3-compatible storage.
- Hosting: **Vercel** (default) or Docker-based service deployment.
- Background scanning workers: Python-based analysis pipeline where needed.

## Engineering Rules
- Use TypeScript instead of JavaScript for new runtime code unless tooling constraints require otherwise.
- Prefer built-in and existing dependencies. Add new imports/packages only when they save substantial implementation time or provide major necessary capabilities.
- Keep dependency versions current and avoid deprecated packages.
- Keep security controls explicit, verifiable, and testable.
- Do not expose secrets in code, logs, snapshots, or documentation.

## Security Baseline
- Enforce strict tenant/workspace isolation at the query layer.
- Treat uploaded firmware blobs as untrusted input; validate size/type and quarantine for scanning.
- Use signed URLs and private buckets for firmware artifacts.
- Hash and redact sensitive tokens in logs and API responses.
- Verify webhook signatures for all third-party callbacks.
- Apply rate limiting and audit logging to authentication and upload endpoints.

## Docs & Process
- Update `README.md` and `/docs` whenever behavior, architecture, or workflow changes.
- Keep `FEATURES.md` aligned with `REQUIREMENTS.md`.
- Keep these files aligned as agentic sources:
  - `AGENTS.md` (source of truth)
  - `CLAUDE.md`
  - `.github/copilot-instructions.md`
  - `.cursor/rules/microfirm.mdc`

## Validation
Before marking work complete, run the narrowest relevant checks plus core gates when available:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

If any command cannot run, document why and what residual risk remains.

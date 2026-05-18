# Security

## Core Controls
- Tenant isolation on every query.
- Signed URL upload/download for private artifacts.
- Strict file validation (size, type, extension mismatch checks).
- Virus/malicious content gate before deeper processing.
- Webhook signatures and replay-window verification.

## Secret Management
- Secrets only in server environment variables.
- No secret material in client bundles, logs, or exports.
- Rotate keys regularly and track last-used metadata.

## Audit & Compliance
- Log upload attempts, scan execution start/finish, export events, webhook deliveries.
- Retain minimal sensitive metadata; redact payloads where possible.

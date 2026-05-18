# Testing Strategy

Focus on major risk paths first.

## Priority Test Areas
1. Upload validation and storage permissions.
2. End-to-end scan pipeline from upload to persisted findings.
3. Authorization and tenant isolation.
4. Export schema integrity (CSV columns and escaping).
5. Webhook signature generation/verification.

## Recommended Commands (once app scaffold exists)
```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

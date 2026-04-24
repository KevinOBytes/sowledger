# Agentic Project Files

This directory explains the AI-agent guidance checked into Billabled.

## Source Of Truth
- `AGENTS.md`: root project rules for all coding agents.
- `CLAUDE.md`: delegates Claude-style agents to `AGENTS.md`.
- `.github/copilot-instructions.md`: delegates GitHub Copilot to `AGENTS.md`.
- `.cursor/rules/billabled.mdc`: delegates Cursor to `AGENTS.md`.
- `.codex/skills/*/SKILL.md`: repo-local Codex skill drafts for Billabled-specific work.

## Codex Skills
The `.codex/skills` files are versioned project-local skill drafts. They are intentionally kept inside the repo so changes can be reviewed. If you want them globally active in a local Codex setup, copy or symlink the skill directories into the configured Codex skills directory for that machine.

## Check
Run:

```bash
npm run agentic:check
```

The checker verifies required files, skill frontmatter, delegation files, and key safety phrases.

# CLAUDE.md

@AGENTS.md

The project-wide rules are imported above. Keep this file limited to Claude
Code mechanics; anything another agent must know belongs in `AGENTS.md`.
Imports consume the same launch context as inline text, so CI guards the
combined size of both files.

## Claude Code mechanics

- Use beads (`bd`), not TodoWrite, for project work. TodoWrite is acceptable
  only as scratch sequencing that will not outlive the current turn.
- `/verify` (`.claude/skills/verify/SKILL.md`) drives the production app with
  the MCP Playwright browser, including the service-worker path and a working
  SwiftShader WebGL2 context. Prefer it to a one-off browser script.

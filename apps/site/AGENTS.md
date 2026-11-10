# Agent Rules (AGENTS.md)

AI agents (Antigravity, Claude Code, Cursor and others) working in this repository must follow these rules:

## Site content rules

- **The monorepo root is the source of truth.** Every feature description, install and deployment guide, data migration guide and changelog on this site (`apps/site`) **must be based entirely on the actual code and documentation at the root of the current Ponder repository** (such as the root `README.md`, `docs/*`, and the actual component and API implementations), and be extracted and generated from them.
- **Check before you update.** Before changing the site's content, blog or feature list, an agent must first read the latest code and documentation at the repository root, so the site does not drift from the real version of the project.
- **No fabricated or placeholder content.** Never write fictional content that is unrelated to `ponder` or does not match its current state (including generic template placeholders). Every technical detail shown to users must be true and reliable.
- **Keep documents consistent.** If the root Cloudflare deployment protocol (`docs/agent-deploy-cloudflare.md`) or migration guide (`docs/evernote-migration-guide.md`) changes, the matching blog posts and documentation pages on the site must be updated at the same time so they stay strictly consistent.

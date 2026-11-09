# The repo is public (Nov 8, 2026)

Caleb made `calebwang26/homecookd` public on Nov 8, 2026 so GitHub Actions minutes are unlimited (the private-repo
budget ran out twice). Before the flip, two scans of all 1217 commits (gitleaks, and a grep for Cartesia, Anthropic,
Google, AWS, JWT, Vercel and GitHub key shapes) found no live key: only test fixtures, documentation examples, a
Next.js build cache from Oct 21 and node_modules.

**Why:** no more spending on Actions, and nobody is expected to read the repo.

**How to apply:** everything tracked is readable by anyone. Never commit the reviewer link, a family code, phone
numbers, family members' personal details, keys or `.env` values. Gitignored files stay untracked
(`docs/build/.test-family-link`, `.env`, `app/.env`). Workflows must not use `pull_request_target` (fork PRs run
without secrets). Branch protection on `main` still requires a PR.

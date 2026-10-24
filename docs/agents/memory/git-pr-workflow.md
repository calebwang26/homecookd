---
name: git-pr-workflow
description: Ship code to GitHub as a pull request into main (no direct pushes or merges to main) so nothing conflicts with other merges
metadata:
  type: feedback
---

On 2026-10-16 Caleb asked for a PR instead of a direct push: "create a pr to the github - i dont want it to conflict with any other merges".

**Why:** several sessions work on this repo at once (for example, the "Domain connection setup" session also edits web/). Merging straight into main risks clobbering their work.

**How to apply:**
1. Commit on the working branch, usually `lander`.
2. Bring main in with `git fetch` and merge origin/main into the branch, so the PR merges cleanly.
3. Push the branch and open a PR to main with `gh pr create`.
4. Check that `mergeStateStatus` is CLEAN.

Never push to or merge into main directly unless he asks. GitHub now redirects the repo to calebwang26/EDIBLE-venturehacks; PR #2 was the first opened this way.

**Before committing (Caleb, Oct 17):** check with every other active Claude chat on this repo first (ListAgents; their worktrees are under `.worktrees/`) so nothing merges wrong or contradicts. Compare changed files and the contracts between branches (links, params, shared config), agree on a merge order, and have later branches merge origin/main before their PR. Stage files by name, never `git add -A`: the tree often holds other sessions' files and Finder " 2" duplicates.

**Vercel checks:** project "edible" had Root Directory "." on Oct 17, so every git-triggered deploy failed (it builds at the repo root and trips on app/tsconfig.json). A red Vercel check is that setting until Caleb changes it to `web`, not the PR's code; confirm with a clean `npm ci && npm run build` of the PR's web/ folder. Earlier deploys went through the CLI from web/.

Related: [[brand-homecookd]]

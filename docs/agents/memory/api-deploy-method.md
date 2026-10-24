---
name: api-deploy-method
description: "How the Supabase `api` edge function gets deployed (no CLI/token; MCP inline; multi-file since v12)"
metadata:
  type: project
---

The `api` edge function (project qeiednrjkiyzbolkepbk) can only be deployed through the Supabase MCP `deploy_edge_function` with file contents inlined. No `supabase` CLI is installed and there is no access token on the machine; a from-disk deploy would need Caleb to `supabase login` himself.

Since v12 (Oct 18 2026, retention PRs #27–#33) the function is 10 modules: index.ts, retention.ts, plumbing.ts, time.ts, table.ts, recap.ts, cooking.ts, hearts.ts, tablePr.ts, recapPr.ts. A deploy missing any of them fails to boot. Use entrypoint `index.ts`, bare file names and verify_jwt false.

**Why:** the TS sources come to about 336 KB, which is too much to inline in one tool call. v12 deployed esbuild's per-file type-stripped output instead (`npx esbuild@0.24.0 f.ts --format=esm`, about 197 KB, same names and imports) through a fresh subagent. The full deno suite was run first against the transpiled files, with `deno test --no-check` in a scratch copy of supabase/.

**How to apply:**
- Before any deploy, confirm the live version with `list_edge_functions` and coordinate with the other app session ([[git-pr-workflow]]).
- After a deploy, run supabase/tests/two_sided_live.mjs, app/scripts/api-smoke.mjs and supabase/tests/retention_live.mjs. They need docs/build/.test-family-code next to them, so in a worktree, symlink it in temporarily and remove it afterwards.
- The repo moved to github.com/calebwang26/EDIBLE-venturehacks.

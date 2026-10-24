---
name: api-deploy-rules
description: "How the Supabase `api` edge function must be deployed (multi-file from the retention deploy on, main only, announce versions, live tests)"
metadata:
  type: project
---

The `api` edge function (project `qeiednrjkiyzbolkepbk`) is deployed through the Supabase MCP tool with verify_jwt=false. Two sessions deploy it: this one and the "App UI refresh" session (uds:/tmp/cc-socks/62169.sock). Agreed Oct 18 2026:
- Deploy only from merged main, never from a branch. Apply that release's migrations first.
- Run `node supabase/tests/two_sided_live.mjs` and `node app/scripts/api-smoke.mjs` after every deploy (plus `retention_live.mjs` once it exists). Send the other session the version number and results.
- v11 (Oct 18) = main 7fa3e66, the QA fixes.
- v12 (Oct 18, deployed by App UI) = main 9a4a4d5, retention #27–#33. It's 10 modules (index.ts + retention, plumbing, time, table, recap, cooking, hearts, tablePr, recapPr), uploaded as esbuild type-stripped output to fit one MCP call. Retention migrations and pg_cron jobs are live, and retention_live.mjs is now part of the post-deploy tests. Every deploy must send ALL 10 files, or the retention routes go down.

**Why:** both sessions edit index.ts. A deploy from a stale or partial tree silently overwrites the other's live routes.

**How to apply:** before any deploy, list `supabase/functions/api/` on main and include every file. Check the latest live version with get_edge_function or list_edge_functions, and confirm with the other session that no deploy of theirs is in flight.

Related: [[qa-build-list]], [[git-pr-workflow]]

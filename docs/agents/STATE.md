# homecookd: state of the project

Shared by every model and person working in the repo. Keep it true: every PR updates the sections it affects
and adds a line to the **Change log** at the bottom (see "Shared context protocol" in `AGENTS.md`). Where an
older note in `memory/` disagrees, this file wins.

## Repo

- GitHub: `calebwang26/homecookd` (formerly EDIBLE-venturehacks; old links redirect). Local:
  `~/Documents/GitHub/homecookd`.
- As of Oct 21, all 16 worktrees under `.worktrees/` are clean and fully merged
  into main, so they can be removed with `git worktree remove .worktrees/<name>` once Caleb agrees.
- Untracked files in the main checkout: `demo/*.png` (Expo Go QR codes and screenshots). These are Caleb's. Leave them alone.

## What's shipped

| Area | Status | Where |
|---|---|---|
| Recipe pipeline (video → recipe.json, play.mp4, voice.m4a) | Working, run by hand on the laptop. Phone uploads go through `worker.py` | `pipeline/`, `README.md` |
| Expo app, Hearth redesign | Shipped Oct 16; profile picker on every open | `docs/build/SPEC.md`, `docs/design/hearth-bible/` |
| Messages, voice notes, step questions, share links | Live in the `api` | `docs/build/API.md` |
| Two-sided sign-in: iMessage invite link, Sign in with Apple, Google | Shipped Oct 17 (PR #6); Google needs a dev build | `docs/build/FEEDBACK-OCT16c.md` |
| Lander: parent page by default, "Here to learn the recipes?" switches to the kid version | Shipped Oct 17 (PR #3) | `web/`, `web/src/lib/audience-gate.ts` |
| 29 of 30 synthetic-QA fixes | Shipped Oct 17–18 (PR #24); B15 is still waiting on Caleb's review | `docs/agents/memory/qa-build-list.md` |
| Retention "seven" + push plumbing + pg_cron | Shipped Oct 18 (PRs #27–#33) | `docs/build/RETENTION-*.md` |
| Rename Edible → homecookd in code and docs; Vercel project renamed `homecookd` | Oct 20 (PRs #35, #36) | |

## Live infrastructure

- **Supabase** project `edible`, ref `qeiednrjkiyzbolkepbk`. Edge functions:
  - `api` **v15** (last deployed Oct 20, by Salik, the CTO). Both Caleb's agents and Salik deploy it. Before you deploy,
    check with Caleb that Salik's work is merged and no deploy is in flight, so nobody overwrites the other's live routes.
  - `transcribe` v4.
  - The api has 10+ modules (`index.ts`, `retention.ts`, `plumbing.ts`, `time.ts`, `table.ts`, `recap.ts`, `cooking.ts`,
    `hearts.ts`, `tablePr.ts`, `recapPr.ts`, …). List `supabase/functions/api/` on main and deploy every file.
  - There's no `supabase` CLI or access token on this machine. Claude deployed through the Supabase MCP
    (`deploy_edge_function`, files inlined, esbuild type-stripped when too big). With Codex, either configure the
    Supabase MCP (`codex-mcp.toml`) or have Caleb run `supabase login` and deploy with the CLI.
- **Vercel** project `homecookd` → https://homecookd.app (fallback `edible-psi.vercel.app`). Root Directory must be
  `web`. A red Vercel check on a PR has usually meant that setting, not the code.
- **GCS** buckets `edible-media-*` (public, no listing) and `edible-uploads-*` (private), plus the Cloud Run upload signer. See `README.md`.
- **Hackathon (Oct 23–25), `docs/build/STACK.md`:**
  - **Convex** project "homecookd", preview deployment `hackathon` → https://grand-dragon-649.convex.cloud
    (HTTP routes on `.convex.site`). Track A is deployed: sign-in bridge, app functions, worker and voice routes,
    Muse photo note, Ink transcripts, Moss indexing. The demo family is seeded under the placeholder id
    `seed:demo` (`npx convex run seed:claim '{"supabaseFamilyId":"…"}'` points it at the real one). Env:
    CARTESIA, MOSS, MUSE, WORKER_SECRET, VOICE_SECRET. Redeploy with `--preview-name hackathon`, never
    `--preview-create`: that recreated the deployment and deleted `energized-starfish-920`.
  - **Moss** refuses writes: "usage limit has been reached; billing must be updated" (Oct 23). Indexing then
    fails softly and questions go to the cook. Once billing is fixed: `npx convex run worker:reindexMissing`.
  - **Supabase** `bsudybxsqvtwftsdmwmz` ("calhacks-touse") is this repo's own copy: tables, buckets and the demo and
    TEST families are seeded. The `api` isn't deployed yet and its secrets aren't set (needs a Supabase access
    token). Frozen otherwise.
  - **Keys** for Cartesia, Moss and Convex are in the root `.env` (gitignored); checks: `node scripts/check-cartesia.mjs`,
    `node scripts/check-moss.mjs`. Still needed: `ANTHROPIC_API_KEY` (in `.env`), a Muse Spark key, and the
    Cloud Run and Convex env copies.
  - **TestFlight** works (Apple developer account in place).

## Waiting on Caleb (launch blockers)

From `docs/build/LAUNCH-LINKS.md` and `API.md`:
- Apple bundle id + Team ID, then `node scripts/set-apple-ids.mjs`. That fills `APPLE_AUDIENCES`, the AASA file and
  `APP_BUNDLE_ID`. `homecookd.app/.well-known/apple-app-site-association` is 404 until then.
- Google OAuth client ids (GCP project `project-11b9fc8a-1108-4ea8-a3b`).
- `NEXT_PUBLIC_APP_STORE_URL` in Vercel, then the first TestFlight build (EAS config is in place).
- Security: remove `host.exp.Exponent` from `APPLE_AUDIENCES` and the `EXPO_GO_BUNDLE_ID` default once TestFlight works.
- `MADE_BY` on the website is empty (hidden) until Caleb provides it.
- About 20 smaller `TODO(caleb)` product decisions: `grep -rn "TODO(caleb)" docs app supabase web`.

## Current and next work

- **The hackathon build (top priority):** the four tracks in `docs/build/STACK.md` (A Convex core, B live voice
  service, C pipeline → Convex + Muse + Moss, D app on a dev build + TestFlight). Start with its "first 3 hours"
  checks.

- Kid usability follow-up (`docs/build/qa/kid-feedback-oct21.md`): section 1, the reported failures, is fixed in
  code (see the Change log) but not yet checked on a real iPhone in Expo Go. Section 2 (cooking journey): Caleb
  picked direction A with 14 notes (`docs/build/qa/kid-feedback-round2-oct22.md`, rule: `memory/declutter-first.md`);
  shipped in #41 (merged Oct 22, after a first iPhone test round). The short substeps and their timings are live
  in the GCS bucket's recipe.json files (Oct 22), as well as in the bundled copies.
  Saved family answers have no kid-facing place now (TODO(caleb) in FamilyNotes.tsx). Open decisions for Caleb:
  `docs/build/qa/kid-profile-taps-oct21.md` (should your own "You" face open "Who's in the kitchen?", Family
  sheet rows).

- The TestFlight launch path above, once Caleb supplies the ids.
- QA item B15 (dish card on the app's sign-in screen when a link opens it signed out). It only matters after TestFlight.
- The worker moving off the laptop (`README.md` "Known limits", PRD roadmap).

## Things Codex can't open

These are claude.ai links. Caleb can open them in a browser, and summaries are in `memory/`:
- Persona QA + build list (decisions db): https://claude.ai/artifact/4AWM9mkP3rhXzYUHMpHKBH. This work is done.
- Two-customer playbook: https://claude.ai/artifact/Hx5WQYFg5SmUzyVLJrxN9Z. The decisions are in `memory/dual-icp-playbook.md`.
- Retention scorecard: https://claude.ai/code/artifact/3d445765-fbf1-446e-9c01-355fe82aab43. The plan is in `docs/build/RETENTION-HANDOFF.md`.
- iOS app concepts canvas: https://claude.ai/artifact/8KhgmxrmfxShWb1WkikynN. The chosen design is in `docs/design/hearth-bible/`.

## Change log

Newest last. One line per PR: date · PR · who (Claude / Codex / Salik) · what changed · what's left open.
Before starting work, compare the last commit here with `git log origin/main` to spot unlogged pushes.

- Oct 20 · #35, #36 · Claude · Renamed edible → homecookd in code and docs; Vercel project is `homecookd`.
- Oct 18–20 · (no PR) · Salik · `api` went from v12 to v15; v15 was deployed from Salik's machine. v13–v15 aren't logged here, so diff main against the live function before the next deploy.
- Oct 21 · #37 · Claude · Codex handoff: root AGENTS.md and the shared state and memory folder.
- Oct 21 · #38 · Claude · One shared instructions file: CLAUDE.md now only imports AGENTS.md, and the old CLAUDE.md moved to docs/HACKATHON-SPEC.md. docs/handoff → docs/agents. Added the shared context protocol and this change log.
- Oct 22 · #42 · Claude · `web/`: Next.js and eslint-config-next 16.4.0 → 16.4.2 for the security advisories GHSA-2464-fhr4-w9xw (critical: image optimization RCE via SVG), GHSA-673q-mjm6-r5xr (critical: `use cache` RCE) and GHSA-p3m5-59mp-jv5r (high: Server Actions DoS). The live site is a static export with a custom image loader, no Server Actions and no `use cache`, so exposure was limited to local `next dev` servers. Nothing left open.
- Oct 22 · #39 · Codex + Claude · Kid QA Oct 21 section 1. Media: step clips show a spinner while loading more, time out after 30 s with a tap-anywhere retry, keep the photo until the video moves, and show paused when iOS pauses them (stalled, background); the Watch / Hear sheet keeps the player still while the words scroll; ±10 s buttons and a bar you tap or drag sideways (up or down scrolls the page) on video and audio; precise audio seeks; "Full video · 51:43" on the recipe vs "This step" on the cook clip; one voice at a time; cook screen back-swipe from the edge only (iOS 26). Profiles: Dad's sheet on "Who's in the kitchen?" acts as whoever is in (shared and lent phones were a dead end or switched to the owner). Open: check it all on a real iPhone; Caleb's decisions in `docs/build/qa/kid-profile-taps-oct21.md`.
- Oct 22 · #41 · Claude · Kid journey v2 (direction A + Caleb's round-2 notes, stacked on #39). Kid Home is a portal: fanned recipe deck, Start cooking (→ Recipes), Have a question about a dish (→ dish → person → chat); table row, I miss home, hero pick, invite and recap card cut from kid Home (Invite moved to the Ask tab; New message row cut). Recipes: Everyone first. Overview: the photo plays the full video, big time/servings, step list with solid green circles, ingredients as amount + name with check-off (Get these ready screen now redirects). Cook step: video on top with a range-limited full-screen player, Hear plays in place, 2-line substeps with tap-to-expand, this step's Ingredients, collapsed tip pill, story row only where one exists. Data: Step.substeps/uses/tip from new pipeline/shorten.py (Gemini, ~$7.50), written to app/assets/data and data/synthetic; app borrows them for bucket recipes until a republish. Open: iPhone check, bucket republish, saved family answers have no kid view (TODO(caleb)).
- Oct 22 · #41 · Claude · iPhone test round: videos no longer stop on their own (expo-audio's pause() ended the shared iOS audio session and stopped the video: the voice player now keeps the session; iOS 'not playing' while buffering shows a spinner instead of Paused); step video bar split into chapters at each substep; the substep being heard (or watched) is highlighted; Hear folds back to its bubble with ×; Home deck is a swipeable carousel of every recipe. Data: Substep.start_s for the 5 recorded recipes from new pipeline/align.py (Gemini Flash on each step's audio, ~$0.35). Open: align.py must re-run after shorten.py --force; background music may stay ducked after Hear (check on iPhone).
- Oct 22 · (no PR) · Claude · Uploaded the 10 recipe.json files with substeps/uses/tip and substep start_s to the GCS bucket (JSON only, no media or library change; previous copies backed up locally). Vercel production is main 862905f.
- Oct 22 · #44 · Claude · iPhone test round 3 (cook step + Home): pots show the current step (furthest stays in All steps and Continue at step N); All steps shows done steps as dark green with a light green check and not-done steps as light green with a dark green number; Hear removed from the cook step (the video carries the voice; stories still use it); tapping a substep plays the step video from that substep (and expands it); step order is title, video, substeps, ingredients, tip, story, Ask; Home label reads '1/10 recipes'. Open: iPhone check of the seek-on-tap.
- Oct 23 · #1 (hackathon-homecookd) · Claude · Hackathon stack from Caleb's PLAN.pdf: `docs/build/STACK.md` (stack, 2-day cuts, contracts, build order), `convex/schema.ts` (deployed to the preview), Cartesia/Moss/Convex keys in `.env` with checks in `scripts/`. Removed the Supabase `/voice/token` and `/moss/ask` routes (they no longer fit the plan). Repo pointed at its own Supabase project (fork session). Memory: hackathon-stack-oct23, testflight-live (replaces no-testflight-yet). Open: the four build tracks, Supabase api deploy + secrets, Muse and Anthropic keys.
- Oct 23 · #1 (hackathon-homecookd) · Claude · Hackathon Supabase project `bsudybxsqvtwftsdmwmz` is live: migrations, seed (demo + TEST family, fresh test code), api deployed, secrets and hourly cron set; two_sided 129, retention 61 and api-smoke 23 pass. Cartesia + Moss keys set in Convex env on `energized-starfish-920`. All keys now in one main-checkout `.env`; worktree copies are symlinks to it (AGENTS.md rule).
- Oct 23 · #2 (hackathon-homecookd) · Claude · Track A, Convex core (`convex/`):
  - **Sign-in bridge:** `sessions.start` checks the device key with Supabase `GET /family`, mirrors the family and
    returns a session token (only its hash is stored, 30 days). One `requireSession` check guards every public
    function.
  - **Functions and routes:** recipes, jobs, questions, messages, files and cooking from STACK.md; `http.ts`
    worker and voice routes.
  - **AI actions:** Muse Spark photo-note draft (`muse-spark-1.3`, nothing sent until the kid sends it); Cartesia
    Ink batch transcripts of voice-note answers; Moss indexing per family (JS SDK, external package).
  - **Seed and tests:** demo seed; 10 convex-test tests.
  - **Schema:** `cookingSessions.updatedAt`, `sessions.by_expiresAt`, `steps[].quote`.
  - **Deploy:** to `grand-dragon-649`, which replaced `energized-starfish-920` (`--preview-create` recreated
    it). Generated `WORKER_SECRET` and `VOICE_SECRET` into `.env` and set Convex env.
  - **Live checks:** a curl against every HTTP route; the worker flow from `queued` to `done`; Ink transcribed a
    spoken answer; Muse drafted a note.
  - **Open:**
    - Moss billing limit; nothing is indexed yet.
    - The bridge's success path was tested only in convex-test: `docs/build/.test-family-code` isn't recognised by
      the new Supabase project, so no live TEST-family device key.
    - The real demo family's Supabase id still needs `seed:claim`.

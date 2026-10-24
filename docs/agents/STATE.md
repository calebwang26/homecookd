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
    TEST families are seeded. The `api` is live at **v1** (deployed Oct 23, 21:21 PT, before `APP_BUNDLE_ID` was
    set in code), so the secret `APPLE_AUDIENCES=host.exp.Exponent,com.salik.homecookd` is what lets TestFlight's
    Apple sign-in through. The next api deploy from main has the same list built in. Frozen otherwise.
  - **Keys** for Cartesia, Moss and Convex are in the root `.env` (gitignored); checks: `node scripts/check-cartesia.mjs`,
    `node scripts/check-moss.mjs`. Still needed: `ANTHROPIC_API_KEY` (in `.env`), a Muse Spark key, and the
    Cloud Run and Convex env copies.
  - **TestFlight** works (Apple developer account in place). EAS project `ef88fb83-09cf-4c73-9684-de9a95a1f1ef`
    belongs to Salik's Expo account `salikm1234` (`owner` in `app/app.json`); bundle id `com.salik.homecookd`, Apple
    Team `73UV499FKN`. EAS commands must run signed in as `salikm1234` (or as a member of that project).
  - **App (Track D):** voice cooking, live job progress, live questions, photo note and glasses import call Convex
    and the voice service through `app/src/lib/live/` (one file each, with a stub until they're deployed). Needs an
    EAS dev build or TestFlight: Expo Go hides the mic. Public URLs: `EXPO_PUBLIC_CONVEX_URL` (in `eas.json`),
    `EXPO_PUBLIC_VOICE_URL` = wss://homecookd-voice-vyatb2n6oq-uw.a.run.app (Track B, Cloud Run; both in `eas.json`).
- **Voice service** (Cloud Run `homecookd-voice`, us-west1, project `project-11b9fc8a-1108-4ea8-a3b`): `wss://homecookd-voice-vyatb2n6oq-uw.a.run.app/cook`, revision `homecookd-voice-00001-p96`, min instances 1, timeout 3600 s, keys from Secret Manager, Convex `grand-dragon-649`. Deploy: `voice/deploy.sh` (Caleb runs it; agents are blocked from Secret Manager writes).

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
- Oct 23 · #4 (hackathon-homecookd) · Claude · Track A, Convex core (`convex/`):
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
- Oct 24 · #5 · Claude · Track D, the app (STACK.md): cook screen streams the mic as 16 kHz PCM (`@siteed/audio-studio`) to the voice service and follows `go_to_step`, `play_clip` (in the step's own player) and `say` ("AI voice" label, "I asked Mom"); parent Home shows the newest recording's live stage from `jobs.forFamily` and the kids' open questions with Hold to talk (`questions.answer`); the kid's postcard sends the photo to Convex and shows Muse's draft to edit (pots cut); Record has "From my glasses" (`source: "glasses"`). Convex and voice calls live in `app/src/lib/live/convex.ts` and `voice.ts`, each with a stub. `app/scripts/pcm-echo-server.mjs` is the first-hour mic test socket. EAS: `expo-dev-client`, `expo-updates`, a `development` profile, channels, Salik's project id; `scripts/set-apple-ids.mjs` run with `com.salik.homecookd` / `73UV499FKN` (AASA, api `APP_BUNDLE_ID`). TestFlight: build 3 (1.0.0, EAS build fc6ae05a, channel `production`) uploaded to App Store Connect app 6825621614 on Oct 24; `eas.json` now has the `ascAppId`, so `--auto-submit` works unattended. Open: the dev build needs Caleb's iPhone registered (`eas device:create`) and an interactive Apple sign-in; mic streaming not yet checked on a real iPhone; `EXPO_PUBLIC_VOICE_URL` once Track B deploys; the old TEST family code doesn't work on the hackathon Supabase, so the live sign-in smoke didn't run.
- Oct 23 · #3 · Claude · Track C (pipeline). Gemini still watches the video; Muse Spark (`muse-spark-1.3`, Standard mode, new `pipeline/writer.py`) now writes the recipe, stories and tips. Gemini is the fallback (`RECIPE_WRITER=gemini`, or automatic when Muse fails twice). `pipeline/worker.py` claims Convex jobs (`/worker/claim`, `/progress`, `/published` with `x-worker-secret`); the old GCS job files moved to `--gcs`. Convex jobs have no title, so Muse names the dish. New `pipeline/convex_stub.py` (local fake Convex) and `pipeline/Dockerfile` (Cloud Run job; built and import-checked, not deployed). A real 17-min upload took 10.0 min from queued to published through the stub. Then a real job on the live Convex (TEST family, `jobs.create` → worker → `done`) took 13.6 min; Convex saved the recipe (ready, 28 steps, 7 memories). Moss indexing failed there at first (Moss index limit), and the job still ends `done` by design. After a slot was freed, `moss:indexRecipe` re-indexed it: `family-<familyId>` now has 28 docs (28 steps; memories not shared), `mossIndexedAt` is set, and "how long do I cook the onions" returns timed steps. The top hit is the slicing step (224–240 s), with browning (404–465 s) second. The Moss project is now at 3 of 3 indexes. Open: Muse splits steps finer than Gemini did (27 vs 10 on the biryani), so the merge prompt may need tuning; cook mode's short steps (`shorten.py`) still use Gemini; deploying the Cloud Run job. Locally, `test_shorten.py` fails on the main checkout's old `data/out/chicken-biryani` (no substeps). It passes without local data.
- Oct 23 · #2 (hackathon-homecookd) · Claude · Track B live voice service in `voice/` (Node + TS): WebSocket `/cook` streams 16 kHz PCM to Cartesia Ink 2 (`/stt/turns/websocket`), plain commands skip the model, anything else goes to Claude (`claude-opus-5-5`, low effort, one tool per turn, Moss moments searched up front) and Sonic speaks the reply. Moss `@moss-js/moss` over `family-<familyId>`, Convex `/voice/*` calls with `x-voice-secret` and a stub until Track A ships them. Local test passes (next step; found question plays 440–700 s; unknown question → ask_cook) at ~1.1–1.6 s per question with fast mode. Protocol additions (`ready`, `say_end`, `transcript.final`, `text` input) are in `voice/README.md`. Open: run `voice/deploy.sh` (the agent's Secret Manager writes were blocked), `VOICE_SECRET` in `.env` + Convex env, `CONVEX_SITE_URL`, real Moss indexing (doc shape in `voice/src/moss.ts`).
- Oct 23 · #2 (hackathon-homecookd) · Claude · Voice service on Track A's live routes (`grand-dragon-649.convex.site`): `/voice/session` shape (`kid.personId`, `recipe.recipeId`, `recipe.cookName`, `mossIndex`), flat `found` on `/voice/question`, Moss hits use the stored `quote`, close 4404 for a recipe that isn't ready. The stub is now opt-in (`VOICE_STUB=1`). Checked live: our `VOICE_SECRET` is accepted and a bad token closes the socket with 4401. Open: a full live turn needs a real kid session token (writing a test session to Convex was blocked for the agent), Moss billing, and running `voice/deploy.sh`.
- Oct 24 · #12 · Claude · Track D: the app points at the live voice service (`EXPO_PUBLIC_VOICE_URL` in `eas.json` for every profile); close 4404 ("recipe not ready") stops voice with "Voice isn’t ready for this recipe yet." like 4401. Checked against Cloud Run: a bad token gets `{type:"error"}` + 4401. TestFlight build 3 was bundled without the URL, so its mic still talks to the local stub until an EAS Update (`EXPO_NO_DOTENV=1`, see PR) or a new build. Open: a full kid turn on a phone (Moss holds only Chicken Biryani for the demo family).
- Oct 24 · #11 (hackathon-homecookd) · Caleb + Claude · Voice service deployed by Caleb with `voice/deploy.sh`. It's revision `homecookd-voice-00001-p96`, `wss://homecookd-voice-vyatb2n6oq-uw.a.run.app/cook`, min instances 1, timeout 3600 s, all five keys from Secret Manager. Checked on the deployed URL: a bad token closes with 4401, which proves the Convex secret path works. The demo family index `family-j97246e6p81depk3fdydmmscp98gx2n8` loads in 2.5 s and queries take 3 ms; it holds only Chicken Biryani for now. Added `/health`, because Cloud Run's front end swallows `/healthz`; it takes effect on the next deploy. Added an `oil-question.wav` test line for Biryani. Sent the URL to Track D as `EXPO_PUBLIC_VOICE_URL`. Open: a full deployed turn needs a real kid session token.
- Oct 24 · #8 (hackathon-homecookd) · Claude · Removed `voice/scripts/seed-moss-test.ts`: Caleb deleted the Moss index `family-voice-test` to free a slot (the Moss plan allows 3 indexes per project). Don't create test indexes; test search on a real family's index. With `VOICE_STUB=1`, questions now go to the cook.
- Oct 24 · #10 · Claude · TestFlight's Continue with Apple answered "Apple sign-in isn't set up for this version yet": the live api on `bsudybxsqvtwftsdmwmz` (v1) predates `APP_BUNDLE_ID = "com.salik.homecookd"` and refused that audience (function logs). Set the edge-function secret `APPLE_AUDIENCES=host.exp.Exponent,com.salik.homecookd` in the dashboard; no code or app rebuild. Open: confirm on a TestFlight phone; drop `host.exp.Exponent` once Expo Go sign-in isn't needed.
- Oct 24 · #13 (hackathon-homecookd) · Claude · Demo prep for a Marathi-speaking cook. I deleted Moss index `family-j97246e6p81depk3fdydmmscp98gx2n8`, Track C's Biryani test on the TEST family, with Caleb's OK; only `homecookd-app` is left, and Convex recreates a family index on the next publish. Voice service: it ignores turns in a non-Latin script (Ink transcribed spoken Marathi accurately, in Devanagari) and non-commands while a clip plays, so Grandma's clip coming through the mic doesn't trigger a turn. After a clip that answers a question, the voice says "Grandma says: …" (`say.translation: true`): Claude translates only her quote, and it's spoken 0.5 s after the clip ends. Caleb's call, Oct 24. Takes effect on the next `voice/deploy.sh`. Open for the demo: the pipeline prompts assume English narration; `moss-minilm` is English-only, so the indexed text must be English; `convex/transcribe.ts` sends `language: en` for the cook's voice answers; stories are indexed only when `memoriesOptIn` is on.
- Oct 24 · #14 · Claude · Marathi voice-note answers: `convex/transcribe.ts` sends Ink the cook's `people.language` (new, an Ink code; unset = English) instead of a fixed `en`, and when it isn't English, Gemini (`gemini-3.8-flash`, `convex/lib/translate.ts`) adds `questions.answer.translation` next to the Devanagari `transcript`. The kid still gets the cook's own voice note (`answerAudioUrl`). `seed:language` sets a person's language. Checked: Ink batch on a Sonic Marathi clip gives English nonsense with no `language` or `en`, readable Devanagari with `hi` or `mr` (`mr` is in ink-whisper's list); the real code path took 0.5 s (Ink) + 1.6 s (Gemini) and the English was right. 2 new convex-tests (12 pass). Open: `GEMINI_API_KEY` isn't in Convex env yet (without it answers keep only the transcript); the demo cook needs `seed:language … mr`; Convex deploy; the kid's app doesn't show Convex answers at all yet (no `questions:forRecipe` reader), so the "Translated" label has nowhere to go.
- Oct 24 · #15 · Claude · Track D: a `say` with `translation: true` (Track B PR #13: the AI voicing the cook's Marathi clip in English) is labelled "Translated from Grandma" on the cook screen, never as the cook. Needs an EAS Update or build to reach TestFlight phones. Open: check on a phone once Track B deploys PR #13.
- Oct 24 · #16 · Claude · Pipeline for a cook who narrates in Marathi (or Marathi mixed with English), for the Oct 25 demo. `pipeline/prompts.py`: extraction writes every text field in English (step, feel, sensory cue, quote, stories, specials) and keeps the spoken Marathi of each quote in a new optional `quote_original` (Devanagari); the merge carries it, and align is told the audio may be Marathi and gets both. `pipeline/schema.py` adds `quote_original` (old recipe files and cached chunks without it still validate); `app/src/lib/types.ts` mirrors it. Convex keeps only the English (recipe.json in GCS holds the Marathi), and `convex/lib/mossDocs.ts` leaves Devanagari out of the searched text (`moss-minilm` is English-only); new `convex/mossDocs.test.ts`. Checked end to end on a 37 s Marathi narration synthesized with Cartesia Sonic (Gemini extract → Muse merge): all fields came back in natural English, each step's `quote_original` in Devanagari, the recipe validates; cost $0.07. Open: not yet run on a real recording of Grandma; Moss search not re-checked against a Marathi recipe (no free index to test on); stories keep only the English (no `text_original`).
- Oct 24 · #18 · Claude · Track D fix: Convex never got Caleb's TestFlight sign-in. Root cause: the live hooks (jobs.forFamily, questions.openForCook) read the person from the module snapshot `getSession()`, which SessionProvider publishes in an effect that runs after its children's; a sign-in sets the person and opens Home in one batched commit, so Home's effect saw nobody, `convexSession()` returned null and, with deps from the same stale snapshot, never ran again. Now the hooks take the person and credential version from `useSession()` and pass the profile id in, and retry `sessions.start` 3× (10 s). Logs: the phone's only `sessions:start` (06:46 UTC) carried an old Keychain device key from the original Supabase project (401 "This phone was signed out."), before Apple sign-in. Needs an EAS Update to reach TestFlight phones.

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
    `--preview-create`: that recreated the deployment and deleted `energized-starfish-920`. It has #37's memory
    fields (`step`, `id`, `title`, `why`), so the app can put a family dish's stories back. Last deployed Oct 24
    from main `f28173a1f` (Caleb's go): new indexes `dinnerInviteOpens.by_dinnerId_and_deviceId`,
    `dinners.by_inviteToken`, `swapRequests.by_otherFamilyId` and `swapRequests.by_requesterFamilyId`, and
    `POST /invite/open` live with CORS for homecookd.app.
  - **Worker** (`pipeline/worker.py`, Convex mode) runs on the laptop from `.claude/worktrees/worker-main` at main
    `4d703d9` (#39, started Oct 24 03:14), so family `recipe.json` files go out without stories or tips.
  - **Moss** works again (billing fixed Oct 24). One index is left: `family-j97ctx…` (the demo family: 4 recipes,
    50 docs). `homecookd-app` (a crawl of the lander that nothing used) and the TEST family's Biryani index were
    deleted with Caleb's OK. The free plan caps Moss at 3 indexes, one per family. Writes to each family's index
    now wait their turn (`families.mossSync`, live since the Oct 24 deploy of main `4f075ffac`); before that, two
    at once could silently drop a recipe.
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
- **Voice service** (Cloud Run `homecookd-voice`, us-west1, project `project-11b9fc8a-1108-4ea8-a3b`): `wss://homecookd-voice-vyatb2n6oq-uw.a.run.app/cook`, revision `homecookd-voice-00004-nv4` (deployed Oct 24 from main `f28173a1f`, Caleb's go: homie speaks as "Riya bilingual" with a Gemini TTS backup (#49), the kid's yes and no (#47), the Cartesia credit fixes (#44); `/health` ok, a bogus session is refused with 4401/401), min instances 1, timeout 3600 s, keys from Secret Manager, Convex `grand-dragon-649`. Deploy: `voice/deploy.sh` from merged main (an agent ran it for 00004 with Caleb's go).
- **App on TestFlight phones** (build 3, runtime 1.0.0): EAS Updates on channel `production`, built with `EXPO_NO_DOTENV=1` plus `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_VOICE_URL` set by hand (`eas update` doesn't read eas.json's build env; `FAMILY_CODE` must never ship): group `2f1b5298-3421-47c9-8913-35b95e216fd9` from main `f176b1d9b` (#33, #35, #36, #49), then `0b0e0b64-4ab1-414d-86b0-d11d08df58ea` from main `951aeb11c` (#51: read-aloud plays each step, no live line for a sample dish).
- **homecookd.app** (Vercel project `homecookd`, deploys from the ORIGINAL repo `calebwang26/homecookd` main, not this one): production from `37439d9` (homecookd#46): `web/` there now matches this repo's `web/` (the /d dinner invite page, API_URL on `bsudybxsqvtwftsdmwmz`, the real app ID `73UV499FKN.com.salik.homecookd` in the AASA). A web change here must be copied there to go live.

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
- Oct 24 · #16 · Claude · Pipeline for a cook who narrates in Marathi (or Marathi mixed with English), for the Oct 25 demo. `pipeline/prompts.py`: extraction writes every text field in English (step, feel, sensory cue, quote, stories, specials) and keeps the spoken Marathi of each quote in a new optional `quote_original` (Devanagari); the merge carries it, and align is told the audio may be Marathi and gets both. `pipeline/schema.py` adds `quote_original` (old recipe files and cached chunks without it still validate); `app/src/lib/types.ts` mirrors it. Convex keeps only the English (recipe.json in GCS holds the Marathi), and `convex/lib/mossDocs.ts` leaves Devanagari out of the searched text (`moss-minilm` is English-only); new `convex/mossDocs.test.ts`. Checked end to end on a 37 s Marathi narration synthesized with Cartesia Sonic (Gemini extract → Muse merge): all fields came back in natural English, each step's `quote_original` in Devanagari, the recipe validates; cost $0.07. Open: not yet run on a real recording of Grandma; Moss search not checked on a Marathi recipe: the one free index slot is kept for Caleb's new demo family (created in the app, recorded Oct 25), and test indexes are off-limits (#8), so check it on that recording; stories keep only the English (no `text_original`).
- Oct 24 · #17 · Claude · Deployed main (through #15) to Convex `grand-dragon-649` with `--preview-name hackathon`, Caleb's go. `GEMINI_API_KEY` is now in Convex env, so the cook's voice-note answers get `answer.translation` when they aren't in English. `seed:language` set the Test family's Grandma (`jn7edkrf2wcmn54zdcxy6xr4en8gwb4r`) to `mr`. Open: the Test family's Chicken Biryani is filed under Mom, so its questions go to Mom, whose answers are still transcribed as English; the kid's app doesn't show Convex answers or the "Translated" label yet.
- Oct 24 · #18 · Claude · Track D fix: Convex never got Caleb's TestFlight sign-in. Root cause: the live hooks (jobs.forFamily, questions.openForCook) read the person from the module snapshot `getSession()`, which SessionProvider publishes in an effect that runs after its children's; a sign-in sets the person and opens Home in one batched commit, so Home's effect saw nobody, `convexSession()` returned null and, with deps from the same stale snapshot, never ran again. Now the hooks take the person and credential version from `useSession()` and pass the profile id in, and retry `sessions.start` 3× (10 s). Logs: the phone's only `sessions:start` (06:46 UTC) carried an old Keychain device key from the original Supabase project (401 "This phone was signed out."), before Apple sign-in. Needs an EAS Update to reach TestFlight phones.
- Oct 24 · Track 0 (this PR) · Claude · Contracts for Caleb's PLAN.pdf v2 (homie live companion, Marathi both ways, ESP32 glasses → free GCP VM, Community MVP), so Tracks E–I can build in parallel. `convex/schema.ts`: `people.relation/approx/campus`, `families.publicName`, recipe `language`, `steps[].quoteOriginal`, `sharedAt`, `storyCard`, job `title/language/forKidId/recordingId` + stage `uploading`, `questions.textForCook`, new tables `recordings`, `homiePrompts`, `dinners`, `dinnerRequests` (all optional or new, so live data still validates). HTTP helpers moved to `convex/lib/http.ts`; homie and glasses routes get their own files (`lib/liveRoutes.ts`, `lib/glassesRoutes.ts`, empty for now). App: `call`, `useLive` (now with args) and `token` exported from `lib/live/convex.ts`. Contracts in `docs/build/STACK.md` "Oct 24 additions" (the `/record` socket, `/speak`, `/live/*`, `/glasses/*`, kid-side `say.kind`/timers/hints, worker claim + `/worker/release`); firmware protocol in `glasses/INGEST.md`. Caleb's calls: labelled AI hint + always ask the cook; Gemini hears Marathi live, Sonic speaks it; the glasses stream to a VM; pot on every screen. Not deployed (schema is backward compatible). Open: Tracks E–I.
- Oct 24 · (this PR) · Claude · Recorded the PR merge rule in `memory/pr-merge-organizer.md`: sessions send ready PRs to the organizer session instead of merging or asking Caleb.
- Oct 24 · #21 · Claude · STATE fix: #16's Moss note was wrong. The project has a free index slot (2 of 3 used: the seeded family and `homecookd-app`), but it's kept for Caleb's demo family, so Marathi search gets checked on the Oct 25 recording.
- Oct 24 · #22 · Claude · Moss write race fixed (`convex/moss.ts`, `convex/worker.ts`):
  - **Cause:** Moss rebuilds the whole index on each write, so recipes saved close together lost one. It dropped
    2 of the 4 demo recipes; I re-sent them one at a time.
  - **Fix:** one sync per family at a time (`families.mossSync`). A sync sends every ready recipe and deletes stale
    docs. A change during a sync triggers one more pass, and a stuck sync stops blocking after 10 minutes.
    `indexRecipe` is replaced by `syncFamily`.
  - **Tests:** 14 pass.
  - **Moss cleanup:** deleted `homecookd-app` and the TEST Biryani index (Caleb's OK). Only the demo family index is left.
  - **Open:** none. Deployed in the next line.
- Oct 24 · #23 · Claude · Deployed main `4f075ffac` (#22) to the Convex preview `grand-dragon-649`
  (`--preview-name hackathon`, Caleb's OK).
  - **Also went live:** the schema and indexes from earlier merged PRs that were never deployed (dinners, homie
    prompts, recordings, `recipes.by_sharedAt`).
  - **Moss check:** ran one `moss:syncFamily` on the demo family. The index still holds all 4 recipes (50 docs),
    every `mossIndexedAt` was refreshed, and `mossSync` cleared. `reindexMissing` found nothing missing.
  - **Fix:** committed the regenerated `convex/_generated/api.d.ts`, which was missing `lib/glassesRoutes`,
    `lib/http` and `lib/liveRoutes`.
  - **Open:** the TEST family's Biryani still says `mossIndexedAt`, but its index was deleted on purpose; it
    re-indexes on its next publish.
- Oct 24 · #25 · Claude · Track H: glasses VM → Convex job. `convex/glasses.ts` + `lib/glassesRoutes.ts`: `/glasses/active` (newest live glasses recording, or one by id in any status, so the VM can tell ended from abandoned) and `/glasses/finished` (sets `videoStartedAt`, creates the "processing" card and queued job with the recording's dish/language/kid; idempotent; refuses abandoned); 4 convex-tests. `glasses/ingest/`: `server.py` (WS ingest per INGEST.md, `/frame/latest`, `/health`, polls Convex every 2 s, survives reconnects and restarts), `mux.py` (frames at real times → 15 fps H.264 + AAC), GCS JSON-API upload, `fake_glasses.py`, `convex_stub.py`, `e2e_test.py` (passes locally, no cloud). `glasses/vm/setup.sh` (dry-run only; not run). Open: create the VM, set `GLASSES_SECRET`/`GLASSES_DEVICE_KEY` (Convex env, VM, Cloud Run), voice/deploy.sh must carry `GLASSES_SECRET` + `GLASSES_URL` (Track E), deploy Convex; not tried with the real firmware or on the e2-micro.
- Oct 24 · (this PR) · Claude · Memory: demo-family-shreya (the demo is Shreya Pawar's family; her grandma cooks and records in Marathi; Serene isn't in the demo).
- Oct 24 · #28 · Claude · Rule: every PR goes to the "Merge Agent" session for approval, and it decides how conflicting PRs merge (`AGENTS.md` hard rules, `memory/merge-agent-approval.md`). Docs only. Open: nothing.
- Oct 24 · (this PR) · Claude · pr-merge-organizer now names the organizer chat "Merge Agent" (its title), matching merge-agent-approval (#28).
- Oct 24 · #31 · Claude · Track I, the kid's library: it now also lists the signed-in family's own finished dishes from Convex `recipes.list` (live), so a dish the worker publishes through Convex shows up for the family without going into the public `library.json`.
  - **How:** new `app/src/lib/familyLibrary.ts` (pure): `ready` rows with a `libraryId` and an https `recipeJsonUrl` become library entries (relation from the cook's profile), placed in front of library.json/bundled. A dish already in library.json keeps that copy. `lib/recipes.ts` puts them in the shared store and loads and caches each recipe.json from `recipeJsonUrl`, like the bucket recipes. A sign-out or another family clears them. With Convex stubbed (Expo Go, no URL) the library is unchanged.
  - **Convex ids:** `lib/live/convex.ts` gains `invalidateConvexRecipes()`, called whenever the family's list changes, so a new dish's Convex id is found (the voice socket needs it). `JobStage` gains `uploading`, and ProcessingRow says "Still sending the video".
  - **Tests:** new `app/scripts/test-library.mjs` (16 pass); `test-shorten.mjs` stubs the two new imports. tsc, lint, every app test script and `test-profile-navigation` on Expo web pass.
  - **Open:** `processing` rows aren't shown, because the kid's library has no "being made" card (the cook's own upload already shows as a ProcessingRow). Not checked against live Convex on a phone (needs a real signed-in session). The Convex worker never writes the GCS `jobs/<id>.json`, so the cook's ProcessingRow for a Convex job stays at "Almost done" next to the finished dish: `PendingRecipes.tsx` should also drop a job once its live job is `done` (not in this PR).
- Oct 24 · #32 · Claude · Track I-core, homie: the launch screen's pot now rests top-right on every screen. It's hidden on sign-in, the gateway, links, the month story and chat; it sits left of the profile face on both Homes and left of Share on a dish. Only the steam and lid move (off, listening, thinking, lit, speaking, timer ring).
  - **Moments:** `showMoment` takes the pot to the centre (about 170 pt, lit), blurs the screen (BlurView at 70 plus a dark tint) and raises the question and big buttons under it. Answering reverses it; Reduce Motion fades it in place.
  - **Code:** `lib/homie` (store, logic, hooks: `setHomie`, `setHomieLevel`, `pulseLit`, `showMoment`, `useHomieScreen`, `useHomieSlot`, `useAiSpeaking`) and `components/homie` (HomiePot, HomieMoment, HomieOverlay, mounted once in `app/_layout`). A tap on the pot says the screen's help line.
  - **Voice:** `lib/live/speak.ts` POSTs `/speak` and plays under a `say:` key, falling back to the phone's voice (expo-speech).
  - **mic.ts:** the echo comment is fixed (half duplex, not VoiceChat), plus an optional `onLevel`. Placeholder routes `/recording` and `/answer/[id]`.
  - **Tests:** `app/scripts/test-homie.mjs` (24 pass). Web screenshots checked.
  - **Open:** nothing tested on an iPhone yet. `/speak` is on main (Track E, `voice/src/server.ts`); not tried against the deployed service. Parent Home's date keeps clear of homie since #35 (`ProfileButton homieRoom`), and the cook screen's header leaves homie room since #36.
- Oct 24 · #24 · Claude · Track G: Community backend + app helper (no screens yet). `community.feed` (shared recipes from other families, nearest first, plus open dinners; whitelisted fields only, `coverUrl` only for our own stock/cover photos), `community.recipe` (text only), `community.setShare` (the recipe's cook only; Muse Spark writes a ≤25-word story card once, stories only if `memoriesOptIn`, a plain template without `MUSE_API_KEY`), `community.setLocation` (rounded to ~1 km), `dinners.create/get/mine/requestJoin/respond` (the address only for the host and accepted guests; full once every seat is accepted). `convex/lib/geo.ts`, `convex/seedCommunity.ts` (8 neighbor families 0.5–3 mi out, `place`, `publicName`), `app/src/lib/live/community.ts`. 7 new convex-tests (21 pass). Open: `DEMO_LOCATION` is a Cambridge MA placeholder (`TODO(caleb)`: the venue's coordinates); not deployed; run `seedCommunity:neighbors`, then `place` for the floormates and `publicName` for the Pawars after the deploy; screens wait for Caleb's mockups.
- Oct 24 · #24 · Claude · Track G review fixes:
  - **Her stories:** the story card now records `usedStories` (one optional field on `recipes.storyCard` in
    `convex/schema.ts`). Once the cook says no to her stories, `community.feed` and `community.recipe` show the plain
    line instead of a card written from them, and her next `setShare(on)` has Muse rewrite it without them.
  - **Dinners:** `dinners.create` needs a shared recipe ("Share this recipe first."), because the dish name reaches
    every neighbor's feed.
  - **Contract (STACK.md):** `community.feed`'s `now` is now required. The app helper already sends it.
  - **Tests:** 3 new (stories taken back with Muse mocked, past and full dinners, cover photos); the address test
    shares first. 24 pass.
  - **Open:** `convex/_generated/api.d.ts` is still the hand-edited one from this PR; regenerate it on the next
    deploy. Not deployed.
- Oct 24 · #25 (review fixes) · Claude · Track H review fixes (`glasses/ingest/`, `/glasses/finished`):
  - **Stuck recordings:** one that never ended (phone died) now loses the glasses to a newer recording, or after
    12 h, and is finished with what it has. Before, it kept every frame and the new one got no video.
  - **No frames** (glasses off): the recording fails at once, no job, instead of retrying every 30 s forever.
  - **Media:** the VM deletes frames, audio and MP4 once the job exists, or the recording is abandoned or fails;
    only `meta.json` stays (also swept at startup). `--dry-upload` keeps `out.mp4`.
  - **Security:** `/glasses/finished` takes only `uploadPath` = `glasses-<recordingId>/` (400 otherwise; STACK.md
    updated), so a leaked secret can't point a job at another family's upload. Public `/health` says only
    `{ok, glasses}`; the recording id, frames and queue need `x-glasses-secret`.
  - **Clock:** device time is mapped to the wall clock afresh at each recording's start (no drift over days).
    `finish()` tasks are now held, so they can't be garbage-collected midway.
  - **Tests:** new `glasses/ingest/test_server.py` (13 unit tests: fake Convex, fake clock, temp dir), e2e passes,
    convex 4/4 glasses tests. AGENTS.md lists `glasses/` and its two test commands.
  - **Open:** as above (VM not created, real firmware not tried). `npx convex codegen` after merge, so the
    hand-edited `api.d.ts` matches the generator; tell Track 0 about the STACK.md `/glasses/*` changes.
- Oct 24 · #29 · Claude · Track E: homie, the live companion. Convex `live.ts` (`startRecording`, `recording`) and
  `/live/person|session|status|prompt|prompt-update|optin` (`lib/liveRoutes.ts`), idle recordings abandoned after
  2 h (cron); `/voice/session` adds the cook's language, relation, `quoteOriginal` and each story's step. Voice
  service: `/record` (hello → questions while she cooks → last questions, stories opt-in, goodbye; Gemini Live
  `gemini-3.5-transcribe-live` hears Marathi, Ink 2 the rest; pacing in code, `HOMIE_DEMO=1` for the demo),
  `POST /speak`, and kid-side `/cook` additions (say `kind`/`textEn`, greeting + read-aloud offer, timers, labelled
  hints that always ask the cook too, story and quiet nudges, clip captions). homie's voice: Sindhu
  `07bc462a-c644-49f1-baf7-82d5599131be`.
  - **Checked:** convex-tests and both typechecks; `test-record` end to end on the stub in Marathi and English.
  - **Open:** not deployed (Convex or Cloud Run); never run against live Convex or a phone; the glasses frame pull
    is untested (no VM yet); `GEMINI_API_KEY` and `HOMIE_VOICE` aren't Cloud Run secrets/env yet (deploy.sh adds them).
- Oct 24 · #29 (review fixes) · Claude · Track E after review:
  - **Kid side (#13 kept):** `/voice/session` `cookLanguage` is now optional, absent when neither the cook nor the
    recipe has a language. The English line after a clip is skipped only for a cook marked `en`, so older recipes
    and the unseeded demo cook still get "Grandma says: …". The `/cook` guards from #13 are unchanged.
  - **`/record`:** what homie knows (pacing counters, questions asked, transcript, hello) is kept per recording
    across reconnects (cleared at `ended`, 3 h TTL). A reconnect into `recording` listens 15 s before deciding.
    `start`/`done` are guarded synchronously, so there's no double start and no live question after `done`.
    Status writes go out in order. `done` stops homie (an extra `say_end`) and drops an open question first. A
    story in progress blocks questions in code. A socket closed mid-wrap-up writes nothing more and leaves
    `wrapping_up`, and the reconnect finishes only what's left. A newer socket replaces an older one (close 4409).
    Messages that arrive before loading are kept.
  - **Heartbeat:** `/live/status` `{ touch: true }` every 10 min while the socket is open (`live.touch`), so a long
    cook isn't abandoned.
  - **Tests:** new `voice/test/` (node:test + tsx, no new deps; `npm test`), 14 pass. Convex 33 pass with main
    merged (two live.test.ts tests extended: the heartbeat, `cookLanguage` absent). On the stub (`HOMIE_DEMO=1`):
    `test-record` passes in Marathi and English, and the kid `test-client` runs greeting → offer → step → hint → timer.
  - **Open:** same as above (not deployed). The post-clip translation path needs a Moss hit, so it isn't exercised
    on the stub.
- Oct 24 · #26 · Claude · Track F, the cook's language end to end + pipeline gaps. New `convex/people.ts` (`people.me`, `people.setLanguage`). `jobs.create` takes `title`, `language`, `forKidId`, `recordingId` (copies homie's recording's dish/language/kid, sets `recordings.jobId`; the title replaces "New recipe"). `/worker/claim` adds `title`, `language`, `relation`, `forKidName`, `memoriesOptIn` and `homieLog` on the video clock; new `/worker/release` (only from `preparing`; stage `uploading`, back to `queued` in 30 s); `/worker/published` stores `recipes.language` and `steps[].quoteOriginal`, which `/voice/session` now returns too. A kid's `asked_cook` question for a non-English cook gets `questions.textForCook` from Gemini (in Track F's brief). Pipeline: the worker waits up to 45 s for every file in the signer's `jobs/<id>.json`, else releases the job (fixes the upload/claim race; only uploads without a signer file give up after 20 releases, signer uploads when their links expire); passes title, language and homie's log to `process.py`; prompts get a language line and a homie block (never quote homie as the cook; start steps at her answer); merge aims for 8–12 steps; recipe.json gains `language`. Convex mode still doesn't rebuild the GCS `library.json` (that file is shared by every family; the kid app should read the family's recipes from Convex `recipes.list`). New `app/src/lib/languages.ts` (30 Sonic languages, `matchLanguages`, `languageName`). Tests: 5 new convex-tests (19 pass; they cover another family's kid and recording, release only from `preparing`, and `/voice/session` + `/voice/step` on a Marathi-quoted recipe), `pipeline/test_prompts.py` (8 pass), `app/scripts/test-languages.mjs`. Not deployed. Open: Convex deploy; the 8–12 step merge prompt not yet run on a real video; Track I: the app's `JobStage` (`app/src/lib/live/convex.ts`) and `STAGE_HINT` need `uploading` (e.g. "Still sending the video").
- Oct 24 · #34 · Claude · Follow-up to #31: the kid's library no longer shows a family dish's stories and tips to
  people the cook hasn't shared them with. The library loads the full `recipe.json` from `recipeJsonUrl`, and Convex
  holds back `memories` only in its own `recipes.list`.
  - **How:** `familyLibrary.ts` reads `memoriesOptIn` and `memories`. A dish is shared when she opted in, or when
    the row came with memories, which Convex sends only to the cook. For any other listed dish, `lib/recipes.ts`
    strips the stories, specials, step tips, `story_ids`/`special_ids` and the intro before caching, whichever copy
    loads (bundled tips and the offline fallback too). The flag is in the change signature and a flip drops the
    cached copy, so her later yes reloads the stories. `useRecipe`/`useRecipes` drop them from an open screen at
    once. The library key is now family + person, so on a shared or lent phone the next person waits for their own
    rows.
  - **Fails closed (review fix):** while the signed-in person's `recipes.list` rows haven't come (Convex slow,
    unreachable or stubbed, a new person on the phone, or no library screen mounted yet), `storiesWithheld` strips
    every dish that isn't public (not in library.json and not bundled). When the rows come, the copies cached that
    way are dropped, so a shared dish loads again with its stories. Public dishes, and signed-out viewers of them,
    are unchanged. A family dish opened in Expo Go's stub stays stripped. The recipe page hides Share on a dish whose
    stories are kept from this person, because the `/r` page shows them all.
  - **Tests:** `test-library.mjs` 31 pass (15 new), `test-shorten.mjs` (its `./session` stub gained `getSession`)
    and the other app scripts, tsc and lint pass. Turning off each part of the fail-closed gate makes a new test
    fail. On Expo web with Convex stubbed, a fixture family dish opened with no stories, tip or Share, and a bundled
    dish kept Share and its story row. `test-profile-navigation` passes.
  - **Open:** not checked against live Convex on a phone (needs a real kid session). Share still shows on
    `MadeIt.tsx` and `PostcardStep.tsx`. Root cause, not fixed here: `recipe.json` with the stories sits in the
    public media bucket, so the `/r` web page and anyone with the URL can read them. The real fix is to publish
    `recipe.json` without the memories and read them from Convex.
- Oct 24 · #37 · Claude · The cook's stories and tips leave the public media bucket (built on #34; the root cause #34
  names). In Convex mode the
  worker's `recipe.json` has no `stories`, `special`, `steps[].tip`, `story_ids`/`special_ids` or `intro`
  (`publish.without_memories`, `publish_recipe(family=True)`); `data/out/<id>/.family` keeps a hand re-publish
  (`publish.py --id`) stripped too. Convex still gets the whole recipe, and each memory now keeps `step`, `id`,
  `title`, `why` (optional fields, `convex/schema.ts` `memory`); `/voice/session` returns only its own memory
  fields. The app puts `recipes.list` memories back into a file that has none (`withMemories`, `sharedMemories` in
  `familyLibrary.ts`; `forViewer`, `useRecipe`, `useRecipes` in `recipes.ts`), so a kid sees them only after the
  cook's yes and the cook always sees hers. #34's fail-closed gate still applies first (`forViewer` takes the hook's
  session key). The web share page reads the same file, so it shows none.
  - **Tests:** new `pipeline/test_publish.py` (4), other pipeline tests pass; vitest 40 (new `convex/memories.test.ts`,
    2); `test-library.mjs` 37 with #34's final head merged (6 new); every other app test script, tsc and lint pass.
  - **Open:** live since Oct 24 (Convex deployed, worker restarted on main; see the log line below). Not checked on
    a phone with a recipe published since then. The old family files were scrubbed (#40), and `rebuild_library`
    leaves family recipes out (#39). The intro isn't kept anywhere now (no screen shows it).
- Oct 24 · (this PR) · Claude · Root devDependency `@types/node`: `convex deploy` typechecks `convex/`, and a clean `npm ci` had no Node types, so every `process.env` failed (37 errors) and the deploy stopped. Now tsc is 0 and vitest 40/40.
- Oct 24 · #39 · Claude · Family recipes stay out of the shared library, plus a scrub for the old ones (follow-up
  to #37). A family recipe's public `recipe.json` now says `"family": true` (`pipeline/schema.py` `Recipe.family`,
  set by `publish.without_memories`). `rebuild_library` leaves those out of `library.json` and the app's bundle
  (`publish.is_family`, which also honours `data/out/<id>/.family` for one published before the mark).
  `publish_recipe` keeps a recipe a family one when its bucket copy is marked, so re-publishing it by hand from
  another machine can't put the stories back. The app and web types ignore the new field. New
  `pipeline/scrub_family.py` finds family recipes from the Convex `recipes` rows with a `recipeJsonUrl`
  (`npx convex data`, team token) and rewrites each `recipe.json` (and its `trash/` copy) with
  `without_memories`. It never rebuilds the library. It's a dry run by default; `--write` needs Caleb's OK. It
  also names unmarked bucket recipes that neither `library.json` nor Convex lists, and `--id` adds them.
  - **Tests:** `pipeline/test_publish.py` 9 pass (5 new: library and bundle, a re-publish elsewhere, the scrub's
    dry run, `--write`, the Convex rows). Turning off each guard makes a test fail. The other pipeline tests pass.
  - **Live dry run (read only):** `hackathon-biryani-2` (Convex row: 1 story, 3 special moments, 3 tips, the
    intro) and `hackathon-biryani-1` (no Convex row, not in `library.json`: 2 stories, 3 special moments, 3 tips,
    the intro). Neither is in the live `library.json` yet.
  - **Open:** nothing written to the bucket, nothing deployed. The scrub waits on Caleb (see "Waiting on Caleb").
    `play.mp4` and `voice.m4a` are still public at unlisted URLs, with the stories as she spoke them.
- Oct 24 · #40 · Claude · Ran `pipeline/scrub_family.py --id hackathon-biryani-1 --write` with Caleb's OK. The
  public `recipe.json` of `hackathon-biryani-1` and `hackathon-biryani-2` no longer holds stories, special moments,
  step tips or the intro, and each is marked `"family": true`. Steps and media are unchanged. `library.json` wasn't
  rebuilt: it still lists 10 recipes, neither biryani. A second dry run finds nothing to scrub. The bucket has no
  object versioning, so the old copies return 404; GCS soft delete keeps them for 7 days, readable only by project
  admins. `hackathon-biryani-2`'s memories stay in Convex. `hackathon-biryani-1` has no Convex row, so its stories
  now exist only in a local backup outside the repo.
  - **Open:** `play.mp4` and `voice.m4a` for both dishes are still public at unlisted URLs, with the stories as she
    spoke them.
- Oct 24 · (this PR) · Claude · #37 is live. The `hackathon` Convex deployment has its memory fields:
  `npx convex function-spec --preview-name hackathon` shows `step`, `id`, `title` and `why` on `worker:published`'s
  args and on `recipes.get`/`recipes.list`'s returns. The worker on the laptop (`pipeline/worker.py`, started Oct 24
  03:14) runs from `.claude/worktrees/worker-main` at main `4d703d9` (#39), which has #37 and #39.
  - **Open:** no recipe published since then has been opened on a phone, before and after the cook's yes.
    `play.mp4` and `voice.m4a` are still public at unlisted URLs.
- Oct 24 · #42 · Claude · Track E follow-ups, the server side of the contract #35 and #36 build on (STACK.md):
  - **Kid `/cook`:**
    - `{type:"moment", open, kind}`: while one of the app's own homie moments is up, a spoken yes/no/sure/not
      now is its answer. Transcripts still stream; homie's offer and story nudge ignore it; Claude never gets it.
      No offer or nudge is said over a moment, and `{type:"text"}` answers always count.
    - A no or "not now" (spoken or text) to the read-aloud offer sends `{type:"offer_closed", accepted:false}`.
      Steps stay silent for the visit; commands work, and "repeat" reads one. A yes sends
      `offer_closed` with `accepted:true`, then the step.
    - The offer line is now "…Say yes or no.", and either answer is kept 3 h per instance.
  - **Parent:**
    - New Convex `live.endRecording` (cook only, her own recording): `recording`/`wrapping_up` become `ended`
      with `endedAt`. It's idempotent, and returns `{ok:false}` for `intro`/`abandoned`.
    - `/live/prompt` refuses new lines once a recording is over; only the goodbye may land after `ended`.
    - A voice socket still open on a recording ended that way stops quietly at its next Convex write (phase
      `ended`, close 4404, nothing more said or saved).
  - **Tests:** voice 27 (new `test/cook.test.ts`, 4 new record tests, shared `test/helpers.ts`), vitest 41, both
    typechecks pass. 20 deliberate breaks each failed a test. The kid test client on fresh stub servers: a spoken
    no declines, then silent steps; a spoken yes reads; with a moment up a yes is held, then a text no declines.
  - **Open:**
    - Not deployed (`voice/deploy.sh`, Convex).
    - The app side in #35/#36: send `moment`, send the text no on a tap-to-close, read `offer_closed`, call
      `endRecording` when the socket is down.
- Oct 24 · (this PR) · Claude · Cartesia credit fix C (Caleb): fake speech for voice tests. `VOICE_FAKE_SPEECH=1` (`npm run dev:fake`) swaps Ink, Gemini Live and Sonic for fakes (`voice/src/speech.ts`), so local runs cost nothing; `/health` adds `x-fake-speech: 1`. `test-client` and `test-record` refuse a service without it unless `LIVE=1`, send each recorded line's words as text (`voice/scripts/testLines.ts`, shared with `make-audio`), and stop at `MAX_S` (live at most 300 s). AGENTS.md rule: at most one live Cartesia smoke test per merge (replaced the same day: live tests are encouraged, see below). Fixes A (server-side half duplex) and B (idle close) follow in a second PR; the phone side of A and B goes in #36.
- Oct 24 · (this PR) · Claude · Cartesia credit fixes A and B (Caleb), the server side. A: `cook.ts` sends mic frames to Ink only when homie's own line isn't playing on the phone, and always while a turn is open (Ink needs the trailing audio to end a turn; a turn with no end stops counting after 30 s); the cook's clips stay the phone's to mute. B: `ink.ts` closes the stream after 2 min without audio and reopens it on the next frame, backs off on reconnects (250 ms to 10 s), and keeps only 2 s queued while connecting. Live smoke test (real Ink 2 + Sonic, stub recipe): yes, next step, a question, go back, all transcribed exactly and acted on in under 70 ms, and no echoes. Open: the phone side (send nothing while quiet or unfocused, close on background) goes in #36. Not deployed: needs `voice/deploy.sh` (Caleb).
- Oct 24 · (this PR) · Claude · Caleb: live Cartesia tests are encouraged (1.24M credits; use them to check voice quality). `test-client` and `test-record` stream to real Ink 2 and Sonic by default; fake speech is now the opt-in (`FAKE=1` against `npm run dev:fake`). The run cap is a 15 min safety stop (`MAX_S`), no longer a credit gate. AGENTS.md's "one live test per merge" rule is replaced, and voice/README.md updated.
- Oct 24 · #35 · Claude · Track I-parent, the cook's side of homie (contains #32's homie core; #26 is in main now,
  so it builds on its own). Final round: Caleb's v3/v4 screens, the review fixes and the #29 protocol follow-ups.
  - **Record:** "Start recording" opens a pre-record sheet (dish, who it's for or Everyone, her language, then From my
    glasses / Phone camera / Videos I took). Her language is sent only once she picked it or `people.me` loaded, so an
    unknown one never overrides her saved one. `live.startRecording` and `people.setLanguage` are strict (a missing
    function throws instead of faking a recording); homie's start gives up after 10 s offline.
  - **`/recording` v3:** one 232 pt red stop button on a full-height peach wash with a warm glow, one line under it
    ("माझं झालं" / "Tap when you're done"), homie top-right, nothing else. Filming starts by itself once homie's hello
    has played. homie's questions are `AskMoment`s with no buttons: homie glowing, the question, five listening bars,
    "बोला, मी ऐकतोय" / "Just answer out loud" (a tap anywhere closes it). Then the new done view: homie
    waves, "झालं! Shreya ला पाठवतोय", home after ~4 s. A phone recording starts filming on the server, closes the
    socket and mic (awaited) while the system camera is up, then reconnects and ends, and the done view sends the
    video itself (`components/record/sendDraft.ts`, shared with Send). The mic stops at `ended`; a lost connection
    shows the reason, Try again and the × (a phone recording can film without homie).
  - **`/record` protocol (#29):** close 4409 is final (no reconnect); an extra `say_end interrupted` stops the line
    already playing. A live recording with no session retries and never falls back to the stub. Lines end on
    `say_end` (a 3 s gap timer is only a safety net).
  - **`/answer/[id]` v2:** the walkie-talkie with no buttons: homie reads the question, the expo-audio recorder listens
    with metering, ~2 s quiet after ≥1 s of talking sends it (`questions.answer`), homie says and shows "Shreya ला
    पाठवलं", then it closes. No answer in 15 s: asked once more, then closes with nothing sent. A tap on the
    question reads it again. `HoldToTalk` is back to main's version.
  - **Parent Home:** a translated question says "Translated"; the 'uploading' stage keeps the sending half short of
    full ("Still sending the video"); a live Convex job is dropped once it's 'done' and its recipe is in the library
    (`libraryIdOf` in convex.ts).
  - **Round 3 (verifier fixes + the shared contract):** the stop button with no `/record` socket ends the recording
    through Convex `live.endRecording` (by name, soft; its stub ends only a stub recording), so the glasses' VM still
    finalizes; if that fails, "done" waits for the socket. A wrap-up that stalls (2 min with nothing moving, 20 s
    after a service error or a lost line) ends the same way, and a phone video then sends anyway. One socket at a
    time (a connect waits while one is on its way; an older socket is ignored); a closed or new socket clears homie's
    question, and a tap always closes it. Half duplex sends zeros of the same length while homie is lit/speaking or
    anything plays. The asks moment follows canvas frame 2 (homie, then the question, then green bars); homie's glow
    breathes; the rings pulse every 1.6 s; the done view's arm waves 3 times; the walkie's check pops in and its
    bars move with her voice. The walkie reads `textForCook` in her language even before `people.me` loads. A share
    ask (`questions.kind` 'share', #33) reads through the same rows and walkie: no step, a short yes/no is enough,
    long text gets smaller type. Parent Home's date keeps clear of the pot (`ProfileButton homieRoom`; it wraps).
    `lib/homie/strings.ts` is gone: its used lines moved to `components/record/words.ts`.
  - **Tests:** `test-recording-ui.mjs` 23 pass, `test-parent-jobs.mjs` 4 pass; tsc, lint and every other app script
    pass (`test-profile-navigation` against the web server). On Expo web (Convex and voice stubbed) the glasses flow
    ran from hello to Home; screenshots of every state, and frame diffs show the rings, glow, arm and check moving
    (still under Reduce Motion).
  - **Open:** nothing on an iPhone yet (mic metering, the camera after the mic, the phone send, half duplex).
    `live.endRecording` isn't deployed yet (the Track E follow-up), and the no-socket stop path couldn't be run on the
    web stub (the stub socket never drops). GlowHomie's disc is cream, not the canvas's butter (HomiePot draws its
    own disc; a disc color prop in components/homie would fix it). No public query maps a kid to a Convex person id
    (found by name).
- Oct 24 · (this PR) · Claude · `docs/agents/MERGE-PLAYBOOK.md` (from Caleb via the UI/UX session): how the Merge Agent takes in, orders, reviews, resolves and merges PRs. AGENTS.md's merge rule points to it. The demo freeze in it is marked as proposed until Caleb confirms.
- Oct 24 · (this PR) · Claude · MERGE-PLAYBOOK: Caleb decided there's no demo freeze; features keep merging if they pass the checks.
- Oct 24 · #33 · Claude · Track G screens: Caleb's simplified Community map, his v2 "one step at a time" connect
  flow, share asks, swaps, and (round 3, his final canvas) "Cook together", "Invite friends" and the motion (built on
  #24's backend):
  - **Kid tab "Dishes near you"** (`kid/community.tsx`): the title (room left for homie at the top right) with one
    line under it, "Tap a photo to learn about a dish and cook together.", then one square map (330 pt on a 390 pt
    phone; react-native-svg, no new native module: made-up streets, real Cambridge neighborhood names at their real
    spots, You in the middle) with a round dish photo per ~1 km grid cell (`components/community/mapLayout.ts`), and
    ONE button, "Share your recipe". The circles pop in one after another; a tapped one springs to 70 pt with its sun
    ring; the card rises in; each chooser step crossfades (`components/community/motion.ts`). Reduce Motion: fades.
  - **One step at a time** (`DishSteps`, `ShareSteps`, `Chooser`, words in `choices.ts`): a dish's card (photo, dish,
    "cook · culture" with a small "AI" tag on Muse's culture guess, distance, her quote, "Translated" when she said it
    in another language) has one button, "Connect with <cook>". Its chooser: "Join <host>'s dinner" (only with an
    open dinner ahead), "Swap recipes", "Cook together" ("Ask <cook> to make it with you"). "Share your recipe" →
    "Put it on the map" and "Host a dinner". Your own family's shared dishes are on the map too (their card's button
    is "Host a dinner"). "You" opens your next dinner, the swaps and "cook together" asks sent to you (Accept /
    Decline), the agreed ones, or one line saying they show up there (its "Host a dinner" button is gone).
  - **Share asks** (`convex/shareRequests.ts`): "Put it on the map" by someone who doesn't cook the dish adds a
    `questions` row (`kind: "share"`) for that recipe's cook. It reaches her in her language only through the parent
    UI showing `textForCook` (LiveQuestions and the walkie-talkie, merged in #35). Only she can
    answer. Gemini reads her answer against a fixed question (never the stored text, which has the asker's name and
    the dish), her words passed as one JSON string; only "yes" shares (by `community.shareOn`). Every answer is
    settled once (`questions.shareDecision`): after a no, an unclear answer, a failure or a voice note nobody could
    write out, the kid's row says "<cook> said not now" and nobody can ask again for a day. The question, the cook's
    switch and the privacy note now name the culture guess (`TODO(caleb)` on the words).
  - **Swaps and Cook together** (`swapRequests`, `kind: "cook"` for cook together): `requestSwap`, `cookTogether`,
    `respondSwap`, `mySwaps` (with `kind`). An accepted "cook together" reads "Cooking Pork Adobo together with the
    Reyes family" with "Host a dinner" next, and `dinners.create` lets the asking family host that dish.
  - **Dinner page** (`/dinner/[id]`, Caleb's final Hearth version): lavender wash, the dish photo (326x300, sun glow,
    "DINNER" tag), "<Dish> Night", a "Hosted by" pill, when and where (the address only after the host says yes),
    "You're in" and a few faces, "X going" (host + accepted guests + invite opens; it rolls up live), and one button:
    "Ask to join", "Asked · waiting", or for the host and guests who are in, "Invite friends". The host first gets
    "N asked to join", which scrolls to the requests. "Add to calendar" and its .ics code are gone.
  - **Invite friends**: the share sheet as a dinner variant (`components/share/DinnerInviteBody.tsx`: the dish
    photo, "<Dish> Night", "Hosted by <host>", no faces; Copy link, Messages, WhatsApp when available, More; "Come to
    <Dish> Night with <host>: <url>"). `dinners.inviteLink` → one stable random token per dinner, host and accepted
    guests only. Public `POST /invite/open` (`convex/lib/inviteRoutes.ts`; CORS for homecookd.app and localhost)
    counts each phone or browser once (`dinnerInviteOpens`), at most 60 new per 10 minutes and 300 in all, and
    answers only `{ dish, hostName, startsAt }` (the host's display name, the same one the invite text and the
    dinner page's pill show, so `/d` says "Hosted by Grandma Rajani", not "Grandma"; `TODO(caleb)` on whether a
    forwardable link should show less). The web's static `/d` page (`NEXT_PUBLIC_CONVEX_SITE_URL`,
    default the hackathon deployment's `.convex.site`) and the app's `/d` screen (works signed out) call it. The
    AASA file lists `/d`.
  - **Also:** the kid tab bar's selected bubble now grows to fit a long label ("Community" at 390 pt;
    `components/ui/FloatingTabBar.tsx`). Muse's story card code is in `convex/storyCards.ts`. `/dinner/new` takes
    `?recipeId=` and lists the dishes another family said yes to cooking with you.
  - **Polish (after the verifier):** the one green row in a chooser is the first one you can press, and none when
    every row only says how things stand (a "Put it on the map · Asked Grandma Rajani" row, "One moment…", or a
    pending "Swap recipes" no longer takes the green over a working row; `Chooser` draws those rows plain). The new
    reads (`shareRequests.familyDishes`, `community.mySwaps`) and `dinners.inviteLink` are soft, and the new asks
    (`shareRequests.ask`, `requestSwap`, `cookTogether`, `respondSwap`) are strict, so an app build that reaches
    phones before this Convex deploy doesn't move every Convex call to the stub. `POST /invite/open` answers
    `hostName` (was `hostFirstName`) on Convex, the web `/d` and the app `/d`. On the merged head: vitest 64,
    `test-community-ui.mjs` 23, every other app script (`test-profile-navigation` against this checkout's Expo web),
    tsc, lint and the web build pass; Expo web shows "Host a dinner" green under a plain "Put it on the map".
  - **Tests:** vitest 63 (new `dinnerInvites.test.ts` 4; `shareRequests.test.ts` 8 with the fixed question, the
    JSON answer and the day-long "not now"; `swaps.test.ts` 3 with cook together); breaking each key guard on
    purpose fails a test. `test-community-ui.mjs` 23 (cook together, "said not now", the dinner's button and count,
    the invite words and helpers). Expo web and the web's static `/d` at 390x844 with local fixtures (not committed).
  - **Open:** not deployed (schema: `questions.shareDecision`, `dinners.inviteToken` + index, `dinnerInviteOpens`,
    `swapRequests.kind`, all optional or new). After the deploy: `seedCommunity:neighbors`, then `floormateDish` and
    `place '{"familyId": …}'` for Serene's, Caleb's and Salik's families; Vercel needs no new env (the site URL has
    a public default). `DEMO_LOCATION` is still the MIT placeholder (`TODO(caleb)`). No `setLocation` caller. Not tried
    on a phone: the share sheet's dinner variant, the deep link, VoiceOver. "Host a dinner" still shows on your own
    dish's card. A floormate dish has no in-app off switch. With #35 in main, homie's corner pot sits over the dinner
    photo's glow (the canvas has none there; `/d` hides it like `/i` and `/r`).
- Oct 24 · #36 · Claude · Track I-kid, homie in cook mode (built on #32). The header stays put with homie at its top right; small chips under the pot (Back · Repeat · Ask <cook>; no Next chip, the big "Next step" button does that) talk to homie, or act on their own when voice is off or homie doesn't answer in 1.5 s. A dark "Timer 7:41" pill beside the step title (the phone's own clock, a buzz at zero, the pot's ring). Chips and pill match the canvas's Cook frame. The body's Ask pill is now the chip; the "waiting" line stays.
  - **Voice:** no mic button. In a dev build with the voice service, on a Convex dish, voice starts by itself once the "Let Mom see" sheet has its answer (`consentSettled`; a memorial cook has no sheet, `cookingSessionOn`). A tap on the pot turns the mic off or on (no moment; turning it on, homie says what the kid can say). `lib/live/voice.ts` handles say `kind`/`textEn`, clip `quote`/`quoteEn`, `timer`/`timer_done`, and sets the pot. The pot shrinks while the cook's own voice plays (store `shrunk`), and homie's next line waits until her clip or voice note ends (`setHold`). Stub in `lib/live/voiceStub.ts`.
  - **Half duplex** is `lib/live/mic`'s, for every caller: while homie is lit or speaking, anything plays on the shared player, or a step video plays, each frame is zeroed PCM of the same length, marked `quiet` (`halfDuplex`, `useHalfDuplex`; `lib/media` `videoPlaying`, `useVideoPlaying`, `audioNow`). `/record` sends the zeros; cook mode sends nothing for them (round 3, Cartesia credit fix A). So the help line, homie's lines and her clips never reach the service as the kid's words.
  - **Moments** (`components/cooking/CookMoments.tsx`): no buttons (Caleb, Oct 24; memory `homie-talks-no-bubble`). The read-aloud offer, a story nudge and "<cook> answered your question" show the glowing pot, the question, five listening bars, "Say “yes” or “no”" and "Tap anywhere to close". A spoken yes does it; a spoken no closes it and is kept on the phone; a tap anywhere is "not now" for that visit only (nothing saved). "Ask <cook> anything" has only the bars (the Ask chip opens the chat when voice is off or muted). A phone that can't hear the answer gets one button ("Read it to me", "Hear it", "Play it"). Whenever no voice line reads (Expo Go, web, or the line gave up or failed: `voice.unavailable`, `phoneReads`) the phone offers read-aloud itself and reads each step in homie's voice (`useReadSteps`). Kv `homie.readAloud`, `homie.heardAnswers`.
  - **Shared contract, app side** (STACK.md; the service's side is #42): `{ type: "moment", open, kind }` while "Grandma answered your question" (`answer`) or "Ask Grandma anything" (`ask`) is up, sent again on a new socket; `{ type: "text", text: "no" }` declines the read offer for a tap anywhere or a remembered no; `offer_closed` closes the offer's moment and keeps the answer when homie heard it first.
  - **Review fixes:** round 1: late `say_end`s (`endSay`), a clip drops homie's line, the echo answers a chip, the screen's step wins on `ready`, Repeat goes to homie only for read-aloud kids, no reading over her clip, leaving drops a line, "I made it" hangs up, the mic stops under another screen, `timerKey`. Round 2 (homie core review): the help tap only speaks (no moment, the "AI voice" label), `speak()` has one 8 s deadline over the Convex session and the request, a 12 s watchdog on 'lit' (`MAX_LIT_MS`, since lit holds the mic), the overlay is modal for VoiceOver while a moment is up, no blink when a moment closes, `useHomieSelect` (screens don't re-render on each mic level), "Translated from the cook" as the label's fallback. The cook header keeps the pot clear of "All steps".
  - **homie core API (for #35):** `HomieMoment` takes `options: []`, `bars`, `prompt`, `tapToClose` (`isCentredMoment`); store `dismissMoment`, `MOMENT_DISMISS`, `shrunk`, `MAX_LIT_MS`, `useHomieSelect`; logic `askFrame`, `HOMIE_ASK_SIZE`, `ASK_POT_GAP`, `ASK_SIDE`, `barHeights`, `BAR_MAX`, `SHRUNK_SCALE`, `halfDuplex`; hooks `useHalfDuplex` (`useAiSpeaking` stays, for what the screen shows); `components/homie/ListeningBars`. `lib/live/mic`: `useMicStream(onChunk, onLevel)` keeps its shape (`onLevel` is an API change to the core's mic.ts, now zeroed with the frames), and `stop()` returns a promise, as in #35.
  - **Tests:** `test-voice-ui.mjs` 27 pass (4 new: memorial, phone reads, app-only moments, the contract's messages; the yes/no test now follows #42's rules), `test-homie.mjs` 34 pass (3 new: the lit watchdog, half duplex). tsc, lint, every app test script and `test-profile-navigation` pass. Expo web at 390x844 (375, 393, 375x667, Reduce Motion), 34 checks: the pot clear of "All steps", the chips, the pill counting down with the ring, lit then speaking with "AI voice", a help tap with no moment, the shrink, every moment (modal), no blink after one, a chip's spring, a tap that closes without saving, "Read it to me" keeping yes.
  - **Open:** nothing run on an iPhone or against the live voice service yet. The server side is #42 (merged, not deployed): deploy it before an EAS Update brings this to phones, since the service that's live now takes a "no" as something to answer. The service keeps a kid's answer 3 h on its instance, so after a tap ("not now" for that visit on the phone) the next visit within 3 h gets no offer either. While an app moment is up, #42 holds only a whole yes or no ("yes", "yes please", "play it"): "yes, play it" plays her voice note on the phone but also reaches homie's AI. The phone's spoken yes and no now follow the service's own rules (`yesNo`: its `isYes`, and its whole-reply no, which wins). `TODO(caleb)`: the no-mic buttons "Hear it" and "Play it" (the spec names only "Read it to me"). The answer moment matches "my" questions by the asker's name or the ids this cook mode sent. Owned by #35 (core review): on parent Home the pot rests left of the name pill (`namePillWidth`) on the date line, so its header should keep the date clear of it; and chat hides homie instead of resting it left of the header's faces.
- Oct 24 · #36 · Claude · Track I-kid round 3: verifier fixes, the phone side of Cartesia credit fixes A and B, and
  main merged (#35, #44, #45; mic.ts merged clean, so `/record` keeps its zeroed frames; AGENTS.md and STATE.md
  kept both sides).
  - **No stuck 'thinking' after a decline:** the service's echo of the phone's own text (a tapped "no") no longer
    turns thinking on, `offer_closed` ends it, and a whole yes or no the service holds (an app-only moment up) or
    answers with silence (a no to its own offer) doesn't start it (`voiceLogic` `thinksAfter`, `wholeYesNo` = the
    service's `yesOrNo`, `endsThinking`).
  - **`offer_closed` always counts:** the moment closes if it's still up, and the service's answer is kept whenever
    the phone's differs, even after the phone moved on (`readAfterOfferClosed`).
  - **Credit fix A (phone):** `lib/live/mic` passes `quiet` with each frame; `/cook` gets nothing for a quiet frame
    or while another screen is on top (`cookSendsFrame`). The recorder keeps running and the level stays 0.
  - **Credit fix B (phone):** AppState background or inactive closes the `/cook` line and stops the mic quietly (no
    retries, no error); back on top on the cook screen it reopens, with the mic only if the kid hadn't turned it off
    (`appStateStep`). The mic's own permission prompt isn't a pause (`micAsking`). Auto start waits for the
    foreground. **No idle timeout while the cook screen is open (Caleb, Oct 24):** hands-free matters more (a kid
    may say nothing for minutes while something simmers), and there are 1.24M Cartesia credits; the service's own
    2 min Ink idle close (#44) covers true silence.
  - **Tests:** `test-voice-ui.mjs` 36 pass (9 new: a whole yes/no checked against `voice/src/cook.ts`'s regexes,
    thinking x3, `endsThinking`, `readAfterOfferClosed`, fix A, fix B x2). tsc, lint, every app test script and
    `test-profile-navigation` (6 ok) pass on the merged code; kid2 web shots without the driver: 14 pass. Live: Expo
    web against a local voice service from main (`VOICE_STUB=1`, real Ink 2 and Sonic), a fake recorder feeding
    real speech through `lib/live/mic` (temporary, not committed), 25 checks pass: no frames reach the service while
    homie greets, offers or says the help line (its log: 0 frames from the greeting to the tap); a tap declines, the
    pot is never 'thinking' (0 ms; with the old code 4.1 s+); "next step" said out loud moves the step; background
    closes the socket with no frame after it; foreground reopens and frames flow; a muted kid's line reopens with
    0 frames. The old code reproduced the stuck thinking in the same run.
  - **Open:** nothing on an iPhone yet (real AppState, the permission prompt, iOS 'inactive' sheets). A kitchen timer
    the service set dies with the socket in the background; the phone still counts it down and buzzes. Each reopen
    is a new service session, so a kid who never answered the read offer hears the hello and the offer again.
- Oct 24 · #36 · Claude · Track I-kid round 4: one `/cook` socket at a time, and main merged again (#33; AGENTS.md
  and STATE.md kept both sides, no app/ overlap).
  - **The race (verifier):** a dropped socket's retry (1.5 to 4.5 s) survived a pause, so background and foreground
    inside that wait opened two sockets and left one open, still driving homie. A pause and resume while a connect
    waited for its Convex session did the same. Now each hang-up (`stop()`) starts a new line, and a retry or a
    connect opens a socket only on the line it began on, and only with none open (`voiceLogic` `lineMayOpen`). Only
    the current socket's messages and open are heard, as in `lib/live/homie.ts`.
  - **Tests:** `test-voice-ui.mjs` 39 pass (3 new: `lineMayOpen`, drop then pause then resume before the retry,
    pause and resume during the first connect; the old rule fails the drop test). tsc, lint, every app test script,
    `test-profile-navigation` (6 ok) and the driverless kid2 web shots (14) pass. Live on Expo web, a proxy in front
    of a local voice service from main (`VOICE_STUB=1`, real Ink 2 and Sonic), the fake recorder (not committed):
    10 checks pass (a 1011 drop then background and foreground in the retry wait leaves one socket; a pause and
    resume during a 1.5 s session wait opens one; background leaves none, no frame after a close; a tap declines with
    no 'thinking'). The old code in the same run left sockets #2 and #4 open until the page closed.
- Oct 24 · #47 · Claude · Fixes to #42 (from the verifier, five rounds): the kid's everyday yes and no. New `voice/src/yesNo.ts` is the one rule for the moment hold and the read-aloud offer, and follows the app's `yesNo` (#36): a yes word (yes, yeah, sure, of course) is a yes whatever follows ("Sure, read it.", "Yes, but how much ginger?"). "Okay", "ok", "alright" and "please" with more after them are a yes too ("Please do.", "Okay, let's do it."), and only they have the exception: with a command or a question after them it goes the usual way ("Okay, what's the next step?", "Okay, set a timer", "Please go back"). It adds the spoken no's with more after them ("No, not right now.", "Nah, I'm good.", "Don't.", "Oh, no thanks.", "Yeah, no."), and a no wins. "Not yet", "not really", "later", "skip it" and "I'm good" count only alone, so "Not really sure how much salt." and "I'm good at this." go the usual way, as do "No clue how much ginger.", "Don't forget the timer." and "Oh no, I burned it!". A command right after a no still runs (`afterNo`): "No, next step." declines the offer and moves the step silently, also with a moment up. Second round: decided "Yes, but how much ginger?" is a yes and "No, it's fine." a no. Every spoken no sends `offer_closed` (accepted false). Tests: voice 45 (8 yesNo tests, 3 new cook tests), typecheck passes. Live on fresh stub servers (real Ink 2, Sonic and Claude), with eight recorded lines (`sure-read-it`, `yeah-go-ahead`, `no-not-now`, `nah`, `dont`, and new `please-do`, `oh-no-thanks`, `no-next-step`): "Please do." accepted the offer and read step 1; "Oh, no thanks." sent offer_closed false 9 ms after the transcript, and a later "Yes." didn't turn reading on; "No, next step." sent offer_closed false, then go_to_step 2, silent and without Claude. With a moment up, "Please do." and "Oh, no thanks." were held, "No, next step." moved the step without Claude, and once the moment closed "Yes." accepted and read the step. Third round: any question, command or 3+ word statement after the no runs too ("No, I'm out of ginger. Can I skip it?", "No, the oil's too hot?", "No, go to step 3.", "No, play the video.", "No, tell me the story."): the offer is declined (offer_closed false) and the rest goes the fast path or to Claude, also with a moment up. More no isn't passed on ("No, thanks.", "No, not now.", "Nah, I'm good.", "No, maybe later."). Voice tests 48 (2 new yesNo tests, 1 new cook test). Live on a fresh stub server (real Ink 2, Sonic and Claude) with a new recorded line `no-ginger` during the read offer: offer_closed false 3 ms after the transcript, then Claude's hint about skipping the ginger and "I'll ask Grandma too." Fourth round: a "no need" no is only the no. The no now keeps the "no" of "no need", "no point" and "no reason", so "No, no need to read it.", "Nope, no need to read it out loud.", "Nah, no need for that.", "No, no need to play it." and "No need to read it." decline the offer and pass nothing on (before, Claude got "need to read it" and could read the step aloud), and "Nah, no need, next step." still moves the step. More ways to say only the no: "No, I'm all right.", "No, I got it.", "No, I've got it.", "No, I can do it.", "No, I'm good on that.", "Nah, I'm fine with that.", "No, you don't have to.", "No, I'm good, thank you so much." A mixed signal stays as said: "No, just read it." declines the offer and passes "read it" on to Claude. Voice tests 50 (2 new yesNo tests; the cook test for everyday no's has the four "no need" lines), typecheck passes. Live on a fresh stub server (real Ink 2 and Sonic), with a new recorded line `no-need` during the read offer: "No, no need to read it." sent offer_closed false 1 ms after the transcript, with no read-aloud and no Claude call. Fifth round (structural): Claude never gets the words after a no on their own, since cutting the no could flip what was left ("No point in reading it." became "in reading it", "No, no need at all to read it." became "at all to read it", and Claude could read the step). The no is handled first (offer_closed false, or the moment hold), then `afterNo` only says whether more was said: a plain command right after it still takes the fast path ("No, next step.", "Not now, set a timer for 5 minutes."; a timer only as the whole ask, so "No, don't set a timer…" goes to Claude), anything else goes to Claude as the kid's whole sentence with a note that the offer was just declined (`TurnAgent.turn`'s new `note`; with a moment up, that the no was the screen's), and more no is nothing. Reading can't come on from that turn (the decline is set first). A short reply after a no that isn't a known filler ("No? Fine.", "No, too salty.") now costs one Claude turn. Voice tests 51 (the afterNo tests rewritten; 2 new cook tests: the verifiers' ten replies, and a Claude that calls repeat_step anyway can't turn reading on), typecheck passes. Live on fresh stub servers (real Ink 2, Sonic and Claude) during the read offer: `no-ginger` sent offer_closed false 3 ms after the transcript, then Claude's hint about skipping the ginger and "I'll ask Grandma too.", nothing read aloud; `no-need` sent offer_closed false 2 ms after it, then nothing (no Claude call). As the app's text answer, "No point in reading it." and "Nah, no need really to read it." sent offer_closed false, and Claude, given the whole sentence and the note, said nothing.
  - **Open:** where the app's `yesNo` (#36) still differs. It takes a no only as the whole reply, so "No, not right now.", "Nah, I'm good." and "Don't." don't answer its moments (the service holds them, so nothing happens). It takes "okay" plus a question as a yes ("Okay, what's the next step?": the app's yes and the service's Claude turn both act), and "Yeah, no." as a yes. Changing that is #36's call; no app changes here. The kid app (#36, `app/src/lib/live/voiceLogic.ts` `wholeYesNo` / `thinksAfter`) still copies the old `yesOrNo`, so replies the service now holds during an app moment ("Sure, read it.", "No, not right now.", "Don't.") can leave the pot 'thinking' for up to 10 s (`THINKING_MAX_MS`) until #36 adopts these rules. Not deployed (`voice/deploy.sh`).
- Oct 24 · #49 · Claude · homie's voice, Caleb's pick ("i like riya as well"): "Riya bilingual" `930eda72-c1af-4637-8d07-87d881d615fe` on both sides and `/speak`, asked for exactly as auditioned (`voice/src/sonic.ts`: `sonic-3.6`, Marathi `locale: mr-IN`, English `locale: en-IN` with a mood per line kind, one speed 0.85 via `HOMIE_SPEED`, 24 kHz; the per-call speeds are gone). `/speak` takes an optional `kind`. Cousin wording for the fixed English lines and a tone rule in the Claude prompts (homie is feminine in Marathi and Hindi; end questions get no second lead-in); the Marathi fixed lines changed only punctuation and sentence breaks. New `voice/src/geminiTts.ts`: when Sonic fails before any audio (HTTP error, network, nothing in 4 s), Gemini TTS (`gemini-3.8-flash-tts`, voice `en-in-assistant-3`, 24 kHz l16, `store: false`) says the line; after audio started, no splice. App check: #36's `offerOf` keys on `kind` plus "story" in a nudge, so the story nudge is unchanged; nothing on main keys on homie's wording. Memory: `homie-voice.md`, `cartesia-credits-for-tests.md`; MERGE-PLAYBOOK's voice check is now a live run. Tests: 50 unit (new `test/tts.test.ts`, 11/11 mutants caught); live with real Cartesia on the stub: kid client 5/5 turns, `test-record` Marathi ×3 and English ×2 PASS, 41 Sonic requests all Riya + 0.85 (mr-IN without emotion, en-IN with), forced fallback (invalid key → 401) spoke 7 lines with Gemini in Marathi and English; listening samples in Claude's scratchpad `voice-final/`. Open: TODO(caleb) native Marathi check of `lines.ts` (and "श्रेया साठी" is written apart); not deployed, needs `voice/deploy.sh` after merge.
- Oct 24 · #49 · Claude · verifier fixes to homie's backup voice: `voice/src/geminiTts.ts` has its own guard (first audio within 6 s, the whole line within 10 s + 100 ms a character), so a stalled Gemini ends the line (`say_end`, the mic opens again); no audio, `interaction.failed` or a failed status throws, so `/speak` answers 502 (the app's `speak.ts` then uses the phone's voice) instead of an empty 200 WAV; an abort now rejects like Sonic's. One exported `wavHeader(bytes, rate)`, used by `speech.ts` too. `homie.ts`: the tone rule no longer interpolates her (native-script) name, and `text_en` writes names in Latin letters. Tests: 55 unit (new `test/fallback.test.ts`: say_end after a Gemini stall, `/speak` 502; tts.test.ts: the 6 s guard, the whole-line cap, empty and failed streams); live on a fresh stub server: `test-record` Marathi PASS with Sonic (6 lines, Riya mr-IN 0.85, every `textEn` in Latin letters), and with an invalid Cartesia key Gemini said all 6 recording lines plus `/speak` in Marathi and English (24 kHz WAVs, 2.1–2.3 s). Not deployed.
- Oct 24 · #36 · Claude · Track I-kid round 5: verifier fixes, and main merged (#47, #49; STACK.md and STATE.md kept
  both sides, no app/ overlap).
  - **Timers survive a reopen (verifier):** the service starts its timer ids again at `timer-1` on every socket, and
    a pause and resume opens a new one, so a new "timer-1" replaced one still counting down (rice 4:48 became eggs
    9:59, no buzz). The phone now keeps timer ids per socket (`voiceLogic` `socketTimerId`, `parseTimer` and
    `withoutTimer` take the socket, counted up on each open; `timerKey` is gone). A timer from an older socket keeps
    counting down and buzzing on the phone and leaves on its own after "Done" (`TIMER_DUE_HOLD_MS`), since that
    socket's `timer_done` can't come; a `timer_done` takes only its own socket's timer.
  - **Only the background closes the line:** iOS 'inactive' (Control Center, the notification shade, a call banner,
    the mic's permission prompt) leaves the app on screen, so it no longer closes `/cook` (`appStateStep`,
    `appInForeground`); 'active' after a pause reopens it as before.
  - **The service's yes and no on the phone (closes #47's open item):** `voiceLogic` `yesNo` and `afterNo` are a
    copy of `voice/src/yesNo.ts` (same rules), replacing the old `yesNo` and `wholeYesNo`, so the phone's own
    moments (`CookMoments`) and the service agree ("Sure, read it.", "No, not right now.", "Don't." now answer
    them). `thinksAfter` starts 'thinking' only when the service will answer: not for a yes, or a no with nothing
    more, while an app-only moment is up; yes for more after a no ("No, I'm out of ginger. Can I skip it?", "No,
    next step.", "No point in reading it."); not for a no with nothing more to the service's own offer.
  - **Tests:** `test-voice-ui.mjs` 40 pass (#47's phrase lists for yes, no, neither, a command after a no, more after
    a no and only the no, each also checked phrase for phrase against `voice/src/yesNo.ts`; thinking x3 rewritten;
    timer ids per socket; 'inactive' is no pause, background then active is one pause and one resume). tsc, lint,
    every app test script and `test-profile-navigation` (6 ok, this worktree's Expo web) pass. Live on Expo web
    against a local voice service from main (`VOICE_STUB=1`, real Ink 2 and Sonic) with the temporary e2e hook (not
    committed), 10 checks pass: a 25 s rice timer on socket 1, background and back (socket 2), a 10 min eggs timer
    ("timer-1" again) keeps the rice as the pill and the ring; the rice reaches "Done" with the pot's timer state,
    no `timer_done` for it, and leaves on its own while the eggs keep counting (9:28); a pasta timer (`timer-2`) on
    socket 2 leaves with its `timer_done` and the eggs stay.
  - **Open:** nothing on an iPhone yet (real AppState and 'inactive' sheets). An older socket's timer only buzzes on
    the phone: homie doesn't say the rice timer is done for it. Each reopen is still a new service session.
- Oct 24 · #36 · Claude · Track I-kid round 6: verifier fixes (main already merged: nothing new on it).
  - **Each timer buzzes once (verifier):** the due-timer effect picked "any timer but the last one due", so two
    timers held at zero together (old-socket timers after a pause, which get no `timer_done`) bounced A, B, A, B
    with `setTimeout(0)`, buzzing and queueing a removal on every pass (4,262 buzzes in 10 s). `lib/live/voice`
    now keeps a Set of the ids that already buzzed; `voiceLogic` `timerBuzz` picks the soonest timer still to buzz,
    says whether one that buzzed is still on screen (the pot's timer state), and drops ids whose timer left.
  - **`appStateStep` drops `asking`:** 'inactive' never pauses, so the field and `lib/live/mic`'s `micAsking`
    (used nowhere else) are gone.
  - **Tests:** `test-voice-ui.mjs` 42 pass (new: two timers at zero together buzz twice in all; a `timer_done` for
    one leaves the other buzzed and on screen; a new timer after both left buzzes once). tsc, lint, every app test
    script and `test-profile-navigation` (6 ok, this worktree's Expo web) pass. Live on Expo web against a local
    voice service from main (`VOICE_STUB=1`, real Ink 2 and Sonic) with a temporary e2e hook and buzz counter (not
    committed), 21 checks pass: the verifier's dal 9 s and beans 10 s on socket 2, then a reopen, buzz once each
    (2 in all, was 4,262), the pot stays "timer" and the beans stay "Done" after the dal leaves; two 8 s timers
    0.6 s apart, once each; a new timer after both left, once; six timers in the run, one buzz each.
  - **Open:** a timer on the open socket can leave without a buzz: its `timer_done` lands at the same moment as
    the phone's own zero (both 5 s after the `timer` message) and takes it first (2 of 3 live runs; homie still
    says it's done). Not changed here (it was so before); nothing on an iPhone yet.
- Oct 24 · #51 · Claude · iPhone test fixes (Caleb on TestFlight, sample dish Auntie Lin's scallion pancakes): (1) the phone's read-aloud repeated step 1 on every step: speak.ts reused file names (homie-say-<turn % 3>.wav, and a step change moves turn by 3, so always the same name) and lib/media reuses a player whose URL is unchanged, so the old audio played. Each line now gets a new file name (the last 3 are kept). (2) On a dish the voice service doesn't have (any sample library dish), a tap on homie no longer opens the live line and says "homie can't cook this dish by voice yet": the line isn't tried, and while the phone reads, a tap reads the current step again. Checks: app tsc, lint, every app test script.
- Oct 24 · #52 · Claude · Cook mode timers: a `timer_done` before the phone's own zero buzzes (closes #36 round 6's
  open item), and the Oct 24 live deploys recorded.
  - **The fix:** on the socket that's still open, the service's `timer_done` usually arrives before the phone's
    own zero (both are 5 s after the `timer` message), and it took the timer away before it buzzed: no haptic, no
    pot "timer" or "Done", though homie still said "Hey, the rice timer is done." `voiceLogic` `timerDone` now
    buzzes a timer that hasn't buzzed yet (it stays, at zero, "Done", and leaves `TIMER_DUE_HOLD_MS` later like any
    buzzed timer); one that already buzzed leaves at once, as before. `lib/live/voice` has one `buzzTimer` for both
    (it skips an id that already buzzed, so the phone's own zero right after can't buzz it again) and keeps the
    timer list in a ref, so `timer_done` reads the current one.
  - **Deploys (Caleb: "Yes: deploy Convex, the voice service and homecookd.app now; only the EAS Update waits for
    #36"):** Convex `grand-dragon-649` and the voice service revision `homecookd-voice-00004-nv4`, both from main
    `f28173a1f` (see Live infrastructure). The EAS Update with #36 is still to come.
  - **Tests:** `test-voice-ui.mjs` 45 pass (new: a `timer_done` before the zero buzzes once and shows "Done"; one
    after the phone's buzz never buzzes again; two timers, one done early, buzz once each). tsc, lint, every app
    test script and `test-profile-navigation` (6 ok, this worktree's Expo web) pass. Live on Expo web against a
    local voice service from main (`VOICE_STUB=1`, real Ink 2 and Sonic) with a temporary e2e hook and buzz
    counter (not committed): three 5 s timers ("set a timer for 5 seconds" as text); each `timer_done` came first
    (4.98 to 5.0 s after the `timer`) and buzzed it, one buzz each, the pill said "Done" and the pot showed
    "timer", and each left 10 s later.
  - **Open:** nothing on an iPhone yet. On Expo web a real line's audio throws in `lib/live/say` (expo-file-system's
    `File` isn't there on web); web never opens a real line without a hook, so it only matters for live web tests.
- Oct 24 · #50 · Claude · Voice hint latency and crash paths (from the Merge Agent's live test). Latency: main already did a hint and its ask to the cook in one tool (`give_hint` carries the question; the `[stub] question asked_cook` log line is the Convex write, not an `ask_cook` call). The slow part was a `find_moment` round trip whenever the search before Claude found nothing (always in the stub, whose index was deleted), plus 25-30-word hints. Now the message says the search found nothing and Claude doesn't search again, so a question is one call; the hint is under 15 words; the stub's `mossIndex` is `""` (no Moss); a missing family index isn't asked for again for 60 s; a search never holds a turn past its wait. Live, `CLAUDE_FAST=1`, merged with #49: hint first audio 1.7–2.4 s after the transcript (main 2.9–4.2 s), "I'll ask Grandma too." 8.0–9.7 s (main 11.6–14.1 s), 0.24–0.32 s after the hint ends; a plain ask 1.3–1.4 s (main 2.9–6.8 s). Standard speed and before/after tables in the PR. Crashes: each of these ended the whole process on main, and now doesn't: a text frame `null` on `/cook` or `/record`, a frame over 1 MiB, a text frame that isn't UTF-8 (no `'error'` listener on the socket), a `/speak` caller hanging up mid-body, a reset after a refused upgrade, and a question write failing while the hint plays (unhandled rejection). A failed action also left a `tool_use` with no `tool_result`, so Claude refused every later turn (400). New `voice/src/safety.ts`: each socket's errors are logged with its id (`cook-3`); an unhandled rejection never exits, an uncaught exception logs and exits for a clean Cloud Run restart (installed only when `server.ts` is the program). The Merge Agent's silent death wasn't reproduced (Moss stressed with 200 searches on missing indexes; no stack in its log, which fits the `pkill -f 'tsx src/server.ts'` another agent ran). Tests: voice 87 (new `agent.test.ts`, `hint.test.ts`, `server.test.ts`, which spawns the service and sends each crash input), typecheck passes; on main's code the new server and agent tests fail. Live with real Ink 2, Sonic and Claude.
  - **Open:** the ask line still waits for the whole hint to play (6–7 s); saying "I'll ask Grandma" first or inside the hint's line would land it at ~2 s but changes the hint/`asked_cook` contract (Caleb's call). Some unanswerable questions now get a hint plus the ask where main's `find_moment` result steered them to a plain ask. Not deployed (`voice/deploy.sh`).
- Oct 24 · #50 (verifier fix) · Claude · The up-front search waits 2 s; on a fresh server the family index can take longer to load, and an empty result told Claude the video had nothing, so it gave an AI hint restating the cook's own tip (seen live on the Pawar index). An empty result that took the whole wait now says the search didn't finish, and Claude uses find_moment (15 s) first. Test: voice 88/88.
- Oct 24 · #PR · Claude · homie says hello once, and a line for the Messages tab (Caleb's two asks).
  - **Hello once:** a tap on the pot on a screen without its own line said "Hi, I’m homie." every time. Now it says
    it the first time for each person on this phone, then "I’m right here." (`lib/homie/intro.ts` `takeTapLine`,
    kv `homie.introduced.<profileId>`, so it lasts across restarts). The recording hello counts as the
    introduction too (`lib/live/homie` `markIntroduced`). Memory: `docs/agents/memory/homie-hello-once.md`.
  - **Messages tab:** a tap on the pot on parent Messages says "These are your messages. Tap one to talk to family."
    (`HELP.messages`, `homieRoute('/parent/messages')`).
  - **Tests:** `test-homie.mjs` 40 pass (new: the hello once per person and after a restart, two quick taps, the
    recording hello, screens with their own line, every line at most 10 words). tsc, lint, `test-recording-ui`,
    `test-cooking`, `test-voice-ui` pass. Expo web (`?as=`): Messages said its line and stored nothing; Leo on
    kid Home heard the hello, then "I’m right here.", and "I’m right here." again after a full reload.
  - **Open:** the voice service's recording hello still says "I'm homie" on every recording (a voice change and
    deploy). Kid "Ask" keeps the default lines. Not on an iPhone yet (JS only: an EAS Update covers it).

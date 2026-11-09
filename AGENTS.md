# AGENTS.md — homecookd

This is the one instructions file for every agent working in this repo. Codex reads it directly, and Claude Code
loads it through `CLAUDE.md` (which only says `@AGENTS.md`). Several models and people work here: Caleb uses
Claude Code and Codex, and Salik (CTO, GitHub `salikm1234`) also pushes and deploys. Shared memory lives in
`docs/agents/`, not in any one tool's private memory.

`app/AGENTS.md` (Expo) and `web/AGENTS.md` (Next.js) add rules for those folders, and they still apply.

## Shared context protocol (every model, every task)

**Before you start:**
1. `git fetch` and read the **Change log** at the bottom of `docs/agents/STATE.md`.
2. Run `git log --oneline <last logged commit>..origin/main`. Any commit there was made by someone who didn't
   log it, maybe another model or Salik. Read those diffs before building on top of them.
3. Read `gh pr list` for open work, so you don't edit the same files twice.

**In every PR that changes the codebase**, also update the shared files in the same PR:
- `docs/agents/STATE.md`: add one Change log line (date, PR number, who: Claude / Codex / Salik, what changed,
  and anything left open). Fix any section above it that's no longer true (live versions, blockers, next work).
- `AGENTS.md`: update it when a rule, command, layout or workflow changes.
- `docs/agents/memory/`: when Caleb gives a lasting preference or decision, add or update one file there
  (one fact per file, dated, with **Why** and **How to apply**) and its line in `docs/agents/README.md`.
- If nothing shared changed, still add the Change log line.

Never keep project context only in a tool's private memory: the other model can't read it.

## What homecookd is

A parent records themself cooking a family dish. homecookd turns the videos into a recipe the kid can follow:
steps, "feel" amounts made concrete, and the stories told along the way, each linked to the moment in the video
and the cook's own voice. There are two customers, about 1:1: parent cooks in their 50s–60s who aren't techy,
and homesick college kids. It's a family product, not a tool.

## Where the truth lives (read in this order)

**Next version (Oct 29 on):** `docs/PRD-V2.md`, the user pathway the next version of the app is built around
(kid on the web → Ask Mom → parent answers by voice → film in the app). Every new screen, flow and piece of copy
follows it, and it wins over the docs below on UI/UX and flows.

**AWS backend work (since Oct 31):** read `docs/build/SYSTEM-DESIGN.md` first. It sets how the backend must be built, and
`docs/build/AWS-MIGRATION.md` says what moves and when. A PR that breaks one of its rules says so and explains why.

0. `docs/build/STACK.md`: **the hackathon stack and build plan** (Convex, live voice service, Cartesia, Moss, Claude,
   Muse Spark, glasses), the contracts between the pieces, and the 2-day build order. It beats everything below
   where they conflict. The data model is `convex/schema.ts`.
1. `docs/agents/STATE.md`: what's live, what's open, the change log.
2. `docs/build/SPEC.md`: app architecture and the binding brand-rename banner.
3. `docs/build/API.md`: Supabase `api` edge function routes, auth, errors and the security model (frozen: see STACK.md).
4. `docs/build/RETENTION-HANDOFF.md` and `RETENTION-WIRING.md`: the retention features (shipped Oct 18).
5. `docs/build/FEEDBACK-OCT16c.md`: sign-in and invites. It beats SPEC.md where they conflict.
6. `docs/design/hearth-bible/`: "the bible". Match the app UI almost 1 to 1. Motion: `docs/design/ANIMATIONS.md`.
   **`docs/brand/` (the egg kit, Oct 30) wins over the bible for the logo, the mascot and the colors**: tokens in
   `docs/brand/tokens/`, rules in `docs/brand/BRAND-HANDOFF.md`, and Caleb's palette rule in
   `docs/agents/memory/brand-egg.md` (yolk main, dark green second, cream, ink; no lavender or peach).
7. `docs/agents/memory/`: Caleb's preferences and decisions (index in `docs/agents/README.md`).
8. `docs/HACKATHON-SPEC.md`: the **original hackathon spec** (Oct 11), which used to be `CLAUDE.md`. Older docs and comments
   that cite "CLAUDE.md" mean this file. The data contract (section 4), the pipeline (section 5) and the design rules
   (section 7) still describe `pipeline/`. Its scope list and its "Supabase Storage" media are out of date: media now
   lives in GCS buckets (see `README.md`).
9. `docs/PRD.md`: the product source of truth. `docs/lander-*.md` covers the marketing site.

## Hard rules

- **Brand:** always **homecookd**, all lowercase, also at the start of a sentence. Never "HomeCookd", "Homecookd"
  or "Edible" in user-facing text. Live cloud names keep "edible": the Supabase project `edible`, the `edible-*`
  GCS buckets, the `X-Edible-Family` header and the `EDIBLE_*` secrets.
- **Ship via PR, never straight to main.** Branch from `origin/main`, commit, `git fetch && git merge origin/main`,
  push, `gh pr create`, then check that `gh pr view --json mergeStateStatus` is `CLEAN`. Stage files by name, never
  `git add -A`: the tree holds untracked demo PNGs and Finder " 2" duplicates.
- **The repo is public (Caleb, Nov 8, 2026)** for unlimited Actions minutes: every tracked file and the whole history can be read by
  anyone. Nothing private may be committed: no reviewer link or family code, no phone numbers or family members' personal details, no
  keys or `.env` values. The gitignored `docs/build/.test-family-link`, `.env` and `app/.env` stay untracked. A PR from a fork runs the
  workflows without secrets; never add `pull_request_target`. `docs/agents/memory/repo-public.md`.
- **Purge dead branches (Caleb, Nov 2).** Delete a branch when its PR merges (`gh pr merge --delete-branch`, or delete
  the head after). At the weekly check, delete every remote branch that has no open PR and whose commits are all on `main`,
  or whose draft was superseded by a merged PR. Never delete `main`, a branch with an
  open PR, or a permanent section chat's worktree branch (`claude/aws-backend-b65c64`, `claude/in-app-recording-4c5510`,
  `claude/pipeline-times-cover-8be573`, and any other a chat works from). Deleting is remote-only; a merged PR's branch
  can be restored from its page. On Nov 2 the Master Agent deleted 273 such branches (281 → 9, list in PR #281).
- **Section chats (Oct 26):** since Nov 5 they run in Terminal tabs, not the desktop app; `~/homecookd-chats.command`
  (on Caleb's Mac, untracked) reopens the Master Agent, every section chat and a text copy of the work tracker. Each codebase section has one permanent Claude chat that owns it (Voice & homie,
  Pipeline & recipes, Convex & accounts, App screens & recording, App Store, web & builds, and since Oct 29
  Notifications & linking, since Oct 31 AWS backend). Work goes to the owner of the files it touches: `docs/agents/memory/section-chats.md`.
- **The Merge Agent approves every PR.** After `gh pr create`, send the PR (number, link, branch, files touched,
  one-line summary) to the Claude Code session titled **Master Agent** (Claude Code: `ListAgents`, then
  `SendMessage`; Codex or Salik: ask Caleb to pass it on). Don't merge until it approves. When PRs conflict, the
  Merge Agent decides how they merge, and its call is final. How it reviews, orders and resolves PRs, and what a PR
  message should contain: `docs/agents/MERGE-PLAYBOOK.md`.
- **Supabase is frozen for the hackathon.** It keeps today's sign-in, invites and older screens running; build new
  features in Convex (`docs/build/STACK.md`).
- **Deploying the `api` edge function** (Supabase project ref `bsudybxsqvtwftsdmwmz`, verify_jwt false):
  deploy only from merged main, apply that release's migrations first, and send **every** file in
  `supabase/functions/api/`, or the routes from the missing files go down. Check the live version first. Salik also
  deploys, so check with Caleb that Salik's work is merged and no deploy is in flight, and log the new version in
  STATE.md. After a deploy, run:
  `node supabase/tests/two_sided_live.mjs`, `node app/scripts/api-smoke.mjs` and `node supabase/tests/retention_live.mjs`.
  They need `docs/build/.test-family-code` (gitignored). Use only the TEST family.
- **Secrets:** never put a Gemini, Cartesia, Moss, Anthropic or Muse key, a Supabase service key, a GCP
  credential or `LINK_JOIN_SECRET` (Convex and Supabase share it to sign join tickets) in `app/` or `web/`, or in any tracked file. `EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` values ship to users.
  Never print `.env` values. Keys live only in the gitignored root `.env`, Convex env, Cloud Run secrets and
  Supabase edge-function secrets (which key goes where: `docs/build/STACK.md`, "Keys").
- **Where the checkout lives (Nov 2):** `/Users/calebwang/GitHub/homecookd/homecookd`, outside iCloud, next to
  `homecookd-backups` in the same `homecookd` folder (Caleb dropped the `hackathon-` from the folder name and, on Nov 2,
  renamed the GitHub repo to `calebwang26/homecookd`; the old repo URL redirects). The old
  `~/Documents/GitHub/hackathon-homecookd` symlink was deleted on Nov 5, once the chats moved to the terminal and
  reopened from the real folders, so nothing of homecookd is left in iCloud. Every tracked file, script, `.env` link
  and worktree's git metadata names the real path. Never put the repo back under `~/Documents` (or any iCloud folder): iCloud evicts files there
  ("dataless"), and git, rsync and `mv` all hang on them. The worktrees' installed packages (`node_modules`, `.venv`,
  `web/.next`) were not copied in the Nov 1 move: run `npm ci` in a worktree that needs them.
- **One `.env` for every key:** `/Users/calebwang/GitHub/homecookd/homecookd/.env` (the main checkout).
  Add or change keys only there. A worktree never gets its own copy: link it with
  `ln -s /Users/calebwang/GitHub/homecookd/homecookd/.env .env` from the worktree root. Only `app/.env`
  (public `EXPO_PUBLIC_*` settings) and `web/.env.local` (written by the Vercel CLI) stay where their tools read them.
- **Cartesia (voice):** Ink and Sonic run in the live voice service, plus a Convex action for voice-note
  transcription. Send `Cartesia-Version: 2026-08-14` on every call, and read https://docs.cartesia.ai/llms.txt
  before guessing fields or voice ids. A cloned voice needs that person's consent (`people.voiceClone`).
  homie's voice (Riya bilingual), its locale fields, speed and moods are Caleb's pick (`voice/src/sonic.ts`,
  `docs/agents/memory/homie-voice.md`): change them only after he has heard samples. Sonic's previous model
  (`sonic-3.5`, same voice) is the backup when Sonic fails before a line starts, and the phone's own voice after
  that (say_end `failed`). Key check: `node scripts/check-cartesia.mjs`.
- **homie's voice is switched off (Oct 29, for launch):** `app/src/lib/homie/switch.ts` `HOMIE_ON = false` hides the
  pot, homie while filming and voice cook mode; no code is deleted, and turning it back on is that one line, Caleb's
  call (`docs/agents/memory/homie-off.md`). New app code must work with the switch either way.
- **Live Cartesia tests are encouraged.** We have the credits (1.24M on Oct 24), and Caleb wants them used to check
  voice quality, so `test-client` and `test-record` stream to real Ink 2 and Sonic by default. `FAKE=1` against
  `npm run dev:fake` (`VOICE_FAKE_SPEECH=1`: no Cartesia or Gemini Live) is an opt-in for quick offline checks. Every
  run stops at `MAX_S` (default 15 min) only so a stuck run can't stream for hours. The waste worth cutting is in real
  use (a socket left open streams silence at 3 credits a second), not in testing. A PR that touches `voice/` gets a
  live run in Marathi and English before it's done (`docs/agents/memory/cartesia-credits-for-tests.md`).
- **Off Gemini (Oct 25 on):** Gemini credits are nearly gone, so new model calls use Claude (text, images) or
  Cartesia (audio), never Gemini (`docs/agents/memory/gemini-credits-nearly-gone.md`). Existing Gemini and Muse calls
  move one PR at a time behind env flags, with today's model as the rollback: `TEXT_PROVIDER=claude` (Convex env and
  the worker's `.env`) moves the text calls, `COVER_PROVIDER=claude` (the worker's `.env`) the cover pick,
  `ALIGN_PROVIDER=claude` the substep times, `EXTRACTOR=claude` the video extraction, `TRANSCRIPT_PROOFREAD=claude`
  the proofread of a non-English transcript, `RECIPE_WRITER=claude` (the worker) the recipe writer and
  `WRITER_PROVIDER=claude` (Convex env) the story cards and the photo note; the pipeline needs `GEMINI_API_KEY` only
  while a step is still on Gemini. The glasses (`edible-glasses/`) stay on Gemini, and Odia is hidden from the cook
  language picker (Caleb, Oct 26). Pick models quality-first, then the cheapest that holds it
  (`docs/agents/memory/claude-cartesia-quality-first.md`). Flipping a flag in production is Caleb's call.
- **Moss (search):** filled from Convex, searched from the live voice service; one index per family
  (`family-<familyId>`). Moss only finds moments: never use Moss Inference to write answers
  (https://docs.moss.dev/llms.txt). Key check: `node scripts/check-moss.mjs`.
- **Convex:** at the repo root (`convex/`, data model in `convex/schema.ts`). Deploy with
  `npx convex deploy --preview-name hackathon -y` (preview `CONVEX_DEPLOY_KEY` in `.env`) to
  https://grand-dragon-649.convex.cloud (HTTP routes on `.convex.site`). **Never `--preview-create`**: it deletes
  and recreates the deployment, so the URL changes and its data and env are lost. Convex env is set with the team
  token, not the preview key: `CONVEX_OVERRIDE_ACCESS_TOKEN=… npx convex env set --deployment grand-dragon-649 …`.
  `grand-dragon-649` is a *preview* deployment, and Convex deletes previews 5 days after creation unless their
  expiration is cleared. It was cleared on Oct 25 (`expiresAt: null`). After every deploy, check it's still `None`:
  `curl -s https://api.convex.dev/v1/deployments/grand-dragon-649 -H "Authorization: Bearer $CONVEX_OVERRIDE_ACCESS_TOKEN"`
  and read `expiresAt`. If it has a date again, clear it with a `PATCH` of `{"expiresAt": null}` to the same URL.
  Every public function takes the `sessionToken` from `sessions.start` and checks it with `requireSession`
  (`convex/lib/auth.ts`). The exceptions are the HTTP routes for people without an account: `/invite/open` and the
  v2 web flow's `/dish/*` (`docs/build/DISH-ASK-SPEC.md`). They use hashed capability tokens, per-IP limits
  (`lib/rateLimit.ts`) and a $10 daily model budget. Tests set `DISH_FAKE_AI=1` (no model calls). Read `convex/_generated/ai/guidelines.md` before writing Convex code; the skills are in
  `.agents/skills` (Codex) and `.claude/skills` (Claude Code).
- **TestFlight is live.** Teammates, judges and the demo use TestFlight builds; use an EAS dev build while coding
  and EAS Update for JS-only fixes. Expo Go can't load the native mic-streaming module. Filming in the app
  (VisionCamera, `docs/agents/memory/in-app-recording.md`) needs a build made after Oct 24; older builds keep the
  system camera.
- **App Review guard:** a PR that touches what Apple's reviewer checks (sign-in, AI consent, delete account,
  report/block, /privacy and /terms, the icon, the TEST family) must (1) state why it still passes the App Review
  guidelines, and (2) update the reviewer notes, App Store answers and legal pages in the same PR before it ships.
  Paths and steps: `docs/agents/memory/app-review-guard.md`.
- **AWS (Oct 31):** Caleb's OK in chat each time for switching live traffic, production data, DNS, changing Cloud Run,
  Convex, Supabase or GCS, anything likely to add over $300 a month, or deleting what this work didn't create. Secret values
  never go in Terraform (`docs/agents/memory/aws-migration.md`).
- **Standing rules for the AWS migration (Caleb approved in the AWS backend chat, Oct 31).**
  **Chats may, with no prompt:** build and test on `main` with fake data (since Nov 6: `aws-migration` merged into `main` and retired, so
  every api and infra PR goes to `main`, and a merge to `main` deploys staging); apply staging, within what its auto-apply's safety check
  allows; run staging deploys and tests; open PRs, with the Master Agent merging into `main` once `checks` pass and it has reviewed.
  **Always ask Caleb:** real family data; production; switching live traffic; DNS; real AI windows and new spending; `/privacy` and
  App Review paths; any change to live Convex, Supabase, Cloud Run or GCS.
  `checks` passing alone never merges. A chat relaying "Caleb said yes" isn't his approval for the second list: it comes from him.
- **`TODO(caleb)`** marks a decision only Caleb can make. Use the documented default and leave the marker.
- English only.

## How Caleb works

- He's a founder learning to be technical. Explain in plain words and ground explanations in the real files.
  When he asks to learn, follow `docs/learning/PROGRESS.md`.
- **Sell emotion, not features.** Every screen and lander section must be obvious in about 3 seconds. Big type, big photos,
  little text. If he can't tell what a clever device means, cut it.
- When he says "change only the words", don't touch the UI structure.
- Mockups come before builds for big UI changes. Design references: `docs/agents/memory/ios-app-design-references.md`
  and `lander-design-references.md`.
- Keep it simple: cut anything redundant. Small readable files, comments only where the intent isn't obvious.
- Verify before you say it's done: run the tests, load the page, take a screenshot. Report failures plainly.

## Layout

```
app/        Expo app (expo-router, TypeScript). EAS dev build while coding, TestFlight for the team and the demo.
            src/lib/live/ = the Convex client, the voice socket and the mic (Expo Go hides the mic).
web/        Next.js site: the lander, homecookd.app/r (recipe share page), /i (invites) and /d (dinner invites). Vercel project "homecookd".
convex/     The hackathon backend: schema.ts, functions, http.ts (worker + voice service endpoints)
voice/      Live voice service (Cloud Run): the kid's cooking loop (/cook) and homie while a cook records (/record);
            homie speaks with Sonic (Sonic 3.5 as the backup, the phone's voice last)
glasses/    ESP32 glasses → GCP VM (Python): WS ingest, MP4 mux, GCS upload, Convex job (glasses/README.md)
supabase/   Frozen: functions/api (today's sign-in, invites, older screens), migrations/, tests/
pipeline/   Python: prep.py → process.py (Gemini) → Muse Spark → publish.py, and worker.py (claims jobs from Convex)
cloud/      GCS upload signer (Cloud Run) + IAM scripts
api/        The new backend (Node, Fastify, Postgres; docs/build/SYSTEM-DESIGN.md). Nothing live calls it until each area switches (docs/build/CUTOVER.md)
tools/      media-copy: GCS to S3, refuses real buckets without its named flags (docs/build/MEDIA-MIGRATION.md); sample_library.py: the public library.json
infra/      AWS, as Terraform (infra/README.md; the plan is docs/build/AWS-MIGRATION.md). Staging only so far; nothing live runs there
scripts/    check-cartesia.mjs, check-moss.mjs (key checks), set-apple-ids.mjs (launch prep), check-merge-safe.mjs (`--bundle`: the live site's build with the switches off)
data/       sample + synthetic recipes; data/out/ is pipeline output (gitignored)
docs/       specs, design bible, QA, learning notes; docs/agents/ = shared agent state + memory
```

## Commands

```bash
# app
cd app && npx expo start --clear                                   # Expo Go on the same Wi-Fi
cd app && CI=1 npx expo start --go --tunnel --port 8082            # Expo Go over a tunnel
cd app && npx expo start --web --port 8081 --clear                 # web build of the app
cd app && npx expo start --dev-client                               # the EAS dev build on an iPhone (voice cooking needs it)
cd app && npx eas-cli build -p ios --profile development           # dev build (EAS signed in as salikm1234)
cd app && npx eas-cli build -p ios --profile production --auto-submit   # TestFlight
cd app && npx eas-cli build -p ios --profile staging --auto-submit  # internal-testers build on the staging channel (while 1.0 is in App Review)
scripts/safe-eas-update.sh staging "<what changed>"                   # JS-only fix to testers (never a bare eas update); never --channel production (that reaches public 1.0, build 6, on the old backend)
cd app && npx eas-cli build -p ios --profile aws-staging --auto-submit  # 1.1 on AWS staging (switch on), internal testers only, never attached to a version in review
scripts/safe-eas-update.sh aws-staging "<what changed>" [--check-only]  # every EAS Update goes through this: it sets the AWS switch for aws-staging and production-aws only, refuses production
scripts/safe-eas-update.sh production-aws "<what changed>" --check-only|--caleb-ok [--canary-ok "<reason>"] [--no-sim "<reason>"]  # a JS fix to production-aws phones: runtime 1.1.0 (build 18, the App Store's 1.1) from a 1.1.0 checkout, or 1.1.1 (build 21, TestFlight) from main; exactly the build profile's values, no app/.env; publishing needs Caleb's yes. 1.1.1 needs a passing ios-journeys run on the same app/ tree, nothing uncommitted in app/ (scripts/check-sim.mjs). Then 1.1.0, refused until the newest 1.1.1 group is 2 h old with the same app/src files (scripts/check-canary.mjs prints when)
node --test scripts/*.test.mjs                                     # the scripts' own tests: the canary order, the simulator gate, safe-eas-update.sh's arguments (stubbed npx), the machine-test marker
cd app && npx eas-cli build -p ios --profile production-aws --auto-submit  # 1.1 on production AWS (api.homecookd.app): the App Store build (18, released Nov 8); its JS fixes go out with safe-eas-update.sh production-aws
node app/scripts/pcm-echo-server.mjs                               # test socket for the mic (EXPO_PUBLIC_VOICE_URL=ws://<mac-ip>:8787)
cd app && npx tsc --noEmit && npx expo lint
# iOS journeys run only in CI (no Xcode on this Mac): .github/workflows/ios-journeys.yml builds the app for the simulator and runs Maestro on app/e2e/journeys/*.yaml; gh workflow run ios-journeys.yml --ref <branch> (docs/build/IOS-JOURNEYS.md)
cd app && node scripts/test-retention.mjs                          # also test-table/hearts/recap/cooking/recommend/languages/homie/voice-ui/recording-ui/parent-jobs/community-ui/who/words/signin/consent/links/doors/reminders/dish/brand
cd app && node scripts/test-sheets.mjs                             # the sheet machine and coordinator (lib/machine.ts, lib/sheets/): every state × event, afterClose on a fake clock
node scripts/check-e2e-stripped.mjs                                # the CI simulator hooks (EXPO_PUBLIC_E2E=1) never reach a store build: two cleared iOS exports (~3 min)
cd app && node scripts/test-aws.mjs                               # the 1.1 AWS client (src/lib/aws): error shapes, sessions, retries (fake fetch)
cd app && node scripts/aws-accounts-staging.mjs                    # the same client against AWS staging: read-only Accounts checks
cd app && node scripts/aws-accounts-flows.mjs                      # Accounts flows on AWS staging with test people (TEST_SIGNIN_KEY; deletes them after)
cd app && node scripts/test-aws-jobs.mjs                          # the 1.1 Jobs client and live polls (fake fetch and clock)
cd app && node scripts/aws-jobs-flows.mjs                          # Jobs on AWS staging: a real S3 upload, the job, polls, stops, cook-only (deletes test people)
cd app && node scripts/test-aws-messages.mjs                      # the 1.1 Messages client and polled reads (fake fetch and clock)
cd app && node scripts/aws-messages-flows.mjs                      # Messages on AWS staging: chat, questions, uploads, postcards, shares (deletes test people)
cd app && node scripts/aws-dish-flows.mjs                          # kids' asks on AWS staging: a web card claimed, her requests, voice recipe, dishAskId (deletes test people)
cd app && node scripts/test-aws-community.mjs                     # the 1.1 Community client (fake fetch)
cd app && node scripts/aws-community-flows.mjs                     # Community on AWS staging: feed, swaps, a dinner end to end, invite link (no reports: they email the team)
cd app && node scripts/aws-takedown-flows.mjs make|down|back|off <file>  # the team's takedown and keep on staging (AWS backend runs remove/keep between steps); make then off: share off alone
cd app && node scripts/aws-phone-run.mjs setup|finish|message|voice|delete <file>  # the staging side of a phone check (aws-phone/CHECKLIST.md): test cooks and links, finish jobs, a push, the voice note
cd app && node scripts/draft-words.mjs                             # draft the cook app's missing words in every language (Claude); then test-words
cd app && node scripts/sync-brand.mjs                             # the brand kit SVGs in assets/brand -> ui/brandSvgs.ts (test-brand checks them)

# web
cd web && npm run dev -- --port 3000
cd web && npm ci && npm run build                                  # confirm a PR's web/ builds
cd web && npm test                                                 # the site's state machines (Mom's page): every state × event (node --test, no dependency)
node web/scripts/qa/dish-e2e.mjs --base http://localhost:3105 --out /tmp/dish-e2e   # v2 /miss + /a vs the local /dish fake (site: cd web && NEXT_PUBLIC_DISH_URL=http://localhost:8791 npx next dev --port 3105)
  # the new api's uploads: add NEXT_PUBLIC_DISH_UPLOADS=links to the site and --uploads links here. Unset, as on main, the site sends raw files to Convex.

node web/scripts/qa/dish-api-e2e.mjs --base http://localhost:3105 --api <api url> --out /tmp/dish-api-e2e   # the same flow against the new api (site built with NEXT_PUBLIC_DISH_UPLOADS=links); made-up content only
node web/scripts/qa/mom-failures-e2e.mjs --base http://localhost:3105 --out /tmp/mom-failures [--expect today|fixed]   # Mom's page when the mic is denied or hangs, in an in-app browser, a refused answer, a failed Send (same site and fake as dish-e2e)
  # dish-e2e, dish-api-e2e and mom-failures use a test-only synthetic mic (scripts/qa/synthetic-mic.mjs); --mic device for Chrome's fake device, which never answers on some Macs
node web/scripts/qa/record-tour.mjs --base http://localhost:3105 --out /tmp/tour && web/scripts/qa/tour-encode.sh /tmp/tour   # re-record the lander's tour clips from /miss and /a (site: a fake-api build served on 3105, see the script)
node scripts/frame-app-store-shots.mjs [file.png ...]                # caption and frame docs/app-store/screenshots/1.1/raw/ into 1.1/ (6.9") and 1.1/medium/ (1206 × 2622); needs web/node_modules, Chrome

# convex (repo root)
npx vitest run                                                     # convex-test suites (convex/*.test.ts)
npx tsc -p convex --noEmit                                         # typecheck
npx convex deploy --preview-name hackathon -y                      # deploy (CONVEX_DEPLOY_KEY from .env)

# backend (Supabase, frozen)
npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/   # unit tests
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/*.ts              # typecheck
npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read --allow-run --allow-net supabase/tests/account_purge_sql_test.ts   # the purge's sign-up log step on real Postgres (needs .venv)

# the live site's bundle with the switches off (CI's web job; until 1.1's release, CUTOVER.md step 10)
node scripts/check-merge-safe.mjs --bundle web/out                 # after a web build with no NEXT_PUBLIC_* set: still today's site

# AWS (infra/README.md; profile homecookd, refresh with: aws sso login --profile homecookd)
cd infra/envs/staging && terraform init -backend=false && terraform validate   # no login needed
cd infra/modules/front_door && terraform init -backend=false && terraform test   # also infra/backup-copy, infra/modules/bucket_copy, infra/modules/env; no login needed
cd infra/envs/staging && AWS_PROFILE=homecookd terraform plan        # production apply: Caleb's OK

python3 infra/scripts/test_plan_check.py                                # what a merge may apply to staging by itself: every guard has a test that fails without it

# website on AWS (staging only; infra/modules/web, docs/build/WEB-MIGRATION.md)
cd web && npm run build && cd .. && node --test infra/modules/web/rewrite.test.mjs   # the URL rules against every real file in web/out
node infra/scripts/web-smoke.mjs https://homecookd.app                            # the same paths, against a running site
node infra/scripts/load-test.mjs http://<staging api>                             # the api's load test (staging, fake models): 50 RPS for 15 min, then a burst

# new backend (api/; TEST_DATABASE_URL adds the real-Postgres tests)
cd api && npm ci && npm run typecheck && npm test
docker run -d --rm --name hc-pg -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t -p 15439:5432 postgres:17   # then: cd api && TEST_DATABASE_URL=postgres://postgres:t@127.0.0.1:15439/t npm test (not localhost: on a Mac its lookup can take 5 s, and a test fails)
PIPELINE_PYTHON=.venv/bin/python   # also set this for api tests: jobsWorker.test.ts runs the real queue worker, and skips without psycopg and sentry_sdk (pipeline/requirements-queue.txt)
node dist/reports.js open          # and review <kind> <id> keep|remove: the team acting on a Community report, as a one-off api task (COMMUNITY-MIGRATION.md, "The team's reports")

# temporary sync into Postgres: off by default, never on real data without Caleb's OK (docs/build/SYNC-MIGRATION.md)

# media copy (tools/media-copy; never against real buckets without Caleb's OK and /privacy listing AWS)
cd tools/media-copy && python3 test_media_copy.py && python3 test_stores.py && python3 test_sample_library.py
cd tools/media-copy && python3 sample_library.py --to <media bucket> --media-base <its https host>   # dry run: the sample library.json it would write (--write: Caleb's OK)

# upload signer (cloud/signer)
python3 cloud/signer/test_main.py                                  # sign-in check (Convex + GCS faked)
cloud/deploy-signer.sh                                             # Cloud Run edible-upload, us-west1

# voice service (voice/README.md)
cd voice && npm ci && npm run dev                                  # ws://localhost:8080/cook (VOICE_STUB=1: stub recipe, any token)
cd voice && VOICE_STUB=1 npm run dev:fake                          # the same with fake speech (offline checks)
cd voice && npm run test-client -- test-audio/next-step.wav test-audio/question.wav   # real Ink + Sonic; FAKE=1 = offline
cd voice && COOK_LANG=ta npm run test-record                     # a live cook recording (VOICE_STUB=1 dev server): hi (default), en, ta, zh
cd voice && CAMERA=1 npm run test-record                           # homie while filming in the app: frames, pause, plate photo
cd voice && npx tsx scripts/try-decide.ts photo.jpg "what she said"   # one "should homie speak?" call (HOMIE_DECIDE_MODEL=…)
cd voice && npx tsx scripts/try-cook-model.ts                       # cook mode's picks on a Hindi + an English recipe (COOK_MODEL=…, RUNS=…)
cd voice && npm run typecheck && npm test                          # src + tests; unit tests (pacing, /record phases; fakes only)
voice/deploy.sh                                                    # Cloud Run homecookd-voice, us-west1

# pipeline (uses .venv)
.venv/bin/python pipeline/schema.py data/out/*/recipe.json data/synthetic/*.json
.venv/bin/python pipeline/test_order.py && .venv/bin/python pipeline/test_prompts.py
.venv/bin/python pipeline/test_shorten.py                           # cook mode's short steps: rules + stored data
.venv/bin/python pipeline/test_coverage.py
.venv/bin/python pipeline/test_seen.py                              # ingredients the frames show but nobody said (fakes)
.venv/bin/python pipeline/test_eval_languages.py                    # the language eval's scoring (pure)
.venv/bin/python pipeline/eval_languages.py --only ta,hi [--rescore]   # the 13-language eval: 5-min clips on the Batch API, $3 cap (~$0.20 and 15 min a clip; --all; needs yt-dlp in .venv)
.venv/bin/python pipeline/test_cover.py                             # the cover: Gemini's pick + the sharpest frame (fakes)
.venv/bin/python pipeline/cover.py --id <id> [--out PATH]          # pick a recipe's cover again (real Gemini)
.venv/bin/python pipeline/align.py --id <id> --force               # substep times again (process.py does it after shorten)
.venv/bin/python pipeline/test_publish.py                           # a family recipe.json: no stories or tips, not in library.json
.venv/bin/python pipeline/test_claude.py                            # TEXT_PROVIDER=claude: order, shorten, writer fallback (fakes)
.venv/bin/python pipeline/test_transcribe.py                        # Cartesia's word-timed transcript: loops, keys, cache (fakes)
.venv/bin/python pipeline/test_extract_claude.py                    # EXTRACTOR=claude: frames + transcript -> events (fakes)
.venv/bin/python pipeline/transcribe.py --id <id> [--language mr]   # work/transcript.json: cleaned audio, language check, proofread (real Cartesia)
.venv/bin/python pipeline/scrub_family.py                          # dry run: old family recipe.json files to strip (--write: Caleb's OK)
.venv/bin/python pipeline/fix_upside_down.py                      # dry run: front clips stored upside down (#79-#104); --try CLIP local; --write --clip PATH: Caleb's OK
.venv/bin/python pipeline/test_fix_upside_down.py                 # which clips it flags + the repair (ffmpeg, no network)
.venv/bin/python pipeline/test_account_purge.py                      # a deleted account's purge outside Convex (fakes)
.venv/bin/python pipeline/worker.py [--once]                        # claim Convex jobs (--gcs: the old GCS job files)
.venv/bin/python pipeline/worker.py --purge-dry-run                 # what each deleted account's purge would delete
.venv/bin/python pipeline/batch_reap.py data/out/<id>/work          # what a killed run's Claude batches billed, into its usage.json (queue_worker runs it after a kill)
.venv/bin/python pipeline/process.py --id <id> --rewrite            # re-write recipe.json from the cached extraction

.venv/bin/python pipeline/test_queue_worker.py                     # the queue worker (TEST_DATABASE_URL adds real Postgres; needs requirements-queue.txt)
python pipeline/queue_worker.py                                     # queue mode, on AWS only (docs/build/WORKER-MIGRATION.md)

# glasses VM (glasses/README.md; uses .venv + ffmpeg)
.venv/bin/python glasses/ingest/test_server.py                      # unit tests: the VM's state machine
.venv/bin/python glasses/ingest/e2e_test.py                         # stub Convex + fake glasses → MP4, no cloud
```

Use `npx expo install <pkg>`, never `npm install`, for app dependencies.

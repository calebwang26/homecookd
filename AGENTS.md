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

1. `docs/agents/STATE.md`: what's live, what's open, the change log.
2. `docs/build/SPEC.md`: app architecture and the binding brand-rename banner.
3. `docs/build/API.md`: Supabase `api` edge function routes, auth, errors and the security model.
4. `docs/build/RETENTION-HANDOFF.md` and `RETENTION-WIRING.md`: the retention features (shipped Oct 18).
5. `docs/build/FEEDBACK-OCT16c.md`: sign-in and invites. It beats SPEC.md where they conflict.
6. `docs/design/hearth-bible/`: "the bible". Match the app UI almost 1 to 1. Motion: `docs/design/ANIMATIONS.md`.
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
- **Deploying the `api` edge function** (Supabase project ref `qeiednrjkiyzbolkepbk`, verify_jwt false):
  deploy only from merged main, apply that release's migrations first, and send **every** file in
  `supabase/functions/api/`, or the routes from the missing files go down. Check the live version first. Salik also
  deploys, so check with Caleb that Salik's work is merged and no deploy is in flight, and log the new version in
  STATE.md. After a deploy, run:
  `node supabase/tests/two_sided_live.mjs`, `node app/scripts/api-smoke.mjs` and `node supabase/tests/retention_live.mjs`.
  They need `docs/build/.test-family-code` (gitignored). Use only the TEST family.
- **Secrets:** never put a Gemini key, Supabase service key, GCP credential or Cartesia key in `app/` or `web/`, or in
  any tracked file. `EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` values ship to users. Never print `.env` values. Keys live
  only in the gitignored root `.env` and in Supabase edge-function secrets.
- **Cartesia (voice):** the `CARTESIA_API_KEY` stays server-side. Clients get a 5-minute token from
  `POST /voice/token` and call `https://api.cartesia.ai` with it (`docs/build/API.md`). Send
  `Cartesia-Version: 2026-08-14` on every call, and read the docs (https://docs.cartesia.ai/llms.txt) before
  guessing fields or voice ids. Live check: `node supabase/tests/cartesia_live.mjs`.
- **Moss (search):** `MOSS_PROJECT_ID` and `MOSS_PROJECT_KEY` stay server-side. Moss search runs only inside its
  native SDKs, so the app asks through the `POST /moss/ask` proxy, which searches only the `family-<id>` index
  (https://docs.moss.dev/llms.txt). Live check: `node supabase/tests/moss_live.mjs`.
- **Convex:** set up at the repo root (`convex/`). Deploy with `npx convex deploy --preview-create hackathon -y`
  (uses the preview `CONVEX_DEPLOY_KEY` in `.env`) to the preview deployment `sensible-finch-139`
  (https://sensible-finch-139.convex.cloud) in the "homecookd" project. Read `convex/_generated/ai/guidelines.md` before writing Convex code; the skills are
  in `.agents/skills` (Codex) and `.claude/skills` (Claude Code). The team token (`CONVEX_OVERRIDE_ACCESS_TOKEN`)
  and any deploy key live only in `.env`.
- **No TestFlight build yet.** Invite and recipe links can't install or open the app. Treat that as a known gap,
  not a bug. Test invites in two halves (see `docs/agents/memory/no-testflight-yet.md`).
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
app/        Expo app (expo-router, TypeScript). Run in Expo Go on an iPhone; iOS Simulator is the backup.
web/        Next.js site: the lander, homecookd.app/r (recipe share page) and /i (invites). Vercel project "homecookd".
supabase/   functions/api (the backend), functions/transcribe, migrations/, tests/ (deno + live .mjs)
pipeline/   Python: prep.py → process.py (Gemini) → publish.py, and worker.py for phone uploads
cloud/      GCS upload signer (Cloud Run) + IAM scripts
scripts/    set-apple-ids.mjs (launch prep; see docs/build/LAUNCH-LINKS.md)
data/       sample + synthetic recipes; data/out/ is pipeline output (gitignored)
docs/       specs, design bible, QA, learning notes; docs/agents/ = shared agent state + memory
```

## Commands

```bash
# app
cd app && npx expo start --clear                                   # Expo Go on the same Wi-Fi
cd app && CI=1 npx expo start --go --tunnel --port 8082            # Expo Go over a tunnel
cd app && npx expo start --web --port 8081 --clear                 # web build of the app
cd app && npx tsc --noEmit && npx expo lint
cd app && node scripts/test-retention.mjs                          # also test-table/hearts/recap/cooking/recommend

# web
cd web && npm run dev -- --port 3000
cd web && npm ci && npm run build                                  # confirm a PR's web/ builds

# backend
npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/   # unit tests
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/*.ts              # typecheck

# pipeline (uses .venv)
.venv/bin/python pipeline/schema.py data/out/*/recipe.json data/synthetic/*.json
.venv/bin/python pipeline/test_order.py
.venv/bin/python pipeline/test_shorten.py                           # cook mode's short steps: rules + stored data
```

Use `npx expo install <pkg>`, never `npm install`, for app dependencies.

# homecookd hackathon stack (2-day build)

Caleb's plan (`PLAN.pdf`, Oct 23) is the guideline. This page is how we build it in two days. Where it differs
from the PDF, the reason is under "Changes from the PDF". Keep the current app and its screens; fit the new
pieces in.

## The stack

| Tech | Job | Runs where | Sponsor track |
|---|---|---|---|
| Expo app | Kid mode (library, voice cooking, questions, share the dish) and parent mode (record or upload, progress, answer questions, messages). Plays the cook's clips, streams the mic while cooking | EAS dev build while coding; **TestFlight** for teammates, judges and the demo; EAS Update for JS-only fixes | |
| Smart glasses | The cook's first-person video | Glasses → camera roll → the app's existing upload | Best Hardware Hack |
| Convex | Families, recipes, jobs, questions, messages, photos and voice notes; live updates to both phones; schedules the AI steps | Convex cloud (`convex/`) | Convex |
| Gemini | Watches the video and notes what the cook said and did, with timestamps | The pipeline worker (`pipeline/`) | |
| Muse Spark | Writes the final recipe, memories, dish suggestions, and the kid's note back to the cook | Pipeline worker (recipe, memories); Convex action (note, suggestions) | Meta |
| Moss | Holds what the cook said and did; finds the moment that answers a question | Filled by a Convex action; searched by the live voice service | Moss |
| Live voice service | The real-time cooking loop | Google Cloud Run (`voice/`), min instances 1 | |
| Claude | The cooking agent: what does the kid want on this turn? | Live voice service | Anthropic |
| Cartesia Ink | Speech to text: the kid while cooking (streaming); the cook's voice-note answers (batch) | Live voice service; Convex action | Cartesia |
| Cartesia Sonic | Reads steps aloud, says "I'll ask Mom"; optional cloned voice, only with consent | Live voice service | Cartesia |
| GCS buckets | Big videos and clips (background uploads already work) | Google Cloud Storage | |
| Supabase | Today's sign-in, invites and the older screens, until Convex replaces them | Supabase project `bsudybxsqvtwftsdmwmz`. Frozen: no new features | |
| Next.js web | Lander, `/r` recipe page, `/i` invites | Vercel | |

## How a cook works

1. **Capture.** The cook records on the glasses or phone. The app uploads the video to GCS (as today) and calls
   `jobs.create`. The cook's phone shows progress live from `jobs`.
2. **Understand → write.** The worker claims the job, preps the video, has Gemini note the moments, has Muse
   Spark write `recipe.json`, publishes to GCS, and reports each stage to Convex.
3. **Index.** Convex sends the steps and what the cook said, each with its moment, to the family's Moss index
   `family-<familyId>`.
4. **Cook.** The kid's app opens a WebSocket to the voice service and streams the mic. Ink turns speech into text.
   Claude picks one tool per turn, the app follows (next step, play the cook's clip), and Sonic speaks the short
   reply. If Moss finds no moment that answers a question, Claude calls `ask_cook` and says "I'll ask Mom".
5. **Close the loop.** The question shows up live on the cook's phone. The cook answers by voice (push to talk),
   and Ink transcribes it. The kid shares a photo of the dish, Muse drafts a note to the cook (labelled
   AI-drafted, and the kid can edit it), and the cook replies.

## Changes from the PDF (the 2-day cut)

1. **Processing runs in the existing Python pipeline, not inside Convex.** It cuts clips with ffmpeg and makes
   Gemini calls that take minutes, which doesn't fit Convex functions. `pipeline/worker.py` polls Convex for
   queued jobs instead of Supabase. Day 1 it runs on a laptop. If there's time, the same code goes into a
   Cloud Run job.
2. **Big videos stay in GCS.** Phone uploads already survive the app going to the background. Convex keeps
   the metadata plus small files (voice notes, photos).
3. **Sign-in is reused, not rebuilt.** `sessions.start` takes the phone's existing Supabase device key, checks
   it once against Supabase `GET /family`, mirrors the family and people into Convex, and returns a Convex
   session token. Rebuilding Apple/Google sign-in and invites isn't worth a day of the hackathon.
4. **Expo Go → dev build + TestFlight.** Live mic streaming needs a native module that Expo Go can't load.
   If streaming fights us, the fallback is push to talk (hold, release, Ink batch).
5. **Glasses: camera roll first.** Recording on the glasses and uploading from the camera roll works today.
   Meta's glasses kit (`expo-meta-wearables-dat`) streams live first-person video, but Meta marks its camera
   capture as experimental and not publishable, so it's the stretch goal.
6. **Moss only finds; it never answers.** We don't use Moss Inference, because it writes its own answers. The
   cook's real words and clips come first; AI speech is labelled and used only to move things along.
7. **Parent voice mode = push to talk** for answering questions. Full voice navigation of parent mode is a
   stretch goal. So is the cloned voice, which needs a consent record (`people.voiceClone`).
8. **Cut for the hackathon** (still on Supabase, untouched): Sunday table, monthly recap, postcards, hearts,
   move requests, favorites.

## Contracts (so the tracks can run in parallel)

Data model: `convex/schema.ts`. Live voice service and worker calls are Convex HTTP actions (`convex/http.ts`),
each with its own shared secret in Convex env (`WORKER_SECRET`, `VOICE_SECRET`; copies in the root `.env`).
Deployment: https://grand-dragon-649.convex.cloud (app client); HTTP routes on https://grand-dragon-649.convex.site.
HTTP errors are JSON `{ error }`: `400` bad body, `401` wrong secret or signed-out session, `404` no such job/recipe.

**App → Convex** (public functions; every one takes the `sessionToken`)
- `sessions.start({ deviceKey, profileId })` → `{ sessionToken, familyId, personId, role }` (`role`: `cook` | `kid`).
  Checks the key once with Supabase `GET /family` and mirrors the family. Errors are meant to be shown as they are;
  `"This phone was signed out."` means clear the token and sign in again. `sessions.end` signs out.
- `recipes.list`, `recipes.get({ recipeId })` (each with `cookName`; stories and tips are empty until the cook opts
  in), `recipes.setMemoriesOptIn({ recipeId, optIn })` (the recipe's cook only; re-indexes Moss)
- `jobs.create({ uploadPath, source })` → `{ jobId, recipeId }` (cook only; adds a `processing` recipe card),
  `jobs.forFamily` (live progress)
- `questions.forRecipe({ recipeId })`, `questions.openForCook` (questions about this cook's recipes),
  `questions.answer({ questionId, text?, audioId? })` (cook only; a voice note gets an Ink transcript)
- `messages.list` (to everyone, or to or from me), `messages.send({ kind, text?, fileId?, to?, recipeId?, aiDrafted? })`
- `messages.sharePhoto({ recipeId, fileId })` → `{ draft, aiDrafted: true }`: Muse Spark (`muse-spark-1.3`) drafts
  the note and **sends nothing**. The app lets the kid edit it, then calls `messages.send` with `kind: "photo"`,
  `to: <cookId>` and `aiDrafted: true`, which keeps the label after edits.
- `files.uploadUrl` (POST the bytes there, get `{ storageId }`; for voice notes and photos, 20 MB max)
- `cooking.current` (what each kid is cooking now, for the cook's phone; idle 2 h ends it), `cooking.finish`

**Worker → Convex** (HTTP POST with JSON, `x-worker-secret`)
- `/worker/claim` `{}` → `204`, or `{ jobId, recipeId, familyId, supabaseFamilyId, cookId, cookName, uploadPath,
  source }`. The job is now `preparing`.
- `/worker/progress` `{ jobId, stage, progress, error? }`. `stage` is one of
  `preparing | understanding | writing | indexing | done | failed`, and `progress` runs 0..1.
  `failed` also marks the recipe failed.
- `/worker/published` `{ jobId, recipe, recipeJsonUrl?, memoriesOptIn? }` → `{ recipeId }`.
  - `recipe` is the pipeline's `recipe.json` as is.
  - Convex keeps `title`, `id` (as `libraryId`), `media.poster_url` (https only), each step's
    `order/title/instruction/quote/start_s/end_s`, and `stories`, `special` and `steps[].tip` as memories.
  - It then indexes Moss itself (`convex/moss.ts`); the job goes `indexing` → `done`.
  - `memoriesOptIn` defaults to `false`.

**Voice service → Convex** (HTTP POST with JSON, `x-voice-secret`)
- `/voice/session` `{ sessionToken, recipeId }` → `{ kid: { personId, name, role }, familyId, mossIndex, recipe:
  { recipeId, title, cookName, steps[{ order, title, text, quote?, moment }], memories[] }, stepOrder }`.
  It starts or resumes the kid's `cookingSessions` row. A recipe that isn't `ready` is `404`.
- `/voice/step` `{ sessionToken, recipeId, stepOrder }` → `{ ok, stepOrder }` (updates `cookingSessions`)
- `/voice/question` `{ sessionToken, recipeId, stepOrder?, text, found?: { startS, endS, quote } }` →
  `{ questionId, status: "found_in_video" | "asked_cook" }`

**Moss index** `family-<familyId>` (model `moss-minilm`; filled by `convex/moss.ts`)
- **Steps:** `<recipeId>:step:<n>`; the text is the step plus the cook's quote.
- **Stories and tips:** `<recipeId>:story:<i>` / `:tip:<i>`; only while the cook has opted in.
- **Metadata (all strings):** `recipeId`, `recipeTitle`, `kind` (`step` | `story` | `tip`), `stepOrder` (steps only),
  `startS`, `endS`, `quote`.
- After a Moss outage, `npx convex run worker:reindexMissing` re-sends what's missing.

**App ↔ voice service** (WebSocket `wss://<voice>/cook?session=<sessionToken>&recipe=<recipeId>`)
- App → server: binary frames of 16 kHz mono 16-bit PCM; `{ "type": "step", "stepOrder" }` when the kid taps.
- Server → app: `{ type: "transcript", text }`, `{ type: "go_to_step", stepOrder }`,
  `{ type: "play_clip", startS, endS }`, `{ type: "say", text, ai: true }` followed by binary audio,
  `{ type: "asked_cook", questionId }`.

**Claude's tools** (one per turn): `next_step`, `previous_step`, `repeat_step`, `go_to_step(n)`,
`find_moment(query)` (Moss search over the family's index), `play_clip(startS, endS)`, `ask_cook(question)`,
`say(text)`. The system prompt says: never state anything the cook didn't say. Answer with the cook's clip or
ask the cook.

## Keys (all server-side, never in `app/` or `web/`)

| Key | Lives in |
|---|---|
| `CARTESIA_API_KEY` | Cloud Run secret (voice service) and Convex env (voice-note transcription) |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | Convex env (indexing) and Cloud Run secret (search) |
| `ANTHROPIC_API_KEY` | Cloud Run secret |
| `MUSE_API_KEY` (Meta Model API) | Worker `.env` and Convex env |
| `GEMINI_API_KEY` | Worker `.env` |
| `CONVEX_DEPLOY_KEY`, `CONVEX_OVERRIDE_ACCESS_TOKEN` | Root `.env` only |

The app needs only public values: `EXPO_PUBLIC_CONVEX_URL` and the voice service's URL.

## Build order: 2 days, 4 tracks

**First 3 hours: check the risky parts before building on them.**
- Mic streaming: a dev build on an iPhone sends PCM to a test WebSocket. If not, switch to push to talk now.
- Muse Spark: the key works, and one Gemini output becomes a valid `recipe.json` (`pipeline/schema.py`).
  Keep Gemini as the fallback writer.
- Glasses: one clip goes from the glasses to the camera roll and through the app's upload.
- Timing: one full-length video goes through the pipeline. Note the minutes.

| Track | Day 1 | Day 2 |
|---|---|---|
| A · Convex core | `sessions.start` bridge, queries and mutations, HTTP actions, seed the demo family | Muse photo note, voice-note transcription, Moss indexing action |
| B · Live voice service | WebSocket + Ink streaming + Sonic: say "next" and hear step 2 | Claude tools + Moss search + `ask_cook`; deploy to Cloud Run |
| C · Pipeline | Worker reads from and reports to Convex; Muse writes the recipe | Moss indexing from published recipes; Cloud Run job if time |
| D · App | Dev build + TestFlight, Convex client, voice cooking screen, live progress | Cook's answer by voice, photo share, glasses import, demo polish |

**End of day 1:** the kid says "next" and hears the next step; a question plays the right clip.
**End of day 2:** the full loop on TestFlight phones, a rehearsed demo, and a recorded backup of it.

## Check commands

```bash
node scripts/check-cartesia.mjs     # Cartesia key: token + Sonic speech
node scripts/check-moss.mjs         # Moss keys: list indexes
npx vitest run                      # Convex tests (convex/*.test.ts)
npx convex deploy --preview-name hackathon -y     # push convex/ (preview deploy key in .env); never --preview-create
npx convex run seed:demo            # demo family + 4 recipes (team token + --deployment grand-dragon-649)
```

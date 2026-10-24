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
| Gemini | Watches the video and notes what the cook said and did, with timestamps, in English even when the cook speaks Marathi (her words kept in `quote_original`); translates a non-English voice-note answer for the kid | The pipeline worker (`pipeline/`); Convex action | |
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
  `questions.answer({ questionId, text?, audioId? })` (cook only; a voice note gets an Ink transcript in the cook's
  `people.language`, plus `answer.translation`, Gemini's English, when that isn't English; set it with `seed:language`)
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

## Oct 24 additions: homie, translation, glasses VM, Community (PLAN.pdf v2)

Caleb's updated PLAN.pdf (Oct 24) and his answers to the review questions add five build tracks on top of A–D. These contracts let them run in parallel; `convex/schema.ts` holds the data model.

| Track | What | Owns |
|---|---|---|
| E · homie live | Parent live pass (`/record`), `/speak`, kid-side timers, nudges, read-aloud offer, labelled hints | `voice/`, `convex/live.ts`, `convex/lib/liveRoutes.ts` |
| F · Translation + pipeline | Cook's language end to end, original + English quotes, homie log in the full pass, upload race, 8–12 steps | `pipeline/`, `convex/worker.ts`, `convex/lib/recipeJson.ts`, `convex/moss.ts`, `convex/people.ts`, `app/src/lib/languages.ts` |
| G · Community | Feed, share switch + Muse story card, one dinner flow | `convex/community.ts`, `convex/dinners.ts`, `convex/lib/geo.ts`, `convex/seedCommunity.ts`, `app/src/app/community/*`, `app/src/app/dinner/*`, `app/src/app/kid/community.tsx`, `app/src/lib/live/community.ts` |
| H · Glasses VM | ESP32 → free GCP e2-micro → MP4 → GCS → job | `glasses/`, `convex/glasses.ts`, `convex/lib/glassesRoutes.ts` |
| I · App UI | homie pot everywhere, cook-screen chips + captions + timers, recording screen, walkie-talkie, language picker | `app/` (everything else) |

**Decisions that change earlier rules** (Caleb, Oct 24):
- Change 5 is replaced: the ESP32 glasses stream to a VM, not the camera roll. "From my glasses" stays as a fallback.
- Change 6 is relaxed: when no clip answers, homie may give a **labelled AI hint** ("Grandma didn't say. Most recipes
  use about a teaspoon.") and **always** asks the cook too. The hint is never presented as the cook.
- Change 7 is partly replaced: while recording, the parent never taps; homie listens. Answering a kid's question
  stays push to talk (now the half-screen walkie-talkie). Full voice navigation of parent mode is still a stretch.
- Live Marathi speech-to-text is Gemini (Ink 2 only knows en/fr/hi/ja/es). Sonic 3.6 speaks Marathi (`locale`).
- Languages are Ink-style ISO 639-1 codes (`mr`, `en`) everywhere: `people.language`, `recordings.language`,
  `jobs.language`, `recipes.language`. Unset means `en`.

**App → Convex (new public functions; every one takes `sessionToken`)**
- `live.startRecording({ dish?, forKidId?, language, source })` → `{ recordingId }` (cook only; status `intro`).
- `live.recording({ recordingId })` (live): the row, for the recording screen.
- `jobs.create` gains optional `title`, `language`, `forKidId`, `recordingId`.
- `people.setLanguage({ language })` (self). `people.me` → `{ personId, name, role, language, relation }`.
- `questions.forRecipe` already exists; the kid's cook mode reads it to hear the cook's answer (`answerAudioUrl`,
  `answer.translation`).
- Community: `community.feed({ maxMiles?, now? })` → `{ recipes, dinners }` (`now` is the client's clock, rounded,
  to hide past dinners; queries can't read it), `community.recipe({ recipeId })` (text only),
  `community.setLocation({ lat, lng, campus? })` (snapped to the ~1 km grid before it's stored),
  `community.setShare({ recipeId, on })` (the recipe's cook only), `dinners.create({ recipeId, startsAt, placeKind,
  placeName, address, seats })`, `dinners.get({ dinnerId })`, `dinners.mine`, `dinners.requestJoin({ dinnerId })`,
  `dinners.respond({ requestId, accept })` (host only). Community responses never include `libraryId`,
  `recipeJsonUrl`, `coverUrl` of a private recipe, moments, quotes, person ids of other families, or an address
  (except to the host and accepted guests). Distance is a label from `lib/geo.ts`. `families.publicName` is the
  surname ("Pawar"); cards say "The Pawar family", or "Rajani's family" without one. Demo data:
  `seedCommunity:neighbors` (8 neighbor families), `seedCommunity:place({ personId })` (puts a real account at
  `DEMO_LOCATION`), `seedCommunity:publicName({ familyId, publicName })`.

**Voice service → Convex for homie** (HTTP POST, `x-voice-secret`; `convex/lib/liveRoutes.ts`)
- `/live/person` `{ sessionToken }` → `{ personId, familyId, name, role, language, relation }` (401 if signed out).
- `/live/session` `{ sessionToken, recordingId }` → `{ recording, cook: { name, relation, language }, kid?: { name },
  dish? }` (404 if it isn't this cook's).
- `/live/status` `{ sessionToken, recordingId, status }` → `{ ok, startedAt? }`. Moving to `recording` sets
  `startedAt` (server clock) once; `ended` sets `endedAt`.
- `/live/prompt` `{ sessionToken, recordingId, kind, text, textEn, atS, status }` → `{ promptId }`.
- `/live/prompt-update` `{ sessionToken, promptId, status, answer? }` → `{ ok }`.
- `/live/optin` `{ sessionToken, recordingId, optIn }` → `{ ok }` (stored on the recording, carried to the job).

**App ↔ voice service: homie while recording** (`wss://<voice>/record?session=<sessionToken>&recording=<recordingId>`)
- App → service: binary 16 kHz mono s16le PCM (the phone by the stove), always streaming;
  `{ type: "start" }` when the cook starts cooking after the intro; `{ type: "done" }` on "I'm done";
  `{ type: "text", text }` (typed answer, tests); `{ type: "not_now" }` (tap on the caption card).
- Service → app:
  - `{ type: "ready", recording: { id, language, cookName, kidName?, dish? } }`
  - `{ type: "phase", phase: "intro" | "recording" | "wrapping_up" | "ended" }`
  - `{ type: "state", state: "listening" | "thinking" | "speaking" | "quiet" }` (the pot's steam)
  - `{ type: "say", text, textEn, kind, ai: true, audio }` + binary audio + `{ type: "say_end", interrupted }`.
    `kind` is a `homiePrompts.kind`. The app lights the pot just before audio starts.
  - `{ type: "ask", promptId, text, textEn, kind }`: show the caption card. `{ type: "drop", promptId }`: fade it
    (no answer in ~10 s, or "not now"). `{ type: "answered", promptId }`.
  - `{ type: "transcript", text, final }`, `{ type: "error", message }`. Close 4401 signed out, 4404 no such recording.
- The service ignores incoming audio while homie speaks (+300 ms), so it never hears itself; the app also sends
  silence then. Pacing (normal): first question no earlier than 4 min, gaps of 4–5 min, doubled after an ignored
  one, at most 6 live plus 2 end questions, never while the cook talks or tells a story. `HOMIE_DEMO=1`: first
  question at ~40 s, then 90 s gaps, at most 2 live.
- Glasses frames: when `GLASSES_URL` is set, the service pulls `GET <GLASSES_URL>/frame/latest?recording=<id>`
  (`x-glasses-secret`) every ~5 s and gives the newest JPEG to homie's decision.

**Voice service HTTP** `POST /speak` `{ sessionToken, text, lang?, translate?: boolean }` → `audio/wav` (Sonic, homie's
voice, in `lang` or the person's language). `translate: true` first turns English `text` into `lang`. Header
`x-spoken-text` (URI-encoded) is what was actually said. Used by walkie-talkie and the pot's tap hints.

**App ↔ voice service: kid cooking additions** (`/cook`, backward compatible)
- `say` gains `kind`: `step | reply | hint | translation | nudge | offer | greeting | timer`, and `textEn` when the
  spoken text isn't English. A `hint` is AI general knowledge: always labelled, always followed by `asked_cook`.
- `play_clip` gains `quote?` and `quoteEn?` for the caption.
- `{ type: "timer", id, seconds, label, endsAt }`, `{ type: "timer_done", id, label }`. The app owns the countdown.
- After `ready`: one `say` of kind `greeting` (a word in the cook's language + `textEn`), then `offer`
  ("Want me to read it out loud?"). Saying or sending `{ type: "text", text: "yes" }` reads the current step.
  Until then, steps change silently.
- The app sends silence while a `say` or clip plays (half duplex).

**Worker ↔ Convex additions**
- `/worker/claim` adds `title?`, `language` (default `en`), `forKidName?`, `memoriesOptIn?` and `homieLog:
  [{ atS, kind, text, textEn, answer?: { transcript, transcriptEn?, atS, endS } }]`, with times on the **video's**
  clock (`atS + (startedAt − videoStartedAt) / 1000` for glasses).
- `/worker/release` `{ jobId }` → `{ ok }`: the upload isn't complete yet; the job goes back to `queued` after 30 s.
- `/worker/published` accepts `language` and `steps[].quoteOriginal`.

**Glasses VM → Convex** (HTTP POST, `x-glasses-secret`; `convex/lib/glassesRoutes.ts`; see `glasses/INGEST.md`)
- `/glasses/active` `{}` → `{ recordingId, status, startedAt? }` for the newest `glasses` recording that isn't
  `ended`/`abandoned`, or `204`. (One pair of glasses for the hackathon.)
- `/glasses/finished` `{ recordingId, uploadPath, videoStartedAt, durationS }` → `{ jobId, recipeId }`: sets
  `recordings.videoStartedAt` and creates the job (`source: "glasses"`) with the recording's dish, language and kid.

**New keys**: `GLASSES_SECRET` (Convex env, the VM, Cloud Run secret), `GEMINI_API_KEY` (Cloud Run secret, for live
Marathi transcription), `HOMIE_VOICE` (Cloud Run env: homie's Cartesia voice id), `GLASSES_URL` (Cloud Run env).

## Keys (all server-side, never in `app/` or `web/`)

| Key | Lives in |
|---|---|
| `CARTESIA_API_KEY` | Cloud Run secret (voice service) and Convex env (voice-note transcription) |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | Convex env (indexing) and Cloud Run secret (search) |
| `ANTHROPIC_API_KEY` | Cloud Run secret |
| `MUSE_API_KEY` (Meta Model API) | Worker `.env` and Convex env |
| `GEMINI_API_KEY` | Worker `.env` and Convex env (translating voice-note answers) |
| `CONVEX_DEPLOY_KEY`, `CONVEX_OVERRIDE_ACCESS_TOKEN` | Root `.env` only |

The app needs only public values: `EXPO_PUBLIC_CONVEX_URL` and the voice service's URL.

## Build order: 2 days, 4 tracks

**First 3 hours: check the risky parts before building on them.**
- Mic streaming: a dev build on an iPhone sends PCM to a test WebSocket. If not, switch to push to talk now.
- Muse Spark: the key works, and one Gemini output becomes a valid `recipe.json` (`pipeline/schema.py`).
  Keep Gemini as the fallback writer. **Done Oct 23:** `muse-spark-1.3` at `https://api.meta.ai/v1/chat/completions`
  with `json_schema` output. It's Standard mode on purpose: `-contributor` is cheaper, but it lets Meta train on
  the family's words. It turned the biryani's cached Gemini extraction into a valid recipe on the first attempt
  (46 s, ~$0.08). `RECIPE_WRITER=gemini` switches back, and the worker falls back to Gemini on its own if Muse
  fails twice.
- Glasses: one clip goes from the glasses to the camera roll and through the app's upload.
- Timing: one full-length video goes through the pipeline. Note the minutes. **Done Oct 23:** a 17-minute
  video (55 MB, 1 file) went from queued to published in **10.0 min** on a laptop: download 0.5, prep 1.7,
  Gemini extraction 2.0, Muse writing 2.3, cook mode's short steps 1.4, publish 2.0. About $0.78 in model
  calls. The worker reports each stage to Convex as it goes. Against the live Convex (`grand-dragon-649`, TEST
  family, a real `jobs.create`), the same video took **13.6 min** from queued to done: understanding at 1.9,
  writing at 4.2, published at 13.6. That run was slower because cook mode's short steps needed a second
  attempt (3.5 min). Muse named the dish "Chicken Biryani".

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
.venv/bin/python pipeline/writer.py # Muse key: one tiny structured call
.venv/bin/python pipeline/worker.py # the pipeline worker: claims Convex jobs (CONVEX_SITE_URL, WORKER_SECRET)
.venv/bin/python pipeline/convex_stub.py --upload <uploadPath> --port 8797   # fake /worker/* routes for a local run
```

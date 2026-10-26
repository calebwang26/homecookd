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
  in), `recipes.setMemoriesOptIn({ recipeId, optIn })` (the recipe's cook only; re-indexes Moss).
  The `recipeJsonUrl` file has no stories or tips (the bucket is public): the app puts a row's `memories` back
  into it (`withMemories`, `app/src/lib/familyLibrary.ts`). A file published before that still has them all, so
  the kid's library strips them itself when a row has no `memories` and no opt-in.
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
- `account.deleteMe` → `null` ("Delete my account", Apple 5.1.1(v); Oct 25). At once: the person row becomes a blank
  tombstone (`people.deletedAt`, name "Deleted"), every session as them ends, `sessions.start` refuses them with
  `"This account was deleted."` (even while Supabase still lists them), a cook's recipes are deleted (gone from the
  family and Community) and the dinners they host are cancelled. `account.purge` then deletes, in batches of 500:
  their messages and voice notes, the questions they asked or that were about their recipes (their answer on anyone
  else's is taken off, so it waits for an answer again), their cooking sessions, recordings with homie's prompts and
  the glasses' live rows and frames, jobs, hosted dinners with their asks and invite opens, their dinner and swap
  asks, then syncs Moss (an index with nothing left is deleted). `accountDeletions` keeps what Convex can't delete:
  `supabaseProfileId`, `recipeIds`, `jobIds` (the GCS recipe folders are named after them), `uploadPaths` and
  `mediaUrls`, for the purge of Supabase rows and GCS media; `purgedAt` once Convex is done. The app then calls
  Supabase `POST /profiles/:id/remove` and signs the phone out (`session.deleteAccount`).

**Worker → Convex** (HTTP POST with JSON, `x-worker-secret`)
- `/worker/claim` `{}` → `204`, or `{ jobId, recipeId, familyId, supabaseFamilyId, cookId, cookName, uploadPath,
  source }`. The job is now `preparing`.
- `/worker/progress` `{ jobId, stage, progress, error? }`. `stage` is one of
  `preparing | understanding | writing | indexing | done | failed`, and `progress` runs 0..1.
  `failed` also marks the recipe failed. A job the cook stopped answers **409** `cancelled` here, on `/worker/release`
  and on `/worker/published` (Oct 24): the worker stops there, saves nothing to Convex, deletes that upload's raw
  files and moves media it published a moment before to `trash/` (`pipeline/worker.py` `JobCancelled`).
  `jobs.create` refuses an upload folder another family's job already uses (`jobs.by_uploadPath`).
- `/worker/published` `{ jobId, recipe, recipeJsonUrl?, memoriesOptIn? }` → `{ recipeId }`.
  - `recipe` is the pipeline's `recipe.json` as is.
  - Convex keeps `title`, `id` (as `libraryId`), `media.poster_url` (https only), each step's
    `order/title/instruction/quote/start_s/end_s`, and `stories`, `special` and `steps[].tip` as memories:
    `{ kind, text, moment, step?, id?, title?, why? }` (`convex/schema.ts` `memory`; a tip with no `id` is its
    step's own tip). Only Convex has them: the `recipe.json` the worker puts in the media bucket leaves out
    `stories`, `special`, `steps[].tip`, `story_ids`, `special_ids` and `intro` (`publish.without_memories`).
  - It then indexes Moss itself (`convex/moss.ts`); the job goes `indexing` → `done`.
  - `memoriesOptIn` defaults to `false`.

**Voice service → Convex** (HTTP POST with JSON, `x-voice-secret`)
- `/voice/session` `{ sessionToken, recipeId }` → `{ kid: { personId, name, role }, familyId, mossIndex, recipe:
  { recipeId, title, cookName, cookLanguage?, cookRelation?, steps[{ order, title, text, quote?, quoteOriginal?,
  moment }], memories[{ kind, text, moment, stepOrder? }] }, stepOrder }`. `cookLanguage` is the cook's
  `people.language`, else the recipe's `language`, and is absent when neither is set (not `"en"`).
  { recipeId, title, cookName, steps[{ order, title, text, quote?, quoteOriginal?, moment }], memories[] }, stepOrder }`.
  It starts or resumes the kid's `cookingSessions` row. A recipe that isn't `ready` is `404`.
- `/voice/step` `{ sessionToken, recipeId, stepOrder }` → `{ ok, stepOrder }` (updates `cookingSessions`)
- `/voice/question` `{ sessionToken, recipeId, stepOrder?, text, found?: { startS, endS, quote } }` →
  `{ questionId, status: "found_in_video" | "asked_cook" }`

**Moss index** `family-<familyId>` (model `moss-minilm`; filled by `convex/moss.ts`)
- **Steps:** `<recipeId>:step:<n>`; the text is the step plus the cook's quote.
- **Stories and tips:** `<recipeId>:story:<i>` / `:tip:<i>`; only while the cook has opted in.
- **Metadata (all strings):** `recipeId`, `recipeTitle`, `kind` (`step` | `story` | `tip`), `stepOrder` (steps only),
  `startS`, `endS`, `quote`.
- Moss rebuilds the whole index on every write, so two writes at once lose one. **Only one sync runs per family**
  (`families.mossSync`). Each sync sends every ready recipe in the family and removes docs that shouldn't be there.
  A change that arrives during a sync triggers one more pass, and a sync that never reports back stops blocking
  after 10 minutes.
- After a Moss outage, `npx convex run worker:reindexMissing` re-syncs every family with a recipe Moss is missing.

**App ↔ voice service** (WebSocket `wss://<voice>/cook?session=<sessionToken>&recipe=<recipeId>`)
- App → server: binary frames of 16 kHz mono 16-bit PCM; `{ "type": "step", "stepOrder" }` when the kid taps (the
  server says that step's line; the first one, sent on open, restores the screen's step and isn't read; with
  `"read": false`, a step the cook's clip moved the screen to, it only moves, so no line plays over her clip).
- Server → app: `{ type: "transcript", text }`, `{ type: "go_to_step", stepOrder }`,
  `{ type: "play_clip", startS, endS }`, `{ type: "say", text, ai: true }` followed by binary audio,
  `{ type: "asked_cook", questionId }`.

**Claude's tools** (one per turn): `next_step`, `previous_step`, `repeat_step`, `go_to_step(n)`,
`find_moment(query)` (Moss search over the family's index), `play_clip(startS, endS)`, `ask_cook(question)`,
`say(text)`, plus the kid-side `give_hint(hint, question)` and `set_timer(seconds, label)`. The system prompt says:
never state anything the cook didn't say. Answer with the cook's clip or ask the cook. A question takes one Claude
call: the service searches Moss with the kid's words before asking Claude and says what it found, or that it found
nothing (then Claude doesn't search again; `find_moment` is only for other words when the kid's were vague).
`give_hint` is one step: the labelled hint (under 15 words), then the question goes to the cook as `ask_cook` does
(`/voice/question`, `asked_cook`, "I'll ask Grandma too." as soon as the hint has played), with no second call.

## Oct 24 additions: homie, translation, glasses VM, Community (PLAN.pdf v2)

Caleb's updated PLAN.pdf (Oct 24) and his answers to the review questions add five build tracks on top of A–D. These contracts let them run in parallel; `convex/schema.ts` holds the data model.

| Track | What | Owns |
|---|---|---|
| E · homie live | Parent live pass (`/record`), `/speak`, kid-side timers, nudges, step lines made ahead, labelled hints | `voice/`, `convex/live.ts`, `convex/lib/liveRoutes.ts` |
| F · Translation + pipeline | Cook's language end to end, original + English quotes, homie log in the full pass, upload race, 8–12 steps | `pipeline/`, `convex/worker.ts`, `convex/lib/recipeJson.ts`, `convex/moss.ts`, `convex/people.ts`, `app/src/lib/languages.ts` |
| G · Community | Feed, share switch + Muse story card, share asks, swaps, cook together, one dinner flow, dinner invite links | `convex/community.ts`, `convex/dinners.ts`, `convex/shareRequests.ts`, `convex/storyCards.ts`, `convex/lib/geo.ts`, `convex/lib/inviteRoutes.ts`, `convex/seedCommunity.ts`, `app/src/app/community/*`, `app/src/app/dinner/*`, `app/src/app/d.tsx`, `app/src/app/kid/community.tsx`, `app/src/lib/live/community.ts`, `app/src/lib/live/invite.ts`, `web/src/app/d/` |
| H · Glasses VM | ESP32 → free GCP e2-micro → MP4 → GCS → job | `glasses/`, `convex/glasses.ts`, `convex/lib/glassesRoutes.ts` |
| I · App UI | homie pot everywhere (docked in cook mode's bottom bar), captions + timers, recording screen, walkie-talkie, language picker | `app/` (everything else) |

**Decisions that change earlier rules** (Caleb, Oct 24):
- Change 5 is replaced: the ESP32 glasses stream to a VM, not the camera roll. "From my glasses" stays as a fallback.
- Change 6 is relaxed: when no clip answers, homie may give a **labelled AI hint** ("Grandma didn't say. Most recipes
  use about a teaspoon.") and **always** asks the cook too. The hint is never presented as the cook.
- Change 7 is partly replaced: while recording, the parent never taps; homie listens. Answering a kid's question
  stays push to talk (now the half-screen walkie-talkie). Full voice navigation of parent mode is still a stretch.
- Live speech-to-text by language (`voice/src/stt.ts`): Ink 2 for en/fr/hi/ja/es; Cartesia ink-whisper (live, `language`
  set, `voice/src/inkWhisper.ts`) for the other languages a cook can pick (Oct 24); Gemini Live for Marathi and Odia
  until the move off Gemini. Sonic 3.6 speaks all of them except Cantonese (`docs/agents/memory/cook-languages.md`).
- homie's voice everywhere (Caleb, Oct 24, `docs/agents/memory/homie-voice.md`): "Riya bilingual"
  `930eda72-c1af-4637-8d07-87d881d615fe`, `sonic-3.6`, 24 kHz, speed 0.85 on every line. Marathi as `locale: "mr-IN"`,
  English as `locale: "en-IN"` plus a mood per kind of line (`generation_config.emotion`, English only); other
  languages as `language`. If Sonic fails before any audio (HTTP error, network, nothing in 4 s), Gemini TTS
  (`gemini-3.8-flash-tts`) says the line in the same 24 kHz s16le format; after audio started, the line just ends.
  Gemini has its own guard (first audio within 6 s, the whole line within 10 s + 100 ms a character); a stall, an
  empty stream or a failed interaction ends the line (`say_end`), and `/speak` answers 502.
- Languages are Ink-style ISO 639-1 codes (`mr`, `en`) everywhere: `people.language`, `recordings.language`,
  `jobs.language`, `recipes.language`. Unset means `en`.

**App → Convex (new public functions; every one takes `sessionToken`)**
- `live.startRecording({ dish?, forKidIds?, forKidId?, language, source })` → `{ recordingId }` (cook only; status
  `intro`). "Who is it for?" can tick several kids (Oct 24): `forKidIds`, each a kid in her family, else the call is
  refused. Rows store `forKidIds` (and `forKidId` only when there's exactly one kid); readers take `forKidIds`, else
  the older `forKidId` (`convex/lib/forKids.ts`). `/live/session` returns `kids: [{ name }]`, and `kid` only for
  exactly one kid (homie names one kid, else says "your family").
- `live.recording({ recordingId })` (live): the row, for the recording screen.
- `live.setCover({ recordingId, storageId })` → `{ ok }` (cook only, her own recording): the plate photo
  (uploaded with `files.uploadUrl`) becomes `recordings.coverStorageId`; a newer one replaces it and deletes the
  old file. `{ ok: false }` once abandoned.
- `live.endRecording({ recordingId })` → `{ ok }` (cook only, her own recording; another family's or another
  cook's is refused): the stop button when the `/record` socket isn't connected. A `recording` or `wrapping_up`
  recording becomes `ended` (sets `endedAt`), so the glasses VM finalizes the video even when the voice service is
  down. Calling it again returns `{ ok: true }` and changes nothing; `{ ok: false }` means there was nothing to
  end (still `intro`, or `abandoned`).
- `jobs.create` gains optional `title`, `language`, `forKidIds` (or the older `forKidId`), `recordingId`.
  `recordingId` must be this cook's recording; the job then sets `recordings.jobId` and takes the recording's
  `dish`, `language` and kids for any not given. `language` defaults to the cook's `people.language` (else `en`);
  every kid must be a kid in the family. **Idempotent per upload folder** (Oct 24): a second call for a folder this family
  already has a job for returns that job (a stopped one stays stopped), so the phone asks again until it hears back
  (`app/src/components/record/jobRetry.ts`); a folder another family's job uses is refused.
  The `title` (or dish) is the processing card's title instead of "New recipe", and the recipe's name.
- `people.setLanguage({ language })` (self; a two-letter code, lowercased). `people.me` → `{ personId, name, role,
  language, relation? }` (`language` is `en` when unset). `people.family` → `[{ personId, supabaseProfileId, name,
  role }]` (my family only), so the app maps profile ids to Convex ids (Oct 24).
- `jobs.cancel({ jobId })` / `jobs.cancelUpload({ uploadId })` → `boolean` (cook only, her family's jobs): stops an
  unfinished job (stage `failed`, error `Cancelled.`, its recipe `failed`); `cancelUpload` finds it by the phone's upload
  folder (`<uploadId>/`) when the phone has no job id. False when there's nothing left to stop.
- `messages.madeMyDish` → the newest photo someone else sent of one of my dishes in the last 14 days (`{ messageId,
  fromName, recipeTitle, libraryId?, photoUrl, text?, at }`), or null: the cook's Home card "Leo made your Poha".
- `questions.ask` (the voice service's `asked_cook`): when the recipe's cook doesn't speak English, Gemini fills
  `questions.textForCook` (the kid's question in her language) a moment later; on failure it stays unset.
  `questions.forRecipe` / `openForCook` return it.
- `questions.forRecipe` already exists; the kid's cook mode reads it to hear the cook's answer (`answerAudioUrl`,
  `answer.translation`). It leaves out share asks (below): their answers are never played while cooking.
- Community: `community.feed({ maxMiles?, now })` → `{ here, recipes, dinners }` (`now` is required: the client's
  clock rounded down to the quarter hour and moving on, to leave out dinners that have started; queries can't read
  it). `here` is my own ~1 km grid cell (the map's middle).
  Each recipe row: `recipeId, dish, familyName, cookName, distanceLabel, approx` (the cook's grid cell, never finer;
  no stored location = `DEMO_LOCATION`), `ours` (my own family's shared dish, on the map too), `story`, `culture`
  (Muse's label, or null), `quote` (one of the cook's own English step quotes, or null), `quoteTranslated` (that
  step has her original words: the app tags it "Translated"), `coverUrl` (our stock/cover photos only), `stepCount`,
  and `dinner` (the soonest open one around that dish still ahead, never on my own family's dish:
  `{ dinnerId, startsAt, seatsLeft, hostName, distanceLabel }`; the distance is the dinner's own, where its host is),
  or null. `community.recipe({ recipeId })` (text
  only), `community.setLocation({ lat, lng, campus? })` (snapped to the ~1 km grid before it's stored),
  `community.setShare({ recipeId, on })` (the recipe's cook only; a story card written from her stories shows as a
  plain line, with no culture, once she says no to them, and her next share rewrites it). The story card
  (`storyCards.writeStoryCard`, Muse Spark, one JSON call) holds the sentence, `culture` and `quote`: Muse only picks a quote by
  its number from her step quotes (≤ 20 words; never a story, never its own words); without Muse, culture is null and
  the quote is her first step quote. A quote that stops being one of her step quotes stops showing.
- **Share asks** ("Put it on the map", `convex/shareRequests.ts`): `shareRequests.ask({ recipeId })` → `"shared"`
  (it already was, or I'm its cook: shared at once by the same path as the switch, `community.shareOn`) or
  `"asked"`: a `questions` row with `kind: "share"` and `shareRecipeId`, addressed to that recipe's cook like any
  open question (one open ask per recipe). Gemini fills `textForCook` (her language) a moment later; the ask reaches
  her in her language because the parent screens show `textForCook` (LiveQuestions and the walkie-talkie, #35). A
  parent screen that showed only `text` would put the English question in front of her.
  Only her answer counts (`questions.answer` refuses a share ask from anyone but the recipe's cook). Once her words
  are in (typed, the voice note's Ink transcript, or a voice note nobody could write out), `shareRequests.decide`
  asks Gemini, strictly, yes / no / unclear (`lib/yesNo.ts`) on the English (`translation`, else `transcript`, else
  `text`). It gets a fixed question (`YES_NO_QUESTION`, "May homie put your recipe on the neighborhood map?"), never
  the stored one (that has the asker's name and the dish), and her answer as one JSON string it's told to read as
  data. `shareRequests.settle` writes `questions.shareDecision` `{ said, at }` once. Only "yes" shares; no, unclear,
  a failure, no Gemini key, no words: nothing is shared, and nobody in the family can ask her again for a day
  (`ASK_AGAIN_MS`; `ask` says "Rajani said not now. Ask again tomorrow."). Her own tap still shares at once.
  `shareRequests.familyDishes` → my family's ready dishes `{ recipeId, dish, cookName, mine, shared, asked,
  notNowAt }` for the "Share your recipe" chooser (`asked` stays true until homie has read her answer; `notNowAt`:
  when she last said not now, so the row reads "Grandma Rajani said not now" for a day). What neighbors see (the
  question, the cook's switch, the privacy note) names the culture label as "homie's guess at where the dish is
  from" (`TODO(caleb)` on the words); the map card tags it "AI".
- **Swaps and "Cook together"** (`swapRequests` table, `kind` unset = swap, `"cook"` = cook together):
  `community.requestSwap({ recipeId, myRecipeId? })` (their recipe and the one I offer must both be shared; asking
  again returns the same ask; after a no it says "They said not this time"), `community.cookTogether({ recipeId })`
  (the same rules, no offer), `community.respondSwap({ swapId, accept })` (anyone in the family that was asked,
  once, for either kind), `community.mySwaps` → `{ swapId, kind, status, incoming, ourDish, theirDish, familyName }`
  (a dish only while it's ours or still shared; no person ids). Neither shows recipe text neighbors couldn't
  already see. Once a "cook together" is accepted, the asking family may host a dinner of that dish.
  `dinners.create({ recipeId, startsAt, placeKind, placeName, address, seats })` (one of my family's recipes, shared
  first; or another family's shared dish they said yes to cooking with us), `dinners.get({ dinnerId })` (with
  `coverUrl`, our stock photo, when the recipe opens, and `inviteOpens`), `dinners.mine`,
  `dinners.requestJoin({ dinnerId })`,
  `dinners.respond({ requestId, accept })` (host only).
- **Dinner invites** ("Invite friends"): `dinners.inviteLink({ sessionToken, dinnerId })` (an action) →
  `{ token, url: "https://homecookd.app/d?t=<token>" }`, for the host or an accepted guest only. One random
  43-character token per dinner (`dinners.inviteToken`, made the first time anyone asks, then the same every time).
  `POST /invite/open` on the `.convex.site` host (`convex/lib/inviteRoutes.ts`), public: `{ token, deviceId }`
  (token 20–64 and deviceId 16–64 of `[A-Za-z0-9_-]`) → 200 `{ dish, hostName, startsAt }` and nothing else
  (`hostName` is the host's display name, as the invite text and the dinner page say it; never the place, the
  address or an id), 404 for a link that doesn't work (or a called-off dinner), 400 for a
  bad body, 403 from a site that isn't homecookd.app or localhost (CORS, with an OPTIONS preflight; the app's fetch
  sends no Origin). Each `deviceId` counts once per dinner (`dinnerInviteOpens`) while the dinner is ahead, at most
  `OPEN_BURST` (60) new ones per 10 minutes and `MAX_OPENS` (300) in all; past those the page still opens,
  uncounted. "X going" on the dinner page = the host + accepted guests + `inviteOpens`. The web's static `/d` page
  (`web/src/app/d`, `NEXT_PUBLIC_CONVEX_SITE_URL`, default `https://grand-dragon-649.convex.site`) and the app's
  `/d` screen (`homecookd://d?t=…`, signed in or not) call it with a random id the browser or install keeps.
  Community responses never include `libraryId`,
  `recipeJsonUrl`, `coverUrl` of a private recipe, moments, memories, quotes other than the card's one, original-
  language quotes, person ids of other families, or an address (except to the host and accepted guests). Distance
  is a label from `lib/geo.ts`. `families.publicName` is the surname ("Pawar"); cards say "The Pawar family", or
  "Rajani's family" without one. Demo data: `seedCommunity:neighbors` (8 neighbor families with culture and quote,
  the quote from `web/src/content/recipes.ts` `feelQuote`), `seedCommunity:floormateDish({ familyId, dish,
  culture?, quote?, coverUrl?, story?, cookId?, steps: [{ title, text, quote? }] })` (one shared, text-only dish with
  a pre-written card for a floormate's real family; the quote must be one of the steps' quotes; running it again
  updates the same dish), `seedCommunity:place({ personId } | { familyId })` (puts one account, or a whole family,
  at `DEMO_LOCATION`: a family's dish sits where its cook is, so `{ familyId }` puts it "In your building"),
  `seedCommunity:publicName({ familyId, publicName })`.

**Voice service → Convex for homie** (HTTP POST, `x-voice-secret`; `convex/lib/liveRoutes.ts`)
- `/live/person` `{ sessionToken }` → `{ personId, familyId, name, role, language, relation }` (401 if signed out).
- `/live/session` `{ sessionToken, recordingId }` → `{ recording, cook: { name, relation, language }, kid?: { name },
  dish?, metBefore }` (404 if it isn't this cook's). `metBefore`: another of her recordings started filming, so
  homie's hello is a short welcome back that never introduces homie again (`voice/src/homie.ts` `intro`).
- `/live/status` `{ sessionToken, recordingId, status }` → `{ ok, startedAt? }`. Moving to `recording` sets
  `startedAt` (server clock) once; `ended` sets `endedAt`. `{ sessionToken, recordingId, touch: true }` (no
  status) → `{ ok }` is the service's heartbeat every 10 minutes while the socket is open: it only moves
  `updatedAt`, so the 2 h idle cleanup (`live.abandonIdle`) leaves a long cook alone; 400 once ended or abandoned.
- `/live/prompt` `{ sessionToken, recordingId, kind, text, textEn, atS, status, said? }` → `{ promptId }`. `400` "recording
  already ended" once the recording is over: only the `closing` line may land after `ended` (it races the status
  write), nothing after `abandoned`. `said` `{ atS, endS }`: when homie's voice played on the phone (same clock as
  `atS`), for lines saved after they were said (the hello, reactions, the goodbye).
- `/live/prompt-said` `{ sessionToken, promptId, said: { atS, endS } }` → `{ ok }`: a question's voice span, saved
  once it has played (questions are saved before they're said). homie's voice is in the phone's own video, so the
  worker's `homieLog` carries `said` (video seconds) and the pipeline can lower or cut those spans.
- `/live/prompt-update` `{ sessionToken, promptId, status, answer? }` → `{ ok }`.
- `/live/optin` `{ sessionToken, recordingId, optIn }` → `{ ok }` (stored on the recording, carried to the job).

**App ↔ voice service: homie while recording** (`wss://<voice>/record?session=<sessionToken>&recording=<recordingId>`)
- App → service: binary 16 kHz mono s16le PCM (the phone by the stove), always streaming;
  `{ type: "start" }` when the cook starts cooking after the intro; `{ type: "done" }` on "I'm done";
  `{ type: "text", text }` (typed answer, tests); `{ type: "not_now" }` (tap on the caption card).
- Filmed in the app (Oct 24, `app/src/components/record/useInAppCamera.ts`; older builds use the system camera and
  close the socket while it's up): `{ type: "start", camera: true }`; the socket and the mic stay open while the
  phone's camera films. `{ type: "frame", jpeg }` (base64 JPEG, ~640 px, about every 5 s) replaces the glasses'
  frame; Claude sees it only while it's under 20 s old. `{ type: "pause" }` when the camera stopped (she left
  the app, a call, the lock): homie hushes, drops its question and asks nothing. `{ type: "resume", gapS }` when it
  films again, and at each 5-minute file roll: `gapS` is the wall time the video skipped, so every later `atS` is
  on the video's clock (the clips concatenated). `{ type: "plate", ok }` answers the plate ask below.
- Service → app:
  - `{ type: "ready", recording: { id, language, cookName, kidName?, dish? } }`
  - `{ type: "phase", phase: "intro" | "recording" | "wrapping_up" | "ended" }`
  - `{ type: "state", state: "listening" | "thinking" | "speaking" | "quiet" }` (the pot's steam)
  - `{ type: "say", text, textEn, kind, ai: true, audio }` + binary audio + `{ type: "say_end", interrupted }`.
    `kind` is a `homiePrompts.kind`. The app lights the pot just before audio starts. If the cook taps start or
    done while homie's line is still playing, an extra `{ type: "say_end", interrupted: true }` tells the app to
    stop it. A line stopped while it's still being made gets its `say_end` (`interrupted: true`) at once, and no
    more of its audio: every `say` has exactly one `say_end` before any other message but `state`.
  - `{ type: "ask", promptId, text, textEn, kind }`: show the caption card. `{ type: "drop", promptId }`: fade it
    (no answer in ~10 s, "not now", or she's done; in the wrap-up, no answer even after "still there?"). `{ type: "answered", promptId }`. Kind `show` (filmed in the
    app): "Can you tilt the pan toward me?". Kind `plate` (filmed in the app, in the wrap-up after the last
    question, the opt-in): the app shows the camera big and takes the photo (`live.setCover`), then sends
    `{ type: "plate", ok }`; no answer in 75 s, or "not now", skips it.
  - `{ type: "hold", on }` (Oct 25, wrap-up only): `on: true` = keep homie big in the middle; the spoken questions
    come back to back, so don't shrink it to the corner between them. `on: false` = they're over, back to the
    corner. On comes with "I'm done": right after `phase: wrapping_up` (and the `say_end` of a line it stopped),
    before the live card's `drop` and before any line, so homie never shrinks while Claude writes the end
    questions (the opt-in is always still to come, so there is always a question). On a reconnect in the middle
    of the questions: right after `ready` and `phase`. Off comes right before the plate `ask` or the goodbye `say`, after the last question's
    wait ended (answered, `not_now` or ignored) and after the let-off has played if there was one. "Still there?"
    and the let-off happen while it's on. No hold when no spoken question is left (a reconnect during the plate
    photo). Never on at `ended` (off is sent before the goodbye, and before `phase: ended` when the recording ended
    underneath: "I'm done" on a recording the app had already ended gives on, then off one round trip later); a new
    socket starts with it off. Never sent between a `say` and its `say_end`. Backward
    compatible: older apps ignore unknown types (`app/src/lib/live/homie.ts` `onMessage` has no case for it).
  - `{ type: "transcript", text, final }`, `{ type: "error", message }`. Close 4401 signed out, 4404 no such recording
    (or it already ended), 4409 a newer socket for the same recording took over (don't reconnect that one).
- A reconnect picks up where the last socket stopped (same pacing, questions and transcript; the wrap-up finishes
  what's left). Details in `voice/README.md`.
- Ended underneath (the app called `live.endRecording` while it couldn't reach the service): a socket still open
  for it finds out at its next Convex write (heartbeat, status or homie's next line). It then says and saves
  nothing more, sends `{ type: "phase", phase: "ended" }` and closes with 4404.
- The wrap-up waits for her (Oct 24, `docs/agents/memory/homie-waits-for-answers.md`; `voice/src/record.ts`
  `listen`). homie never starts a wrap-up line (end question, plate ask, thanks, opt-in, goodbye) while she talks
  (it waits at most 30 s). The card's tap counts from the `ask` on; a spoken turn counts only if its words came
  after the question played (the mic is muted under homie's line, so a turn ending during it is talk from before:
  an afterthought, or family, never the answer). An answer is every turn from her first words until no new words
  have come for 3.5 s (Ink 2, ink-whisper) or 4 s (Gemini Live, Marathi) and no turn is
  open, so a pause to think doesn't end it; sound on the mic, or turns the speech-to-text opens and ends empty
  (kitchen noise), hold that at most 4 s with no words. One answer ends 100 s after the question at the latest
  (under the app's 120 s wrap-up stall). "not now" (the card's tap, sent as `{ type: "text", text: "not now" }`, or
  `{ type: "not_now" }`, or said as her first words) stops homie's line and skips that question at once (`drop`,
  `not_now`); the next one comes. No word 5 s after a question finished playing: homie says "Still there, Rajani
  Aaji? Take your time. I'm listening." (once she's quiet: not if her words arrived meanwhile, and a wait that noise
  held to its cap is waited again first); 5 s more after that line played (never without it):
  `drop` (`ignored`), the let-off "That's okay, Rajani Aaji. No need to answer today. All good, let's finish up.",
  and nothing more is asked (no further end question, no opt-in, which stays unset); the plate photo still comes
  when filmed in the app, then the goodbye. Both lines are `say` kind `reaction` and saved as `reaction` prompts. A
  speech-to-text that has shown nothing in the recording (or errored since): no nudge or let-off, a plain 15 s wait
  per question. Every wait and each line's `said` span count from when the phone plays the line: it plays only once
  it has all of it, ~250 ms after `say_end` (`PLAYER_LOAD_MS`), not from the first chunk. A turn with no
  words (Ink can end one empty) answers nothing, and a live question's card fades 10 s after it. (#83 added no
  messages.)
- The wrap-up's order and count (Oct 25, `docs/agents/memory/homie-counts-end-questions.md`; `record.ts` `wrapUp`):
  the count line, the end questions (≤ 2, written once per recording: a reconnect asks the rest of the same ones)
  and the stories opt-in back to back inside `hold`, then (filmed in the app) the plate photo and "Got it. Thank
  you!", then the goodbye. The count line is homie's first line after "I'm done", a `say` kind `reaction` (saved as
  a `reaction` prompt with `said`), never an `ask`: the real number of spoken questions (end questions left + the
  opt-in) and the plate photo if it comes: "Before we send it, three quick questions and a photo of your plate." /
  "Just two quick questions before we send it." / "Before we send it, one photo of your plate." (no line when
  there's nothing). Hand-written Marathi ("पाठवण्याआधी फक्त दोन छोटे प्रश्न."); other languages translate the
  English once, while Claude writes the questions. It replaces the old "Before you go, two quick ones." lead-in;
  said once per recording (not again on a reconnect unless it was cut off), and nothing later says "one more" or
  "last question" (the prompt asks Claude not to, and an end question that opens that way, `homie.ts`
  `countsItself`, becomes the written one of its kind). A spoken "not now" right after the count line answers
  nothing: the first question is still asked, and she can say "not now" to it. The opt-in is asked once: a reconnect after its wait never asks it again (only a clear yes or no is saved). Live
  questions while she cooks are never back to back (the pacing's gap is 3.5 min, 90 s with `HOMIE_DEMO=1`), so
  they get no hold.
- homie stays in the centre across the wrap-up's questions (Oct 25, Caleb: no "back to the corner, then
  straight back to the middle" between two questions). Service → app `{ type: "hold", on: true }` the moment she
  taps "I'm done" (order: phase `wrapping_up`, `say_end`, hold on, then the drop of any live card), before the
  count line or any line, and on a reconnect mid-run right after the phase; `{ type: "hold", on: false }` once the
  run is over (after the last answer or skip, and after any let-off line), right before the plate photo ask or the
  goodbye. App side (`lib/live/homie` `hold`/`said`, `components/record/recordingLogic`
  `heldAfter`/`momentView`/`liftToFit`, `AskMoment`): homie's centred moment is up while held or while a question
  (not the plate) is up, so a live card up at "I'm done" never shrinks: its words fade out and homie stays, thinking
  with no words while the questions are written. homie never moves or shrinks while held (on a short phone a long
  question can lift it once, only up, to fit), and the words under it crossfade in place. Between questions it
  shows only what homie is saying (a `say` that starts while held with no question up: the count line, a let-off;
  a question clears it) or nothing; the listening bars, "Just answer out loud" and the tap that skips ("not now")
  only while a question is up. `ready`, any close (4409 included), a pause, `ended`, a plate ask and a stalled
  wrap-up (the app ending it without homie) turn the hold off. An older service never sends it: each question
  opens and closes on its own, as before. Live questions while filming are minutes apart (the pacing below), so
  they never need it.
- The service ignores incoming audio while homie speaks, until the phone can first have finished playing the line
  (`say_end` + its length), so it never hears itself; the app also sends silence while it plays, so a quick reply
  right after the line isn't cut. homie gives guidance, never cooking advice (`docs/agents/memory/homie-guidance-only.md`). Pacing
  (normal, Oct 24): first question no earlier than 2 min, gaps of 3.5 min, doubled after an ignored one, at most 8
  live plus 2 end questions, never while the cook talks or tells a story. `HOMIE_DEMO=1`: first
  question at ~40 s, then 90 s gaps, at most 2 live.
- Glasses frames: when `GLASSES_URL` is set, the service pulls `GET <GLASSES_URL>/frame/latest?recording=<id>`
  (`x-glasses-secret`) every ~5 s and gives the newest JPEG to homie's decision. `HOMIE_DECIDE_MODEL` (empty =
  `CLAUDE_MODEL`) picks the model for that decision, the call that adds up (`voice/scripts/try-decide.ts`).

**Voice service HTTP** `POST /speak` `{ sessionToken, text, lang?, translate?: boolean, kind?: string }` → `audio/wav`
(24 kHz, homie's voice, in `lang` or the person's language). `translate: true` first turns English `text` into `lang`.
`kind` (optional, a `say` kind such as `step` or `hint`) picks the mood of an English line; none = `content`. Header
`x-spoken-text` (URI-encoded) is what was actually said. Used by walkie-talkie and the pot's tap hints.

**A tap on homie** (Oct 24: a tap always gets a spoken answer). Convex `homie:news({ sessionToken, now })` (live in the
app; `now` rounded to 10 min) gives at most 3 facts `{ id, kind: answer | asked | cooking | recipe | quiet, line, at }`,
newest first, a quiet week only when nothing else is new. The app asks `POST /homie/line { sessionToken, factId, tab? }`
→ `{ text, written }` ahead of the tap: the voice service reads the facts itself (`POST /homie/news` on Convex,
x-voice-secret) and Claude says that one fact warmly (`voice/src/tapLine.ts`; the plain `line` when Claude fails,
`written: false`). A tap says the newest untold fact once (never in cook mode or while she films), else the
screen's one line about its big button, or "I’m right here." on a second tap in a row (`app/src/lib/homie/tap.ts`),
then `/speak` with `translate: true`.

**App ↔ voice service: kid cooking additions** (`/cook`, backward compatible)
- `say` gains `kind`: `step | reply | hint | translation | nudge | greeting | timer`, and `textEn` when the
  spoken text isn't English. A `hint` is AI general knowledge: always labelled, always followed by `asked_cook`.
- `play_clip` gains `quote?` and `quoteEn?` for the caption.
- `{ type: "timer", id, seconds, label, endsAt }`, `{ type: "timer_done", id, label }`. The app owns the countdown.
- After `ready`: one `say` of kind `greeting` (a word in the cook's language + `textEn`), once per kid and recipe
  per 3 h on the instance (a reconnect gets no second hello). No read-aloud offer any more (Oct 24): there's no
  `offer` kind and no `offer_closed`.
- Step lines (Caleb, Oct 24): on every step change the server says the step's short line at once, a `say` of kind
  `step` ("Step 2. Melt the sugar to amber."), pre-generated so a flip never lags. A step change is the app's
  `{ type: "step" }` (a tap on Next, Back or a step) or homie's own move ("next", "go back", Claude's `next_step`,
  `previous_step`, `go_to_step`). "Repeat" says the whole step (`Step 3. <all of its text>`, live, not kept); the
  next flip says the short line. Not for the first `step` the app sends as the socket opens (the restore: before
  `ready` or within 3 s of it; the session starts on that step; a later `step` before `ready` is a tap, read once
  ready), and not when the step didn't change. The line is the step's text cut to about 20 words with plain rules,
  no Claude (`voice/src/stepLine.ts`). Once the hello's first audio is out (or at once with no hello, or one waiting
  for a video), Sonic makes every step's line ahead, from the current step on, 2 at a time across the process, in
  homie's voice exactly as a step said live, and the audio is kept per process (`voice/src/lineCache.ts`, LRU: 300
  lines or 64 MB), so another kid on the same recipe or a reconnect costs nothing (about 1 credit a character,
  once: ~380 for a 6-step recipe). A kept line goes out all at once (`say`, every frame, `say_end`); one not made
  yet streams from Sonic and is kept. Made ahead it's Sonic alone (the backup voice is never kept); a line that
  failed isn't asked of Sonic again for a minute, so its flip goes straight to Gemini, and a 402 or 429 stops the
  making ahead and sends every step line to Gemini for that minute. A new `say` cuts off the one playing, so rapid
  flips play only the latest step's line. A step line answers the kid's flip, so it's spoken over a video too. The
  story `nudge` can follow a step's line, as before.
- Was it for homie? Claude decides on every turn that reaches it (no wake word): "homie" in the transcript, however
  Ink spells it (homey, holmy, homi), is a strong yes; plain commands (next, back, repeat, timers) skip Claude and
  always work. Words not meant for homie get no tool and no speech, and the service sends `{ type: "quiet" }` so
  the app stops showing homie thinking. Words said while the app's `ask` moment is up ("Ask Grandma anything",
  a long press on homie; the app holds the mic on while it's up) skip Claude: a plain command still runs, a
  cancel word gets "Okay.", sounds and fewer than three real words wait for the question, and anything else (a
  yes word and all) goes straight to the cook (`askCook`), once (`voice/README.md`). A tap never opens it; the
  mic itself is on only when homie is, see below.
- App → service: `{ type: "video", playing: boolean }` when any video (or the cook's own voice note) starts or stops
  on the kid's phone. While one plays (or a clip the service asked for), homie says nothing on its own: a
  `greeting`, `nudge` or `timer` line waits for the next pause, one after another (`timer_done` is still
  sent at once). Answers to what the kid just did or said are spoken meanwhile (a step's line is one); the app
  pauses the video for them.
- App → service: `{ type: "moment", open: true, kind: "answer" | "story" | "ask" | "help" }` when an app-only homie
  moment opens on the kid's phone, `{ type: "moment", open: false }` when it closes. While one is open the service
  still streams transcripts, but a spoken yes, no, sure or not now is not applied to its story nudge (and doesn't
  reach Claude); other speech goes the usual way. It says no nudge until the moment closes. A `{ type: "text" }` answer is the app's own and always counts. What counts as a yes or a no, for
  the nudge and the moments: `voice/src/yesNo.ts`, which follows the app's `yesNo`. A yes word (yes, yeah, sure,
  of course) is a yes whatever follows ("Yes, but how much ginger?"). Only okay, ok, alright and please have an
  exception: with a command or a question after them ("Okay, what's the next step?") they go the usual way. It also
  takes a no with more after it ("No, not right now"), and a no wins. The no is handled first; then, even with a
  moment up, anything after it that isn't just more no is still the service's: a plain command or a timer that is
  the whole ask takes the fast path ("No, next step"), and anything else goes to Claude as the kid's whole sentence,
  never a cut-down copy, with a note that the nudge was declined ("No, I'm out of ginger. Can I skip it?"). "No,
  maybe later" is only the no. The app's `yesNo` and `afterNo` (`app/src/lib/live/voiceLogic.ts`) are a copy of
  it, so the phone's own moments and the service agree.
- Half duplex: while the app makes sound (homie lit or speaking, anything on the shared player, a step video
  playing), `lib/live/mic` zeroes every frame (same length; the recorder keeps running). `/record` still gets those
  zeroed frames; `/cook` gets no frames at all while the app makes sound or another screen is on top (Ink bills
  every second it gets, silence too). The cook line closes when the app goes to the background (not for iOS
  'inactive': Control Center, the notification shade, a call banner) and reopens on return. Each reopen is a new
  socket, where the service starts its timer ids again at `timer-1`, so timer ids are per socket on the phone: a
  timer from an older socket keeps counting down and buzzing there, and leaves on its own (its `timer_done` can't
  come).
- What the app sends (Track I-kid): no chips (cook mode's bar is Back · homie · Next step, homie 60 pt like the
  buttons). A tap on homie turns it on or off: on, the mic records and streams (pot `listening`), off, the
  recorder is stopped (no frames, no Ink) and the pot is a plain white circle. When a `say` of kind `step` or
  `nudge` finishes playing, the mic listens for an 8 s window; words in it hold it on until the answer is over
  (`voiceLogic` `micAfter`, `micTimer`, `opensWindow`). The socket opens by itself either way, so step lines
  arrive. The buttons send `{ type: "step" }` (the service then says that step's line); "back" and "repeat" are
  also said out loud. On `ready` the app sends its own `{ type: "step" }` and doesn't follow the service's
  go_to_step right after it (the screen's step wins). A `say_end` while a newer line is open belongs to the line
  that newer one cut off. A story `nudge` and "Grandma answered your question" are no-buttons moments: the kid
  says yes or no (out loud while homie is on), or gets one button when homie isn't listening; a tap anywhere
  closes it.
- The app's side of moments (Track I-kid): it sends `moment` open / close for "Grandma answered your question"
  (`answer`), again on a new socket while one is up; the story nudge is the service's own, so it never counts.

**Upload signer ↔ Convex**
- The upload signer (`cloud/signer`, Cloud Run `edible-upload`) lets a phone in with `Authorization: Bearer
  <sessionToken>`: it calls the public `people:me` query on `CONVEX_URL` (`POST /api/query`, 5 s timeout) and
  answers `401` when Convex refuses the token, `502` when Convex can't be reached. A cancel or delete from a
  signed-in phone also needs `signer:owns { sessionToken, kind: "job" | "recipe", id }` to say yes (a cook, and
  the job's `uploadPath` or the recipe's `libraryId` is in the session's family), else `403`. No family id from the phone is
  trusted; the job's family comes from `jobs.create`, which takes the same session. The shared `X-Edible-Family`
  code (`FAMILY_CODE`) still works for older builds; an empty `FAMILY_CODE` turns that path off.

**Worker ↔ Convex additions**
- `/worker/claim` adds `title?`, `language` (the job's, else the cook's, else `en`), `relation?` (the cook's),
  `forKidName?` (only for exactly one kid), `forKidNames` (every kid, Oct 24), `memoriesOptIn?` (the recording's) and `homieLog: [{ atS, kind, text, textEn, answer?: { transcript,
  transcriptEn?, atS, endS } }]`, sorted, with times on the **video's** clock (`atS + (startedAt − videoStartedAt) /
  1000` when `videoStartedAt` is set, else `atS`; answers shifted the same). Prompts said before the video started
  (negative video time, e.g. the intro) are left out. Each entry may carry `said: { atS, endS }` (Oct 24): when
  homie's own voice played, which is in the phone's video too (lower or cut it there). `coverUrl?` (Oct 24): the
  plate photo homie asked for at the end of an in-app phone recording (`recordings.coverStorageId`); the worker
  downloads it and makes it the recipe's cover as it is, with no frame pick (`pipeline/cover.py` `use_photo`; a
  photo that fails to download or isn't one usable JPEG falls back to the frame pick). In-app phone clips are `part-01.mp4`, `part-02.mp4`, ... (signer objects `01.mp4`, `02.mp4` in
  the same order) with no creation-date tag: their order is the upload order.
- `/worker/release` `{ jobId }` → `{ ok }`: the upload isn't complete yet. The job shows stage `uploading` and goes
  back to `queued` after 30 s. `404` unless the job is `preparing`. The worker waits up to 45 s for every file the
  signer's `jobs/<job_id>.json` lists before releasing; with no signer file, for anything at `uploadPath`. It fails
  the job once the signer's links have expired (8 days), or after 20 releases without one.
- `/worker/published` accepts `language` (a two-letter code; else recipe.json's `language`, else the job's) and
  `steps[].quote_original` in recipe.json, stored as `recipes.language` and `steps[].quoteOriginal`. The worker sends
  the claim's `memoriesOptIn` when it has one.
- The pipeline gets the job's `title` (the dish name; Muse names it only when there's none), `language` and
  `homieLog` (in its prompts: never quote homie as the cook; start a step at the cook's answer). recipe.json gains
  an optional `language`.

**Glasses VM → Convex** (HTTP POST, `x-glasses-secret`; `convex/lib/glassesRoutes.ts`; see `glasses/INGEST.md`)
- `/glasses/active` `{}` → `{ recordingId, status, startedAt? }` for the newest `glasses` recording that isn't
  `ended`/`abandoned` (and is under 12 h old), or `204`. (One pair of glasses for the hackathon.)
  `{ recordingId }` → that recording in any status, or `404`, so the VM can tell `ended` (upload) from
  `abandoned` (don't).
- `/glasses/finished` `{ recordingId, uploadPath, videoStartedAt, durationS }` → `{ jobId, recipeId }`: sets
  `recordings.videoStartedAt` and `jobId`, and creates the "processing" card (titled with the dish) and the job
  (`source: "glasses"`) with the recording's dish, language and kid. Calling it again returns the same job; `400`
  for an abandoned recording or an `uploadPath` other than `glasses-<recordingId>/`, `404` for one that isn't a
  glasses recording.

**New keys**: `GLASSES_SECRET` (Convex env, the VM, Cloud Run secret), `GEMINI_API_KEY` (Cloud Run secret, for live
Marathi transcription), `HOMIE_VOICE` (Cloud Run env, optional: homie's Cartesia voice id; the code default is "Riya bilingual"
`930eda72-c1af-4637-8d07-87d881d615fe`, which Sonic speaks in Marathi and Indian English), `HOMIE_SPEED` (optional,
default 0.85), `GEMINI_TTS_MODEL` / `GEMINI_TTS_VOICE` (optional; the backup voice, also on `GEMINI_API_KEY`),
`GLASSES_URL` (Cloud Run env).

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

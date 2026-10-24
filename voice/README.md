# voice/: the live voice service (Tracks B and E)

Two live loops from `docs/build/STACK.md`, plus one HTTP route:
- `/cook`: the kid's phone streams the mic over a WebSocket. Cartesia Ink 2 turns it into text, and Claude picks
  one tool per turn: move a step, play the cook's clip (found by Moss), or send the question to the cook. Sonic
  speaks the short reply. Nothing is ever presented as the cook's words unless it is her clip.
- `/record`: homie while a cook records. The phone by the stove streams the mic; homie hears her in her language
  (Gemini Live for Marathi), says hello, asks a few short questions at the right moments, then the last
  questions, the stories opt-in and goodbye. Everything it says goes to Convex (`/live/*`).
- `POST /speak`: a line in homie's voice, for the walkie-talkie and the pot's tap hints.

```
src/server.ts   HTTP /health + POST /speak + WebSockets /cook and /record
src/cook.ts     one cooking session: wires Ink → (fast path | Claude) → actions → Sonic
src/agent.ts    Claude turn agent: tools, system prompt, the one-tool-per-turn loop
src/translate.ts  the cook's words from a played clip → short English, spoken after the clip
src/record.ts   one recording with homie: phases, listening, when to ask, the end flow, Convex logging
src/homie.ts    Claude for homie: the hello, ask-or-stay-quiet, end questions, strict translation
src/pacing.ts   when homie may ask (plain code: first question, gaps, limits)
src/lines.ts    homie's fixed lines in English and hand-written Marathi
src/stt.ts      picks live speech-to-text by language: Ink 2 (en/fr/hi/ja/es) or Gemini Live
src/geminiLive.ts  Gemini Live transcription (gemini-3.5-transcribe-live) with session rotation
src/ink.ts      Cartesia Ink 2 streaming STT (/stt/turns/websocket, built-in turn detection)
src/sonic.ts    Cartesia Sonic TTS (/tts/bytes, streamed), any language and voice
src/moss.ts     Moss search over family-<familyId> (@moss-js/moss, in-memory queries)
src/convex.ts   Convex HTTP actions (/voice/*, /live/*) + the local stub
fixtures/       stub session (Grandma's red-braised pork) and stub recordings (Rajani Aaji, mr and en)
scripts/        test clients (/cook and /record), test-audio maker
test/           unit tests (node:test) with a fake socket, Claude, voice and Convex: pacing, /record's phases
                (and a recording ended underneath it), /cook's read-aloud offer and the app's moments
```

## Run it locally

Keys come from the repo's root `.env` (found by walking up, so a worktree works too) or the process env:
`CARTESIA_API_KEY`, `ANTHROPIC_API_KEY`, `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, `CONVEX_SITE_URL`
(https://grand-dragon-649.convex.site) and `VOICE_SECRET`. Optional: `VOICE_STUB=1` (serve the stub recipe and
accept any session token, for tests without a real sign-in), `CLAUDE_FAST=1` (Opus fast mode), `CLAUDE_MODEL`,
`CARTESIA_VOICE`. For homie: `GEMINI_API_KEY` (hears Marathi; without it a Marathi recording gets no transcript),
`HOMIE_VOICE` (default Sindhu, `07bc462a-c644-49f1-baf7-82d5599131be`: a warm Indian voice Sonic speaks in Marathi
and English), `HOMIE_DEMO=1` (first question at ~40 s), `GLASSES_URL` + `GLASSES_SECRET` (frames from the glasses
VM), `GEMINI_LIVE_MODEL`.

```bash
cd voice && npm ci
npm run dev                                   # ws://localhost:8080/cook, live Convex
VOICE_STUB=1 npm run dev                      # the stub recipe instead
npm run make-audio                            # test-audio/*.wav, 16 kHz mono, spoken by Sonic
npm run make-audio -- no                      # only the lines named (here test-audio/no.wav)
npm run test-client -- test-audio/next-step.wav test-audio/question.wav test-audio/unknown-question.wav
npm run test-client -- test-audio/no.wav test-audio/next-step.wav   # no to reading: steps change silently
npm run test-client -- moment:answer test-audio/yes.wav moment:off text:no   # an app moment, then the app's no
SESSION=<kid's Convex sessionToken> RECIPE=<recipes _id> npm run test-client -- test-audio/next-step.wav  # live
URL=wss://<cloud run host> npm run test-client -- test-audio/next-step.wav   # against the deployed one
VOICE_STUB=1 HOMIE_DEMO=1 npm run dev         # then, in another terminal:
npm run test-record                           # a whole recording with homie, in Marathi (stub "stub-mr")
COOK_LANG=en npm run test-record              # the same in English ("stub-en")
SESSION=<cook's sessionToken> RECORDING=<recordings _id> npm run test-record   # live Convex
npm run typecheck                             # src/ and test/
npm test                                      # unit tests on a fake clock; no keys or network needed
```

The stub has no Moss index (the Moss plan allows 3 indexes, so don't make test ones): with `VOICE_STUB=1`,
questions go to the cook. To test search, use a real family's index, which Convex creates after a pipeline run.

The test client streams each WAV in 100 ms chunks at real-time speed, keeps sending silence like an open mic,
prints every event with timings, and saves what the service says to `test-audio/out/`. `text:<words>` sends a
`{ type: "text" }` message instead, and `moment:<kind>` / `moment:off` opens or closes one of the app's moments.
The service remembers a kid's answer to the offer for 3 hours, so restart it between runs that answer it.

## The WebSocket (`/cook?session=<sessionToken>&recipe=<recipeId>[&audio=pcm|wav]`)

App → service
- Binary frames: 16 kHz mono 16-bit little-endian PCM. ~100 ms per frame (3200 bytes). Keep streaming while the
  screen is up, silence included: Ink waits for audio, it doesn't assume silence.
- `{ "type": "step", "stepOrder": 3 }` when the kid taps a step (no speech).
- `{ "type": "text", "text": "how much soy sauce?" }`: typed or push-to-talk input, handled like speech. The app
  answers the read-aloud offer with `{ "type": "text", "text": "yes" }` or `"no"`. It's the app's own answer, so it
  counts even while one of its moments is up.
- `{ "type": "moment", "open": true, "kind": "answer" | "story" | "ask" | "help" }` when one of the app's own homie
  moments opens on the phone (not our offer or story nudge), and `{ "type": "moment", "open": false }` when it
  closes. While it's up, transcripts still come, but a spoken yes or no ("yes", "sure", "no thanks", "not now")
  is the moment's answer: it never answers our offer or nudge and never reaches Claude. Anything else (a question
  for the "ask" moment, "next") goes the usual way, and still isn't taken as a yes to our offer. homie says no
  offer or nudge while a moment is up; they wait for it to close. After a reconnect, send it again if one is up.
- Silence while a `say` or a clip plays (half duplex).

Service → app
- `{ type: "ready", recipe: { id, title, steps } }`, then `{ type: "go_to_step", stepOrder }` for where to start.
- Then homie's hello, a `say` of kind `greeting` in the cook's language (`"चला, स्वयंपाक करूया!"`, `textEn: "Let's
  cook!"`), and one `offer`: "Want me to read Grandma's recipe out loud? Say yes or no." Until the kid says
  yes (or "repeat"), steps change silently: only `go_to_step`.
  - Yes (spoken, or `text` "yes"): `{ type: "offer_closed", accepted: true }`, then the current step is read, and
    every step after it.
  - No or "not now" (spoken, or `text` "no"): `{ type: "offer_closed", accepted: false }` and nothing is said.
    Reading stays off for the visit: steps change silently, plain commands, questions and timers still work, and
    "repeat" reads the step they're on once.
  - A kid who answered in the last 3 hours (same instance) gets no hello and no offer again after a dropped
    socket, and keeps their answer.
- `{ type: "transcript", text, final }`: `final: false` while the kid talks, `true` once the turn ends.
- `{ type: "go_to_step", stepOrder }`: show that step. Its text is spoken right after.
- `{ type: "play_clip", startS, endS, quote?, quoteEn? }`: play that span of the cook's video. Nothing is spoken
  over it. `quote` is her words for the caption (the Devanagari `quoteOriginal` when the clip is a step's own
  moment), `quoteEn` the English when they differ. When the clip answers a question, half a second after it ends
  comes `{ type: "say", kind: "translation", text: "Grandma says: …", translation: true }`: her words in short
  English. Show it labeled as a translation. It's skipped only when Convex says the cook speaks English (an unset
  language still gets it). A step change or a new turn before then drops it.
- `{ type: "asked_cook", questionId, text }`: the question went to the cook. "I'll ask Grandma" follows.
- `{ type: "say", text, kind, textEn?, ai: true, audio: { format, encoding: "pcm_s16le", sampleRate: 24000 } }`,
  then the audio as binary frames, then `{ type: "say_end", interrupted }`. `kind` is one of `step`, `reply`,
  `hint`, `translation`, `nudge`, `offer`, `greeting`, `timer`; `textEn` comes when the line isn't English.
  `audio=pcm` (default) streams raw PCM to play as it arrives. With `audio=wav`, the frames joined together are
  one WAV file. A new `say` cuts off the one before it.
- A `hint` is general cooking knowledge, never the cook's: "Grandma didn't say. Usually just enough water to cover
  it." It comes only when no clip answers, and `asked_cook` plus "I'll ask Grandma too" always follow. Label it as
  AI.
- `{ type: "timer", id, seconds, label, endsAt }` when the kid asks for one; the app shows the countdown. At the
  end, `{ type: "timer_done", id, label }` and a `say` of kind `timer` ("The rice timer is done.").
- Nudges (kind `nudge`, only once reading is on): after a step with one of the cook's stories, "Grandma has a story
  about this one. Want to hear it?" ("yes" plays it; "no" or "not now" closes it quietly, with no `offer_closed`);
  and once per step after 6 quiet minutes, "Still on step 3?".
- `{ type: "error", message }`. Close code 4401 means the session token was refused (sign in again); 4404 means
  the recipe isn't in this family or isn't ready.

The phone must play audio with echo cancellation on (iOS voice processing). Otherwise Ink hears Sonic and the
cook's clips. As a backstop, the service ignores:
- a turn that mostly repeats what it just said;
- a turn written mostly in a non-Latin script (Ink writes the cook's Marathi in Devanagari; the kid speaks English);
- anything but a plain command ("next", "go back") while a clip is playing.

## How a turn works

1. Ink's `turn.end` gives the kid's words (the turn ends ~2 s after they stop, or sooner when Ink is sure).
2. Plain commands ("next", "go back", "say that again", with "um, wait, okay, please" around them), "yes" or "no"
   to an open offer, and "set a timer for 5 minutes" skip Claude.
3. Anything else: Moss searches the recipe's moments first (~10 ms, in memory), and Claude gets the words, the
   current step and those moments. It calls one tool: `next_step`, `previous_step`, `repeat_step`, `go_to_step`,
   `play_clip` (only times that came from Moss or a step), `give_hint` (labelled general knowledge, and the
   question still goes to the cook), `ask_cook`, `set_timer`, `say`, or `find_moment` (search again with other
   words, then one more pick). No tool means the speech wasn't for us, and we stay quiet.
4. Steps go to Convex `/voice/step`. Questions go to `/voice/question` as `found_in_video` (with the clip and the
   cook's words) or `asked_cook`.

Model: `claude-opus-5-5` at low effort, with server-side refusal fallbacks on. Measured locally (Oct 23):
plain commands ~0 ms after the transcript; a question 1.4–2.3 s standard, 1.1–1.6 s with `CLAUDE_FAST=1`.

## homie while recording (`/record?session=<cook's sessionToken>&recording=<recordingId>[&audio=pcm|wav]`)

The app first calls Convex `live.startRecording` (status `intro`), then opens this socket.

App → service
- Binary frames: 16 kHz mono s16le PCM from the phone by the stove, always streaming (silence too).
- `{ type: "start" }` when she starts cooking after the hello; `{ type: "done" }` on "I'm done";
  `{ type: "text", text }` (a typed answer, tests); `{ type: "not_now" }` (tap on the caption card).

Service → app
- `{ type: "ready", recording: { id, language, cookName, kidName?, dish? } }`, then
  `{ type: "phase", phase: "intro" | "recording" | "wrapping_up" | "ended" }` at each change.
- `{ type: "state", state: "listening" | "thinking" | "speaking" | "quiet" }` for the pot's steam.
- `{ type: "say", text, textEn, kind, ai: true, audio }`, the audio as binary frames, then
  `{ type: "say_end", interrupted }`. `text` is in her language, `textEn` the English; `kind` is a
  `homiePrompts.kind` (`intro`, `amount`, `cue`, `substitution`, `story`, `reaction`, `end`, `optin`, `closing`).
  When she taps start or done while homie's line is still playing, an extra `say_end` with `interrupted: true`
  says stop it.
- `{ type: "ask", promptId, text, textEn, kind }` (show the caption card), then `{ type: "drop", promptId }` (fade
  it: no answer within ~10 s of hearing it, "not now", or she said she's done) or `{ type: "answered", promptId }`.
- `{ type: "transcript", text, final }`, `{ type: "error", message }`. Close 4401 signed out, 4404 no such recording
  (or it already ended), 4409 a newer socket for the same recording took over (don't reconnect this one).

What happens
1. Hello (phase `intro`): Claude writes it from fixed rules (her name the family's way, "Rajani Aaji"; the kid and
   the dish; being filmed feels strange; fine to ignore homie; phone near the stove), cached per recording. If it
   takes over 7 s or fails, a hand-written one is said instead (`lines.ts`, Marathi or English).
2. `start`: Convex sets `startedAt` once; every line's `atS` counts from it (the hello's is negative).
3. While she cooks, every 2 s the code checks the pacing (`pacing.ts`): normal = first question no earlier than
   4 min, 4.5 min gaps, doubled after an ignored one, at most 6 live; `HOMIE_DEMO=1` = 40 s, 90 s, at most 2. Never
   while she talks (speech in the last 3 s). When a question is allowed, or she said something long that may be a
   story, Claude sees the transcript (and the newest glasses frame) and returns ask, react or stay quiet. Priority:
   vague amounts, then "how do you know it's ready", then substitutions for a college kitchen, then stories during
   waits. It never corrects or grades. A story in progress keeps it quiet; after a story, one short reaction
   ("Oh, I love that"), not counted as a question.
4. Her next turn after a question is the answer (`/live/prompt-update`, with English when she spoke Marathi).
   "Not now", "later", "आत्ता नाही", "नंतर" in a short turn drops it.
5. `done`: homie stops talking and drops an open question, then up to 2 end questions ("Before you go, two quick
   ones…"), then "Can Shreya hear your stories too?" (yes/no → `/live/optin`), then the closing, then phase `ended`.

Reconnects: what homie knows about a recording (the pacing counters, the questions it asked, what she said, the
hello) is kept per recording on the instance (Cloud Run's session affinity sends her back to it) until it ends,
or for 3 h. A socket back in `recording` listens 15 s before deciding anything and keeps the gaps and the limit. A
socket that closes during the wrap-up stops without writing anything more and leaves Convex at `wrapping_up`; the
next one asks only what's left (no second opt-in once she answered) and says goodbye. Text messages sent before
the recording has loaded are handled once it has. While the socket is open, the service touches the recording
every 10 minutes (`/live/status` `{ touch: true }`), so a long cook isn't abandoned as idle after 2 h.

Ended underneath: when the app can't reach this service, its stop button calls Convex `live.endRecording`, so the
glasses VM still finalizes the video. A socket still open for that recording (the app's side dropped, ours didn't
notice yet) finds out at its next Convex write: the heartbeat, a status, or homie's next line, which Convex refuses
(`400 recording already ended`; only the goodbye may land after the end). It then stops at once and quietly: no
line is said or saved, no warning is logged, the phone gets `phase: ended`, and the socket closes with 4404. A new
socket that finds the recording ended also closes an older one that's still open.

Half duplex: incoming audio is dropped while homie speaks and 300 ms after the phone should have finished playing.

Speech to text: Ink 2 for en/fr/hi/ja/es (it detects which). Anything else (Marathi) goes to Gemini Live,
`gemini-3.5-transcribe-live` with `inputAudioTranscription.languageCodes: ["mr-IN"]`. A Live session lasts about
10 minutes, so a new one opens at 9 minutes (and on GoAway or a drop) with session resumption and sliding-window
compression on, and audio queues while it connects. A turn ends when the transcript has been still for 1.5 s.

Measured on the stub (Oct 24, laptop, `HOMIE_DEMO=1`, Sonic-made test lines): Marathi speech end → final transcript
2.6–2.8 s (Gemini's final ~1.2 s + the 1.5 s pause); English (Ink) 0.02–0.55 s; Claude's decision 1.8–3.7 s;
Sonic first audio 130–255 ms; the hello 4.8 s from connect (Claude writing it; cached on reconnect); `/speak` with
translation ~3.1 s. Both runs asked about the vague amount first ("अंदाजाने मीठ म्हणजे साधारण किती?", "how much
turmeric is a little?").

## POST /speak

`{ sessionToken, text, lang?, translate?: boolean }` → `audio/wav` (24 kHz) in homie's voice, in `lang` or the
person's own language (`/live/person`). `translate: true` first turns English `text` into that language (Claude,
translate only). The header `x-spoken-text` (URI-encoded) is what was said. 400 bad body, 401 signed out.

## Deploy (Cloud Run, us-west1)

```bash
voice/deploy.sh
```
It turns on Secret Manager, copies the keys from the root `.env` into secrets (never printed), and deploys
`homecookd-voice` from source with min instances 1, a 60-minute request timeout (a cooking session is one
long WebSocket), session affinity and `CLAUDE_FAST=1`. `GEMINI_API_KEY` and `GLASSES_SECRET` become secrets too,
and `HOMIE_VOICE`, `GLASSES_URL`, `HOMIE_DEMO` env vars, when they're in `.env`. It prints the `/cook`, `/record`
and `/speak` URLs for the app.

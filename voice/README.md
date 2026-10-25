# voice/: the live voice service (Tracks B and E)

Two live loops from `docs/build/STACK.md`, plus one HTTP route:
- `/cook`: the kid's phone streams the mic over a WebSocket. Cartesia Ink 2 turns it into text, and Claude picks
  one tool per turn: move a step, play the cook's clip (found by Moss), or send the question to the cook. Sonic
  speaks the short reply. Nothing is ever presented as the cook's words unless it is her clip.
- `/record`: homie while a cook records. The phone by the stove streams the mic; homie hears her in her language
  (Gemini Live for Marathi), says hello, asks a few short questions at the right moments, then the last
  questions, the stories opt-in and goodbye. Everything it says goes to Convex (`/live/*`).
- `POST /speak`: a line in homie's voice, for the walkie-talkie and the pot's tap hints.
- `POST /homie/line`: homie's words, written by Claude, for one thing that's new for the person tapping homie.

```
src/server.ts   HTTP /health + POST /speak + POST /homie/line + WebSockets /cook and /record
src/safety.ts   the process's safety net: one session's error is logged with its id and never ends the others'
src/cook.ts     one cooking session: wires Ink → (fast path | Claude) → actions → Sonic
src/stepLine.ts what homie says on a step change: "Step 3. <the step, cut to ~20 words>" (plain rules, no Claude)
src/lineCache.ts  the step lines' Sonic audio, made when the recipe opens and kept for every session (LRU); failures
                remembered a minute; at most 2 made ahead at once per process
src/yesNo.ts    the kid's spoken yes or no, to homie's story nudge and the app's moments (follows the app's yesNo)
src/agent.ts    Claude turn agent: tools, system prompt, the one-tool-per-turn loop
src/translate.ts  the cook's words from a played clip → short English, spoken after the clip
src/record.ts   one recording with homie: phases, listening, when to ask, the end flow, Convex logging
src/homie.ts    Claude for homie: the hello, ask-or-stay-quiet, end questions, strict translation
src/pacing.ts   when homie may ask (plain code: first question, gaps, limits)
src/lines.ts    homie's fixed lines in English and hand-written Marathi
src/stt.ts      picks live speech-to-text by language: Ink 2 (en/fr/hi/ja/es) or Gemini Live
src/geminiLive.ts  Gemini Live transcription (gemini-3.5-transcribe-live) with session rotation
src/ink.ts      Cartesia Ink 2 streaming STT (/stt/turns/websocket, built-in turn detection)
src/sonic.ts    Cartesia Sonic TTS (/tts/bytes, streamed): homie's voice, locale, speed and mood per line
src/geminiTts.ts  Gemini TTS, the backup voice when Sonic fails before a line starts
src/moss.ts     Moss search over family-<familyId> (@moss-js/moss, in-memory queries)
src/convex.ts   Convex HTTP actions (/voice/*, /live/*) + the local stub
fixtures/       stub session (Grandma's red-braised pork) and stub recordings (Rajani Aaji, mr and en)
scripts/        test clients (/cook and /record), test-audio maker
test/           unit tests (node:test) with a fake socket, Claude, voice and Convex: pacing, /record's phases
                (and a recording ended underneath it), /cook's step lines (made ahead, said on every flip,
                the cache), the story nudge and the app's moments, and
                homie's voice (tts.test.ts: the exact Sonic requests, the moods, the Gemini fallback; fallback.test.ts: a stalled
                Gemini still ends the line, /speak's 502; fetch stubbed)
```

## Run it locally

Keys come from the repo's root `.env` (found by walking up, so a worktree works too) or the process env:
`CARTESIA_API_KEY`, `ANTHROPIC_API_KEY`, `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, `CONVEX_SITE_URL`
(https://grand-dragon-649.convex.site) and `VOICE_SECRET`. Optional: `VOICE_STUB=1` (serve the stub recipe and
accept any session token, for tests without a real sign-in), `CLAUDE_FAST=1` (Opus fast mode), `CLAUDE_MODEL`.
For homie: `GEMINI_API_KEY` (hears Marathi, and is the backup voice; without it a Marathi recording gets no
transcript and a failed Sonic line stays silent), `HOMIE_VOICE` (default "Riya bilingual",
`930eda72-c1af-4637-8d07-87d881d615fe`, Caleb's pick: native Marathi and Indian English), `HOMIE_SPEED` (default
0.85), `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-tts`), `GEMINI_TTS_VOICE` (default `en-in-assistant-3`),
`TTS_LOG=1` (log each Sonic request's voice, locale, speed and mood), `HOMIE_DEMO=1` (first question at ~40 s),
`GLASSES_URL` + `GLASSES_SECRET` (frames from the glasses VM), `GEMINI_LIVE_MODEL`.

```bash
cd voice && npm ci
npm run dev                                   # ws://localhost:8080/cook, live Convex
VOICE_STUB=1 npm run dev                      # the stub recipe instead
VOICE_STUB=1 npm run dev:fake                 # fake speech, no Cartesia or Gemini Live: for FAKE=1 offline checks
npm run make-audio                            # test-audio/*.wav, 16 kHz mono, spoken by Sonic (~590 credits for all 23)
npm run make-audio -- no                      # only the lines named (here test-audio/no.wav)
npm run test-client -- test-audio/next-step.wav test-audio/question.wav test-audio/unknown-question.wav
npm run test-client -- step:2 step:3 test-audio/go-back.wav   # taps on the screen, then a spoken "go back"
npm run test-client -- moment:answer test-audio/yes.wav moment:off text:no   # an app moment, then the app's no
SESSION=<kid's Convex sessionToken> RECIPE=<recipes _id> npm run test-client -- test-audio/next-step.wav  # live Convex
URL=wss://<cloud run host> npm run test-client -- test-audio/next-step.wav   # against the deployed one
FAKE=1 npm run test-client -- test-audio/next-step.wav       # offline, against dev:fake
VOICE_STUB=1 HOMIE_DEMO=1 npm run dev         # then, in another terminal:
npm run test-record                           # a whole recording with homie, in Marathi (stub "stub-mr")
COOK_LANG=en npm run test-record              # the same in English ("stub-en")
SESSION=<cook's sessionToken> RECORDING=<recordings _id> npm run test-record   # live Convex
npm run typecheck                             # src/ and test/
npm test                                      # unit tests on a fake clock; no keys or network needed
```

The test clients use real Ink 2 and Sonic, and live tests are encouraged (AGENTS.md). `FAKE=1` is an offline
check: it needs `npm run dev:fake` (checked on `/health`, `x-fake-speech: 1`) and sends each recorded line's words
as text (`scripts/testLines.ts`). Every run stops at `MAX_S` (default 15 min) so a stuck one can't stream for hours.

The stub has no Moss index (its `mossIndex` is empty, so the service never calls Moss; the Moss plan allows 3
indexes, so don't make test ones): with `VOICE_STUB=1`, a question gets a labelled hint plus the question to the
cook, or goes to the cook. To test search, use a real family's index, which Convex creates after a pipeline run.
A family index Moss says doesn't exist isn't asked for again for a minute, and a search never holds a turn longer
than its wait (2 s before Claude's first call).

The process stays up whatever one socket does: a bad frame, `"null"`, a `/speak` caller that hangs up mid-body, or
a failed write while homie talks. `src/safety.ts` logs an unhandled rejection with its session id (`cook-3`,
`record-4`) and keeps serving; an uncaught exception is logged with its id and the process exits, so Cloud Run starts
a clean one. `test/server.test.ts` sends each of those to a real service in a child process.

The test client streams each WAV in 100 ms chunks at real-time speed, keeps sending silence like an open mic,
prints every event with timings, and saves what the service says to `test-audio/out/`. `text:<words>` sends a
`{ type: "text" }` message instead, and `moment:<kind>` / `moment:off` opens or closes one of the app's moments.
`step:<n>` sends `{ type: "step", stepOrder: n }`, a tap; every line's first audio is printed with its delay after
the transcript or the step. homie greets a kid once per recipe for 3 hours (per instance): restart the service to
hear the hello again. A restart also empties the step-line cache.

## The WebSocket (`/cook?session=<sessionToken>&recipe=<recipeId>[&audio=pcm|wav]`)

App → service
- Binary frames: 16 kHz mono 16-bit little-endian PCM. ~100 ms per frame (3200 bytes). The app streams only while
  homie is on (a tap, or the 8 s after a step line or a nudge) and the phone isn't making sound; frames may stop
  and start again (Ink closes after 2 min without audio and reopens with the next frame). Keep streaming until a
  sentence is over, silence included: Ink waits for audio to end a turn, it doesn't assume silence.
- `{ "type": "step", "stepOrder": 3 }` when the kid taps Next, Back or a step. homie says that step's line at once
  (below). The first one on a socket, sent as it opens, restores the step on the screen: it isn't read (when it
  comes before `ready` or within 3 s of it), and the session starts there. A later one before `ready` is a tap
  while the recipe loads: it's read once ready. A tap on the step it's on says nothing.
  `"read": false` marks a step the cook's clip moved the screen to while it plays: the step only moves (no line
  over her clip, and her translation still comes after it).
- `{ "type": "text", "text": "how much soy sauce?" }`: typed or push-to-talk input, handled like speech. The app
  can answer the story nudge with `{ "type": "text", "text": "yes" }` or `"no"`. It's the app's own answer, so it
  counts even while one of its moments is up.
- `{ "type": "moment", "open": true, "kind": "answer" | "story" | "ask" | "help" }` when one of the app's own homie
  moments opens on the phone (not our story nudge), and `{ "type": "moment", "open": false }` when it
  closes. While it's up, transcripts still come, but a spoken yes or no ("yes", "sure", "no thanks", "not now")
  is the moment's answer: it never answers our nudge and never reaches Claude. Anything else (a question for the
  "ask" moment, "next") goes the usual way, and still isn't taken as a yes to our nudge. homie says no nudge while
  a moment is up; it waits for it to close. After a reconnect, send it again if one is up.
  What the kid says while the `ask` moment is up ("Ask Grandma anything", a long press on homie) follows
  `askWords` in `src/cook.ts`, never the yes-or-no rules. A plain command still runs, after any lead word too
  ("Yeah, next step"). A cancel word ("never mind", "no", "stop") gets "Okay." A sound, a bare yes, "wait" or
  fewer than three real words gets no transcript, so the moment stays up for the question. Anything else, a
  yes word and all ("Yeah, how long do I fry the onions?"), and the family's own language as it is, goes straight
  to `askCook` (`asked_cook`, then "Good question. I'll ask Grandma."), with no Claude call and no clip search.
  The moment then counts as closed, so a second sentence goes the usual way. Opening it drops her clip's hold:
  the phone paused the clip.
- `{ "type": "video", "playing": true | false }` when any video (or the cook's voice note) starts or stops on the
  phone. While one plays, homie says nothing on its own (Caleb, Oct 24): a `greeting`, `nudge` or `timer` line waits
  for the next pause, one after another (`timer_done` still comes at once). An answer to what the kid just did or
  said is spoken meanwhile, and a step's line is one: it answers the flip, video or not. A clip homie asked for
  counts as a video too. After a reconnect, send it again if one plays.
- Silence while a `say` or a clip plays (half duplex).

Service → app
- `{ type: "ready", recipe: { id, title, steps } }`, then `{ type: "go_to_step", stepOrder }` for where to start.
- Then homie's hello, a `say` of kind `greeting` in the cook's language (`"चला, स्वयंपाक करूया!"`, `textEn: "Let's
  cook!"`). A kid whose hello started playing on this recipe in the last 3 hours (same instance) gets no second
  hello after a dropped socket; a hello cut off before any of it played doesn't count.
- Step lines (Caleb, Oct 24: "right when I flip to the next step, I need homie to … start talking"). On every step
  change homie says the step's short line at once, a `say` of kind `step`: "Step 2. Melt the sugar to amber." The
  line is the step's text cut to about 20 words by plain rules, no Claude (`stepLine.ts`: whole sentences that fit,
  else the first sentence up to a "; " or ", then ", else the step's title). A step change is a tap (`step`), a
  plain command ("next", "go back"), or Claude's `next_step` / `previous_step` / `go_to_step`. Not for the
  restore, and not when the step didn't change. "Repeat" ("say that again", Claude's `repeat_step`) says the whole
  step, `Step 3. <all of its text>`, live (it's rare, so it isn't kept); the next flip says the short line again.
  - Made ahead: once the hello's first audio is out (so Sonic says the hello first), or at once when there's no
    hello or it waits for a video, Sonic makes every step's line, from the step they're on onwards, then the
    earlier ones, 2 at a time across the whole process, in homie's voice exactly as a step said live (voice,
    locale, speed, `calm` mood, the session's format). The audio is kept per process (`lineCache.ts`, by voice,
    language, kind, format and text; least recently used out past 300 lines or 64 MB), so a second kid on the same
    recipe or a reconnect costs nothing. A kept line goes out all at once: `say`, every frame, `say_end`, with the
    same half duplex and echo timing as a streamed line. A line still being made sends what's there, then the rest
    as Sonic makes it; one not started yet is made at once and streamed (and kept). A line still unfinished after
    20 s fails.
  - When Sonic can't: ahead of time it's Sonic alone, so the backup voice is never kept. A line that failed isn't
    kept, and for a minute it isn't asked of Sonic again: the flip goes straight to Gemini, so a flip waits for at
    most one Sonic failure. A 402 or 429 (out of credits, rate-limited) stops making lines ahead and sends every
    step line straight to Gemini for that minute, across sessions.
  - A flip cuts off the line playing (a new `say` always does), so rapid flips play only the latest step's line.
    A step line answers the kid's flip: it's spoken over a video too.
  - What it costs: about 1 Sonic credit a character, once per recipe per instance (Grandma's red-braised pork: 6
    lines, 376 characters; the synthetic recipes 300–480).
- `{ type: "transcript", text, final }`: `final: false` while the kid talks, `true` once the turn ends.
- `{ type: "go_to_step", stepOrder }`: show that step (a move by voice or Claude). Its line is said right after.
- `{ type: "play_clip", startS, endS, quote?, quoteEn? }`: play that span of the cook's video. Nothing is spoken
  over it. `quote` is her words for the caption (the Devanagari `quoteOriginal` when the clip is a step's own
  moment), `quoteEn` the English when they differ. When the clip answers a question, half a second after it ends
  comes `{ type: "say", kind: "translation", text: "Grandma says: …", translation: true }`: her words in short
  English. Show it labeled as a translation. It's skipped only when Convex says the cook speaks English (an unset
  language still gets it). A step change or a new turn before then drops it.
- `{ type: "asked_cook", questionId, text }`: the question went to the cook. "I'll ask Grandma" follows.
- `{ type: "say", text, kind, textEn?, ai: true, audio: { format, encoding: "pcm_s16le", sampleRate: 24000 } }`,
  then the audio as binary frames, then `{ type: "say_end", interrupted }`. `kind` is one of `step`, `reply`,
  `hint`, `translation`, `nudge`, `greeting`, `timer`; `textEn` comes when the line isn't English.
  `audio=pcm` (default) streams raw PCM to play as it arrives. With `audio=wav`, the frames joined together are
  one WAV file. A new `say` cuts off the one before it. Every line is homie's one voice (Riya bilingual, 0.85 speed);
  an English line's `kind` sets its mood (step and hint `calm`, translation `affectionate`, the rest
  `content`). If Sonic fails before any audio, Gemini says the line in the same format (24 kHz s16le). If Gemini
  fails too (an error, no audio at all, nothing within 6 s, or the line not done within 10 s + 100 ms a character),
  the line ends with no voice and `say_end` still comes.
- A `hint` is general cooking knowledge, never the cook's: "Grandma didn't say. Usually just enough water to cover
  it." It comes only when no clip answers, and `asked_cook` plus "I'll ask Grandma too" always follow. Label it as
  AI.
- `{ type: "timer", id, seconds, label, endsAt }` when the kid asks for one; the app shows the countdown. At the
  end, `{ type: "timer_done", id, label }` and a `say` of kind `timer` ("Hey, the rice timer is done.").
- Nudges (kind `nudge`): after a step's line, for a step with one of the cook's stories, "Grandma has a story
  about this one. Want to hear it?" once per story ("yes" plays it; "no" or "not now" closes it quietly);
  and once per step after 6 quiet minutes, "Still on step 3?".
- `{ type: "quiet" }`: the kid's words reached Claude, and homie did and said nothing: they weren't meant for homie
  (Claude judges; "homie", however Ink spells it, is a strong yes; no wake word), or a no with nothing after it.
  The app stops showing homie thinking.
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
   to the story nudge, and "set a timer for 5 minutes" skip Claude.
3. Anything else: Moss searches the recipe's moments first (~10 ms, in memory), and Claude gets the words, the
   current step and those moments. It calls one tool: `next_step`, `previous_step`, `repeat_step`, `go_to_step`,
   `play_clip` (only times that came from Moss or a step), `give_hint` (labelled general knowledge, and the
   question still goes to the cook), `ask_cook`, `set_timer`, `say`, or `find_moment` (search again with other
   words, then one more pick). No tool means the speech wasn't for us, and we stay quiet.
4. Steps go to Convex `/voice/step`. Questions go to `/voice/question` as `found_in_video` (with the clip and the
   cook's words) or `asked_cook`.

Model: `claude-opus-5-5` at low effort, with server-side refusal fallbacks on. Measured locally (Oct 23):
plain commands ~0 ms after the transcript; a question 1.4–2.3 s standard, 1.1–1.6 s with `CLAUDE_FAST=1`.
Step lines, live on the stub (Oct 24, real Ink and Sonic): all 6 made ahead during the hello; a flip's first audio
0–4 ms after the transcript or the tap when made ahead, 172 ms when the tap came before its line was made (streamed
live from Sonic).

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
   4 min, 4.5 min gaps, doubled after an ignored one, at most 6 live; `HOMIE_DEMO=1` = 40 s, 90 s, at most 2; `HOMIE_SCRIPTED=1` (the filmed demo) = a fixed question from `lines.ts` every 5 min, in turn, with no backing off and no Claude deciding. Never
   while she talks (speech in the last 3 s). When a question is allowed, or she said something long that may be a
   story, Claude sees the transcript (and the newest glasses frame) and returns ask, react or stay quiet. Priority:
   vague amounts, then "how do you know it's ready", then substitutions for a college kitchen, then stories during
   waits. It never corrects or grades. A story in progress keeps it quiet; after a story, one short reaction
   ("Oh, I love that"), not counted as a question.
4. Her next turn after a question is the answer (`/live/prompt-update`, with English when she spoke Marathi).
   "Not now", "later", "आत्ता नाही", "नंतर" in a short turn drops it.
5. `done`: homie stops talking and drops an open question, then up to 2 end questions ("Before you go, two quick
   ones…"), then "Can Shreya hear your stories too?" (yes/no → `/live/optin`), then the closing, then phase `ended`.
   The wrap-up waits for her (`listen`): no line starts while she talks; an answer is every turn until no new words
   for 3.5 s (Ink 2, ink-whisper) or 4 s (Gemini Live), so a pause to think doesn't end it. "not now" (the card's
   tap or her first words) skips just that question at once. No word 5 s after a question played: "Still there,
   Rajani Aaji? Take your time. I'm listening."; 5 s more: the let-off ("That's okay… No need to answer today. All
   good, let's finish up."), and nothing more is asked (the plate photo still, then goodbye). With a speech-to-text
   that has shown nothing, a plain 15 s wait instead. Each wait logs the mic's loudest level (`wrap-up mic:`), for
   tuning `VOICE_RMS` on phones. Live run: `SCENARIO=long|silent|late npm run test-record`.

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

Half duplex: incoming audio is dropped while homie speaks and until the phone can first have finished playing
(`say_end` + the line's length; the phone sends silence while it plays, so a quick reply isn't cut). The phone plays
a line only once it has all of it (it starts ~250 ms after `say_end`), so that's where the wrap-up's waits and each
line's `said` span count from. A spoken turn ending under a wrap-up question is talk from before it: it answers
nothing.

Speech to text: Ink 2 for en/fr/hi/ja/es (it detects which). Anything else (Marathi) goes to Gemini Live,
`gemini-3.5-transcribe-live` with `inputAudioTranscription.languageCodes: ["mr-IN"]`. A Live session lasts about
10 minutes, so a new one opens at 9 minutes (and on GoAway or a drop) with session resumption and sliding-window
compression on, and audio queues while it connects. A turn ends when the transcript has been still for 1.5 s.

Measured on the stub (Oct 24, laptop, `HOMIE_DEMO=1`, Sonic-made test lines): Marathi speech end → final transcript
2.6–2.8 s (Gemini's final ~1.2 s + the 1.5 s pause); English (Ink) 0.02–0.55 s; Claude's decision 1.8–3.7 s;
Sonic first audio 130–255 ms; the hello 4.8 s from connect (Claude writing it; cached on reconnect); `/speak` with
translation ~3.1 s. Both runs asked about the vague amount first ("अंदाजाने मीठ म्हणजे साधारण किती?", "how much
turmeric is a little?").

homie's voice, measured live on the stub (Oct 24, Riya bilingual): Sonic first audio 117–1005 ms, 27 of 30
recording lines under 350 ms. With Sonic refused (an invalid key, so 401), Gemini said every line: `/speak` returned
a whole WAV in 1.6 s (Marathi) and 2.0 s (English), and `/cook` streamed the greeting, offer, steps and nudge.

## POST /speak

`{ sessionToken, text, lang?, translate?: boolean, kind?: string }` → `audio/wav` (24 kHz) in homie's voice, in `lang`
or the person's own language (`/live/person`). `translate: true` first turns English `text` into that language
(Claude, translate only). `kind` (a `say` kind like `step`, `hint`, `reply`) picks the mood of an English line;
without it, `content`. Gemini says it when Sonic can't. The header `x-spoken-text` (URI-encoded) is what was said. 400 bad body, 401 signed out,
502 when neither voice could say it (the app then uses the phone's own voice).

## POST /homie/line

`{ sessionToken, factId, tab? }` → `{ text, written }`. The service reads the person's news from Convex
(`POST /homie/news`: at most 3 facts, `convex/homie.ts`), finds `factId`, and Claude says it in one or two warm
sentences (at most 22 words, nothing added; `src/tapLine.ts`, cached per person and fact). English: the app then
says it with `/speak` and `translate: true`. Claude failing or saying too much gives the fact's own plain line,
`written: false`. 400 bad body, 401 signed out, 404 no such fact, 502 Convex unreachable. The stub (`VOICE_STUB=1`)
has one fact, `answer:stub`.

## Deploy (Cloud Run, us-west1)

```bash
voice/deploy.sh
```
It turns on Secret Manager, copies the keys from the root `.env` into secrets (never printed), and deploys
`homecookd-voice` from source with min instances 1, a 60-minute request timeout (a cooking session is one
long WebSocket), session affinity and `CLAUDE_FAST=1`. `GEMINI_API_KEY` and `GLASSES_SECRET` become secrets too,
and `HOMIE_VOICE`, `GLASSES_URL`, `HOMIE_DEMO` env vars, when they're in `.env`. It prints the `/cook`, `/record`
and `/speak` URLs for the app.

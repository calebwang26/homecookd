# voice/: the live voice service (Track B)

The real-time cooking loop from `docs/build/STACK.md`. The kid's phone streams the mic over a WebSocket.
Cartesia Ink 2 turns it into text, and Claude picks one tool per turn: move a step, play the cook's clip
(found by Moss), or send the question to the cook. Sonic speaks the short reply. The service never answers
from general knowledge: a question is answered by the cook's own clip, or it goes to the cook.

```
src/server.ts   HTTP /health + WebSocket /cook
src/cook.ts     one cooking session: wires Ink → (fast path | Claude) → actions → Sonic
src/agent.ts    Claude turn agent: tools, system prompt, the one-tool-per-turn loop
src/translate.ts  the cook's words from a played clip → short English, spoken after the clip
src/ink.ts      Cartesia Ink 2 streaming STT (/stt/turns/websocket, built-in turn detection)
src/sonic.ts    Cartesia Sonic TTS (/tts/bytes, streamed)
src/moss.ts     Moss search over family-<familyId> (@moss-js/moss, in-memory queries)
src/convex.ts   Convex HTTP actions (/voice/session, /voice/step, /voice/question) + the local stub
fixtures/       stub session: Grandma's red-braised pork (from data/synthetic)
scripts/        test client, test-audio maker
```

## Run it locally

Keys come from the repo's root `.env` (found by walking up, so a worktree works too) or the process env:
`CARTESIA_API_KEY`, `ANTHROPIC_API_KEY`, `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, `CONVEX_SITE_URL`
(https://grand-dragon-649.convex.site) and `VOICE_SECRET`. Optional: `VOICE_STUB=1` (serve the stub recipe and
accept any session token, for tests without a real sign-in), `CLAUDE_FAST=1` (Opus fast mode), `CLAUDE_MODEL`,
`CARTESIA_VOICE`.

```bash
cd voice && npm ci
npm run dev                                   # ws://localhost:8080/cook, live Convex
VOICE_STUB=1 npm run dev                      # the stub recipe instead
npm run make-audio                            # test-audio/*.wav, 16 kHz mono, spoken by Sonic
npm run test-client -- test-audio/next-step.wav test-audio/question.wav test-audio/unknown-question.wav
SESSION=<kid's Convex sessionToken> RECIPE=<recipes _id> npm run test-client -- test-audio/next-step.wav  # live
URL=wss://<cloud run host> npm run test-client -- test-audio/next-step.wav   # against the deployed one
npm run typecheck
```

The stub has no Moss index (the Moss plan allows 3 indexes, so don't make test ones): with `VOICE_STUB=1`,
questions go to the cook. To test search, use a real family's index, which Convex creates after a pipeline run.

The test client streams each WAV in 100 ms chunks at real-time speed, keeps sending silence like an open mic,
prints every event with timings, and saves what the service says to `test-audio/out/`.

## The WebSocket (`/cook?session=<sessionToken>&recipe=<recipeId>[&audio=pcm|wav]`)

App → service
- Binary frames: 16 kHz mono 16-bit little-endian PCM. ~100 ms per frame (3200 bytes). Keep streaming while the
  screen is up, silence included: Ink waits for audio, it doesn't assume silence.
- `{ "type": "step", "stepOrder": 3 }` when the kid taps a step (no speech).
- `{ "type": "text", "text": "how much soy sauce?" }`: typed or push-to-talk input, handled like speech.

Service → app
- `{ type: "ready", recipe: { id, title, steps } }`, then `{ type: "go_to_step", stepOrder }` for where to start.
- `{ type: "transcript", text, final }`: `final: false` while the kid talks, `true` once the turn ends.
- `{ type: "go_to_step", stepOrder }`: show that step. Its text is spoken right after.
- `{ type: "play_clip", startS, endS }`: play that span of the cook's video. Nothing is spoken over it. When the
  clip answers a question, half a second after it ends comes `{ type: "say", text: "Grandma says: …", ai: true,
  translation: true }`: her words from that moment, in short English (Claude sees only her words). Show it labeled
  as a translation. A step change or a new turn before then drops it.
- `{ type: "asked_cook", questionId, text }`: the question went to the cook. "I'll ask Grandma" follows.
- `{ type: "say", text, ai: true, audio: { format, encoding: "pcm_s16le", sampleRate: 24000 } }`, then the audio
  as binary frames, then `{ type: "say_end", interrupted }`. `audio=pcm` (default) streams raw PCM to play as it
  arrives. With `audio=wav`, the frames joined together are one WAV file. A new `say` cuts off the one before it.
- `{ type: "error", message }`. Close code 4401 means the session token was refused (sign in again); 4404 means
  the recipe isn't in this family or isn't ready.

The phone must play audio with echo cancellation on (iOS voice processing). Otherwise Ink hears Sonic and the
cook's clips. As a backstop, the service ignores:
- a turn that mostly repeats what it just said;
- a turn written mostly in a non-Latin script (Ink writes the cook's Marathi in Devanagari; the kid speaks English);
- anything but a plain command ("next", "go back") while a clip is playing.

## How a turn works

1. Ink's `turn.end` gives the kid's words (the turn ends ~2 s after they stop, or sooner when Ink is sure).
2. Plain commands ("next", "go back", "say that again", with "um, wait, okay, please" around them) skip Claude.
3. Anything else: Moss searches the recipe's moments first (~10 ms, in memory), and Claude gets the words, the
   current step and those moments. It calls one tool: `next_step`, `previous_step`, `repeat_step`, `go_to_step`,
   `play_clip` (only times that came from Moss or a step), `ask_cook`, `say`, or `find_moment` (search again
   with other words, then one more pick). No tool means the speech wasn't for us, and we stay quiet.
4. Steps go to Convex `/voice/step`. Questions go to `/voice/question` as `found_in_video` (with the clip and the
   cook's words) or `asked_cook`.

Model: `claude-opus-5-5` at low effort, with server-side refusal fallbacks on. Measured locally (Oct 23):
plain commands ~0 ms after the transcript; a question 1.4–2.3 s standard, 1.1–1.6 s with `CLAUDE_FAST=1`.

## Deploy (Cloud Run, us-west1)

```bash
voice/deploy.sh
```
It turns on Secret Manager, copies the keys from the root `.env` into secrets (never printed), and deploys
`homecookd-voice` from source with min instances 1, a 60-minute request timeout (a cooking session is one
long WebSocket), session affinity and `CLAUDE_FAST=1`. It prints the `wss://…/cook` URL for the app.

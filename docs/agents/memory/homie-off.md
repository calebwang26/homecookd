---
name: homie-off
description: "Oct 29: homie's voice is switched off for launch (app/src/lib/homie/switch.ts HOMIE_ON=false); no code deleted; turning it back on is one line and Caleb's call"
metadata:
  type: project
---

On 2026-10-29 Caleb said: "I want to remove the voice agent. Don't delete any code. Essentially, just disable that
feature for now. It's adding too much friction, and there are just a lot of bugs. That includes the voice agent
that's present on every screen and also the voice agent that guides through the parent while they're cooking on
the recording screen." And: "make sure there's no bugs that are left over from the cleanup."

**What's off** (`app/src/lib/homie/switch.ts`, `HOMIE_ON = false`):
- The pot on every screen (`app/_layout` doesn't mount `HomieOverlay`; Home's profile pill, kid Community's header
  and cook mode's bottom bar no longer keep room for it).
- homie while a cook films: `app/recording` uses `lib/live/quietRecording` (no /record socket, no mic stream);
  filming starts and ends through Convex (`live.startFilming`, `live.endRecording`) and the video still sends.
- Kid cook mode's voice (/cook socket, the AI ask for it, the phone reading steps, "Grandma answered" offers):
  Back and Next by touch.
- `speak()` says nothing; Parent Home's question rows answer by typing (`components/parent/TypeAnswer`) or the
  Hold-to-talk voice note, never the walkie-talkie screen.
- The voice service stays deployed on Cloud Run; with the app opening no socket, it burns no Cartesia credits.

**Why:** friction and bugs before launch; the App Store version under review (Oct 29) still has the voice agent.

**How to apply:**
- Don't build new homie voice features while it's off. Keep new code working with `HOMIE_ON` either way.
- Legal and App Store text (consent sheet, /privacy, FAQ, reviewer notes, handoff doc) still describes voice:
  Caleb, Oct 29: "Don't touch any of the privacy policy stuff right now. We'll change it later."
- Turning homie back on is the one line in `switch.ts`, Caleb's call; then check the App Store text matches.

Related: [[homie-voice]], [[app-review-guard]], [[section-chats]]

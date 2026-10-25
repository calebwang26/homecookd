---
name: homie-step-lines
description: "Oct 24: on every step change homie says the step's short line at once, from Sonic audio made ahead when the recipe opens; replaces 'read steps aloud off by default'; no read-aloud offer"
metadata:
  type: project
---

On 2026-10-24 Caleb said: "right when I flip to the next step, I need homie to like activate and actually start
talking. Otherwise I'm just gonna ignore it … homie has already generated like what it's gonna say for every
single page … It should be pre-generated, so there's no lag."

**What shipped (voice service):**
- When a cooking session starts, every step's short line ("Step 2. Melt the sugar to amber.", at most about 20 words,
  `voice/src/stepLine.ts`, no Claude) goes to Sonic, 2 at a time, in homie's voice with kind `step`.
- The audio is kept in a process-wide cache (`voice/src/lineCache.ts`, 300 lines / 64 MB), so a second kid on the
  same recipe, or a reconnect, costs nothing.
- Every step change reads its line at once: a tap on Next or Back, a step picked from the list, "next" or
  "back" said out loud, or Claude moving the step. A made-ahead line starts in 0–4 ms; one not made yet streams
  live (about 170 ms).
- Not read: the app's restore step right after `ready`, or a step that didn't change. "Repeat" says it again.

**This replaces two earlier defaults:**
- "Read steps aloud off by default" ([[homie-silent-during-video]]) is gone: there's no read-aloud offer, and no
  `VOICE_READ_OFFER`.
- "Silent while a video plays" still holds for everything homie says on its own. A step line is an answer to
  the kid's flip, so it plays on the flip. The step video doesn't autoplay.
- After a step line, the mic listens for 8 s ([[homie-mic-on-demand]]).

**Why:** a helper that lags behind the kid's thumb gets ignored. Made ahead, homie is ready the moment the step is.

**How to apply:** anything homie says on a step change comes from the cache. Don't add a Claude call or a live
TTS call to the flip path. A new recipe field that changes a step's text changes its cache key, so it's made again.

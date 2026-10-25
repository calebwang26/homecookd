---
name: homie-silent-during-video
description: "Oct 24: while any video plays, homie says nothing on its own; it saves the line for the next pause. Only an answer to the kid speaks. Reading steps aloud is off by default"
metadata:
  type: project
---

On 2026-10-24 Caleb reviewed kid cook mode and approved: **while any video plays, homie stays silent.** It saves
what it wanted to say and says it at the next pause. The only exception is an answer to something the kid just
said or tapped. He also turned **reading the steps aloud off by default**.

**Why:** the cook's own voice in her video is the heart of homecookd. homie talking over her (a story offer, "your
timer is done", "Step 3…") or pausing her video to say something nobody asked for breaks the moment.

**How to apply:**
- Voice service (`voice/src/cook.ts`): `UNPROMPTED` kinds (`greeting`, `offer`, `nudge`, `timer`) wait while the
  app says a video plays (`{ type: "video", playing }`) or a clip homie asked for plays; they go one after another
  at the pause. `timer_done` (the buzz) is never held. Answers (`reply`, `hint`, `step` the kid asked for,
  `translation`) speak at once.
- App: `VoiceHold` sends the video state (any video, or her voice note) and holds a line already on its way
  (`voiceLogic` `waitsForVideo`, the same split, checked by `test-voice-ui.mjs`). `lib/live/speak` waits for
  `videoStopped()` unless `answer: true` (a tap on homie or on Ask), and the phone's own voice stops when a video
  starts. "Grandma answered your question" waits for the video too.
- Reading aloud: replaced later the same day by [[homie-step-lines]]. Every step change says the step's short
  line at once (made ahead); there's no offer and no `VOICE_READ_OFFER`. A step line answers the kid's flip, so it
  plays even if a video is playing. Everything homie says on its own still waits.
- Any new line homie says on its own must go through these holds, never straight to the player.
- Related: [[homie-tap-always-answers]], [[homie-talks-no-bubble]], [[homie-voice]].

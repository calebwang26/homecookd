---
name: homie-tap-hold-and-audio-handoff
description: "Oct 25: in cook mode a tap turns homie on (it talks, then listens), a hold opens 'Ask <cook> anything' (the question goes straight to the cook); whatever was tapped last (homie or the video) has the sound, with a short fade"
metadata:
  type: project
---

On 2026-10-25 Caleb said:
- "clicking homie activates it (you can ask it anything/talk to it), holding homie down opens center expanded view
  into that 'ask salik anything' mode."
- "if a user clicks homie while the video is playing, the video should pause, and audio should switch to homie and
  homie should start talking as usual. then if the user clicks BACK to the video, homie falls silent and the video
  has audio. essentially anything that's clicked (between video & homie) should be the one with audio. this
  transition should be smooth."

**What shipped (cook mode):**
- **Tap:** homie turns on. Any video fades out (about 150 ms) and pauses. The app sends `{type:"tap"}`, and the voice
  service says the current step's short line at once from its cache. Then homie listens. A tap while it's on
  turns it off.
- **Hold (about 400 ms):** the centred moment "Ask <cook> anything", with the cook's real name. The mic is held on
  while it's up (`MicHold` 'ask'). The kid's next words go straight to the cook (`askCook`, no Claude); a plain
  command still works. Without a voice line it opens the chat with the cook.
- **Play a video while homie talks or listens:** homie's voice fades out (about 150 ms), homie turns off (`hush`), the
  recorder stops and iOS goes back to playback ([[homie-mic-on-demand]], #85), and the video has full sound.
  Her clip from the service never turns homie off.
- Lines homie says on its own (greeting, nudge, timer) still wait while a video plays ([[homie-silent-during-video]]).

**Why:** one thing at a time has the sound, and it's always the thing the kid just touched. homie talking over the
video, or a muted video after homie, felt broken.

**How to apply:**
- A new gesture or sound on the cook screen picks a side through `voice.toggle` / `hush` and the `lib/media` fades.
  Never start audio without taking it from the other.
- The tap and the hold never trigger each other (React Native's Pressable).
- Related: [[homie-siri-states]], [[homie-docked-cook-bar]].

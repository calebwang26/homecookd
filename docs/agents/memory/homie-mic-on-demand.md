---
name: homie-mic-on-demand
description: "Oct 24: cook mode's mic is on only while homie is activated (a tap) or for an 8 s window after a step line or a nudge; never always-listening; the cost numbers"
metadata:
  type: project
---

On 2026-10-24 Caleb asked: "if it's gonna be listening the entire time for its name, isn't that gonna cost a
lot? … if you click homie, it activates. and if you don't click it, it deactivates … Besides like it turning on
automatically when you go to the next step."

**The model:**
- In cook mode the line to the voice service opens by itself, but the mic starts off.
- A tap on homie turns the mic on (`listening`), and the next tap turns it off.
- When homie's automatic step line or a nudge ends, the mic listens for an 8 s window. If the kid speaks, it stays
  on until the answer is over.
- Off means the recorder is stopped: no frames, and no Ink credits.
- The socket stays open, so step lines still arrive.
- Code: `voiceLogic` `micAfter` / `micTimer` / `micWanted` / `opensWindow`, and `voice.ts`.

**Why (the numbers, Oct 24; Ink about 3 credits a second of audio, Sonic about 1 per character):**
- A 30-minute cook with the mic always on was about 4,530 Ink credits plus about 750 Sonic, so about 190 cooks
  per 1M credits.
- Tap to activate is at most about 650 Ink credits (2 min on plus twelve 8 s windows). Add about 750 Sonic and
  about 300–480 for the step lines, which are made once per recipe and cached for every kid.
  That's about 475 cooks per 1M, or more once the cache is warm.
- Listening for "homie" through Ink all the time would cost about 10,800 credits an hour. It would need
  on-device wake-word detection to be cheap.

**How to apply:**
- Never start the recorder outside these holds.
- The pot's state must show it: the mic streams only while it shows `listening` or `thinking`
  ([[homie-siri-states]]).
- After a long time off, Ink's stream reopens on the next frame (`voice/src/ink.ts`), with no first words lost.
- Related: [[cartesia-credits-for-tests]], [[homie-step-lines]], [[homie-judges-who-was-talking]].

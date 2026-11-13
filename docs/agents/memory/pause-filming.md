# Pause while filming in the app (Caleb, Nov 12, 2026)

**The decision.** The problem in Caleb's words: "the parent sets up the camera to cook, then moves to do a different
section of the cooking (like cutting up the vegetables) and cuts out of frame, so they move the camera." He wants her able
to pause, move the phone and keep filming, with "multiple segments of the video and then stitch it all together".
His flow: "the only button is pause, and after they pause, they can click 'im done'". He approved the three mocked
screens (filming, paused, the camera stopped) with the suggested words: "great, sounds good, make the changes".

**The wording rule.** While filming, every word must read as "you are recording now", never as a state: a bare "Pause"
under the button is "super confusing because ppl may think its paused". So the line says what a tap does ("Tap to
pause") and the pill says "Recording · 4:07".

**What it is** (`app/src/components/record/pauseFlow.ts`, test `app/scripts/test-pause-flow.mjs`):
- Filming: the one big button is Pause (two bars), "Tap to pause" / "Then you can move the camera". No "I'm done".
- Paused: the camera picture stays live, the pill says "Paused · 4:07", the big button is Keep filming (a new file),
  and "I'm done" shows. "I'm done" sends every part, in order, as one recording.
- Leaving the app and a camera that stopped by itself use the same paused screen with their own small line. Only a
  short trip away from filming films again by itself; her own Pause never does.

**Why:** a cook in her 50s–60s has to see in about 3 seconds what the one button does, and must never think she is
paused while she is recording.

**How to apply:** keep "I'm done" off the filming screen and the filming words as actions, never states. Change the
words or the flow only with Caleb's word. A recording filmed in the app has its parts in a known order: the pipeline
must keep it (Pipeline & recipes checked `order_sessions`, Nov 12).

# homie: talking has no bubble, asking has no buttons (Oct 24, 2026)

Caleb, on the homie canvas (now final: "don't change the design, just start building"): when homie only talks,
there is no text on screen. The pot lights up a beat before it speaks, its lid lifts while it speaks, and a small
"AI voice" label sits under it. homie leaves its corner for the blurred centre only when it needs an answer, and
then there are no buttons: you answer out loud.

**Why:** the people using it are a grandmother at the stove and a kid with messy hands. Words on screen and buttons
compete with the cooking; voice is the point. The label keeps it honest: the AI's voice is never taken for the cook's.

**How to apply:**
- A help line or any other spoken line: `speak()` only (lib/live/speak), never a moment.
- A yes-or-no question: the centred moment with the listening bars and "Say “yes” or “no”" (lib/live/voiceLogic
  `yesNoMoment`). A tap anywhere closes it as "not now" for that visit only; a spoken answer is kept.
- One button only on a phone that can't hear the answer (Expo Go, web, the mic off): "Read it to me".
- Motion follows the canvas: lit before speaking, the lid lifts while speaking, Reduce Motion fades only.
- Mockups: the homie canvas (`Cook`, `CookAsk`, `Moment`, `Main` frames). Related: [[declutter-first]],
  [[demo-family-shreya]].

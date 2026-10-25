---
name: homie-siri-states
description: "Oct 24: homie's states copy Siri (off = plain white circle; lit halo; listening = yellow ring orbiting the edge; thinking = faster ring; speaking), truthful to the mic; one tap toggles it on/off; never navigates"
metadata:
  type: project
---

On 2026-10-24 Caleb asked for homie to show its state the way Siri does: "when Homie is deactivated, it should
just be the plain white circle. When it activates, just like Siri, it lights up. And then when it's like
thinking or processing or listening, it's like a pulsating circle around it, yellow circle around it, that's
going in a circle … copy siri's states." He also said a tap must never go to Messages: "if I click it, it
activates it. Or if I click it again and it's already activated, it deactivates."

**The states (`components/homie/HomiePot`, the same on every screen):**
- `off`: a plain white circle.
- `lit`: a warm yellow halo, the beat before speaking.
- `listening`: the halo, plus a yellow ring around the edge that orbits and pulses with the mic level.
- `thinking`: the same ring with a faster, segmented rhythm.
- `speaking`: the halo pulsing and the lid lifting.
- `timer`: the clock ring, alongside any of the above.

**The rule that makes them truthful:** the mic streams only while the pot shows `listening` or `thinking`
(`voiceLogic` `cookPotState`). homie is never listening without the ring.

**Why:** a kid should always know when homie hears them. A white circle means it can't hear you, the ring means
it can, and a tap is the switch.

**How to apply:**
- A tap on homie is on/off, everywhere.
  - In cook mode it turns the mic on (`listening`) or off (`off`).
  - Without a voice line, it reads the step, and a tap while homie speaks stops it.
  - On the tabs, it says the screen's line, and a tap while homie speaks stops it.
  - It never opens a chat or another screen.
- A new feature that listens must drive these states, never its own indicator.
- Related: [[homie-docked-cook-bar]], [[homie-mic-on-demand]], [[homie-step-lines]], [[homie-tap-always-answers]].

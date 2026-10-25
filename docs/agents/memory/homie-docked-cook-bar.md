---
name: homie-docked-cook-bar
description: "Oct 24: in kid cook mode homie docks centred in the bottom bar like Siri (Back · homie · Next, even spacing); no chips; tap asks, long press mutes; the expand is one smooth move with light blur"
metadata:
  type: project
---

On 2026-10-24 Caleb picked option C for cook mode's controls, with his changes: "make homie CENTER ALIGNED,
make button spacing regular and standardized so that its left middle right with correct spacing. homie should
be like a siri." He also approved the rest of the proposal as written ([[unanswered-part-is-approved]]).

**What shipped:**
- The bottom bar is **Back · homie · Next step**. The two buttons are the same width, with the same 12 pt gap on
  each side of homie and 24 pt margins, and words only, so "Next step" fits a small phone. homie docks there at 64 pt
  (`useHomieScreen({ dock })`), computed from the window, not measured.
- **No chips under homie.** Back is the bottom button or "back" said out loud. Repeat is the video's own replay or
  "repeat" said out loud.
- **Like Siri:** the docked pot wears a soft green aura (`HomiePot aura`). It breathes while listening, swells
  with the kid's voice, is faint with the mic off, and hands over to the warm halo, which pulses while homie speaks.
- **A tap asks** ("Ask Grandma anything", or the chat when nobody's listening). **A long press turns the mic off
  or on.** Words said in that ask moment are always for homie ([[homie-judges-who-was-talking]]).
- Labels ("AI voice", "Mic off", "I asked Grandma") sit above the docked pot.
- **The expand** (cook mode's HomieMoment and the recording screen's AskMoment): from the pot's exact frame, the
  glide, the growth and the blur run as one 420 ms move. The blur is 30 (it was 70), and the tint stays at 50% so the
  white question stays readable.

**Why:** the corner held homie plus three small chips, and nobody would tap them. The thumb and the eyes sit at
the bottom and on the video, and a single centred helper reads in 3 seconds.

**How to apply:** new cook-mode actions go to voice or to homie's tap, never back into a chip row. Keep the bar
symmetric (equal widths, one gap). Any other screen that docks homie low gets labels above it automatically
(`labelAbove`).

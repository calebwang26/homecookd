---
name: homie-judges-who-was-talking
description: "Oct 24: in cook mode Claude judges whether the kid was talking to homie and stays silent if not; 'homie' (spelled loosely) is a strong yes; no wake word; plain commands always work"
metadata:
  type: project
---

On 2026-10-24 Caleb picked this fix: in cook mode, **Claude judges whether the kid was talking to homie**, and homie
stays silent when they weren't. "homie" in the transcript is a strong yes, matched loosely because Ink writes
"homey", "Holmy" and so on. Plain commands (next step, back, repeat, timers) always work. **No strict wake word.**

**Why:** the mic hears the whole kitchen. Before, everything it heard (minus echo, speech during a clip and
non-English) went to homie, so a kid talking to a roommate got an answer. A wake word would make a hands-free
helper feel like a gadget.

**How to apply:**
- `voice/src/agent.ts`: the system prompt starts with the "was this for you?" rules, each turn's message says
  whether the kid said homie's name (`saysHomie`, one loose regex), and not-for-homie = no tool, an empty reply.
- The silent path stays cheap: no tool call, no Sonic. `cook.ts` then sends `{ type: "quiet" }` and the app ends
  "thinking" (`voiceLogic` `endsThinking`).
- The FAST commands and timers in `cook.ts` skip Claude, so they never depend on this judgment. Don't add a name
  check in front of them.
- A live test of `/cook` includes a sentence to someone else (`voice/test-audio/to-roommate.wav`) and one with the
  name (`homie-question.wav`).
- Related: [[homie-silent-during-video]], [[homie-tap-always-answers]].

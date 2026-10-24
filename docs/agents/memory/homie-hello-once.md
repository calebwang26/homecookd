---
name: homie-hello-once
description: "Oct 24: homie introduces itself once per person on a phone, then never again"
metadata:
  type: project
---

On 2026-10-24 Caleb said: "After homie introduces itself once, it doesn't have to introduce itself again."

**The decision (shipped in `app/`):**
- A tap on the resting pot on a screen without its own line says "Hi, I’m homie." the first time only. After
  that, those screens say "I’m right here." (`lib/homie/logic` `HELP.hello` / `HELP.again`).
- Remembered per person on this phone with kv (`homie.introduced.<profileId>`, `lib/homie/intro`), so it lasts
  across app restarts. The recording hello ("Hi, Mom. I'm homie. ...") counts as the introduction too.
- Screens with a line of their own (cook mode, Recipes, parent Home, Messages) always say it; they never use up
  the hello.

**Why:** homie is family, not a product tour. A cousin doesn't say their name every time you look up.

**How to apply:**
- Any new place homie greets someone checks `takeTapLine` / `markIntroduced` instead of saying its name again.
- Not done yet: the voice service's recording hello still says "I'm homie" on every recording (`voice/src/lines.ts`,
  `homie.ts` `intro()`). Shortening it for a cook who has recorded before needs a voice-service change and deploy.
- Related: [[homie-voice]], [[homie-talks-no-bubble]], [[declutter-first]].

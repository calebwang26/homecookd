---
name: homie-hello-once
description: "Oct 24: homie introduces itself once (the pot per person on a phone; the recording hello per cook), then never again"
metadata:
  type: project
---

On 2026-10-24 Caleb said: "After homie introduces itself once, it doesn't have to introduce itself again."

**The decision (shipped in `app/`):**
- The first tap on the resting pot says "Hi, I’m homie." before its line, the first time only (`lib/homie/logic`
  `HELP.hello`). Since Oct 24 every tap has a real line after that: news, or the tab's own
  ([[homie-tap-always-answers]]); "I’m right here." on its own is gone.
- Remembered per person on this phone with kv (`homie.introduced.<profileId>`, `lib/homie/intro`), so it lasts
  across app restarts. The recording hello ("Hi, Mom. I'm homie. ...") counts as the introduction too.

**Why:** homie is family, not a product tour. A cousin doesn't say their name every time you look up.

**How to apply:**
- Any new place homie greets someone checks `takeTapLine` / `markIntroduced` instead of saying its name again.
- The recording hello (voice service, Oct 24, Caleb: "fix this"): a cook homie has recorded with before (Convex
  `live.sessionView` `metBefore`: another of her recordings started filming) gets a short welcome back with no
  "I'm homie" and no explaining (`homie.ts` `intro(true)`, fallback `lines.ts` `introAgain`). This one is per
  person everywhere, not per phone: Convex knows her recordings.
- Related: [[homie-voice]], [[homie-talks-no-bubble]], [[declutter-first]].

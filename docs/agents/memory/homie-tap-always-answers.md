---
name: homie-tap-always-answers
description: "Oct 24: a tap on homie always gets a spoken answer: news first (Claude's words), else the screen's ONE line about its big button; a second tap in a row says \"I'm right here.\""
metadata:
  type: project
---

On 2026-10-24 Caleb reviewed the app and approved: **a tap on homie always gets a spoken answer.** When something
is new for that person, homie says it, written by Claude from context ("Grandma answered your question about the
poha", "Leo's cooking your recipe right now", a gentle nudge after a quiet week). When nothing is new, it says a
default for the tab it's on, in the form **"Explore X by doing X"** ("Explore dishes near you by tapping a photo on
the map."). It never says the same line on taps in a row.

Later the same day Caleb picked "family news" from three declutter directions: **one line per screen, about the
screen's big button, in the button's own words** ("Cook something tonight by tapping Start cooking."). The second
line on every screen is gone. A second tap in a row says "I'm right here.", then the line again. No news while a
cook is filming (`/recording`: "Keep cooking. I'm listening."), and never in cook mode.

**Why:** "I'm right here." on every tap felt dead. homie should feel proactive and emotionally aware, like family
that noticed something, and a tap that gets silence or the same line again teaches the kid to stop tapping. Two
lines per screen read like a tour guide, pointed away from the main button (the heart, the swipe row) and went
stale when a screen changed ("the table" outlived its cut in #64; "tap Back" played mid-filming).

**How to apply:**
- The lines: `app/src/lib/homie/tap.ts` (`TAP_LINES`, one per screen, "… by …ing …", at most 12 words, naming the
  big button exactly as it reads; `TAP_AGAIN`; `chooseTapLine`). A new screen gets one line there. When a screen's
  big button changes or goes, change its line in the same PR.
- Cook mode keeps its own pot: a tap asks, a long press turns the mic off or on ([[homie-docked-cook-bar]]).
- The news: Convex `homie:news` (`convex/homie.ts`, at most 3 facts, newest first; a quiet week only when nothing
  else is new). Each fact is told once per person (`lib/homie/intro`, kv `homie.told.<profileId>`).
- Claude's words: the voice service's `POST /homie/line` (`voice/src/tapLine.ts`), asked as soon as a fact appears
  (`lib/homie/news`), so the tap itself waits only for `/speak`. Claude may add warmth, never facts. The fact's
  plain line is the fallback.
- The tap is an answer to the kid, so it speaks at once and pauses a playing video (`speak(…, { answer: true })`).
  Everything homie says on its own waits for the video ([[homie-silent-during-video]]).
- The hello still comes once per person, now before the first tap line ([[homie-hello-once]]).
- Related: [[homie-talks-no-bubble]], [[declutter-first]], [[homie-voice]].

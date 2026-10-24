---
name: homie-tap-always-answers
description: "Oct 24: a tap on homie always gets a spoken answer: news first (Claude's words), else the tab's 'Explore X by doing X' line, never the same line twice in a row"
metadata:
  type: project
---

On 2026-10-24 Caleb reviewed the app and approved: **a tap on homie always gets a spoken answer.** When something
is new for that person, homie says it, written by Claude from context ("Grandma answered your question about the
poha", "Leo's cooking your recipe right now", a gentle nudge after a quiet week). When nothing is new, it says a
default for the tab it's on, in the form **"Explore X by doing X"** ("Explore dishes near you by tapping a photo on
the map."). It never says the same line on taps in a row.

**Why:** "I'm right here." on every tap felt dead. homie should feel proactive and emotionally aware, like family
that noticed something, and a tap that gets silence or the same line again teaches the kid to stop tapping.

**How to apply:**
- The lines: `app/src/lib/homie/tap.ts` (`TAP_LINES`, two per screen taking turns, each "… by …ing …", at most
  12 words; `chooseTapLine`). A new tab or screen gets its own pair there. Cook mode keeps its own pot tap.
- The news: Convex `homie:news` (`convex/homie.ts`, at most 3 facts, newest first; a quiet week only when nothing
  else is new). Each fact is told once per person (`lib/homie/intro`, kv `homie.told.<profileId>`).
- Claude's words: the voice service's `POST /homie/line` (`voice/src/tapLine.ts`), asked as soon as a fact appears
  (`lib/homie/news`), so the tap itself waits only for `/speak`. Claude may add warmth, never facts. The fact's
  plain line is the fallback.
- The tap is an answer to the kid, so it speaks at once and pauses a playing video (`speak(…, { answer: true })`).
  Everything homie says on its own waits for the video ([[homie-silent-during-video]]).
- The hello still comes once per person, now before the first tap line ([[homie-hello-once]]).
- Related: [[homie-talks-no-bubble]], [[declutter-first]], [[homie-voice]].

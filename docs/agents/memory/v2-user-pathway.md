---
name: v2-user-pathway
description: "Oct 29: the next version of the app is built around one user pathway (kid on the web → Ask Mom → parent answers by voice → film in the app); docs/PRD-V2.md"
metadata:
  type: project
---

On 2026-10-29, before launch marketing to both customers, Caleb set the user pathway that the next version of the
app is built around, "the beginning of the PRD". It's in full in `docs/PRD-V2.md` section 1, in his words.

In short:
- **Kids** find homecookd through UGC. They land on the website (no install), name the dish they crave, and get
  tonight's version from estimates. Then they tap "Ask Mom": an editable message in their voice, plus an optional
  voice note.
- **The parent** opens the kid's link. She hears the voice note and sees the kid's guess shown as a guess, so she
  wants to correct it. She answers by voice, the recipe fills in with her words, and she sees "Sent to Caleb". Only
  then comes the download ask: "Surprise your kid by filming a video."
- **Cold parents** come from Facebook and install the app. The first screen is "Ask your kids what they're craving"
  (main) or "Start recording now". Recording gets a reminder, plus a 2-minute voice fallback so the kid gets
  something tonight.

**Why:** a parent acts when her own kid asks for a specific dish, and a kid acts when they can cook something
tonight with no install. Every step lowers friction until the emotional moment, and the download ask comes after
that moment.

**How to apply:** design every new screen, flow and piece of copy for the next version from this pathway, and check
it against `docs/PRD-V2.md` before building. Where older docs (PRD.md, SPEC.md, the bible's flows,
[[dual-icp-playbook]]'s Oct 16 cut of "Ask Mom") disagree, the pathway wins. Nothing is built yet: Caleb said
absorb it, don't build. Mockups come before big UI changes.

Related: [[dual-icp-playbook]], [[lander-icp-problems]], [[declutter-first]]

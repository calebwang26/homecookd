---
name: homie-guidance-only
description: "Oct 24: while a cook films, homie gives guidance (help capture the recipe), never cooking advice"
metadata:
  type: project
---

On 2026-10-24 Caleb said: "WE DO NOT WANT REAL COOKING ADVICE, WE WANT GUIDANCE. STICK TO IT."

**The decision:** while a parent records, homie only helps them capture the recipe well, so the kid can follow it
later. It asks; it never teaches. Guidance looks like:
- "How much salt was that?" (an amount she left vague)
- "Can you tilt the pan toward me?" / "Hold up the spice so Leo knows which one." (`show`, from the camera's picture)
- "How do you know it's ready?" (a cue), "What would you use if Leo can't find curry leaves?" (asked, never suggested)
- "Show me the plate when it's done." (the `plate` photo at the end: the recipe's cover)
- A story invite during a wait.

Never: correcting her technique, suggesting a change to the dish (an ingredient, amount, heat, time, tool),
warnings, "you should", praise or grading of her skill. She is the expert.

**Why:** the cook is the family's expert and the product is her recipe in her voice. An AI telling a grandmother
how to cook is insulting and makes the recipe less hers.

**How to apply:**
- The rule lives in `voice/src/homie.ts` (`GUIDANCE`, in the `decide` and `endQuestions` prompts) and a code check
  under it: `soundsLikeAdvice` drops any line whose English reads like advice (`voice/test/guidance.test.ts`).
  Any new prompt that writes something homie says to a cook while she records uses `GUIDANCE` too.
- Pacing for guidance (`voice/src/pacing.ts`, Oct 24): first question after 2 min, 3.5 min gaps, at most 8.
- Checked live on Oct 24 (`voice/scripts/try-decide.ts`): "Oh no, I think I put too much chili, and the flame
  is too high" → Opus stays quiet; "one spoon of this masala" with a photo → "can you hold up that masala so
  Shreya knows which one it is?".
- The kid's cook mode (`/cook`) is a different job (helping the kid follow the recipe) and isn't covered here.
- Related: [[in-app-recording]], [[homie-talks-no-bubble]], [[homie-voice]].

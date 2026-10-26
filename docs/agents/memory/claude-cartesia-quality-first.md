---
name: claude-cartesia-quality-first
description: "Oct 26: Claude + Cartesia run the whole AI backend (Gemini and Muse both go); pick models quality-first, then cheapest that holds it"
metadata:
  type: feedback
---

Caleb, 2026-10-26: "We want Claude running the entire back end as the AI. Claude plus Cartesia." Muse Spark moves
to Claude too (the pipeline's recipe writer, Convex's Community story cards, the finished-dish photo note), on top of
the move off Gemini ([[model-migration-after-hackathon]]). And: "We want to have a baseline level of quality so that
users are never experiencing any friction. But at the same time, if there are ways to cut costs while maintaining
quality, we should always take that route. But if it sacrifices large quality gains for large cost cuts, do not
pursue. Again, user experiences first."

**Why:** families notice a wrong amount, a bad cover or a quote that isn't hers; a few cents per recording don't
matter to them. But costs add up at scale, so nothing should cost more than its quality needs.

**How to apply:**
- Every model choice is measured: run today's output and each candidate on real recordings (Swordfish steak, Poha)
  and pick the cheapest model that matches today's quality. Haiku first, then Sonnet, then Opus.
- Never ship a cheaper model that is clearly worse for users. Examples: Haiku wrote "half the rice" for "first wash
  the rice", so translations use Opus; Haiku's Poha cover had a thumb over the bowl, so the cover uses Sonnet.
- Cheap levers that keep quality are always taken: smaller images (stills within 640x640), prompt fixes (the
  writer's CLAUDE_SYSTEM), Haiku where it ties.
- Put the numbers (quality and cost) in the PR, and leave a real quality-vs-cost trade to Caleb.

Related: [[gemini-credits-nearly-gone]], [[model-migration-after-hackathon]]

---
name: recipe-cost-target
description: "Nov 8: a recipe's model calls should cost under $0.10 for a 10-minute video, but never by dropping quality; extraction stays on Sonnet"
metadata:
  type: feedback
---

On 2026-11-08 Caleb asked (through the Master Agent) for every cost cut except moving the extraction to Haiku, "to get
the cost sub-10 cents. Remember, you have to test it and make sure quality doesn't drop off." The extraction stays
on Sonnet because Haiku missed Poha's amounts on Oct 26.

**Why:** production's first 10-minute recipe (Caleb's steak, job 3bcd2cba) cost $0.25 in model calls, and a
17-minute Biryani $0.56.

**How to apply:**
- Quality wins over the target. Test every cut against two runs of today's settings, since a single run varies
  (amounts, stories). Check ingredients and amounts that are only shown, never said, and the cook's stories.
- Where it stands (PR with the results table): the steak at $0.107, the Biryani at about $0.29. The cover is on Haiku,
  the ingredient check on Sonnet at 384 px (Haiku missed half the ingredients), cook mode's short steps at low effort,
  and the extraction and recipe writer on the Batch API (half price, about 4 minutes longer).
- Tried and not kept: frames sparser than today's, which lost shown-only ingredients; 448 px frames, which lost the
  Biryani's opening story line in 9 of 9 runs; prompt caching, which saves nothing at today's volume.
- The cook's wait matters as much as the cents: a 10-minute recording should still be a recipe in about 10 minutes.

Related: [[claude-cartesia-quality-first]], [[eval-cheap-by-default]], [[claude-cost-settings]]

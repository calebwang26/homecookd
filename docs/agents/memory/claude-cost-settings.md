---
name: claude-cost-settings
description: "Oct 26: the voice service's recording check runs on Haiku and Opus fast mode is off, to keep Claude spend down"
metadata:
  type: feedback
---

On 2026-10-26, after the Anthropic API stopped at the $20 monthly spend limit ($26.60 spent), Caleb asked for the
two cheapest fixes: Haiku for homie's "should I speak?" check while a cook records, and Opus fast mode off.

**Why:** that check runs about every 15 s of a recording, often with a camera still, and it was on Opus at the
fast-mode premium price. Most of the month's spend came from it and from live tests.

**How to apply:**
- `HOMIE_DECIDE_MODEL` defaults to `claude-haiku-5-5` (`voice/src/env.ts`); don't move it back to Opus without Caleb.
- Fast mode stays off: `voice/deploy.sh` sends `CLAUDE_FAST=0` unless `.env` sets `CLAUDE_FAST=1`.
- homie's other lines and cook mode stay on Opus. Moving cook mode to Sonnet needs a Marathi quality check and his OK.
- The Anthropic monthly spend limit is set in the Console (Spending → Limits); check it before a long live test.

Related: [[cartesia-credits-for-tests]], [[auto-ship-merged-prs]]

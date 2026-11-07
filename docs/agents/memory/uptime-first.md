---
name: uptime-first
description: "Nov 7: Caleb's standing priority for production: the app never crashes, about 99.9% uptime"
metadata:
  type: project
---

Nov 7, 2026. Caleb, verbatim: "the priority here is to make sure that the app never crashes and has an uptime of like 99.9%".

99.9% a month is about 43 minutes of downtime.

**Why:** 1.1 is the first public version, and every real family lands on AWS from day one (docs/build/CUTOVER.md). A parent who isn't techy and
meets a crash or a dead screen may not come back.

**How to apply:** where a choice trades reliability for cost or simplicity, default to the reliable option and put its monthly cost beside it, so
Caleb can pick before release (for example #377: production's worker always on, about $85 a month, not 0 to 1 on the queue). In the app, a
failure shows words and a way to try again, never a crash. Changes that could take production down (applies, deploys, migrations) are planned
with their rollback first. Spending is still Caleb's call above the AWS rule's limits (`docs/agents/memory/aws-migration.md`).

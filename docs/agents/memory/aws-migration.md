---
name: aws-migration
description: "Oct 31: all hosting moves to AWS in phases; the limits on what needs Caleb's OK"
metadata:
  type: project
---

Oct 31, 2026 (Caleb): all hosting moves to AWS, and Supabase and Convex get rewritten over time, for long-term reliability
and because the account has $10,100 in credits. The plan is `docs/build/AWS-MIGRATION.md`, the code is `infra/`, and the
owner is the "AWS backend" chat.

The backend must follow `docs/build/SYSTEM-DESIGN.md`, and the plan carries no week estimates (Caleb, Oct 31).

**Why:** Convex runs on a preview deployment, the worker on a laptop, and the credits expire (most on Oct 31, 2028).
**How to apply:** Caleb's OK in chat each time for switching live traffic, production data, DNS, any change to Cloud Run,
Convex, Supabase or GCS, anything likely to add over $300 a month, or deleting what this work didn't create. Until
Apple approves 1.0: nothing that changes what build 6 calls. Credits don't pay for Claude. Budget alerts must exclude
credits and refunds, or spend reads $0 and they never fire.

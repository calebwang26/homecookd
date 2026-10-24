---
name: pr-merge-organizer
description: "Oct 24: sessions don't merge or ask Caleb to merge; ready PRs go to the organizer session"
metadata:
  type: feedback
---

Oct 24 2026. When a PR in calebwang26/hackathon-homecookd is ready, don't merge it and don't ask Caleb whether to
merge. Send the organizer session ("Cartesia integration setup", the overarching chat the track A–D sessions came
from) the PR number and one line on what it does. The organizer checks it (no secrets or `.env`, clean against
main, typecheck and tests pass), resolves conflicts and merges. Say what you already checked so it isn't redone.

**Why:** Caleb runs several sessions at once during the hackathon and doesn't want merge questions from each one.
One session sorting PRs keeps main consistent and conflicts handled in one place.

**How to apply:**
- Cross-session message to the organizer: PR number, one line, what you already checked.
- Deploys, deletes and secret writes still go to Caleb, never to the organizer.
- If your own merge attempt was blocked by a permission check, say so in the message; don't ask the organizer to
  merge "for you" ([[git-pr-workflow]]).

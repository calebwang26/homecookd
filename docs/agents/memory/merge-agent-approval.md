---
name: merge-agent-approval
description: Every PR goes to the "Merge Agent" session for approval; it has the final say on merges and conflicts
metadata:
  type: feedback
---

On 2026-10-24 Caleb said: whenever you create a PR, send it to the chat titled "Merge Agent" for approval. The
Merge Agent organizes all the PRs, makes sure they don't conflict and merges them cleanly. When they do conflict,
it has the final say on how to merge them.

**Why:** many agent sessions open PRs on this repo at once; one session watching all of them keeps main clean.

**How to apply:**
1. Open the PR as usual ([[git-pr-workflow]]).
2. Send the Merge Agent the PR number, link, branch, files touched and a one-line summary (Claude Code:
   `ListAgents`, then `SendMessage` to "Merge Agent"; Codex or Salik: ask Caleb to pass it on).
3. Don't merge until it approves. If your PR conflicts with another, do what the Merge Agent decides.

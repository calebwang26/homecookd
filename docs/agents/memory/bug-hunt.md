---
name: bug-hunt
description: "Nov 9, 2026: a permanent Bug hunt chat finds and proves bugs on live, sends each to the owning chat; it fixes none"
metadata:
  type: project
---

Caleb, Nov 9, 2026, after "Get the app" and "Open homecookd" were found broken on the live site two days after 1.1
shipped: "find bugs, then send those bugs to the right chat to fix". The chat is titled **Bug hunt**. Its brief is
`docs/agents/BUG-HUNT.md`.

**Why:** section chats check their own files, so bugs at the seams between sections (website → App Store → app, settings
nobody switched on at launch) went unseen until Caleb hit them.

**How to apply:** Bug hunt walks the live app and site daily and after every release, then sends each bug, with steps,
evidence and the check that should pass, to the chat that owns the files ([[section-chats]]). Urgent bugs also go to the
Master Agent, which decides who fixes them and in what order. Owners fix and add the check as a test, and the Master
Agent merges as usual. Bug hunt changes only its brief and `scripts/bug-hunt/`. The Master Agent tells it when something
ships, so it can verify on live.

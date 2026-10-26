---
name: section-chats
description: "Oct 26: one permanent Claude chat owns each section of the codebase; the Merge Agent routes work to them"
metadata:
  type: project
---

Since 2026-10-26 (Caleb), each section of the codebase has one permanent Claude Desktop chat that owns it, and nobody
archives them. Send work to the chat that owns the files it touches; the **Merge Agent** (head agent) reviews, merges
and ships every PR, routes new work, and keeps the "homecookd work tracker" doc (one table per section).

| Chat (title) | Owns |
|---|---|
| Merge Agent | merging and shipping, routing, the tracker, pipeline worker restarts |
| Voice & homie | `voice/`; homie's logic and UI in the app (`app/src/lib/homie`, `lib/live/voice.ts`, `voiceLogic.ts`, `speak.ts`, `lib/live/homie.ts`, `components/homie`) |
| Pipeline & recipes | `pipeline/` (worker, extraction, covers, transcripts, writer, `account_purge.py`), the pipeline's AI models, recipe data in the bucket |
| Convex & accounts | `convex/`, `cloud/` (upload signer), the frozen `supabase/`, Apple revocation |
| App screens & recording | every other app screen: filming, Record, Send, Home, Recipes, Messages, profiles, cook languages (`app/src/lib/words`) |
| App Store, web & builds | the App Review guard, Salik's handoff doc and App Store Connect, `web/` (both repos), native TestFlight builds, icon and screenshots, the TEST family |

**Why:** fewer chats to manage, each keeps its section's context, and no time or tokens spent briefing new chats.
**How to apply:** a chat edits only its section; a change that spans sections goes to the main owner, who tells the
Merge Agent so it can coordinate the other owner. Codex and Salik ask Caleb which chat to hand a change to.

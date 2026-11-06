---
name: section-chats
description: "Oct 26: one permanent Claude chat owns each section of the codebase; the Merge Agent routes work to them"
metadata:
  type: project
---

Since 2026-10-26 (Caleb), each section of the codebase has one permanent Claude Desktop chat that owns it. A chat is
refreshed (fresh session, same title, handoff in `docs/agents/HANDOFFS-<date>.md`, old one archived) once its transcript
passes about 40 MB (Caleb, Nov 5): the desktop app freezes opening bigger ones. Send work to the chat that owns the files it touches; the **Merge Agent** (head agent) reviews, merges
and ships every PR, routes new work, and keeps the "homecookd work tracker" doc (one table per section).

| Chat (title) | Owns |
|---|---|
| Merge Agent | merging and shipping, routing, the tracker, pipeline worker restarts |
| Voice & homie | `voice/`; homie's logic and UI in the app (`app/src/lib/homie`, `lib/live/voice.ts`, `voiceLogic.ts`, `speak.ts`, `lib/live/homie.ts`, `components/homie`) |
| Pipeline & recipes | `pipeline/` (worker, extraction, covers, transcripts, writer, `account_purge.py`), the pipeline's AI models, recipe data in the bucket |
| Convex & accounts | `convex/`, `cloud/` (upload signer), the frozen `supabase/`, Apple revocation |
| Notifications & linking (Oct 29) | v2 Phase 4 (`docs/build/V2-LINKING.md`): pushes from Convex (`convex/push.ts`, `pushEvents.ts`, `lib/push*.ts`), claim on install (`convex/links.ts`, `lib/linkRoutes.ts`, `lib/joinTicket.ts`, Supabase `functions/api/link.ts`), the app's link and push plumbing (`app/src/lib/push.ts`, `lib/auth/links.ts`, `lib/live/links.ts`, `lib/linkClaim.ts`, the `/miss` and `/a` claim screens) |
| App screens & recording | every other app screen: filming, Record, Send, Home, Recipes, Messages, profiles, cook languages (`app/src/lib/words`) |
| AWS backend (Oct 31) | `infra/`, `api/`, `.github/workflows/` (checks and deploys), `docs/build/AWS-MIGRATION.md`, the AWS account |
| App Store, web & builds | the App Review guard, Salik's handoff doc and App Store Connect, `web/`, native TestFlight builds, icon and screenshots, the TEST family |

**Why:** fewer chats to manage, each keeps its section's context, and no time or tokens spent briefing new chats.
**How to apply:** a chat edits only its section; a change that spans sections goes to the main owner, who tells the
Merge Agent so it can coordinate the other owner. Codex and Salik ask Caleb which chat to hand a change to.

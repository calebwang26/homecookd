---
name: hackathon-stack-oct23
description: "Oct 23 2026: Caleb's PLAN.pdf is the guideline for the 2-day hackathon; stack is Convex + live voice service (Cartesia, Claude, Moss) + Muse Spark, cut for speed"
metadata:
  type: project
---

On 2026-10-23 Caleb gave the plan for the 2-day hackathon (PLAN.pdf) and said to treat it as the guideline and change the stack to match it. He approved these cuts for speed, recorded in `docs/build/STACK.md`:
- Convex is the new backend; Supabase is frozen but keeps sign-in, invites and the older screens running. Convex reuses the Supabase device key once (`sessions.start`) instead of rebuilding sign-in.
- Video processing stays in the Python pipeline (`worker.py` claims jobs from Convex), and big videos stay in GCS.
- The glasses go through the camera roll first; Meta's live glasses kit is the stretch goal.
- Moss only finds moments; never Moss Inference. Questions the video can't answer go to the cook, never to an AI guess.
- The sponsor tracks are Meta (Muse Spark), Anthropic (Claude), Cartesia, Moss, Convex, Best People-First Hack and Best Hardware Hack (glasses).

**Why:** a 2-day hackathon means every piece has to be integrated quickly, and Caleb asked to be told about more efficient options before changes were made.

**How to apply:** build new features in Convex and the voice service, following the contracts in STACK.md. Don't add features to Supabase. If a piece of the PDF looks slow to build, say so and offer the faster way before building it.

Related: [[testflight-live]], [[declutter-first]]

---
name: model-migration-after-hackathon
description: "Oct 24: the move off Gemini to Claude + Cartesia starts only after the hackathon (Sun Oct 25, 8pm); one PR per step, each behind an env flag"
metadata:
  type: project
---

On 2026-10-24 Caleb approved moving homecookd's model calls off Gemini to Claude (text, images) and Cartesia
(audio), and said not to start before the hackathon ends: **Sunday Oct 25, 2026, 8pm**. It started Oct 25 at 8:55pm.

The steps, one small PR each: (1) text calls (Convex translate and yes/no; the pipeline's clip order, short substeps
and writer fallback), (2) the cover pick, (3) the video extraction (Cartesia transcript + frames + Claude),
(4) `align.py` from transcript times, (5) voice: Cartesia as the backup voice and for live Marathi, and (6, added
Oct 26) Muse Spark to Claude too: the writer, the Community story cards and the photo note
([[claude-cartesia-quality-first]]). `edible-glasses/` stays as it is. Progress is in the STATE.md change log.

**Why:** don't risk the demo path; switch once the hackathon is over. Gemini credits are nearly gone
([[gemini-credits-nearly-gone]]).

**How to apply:**
- Every switch sits behind an env flag (`TEXT_PROVIDER=gemini|claude`, ...), and unsetting it rolls back to Gemini.
- Keep each output the same, so the app doesn't change. Compare against today's output before calling a step done.
- Deploys and flipping a flag in production are Caleb's call.

Related: [[cook-languages]], [[homie-voice]]

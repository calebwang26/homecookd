---
name: model-migration-after-hackathon
description: "Oct 24: the move off Gemini (and Muse) to Claude + Cartesia, after the hackathon; one PR per step behind env flags; Caleb's Oct 26 calls: Marathi on Cartesia as is, Odia hidden, glasses stay on Gemini, one Anthropic key"
metadata:
  type: project
---

On 2026-10-24 Caleb approved moving homecookd's model calls off Gemini to Claude (text, images) and Cartesia
(audio), and said not to start before the hackathon ends: **Sunday Oct 25, 2026, 8pm**. It started Oct 25 at 8:55pm.

The steps, one small PR each: (1) text calls (Convex translate and yes/no; the pipeline's clip order, short substeps
and writer fallback), (2) the cover pick, (3) the video extraction (Cartesia transcript + frames + Claude),
(4) `align.py` from transcript times, (5) voice: Cartesia as the backup voice and for live Marathi, and (6, added
Oct 26) Muse Spark to Claude too: the writer, the Community story cards and the photo note
([[claude-cartesia-quality-first]]). Progress is in the STATE.md change log.

**Caleb's decisions (Oct 26):**
- **Marathi goes on Cartesia as it is** (ink-whisper), not Gemini-for-Marathi or a specialist speech-to-text. Its
  transcript is rough, so quality work happens on our side (the right language tag, audio cleanup, a Claude
  proofread pass), not by changing vendors.
- **Odia is hidden from the cook language picker** (`app/src/lib/languages.ts`): Cartesia can't hear it, so it was
  the only language whose live listening would stay on Gemini. It comes back only if a family asks.
- **The glasses stay on Gemini**: the glasses' live analysis (`edible-glasses/receiver/live_analysis.py`, 30 s
  windows → Gemini → Convex `liveEvents`) and anything else in `edible-glasses/` keep using Gemini, because
  recording through the glasses is a very low use case. `GEMINI_API_KEY` stays in the glasses' setup; nothing else
  in the stack should require it.
- **One Anthropic key** for voice, pipeline and Convex. Caleb raises its usage limit as needed; no separate keys.
- Translations stay on Opus: Sonnet at medium effort got 7 of 12 hard Marathi lines, Opus 12 of 12.

**Why:** don't risk the demo path; switch once the hackathon is over. Gemini credits are nearly gone
([[gemini-credits-nearly-gone]]).

**How to apply:**
- Every switch sits behind an env flag (`TEXT_PROVIDER=gemini|claude`, ...), and unsetting it rolls back to Gemini.
- Keep each output the same, so the app doesn't change. Compare against today's output before calling a step done.
- Deploys and flipping a flag in production are Caleb's call.

Related: [[cook-languages]], [[homie-voice]]

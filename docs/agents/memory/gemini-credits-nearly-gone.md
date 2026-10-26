---
name: gemini-credits-nearly-gone
description: "Oct 24: Gemini has about $10 left, so every new model call uses Claude (text, images) or Cartesia (audio), never Gemini"
metadata:
  type: project
---

On 2026-10-24 Caleb said Gemini has about $10 of credits left, while Claude (about $800) and Cartesia (1.24M
credits) are paid for. He chose the Cartesia + Claude approach to replace it.

**Why:** a new Gemini call would run on credits that are almost gone, and the pipeline would stop when they end.

**How to apply:**
- A new model call uses Claude for text and images (Haiku 5.5 where it holds up; check the output) and Cartesia for
  audio (Ink 2 / ink-whisper to hear, Sonic to speak). Claude takes no audio or video.
- Don't add new Gemini calls, even as a fallback. Existing ones move off it one PR at a time, each behind an env flag
  with Gemini as the rollback: [[model-migration-after-hackathon]].
- Use the claude-api skill for every Claude call.

Related: [[cook-languages]], [[cartesia-credits-for-tests]]

---
name: cook-languages
description: "Oct 24: cooks can speak 12 more languages, on Cartesia + Claude only (no Gemini); which ones, what each piece runs on, merge after the demo"
metadata:
  type: project
---

On 2026-10-24 Caleb approved "the Cartesia + Claude plan for the first 12 languages, merge after the demo",
after a written proposal and live probes. He also said not to plan new languages around Gemini: Gemini has
about $10 left, which is kept for the demo, and a separate move off Gemini starts after Oct 25, 8pm.

**The first set:** Hindi, Gujarati, Tamil, Telugu, Punjabi, Urdu, Mandarin, Korean, Tagalog, Spanish, Portuguese,
Arabic, plus Marathi and English. The picker still offers all 30 languages (`app/src/lib/languages.ts`). Bengali and
Vietnamese work but have no hand-made screen words. Cantonese isn't offered: Sonic can't speak it.

**What each piece runs on:**
- Hearing her live: Ink 2 for en, fr, hi, ja and es. Cartesia **ink-whisper** for the rest
  (`voice/src/inkWhisper.ts`, `stt.ts` `WHISPER_LANGUAGES`). Marathi stays on Gemini Live until the migration
  session switches it behind a flag (Caleb's call: ink-whisper's Marathi spelling is rougher). Odia stays on Gemini
  (ink-whisper doesn't know it).
- homie's lines and translations: Claude. homie speaks of herself in the feminine and politely to an elder, but
  only in her own lines (`translate(…, "homie")`). A kid's words keep the speaker's own gender.
- Her recording screen: `app/src/components/record/wordsByLanguage.ts`, Claude's drafts (TODO(caleb): native check).
- The recipe: the pipeline's `language_line` points its Marathi rules at her language and script. Marathi's
  prompts are byte-identical (pinned by a test in `pipeline/test_prompts.py`).

**Probe results (Oct 24, Sonic audio streamed live into ink-whisper):** zh, ko, vi, pt and ar came back
word-perfect. gu, ur and ta had small slips. mr, te, pa and bn had rough spelling. tl drops its last two words.
Claude still read every rough transcript as the right English. Details are in the session notes,
`more-languages-map.md`.

**Why:** families cook in many languages, and Gemini credits are almost gone, while Cartesia (credits) and Claude
($800) are paid for.

**How to apply:**
- A new cook language needs: an `stt.ts` route, a `languageName` that isn't a bare code, a `GREETINGS` entry in
  `cook.ts`, words in `wordsByLanguage.ts`, a `deviceVoiceLanguage` locale, and a `SCRIPTS` entry in
  `pipeline/prompts.py` when it isn't written in Latin letters.
- Don't move Marathi or any Gemini path in a language PR. That belongs to the migration.
- Live tests: `COOK_LANG=ta` or `zh npm run test-record` (stub recordings `stub-ta` and `stub-zh`).

Related: [[homie-voice]], [[cartesia-credits-for-tests]], [[demo-family-shreya]]

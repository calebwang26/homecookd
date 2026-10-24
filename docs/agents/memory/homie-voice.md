---
name: homie-voice
description: "Oct 24: homie's voice is Riya bilingual (Cartesia), asked for exactly as auditioned, sounding like a warm older cousin; Gemini TTS is the backup voice"
metadata:
  type: project
---

On 2026-10-24 Caleb asked for "the most soothing voice that matches our branding guidelines, that's like warm,
comfortable, almost like cousinly, like you want it to be like your cousin translated between the kid and the
mom". After the audition he said "i like riya as well".

**The decision (shipped in `voice/`):**
- Voice: **Riya bilingual** `930eda72-c1af-4637-8d07-87d881d615fe`, our private localized copy of Cartesia's "Riya,
  College Roommate" that speaks native Marathi and Indian English. One voice everywhere homie talks: the kid
  cooking (`/cook`), a cook recording (`/record`) and `POST /speak`. `HOMIE_VOICE` overrides it.
- The recipe Caleb heard (the audition's "J-riya-bilingual"), in `voice/src/sonic.ts`: model `sonic-3.6`; Marathi
  `{ locale: "mr-IN" }` with `generation_config { speed: 0.85 }`, no emotion; English `{ locale: "en-IN" }` with
  `generation_config { speed: 0.85, emotion: <mood> }`; other languages `{ language: <code> }` at 0.85. Never
  `language` and `locale` together. 24 kHz output. One speed for every line (`HOMIE_SPEED` overrides).
- Moods (English only; Cartesia's emotion tags are English-only): the hello `content`; homie's questions (amount,
  cue, substitution, story, end, opt-in) `curious`; a reaction to her story `affectionate`; the goodbye `grateful`.
  Kid side: greeting `content`, a step and a hint `calm`, replies `content`, the read-aloud offer `curious`, nudges
  and timers `content`, the cook's words in English `affectionate`. Anything else `content`.
- Cousin tone: short sentences, a comma after the person's name ("Hi, Rajani Aaji."), at most one soft lead-in
  before a question ("Quick one..."), end punctuation, never assistant-speak ("I'm your assistant", "How can I
  help"). homie is a young woman's voice, so in Marathi or Hindi she speaks of herself in the feminine.
- Backup voice: when Sonic fails before any audio went out (402, 429, 5xx, 401, a network error, or nothing within
  4 s), Gemini TTS (`gemini-3.8-flash-tts`, prebuilt voice `en-in-assistant-3`, style "warm and gentle, like a caring
  older cousin") says the same line (`voice/src/geminiTts.ts`). Once Sonic's audio has started, a failure just ends
  the line. If Gemini fails too (or sends nothing within 6 s), the line ends with no voice and `/speak` answers 502,
  so the app uses the phone's voice. Fake speech never calls either.
- The backup Caleb also heard and liked: **Sindhu tuned**, `07bc462a-c644-49f1-baf7-82d5599131be` with English as
  `{ locale: "en-IN", accent: "telangana" }` (same speed and moods). It was homie's voice before Oct 24.

**Why:** homie stands between a grandparent and a homesick kid; it has to sound like family, not a product, in
both of their languages.

**How to apply:**
- Don't change the voice, the locale fields, the speed or the moods without Caleb hearing it first. Render samples
  of homie's real lines and send them.
- New kinds of lines get a mood in `sonic.ts` `MOODS`, chosen only from Cartesia's emotion list.
- New English lines follow the cousin tone. New Marathi lines need a native speaker's check (TODO(caleb) in
  `voice/src/lines.ts`).
- Cloud Run doesn't set `HOMIE_VOICE`, so the code default is what ships, on the next `voice/deploy.sh`.

Related: [[demo-family-shreya]], [[cartesia-credits-for-tests]]

---
name: marathi-dropped
description: "Oct 26: Marathi is no longer a cook language; homecookd has 13 integrated languages (English + 12)"
metadata:
  type: project
---

On 2026-10-26 Caleb said: "just drop Marathi as a language, that's way easier. We can just have thirteen integrated
languages." He said it after hearing that Cartesia's Marathi speech-to-text is the roughest of the cook languages
and only Poha (Marathi) had been tested.

**The 13:** English, Hindi, Gujarati, Tamil, Telugu, Punjabi, Urdu, Mandarin, Korean, Tagalog, Spanish, Portuguese
and Arabic, each with the cook's app in her language, live listening, homie's lines and the recipe.

**Why:** Marathi needed the most special handling (its own hearing path, proofreading tuned on it, its own prompt
rules), and its transcripts were the weakest. Fewer languages done well beats more done roughly.

**How to apply:**
- Hide Marathi the way Odia was hidden (Oct 26): out of the picker, kept in a hidden list so a cook who picked it
  before still reads as "Marathi". It comes back only if Caleb asks.
- Don't build or tune new work for Marathi. Pipeline: `transcribe.COOK_LANGUAGES` has no "mr", so a Marathi
  recording reads as its nearest language, usually Hindi.
- Existing Marathi recipes (Poha) stay as they are, with their Marathi quotes.
- New multi-language checks use the 13; [[demo-test-dishes]] keeps Swordfish steak, and Poha stays an existing
  recipe rather than the language test.

Related: [[cook-languages]], [[demo-family-shreya]], [[model-migration-after-hackathon]]

# The 13-language eval

`pipeline/eval_languages.py` runs the real pipeline (the root `.env`'s switches) on one home-cooking video per cook
language whose YouTube subtitles were written in that language, and scores it against those captions. Videos and
results live in `data/eval/` (gitignored, internal testing only). The clips are in `pipeline/eval_clips.json`, each
with a backup video. Run it after any change to the models, prompts, transcription or proofreading:

```bash
.venv/bin/python pipeline/eval_languages.py            # all 13 (about $4.50 and 20 minutes in 3 parallel groups)
.venv/bin/python pipeline/eval_languages.py --only ta,ko
.venv/bin/python pipeline/eval_languages.py --rescore  # score the cached runs again
```

**Columns:** loops = share of Cartesia's words dropped as repeat glitches (music or noise under her voice); heard =
share of the captions' words found in the transcript at the same time (raw, then the proofread copy; Mandarin by
characters); ingredients = share of the ingredients she names that the recipe lists (Claude judges synonyms);
script = share of the recipe's quote_original letters in her language's own script.

**Read with care:** captions are often tidier written language than what she says (dialect, spoken forms), and some
uploaded caption tracks look like cleaned-up machine captions, so heard is a lower bound and best compared run
against run. Clips with background music (high loops) understate how a quiet home kitchen would do.

## Oct 26, 2026 (main with #139, #141, #143; Claude + Cartesia, Opus proofread, Sonnet extraction, writer and ingredient check)

| lang | dish | min | loops | heard raw | heard proofread | ingredients | script | steps | $ |
|---|---|---|---|---|---|---|---|---|---|
| en | Garlic chicken (crispy skin-on chicken) | 5.7 | 0.00 | 0.97 | – | 1.00 | – | 11 | 0.27 |
| hi | Bajra (pearl millet) dish | 10.0 | 0.02 | 0.56 | 0.56 | 0.94 | 0.87 | 12 | 0.48 |
| gu | Lapsi (cracked-wheat sweet) | 9.1 | 0.65 | 0.17 | 0.26 | 1.00 | 1.00 | 9 | 0.30 |
| ta | Agathi keerai poriyal (sesbania leaf stir-fry) | 8.1 | 0.54 | 0.29 | 0.36 | 1.00 | 0.90 | 9 | 0.33 |
| te | Chikkudukaya tomato curry (flat beans and tomato) | 5.0 | 0.03 | 0.35 | 0.79 | 0.96 | 1.00 | 10 | 0.36 |
| pa | Two kaddu (pumpkin/squash) sabzis | 10.0 | 0.56 | 0.17 | 0.26 | 0.77 | 0.87 | 12 | 0.38 |
| ur | Rose momos (dumplings) | 10.1 | 0.15 | 0.89 | 0.85 | 0.83 | 0.93 | 12 | 0.37 |
| zh | Homestyle braised tofu (jiachang doufu) | 10.0 | 0.00 | 0.85 | 0.81 | 0.92 | 1.00 | 11 | 0.42 |
| ko | Geotjeori (fresh kimchi) and braised mackerel | 10.0 | 0.18 | 0.40 | 0.39 | 0.47 | 1.00 | 13 | 0.36 |
| tl | Chicken adobo | 5.8 | 0.00 | 0.96 | 0.93 | 1.00 | – | 12 | 0.31 |
| es | Picadillo | 7.2 | 0.00 | 0.97 | 0.93 | 1.00 | – | 11 | 0.31 |
| pt | Arroz doce (rice pudding) | 8.5 | 0.00 | 0.88 | 0.88 | 0.91 | – | 11 | 0.33 |
| ar | Kofta (stretched with vegetables) | 8.2 | 0.15 | 0.71 | 0.69 | 0.90 | 0.99 | 12 | 0.34 |

- Strong: en, es, tl, pt, zh, ar, ur. Works with the proofread: te (0.35 to 0.79), hi.
- Weak: gu, ta, pa (over half the raw transcript is loops: these videos have music) and ko (a grandmother's strong
  dialect and two dishes in one video; the recipe lost mackerel, salt, sugar and fish sauce, and the ingredient check
  added radish and napa cabbage from the frames and asked about the mackerel).
- The proofread helps the Indic languages and costs 2-4 points where Cartesia is already good (zh, es, tl, ur, ar).

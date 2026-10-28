# The 13-language eval

`pipeline/eval_languages.py` runs the real pipeline (the root `.env`'s switches) on one home-cooking video per cook
language whose YouTube subtitles were written in that language, and scores it against those captions. Videos and
results live in `data/eval/` (gitignored, internal testing only). The clips are in `pipeline/eval_clips.json`, each
with a backup video. Run it after any change to the models, prompts, transcription or proofreading, on the
languages that change touches:

```bash
.venv/bin/python pipeline/eval_languages.py --only ta,ko        # the languages your change touches
.venv/bin/python pipeline/eval_languages.py --all               # all 13: about $2.60 and an hour (cap $3)
.venv/bin/python pipeline/eval_languages.py --rescore           # score the cached runs again: no pipeline calls
.venv/bin/python pipeline/eval_languages.py --only ta --rerun   # a new recipe, Cartesia's transcript kept
```

**Cheap by default (Oct 28):** each clip runs its first 5 minutes (`--minutes 10` for the old length), every Claude
call goes through the Batch API at half price (`CLAUDE_BATCH=1`; each answer takes a minute or two, so a clip takes
about 15 minutes and 4 run at once; `--no-batch` for the normal API), and the run stops before it would pass `--max-usd` (default $3). A clip
that already has a recipe is only scored again; `--fresh` (the transcript too) is only for transcription changes.
Each row's `spent_usd` is what that clip cost in this run, the judge's calls included. Results before Oct 28 are
10-minute runs at full price, so compare a new 5-minute run with a 5-minute run.

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

## Oct 26, later: looped and silent stretches sent again; proofread only hi, gu, ta, te, pa

Each stretch that looped, and each 4 s or more with no words, is sent to Cartesia again on its own (up to 30 s
pieces with a second of context) through ffmpeg's `afftdn` noise filter; its words replace the stretch's only when
there are more of them and they aren't mostly loops. The proofread now runs only where it helped.

| lang | dish | min | loops | heard raw | heard proofread | ingredients | script | steps | $ |
|---|---|---|---|---|---|---|---|---|---|
| en | Garlic chicken (crispy skin-on chicken) | 5.7 | 0.00 | 0.97 | – | 1.00 | – | 11 | 0.26 |
| hi | Bajra (pearl millet) dish | 10.0 | 0.02 | 0.57 | 0.57 | 0.94 | 0.92 | 12 | 0.56 |
| gu | Lapsi (cracked-wheat sweet) | 9.1 | 0.57 | 0.21 | 0.32 | 1.00 | 0.98 | 8 | 0.33 |
| ta | Agathi keerai poriyal (sesbania leaf stir-fry) | 8.1 | 0.44 | 0.40 | 0.46 | 1.00 | 0.88 | 8 | 0.33 |
| te | Chikkudukaya tomato curry (flat beans and tomato) | 5.0 | 0.02 | 0.36 | 0.80 | 1.00 | 1.00 | 11 | 0.37 |
| pa | Two kaddu (pumpkin/squash) sabzis | 10.0 | 0.45 | 0.27 | 0.47 | 0.83 | 0.90 | 12 | 0.44 |
| ur | Rose momos (dumplings) | 10.1 | 0.14 | 0.91 | – | 0.83 | 1.00 | 10 | 0.39 |
| zh | Homestyle braised tofu (jiachang doufu) | 10.0 | 0.00 | 0.85 | – | 0.92 | 1.00 | 12 | 0.45 |
| ko | Geotjeori (fresh kimchi) and braised mackerel | 10.0 | 0.14 | 0.44 | – | 0.60 | 1.00 | 12 | 0.37 |
| tl | Chicken adobo | 5.8 | 0.00 | 0.96 | – | 0.92 | – | 12 | 0.32 |
| es | Picadillo | 7.2 | 0.00 | 0.97 | – | 1.00 | – | 12 | 0.33 |
| pt | Arroz doce (rice pudding) | 8.5 | 0.00 | 0.90 | – | 0.91 | – | 12 | 0.32 |
| ar | Kofta (stretched with vegetables) | 8.2 | 0.14 | 0.75 | – | 0.95 | 1.00 | 12 | 0.38 |

What the recipe uses (the proofread copy where there is one), before -> after: pa 0.26 -> 0.47, ta 0.36 -> 0.46,
gu 0.26 -> 0.32, ko 0.39 -> 0.44, ar 0.69 -> 0.75, ur 0.85 -> 0.91, es 0.93 -> 0.97, zh 0.81 -> 0.85, tl 0.93 -> 0.96,
pt 0.88 -> 0.90, hi 0.56 -> 0.57, te 0.79 -> 0.80, en 0.97 -> 0.97. Ingredients: pa 0.77 -> 0.83, ko 0.47 -> 0.60,
ar 0.90 -> 0.95, te 0.96 -> 1.00; tl 1.00 -> 0.92 (salt, which she says clearly: run-to-run). All 13: $4.57 -> $4.84.
Still weakest: gu (music) and ko (dialect, two dishes).

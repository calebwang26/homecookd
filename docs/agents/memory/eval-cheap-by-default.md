---
name: eval-cheap-by-default
description: "Oct 28: the language eval runs only the languages a change touches, 5-minute clips, on the Batch API, under a $3 cap"
metadata:
  type: feedback
---

On 2026-10-28, after Oct 26's $47 Claude bill (most of it testing: full 13-language eval runs and Opus word
drafts), Caleb asked for the eval to be cheap by default: only the languages a change touches, the Batch API at
half price, 5-minute clips, a spending cap per run, and reuse instead of re-running.

**Why:** a full 10-minute run of all 13 cost about $5, and it was run several times a day while tuning.

**How to apply:**
- `pipeline/eval_languages.py` needs `--only <langs>` (or `--all`); run only what your change touches.
- Defaults: first 5 minutes of each clip, Batch API (`CLAUDE_BATCH=1`: every call; since Nov 8 the worker batches only the
  extraction and the writer, [[recipe-cost-target]]),
  `--max-usd 3`. A clip costs about $0.20 (was ~$0.40); all 13 about $2.60 (was ~$5) and an hour.
- Reuse first: `--rescore` (no pipeline calls), `--rerun` (keeps Cartesia's transcript); `--fresh` only when
  transcription changed.
- Don't raise these defaults without Caleb.

Related: [[claude-cost-settings]], [[cartesia-credits-for-tests]]

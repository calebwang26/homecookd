# Gemini tokens & cost for a 2–3 hour cooking video

Budget: **$20** on the Google Cloud billing account. The worker stops starting new jobs once
estimated spend passes `MAX_SPEND_USD` (default **$15**, in `.env`).

## What was measured (real API calls, Oct 11 2026)

| Measurement | Result |
|---|---|
| 60 s AI copy (360p, 1 fps, 16 kHz mono), `MEDIA_RESOLUTION_LOW` | **5,460** video tokens (≈ 91 tokens/s) |
| Same clip, default resolution | 5,460 (Gemini 3.x already uses the low rate for video) |
| Same clip, `MEDIA_RESOLUTION_HIGH` | 17,340 (≈ 289 tokens/s, 3.2× more) |
| `count_tokens` on the same clip (upper bound) | 6,182 (≈ 103 tokens/s) |
| Pro extraction, 90 s narrated clip | in 8,582 / out 1,044 / thinking 4,195 → **$0.080**, 33 s |
| Pro extraction, 45 s narrated clip | in 4,487 / out 654 / thinking 2,892 → $0.052, 21 s |
| Pro merge (2 files) | in 1,634 / out 2,061 / thinking 3,424 → $0.069, 32 s |
| Flash extraction + merge, same 2 clips | 3 calls → **$0.047** total |

Prices (ai.google.dev/gemini-api/docs/pricing, checked today, per 1M tokens):
- `gemini-3.1-pro-preview`: input $2 (prompt ≤ 200k) / $4 (> 200k); output incl. thinking $12 / $18.
- `gemini-3.8-flash`: input $0.75, output $3.75 (through Dec 31 2026; doubles Jan 1 2027).
- Batch API: 50% off both.

## Projection

Video input tokens ≈ 91/s measured, 103/s upper bound:

| Recording | Video input tokens |
|---|---|
| 15-min file | ~82k – 93k |
| 1 hour | ~0.33M – 0.37M |
| 2 hours | ~0.66M – 0.74M |
| 3 hours | ~0.98M – 1.11M |

Output + thinking per 15-min file is **projected**, not measured: ~10k–25k tokens (thinking dominated the
short test clips; JSON grows with how much happens on camera).

| Setup | 2-hour video (8 files) | 3-hour video (12 files) |
|---|---|---|
| **Pro extraction + Pro merge** (current default) | **~$2.40 – $4.30** | **~$3.60 – $6.30** |
| Flash extraction + Pro merge | ~$0.90 – $1.70 | ~$1.30 – $2.40 |
| Either, via Batch API | half of the above | half of the above |

On $20 that is roughly 3–5 three-hour recipes on Pro, or 8–15 with Flash extraction. Today's demo
footage (≈1 hour total) should cost about **$1.30–2.30** on Pro. Test runs so far cost ≈ $0.70.

## Why it's split into 15-minute files (the biggest saving)

One 3-hour call would be ~1.0–1.1M tokens: at or over the model's 1,048,576-token input limit, and
billed at the > 200k rate ($4 in / $18 out). Fifteen-minute files keep every call under 200k tokens,
so input costs half as much, all files run in parallel, and one failed file never sinks the recipe.

## Efficiency measures in the pipeline

1. **Tiny AI copy**: 360p, 1 fps, 32 kbps mono. Gemini samples video at 1 fps anyway, so this cuts
   upload size ~50× with no loss in what the model sees.
2. **`MEDIA_RESOLUTION_LOW` pinned**: 3.2× fewer tokens than HIGH, and protects against a default change.
3. **Calls stay under 200k tokens** (15-minute files): base price tier.
4. **Merge is text-only**: the video is never sent twice.
5. **Cached chunk results**: a failed merge re-runs only the merge, not the paid extraction.
6. **One retry, then skip**: a failed file is retried once, then that time range is reported as
   "not processed" instead of looping.
7. **Spend cap + length cap**: worker refuses jobs once `MAX_SPEND_USD` is reached or a recording
   exceeds 4 hours. Every call's tokens & cost are logged in `data/out/<id>/work/usage.json`.
8. **Uploaded files deleted** from Gemini right after extraction.
9. **Clip order is one small text-only Flash call** (2+ clips only; `pipeline/order.py`): the step list
   per clip, ~2k–20k tokens in, ~1–2k out with thinking, so about **$0.005–0.03** per recipe
   (estimated, not measured). Cached in the manifest; a re-run repeats it only if the steps changed or
   with `--force`.

## Levers not pulled (quality first)

- `GEMINI_EXTRACT_MODEL=gemini-3.8-flash` cuts a 3-hour recipe from ~$3.60–6.30 to ~$1.30–2.40. Flash's test output
  was good but varied between runs (8 vs 9 steps), so Pro stays the default.
- Batch API (50% off, results within 24 h) fits the "recipe by tomorrow" promise for long videos.
  Batch mode: `process.py --batch` (opt-in, extraction only); measured on 2 short Flash clips: done in 3 min 6 s,
  extraction $0.020 at batch prices vs ~$0.029 synchronous.
- Lower thinking level for extraction would cut output cost; untested for timestamp accuracy.

## Storage & hosting (free tier)

Google Cloud Storage free tier (us-west1): 5 GB-months storage, 5,000 Class A + 50,000 Class B
operations, 100 GB egress per month. Raw phone uploads are deleted after publishing (and auto-deleted
after 14 days regardless), so even a ~10 GB 3-hour upload costs well under one GB-month. The worker
polls every 10 min by default to keep list calls inside the free operations. The upload signer runs on
Cloud Run functions (2M free requests/month).

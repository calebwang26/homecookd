# homecookd

Mom cooks. homecookd writes the recipe & keeps her voice. Spec: [docs/PRD.md](docs/PRD.md) ·
agent rules: [AGENTS.md](AGENTS.md) · Gemini cost math: [docs/COSTS.md](docs/COSTS.md).

## How it fits together

```
iPhone (Expo app)                      Google Cloud (free tier)                 Laptop
─────────────────                      ────────────────────────                 ──────
pick videos ──POST──▶ Cloud Run fn "edible-upload" ──▶ jobs/<id>.json (public status)
            ◀── signed PUT URLs ──
upload in background ─PUT─▶ gs://edible-uploads-… (private) ◀──poll── pipeline/worker.py
                                                                      prep → Gemini → publish
library / recipe ◀──GET── gs://edible-media-… (public, no listing) ◀── play.mp4, voice.m4a,
                                                                      poster.jpg, recipe.json, library.json
```

The Gemini key never leaves the laptop. The app ships only the public bucket URL and the signer URL. The
signer lets in a signed-in phone (it checks the phone's Convex session with Convex) or, from older builds,
the shared family code (`X-Edible-Family`). Signer tests: `python3 cloud/signer/test_main.py`.

## One-time setup (done)

`.venv` (Python deps from `pipeline/requirements.txt`), ffmpeg via Homebrew, `gcloud auth login --update-adc`,
buckets in us-west1, `cloud/grant-iam.sh`, `cloud/deploy-signer.sh`, `.env` (see `.env.example`) and
`app/.env` (see `app/.env.example`).

## Process footage by hand (demo recipes)

```bash
.venv/bin/python pipeline/prep.py --id weed-pancakes --title "Sunday Pancakes" --cook "Mom" --relation "Mom" input/pancakes/*.mov
.venv/bin/python pipeline/process.py --id weed-pancakes
.venv/bin/python pipeline/publish.py --id weed-pancakes
```

YouTube videos: add `--source "Creator Name (YouTube)" --sample` to `prep.py`.

**Clips out of order** (camera-roll dates missing, identical or wrong): with 2+ clips, `process.py` decides
the cooking order (prep, then cooking, then plating) after extraction, from a keyword scorer plus one cheap
Flash call (order + confidence). It reorders only when the content clearly disagrees with the file dates
and the dates look unreliable or the model is sure; a keyword clash keeps the file-date order. A reorder
rebuilds `play.mp4` / `voice.m4a`, shifts every event time and records both orders and why under `order`
in `work/manifest.json`. Tests: `.venv/bin/python pipeline/test_order.py` (ffmpeg, no API calls).

Check every recipe: `.venv/bin/python pipeline/schema.py data/out/*/recipe.json data/synthetic/*.json`.
Republish everything (real + synthetic) and rebuild the library: `.venv/bin/python pipeline/publish.py --all`.

## Process phone uploads

```bash
.venv/bin/python pipeline/worker.py --interval 60   # during the demo; default 600 s stays in the free tier
.venv/bin/python pipeline/worker.py --retry <job_id>
```

## Run the app

```bash
cd app && npx expo start --clear
```

Scan the QR code with the iPhone camera (Expo Go installed, same Wi-Fi as the laptop). After changing
any `EXPO_PUBLIC_*` value in `app/.env`, restart with `--clear`.

## Known limits

- Uploads keep going when the app is in the background or the phone is locked (iOS background
  transfer). Swiping homecookd away in the app switcher cancels them; the app warns about this.
- The worker runs on the laptop, so phone uploads are processed only while it is running.
  TODO: move it to a server (PRD roadmap).
- Anyone with a recipe's link can view its media; the bucket itself can't be listed.

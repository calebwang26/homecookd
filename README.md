<div align="center">

# homecookd

**Grandma cooks once. Her grandkid cooks it anywhere, hearing her real voice.**

A family recipe app that keeps the person in the recipe and keeps the family talking.

Built at Cal Hacks 13.0 · [homecookd.app](https://homecookd.app) · Demo video: _(link)_

</div>

## Why homecookd?

**1. Recipes that keep the person.**
Family recipes were never written down. They live in our parents' and grandparents' hands and voices.
homecookd turns one cooking video into a step-by-step recipe, and every step plays her own clip.

**2. Connection across distance and language.**
Grandma can cook in Marathi without typing. Her grandkid follows along in English. When the kid gets
stuck, the question goes back to Grandma, so the recipe starts a conversation.

**3. Hands-free, voice-first.**
The kid's hands are covered in flour, so they cook by talking to **homie**, a voice guide that reads
steps, sets timers and plays Grandma's clip of that moment.

## How it works

<p align="center">
  <img src="docs/how-it-works.gif" alt="homecookd: how a family recipe travels from Grandma to her grandkid" width="100%">
</p>

1. **Grandma cooks. The recipe writes itself.** Gemini watches and translates her video, Muse Spark
   writes the recipe in English, Moss indexes every moment, and Convex shows it to the family live.
2. **The kid asks. Grandma answers.** Cartesia Ink 2 hears the question, Claude decides what to do, and
   Moss finds the moment she explained it. homie plays her real clip.
3. **Not in the video? Ask Grandma.** homie never makes up an answer. Convex sends the question to her,
   Cartesia transcribes her voice reply, and it shows up for the kid live.

## Overview

| Folder | What's in it |
| --- | --- |
| [`app/`](app/) | Expo / React Native iPhone app: Grandma records, the kid cooks by voice |
| [`voice/`](voice/) | Live voice service (homie) on Cloud Run: Cartesia Ink 2 + Sonic, Claude |
| [`convex/`](convex/) | Backend: families, recipes, questions, voice notes, live sync, Moss search |
| [`pipeline/`](pipeline/) | Python + ffmpeg video worker: cuts clips, runs Gemini and Muse Spark, publishes |
| [`glasses/`](glasses/), [`edible-glasses/`](edible-glasses/) | ESP32-S3 smart glasses and the VM that turns their stream into video |
| [`web/`](web/) | Next.js site on Vercel: landing page, recipe share pages, invites |
| [`cloud/`](cloud/) | Upload signer and Google Cloud setup scripts |

**Built with:** Cartesia (Ink 2, Sonic) · Claude · Gemini · Muse Spark (Meta) · Moss · Convex · Expo ·
Google Cloud · Vercel · ESP32-S3

## Voice with Cartesia

Voice is how both people use homecookd: the kid's hands are busy, and many grandparents would rather
talk than type, often not in English.

- **Ink 2 (live speech-to-text):** hears the kid while cooking, with built-in turn detection.
- **Ink (batch):** transcribes Grandma's voice-note answers.
- **Sonic 3.6 (text-to-speech):** homie's voice, streamed to the phone, with mood and speed set per line.
- **Localized voice:** homie speaks both English and Marathi in one voice.

First audio from Sonic arrives in about 120–250 ms.

## Quick start

**1. Add your keys.** Copy `.env.example` to `.env` and `app/.env.example` to `app/.env`, then fill in
your own keys. No keys are committed to this repo.

**2. Start the voice service (homie).**

```bash
cd voice && npm ci && npm run dev
```

**3. Start the app** in a second terminal, then scan the QR code with Expo Go on your iPhone.

```bash
cd app && npm ci && npx expo start --clear
```

More detail: [voice/README.md](voice/README.md) · [docs/PRD.md](docs/PRD.md) ·
[docs/build/STACK.md](docs/build/STACK.md)

## Privacy and responsibility

- **Grandma's words stay hers.** homie never presents its own words as hers; only her real clips are.
- **Private by default.** Recipes stay in the family until shared, one at a time.
- **No voice cloning without consent.** The demo uses a stock voice.
- **Approximate location only,** rounded to about 1 km.
- **No API keys in the app or this repo.**

## Known limitations

- Live listening with Ink covers 5 languages. Others (like Marathi) use Gemini Live, which is slower.
- The phone needs echo cancellation on, or homie hears itself.
- The video worker runs on a laptop for the hackathon.
- Voice cloning isn't built yet.

<details>
<summary><b>Developer notes: video pipeline</b></summary>

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

Setup: a Python `.venv` from `pipeline/requirements.txt`, ffmpeg, `gcloud auth login --update-adc`,
`cloud/grant-iam.sh`, `cloud/deploy-signer.sh`.

Process a video by hand:

```bash
.venv/bin/python pipeline/prep.py --id sunday-pancakes --title "Sunday Pancakes" --cook "Mom" --relation "Mom" input/pancakes/*.mov
.venv/bin/python pipeline/process.py --id sunday-pancakes
.venv/bin/python pipeline/publish.py --id sunday-pancakes
```

Process phone uploads: `.venv/bin/python pipeline/worker.py --interval 60`
(retry a job with `--retry <job_id>`).

If clips are out of order, `process.py` reorders them by content (tests: `pipeline/test_order.py`).
Check recipes with `pipeline/schema.py`; republish everything with `pipeline/publish.py --all`.

</details>

# homecookd

**Mom cooks. homecookd writes the recipe and keeps her voice.**

Family recipes live in our parents' hands and voices, not on paper. homecookd turns a parent's cooking
video into a recipe their kid can follow, then guides the kid through it by voice while they cook.

**Demo video:** _(link)_ · **Website:** [homecookd.app](https://homecookd.app)

## How it works

1. **Mom records.** She films herself cooking (phone or smart glasses). Our voice guide, **homie**, asks
   her a few questions in her own language.
2. **homecookd writes the recipe.** Each step is linked to the moment in the video where she did it.
3. **The kid cooks hands-free.** They say "next", "go back" or ask a question. homie answers, or plays
   Mom's own clip.
4. **Questions go home.** If homie can't answer, it asks Mom. Her voice-note reply goes back to the kid.

## Built with

| Part | Tools |
| --- | --- |
| Voice (listening + speaking) | **Cartesia** Ink 2 and Sonic |
| Cooking agent | **Claude** (Anthropic) |
| Video understanding, live translation | **Gemini** |
| Recipe writing | **Muse Spark** (Meta) |
| Finding the right clip | **Moss** |
| Backend and live updates | **Convex** (Supabase for sign-in) |
| Mobile app | Expo, React Native, TypeScript |
| Smart glasses | ESP32-S3, Google Compute Engine |
| Hosting and storage | Google Cloud Run, Cloud Storage, Vercel (Next.js site) |
| Video processing | Python, ffmpeg |

## Voice with Cartesia

Voice is how both people use homecookd: the kid's hands are busy, and many parents would rather talk
than type, often not in English.

- **Ink 2 (live speech-to-text):** hears the kid while cooking, with built-in turn detection.
- **Ink (batch):** transcribes Mom's voice-note answers.
- **Sonic 3.6 (text-to-speech):** homie's voice, streamed to the phone, with mood and speed set per line.
- **Localized voice:** homie can speak both English and Marathi in one voice.

First audio from Sonic arrives in about 120–250 ms.

## Run it

Copy `.env.example` to `.env` and `app/.env.example` to `app/.env`, then add your own keys.

```bash
# terminal 1: the voice service (homie)
cd voice && npm ci && npm run dev

# terminal 2: the app (scan the QR code with Expo Go)
cd app && npm ci && npx expo start --clear
```

More detail: [voice/README.md](voice/README.md) · [docs/PRD.md](docs/PRD.md) ·
[docs/build/STACK.md](docs/build/STACK.md)

## Privacy and responsibility

- **Mom's words stay hers.** homie never presents its own words as hers; only her real clips are.
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

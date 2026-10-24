# homecookd hackathon spec (Oct 11, 2026; formerly CLAUDE.md, now history: current rules are in AGENTS.md)

You are building **homecookd**, a hackathon prototype. homecookd turns a family member cooking into a recipe the family can follow: steps, "feel" amounts made concrete, stories told along the way, & what made the dish special, each linked to the exact moment in the video & the cook's own voice.

Time is short. Build only what is listed here, in the order given, & keep everything runnable at every step. When something is ambiguous, pick the simplest option that keeps the demo working & leave a `TODO:` comment.

---

## 1. Scope

### Build today (in priority order)
**P0 — the demo depends on these**
1. Python pipeline that turns recording files into a validated `recipe.json` + `play.mp4` + `voice.m4a` + `poster.jpg`.
2. Expo app with a **Family library** & a **Recipe card**, where every step has a **Watch** button (plays that step's video range) & a **Hear the cook** button (plays that step's audio range with the quote as a subtitle).
3. "What made it special" callouts & stories shown inline at their step.
4. Publish script that uploads media & JSON to a Supabase Storage public bucket & rebuilds `library.json`.
5. ~5 synthetic recipes so the library looks lived-in.

**P1 — only after every P0 item works on a real phone**
6. Follow-up questions in the pipeline output & a simple screen listing them.
7. Pre-cook prompt cards screen: 5 English prompts, each read aloud with `expo-speech`.

**P2 — only if time remains**
8. "~N hrs" wait dividers between recording sessions (from file creation times).
9. Library search by title & cook.

### Do NOT build
- Translation, multi-language UI, or any non-English processing. Everything is English. (Multi-language is a roadmap slide only.)
- In-app recording, live/real-time processing, or a live on-stage processing endpoint.
- A backend server, auth, accounts, sharing, payments.
- Anything for smart glasses or data licensing.

---

## 2. Demo content
- **Weed pancakes**: first-person footage narrated in English, recorded on an iPhone in **10–15 minute files** (HDR video off), AirDropped to the laptop. Multiple files = multiple sessions of one recipe.
- **Two YouTube cooking videos**: already downloaded as local files. Each is one session (offset 0). Set `source` in the recipe to credit the creator & show it in the app.
- **Synthetic recipes**: ~5, across 3 family members (e.g. Grandma, Dad, Aunt), marked `"sample": true`. They have no real media; use a poster image & let Watch/Hear show "Sample recipe — no video" gracefully.

---

## 3. Repo layout
```
homecookd/
  CLAUDE.md
  .env.example                 # GEMINI_API_KEY, GEMINI_MODEL, GEMINI_EXTRACT_MODEL, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET
  data/
    sample-recipe.json         # the contract; hand-written first (weed pancakes, 6 steps, 1 story, 2 specials, 3 questions)
    synthetic/*.json           # ~5 synthetic recipes in the same schema
    out/<recipe-id>/           # pipeline output: recipe.json, play.mp4, voice.m4a, poster.jpg, work/
  pipeline/
    requirements.txt           # google-genai, pydantic, python-dotenv, supabase
    schema.py                  # pydantic models (chunk + recipe) & timestamp validation
    prompts.py                 # extraction & merge prompts (section 6)
    prep.py                    # ffprobe inventory, AI copies, playback copies, concat, voice.m4a, poster
    process.py                 # parallel Gemini extraction, offsets, merge, validation -> recipe.json
    publish.py                 # upload to Supabase Storage, rebuild library.json
  app/                         # Expo (expo-router, TypeScript)
    app/_layout.tsx
    app/index.tsx              # Family library
    app/recipe/[id].tsx        # Recipe card + steps
    app/prompts.tsx            # Pre-cook prompt cards (P1)
    app/questions/[id].tsx     # Follow-up questions (P1)
    components/StepCard.tsx
    components/PlayerSheet.tsx # Watch / Hear bottom sheet
    lib/data.ts                # fetch library.json & recipes by URL; fall back to bundled JSON
    lib/types.ts               # TS types mirroring schema.py
    assets/data/               # bundled copies of library.json & every recipe.json (offline fallback)
    theme.ts
```

---

## 4. Data contract (source of truth: `pipeline/schema.py`; mirror it in `app/lib/types.ts`)

All times are **whole seconds from the start of the recipe's `play.mp4`**. One pair of numbers drives both Watch & Hear.

### Chunk output (one per recording file, returned by Gemini)
```json
{
  "chunk_index": 1,
  "events": [
    { "type": "step", "start_s": 42, "end_s": 118,
      "action": "Whisk the dry ingredients",
      "ingredients": [{ "name": "flour", "feel": "about two scoops", "estimate": "~1.5 cups" }],
      "sensory_cue": "until no dry streaks are left",
      "quote": "I never measure the flour, just two big scoops." },
    { "type": "story", "start_s": 130, "end_s": 175, "text": "My mom made these every Sunday..." },
    { "type": "special", "start_s": 190, "end_s": 205, "text": "Rests the batter 10 minutes", "why": "Most recipes cook it right away" }
  ]
}
```
Event fields not relevant to a type are optional/null. Times in a chunk are relative to that file.

### Recipe (what the app reads)
```json
{
  "id": "weed-pancakes",
  "title": "Sunday Pancakes",
  "cook": { "name": "Mom", "relation": "Mom" },
  "intro": "1–2 sentences written from her stories.",
  "servings": "4",
  "total_time": "~30 min",
  "sample": false,
  "source": null,
  "tags": ["breakfast"],
  "media": { "video_url": "https://.../play.mp4", "audio_url": "https://.../voice.m4a", "poster_url": "https://.../poster.jpg", "duration_s": 1800 },
  "sessions": [ { "index": 1, "recorded_at": "2026-10-11T10:02:00-07:00", "offset_s": 0, "duration_s": 900 } ],
  "ingredients": [ { "name": "flour", "feel": "about two scoops", "estimate": "~1.5 cups", "confidence": "medium", "first_seen_s": 42 } ],
  "steps": [ {
    "order": 1, "title": "Mix the dry ingredients",
    "instruction": "Whisk flour, sugar & baking powder in a large bowl.",
    "sensory_cue": "no dry streaks", "start_s": 42, "end_s": 118,
    "quote": "I never measure the flour...", "wait_after": null,
    "story_ids": ["s1"], "special_ids": ["x1"]
  } ],
  "stories": [ { "id": "s1", "step": 1, "start_s": 130, "end_s": 175, "title": "Sunday mornings", "text": "..." } ],
  "special": [ { "id": "x1", "step": 2, "start_s": 190, "text": "Rests the batter 10 minutes", "why": "..." } ],
  "follow_up_questions": [ { "id": "q1", "about_step": 3, "question": "How hot was the pan when the first pancake went in?" } ]
}
```

### Library index (`library.json`)
`[{ "id", "title", "cook_name", "relation", "poster_url", "tags", "sample", "recipe_url" }]`

### Validation rules (enforce in `schema.py`; reject & report, never silently fix)
- `0 <= start_s < end_s <= media.duration_s` for every step, story & special (special may omit `end_s`).
- `feel` is the cook's own words & is never replaced by `estimate`.
- `estimate` starts with `~` or equals `"unknown"`; `confidence` in `low | medium | high`.
- Steps ordered by `start_s`, `order` numbered from 1; every `story_ids`/`special_ids` entry exists; every story & special has a valid `step`.
- Synthetic recipes may have null media URLs.

---

## 5. Pipeline

### CLI
```bash
python pipeline/prep.py    --id weed-pancakes --title "Sunday Pancakes" --cook "Mom" --relation "Mom" input/pancakes_*.mov
python pipeline/process.py --id weed-pancakes            # reads data/out/weed-pancakes/work/manifest.json
python pipeline/publish.py --id weed-pancakes            # or --all to republish everything + synthetic
```
Make each script idempotent: skip steps whose outputs already exist unless `--force`.

### prep.py
1. `ffprobe` each input for duration & `com.apple.quicktime.creationdate` (fallback `format.tags.creation_time`, then file mtime). Sort by recording time. If any single input is over 15 min (e.g. a YouTube video), split its AI copy with `-f segment -segment_time 900 -reset_timestamps 1 -segment_list chunks.csv` & record each segment's start.
2. **AI copy** per file:
   `ffmpeg -i IN -vf "scale=-2:360,fps=1" -c:v libx264 -preset veryfast -crf 32 -c:a aac -ac 1 -ar 16000 -b:a 32k work/ai_NN.mp4`
3. **Playback copy** per file:
   `ffmpeg -i IN -vf "scale=-2:720" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 128k work/play_NN.mp4`
4. Concat playback copies in order (concat demuxer, re-encode not needed if params match) into `play.mp4` with `-movflags +faststart`. `offset_s` for file N = sum of durations of files before it (use the playback copies' probed durations).
5. `voice.m4a` = `ffmpeg -i play.mp4 -vn -c:a copy voice.m4a`.
6. Write `work/manifest.json`: `{id, title, cook, relation, source?, duration_s, sessions:[{index, recorded_at, offset_s, duration_s, ai_files:[{path, start_in_file_s}]}]}`.
7. Poster: placeholder from 20% into the video now; `process.py` regenerates it from the middle of step 2 once steps exist (`-ss <t> -frames:v 1 -q:v 3 poster.jpg`).

### process.py
1. Load `.env`. `GEMINI_MODEL` (Pro) for the merge; `GEMINI_EXTRACT_MODEL` defaults to `GEMINI_MODEL`. Log the wall time of each extraction call; if one 15-minute file takes > ~3 min, print a hint to set `GEMINI_EXTRACT_MODEL` to a Flash model.
2. Extract every AI file **in parallel** with `ThreadPoolExecutor`:
   - `client.files.upload(file=path)`; poll `client.files.get(name=...)` every 2 s until `state.name == "ACTIVE"` (fail on `FAILED`, timeout 5 min).
   - `client.models.generate_content(model=..., contents=[file, prompt], config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=ChunkOutput, temperature=0.2))`.
   - Parse into `ChunkOutput`. Retry once on any error or validation failure. If it fails twice, log the time range as "not processed" & continue.
   - Add `session.offset_s + start_in_file_s` to every timestamp; clamp end to the session end.
3. Save each chunk's raw & offset JSON to `work/` for debugging.
4. **Merge**: one text-only call with all offset events + the sessions list + the merge prompt, response schema = `Recipe` (without media/sessions; fill those from the manifest afterward).
5. Validate with pydantic. On failure, print the exact errors & save `recipe.invalid.json` for hand-fixing; don't write `recipe.json`.
6. Regenerate the poster from step 2, write `recipe.json`, print a summary: step count, each step's `start_s–end_s` & title (for hand spot-checks).

### publish.py
- Upload `play.mp4`, `voice.m4a`, `poster.jpg`, `recipe.json` to `SUPABASE_BUCKET/<id>/` with upsert & correct content types (`video/mp4`, `audio/mp4`, `image/jpeg`, `application/json`).
- Rewrite the recipe's `media.*_url` to the public URLs before uploading `recipe.json`.
- Rebuild `library.json` from every published recipe + `data/synthetic/*.json`, upload it to the bucket root.
- Also copy `library.json` & every `recipe.json` into `app/assets/data/` (the offline fallback).
- If an upload is rejected for size, print a hint to re-run prep with a higher playback `-crf` (e.g. 28).

---

## 6. Prompts (`pipeline/prompts.py`)

### Extraction (per file)
```text
You are watching a first-person video of a home cook making a family dish.
The cook narrates in English. This clip is file {i} of {n} of the recording.

Return every STEP, STORY and SPECIAL moment in this clip as JSON matching the schema.

For each step:
- start_s / end_s: whole seconds from the start of THIS clip, covering the action.
- action: one short imperative sentence.
- ingredients added: name; "feel" = the cook's exact words for the amount;
  "estimate" = your best US/metric estimate from what you SEE (hand size, spoon,
  pan, packaging), prefixed with "~", or "unknown" if you cannot see it.
- sensory_cue: what the cook looks, listens or smells for, in her words if she says it.
- quote: what she says during the step, verbatim.

For each story (people, places, memories, why the dish matters):
- start_s / end_s and text. Keep her voice; do not summarise.

For each special moment (a technique, ingredient or order that differs from how
this dish is usually made): start_s / end_s, text, and why it is unusual.

Rules: never invent ingredients or amounts you did not see or hear.
Ignore silence, idle waiting and off-topic talk. If an action continues past the
end of the clip, end it at the clip's last second.
```

### Merge
```text
You are given events extracted from {n} consecutive files of one cooking recording,
with timestamps already converted to seconds from the start of the full video,
plus the recording sessions with their real-world start times.

Produce one recipe matching the recipe schema:
- Merge steps that are the same action split across a file boundary.
- Merge repeated mentions of the same ingredient; sum amounts only if clearly separate additions.
- Order steps by start_s and number them from 1.
- Write each instruction so someone who never saw the dish could follow it.
  Keep sensory cues; they matter more than times.
- Attach each story and each special moment to the step it happened during or nearest to.
- Keep only the 2 to 3 strongest special moments.
- Write the intro from the stories in 1 to 2 sentences.
- Set wait_after on the last step before a gap between sessions (e.g. "overnight, ~10 hrs").
- List 3 to 5 warm follow_up_questions about real gaps: an amount marked unknown,
  a step with no clear end cue, an ingredient seen but never added.
Do not add steps, ingredients, stories or special moments that are not in the input.
```

---

## 7. App (Expo, expo-router, TypeScript)

### Setup
`npx create-expo-app@latest app` (default template with expo-router), then `npx expo install expo-video expo-audio expo-speech`. Fonts via `@expo-google-fonts/fraunces` & `@expo-google-fonts/inter` (fall back to system fonts if loading fails). Must run in **Expo Go on a real iPhone**; the iOS Simulator is the backup. Read the bucket base URL from `EXPO_PUBLIC_BUCKET_URL`.

### Data loading (`lib/data.ts`)
Fetch `library.json` & each `recipe_url`; on any network error fall back to the bundled JSON in `assets/data/`. Never crash on missing media; show a warm placeholder.

### Screens
1. **Library (`index.tsx`)**: "Our family table" greeting, a row of cook avatars (initials in a circle), then a 2-column grid of recipe cards (poster, title, "by {cook}"). Synthetic recipes show a small "sample" tag. Tap → recipe.
2. **Recipe (`recipe/[id].tsx`)**: poster with a play button (plays the whole video), title, "by {cook}", intro, total time & servings, `source` credit if present; **Ingredients**: `feel` large, `estimate` small underneath (show "to taste" when confidence is low); **Steps**: a `StepCard` per step; link to Follow-up questions (P1).
3. **StepCard**: number, title, instruction, sensory cue in italics, quote, buttons **Watch** & **Hear the cook**; stories in a tinted quote block; specials with a spoon icon & the accent color; a `wait_after` divider ("sleep on it: ~10 hrs") after the step when present.
4. **PlayerSheet**: bottom sheet (a `Modal` is fine). **Watch** uses `expo-video` (`useVideoPlayer` + `VideoView`): set `currentTime = start_s`, `play()`, listen to time updates (set `timeUpdateEventInterval` ~0.25 s) & `pause()` once `currentTime >= end_s`. **Hear the cook** uses `expo-audio` (`useAudioPlayer`): `seekTo(start_s)`, `play()`, poll/status-listen & pause at `end_s`; show the quote as a subtitle. Verify these APIs against the installed Expo SDK version & adapt if they differ.
5. **Prompts (`prompts.tsx`, P1)**: five large cards, each with a speaker button → `Speech.speak(text, { language: 'en-US' })`:
   - "Say the name of the dish & who taught you."
   - "Show every ingredient before you start."
   - "Say out loud when you add something & roughly how much."
   - "Tell us what you look, smell or listen for."
   - "Tell us any story this dish reminds you of."
6. **Questions (`questions/[id].tsx`, P1)**: list of `follow_up_questions` with the step they're about.

### Design (`theme.ts`)
- Cream background `#FBF6EE`, terracotta accent `#C8643B`, olive secondary `#7A7F4A`, warm brown text `#3B2A20`; dark mode cocoa `#221813` with cream text. One accent per screen.
- Fraunces (or Lora) for titles, Inter for body; body ≥ 17 pt.
- 16 pt rounded cards, no hard shadows, generous spacing, gentle fades, nothing bounces.
- Tap targets ≥ 48 pt; no gesture required to use the app.
- The cook's words are always shown, never only the AI rewrite. Estimates always show "~".
- Warm empty states: "No recipes yet. Ask someone what they made last Sunday."

---

## 8. Build order & checkpoints
1. Write `data/sample-recipe.json` & `pipeline/schema.py` first; validate the sample against the schema. Generate `app/lib/types.ts` to match.
2. App screens against the bundled sample (library, recipe, steps) — in parallel with the pipeline.
3. `prep.py` → test on a short generated clip (`ffmpeg -f lavfi -i testsrc=d=90 -f lavfi -i sine=d=90 ...`) & on YouTube video #1.
4. `process.py` on one file of YouTube #1 → hand-check 3 timestamps → full run.
5. `publish.py` → **checkpoint: YouTube #1 loads from the bucket in the app on a phone.**
6. PlayerSheet Watch & Hear, stories & specials inline.
7. Pancake files & YouTube #2 through the pipeline; publish; synthetic recipes; rebuild library.
8. P1: follow-up screen, prompt cards. P2 only if time remains.
9. **Feature freeze**: final JSON & media bundled locally; nothing new after this.

Cut order if behind: library search → follow-up screen → prompt cards → wait dividers → YouTube #2 → synthetic recipes beyond 3. **Never cut** Watch, Hear the cook, or special callouts.

---

## 9. Done means
- `python -c "from pipeline.schema import Recipe; ..."` validates every `recipe.json` & synthetic file.
- For each real recipe, 3 hand-checked steps: Watch lands within 10 s of the action, including a step from the 2nd+ file of the pancakes.
- On a real iPhone in Expo Go: the library shows 3 real + synthetic recipes; Watch plays only the step's range; Hear plays the matching words; stories & specials appear in the right steps; the app still works with the network off (bundled fallback).
- Secrets never in the app bundle: no Gemini or Supabase service key in `app/`.

## 10. Conventions
- Python 3.11+, type hints, `pathlib`, no notebooks. Fail loudly with clear messages.
- Keep the Gemini key & Supabase service key in `.env` (gitignored); commit `.env.example` only.
- Small, readable files; no premature abstraction. Comments only where intent isn't obvious.
- English only everywhere.

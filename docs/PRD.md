# homecookd — Product Requirements Document

Oct 11, 2026 · @Caleb

## Overview

homecookd turns a family member cooking into a recipe the family can actually follow: steps, "feel" amounts made concrete, the stories told along the way, & what made the dish special. Every piece links to the exact moment in the video & the cook's own voice, & the cook never types anything.

**One-liner:** Mom cooks. homecookd writes the recipe & keeps her voice.

**Problem.** Immigrant family recipes are rarely written down. They live in phrases like "a handful," "until it smells right" & "you'll know," & in a parent's hands. Children who grew up eating these dishes often can't cook them.

- **Recipes run on feel.** Amounts & doneness are judgment calls that never make it into a written recipe.
- **Cooking takes too long to transcribe.** Overnight soaks & 10-hour simmers make typing along or calling for the whole cook impractical, especially for elderly parents.
- **Language & distance.** Grandparents often live far away & narrate in another language, so recipes die at the immigrant generation.

**Why now.**

- Multimodal models like Gemini read long video with audio directly & return structured output, so a cooking session becomes a recipe in minutes.
- Head-mounted cameras & phones on head straps make first-person cooking footage easy to capture.

**Fit with the hackathon prompt** (build something that helps family & friends): homecookd preserves family culture across generations & gives adult children a concrete way to connect with their parents.

## Goals, non-goals & success metrics

Today's goal is three real cooking videos turned into convincing recipe cards on a phone, with the cook's voice playable at every step, done by 2:00pm. The demo dish is weed pancakes, narrated in English, plus two cooking videos from YouTube run through the same pipeline.

### Goals (today)

- Process the weed pancake footage & 2 YouTube videos into validated recipe JSON.
- Show each recipe in an Expo app (Expo Go on an iPhone, iOS Simulator as backup) with steps, feel amounts, a Watch button & a Hear the cook button per step.
- Show "What made it special" callouts & stories inline at the step where they happened.
- Show a family library with the 3 real recipes plus synthetic recipes from other family members.

### Goals (product)

- A cook records a dish with zero typing & no help after first setup.
- A family builds a shared archive of dozens of recipes over months.
- A recipe is followable by someone who never watched the dish being made.

### Non-goals today

- Translation or any non-English processing. Multi-language narration is pitched as a capability on the roadmap slide only; everything built today is English.
- In-app recording or real-time processing on the phone.
- Smart-glasses hardware.
- A backend server, user accounts, auth, sharing or payments.
- A live on-stage processing run.
- Selling or licensing any footage.
- App Store distribution.

### Success metrics

| Metric | Today's target | Product target |
|---|---|---|
| Steps captured vs. a human watching the video | ≥ 80% | ≥ 90% |
| Step timestamps land on the right moment | within 10 s | within 5 s |
| Processing time for 60 min of video | under 5 min | under 10 min, in background |
| Cook's effort per recipe | press record, press stop | same |
| Family members who open a recipe in week 1 | demo only | 3+ per family |
| Recipes cooked by a child from the card | demo only | 1 per family in month 1 |

## Personas & user journey

homecookd has two users: the cook, who never sees the app's complexity, & the adult child, who sets it up & reads the result.

| | The cook | The adult child | Extended family |
|---|---|---|---|
| Who | Parent or grandparent, cooks daily, often lives far away | 20s–30s, grew up eating the food, can't cook it | Siblings, cousins, aunts in several places |
| Tech comfort | Video calls & messaging; avoids forms | High | Mixed |
| Wants | Her food remembered; to be asked about it | To cook the dish & keep her voice | To find & share family dishes |
| Pain today | Being asked "how much?" with no real answer | Recipes over the phone are vague & get lost | No single place where family recipes live |
| What homecookd asks | Wear the camera, press record, cook & talk | Set up the camera, transfer the files, check the recipe | Browse & cook |

**Design rule:** every action the cook takes is one tap or zero, & nothing she says is ever thrown away.

### Journey

1. **Before cooking (child, ~5 min).** Mount the iPhone on a head strap (or clip a camera to glasses) so the counter & stove are in frame, & turn off HDR video. The app shows 5 pre-cook prompt cards, read aloud: say the dish & who taught you; show every ingredient first; say roughly how much as you add it; say what you look, smell or listen for; tell any story the dish reminds you of.
2. **Cooking (cook, length of the dish).** Record in 10–15 minute files & cook normally while narrating. For long waits, stop & record again at the next active moment.
3. **Processing (child or team, minutes).** AirDrop the files to a laptop. The pipeline makes a small AI copy & a playback copy of each file, runs every file through Gemini in parallel, & merges the results into one recipe.
4. **Reading & cooking (whole family).** Open the recipe card: feel amounts with estimates, steps in order, Watch to play that step's video, Hear the cook for her words, stories & special callouts inline. The recipe sits in the family library next to everyone else's dishes.

## Functional requirements

P0 items make the demo, P1 items make it stand out, & P2 items are roadmap. Build strictly in that order: no P1 work starts until every P0 item works on a real phone.

| ID | Area | Requirement | Priority | Done when |
|---|---|---|---|---|
| C1 | Capture | First-person recording in 10–15 min files on a head-mounted iPhone, HDR off | P0 | Counter & hands visible in ≥ 80% of frames |
| S1 | Pipeline | Per file: AI copy (360p, 1 fps, 16 kHz mono) & 720p playback copy | P0 | Both copies match duration within 1 s |
| S2 | Pipeline | Gemini extraction per file, all files in parallel | P0 | Output validates against the chunk schema with no manual fixes |
| S3 | Pipeline | Concat playback copies in recorded order; add each file's start offset to its timestamps | P0 | Watch lands within 10 s of the action, including in later files |
| S4 | Pipeline | Merge pass into one recipe: dedupe, order, attach stories, write intro | P0 | No duplicate steps at file boundaries; steps in time order |
| S5 | Pipeline | Feel amount + "~" estimate + confidence per ingredient | P0 | Every ingredient has both, or an explicit "unknown" |
| S6 | Pipeline | "What made it special": 2–3 items that differ from a standard version of the dish | P0 | Each tied to a step & timestamp |
| A1 | App | Recipe card: cover, title, cook, intro, ingredients, steps | P0 | Renders real recipe JSON on an iPhone |
| A2 | App | Watch: play the video from a step's start to its end | P0 | Starts within 1 s of start_s, pauses at end_s |
| A3 | App | Hear the cook: play the same range of her audio, with her quote as a subtitle | P0 | Plays the right words for that step |
| A4 | App | Stories inline in their step; special callouts highlighted | P0 | Every story & special is attached to a step |
| A5 | App | Family library grouped by cook | P0 | 3 real recipes + ~5 synthetic, from 3+ family members |
| S7 | Pipeline | Follow-up questions about real gaps | P1 | 3–5 questions, each tied to a step or ingredient |
| A6 | App | Pre-cook prompt cards, read aloud | P1 | 5 English prompts; audio plays on tap |
| A7 | App | Follow-up questions screen (text only) | P1 | Lists S7's questions per recipe |
| S8 | Pipeline | Waits between recordings from file creation times | P2 | "~N hrs" divider shown between steps |
| A8 | App | Library search | P2 | Filters by title & cook |
| A9 | App | Multi-language narration & UI | P2 | Roadmap only; pitched, not built |

## Technical architecture & video pipeline

The pipeline is a Python script on a laptop; the app only reads finished JSON & video from a public storage bucket. The Gemini key never ships in the app, & a bundled copy of every recipe JSON is the offline fallback.

The AI path & the playback path start from the same files, so the merged timestamps line up with the video & audio the app plays.

### Stack

| Layer | Choice today | Why |
|---|---|---|
| Capture | iPhone on a head strap, or a camera clipped to glasses | First-person view of hands & pan; nothing to build |
| Transfer | AirDrop to the laptop | Zero setup, far faster than any cloud upload |
| Video processing | ffmpeg & ffprobe | One command per copy |
| AI | Gemini via the File API, JSON output with a response schema | Reads video & audio natively at about 1 frame per second |
| Orchestration | Python + google-genai SDK + ThreadPoolExecutor | Files run in parallel |
| Validation | pydantic | Rejects malformed output & bad timestamps |
| Storage | Supabase Storage public bucket | The app streams video & loads JSON by URL |
| App | Expo (React Native), expo-router, expo-video, expo-audio, expo-speech | Runs in Expo Go on a real iPhone or in the Simulator |

**Model choice.** Read the model name from `GEMINI_MODEL`. Use the team's Pro model for the merge. Time one extraction on Pro first; if a 15-minute file takes over ~3 minutes, run extraction on the current Flash model & keep Pro for the merge. The pipeline needs a Gemini API key from Google AI Studio; a Gemini app subscription alone doesn't include API access.

### Pipeline, per recipe

1. **Inventory.** ffprobe each source file for duration & `com.apple.quicktime.creationdate` (fallback `creation_time`). Sort by recording time. A YouTube video is one file with offset 0; split it only if it runs over 15 min (`-f segment -segment_time 900 -segment_list chunks.csv`).
2. **AI copy per file:**
   ```
   ffmpeg -i in.mov -vf "scale=-2:360,fps=1" -c:v libx264 -preset veryfast -crf 32 -c:a aac -ac 1 -ar 16000 -b:a 32k ai_NN.mp4
   ```
3. **Playback copy per file:**
   ```
   ffmpeg -i in.mov -vf "scale=-2:720" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k play_NN.mp4
   ```
4. **Concat & audio.** Concat the playback copies in order into one `play.mp4` with `-movflags +faststart`. Each file's `offset_s` is the sum of the durations before it. Extract `voice.m4a` from `play.mp4` with `-vn -c:a copy`. Grab a poster frame from a good step with `-ss <t> -frames:v 1`.
5. **Extraction in parallel.** For each AI copy: upload with the File API, poll until the file is ACTIVE, call the model with the extraction prompt & chunk schema at temperature 0.2, & ask for whole seconds from the start of that file. Retry a failed file once; if it fails again, mark that range "not processed" rather than failing the recipe. Add the file's `offset_s` to every timestamp.
6. **Merge.** One text-only call takes every file's events plus the session list & returns the recipe JSON. Validate with pydantic (`0 ≤ start_s < end_s ≤ duration`) & write `recipe.json`.
7. **Publish.** Upload `play.mp4`, `voice.m4a`, the poster & `recipe.json` to the bucket, then rebuild `library.json`.

In the app, Watch seeks the video player to `start_s`, plays, & pauses once playback passes `end_s`. Hear the cook does the same on `voice.m4a`. Both come from the same source, so one pair of timestamps drives both.

## Data model

There are two schemas: a small one each file returns & the final recipe the app reads. All times are whole seconds from the start of the recipe's `play.mp4`, so one number drives both Watch & Hear the cook. Agree on these in the first 15 minutes so the pipeline & app can be built in parallel.

### Chunk output (one per recording file)

```json
{
  "chunk_index": 1,
  "events": [
    {
      "type": "step",
      "start_s": 42, "end_s": 118,
      "action": "Whisk the dry ingredients",
      "ingredients": [{ "name": "flour", "feel": "about two scoops", "estimate": "~1.5 cups" }],
      "sensory_cue": "until no dry streaks are left",
      "quote": "I never measure the flour, just two big scoops."
    },
    { "type": "story", "start_s": 130, "end_s": 175, "text": "My mom made these every Sunday..." },
    { "type": "special", "start_s": 190, "end_s": 205, "text": "Rests the batter 10 minutes", "why": "Most recipes cook it right away" }
  ]
}
```

### Recipe (what the app reads)

```json
{
  "id": "weed-pancakes",
  "title": "Sunday Pancakes",
  "cook": { "name": "Mom", "relation": "Mom" },
  "intro": "One or two sentences written from her stories.",
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

**Library index** (`library.json`): a list of `{ id, title, cook_name, relation, poster_url, tags, sample, recipe_url }`, including the synthetic recipes.

### Field rules

- `feel` is always the cook's own words & is never replaced by the estimate.
- `estimate` starts with "~" & carries a `confidence` of low, medium or high; low shows as "to taste" in the app.
- Every time satisfies `0 ≤ start_s < end_s ≤ duration_s`; the pipeline rejects anything else.
- `sample: true` marks synthetic recipes; `source` credits the creator of a YouTube video.

## AI prompt specifications

The demo's quality depends on these two prompts, so the AI owner tests them on real footage before touching anything else. Both calls use JSON output with a response schema so the output parses every time.

### Extraction prompt (one per file: video in, chunk JSON out)

```
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

### Merge prompt (all chunk JSON in, recipe JSON out)

```
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

**Settings:** temperature 0.2 for extraction & the default for the merge. Run one file first, check its timestamps by hand against the video, then run all files.

### Evaluation checklist (on the real footage)

- [ ] Every step a human sees is present
- [ ] Each step's Watch lands on the right action within 10 s
- [ ] Feel words are the cook's real words, not paraphrased
- [ ] No invented ingredients
- [ ] Stories & specials sit on sensible steps

## Design & UX guidelines

homecookd should feel like a handwritten recipe box in a warm kitchen, not a productivity app: few elements, soft colors, & the cook's hands & voice at the center.

| Element | Guideline |
|---|---|
| Palette | Cream background #FBF6EE, terracotta accent #C8643B, olive secondary #7A7F4A, warm brown text #3B2A20; one accent per screen |
| Type | Warm serif for titles (Fraunces or Lora), Inter for body; body at least 17 pt |
| Shape | 16 pt rounded cards, subtle paper grain, no hard shadows |
| Imagery | A still from the cook's own video as each cover; her hands, not stock food |
| Icons | Simple line icons; a small spoon marks special callouts |
| Motion | Gentle fades; cards lift slightly on tap; nothing bounces |
| Dark mode | Deep cocoa #221813 with cream text; keep the terracotta accent |

### Screens

1. **Family library (home).** "Our family table" greeting, a row of cook avatars, then a 2-column grid of recipe cards with the cover still, title & cook. Synthetic recipes carry a small "sample" tag.
2. **Recipe card.** Cover still with a play button, title, "by Mom", intro line, total time & servings, then ingredients with the feel words large & the estimate small underneath.
3. **Steps.** One card per step: number, title, instruction, sensory cue in italics, & two buttons, Watch & Hear the cook. Stories sit in a tinted quote block inside their step; special callouts get the spoon icon & the accent color. Waits between sessions show as a divider.
4. **Player sheet.** A bottom sheet that plays the step's clip with the cook's quote as a subtitle line.
5. **Pre-cook prompts (P1).** Five large cards, each with a speaker button that reads the prompt aloud.
6. **Follow-up questions (P1).** A short list of warm questions to send back to the cook.

### UX rules

- The cook's words are always shown, never only the AI's rewrite.
- Estimates say "~" & never pretend to be exact.
- Tap targets are at least 48 pt, & no gesture is required to use the app.
- Empty states are warm: "No recipes yet. Ask someone what they made last Sunday."

## Build plan

Build the pipeline & the app in parallel against a hand-written sample recipe, connect them at T+1:00, & freeze features at T+1:40 so the team is done by 2:00pm. T0 = 2:00pm minus the time you have; the plan assumes a 2h15m budget.

### Roles (4 people; with 3, the pitch role is shared)

| Role | Owns | First 15 minutes | T+0:15 to T+1:00 | T+1:00 to T+1:40 |
|---|---|---|---|---|
| AI | Pipeline scripts, prompts, schema, merge, eval | Install google-genai & pydantic, confirm ffmpeg, verify the API key & Pro model name with one tiny call | prep script; run one YouTube file on Pro; check 3 timestamps by hand; tune the prompt; add parallel runs, merge & validation | Run the pancake files & YouTube #2; run the eval checklist; hand-fix the worst timestamps in the JSON |
| App | Expo screens, player sheet, theme | create-expo-app with expo-router; install expo-video, expo-audio, expo-speech; open in Expo Go | Theme, library grid, recipe card & step cards against the sample JSON | Player sheet with Watch & Hear, stories & specials inline, then the follow-up screen |
| Data & glue | Sample JSON, bucket, publish script, synthetic recipes, posters | Write the sample recipe (6 steps, 1 story, 2 specials, 3 questions); create the public bucket | Publish script; ~5 synthetic recipes across 3 family members; posters; prompt cards screen | Publish all 3 real recipes; rebuild library.json; bundle every JSON in the app as a fallback |
| Pitch | Footage, slides, script, rehearsal | Start recording the pancakes in 10–15 min files, HDR off | AirDrop each file as it finishes; build the slides | Real screenshots into the slides; write the 3-minute script |

### Checkpoints

- [ ] T+0:15 — sample JSON agreed, API key verified, app open on a phone
- [ ] T+1:00 — YouTube recipe #1 loads from the bucket into the app end to end; if not, everyone helps until it does
- [ ] T+1:40 — feature freeze; final JSON & videos saved locally
- [ ] T+2:15 — two full rehearsals on the venue wifi & a backup screen recording

**Cut order if behind:** library search → follow-up screen → prompt cards → waits between sessions → YouTube #2 → synthetic recipes beyond 3.

**Never cut:** Watch, Hear the cook & the special callouts.

## Demo script (3 minutes)

The pitch opens with the team's own family food & lands on one moment: tapping a step & hearing the cook explain it.

1. **Hook (25 s).** Personal photos of family food. "Our family recipes live in 'a handful' & 'you'll know.' Our grandparents live far away, sometimes speak another language, & the recipes die with that generation."
2. **The problem (20 s).** Recipes run on feel, & real dishes take overnight soaks & 10-hour simmers, so typing them down or staying on a call the whole time doesn't work.
3. **Capture (20 s).** Ten seconds of first-person pancake footage. "Nobody typed anything. We just cooked & talked."
4. **The result (50 s).** Open the recipe card on the phone. Show a feel amount & its estimate, tap Watch on a step to jump to that moment, then Hear the cook.
5. **What made it special (20 s).** Show a special callout & a story attached to its step. Let it land.
6. **Family library (15 s).** Scroll the shelf of recipes by cook.
7. **How it works (15 s).** One slide: AirDrop, small AI copies, parallel Gemini calls, merge.
8. **Roadmap (15 s).** Multi-language narration (narrate in Urdu, Mandarin or Spanish, read in English), multi-session overnight recipes, a printed cookbook with voice QR codes, smart glasses & opt-in data licensing.
9. **Close.** Tie into preserving culture through food, including venture's own culture, then the special guest eats the pancakes.

## Business model, consent & privacy

homecookd earns from families first & from data only by explicit opt-in, because the product depends on a cook trusting it with her kitchen & her voice.

| Stream | What the customer pays for | Price idea | Notes |
|---|---|---|---|
| Keepsake cookbook | A printed book of family recipes, each with a QR code that plays the cook's voice | $49–$99 per book | Gift moments: holidays, weddings, Mother's Day |
| Family plan | Unlimited recipes & video storage, more family members, private archive | ~$5 per month per family | Video storage is the main cost |
| Opt-in cooking data licensing | First-person cooking footage licensed to AI & robotics teams | Revenue share with the family | Explicit, revocable consent per recipe; never on by default |
| Capture hardware partnership | Smart glasses or head-mount bundles | Affiliate or bundle margin | Better footage; not built by homecookd |

### Consent rules for data licensing

- Off by default; a family turns it on per recipe after a plain-language explanation.
- The cook must agree herself, not only the child who set up the account.
- Faces & identifying audio (names, addresses) are removed before any licensing.
- Families can withdraw consent, & withdrawn footage is excluded from future deals.
- Payouts & which buyers licensed the data are visible to the family.

### Privacy basics

- Recipes are private to the family unless shared.
- Video sent to the AI provider is used only for processing; the app states the provider's data-retention terms.
- Other people in frame, including children, are kept out of stories unless the family keeps them.

## Risks & roadmap

The biggest risk today is AI output quality on real footage; the fallback for every other risk is the saved demo recipe & a screen recording.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gemini timestamps off by more than 10 s | Medium | High | Whole seconds per file; spot-check by hand; nudge the worst ones in the JSON before the demo |
| Pro model too slow for extraction | Medium | Medium | Time one file first; switch extraction to Flash, keep Pro for the merge |
| Steps cut in half at file boundaries | High | Low | The merge prompt joins steps across boundaries |
| Feel estimates wrong | Medium | Medium | Always show the cook's words first; "~" & a confidence level on every estimate |
| Venue wifi slow or down | Medium | High | Process early; bundled JSON in the app; screen recording backup; phone hotspot |
| Expo Go struggles with large videos | Medium | Medium | Stream faststart files from the bucket; Simulator as backup |
| iPhone HDR footage looks washed out | Medium | Low | Turn off HDR video before recording |
| YouTube videos raise questions | Low | Medium | Credit the creators on screen & mark them as samples |
| Judges question selling family data | Medium | Medium | Present it as opt-in with revenue share; lead with the cookbook |
| Pancakes eaten on site | Medium | High | Keep what the guest eats THC-free (venue rules & under-21 teammates) |

### Roadmap

| When | What ships |
|---|---|
| Today | Three real recipes end to end, family library with synthetic data, Watch, Hear the cook & special callouts |
| Next 2 weeks | Multi-session recipes with computed waits, follow-up questions with voice answers |
| Next 1–3 months | Multi-language narration & UI, in-app recording with background upload, a server pipeline, accounts & family sharing |
| Next 3–6 months | Printed keepsake cookbook, adjustable servings, more languages |
| Later | Smart-glasses capture, opt-in data licensing program, family tree view of recipes across generations |

## Open questions

- Single recording session for the pancakes, or a second short session to show a wait?
- iPhone on a head strap or a camera clipped to glasses? This decides file format & the HDR setting.
- Is the follow-up questions screen in the demo, or roadmap only?

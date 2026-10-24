# Real-app screen recordings for the lander

Clips of the **real homecookd Expo app** (the same `app/` source, rendered by react-native-web from the
running dev server at `http://localhost:8081`). No UI was built or mocked for these clips. All of them are in
`web/public/media/app/`, and each has a poster JPG with the same name.

The lander's app tour ("The app", `#see-it-work`) plays four short clips, about 5 s each, one per row:
`app-add` (7), `app-recipe` (8, re-recorded), `app-watch` (9) and `app-keep` (10). They are described under
**Tour clips** below. The older, longer clips 1 and 3–6 stay in the folder: `app-library` plays in the recipe
box (StepsToBox), `app-questions` in Questions, and `app-record-add.jpg` (a still from `app-record`) in
StepsToBox. **`app-watch` plays a Pexels stock video inside the real Watch sheet, standing in for a family
recording** (see clip 9).

## Format (all clips)

| | |
|---|---|
| Size | 780 × 1688 px (390 × 844 pt at @2x, iPhone 12–14 logical size, 19.5:9). Captured at @3x and downscaled with lanczos. |
| Video | H.264 High, yuv420p, BT.709 limited range, CRF 24, 30 fps CFR, no audio, `+faststart` |
| Loops | Every clip starts on a still frame. `library`, `share` and `questions` also end where they started, so they loop cleanly. |
| Device chrome | Each frame includes an iOS-style status bar (9:41, signal, Wi-Fi, battery) and a home indicator, like a real iPhone screen recording. The app runs with the matching safe areas (top 47 pt, bottom 34 pt). **The phone frame should not add a second status bar.** A notch or Dynamic Island overlay is fine; the time sits left and the icons sit right, as on a notch iPhone. Screen corner radius for the frame is about 47 pt. |
| Touch indicator | A soft white circle (44 pt) shows each tap and drag, like iOS "Show touches". It is a recording aid drawn over the page and is not part of the app UI. |
| Posters | `app-*.jpg`, 780 × 1688, chosen from still moments with no touch circle. |

Embed snippet: `<video src="/media/app/app-library.mp4" poster="/media/app/app-library.jpg" autoplay muted loop playsinline preload="metadata">`

## Content curation (what was filtered and changed)

The library was curated by intercepting network responses in the recording browser over the DevTools
Protocol. No file under `app/` was modified, and the bucket and the published data were not touched.

- **Removed from `library.json`** (5 entries): `weed-steak` (Weed Steak, Miles/Uncle), `chicken-biryani` (YouTube, Auntie Bumbi), `gordon-stir-fry`, `gordon-gnocchi`, `gordon-cheesecake` (Gordon Ramsay, YouTube). Requests for those `recipe.json` files and their posters were also refused.
- **Kept** (5): Auntie Lin's Scallion Pancakes, Dad's Grilled Fish with Ginger-Scallion Sauce, Dad's Sunday Chili, Grandma's Hand-Pulled Noodle Soup, Grandma's Red-Braised Pork Belly. These are the synthetic family recipes from `data/synthetic/`.
- **Sample labels removed:** all five kept recipes are synthetic (`"sample": true`), so the app would label them "sample", "A sample from…" and "Sample recipe". For marketing, `sample` was set to `false` in the intercepted JSON. The app then shows its normal real-recipe UI ("New from Dad", "Grandma's latest", the "family favourite" sticker) and no "sample" labels. **These are illustrative demo recipes, not real users' families.** The lander should not present them as customer stories. If you want the faithful version with the sample labels, re-run with `keepSampleTags: true` (see Re-running).
- **No team-recorded recipe was used.** The candidates in `data/out/` with `source: null` (`test-eggs*`, `test-batch`, `test-twodish`, `test-upload-eggs-*`, `oatmeal-*`) contain test-pattern footage or a 7-second clip and are not in the published library, so none of them is usable in marketing.
- **Dev-build overlays were hidden** (tour clips 7–10): Expo's dev server shows a small lightning badge
  bottom-left while it lazily loads a module (`.__expo_fast_refresh`) and a LogBox badge (`#error-toast`).
  Neither exists in the phone app, so `inpage.js` hides both.
- **One web-only notice was hidden.** The upload screen on web shows "Uploads work from the homecookd app on your phone. This web preview can't send videos in the background." The phone app never shows this, so that one card was hidden with `display:none` while recording (in the `record` clip only).
- **Posters** were served from `data/synthetic/posters/*.jpg`, which are byte-identical to the bucket copies (md5 checked). This made them load instantly; the remote posters also loaded fine. JSON was fetched once from the bucket, curated, and served from memory.
- **Safety:** every non-GET/HEAD request was set to fail. None was attempted. No form was submitted. In clip 7
  two local video files were picked through the app's own file input (answered over CDP); nothing was uploaded,
  and the Upload button was never tapped. In the `share` clip, `navigator.share` was replaced with a no-op that only records its payload.

## Clips

Times are seconds into the clip. A tap's circle appears about 0.25 s before the press.

### 1. `app-library.mp4`: store (12.2 s, 1.29 MB)
- 0–1.0: the family table at rest: "Welcome back, the family", **"Our *family* table"**, cook chips (Everyone · Auntie Lin · Dad · Grandma), Auntie Lin's Scallion Pancakes featured, recipe rows beneath, and the floating "Add a recipe" pill.
- 1.0–2.6: slow drag up through the tinted recipe rows (fish, chili, noodle soup, red-braised pork) to the "Before they cook · 5 things to say on camera" card.
- 2.6–3.8: hold at the bottom.
- 3.8–5.3: scroll back to the top.
- 5.8–6.3: tap **Dad**. The featured card becomes "New from Dad · Dad's Grilled Fish…" with Dad's Sunday Chili below.
- 8.1–8.5: tap **Grandma**. The featured card becomes Grandma's Hand-Pulled Noodle Soup ("Grandma's latest") with her Red-Braised Pork Belly below.
- 10.3–10.7: tap **Everyone**. Back to the opening frame, so the clip loops.
- Caption: *"Every recipe your family makes, kept in one place."* Alt: *"Grandma's, Dad's, Auntie's. All at one table."*

### 2. `app-recipe.mp4`, first version (replaced by clip 8 on Oct 13; this timeline is kept for reference)
- 0–0.8: family table at rest.
- 0.8–1.3: tap **Grandma**. The noodle soup becomes the featured card.
- 2.4–2.9: tap the featured card, which opens **Grandma's Hand-Pulled Noodle Soup** (poster, "family favourite" sticker, "by Grandma · ~1 hr 15 min", intro, her signed quote).
- 4.5–6.0: scroll to the **Ingredients** tab. Her words are shown large with the estimate small on the right: "two heaping rice bowls, maybe a little more" (~3 cups), "a pinch in the palm, two fingers worth" (to taste), "warm like a baby's bath, a little at a time until it comes together" (~1 cup), "rub a little on your hands and a little on top", "the pot from this morning, filled up to about here" (~6 cups), "three coins, this thick" (~3 thin slices).
- 6.8–7.3: check off **flour** (olive check, strikethrough).
- 8.0–8.5: check off **salt**.
- 8.5–10.7: hold.
- Caption: *"'A handful' becomes something you can follow. Her words stay, with an estimate beside them."* Alt: *"Two heaping rice bowls ≈ 3 cups."*

### 3. `app-cook.mp4`: cook mode, step by step (13.4 s, 1.25 MB)
- 0–0.9: Dad's Sunday Chili, **Step 1 of 7 · "Brown the beef hard"**: big photo, instruction with the sensory cue highlighted in yellow ("a dark crust on the bottom, edges crackling, fat pooling around the meat"), ingredient chip "ground beef · the whole big family tray from the store", progress bar, and the bottom bar (back · **Hear Dad** · next).
- 0.9–2.0: scroll to the step's pills.
- 2.1–2.6: tap **"The first pot"**. Dad's story opens: *"My first apartment had one pot and one burner. I made chili because it was cheap and it made the whole place smell like somebody lived there…"*
- 3.1–5.8: scroll and hold on the story.
- 5.8–6.3: tap **next**, which goes to Step 2 "Soften the onion, then the garlic".
- 7.0–7.5: tap **next**, which goes to Step 3 "Toast the spices with the bean paste" (the cue "the oil turns brick red…" is highlighted).
- 8.4–9.6: scroll down.
- 9.7–10.2: tap **"What made it special"**. The rose panel opens: "Stirs a spoon of Grandma's chili bean paste into the spices. Most chili recipes use only chili powder; the fermented, salty paste adds a deep bottom note the family says tastes like home."
- 10.6–13.4: scroll and hold.
- Caption: *"One step at a time, with the story behind it."* Alt: *"Cook it the way Dad does, down to Grandma's secret spoonful."*

### 4. `app-share.mp4`: the share moment (8.8 s, 0.68 MB)
- 0–1.1: Grandma's Red-Braised Pork Belly at the top, with the back and **share** buttons in the top bar.
- 1.1–2.5: scroll to the intro ("This is the dish Grandma makes when someone is coming home…") and her signed quote ("The first time I made this, I burned the sugar three times. Three!…" / "— Grandma, with love").
- 2.5–4.1: hold.
- 4.2–5.4: scroll back to the top.
- 6.1–6.5: **tap Share** (top right). The touch circle and the button's press state show.
- 6.5–8.8: hold.
- **Limitation:** on the web build the native iOS share sheet cannot render, so after the tap the screen does not change. The real payload the app hands to the share sheet was captured: **`"Grandma's Red-Braised Pork Belly by Grandma — from our family table"`** (text only, no link). It could be shown truthfully next to the phone, for example as a message bubble, but any share sheet drawn on the lander would be built by us and not recorded.
- Caption: *"Send Grandma's recipe to everyone who misses it."*

### 5. `app-record.mp4`: "set up your camera, record, done" (12.6 s, 0.23 MB)
- 0–0.7: **Before they cook · 1 of 5**. Speech bubble: "Say the name of the dish & who taught you." Pot mascot ("asking for you, gently"), Play aloud, Next.
- 0.7–1.2: tap **Play aloud**. The button turns olive and reads "Stop" while the prompt is read with text-to-speech (the clip has no audio).
- 2.3, 3.3, 4.4, 5.4: tap **Next** four times: "Show every ingredient before you start." → "Say out loud when you add something & roughly how much." → "Tell us what you look, smell or listen for." → "Tell us any story this dish reminds you of." The 5-segment progress bar fills.
- 6.7–7.1: tap **Upload the videos** (olive), which opens **Add a recipe** ("Pick the videos of someone cooking… in their own words").
- 7.9–10.0: tap "What's the dish?" and type **"Sunday dumplings"**.
- 10.1–10.5: tap the **Grandma** chip under "Who's cooking?". This fills in the name and selects "They are your… Grandma".
- 10.5–12.6: hold with the **Videos · Choose videos** card in view. The clip stops here, before any file is chosen.
- Caption: *"Set up your phone. Cook like always. That's it."* Alt: *"Five gentle prompts, then hit record."*
- Note: the app has no in-app camera. The real flow is: record with the phone camera, then pick the videos here.

### 6. `app-questions.mp4`: questions for the cook (13.7 s, 1.09 MB)
- 0–0.8: Dad's Sunday Chili at the top.
- 0.8–2.1: scroll to the tabs (the ingredients show Dad's words: "the whole big family tray from the store", "two big ones, chopped chunky", "as many as I feel like, usually six or seven"…).
- 2.6–3.0: tap **Method**. Seven numbered steps with sensory cues and "special" and "story" tags.
- 4.2–5.6: scroll to the bottom card, **"3 questions to ask Dad"** ("Little gaps worth asking about next time you talk.").
- 6.2–6.7: tap it. **Questions for Dad** opens: "A few gaps in 'Dad's Sunday Chili' that only Dad can fill. Ask next time you talk." The pot mascot says "worth a phone call".
- 6.7–8.5: hold on the tinted question cards: "Dad, how much chili bean paste would you start with for someone who is nervous about spice?", "How do you know the chili is done simmering, besides the clock?", "Is it onions first because Grandma taught you that, or because you burned the garlic once?"
- 8.5–11.5: lift the third card into full view and hold.
- 11.5–13.7: scroll back to the top so the clip loops.
- Caption: *"A reason to call home: questions only they can answer."* Alt: *"Worth a phone call."*

## Tour clips (Oct 13): one action per row, about 5 s each

Re-recorded after feedback that each tour row took too long ("a visitor gives each step about 3 seconds").
Same format as above. Each starts on a still frame; the recorder's taps are quicker (lead 180–300 ms) and
holds shorter. Times are seconds into the clip; a tap's circle shows ~0.25 s before the press.

### 7. `app-add.mp4`: add the recipe and the videos (5.7 s, 0.20 MB)
- 0–0.6: **Add a recipe** at rest ("Pick the videos of someone cooking…", What's the dish?, Who's cooking? with
  the family's cooks as chips, They are your…, the Videos card with **Choose videos**). Opened directly, with no
  before-cooking prompts.
- 0.6–2.1: tap "What's the dish?" and type **"Sunday dumplings"**.
- 2.1–2.6: tap the **Grandma** chip: the name fills in and "They are your… Grandma" is selected.
- 2.8–3.3: tap **Choose videos**. On web the app's picker is a file input; the recorder answers it over CDP
  (`Page.setInterceptFileChooserDialog` → `DOM.setFileInputFiles`) with two local copies named
  `IMG_4521.MOV` and `IMG_4522.MOV` (the stock clips `hero-alt-grandma-baking-1080.mp4` and `hero-1080.mp4`).
  The button shows its spinner, then the app lists them: **"2 videos · under a minute · 4 MB"**, "1. IMG_4521.MOV
  · under a minute · 2 MB", "2. IMG_4522.MOV · under a minute · 1 MB", "Pick them in the order they were filmed."
- 3.5–4.1: small scroll so the list sits above the home indicator; hold to 5.7.
- Nothing uploads: Upload is never tapped (and on web it is disabled anyway). The durations are what the app
  shows for these short files ("under a minute"); a real 12-minute iPhone video would read "12 min".
- Posters: `app-add.jpg` (0.3 s, the empty form) and `app-add-picked.jpg` (5.4 s, everything filled in and two
  videos listed; the tour's tap-to-play still).
- Post-step: Add a recipe has no fixed header, so after the 3.5 s scroll the intro text slid under the
  (transparent) status bar. The top 94 px of frame 0 (the cream status bar alone) was laid over every frame
  (`ffmpeg -i app-add.mp4 -i strip.png -filter_complex "[0:v][1:v]overlay=0:0,format=yuv420p"`, same x264
  settings as `record.mjs`), and `app-add-picked.jpg` was re-grabbed at 5.4 s. Repeat this after re-recording.

### 8. `app-recipe.mp4`: her words, checked off (4.8 s, 0.53 MB; replaces clip 2)
- 0–0.7: **Grandma's Hand-Pulled Noodle Soup** at the top (poster, "family favourite", "by Grandma · ~1 hr 15
  min", intro, her quote). Opened directly, not from the family table.
- 0.7–1.7: scroll to the **Ingredients** tab: her words large, the estimate small on the right ("two heaping rice
  bowls, maybe a little more" ~3 cups, "a pinch in the palm, two fingers worth" to taste, "warm like a baby's
  bath…" ~1 cup, …).
- 2.2–2.7: check off **flour**. 2.9–3.4: check off **salt**. Hold to 4.8.
- Posters: `app-recipe.jpg` (0.3 s, the top) and `app-recipe-words.jpg` (2.05 s, Ingredients open, nothing
  checked, no tap ring).

### 9. `app-watch.mp4`: see them make it (5.1 s, 0.61 MB). **Stand-in video.**
- 0–0.8: cook mode, **Step 1 of 7 · "Mix the dough"**: the big step still with its "▸ 0:00 – 0:10" pill, the
  instruction with the cue highlighted ("no dry flour left in the bowl"), ingredient chips (flour · two heaping
  rice bowls…, salt · a pinch in the palm…, warm water · warm like a baby's bath…), "Hear Grandma" and next.
- 0.8–1.3: tap the still (**Watch step 1**). The Watch sheet rises: "Mix the dough · Step 1 · Grandma", the
  video, a progress row 0:00–0:10, Replay, and **Transcript · Grandma's own words**.
- 1.3–5.1: the step's video plays (a grandmother and granddaughter mixing flour dough in a bowl); the progress
  bar fills and the transcript highlight moves from "Warm water, not hot." to "Hot water cooks the flour and
  then it fights you the whole morning." at about 3.7 s.
- **What is real and what is not.** The UI is the real app (cook mode and `PlayerSheet`'s Watch player, which
  seeks to `start_s`, plays, and pauses at `end_s`). No family-appropriate recipe has real video, so the video
  is a **Pexels stock clip, "Grandmother and Granddaughter Baking Together" by Jelly Marketing**
  (`web/public/media/stock/hero-alt-grandma-baking-1080.mp4`, 14 s, 1080×608), standing in for a family
  recording. It was attached to Grandma's noodle soup in memory only (the recipe JSON intercepted over CDP;
  nothing in `app/`, `data/` or the bucket changed): `media.video_url` = that file served by the lander's dev
  server (`http://localhost:3000/media/stock/…`, Range support), `audio_url` null, `duration_s` 14, 1080×608;
  step 1 `start_s` 0, `end_s` 10 (the clip's last 2 s are a crossfade) and `image_url` = a still from the clip at
  0.5 s; flour, salt and warm water `first_seen_s` moved to 2, 4 and 8 s so their chips stay on step 1. Step 1's
  quote is the recipe's own (synthetic) quote, so the transcript is demo content too. The lander must not
  present this as a real family's footage.
- Posters: `app-watch.jpg` (0.3 s, cook mode at rest) and `app-watch-sheet.jpg` (4.8 s, the video playing, her
  second line highlighted).

### 10. `app-keep.mp4`: keep it, send it home (5.0 s, 0.36 MB)
- 0–0.7: the family table at rest (as clip 1).
- 0.7–1.2: tap **Grandma**: "Grandma's latest" noodle soup, her Red-Braised Pork Belly below.
- 1.8–2.3: tap **Grandma's Red-Braised Pork Belly**. The recipe opens (one frame of the app's "Setting the
  table…" loading state at ~2.1 s).
- 2.9–3.3: tap **Share** (top right); the press lands at ~3.2 s (the tour's `SHARE_TAP_AT`). Hold to 5.0.
- The native share sheet cannot render on web (see clip 4); the payload the app handed to `navigator.share` was
  captured again: **"Grandma's Red-Braised Pork Belly by Grandma — from our family table"**.
- Poster: `app-keep.jpg` (0.3 s, the family table).

## Limitations

1. **The app has no translation feature.** No screen translates anything, so none of these clips shows translation. A translation section on the lander would show a planned feature, not recorded UI. Label it as coming soon, or leave it out of the "real app" claims.
2. **The share sheet is not visible.** See clip 4. The tap is real; the native sheet does not exist on web.
3. **No family recipe has real video or audio.** The ones that do are weed-steak, YouTube or Gordon footage, or test patterns. Clip 9 shows Watch with a **stock stand-in video** (see clip 9). Hear the cook is not shown: "Hear Dad" and "Hear Auntie Lin" appear in cook mode but were not tapped, because on these recipes they open a "No recording for this one yet" sheet.
4. **The recipes are synthetic demo content** with the sample labels removed (see Content curation).
5. **This is react-native-web in Chrome, not native iOS.** Fonts (Newsreader, DM Sans, Caveat), colors and layout are the app's own. Screen changes are instant (no iOS push animation), and a scrolled ScrollView passes under the status bar, as it does on iOS. Some frames show a step photo fading in after "next" in cook mode (expo-image's 250 ms fade).
6. Fictional time "9:41"; no audio track.

## Re-running

The scripts are copied to `docs/lander-refs/analysis/app-recorder/` (`cdp.mjs` handles the CDP session, curation and network blocking; `inpage.js` adds the touch circle, status bar, scrolling and share spy; `record.mjs` defines the clips and the encoding).

1. Start headless Chrome (the real Google Chrome binary, which decodes H.264 for clip 9): `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=<tmp> --hide-scrollbars --mute-audio --autoplay-policy=no-user-gesture-required`
2. With the app running on :8081 (and, for `watch`, the lander's dev server on :3000), run `node <path>/record.mjs add recipe watch keep` from a scratch folder (Node 24). It writes `frames/` and `report.json` to the current folder and the MP4 + poster JPGs to `web/public/media/app` (`OUT=<dir>` to write elsewhere). The older clips are still defined: `library cook share record questions` (note `recipe` is now clip 8, not clip 2).
3. The tour's payoff stills (`app-add-picked.jpg` at 5.4 s, `app-recipe-words.jpg` at 2.05 s, `app-watch-sheet.jpg` at 4.8 s) are single `ffmpeg -ss <t> -i <clip> -frames:v 1 -q:v 3` grabs, and every poster needs its `public/media/_opt/app/<name>-<w>.webp` widths (the `scripts/media.mjs` webp step, run with `--force` when a JPG changes).
4. Options:
   - `OUT_W=1170` gives @3x output.
   - `CRF=…` changes the quality.
   - `NO_STATUSBAR=1` drops the status bar and home indicator.
   - `openCuratedPage(cdp, { keepSampleTags: true })` keeps the "sample" labels; `recipeOverrides` and `files` (see `cdp.mjs`) are how clip 9 gets its stand-in video and step still.
   - A clip can define `setup(c)` (runs before the screencast; clip 10 loads the pork belly and goes back so the app already holds it), `pick` / `pickFrom` (files for the app's file input) and `prewarmFetch` (URLs fetched into the HTTP cache first).

# Stock media manifest

All files are in `web/public/media/stock/` and are served at `/media/stock/<file>`. Every source is from **Pexels** (Pexels License: free for commercial use, attribution not required, no selling unaltered copies, no implied endorsement). Full credits are in `web/public/media/stock/credits.json`. Unsplash and Mixkit were not needed. Unsplash's search API requires auth, and Mixkit's family clips were only young children baking cookies.

Focal points are given as fractions of width and height (x, y). Use them for `object-position` and for crops.

## 1. Hero video

| File | Dims | Size | Notes |
|---|---|---|---|
| `hero-1920.mp4` | 1920×1080, 14.4 s, 25 fps, H.264 High, no audio, faststart | 4.6 MB | Desktop hero. Downscaled from the 4K masters. |
| `hero-1080.mp4` | 1080×608, 14.4 s | 1.4 MB | Fallback for smaller laptops and tablets. |
| `hero-mobile-720x1280.mp4` | 720×1280 portrait, 14.4 s | 1.6 MB | Extra file: a 9:16 crop made from the 4K sources for phones. Use it under `(max-aspect-ratio: 3/4)` so phones get faces, not a sliver of a 16:9 frame. |
| `hero-poster.jpg` | 1920×1080 | 154 KB | Frame 0 of the hero, so the poster swaps to the video without a jump. |
| `hero-poster-mobile.jpg` | 1080×1920 | 94 KB | Frame 0 of the mobile crop. |

**In frame:** A grandmother (or older mother) and her teenage granddaughter, East Asian, are folding dumplings together at a home kitchen counter. Both are smiling, their heads lean together and their hands meet over one dumpling. The kitchen is real: fridge magnets, bamboo steamers, a steamer pot and red winter blossoms (Lunar New Year). The light is warm and natural.

**Edit:** The first 0–10.2 s is a slow push-in on the two of them. A hard cut at 10.2 s goes to a wider angle where the girl spoons filling with chopsticks while grandma folds. The video loops back to the start with another hard cut. Because the loop point is a cut between two angles, no crossfade is needed and there is no visible jump. A light grade was applied (saturation 0.94, contrast 1.02) to calm the reds next to the green and yellow palette.

**Focal points (desktop 16:9):**
- Faces at (0.41, 0.33) and (0.60, 0.33).
- Hands and dumpling at (0.55, 0.62).
- Use `object-position: 50% 40%`.
- The left 0–0.2 strip is red blossom (foreground) and the right 0.75–1.0 strip is the steamer pot and window. Both are calm enough for overlay text with a scrim.
- The frame is mid-key, so a huge cream or white headline needs a 35–50% dark gradient (bottom-up or left-to-right).
- Dark olive text would only work on a strong cream scrim.

**Focal points (mobile 9:16):**
- 0–10.2 s: both faces are in frame, with the girl near the left edge.
- 10.2–14.4 s: the girl is centred and grandma's hands enter from the right.
- Put the headline in the top 35% or bottom 30% of the frame.

**Alternate hero candidates.** Both are 1080w loops, crossfaded 1 s at the loop point, plus a 1920w poster:

| File | Dims | Size | In frame |
|---|---|---|---|
| `hero-alt-grandma-baking-1080.mp4` | 1080×608, 14 s | 2.2 MB | A grandmother in a green apron and her granddaughter (about 10) mix dough in a steel bowl at a wooden table. Bright daylight, greenery in the window, yellow flowers in the foreground. Handheld drift. It matches the green and yellow palette best. Focal point (0.5, 0.45). |
| `hero-alt-grandma-baking-poster.jpg` | 1920×1080 | 157 KB | Frame 4 s of the source: the girl grins with her hands in the dough while grandma watches. |
| `hero-alt-mother-daughter-1080.mp4` | 1080×570, 14 s | 1.5 MB | A mother (about 60, grey hair, apron) and her adult daughter (redhead, green apron). The daughter rests her head on her mother's shoulder and the mother smiles with her eyes closed. It is emotional rather than a cooking shot, and good for the "distance / show love" section. Focal point (0.5, 0.4). |
| `hero-alt-mother-daughter-poster.jpg` | 1920×1012 | 78 KB | Frame 25 s: the hug. |

## 2. Lifestyle photos (2000 px long edge, ≤ 350 KB each)

| File | Dims | Size | In frame | Focal / crop |
|---|---|---|---|---|
| `photo-grandma-granddaughter-woodfire.jpg` | 2000×1500 | 308 KB | Indonesian grandmother in a lace kebaya blows through a bamboo tube to fan a wood fire. A small granddaughter in a lilac dress sits on a stool watching. Woven bamboo walls, very authentic. | Grandma (0.72, 0.38), child (0.22, 0.55). A square crop works centred at (0.5, 0.5). |
| `photo-grandpa-grandson-breakfast.jpg` | 2000×1333 | 350 KB | A grey-bearded grandpa and his teen grandson talk across a pancake breakfast. Cosy cottage kitchen, green tablecloth, window light. | (0.5, 0.45). For a 4:5 crop, centre at x 0.5. |
| `photo-mom-daughter-cooking.jpg` | 1333×2000 | 336 KB | Mom (about 60) and her adult daughter (redhead, green apron) laugh while cooking. The daughter's hands are on mom's shoulders, with a bowl, mug and dough on the counter. This is the same pair as `hero-alt-mother-daughter`. | Faces at (0.45–0.6, 0.3), hands at (0.4, 0.6). Use `object-position: 50% 35%`. |
| `photo-dad-son-cooking.jpg` | 2000×1335 | 324 KB | A Latino father (about 70) and his adult son (about 40), arms around each other, smile at the camera while the father whisks. Subway-tile kitchen. | Faces at (0.33, 0.25) and (0.62, 0.22). Crop from the top down. |
| `photo-young-adult-cooking-night.jpg` | 1334×2000 | 345 KB | A young man (about 20) cooks alone in a tiny dark apartment kitchen lit by one window, with a yellow cabinet behind him. Moody "away from home" image. | Figure at (0.35, 0.45). Keep the dark top; it is good for text. |
| `photo-hands-kneading.jpg` | 2000×1333 | 330 KB | Close-up of hands kneading golden dough on a floured counter, with eggshells blurred in the foreground. | Hands and dough at (0.6, 0.5). |
| `photo-pinch-into-pot.jpg` | 1333×2000 | 317 KB | A hand sprinkles a pinch of herbs into a steaming saucepan on a gas flame. Dark and moody, for the "a pinch" / "a handful" story. | Hand at (0.55, 0.38), pot at (0.5, 0.78). |
| `photo-steaming-pot.jpg` | 1329×2000 | 330 KB | A black pot breathes steam on a gas stove in warm golden backlight. | Pot at (0.5, 0.65), steam at (0.5, 0.25). The dark edges suit text. |
| `photo-family-dinner-table.jpg` | 2000×1333 | 340 KB | A Middle Eastern / North African multigenerational family (grandfather, father, sons) argue happily over a table of shared dishes. Warm wood room, lamp light. | Centre (0.5, 0.45). The table spread fills the bottom third. |
| `photo-parent-phone-call.jpg` | 2000×1335 | 342 KB | A woman of about 60 with grey hair covers her mouth in delight while watching a red phone, as if a video call or a recipe from her kid just arrived. Kitchen shelves behind her. | Face at (0.37, 0.4), phone at (0.75, 0.55). |
| `photo-phone-tripod-kitchen.jpg` | 1505×2000 | 339 KB | A phone on a mini tripod sits on a bright kitchen island with bowls and pears, ready to record. This is the "set up your camera" image. | Phone at (0.47, 0.6). There is lots of calm negative space at the top for copy. |
| `photo-cook-recording-phone.jpg` | 1333×2000 | 335 KB | A young Black woman cooks at her counter while a phone on a gimbal records her. The phone's screen shows her (a recording UI). This is the "record, done" image. | Phone at (0.6, 0.55), face at (0.45, 0.12). |
| `photo-elder-hands-dumpling.jpg` | 2000×1333 | 310 KB | Close-up of an elder's floury, weathered hands folding a filled dough parcel. Shallow focus. | Hands at (0.45, 0.4). |
| `photo-family-laughing-table.jpg` | 2000×1335 | 350 KB | A Black family of three generations toasts and laughs around a bright dinner table. | Centre (0.55, 0.45). |
| `photo-abuela-tortillas.jpg` | 1333×2000 | 317 KB | An elderly Mexican grandmother in a green dress presses tortillas on a cloth, with a Virgin of Guadalupe figure behind her. The green matches the palette. | Face at (0.4, 0.15), hands and tortillas at (0.6, 0.7). |
| `photo-grandpa-chopping.jpg` | 1334×2000 | 320 KB | An elderly Black grandfather in a red gingham apron slices tomatoes in a sunlit kitchen. | Face at (0.5, 0.2), hands at (0.6, 0.75). |

Cultures covered: East Asian (hero), Southeast Asian, Latin American (two images), Black (three images), Middle Eastern / North African, white European. Relations covered: grandma, grandpa (two images), mom, dad, adult kids, a teen and a solo young adult.

## 3. Dish photos for recipe cards (1000×1000 square, ≤ 160 KB)

All are centre square crops (focal point about (0.5, 0.5)) unless noted. All look homemade (home tables, pans, cloths) rather than plated studio shots.

| File | Size | In frame |
|---|---|---|
| `dish-dumplings.jpg` | 158 KB | Overhead: a steamer tray of hand-folded dumplings, a rolling pin, flour and a filled wrapper. |
| `dish-tamales.jpg` | 152 KB | A heap of string-tied corn-husk tamales on a wooden board over a gingham cloth. |
| `dish-biryani.jpg` | 152 KB | Chicken biryani in a glass baking dish on a wooden board, with raita and salan. |
| `dish-pho.jpg` | 125 KB | A bowl of pho with Thai basil and chopsticks on a warm wood table. |
| `dish-jollof-rice.jpg` | 160 KB | A big cast pot of jollof rice cooking outdoors (Jos, Nigeria). Crop is centred low, at (0.5, 0.62). |
| `dish-lasagna.jpg` | 64 KB | A layered lasagna slice against a soft green background. Matches the palette. |
| `dish-kimchi-stew.jpg` | 130 KB | Kimchi jjigae with tofu and scallion in a clay pot. |
| `dish-pierogi.jpg` | 106 KB | Overhead: sweet pierogi topped with strawberry and cream on a ridged plate, with a hand holding a fork. |
| `dish-adobo.jpg` | 144 KB | Pork adobo with halved eggs in a pan, with rice and chopsticks. Label it "adobo", not "chicken adobo". |
| `dish-dal.jpg` | 125 KB | Dal tadka with dried chillies in a steel kadai. |
| `dish-mac-and-cheese.jpg` | 109 KB | Baked mac and cheese with herbs in a cast-iron dish. |
| `dish-empanadas.jpg` | 142 KB | Four baked empanadas with chimichurri on a wooden board, on a rustic blue table. |
| `dish-ramen.jpg` | 66 KB | A homestyle bowl of noodle soup in a painted bowl on yellow gingham. The source calls it instant noodles; label it "ramen" or "noodle soup". Matches the palette. |
| `dish-shakshuka.jpg` | 125 KB | Shakshuka with eggs, radish and microgreens in a cast-iron skillet. |
| `dish-apple-pie.jpg` | 140 KB | Overhead: a lattice apple pie with apples. Crop at (0.5, 0.62). |
| `dish-banana-bread.jpg` | 146 KB | A sliced banana bread loaf on parchment and a board, with bananas. Crop at (0.5, 0.6). |

## 4. Hand holding a phone (app-demo section)

| File | Dims | Size |
|---|---|---|
| `hand-phone.png` | 1228×1789 RGBA | 845 KB |
| `hand-phone-800.png` | 800×1166 RGBA | 599 KB |
| `docs/lander-refs/analysis/hand-phone-preview.jpg` | 1228×1789 | 109 KB, a check render on #F7F7F2 with an olive screen |

**In frame:** A front-facing iPhone 11-style phone with a notch and a pale lavender bumper. A light-to-medium skin-tone hand holds it from the lower right: the thumb wraps the right edge and three fingertips show on the left edge. The forearm leaves the frame at the bottom-right corner, so anchor the image to the bottom or right edge of its container, or fade the arm with a mask.

**How it was made:** The source is a Pexels photo of the phone with a green screen in front of a plain grey wall. The cutout was made locally with numpy/scipy:
- A background colour model separates the wall.
- A "blueness" key catches the bumper, and a scanline fill makes the phone body solid.
- A warmth key catches the skin, with soft anti-aliased edges.
- The green screen is keyed to fully transparent, and green spill on the bezel is removed.
- Semi-transparent edge pixels are un-mixed from the grey wall so there is no grey halo on cream.

**Result:** The background and the screen are both transparent. The notch stays opaque, so the app recording shows through the screen with the notch on top, like a real phone.

**Screen rectangle** (bounding box of the transparent screen hole):

| | x | y | w | h | Corner radius |
|---|---|---|---|---|---|
| `hand-phone.png` (px) | 150 | 63 | 522 | 1104 | ≈ 40 px |
| `hand-phone-800.png` (px) | 98 | 41 | 340 | 719 | ≈ 26 px |
| **Percent of image** (both files) | **12.21%** | **3.52%** | **42.51%** | **61.71%** | **≈ 7.7% of screen width** (≈ 3.6% of screen height) |

The screen narrows slightly toward the bottom (about 519 px wide at the top and about 503 px at the bottom in the full file), because the phone is tilted back a little. To place the recording:
- Put a `<video>` behind the PNG at the rectangle above, with `object-fit: cover`.
- Overscan by about 1% on each side; the opaque bezel hides the overscan.
- Use `border-radius: 7.7% / 3.6%`.
- The phone itself is about 51% of the image width (x 8.3%–59.0%) and 67% of its height (y 0.7%–67.8%).

The cutout's limits:
- The arm's lower contour is a little soft and jagged at full size. It looks clean at display sizes of 600 px or less.
- A hairline of the real wall shows in the gaps between the left fingertips and the bumper. It is faithful to the photo and reads as cream on the page.

# Hero video candidates (Oct 13)

Preview: `http://localhost:3000/?hero=c1` (`c2`, `c3`). With no param the hero is unchanged.
Files: `web/public/media/stock/candidates/hero-cN-{1920.mp4,mobile.mp4,poster.jpg}`. The 4K sources are in `candidates/raw/`.
All three are Pexels License clips: free for commercial use, no attribution required (https://www.pexels.com/license/).
Loops: each clip's last 0.8 s crossfades into its start, and the poster is frame 0 of the loop. Seam SSIM is 0.87 against 0.93 for normal adjacent frames, so there's no visible jump.
Encodes: H.264 high yuv420p, preset medium, lanczos, CRF 21 (desktop) and 23 (mobile) with a bitrate cap, no audio, +faststart, no grade.

| Rank | Clip | What's in frame | Segment (source s) | Desktop focus / 9:16 crop center | Files |
|---|---|---|---|---|---|
| c1 | [A Little Girl Sprinkling Salt](https://www.pexels.com/video/a-little-girl-sprinkling-salt-4823202/) by Ketut Subiyanto. 3840×2160, 25 fps, 15.4 s, 17.9 Mbps | A grey-haired dad in a striped tee laughs as his young daughter shakes salt into a bowl, then whisks under his nose. Tight two-shot with shallow depth of field, warm and neutral. | 0.3–15.1 (14.0 s loop) | `55% 35%` / x 53% | 1920 6.44 MB, mobile 2.95 MB, poster 153 KB |
| c2 | [A Mother Teaching Daughter to Make Sandwich](https://www.pexels.com/video/a-mother-teaching-daughter-to-make-sandwich-4297003/) by August de Richelieu. 3840×2160, 25 fps, 12.4 s, 13.7 Mbps | A mom in an olive shirt wraps her arms around her daughter as they top bruschetta with basil. Bright white kitchen, fridge on the left. | 0.1–12.4 (11.5 s loop) | `45% 35%` / x 42% | 1920 5.77 MB, mobile 2.48 MB, poster 107 KB |
| c3 | [Mother and Daughter Cooking Together at Home](https://www.pexels.com/video/love-women-relationship-kitchen-5495040/) by cottonbro studio. 4096×2160, 25 fps, 23.9 s, 17.5 Mbps | A grey-haired mom and her grown daughter lean their heads together, talk and laugh over the counter. Olive-green and tan aprons, soft window light, cinematic low-contrast look. | 0.0–14.8 (14.0 s loop) | `62% 40%` / x 62% (the daughter) | 1920 6.80 MB, mobile 2.10 MB, poster 92 KB |

## Why these three
- **c1 has the best quality and the most warmth.** Faces are tack-sharp at full resolution (pores and stubble hold), the laugh is real, and you see the salt, the bowl and the whisk. It's the only clip where both faces fill the frame. The headline sits over the girl's arm and the salt shaker, and the face area stays clear. The hero word rotates through Grandma, Mom, Dad and Grandpa, so a dad clip fits.
- **c2 has the best composition for the layout.** Both faces sit high and center-right, the lower left is a calm stainless fridge, and the 9:16 crop keeps both faces in every frame. The olive shirt and white kitchen sit well with the palette. It's a little softer and flatter than c1, but clean at 1920.
- **c3 is the most cinematic and the only grown child,** which is closest to the college-student audience. The colour sits well next to olive green.

## Caveats
- **c3:** no food or hands are in frame (they look down at the counter). Only the daughter is in sharp focus; the mom is soft. On phones the 9:16 crop can only hold one face, so it holds the daughter. It's also the same mother and daughter (same cottonbro shoot) as the `photo-mom-daughter-cooking.jpg` tile in EveryFamily and the old `hero-alt-mother-daughter` clip.
- **c1:** the camera is a slow handheld drift. It's smooth, but it isn't a tripod shot. On phones the 9:16 crop (center 53%) can't hold both faces all the time: the girl is fully in frame when she leans in, and the dad is sometimes cut at the right edge.
- **c2:** the loop is 11.5 s, which is the whole usable clip. The mom looks down for most of it.
- **Teen and young-adult options were thin.** No Pexels 4K clip of a parent cooking with a teen or college-age child met the quality bar. The Kindel Media mom-and-son clips (8550691/2) look cheap. The Mixkit mom-and-daughter set (101155 and siblings, 4K, sage-green kitchen) was the backup, but the camera crops the mom's head and she leaves frame, so it was dropped and its download deleted.
- No mobile poster was made, by request. Each candidate passes its desktop poster for both sizes, and `object-position` handles phones.

QA: `compare.jpg` (4 stills per candidate, in rank order), `shot-cN/sheet.jpg` (desktop hero in context, 1440×900), `sheet-*.jpg` (8 stills per finalist), `face-*.jpg` (full-resolution face crops).

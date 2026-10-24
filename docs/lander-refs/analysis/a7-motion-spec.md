# a7 motion spec: forensic teardown of Caleb's #1 reference

Source: `docs/lander-refs/a7-favorite-lander.mp4` (1440x1064, 30 fps, 47.6 s). It is a Dribbble shot of the "Pallet Ross" art-marketplace lander. The site sits inside the Dribbble viewer at **x 218-1216, y 288-878** of the video (a 998x590 "viewport", about 16:9.5). Every pixel figure below is measured in that 998 px viewport and converted to **vw / vh** so it scales. At a 1440 px desktop, 1vw = 14.4 px.

**Saved frames** (in this repo, `docs/lander-refs/analysis/a7-frames/`):

| File | What to look at |
|---|---|
| `01-hero-final-fan.jpg` | Hero end state: headline, 7-card fan, two speech chips, CTA |
| `02-hero-intro-word-reveal.jpg` | Per-word reveal mid-flight (gray, blurred, lower words) + the single card rising |
| `03-burst-fan-spread-1.9-2.9s.jpg` | 15 fps burst: one card → stack → fan |
| `04-burst-fan-collapse-sticky-4.0-5.0s.jpg` | 15 fps burst: fan collapses into a sticky stack while the hero text scrolls past it |
| `05-burst-stack-to-cascade-5.0-6.0s.jpg` | 15 fps burst: the same stack re-fans as a diagonal staircase |
| `06-ecommerce-cascade-wordfill.jpg` | Left text + right staircase; the next word is mid-reveal |
| `07-gateway-image-card.jpg` | Wide image card with "Watch" pill + arrows, wobbling black chip |
| `08-manifesto-gray-to-black.jpg` | 3-line centered statement, ink → ghost gray, inline emoji icons, card stack over the text |
| `09-burst-inline-stack-grows-13.4-14.4s.jpg` | 15 fps burst: a thumbnail **inside the sentence** grows into a card stack |
| `10-diagonal-cascade.jpg` | 7-card staircase + white info card |
| `11-burst-cascade-to-grid-17.7-18.7s.jpg` | 15 fps burst: staircase folds into a 3x2 grid in a folder |
| `12-vision-folder-grid-icons.jpg` | Folder tabs over the grid, line-icon cluster |
| `13-thumbnail-cloud.jpg` | Two wavy, counter-drifting thumbnail rows around a centered headline |
| `14-bento-story.jpg` | Staggered 2-column bento |
| `15-carousel.jpg` | 4-card carousel, progress bar, "View All" pill |
| `16-burst-bigcard-shrinks-into-grid-32.3-33.3s.jpg` | 15 fps burst: full-width card shrinks into the center of a grid |
| `17-fisheye-grid-center-card.jpg` | Final 5x3 "fisheye" grid with the center card and its chips |
| `18-pricing-fan-lime-marquee.jpg` | Pricing card fan + lime marquee band |
| `19-burst-physics-icons-37.7-38.7s.jpg` | 15 fps burst: icons drop and pile with gravity |
| `20-split-feature-cards.jpg`, `21-footer.jpg` | Two tall feature cards; footer panel |
| `sheet2fps_00..10.jpg` | Whole video at 2 fps, 9 frames per sheet (sheet *k* covers 4.5k → 4.5k+4.0 s, row-major, 0.5 s apart) |

More bursts (8 fps for the whole video, 2 s per sheet) are in the session scratchpad: `.../scratchpad/a7/d8/d8_NN.jpg` (sheet NN starts at 2·NN s, 0.125 s per frame).

**How to read the video.** It's a scripted motion piece, not a raw browser capture: the cursor never moves and the page moves in **glides then holds**: a 0.4-0.8 s glide to the next section, then a 2-3 s hold while its content builds in. Several objects are clearly **scroll-linked across section boundaries** (the card deck), so the real site is a smooth-scroll page with pinned scenes plus enter-triggered reveals. The loop starts at 0.9 s (intro from a blank, silky background) and ends at 43.3 s (fade to white); 44-47.5 s is a frozen intro frame.

---

## 1. Section-by-section timeline

| # | Video time | Section | Layout & content | What moves |
|---|---|---|---|---|
| 0 | 0.9-4.0 | **Hero (load-in)** | Fixed transparent nav. Centered 2-line headline "A place to display your masterpiece." at ~20% vh. 7-card fan centered at ~60% vh, spanning 70vw. Two speech chips (@coplin blue, top-left of fan; @andrea sage, top-right). One line of sub-copy, black pill CTA + text link at ~88% vh. Background: #F3F3F3 with a very faint satin/silk wave texture. | Nav blur-in; headline builds per word; ONE card rises from below, rotating upright; a stack appears behind it and fans out; sub-copy and CTA blur in; chips pop, then wobble forever. |
| 1 | 4.0-4.9 | **Hero → next (deck handoff)** | Same | Hero text scrolls up normally; the **deck stays in the viewport** (sticky) and collapses fan → stack → single card, shrinking. The CTA passes *over* the stack on its way up. |
| 2 | 4.9-7.7 | **"E-COMMERCE / Showcase, Sell, & acquire arts to our marketplace."** | Left column at the 7.2vw gutter: eyebrow, 3-line H2 (middle line crimson), 4-line paragraph, pill CTA. Right 60%: diagonal staircase of the same cards, top-left → bottom-right, last card bleeding off the bottom-right. Chips @howard (crimson), @robin (black). Tiny up/down arrows at the right edge. | Eyebrow types in; words reveal per word; the stack re-fans as a staircase (scale up ×1.3); chips pop. On exit the staircase leaves slower than the text, its tail lingers in the top-right corner during the next section. |
| 3 | 7.7-10.6 | **"CLASS BY REATHA C. PHELAN / Gateway to artist people."** | Left-aligned 2-line H2, then one wide image card (85.5vw × ~59vh, radius ~1.5vw) with UI garnish: toggle pill top-left, "···" top-right, white "Watch" pill bottom-left, two round arrow buttons bottom-right. Black speech chip @reatha floats right of the heading. | Card glides up from the bottom; heading reveals per word; card UI scales in; chip pops and swings (rotate) then idles. |
| 4 | 10.6-13.3 | **"Trusted by the best."** | Small left H2 (~2.6vw), "best." stays ghost gray. One line of body. A single row of gray partner logos with faded edges. Prev/next arrows right. | Logos blur in and drift right continuously (~3vw/s); heading per word. |
| 5 | 13.3-16.3 | **Manifesto** | 3 centered lines (~3.8vw): "Whether you're an artist looking to sell your work / or buyer seeking *unique* pieces [icon] connects / you to world of creativity [icon] commerce." Line 1-2 ink, "unique" mint, tail ghost gray. Inline 3D emoji icons at cap height. Chips @alician (black, left), @andrea (blue, right). Row of 3 small icon chips below. | The sentence rises into the center; a **tiny card thumbnail sits inside the sentence** and grows into a stack that hovers over the text; the stack shuffles its front card; words fill gray → ink in reading order; chips pop; the stack tilts and wobbles. |
| 6 | 16.3-17.8 | **Staircase** | 7 portrait cards (~15vw × 19vw) + one white info card ("Where Art Meets Market" + 2-line description + round black icon) on a diagonal from top-left to bottom-right. Amber chip @Johnson. | Manifesto scrolls away; the stack drops, straightens and unfurls into the staircase; slow idle drift. |
| 7 | 17.8-21.0 | **"Our vision for any art technology."** | Left: small eye icon, H2 (~2.6vw), paragraph, "Read more" link, and a loose cluster of ~9 line icons in white circles. Right: a 3x2 grid of the same cards inside a white panel, with **folder tabs** on top (black "Personal" tab with a notched edge, "Business" tab behind with a "+ Create" pill). | Staircase folds into the grid; info card slides out; panel appears behind; folder tab slides down onto the grid; icons spawn and drift into a cluster; heading per word. |
| 8 | 21.0-24.2 | **"You will find yourself among us"** | Centered H2 (~5vw) + 2-line body, tiny logo glyph above. Two wavy rows of ~12 rounded-square thumbnails (6.5-7.5vw, radius ~20%) above and below, each slightly rotated, some smaller (depth). | Rows rise in with the scroll; top row drifts left, bottom row drifts right, continuously; heading per word. |
| 9 | 24.2-28.8 | **"YOUR STORY TELLING / Every piece of art tells a story"** | Centered eyebrow (last word blue) + 2-line H2 (~4.4vw). Staggered 2-column bento: white card with mini card-stack + "Play Video" pill + chip; blue image card; image card "Spin Your Art into Gold"; white card containing a dark phone mock with a picker-wheel word list ("Personal Identity" focused). | Eyebrow word-rise, heading per word; cards rise in with column stagger; mild parallax (right/lower cards ~1.3× scroll speed, the phone inside its card ~2×). |
| 10 | 28.8-31.3 | **"GET MORE CLOSER / Marketplace for Creativity"** | Left eyebrow (last word magenta) + 2-line H2 (~4.4vw) + 3-line paragraph; magenta "View All" pill right; 4 square cards in a row (15vw each) with captions; prev/next + progress bar under. | Cards enter L→R from blurred/desaturated to sharp; progress bar grows (autoplay timer). |
| 11 | 31.3-32.3 | **App dock** | A centered row of 7 app icons, center one large (brand icon), sizes falling off toward the ends. | Icons grow from the center outward. |
| 12 | 32.3-34.8 | **Big card → fisheye grid** | A full-width image card rises, then **shrinks into the center cell** of a 5x3 grid of portrait tiles. Center card: "Like" pill top-right, "@artist" speech chip (rotated −10°), creator row (avatar, name, "from ArtRoss") bottom-left. Outer columns smaller and lower: the grid bulges like a fisheye/dome. | Card width 93vw → 27vw while changing from landscape to portrait; tiles emerge from behind it and spread out to their cells; card UI pops in last. |
| 13 | 34.8-37.0 | **"Membership"** | Left small H2 + 2-line body. Right: 3 pricing cards in a loose fan: white "Monthly $9.99" (−2°), orange "Quarterly $12.99" raised with a "Popular" sticker, white "Annually $19.99" (+4°). Huge numerals. | Cards rise with stagger and settle into their tilts. |
| 14 | 35.5-40.3 | **Lime marquee band** | A tall lime panel (#E9F66D, inset to the content width ~82vw, radius ~2vw, faint white swirl pattern). Top: huge marquee text (~4.5vw) "…artists can ride [stickers] Inspired by people [sticker] New Art Platform…" with tiny captions under a sticker ("2025 POSTER"). | Text loops left continuously; when the panel scrolls in, ~12 line icons in white circles **drop with gravity** from the top-left, bounce and pile along the bottom. |
| 15 | 39.6-42.0 | **Two feature cards** | Side by side, ~40vw each, tall. Left: magenta photo card, white text "Meets new people" + white pill. Right: white card "Archive of new arts" + black pill, with a cut-out flower image that **overflows the card's top edge**. | Rise with the scroll. |
| 16 | 42.0-43.3 | **Footer** | Light gray (#EFEFEF) rounded panel inset from the edges: "Our platform, your art." + body, 3 link columns (one item has a red "New" pill), socials, © line. | Rises; then the whole page fades to white and the loop restarts. |

---

## 2. Animation catalog

Conventions: **Trigger** = load (time-based), enter (fires once when the element reaches ~75-80% of the viewport height, plays over time), scrub (tied to scroll progress), or loop (runs forever). "Ease-out expo" ≈ `cubic-bezier(0.16, 1, 0.3, 1)`; "ease-out quart" ≈ `cubic-bezier(0.25, 1, 0.5, 1)`; "ease-in-out" ≈ `cubic-bezier(0.65, 0, 0.35, 1)`.

### M1. Page intro curtain
- **Trigger:** load. **Pinned:** n/a.
- Background (satin wave texture on #F3F3F3) is visible first, empty. Nav logo appears, then nav links blur in **left → right** (blur 6px → 0, opacity 0 → 1), ~50 ms stagger, ~0.6 s each; finished ~1.2 s after start.

### M2. Per-word headline build (the signature text motion, used for every heading)
- **Trigger:** load for the hero, enter for every section heading.
- **Unit:** per **word** (never per letter for headings). Inline images, emoji and chips count as words.
- **Per word, start → end:** `opacity 0 → 1`, `filter: blur(8-10px) → blur(0)`, `translateY(+0.3em) → 0`, `color #C8C8C8 (ghost) → #161616 (ink)`. The color lags the other properties slightly, so a word arrives **gray first, then darkens**: a gray wave runs ahead of a black wave. Accent words go from a pale tint of their accent to the full accent (crimson "& acquire arts to" starts pale pink).
- **Stagger:** 0.10-0.15 s per word in the hero ("A" 0.00, "place" 0.06, "to" 0.20, "display" 0.35, "your" 0.50, "masterpiece." 0.60-0.75); 0.07-0.12 s in later sections.
- **Duration per word:** ~0.5 s to sharp, ~0.6-0.7 s to full ink. Ease-out quart.
- Later words sit visibly **lower** while arriving (each word is still rising when the next appears), so the line looks like a soft wave settling onto its baseline.
- **Two-tone variant:** some headings never finish filling: "Trusted by the **best.**" (last word stays ghost), and in the manifesto "connects you to world of creativity commerce." stays ghost. Ghost gray is a permanent hierarchy color, not only a transition state.

### M3. Eyebrow word-rise
- **Trigger:** enter, ~0.15 s before the heading.
- Uppercase eyebrow ("YOUR STORY TELLING", "GET MORE CLOSER", "E-COMMERCE", "CLASS BY …") appears word by word: each next word starts ~0.5em lower and lighter, then rises into line (0.3-0.4 s, stagger ~0.1 s). The last word is the accent color (blue "TELLING", magenta "CLOSER").

### M4. Paragraph and button blur-in
- **Trigger:** enter, after the heading starts (~0.3 s later).
- Paragraph reveals per word, much faster (stagger 0.02-0.03 s), blur 6px → 0, opacity 0.2 → 1, slight y. The tail of the paragraph is visibly blurrier than the head mid-reveal.
- Buttons: pill fades/blurs in (blur 6px → 0, gray → ink fill), text link last.

### M5. Hero card entrance (one card)
- **Trigger:** load, starts with the first headline word.
- One card (the future front card, ~21vw square, radius ~1.6vw) enters **from below the viewport** at x ≈ +5vw right of center.
- Start: `translateY ≈ +55vh`, `rotateZ ≈ −20°`, slight 3D tilt (looks like `rotateX ~15°` with perspective), scale ~1.05. End (at ~1.0 s): centered under the headline, `rotateZ ≈ −3°`, no tilt, scale 1.
- Ease-out cubic: fast first half, long settle. Duration ~1.0 s.

### M6. Hero fan spread (one card → stack → fan)
- **Trigger:** load, immediately after M5 lands (~1.1 s after start).
- 0.00-0.15 s: colored edges of the other 6 cards peek out on the left of the front card (a tight stack, each card offset ~0.6vw left and rotated ~1° more).
- 0.15-0.65 s: the stack spreads both ways at once into a wide arc. The **front card travels right** to the end of the fan; the back card travels to the far left. No time stagger: every card moves at once, each by a distance proportional to its slot. Ease-out expo (most of the travel happens in the first 0.25 s).
- **Final fan geometry** (7 cards, 998 px viewport): spans x 15% → 85% (70vw), centered; cards ~14-16vw wide, portrait-ish to square, overlap ~45%; `rotateZ` from **−8°** (leftmost) through ~0° (middle) to **+6°** (rightmost); edge cards sit ~2vw **lower** than the middle (a "smile" arc) and the middle cards are ~12% **smaller**, as if the cards stood on a curved shelf. **z-index rises left → right** (the rightmost card is on top). A soft floor shadow sits under the whole fan.

### M7. Hero sub-copy, CTA, chips
- Sub-copy per word (M4) at ~1.4-1.8 s; CTA pill blurs in at ~1.6-1.9 s; "Read more" ~0.1 s after.
- **Chip pop:** ~2.0 s. Each chip starts as a dot at its tail tip and springs to full size with ~10% overshoot (0.3 s). The second chip follows ~0.1 s later.
- **Chip idle loop:** forever, each out of phase: rotate between about −4° and +4° (sage chip leans ~+6°), bob 2-4 px, period 3-4 s, sine ease.

### M8. Deck collapse into a sticky stack (hero exit)
- **Trigger:** scrub. **Pinned:** the deck layer is sticky while the hero text scrolls normally past it; in the video this takes ~0.9 s of glide, roughly **one viewport** of scroll.
- Properties: each card's x/rotation return to the stack pose (all cards slide back under the front card), deck scale 1 → ~0.65, deck y from 60% vh → ~62% vh (it barely moves, the page moves around it). Chips scroll away with the text.
- The CTA pill and sub-copy pass **over** the stack (text layer above the deck layer).
- End state: one card visible (front card) with others hidden directly behind it.

### M9. Stack → diagonal staircase (section 2 enter)
- **Trigger:** scrub/enter as the "E-COMMERCE" section settles (5.1-5.7 s). The deck is the same object that left the hero.
- The stack moves slightly down-right and **grows ×1.3-1.4**, then unfurls on a diagonal: the back card goes up-left, the front card goes down-right and partly off-canvas. ~0.6 s, ease-out expo.
- **Final staircase** (998 px viewport): cards ~19.5vw × 19vw, first card top-left at (37.5vw, 53vh), each next card **+12.2vw x, +4vw y**, 5 fully visible + 2 bleeding off the corner; z rises toward the bottom-right. No rotation, soft shadow.
- Chips pop after (5.6 s and 5.75 s) and idle (M7).
- **Exit:** the staircase scrolls up slower than the text (parallax ≈ 0.5-0.6×), so its last cards linger in the top-right corner (behind the transparent nav) through the next section.

### M10. Wide image card rise + garnish
- **Trigger:** enter. The card glides up with the page (from ~80% vh to ~40% vh over ~0.4 s, ease-out); no scale.
- Garnish (toggle pill, "···", Watch pill, arrow buttons) scales 0.6 → 1 + fades, ~0.25 s, stagger ~0.05 s, after the card stops.
- **Chip swing (@reatha):** pops ~1.2 s after the card lands, then swings: rotate −10° → +8° → −4° → 0 over ~0.8 s (a hanging-sign wobble), then idle (M7).

### M11. Logo marquee
- **Trigger:** loop (+ enter blur-in of the row).
- Single row, drifts **right** at ~3vw/s, seamless loop, ~10% fade masks on both edges. Logos are mid-gray, ~1.2vw tall.

### M12. Manifesto: inline thumbnail grows out of the sentence + word fill
- **Trigger:** scrub (best reproduced pinned). In the video it plays over ~2.8 s of slow glide.
- **Text:** the 3-line block rises from ~75% vh to the vertical center while filling. Fill runs in reading order per word (M2 properties). Lines 1-2 fill to ink; the accent word "unique" fills to mint (#6DDBA6 family); the tail "connects you to world of creativity commerce." **stays ghost** (#C4C4C4 on #F7F7F7) at the end of the hold. Inline 3D emoji icons (a bucket, a price tag) fade/scale in at cap height ~0.3 s after their neighbors.
- **Inline thumbnail:** at 13.5 s a tiny card (~1 cap-height tall, ~3vw) sits **inside the sentence**, after "artist", as if it were a word. Over ~0.8 s it grows to a ~19vw × 22vw portrait **stack** that rises above the line and overlaps the text (z above the text). Stack pose: cards offset up-right, each rotated a few degrees more than the one in front.
- **Shuffle:** while growing, the front card changes three times (green → yellow → blue): the new front card slides in from the front/below and scales 0.9 → 1 (~0.25 s each).
- **Tilt:** after the fill, the whole stack leans to ~+12-15° and keeps a slow wobble (±3°).
- **Chips:** @alician (black, left of line 1) pops at ~13.8 s; @andrea (blue, right) ~14.3 s.
- **Icon row:** 3 small rounded icon chips below the text blur in left → right (stagger ~0.1 s) at ~14.6 s.

### M13. Stack drops into the big staircase
- **Trigger:** scrub at the manifesto's exit (16.0-16.4 s).
- The text scrolls up and out; the stack falls (translateY ~+40vh), un-tilts (+12° → 0) and unfurls into a 7-card staircase plus a white info card at the top-left. ~0.4-0.5 s, ease-out.
- **Final staircase** (`10-diagonal-cascade.jpg`): cards ~15vw × 19vw (4:5), radius ~1.2vw; first card at (5vw, 11vh); steps are **+12vw x and +6-9vh y** with a slight ease (the diagonal curves gently); z rises toward the bottom-right; the last card bleeds off the bottom. The info card overlaps the first two.
- **Idle:** the whole staircase drifts slowly (~2vw over 1.5 s) while holding; amber chip @Johnson pops at ~16.8 s.

### M14. Staircase folds into a 3x2 grid inside a folder
- **Trigger:** scrub (17.8-18.6 s, ~0.5 s of motion).
- 17.8-18.0: the whole staircase slides right; a white rounded panel fades in behind it (initially wide).
- 18.0-18.2: the stair compresses into two rows: top row = cards 2-4 slide up-left into line; the top-left card **drops** into the bottom-left slot; the info card slides out left and fades; the panel narrows to fit the grid.
- 18.2-18.3: grid settles: 3 cols × 2 rows, cards ~16vw × 14vw, gaps ~1.5vw, right-aligned at the gutter.
- 18.4-18.6: a black folder tab ("Personal", with a diagonal notch on its right) slides **down** onto the top edge of the grid; a second tab ("Business") with a "+ Create" pill sits behind it.
- **Icon cluster** (left): ~9 line icons in white circles (~4.5vw) spawn as dots at scattered positions and scale/drift into a loose cluster with small rotations, stagger ~0.04 s, ~0.6 s total.
- Heading "Our vision for any art technology." reveals per word (M2) during the fold.

### M15. Thumbnail cloud (two counter-drifting rows)
- **Trigger:** enter (rows rise with the page) + loop (drift).
- Layout: two rows of ~12 rounded-square thumbnails (6.5-7.5vw, radius ~20%, soft shadow). Each row follows a **sine wave** in y (amplitude ~3vw, wavelength ~5 tiles) and each tile has its own tilt (−8° to +8°) and size (depth 0.85-1.1). Top row sits in the top 35% vh, bottom row in the bottom 35% vh.
- **Drift:** top row moves **left**, bottom row moves **right**, both ~2-3vw/s, seamless loop.
- Enter: tiles rise in from below with the scroll (top row first), blur → sharp.
- Center: tiny brand glyph, then H2 per word (M2), then 2-line body (M4).
- Exit: both rows scroll up normally.

### M16. Bento stagger + inner parallax
- **Trigger:** enter + mild scrub parallax.
- Cards rise from ~+15vh with the left column first and the right column ~0.1 s later (the right column also starts lower: a masonry stagger).
- Measured scroll speeds: left column 1.0×, lower-left card ~1.3×, the phone mock inside its white card ~2× (it slides up within its card as you scroll).
- **Picker-wheel phone** (`M16b`): a dark rounded phone shape with a vertical list; the center item is white and sharp, items above/below are gray, smaller and blurred, like an iOS picker. It's essentially static in the video; we'd animate it (see mapping).

### M17. Carousel enter + progress
- **Trigger:** enter + loop.
- Eyebrow (M3), H2 (M2), paragraph (M4), "View All" pill blur-in.
- Cards enter **L → R**, stagger ~0.12 s: blur 10px → 0, desaturated/gray → full color, y +16px → 0, scale 0.96 → 1, ~0.5 s each.
- Progress bar (a short ink line on a hairline track) grows linearly over the autoplay interval (≈ 4 s), then resets as the row advances.

### M18. App dock
- **Trigger:** enter. Center icon first (scale 0.6 → 1, blur → 0), then the next ring outward, stagger ~0.05 s, ~0.4 s each. The center icon is ~1.6× the size of its neighbors, sizes fall off toward the ends.

### M19. Big card shrinks into a fisheye grid
- **Trigger:** scrub, pinned in practice. Video: 32.3-33.6 s.
- **Card:** rises from the bottom at full width (~93vw, radius ~2.4vw, landscape ~2.3:1). As its top passes ~50% vh it starts shrinking toward the **center cell**, changing aspect to portrait (~0.8:1). Width over time: 93 → 87 → 77 → 68 → 58 → 49 → 42 → 37 → 33 → 29 → 27vw (ease-in-out: slow, fast in the middle, long settle). ~1.2 s total.
- **Tiles:** appear at the halfway point **from behind the card**: each tile starts near the card's center, scale ~0.7, opacity 0, and translates out to its cell (ease-out, ~0.4 s), inner ring first.
- **Final grid** (`17-fisheye-grid-center-card.jpg`): 5 columns × 3 rows of portrait tiles; column widths **11.4 / 13.1 / 13.7 / 13.1 / 11.4vw** and column tops arched (center column highest, outer columns ~3.3vw lower), so the grid bulges like a dome. Center card 25.5vw × 32vh, radius ~2.2vw, overlapping its neighbors.
- **Garnish** after the card lands (~0.2-0.4 s): white "♥ Like" pill (top-right), "@artist" speech chip rotated −10° (red-orange), creator row (avatar, name, source) on a bottom gradient.

### M20. Pricing fan
- **Trigger:** enter. Three cards rise from ~+20vh, stagger ~0.08 s, settle into tilts (−2°, 0° raised ~1.6vw, +4°). The "Popular" sticker pops last.

### M21. Lime marquee band
- **Trigger:** loop. Huge text (~4.5vw, medium weight, ink) moves **left** continuously at ~5vw/s; inline stickers (an app icon, a poster thumbnail with a 2-line micro caption, a 3D sculpture) sit between phrases at cap height. The band is a tall rounded panel, inset to the content width, with a faint tone-on-tone white swirl pattern.

### M22. Physics icon drop
- **Trigger:** enter (when the lime panel's top reaches ~40% vh), plays once, ~1.5 s.
- ~12 line icons in white circles (~5vw) spawn in a stream (~80 ms apart) near the top-left under the marquee text, fall with gravity, bounce once or twice (restitution ~0.3-0.4), roll and rotate, and pile along the panel's bottom edge, spreading left → right. Final pile is a loose single/double layer, not a heap.

### M23. Feature cards
- **Trigger:** enter. Cards rise with the page; the cut-out art on the right card overflows the card's top edge (layered above the card).

### M24. Nav
- Fixed, transparent, never hides. Images that scroll up pass behind the nav items. No background blur in the video.

### Scroll rhythm
- Every section is ~1 viewport tall. Glides between sections take 0.4-0.8 s; holds 2-3 s. ~17 viewports in ~42 s.

---

## 3. Typography

| Element | Size (vw @ 998) | ≈ px @ 1440 | Weight | Leading | Tracking | Notes |
|---|---|---|---|---|---|---|
| Hero H1 (centered, 2 lines) | 5.4vw (cap ≈ 3.9vw) | 78 px | 500 | 1.08 | ≈ −0.04em | Line 1 ≈ 50vw wide |
| Centered section H2 ("You will find yourself…") | 5.0vw | 72 px | 500 | 1.05 | −0.04em | |
| Left H2 ("Showcase, Sell,…", "Gateway…", "Marketplace…") | 4.4-5.0vw | 64-72 px | 500 | 1.05-1.1 | −0.035em | Hard-left at the 7.2vw gutter |
| Manifesto (3 centered lines) | 3.8vw | 55 px | 500 | 1.15 | −0.03em | ~80vw wide lines |
| Small H2 ("Trusted by the best.", "Our vision…", "Membership") | 2.6-2.7vw | 38 px | 500 | 1.15 | −0.03em | |
| Marquee band text | 4.5vw | 65 px | 500 | 1 | −0.03em | |
| Card titles | 1.3-1.6vw | 19-23 px | 500 | 1.2 | −0.01em | |
| Body | 1.1-1.3vw | 16-19 px | 400 | 1.5 | 0 | Max ~35-45ch, 2-4 lines. Copy is tiny on purpose |
| Eyebrow | 0.8vw | 11-12 px | 600 | 1 | +0.2em | Uppercase; last word accent |
| Nav | 1.0vw | 14 px | 500 | | | |
| Chips | 1.4vw | 20 px | 500 | | | |

- **Face:** a neo-grotesk, medium weight, tight tracking, double-story "a", straight-tailed "y" (Aeonik / Neue Montreal family). Closest Google Fonts: **Inter Tight 500** (−0.035em) or **Geist 500**. In-family substitute for homecookd: **DM Sans 600, `opsz` 40, −0.035em** (see `palette-type.md`). Only one family on the whole page; hierarchy comes from size, weight 400/500/600 and the two-tone gray.
- **Colors:** filled ink `#161616`; unfilled ghost `#C0C0C0-#D0D0D0` on `#F7F7F7` (≈1.5:1, decorative); body `#3A3A3A`; canvas `#F7F7F7` (hero `#F3F3F3` + satin texture).
- **Accent words:** exactly **one colored phrase per heading or eyebrow**: crimson `#982C2C` ("& acquire arts to"), mint ("unique"), blue-violet ("TELLING"), magenta ("CLOSER"). Chip colors: royal blue `#063FD4`/`#2F5BEA`, sage `#7FB89D`, crimson `#8E2219`, black `#1C1C1C`, amber `#F2B705`, orange-red. Lime band `#E9F66D`. Orange highlight card `#EC7012`. Footer panel `#EFEFEF`.

---

## 4. Spacing & layout system

- **Gutters:** content sections use a single left/right gutter of **~7.2vw** (≈104 px @ 1440); content width **~85.5vw** (≈1230 px). Nav uses ~5.5vw. The lime band and footer panel are inset to the content width (~8-9vw each side).
- **Section rhythm:** each section ≈ **100vh**; content occupies ~40-60% of the area, the rest is empty canvas. Typical stack: eyebrow → (1vw) → H2 → (1.5-2vw) → body → (2.5vw) → buttons; heading → content block gap ~3-4vw.
- **Hero vertical map:** H1 top ~20% vh; fan centerline ~60% vh; sub-copy ~78% vh; CTA ~88% vh.
- **Cards:** radius ~1.2-1.6vw for normal cards (≈ 18-24 px @ 1440), ~2.2-2.4vw for the big image/center cards (≈ 32-35 px). Shadows are soft and low-contrast (≈ `0 10px 30px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)`), never hard. No borders except white cards on white panels.
- **Card sizes:** hero fan cards 14-16vw; staircase cards 15-19.5vw; grid tiles 11-14vw; thumbnails 6.5-7.5vw; feature cards ~40vw wide.
- **Rotations:** chips −10° to +8°; fan −8° to +6°; pricing −2° / 0 / +4°; thumbnails −8° to +8°. Everything else is straight.
- **Chips:** fully rounded speech bubbles with a small tail (bottom-left or bottom-center), ~7vw × 3vw, padding ~0.6em 1em, white text on a saturated fill (or white on black), a faint top highlight.
- **Pills/buttons:** black pill ~10.7vw × 3vw (≈ 150 × 44 px), white text; text-link secondary; small white pills on photos ("Watch", "Like"); round 2.5vw icon buttons for arrows.
- **Backgrounds:** one neutral canvas everywhere (#F7F7F7) except the hero texture, the one lime band, and the footer panel. Color comes from the images.

---

## 5. What makes it feel premium & clean

1. **One object travels the whole page.** The same deck of cards fans out, collapses into a sticky stack, re-fans as a staircase, then folds into a grid. Scroll feels like one continuous film, not a stack of sections.
2. **Type does the talking.** Huge, medium-weight, tightly tracked headlines of 2-3 lines, centered or hard-left on one gutter. Body copy is a supporting whisper.
3. **Two tones instead of more sizes.** Ink + ghost gray gives hierarchy and rhythm; the same gray is the "not yet read" state of the word reveal, so motion and hierarchy share one language.
4. **One accent per heading, color from content.** Neutral canvas and near-black UI; all saturation comes from images and a few small chips.
5. **Air.** Each section is a viewport with roughly half of it empty; one gutter, consistent alignment.
6. **A small, strict motion grammar.** Text: blur + rise + gray→ink, per word, ~0.1 s stagger. Objects: ease-out-expo glides and springs. Idle: gentle wobbles and drifts. Nothing bounces hard, nothing spins.
7. **Tactile depth.** Big radii, soft shadows, slight tilts, overlapping layers, a floor shadow under the fan: real objects on a table.
8. **Product garnish.** Speech-bubble chips, tiny "Watch"/"Like" pills, arrow buttons, a progress bar: it reads as a living product, not a poster.
9. **Rhythm by alternation.** Centered statement → left text/right visual → centered statement…, with a single loud color block (lime) late in the page.
10. **Restraint in copy.** Headings of 2-6 words, one or two short lines of body. Visuals carry the story.

---

## 6. a7 → homecookd mapping

Recipe card anatomy (every card in every scene): dish photo (top ~70%), dish name in the display font, "by Grandma" / "by Dad" meta in DM Sans, one **feel quote** in the cook's own words on a highlighter or tinted pill ("a handful", "until it smells nutty", "you'll know"), and a small "▶ Watch" pill. Tints and bold cards from `palette-type.md` (sage, butter, lemon, peach, blush, ube; bold green, forest, sun, chartreuse). Mix 2-3 bold cards among light ones, as a7 mixes vivid and pale art. Relations rotate across cards: Mom, Dad, Grandma, Grandpa, Auntie, Lola, Abuela, Nonno, Halmeoni… Cultures vary; translation appears only as examples.

Speech chips (a7's @usernames) become **who-said-it bubbles** in brand colors: green `#5B6F00` with cream text, sun `#FEBE29` with ink, forest `#34430C` with chartreuse, tomato `#E95D3D` with ink. Text: the relation, or the relation + a feel phrase ("Grandpa: 'low and slow'").

| # | a7 pattern | homecookd equivalent |
|---|---|---|
| 1 | Hero load build: per-word headline, one card rising, fan, chips, CTA (M1-M7) | Founder requires a **real family-cooking video** hero with a huge headline + big CTA, so: full-bleed video, headline builds per word (cream over the green-ink scrim), CTA blurs in. Then **Twist 1** (below): on scroll the video shrinks into the front recipe card and the deck fans out of it, giving us a7's fan right after the hero. |
| 2 | Fan of 7 cards + floating chips (M6-M7) | 7 recipe cards from 7 cooks: "Grandma's red-braised pork belly", "Dad's Sunday chili", "Lola's adobo", "Mom's lemon rice", "Grandpa's chimichurri", "Abuela's pozole", "Halmeoni's kimchi jjigae". Chips: "Grandma" (forest), "Dad" (sun), wobbling. Headline above it: the brand line (e.g. "Culture we want to preserve, and pass down."). |
| 3 | Fan collapses into a sticky stack and travels (M8) | The deck collapses into "your family's stack" and travels into the next scene: one persistent object = **your recipes, kept together**. |
| 4 | Left text + diagonal staircase (M9) | **How it works**: left "Set up your camera. / Cook like always. / Done." (middle line in `--green`), one line of body, CTA. Right: the staircase is **one recipe's steps** (Twist 2): each card is a real frame from the cook's video with the app's "▶ 0:42 – 1:58" pill and a feel amount ("2 big scoops ~1.5 cups"). |
| 5 | Wide image card with "Watch" pill, arrows, swinging chip (M10) | "Watch her hands." A wide card plays a **real app screen recording** or the real cook clip, with the app's own "▶ Watch · 0:42–1:58" pill bottom-left, step arrows bottom-right, and a swinging speech chip "Hear Grandma" with a tiny waveform. |
| 6 | Logo marquee "Trusted by the best." (M11) | **No fake logos or social proof.** Replace with a slow gray marquee of what families call their cooks: "Mom · Dad · Grandma · Grandpa · Mamá · Papá · Nonna · Lola · Halmeoni · Baba · Ammi · Opa · Auntie…" under a two-tone heading "Every family calls them **something.**" (last word ghost). Universal, every gender, many cultures. |
| 7 | Manifesto with an inline thumbnail that grows into a stack + gray→ink fill (M12) | Problem statement, scrubbed: "Family recipes live in **a handful** [inline recipe-card thumbnail] of this, **you'll know** [pinch icon], cooked all day [pot icon] and never written down." The inline thumbnail grows into the deck; the deck shuffles front cards (three cooks). Accent phrase in `--green` (or on `--highlighter`). Tail stays `--ghost` until the next beat. Chips: "Mom", "Grandpa". Icon row below: Watch · Hear · Translate. |
| 8 | Stack drops into a big staircase with an info card (M13) | "From one recording": the deck unfurls into 6-7 **step cards** with a recipe header card at the top-left ("Lola's chicken adobo · 8 steps · ~1 hr · from 2 recordings"). Chip "Hear Lola" (sun). |
| 9 | Staircase folds into a 3x2 grid inside a folder, icon cluster (M14) | **Storing recipes**: the steps fold into a **family recipe box**: 3x2 recipe-card grid with folder tabs named after people ("Grandma's" active in `--forest`, "Dad's" behind, "+ Add a recipe" pill, echoing the app's family-table chips). Left: heading "Kept in one family recipe box." + body + a cluster of kitchen line icons in white circles (whisk, wooden spoon, pot, chili, garlic, timer, flame, rolling pin, ladle). |
| 10 | Thumbnail cloud around a centered headline (M15) | "Everyone's at the table." Two wavy, counter-drifting rows of family photos and dish close-ups: grandpa folding dumplings, a dad at the grill, an abuela pressing tortillas, a college kid cooking in a dorm, a mom and son tasting from a spoon. Center: heading + "Moms, dads, grandparents, aunties: every kitchen has someone worth learning from." |
| 11 | Staggered bento with "Play video" card + phone mock with a picker wheel (M16) | "Every recipe tells a story." Bento: (a) **real app screen recording in a phone frame** (Cook mode: Watch + Hear the cook); (b) a story card with the cook's quote and the "a family story" tag; (c) **translation phone**: the picker wheel cycles languages (English → Español → Tagalog → 한국어 → हिन्दी → 中文), the center line showing the same step in that language with the cook's original kept above; (d) a grandparent + grandchild photo card. Inner parallax as in a7. |
| 12 | Carousel with progress bar + "View All" (M17) | "Recipes that travel": carousel of recipe cards from the family table; progress bar in `--green`; pill "See the family table". |
| 13 | App dock (M18) | **Easy sharing**: a dock of share targets drawn as generic glyphs (message bubble, envelope, link, QR code, family group), the homecookd pot-mascot app icon big in the center. Line: "Send it home in one tap." No third-party brand logos. |
| 14 | Big card shrinks into the center of a fisheye grid (M19) | **Sharing → storing, one motion**: a full-width photo/video of a family meal rises and shrinks into the center card of a grid of recipe cards from many families. Center-card garnish: "♥ Saved" pill, speech chip "from Mom" (rotated −10°), creator row "Mom · Sunday pancakes · sent to Maya". |
| 15 | Pricing card fan with huge numerals (M20) | **The 3-step pitch** in a7's pricing style: three cards with huge numerals: "1 · Prop your phone", "2 · Cook like always" (raised, `--green` card with a sun "That's it" sticker), "3 · Done: steps, amounts & their voice". Or "Free during early access" if we need a pricing beat. |
| 16 | Lime marquee band + physics drop (M21-M22) | `--chartreuse` (#D1E043) band, ink text, marquee of feel words with translations as examples: "a handful ✿ un puñito ✿ you'll know ✿ until it smells right ✿ ein bisschen ✿ andaaze se ✿ low and slow ✿", with inline food stickers (garlic, chili, lemon, dumpling). Physics drop: **ingredient stickers** (garlic, chili, star anise, basil, lemon, egg, bay leaf, peppercorn, green onion) fall and pile up; the **pot mascot drops last and lands on top** (quirk). |
| 17 | Two tall feature cards, one with overflowing cut-out art (M23) | Two audiences: **"Far from home."** photo card (college student cooking in a small kitchen, cream text, pill "For students") and **"A quieter kitchen."** white card for parents, with a cut-out steaming dish whose steam overflows the card's top edge (pill "For parents"). |
| 18 | Footer panel | Keep a7's rounded inset panel for link columns on `--footer-bg`, then the **a3 savor wordmark animation** ("homecookd", per `lander-spec.md` 5.12). |

Also needed (outside a7): the **a8 phone-in-hand features** section (one background, no split) slots in naturally between rows 10 and 11, reusing a7's left-text/right-visual layout with the real app recording in the phone.

### Creative twists that keep the a7 feel

- **Twist 1, "The video becomes the recipe."** The hero's full-bleed family video shrinks (M19 in reverse: `clip-path` inset from full-bleed to a card rect) into the **front recipe card** of the deck; title, "by Grandma" and her feel quote fade onto it; then the other 6 cards fan out from behind it (M6). It tells the product story in one motion: someone cooks → it becomes a recipe card your family keeps.
- **Twist 2, "Steps are stairs."** The diagonal staircase is literally a recipe's steps. The pot mascot hops down one stair per ~15% of scroll progress (tiny squash on landing, a steam puff), so the stair reads as "follow along, step by step".
- **Twist 3, "Words that translate as they fill."** In the manifesto and the marquee, a few cook phrases fill gray → ink in their original language ("un puñito"), then flip (rotateX 90° → 0, 0.4 s) to English ("a little handful") with the original kept small underneath. That's the translation feature in a7's motion grammar, and it respects the rule that the cook's own words always stay visible.
- **Quirk:** speech chips occasionally show a "…" typing bubble for 0.6 s before the word appears, like a message arriving from home. Respect reduced motion (show the word directly).

---

## 7. Implementation notes (Next.js App Router + TypeScript)

### Library split
- **Lenis** for smooth scroll (lerp ~0.09, `smoothWheel: true`, native on touch). Disable under reduced motion.
- **GSAP ScrollTrigger** for the 3 multi-state pinned choreographies (deck A, manifesto→staircase→grid C, big card→grid D): timelines with labels + `pin: true` + `scrub: 0.6` are the most direct way to keyframe one object through several layouts. Sync with Lenis: `lenis.on('scroll', ScrollTrigger.update); gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0)`.
- **motion** (`motion/react`) for enter reveals (`whileInView`), chip springs and wobbles, hover, the carousel, the share dock. Pure `motion` also works for the pinned scenes (sticky container + `useScroll({ target, offset })` + `useTransform` per card); pick one engine per scene, don't mix both on the same element.

### Recommended scroll lengths (scene track heights)
| Scene | Track | Notes |
|---|---|---|
| A1 Hero video → front card (Twist 1) | 100vh pinned + 100vh hero | Card rect reached at ~70% progress, title fades in 70-90% |
| A2 Fan spread + headline fill | 80vh | Fan p: 0 → 1 over 0-60%; chips pop at 60% (time-based once) |
| A3 Deck collapse → staircase (How it works) | 120vh | Collapse 0-40%, travel 40-60%, staircase 60-100% |
| B Manifesto (inline thumbnail + fill) | 200vh pinned | Thumbnail growth 0-30%, word fill 10-75%, shuffle 30-70%, tilt 70-85%, drop 85-100% |
| C Steps staircase → recipe-box grid | 150vh pinned | Hold staircase 0-30% (mascot hops), fold 30-70%, tabs + icons 70-100% |
| D Big card → fisheye grid (sharing) | 150vh pinned | Rise 0-25%, shrink 25-75% (ease-in-out), tiles 45-80%, garnish time-based at 80% |
| Everything else | natural height (~100vh each) | `whileInView` with `viewport={{ once: true, amount: 0.35 }}` |
Total page ≈ 13-15 viewports of scroll. Keep pinned tracks ≤ 200vh so the 58-year-old visitor never feels stuck.

### Word reveal (enter) with `motion`
```tsx
'use client';
import { motion, useReducedMotion } from 'motion/react';

const word = {
  hidden: { opacity: 0, y: '0.3em', filter: 'blur(8px)', color: 'var(--ghost)' },
  show: {
    opacity: 1, y: 0, filter: 'blur(0px)', color: 'var(--ink)',
    transition: {
      duration: 0.55, ease: [0.25, 1, 0.5, 1],
      color: { duration: 0.6, delay: 0.12 },        // gray first, then ink
    },
  },
};

export function WordReveal({ text, as: Tag = 'h2', stagger = 0.1 }: { text: string; as?: any; stagger?: number }) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  if (reduce) return <Tag>{text}</Tag>;
  return (
    <Tag aria-label={text}>
      <motion.span initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.6 }}
        transition={{ staggerChildren: stagger }} aria-hidden style={{ display: 'inline' }}>
        {words.map((w, i) => (
          <motion.span key={i} variants={word}
            style={{ display: 'inline-block' }}>
            {w}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        ))}
      </motion.span>
    </Tag>
  );
}
```
- Accept React nodes, not only strings, so inline thumbnails, icons and chips can be "words".
- Accent words: pass a per-word end color (`var(--green)`), start from a pale tint of it.
- Keep `aria-label` on the heading and `aria-hidden` on the split spans so screen readers read one sentence.

### Word fill (scrub) for the manifesto
- Pin a 100vh sticky stage inside a 200vh track. `const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })`.
- For word *i* of *N*: `const a = 0.10 + (i / N) * 0.62; color = useTransform(scrollYProgress, [a, a + 0.06], ['var(--ghost)', 'var(--ink)'])` (interpolate hex values; CSS vars can't be interpolated, so pass hex strings from the tokens).
- **Don't scrub `filter: blur`** on dozens of words (repaints every frame). Scrub color + a small `y` only; use blur only in one-shot enter animations.
- The fill stops at ~75% so the tail stays ghost (two-tone end state).

### The persistent deck (A1-A3, B, C)
- Render the deck **once** per pinned track, absolutely positioned inside the sticky stage; the section text lives in normal flow and scrolls past (text layer above the deck layer, as in a7).
- Define layouts as pure functions returning `{x, y, rotate, scale, z}` per card in vw/vh:
  - `stack(i)`: `x = -0.6 * (n-1-i)` vw, `rotate = -1 * (n-1-i)`°, `scale = 1 - 0.02 * (n-1-i)`.
  - `fan(i)`: `t = i/(n-1) - 0.5`; `x = t * 56` vw; `rotate = t * 14 - 1`° (−8° → +6°); `y = 8 * t * t` vw (smile); `scale = 0.88 + 0.48 * t * t` (center ~0.88, edges ~1.0); `z = i`.
  - `stairs(i)`: `x = i * 12.2` vw, `y = i * 4` vw (or an eased curve for the big staircase), `rotate = 0`, `scale = 1.3`.
  - `grid(i)`: row/col slots in the 3x2 folder grid.
- GSAP: one timeline per track, `tl.to(cards, { ...per-card function values, ease: 'expo.out' }, 'fan')` etc., `scrollTrigger: { trigger, start: 'top top', end: '+=120%', pin: true, scrub: 0.6, invalidateOnRefresh: true }`. Function-based values (`x: i => fan(i).x + 'vw'`) keep it short.
- The intro fan (hero load) is time-based: play `gsap.fromTo` once on mount, then hand control to the scrubbed timeline (`ScrollTrigger` with `onEnter`/`immediateRender: false`), or use `motion`'s `animate()` on the same MotionValues before scroll starts.

### Big card → fisheye grid (D) and Twist 1
- Animate the media with `clip-path: inset(T R B L round Rpx)` from full-bleed to the target cell's rect (measured once with `getBoundingClientRect` on a hidden placeholder in the final grid, refreshed on resize). Clip-path changes aspect ratio without distorting the image and avoids layout. Alternatively a FLIP with `scaleX/scaleY` on the wrapper and inverse scale on the inner image.
- Tiles: `x/y` from `(center - cell) * 0.7` to 0, `scale 0.7 → 1`, `opacity 0 → 1`, stagger by ring distance (`stagger: { each: 0.04, from: 'center', grid: [3, 5] }` in GSAP).
- Fisheye: final tile widths 0.83× (outer columns) / 0.96× (inner) / 1× (center), outer columns translateY +3.3vw.

### Loops
- **Marquees** (logo/relation names, lime band, thumbnail rows): CSS only. Duplicate the track content once, `@keyframes slide { to { transform: translateX(-50%) } }`, `animation: slide 45s linear infinite` (reverse direction for the second cloud row). Speed targets: lime band ~5vw/s, relations ~3vw/s, cloud rows ~2.5vw/s. Optional: add `useVelocity(scrollY)` to nudge speed while scrolling.
- **Chip wobble:** `animate={{ rotate: [-3, 3, -3], y: [0, -3, 0] }}` with `transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: random }}`. Pop-in: `type: 'spring', stiffness: 500, damping: 18`, `transformOrigin` at the tail tip.
- **Physics drop:** prefer a **fake**: precompute ~12 final pile positions, then animate each sticker with `y` (spring, `bounce: 0.35`), slight `x` drift and `rotate` (−120° to 120°), staggered 80 ms. It looks the same as Matter.js at a fraction of the cost and is deterministic. Use real Matter.js only if we want drag-to-toss (desktop only).
- **Picker wheel (translation):** a vertical list in the phone; every 1.6 s shift by one row (`y` spring); style by distance from center: 0 → white/ink 100%, 1 → 45% opacity, scale 0.92, `blur(1.5px)`; 2 → 20%.

### Performance cautions
- Animate `transform` and `opacity` only (plus `color` and `clip-path` where noted). Blur only for one-shot enters on ≤ 20 elements at a time; set `filter: none` after.
- `will-change: transform` only on pinned-scene cards and marquee tracks, and only while the scene is active.
- Images via `next/image` with `sizes`: deck cards ~480-640 px wide sources, thumbnails ~200 px, AVIF/WebP. Preload only the hero video poster and the 7 deck card images.
- Hero video: muted, `playsInline`, `autoPlay`, `loop`, poster frame, 1080p H.264 + WebM ≤ 4-5 MB; pause offscreen (IntersectionObserver) and give it a visible pause button.
- Measure rects on mount + `ResizeObserver`, never per frame. `ScrollTrigger.refresh()` after fonts (`document.fonts.ready`) and images load. Use `anticipatePin: 1`.
- Test on a mid-range Android phone: target 60 fps on desktop, ≥ 45 fps on mobile; if a scene drops frames, cut its card count first.

### Mobile adaptations (≤ 768 px)
- Hero headline 12-14vw (≥ 44 px), 3-4 lines, left-aligned or centered; CTA full-width, ≥ 56 px tall.
- Fan: 5 cards, cards ~34vw, spread ~90vw, rotations ±10°. Pin lengths × 0.6.
- Staircase: steeper diagonal (x step 9vw, y step 16vw) or a horizontal snap row of step cards.
- Manifesto: 8-9vw text (~36 px), 5-7 lines; inline thumbnail stays 1em; pin 150vh max.
- Folder grid: 2 columns × 3 rows; icon cluster above the heading.
- Thumbnail cloud: tiles ~18vw, 7 per row, keep the drift.
- Fisheye grid: 3 columns, center card 50vw.
- Physics drop: final pile rendered static, or the fake drop with 8 stickers.
- Body ≥ 17 px, tap targets ≥ 48 px, chips never carry essential info. (a7's 11-16 px body copy must **not** be copied.)

### Reduced motion (`prefers-reduced-motion: reduce`)
- Wrap scroll scenes in `gsap.matchMedia()` with `'(prefers-reduced-motion: no-preference)'`; in `motion`, branch on `useReducedMotion()`.
- Text: render final state (ink, no blur, no offset), or a 200 ms opacity fade at most.
- Pinned scenes: **unpin** and render each scene's final layout statically: hero video shows its poster with a play button, fan static, staircase static, recipe-box grid static, fisheye grid static.
- Marquees and cloud rows: stopped; let users scroll the row horizontally.
- Chip wobble, mascot hop, physics, picker auto-advance, translation flips: off (show the translated line with the original above it).
- Lenis off (native scroll).
- Never put content only in a motion state: if JS fails, the SSR HTML must show the final, readable layout (gate the "hidden" initial states behind a `data-motion="on"` attribute set on mount).

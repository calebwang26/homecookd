# Secondary references: implementable spec

Oct 12, 2026 · Covers a1, a2, a3, a4, a5 (VERO), a6, a8, a9 & `app-mockups.webp`. The a7 favorite and Granola have their own analyses. This file **refines** `docs/lander-spec.md` §4–8 and replaces it where they disagree. Caleb's Oct 12 feedback overrides both: universal English, real app recordings, green + yellow palette, and brown & black as accents only.

**Units.** Sizes are px at a **1440 × 900** desktop viewport unless noted, and `vw` means % of 1440. I measured everything from the reference frames and scaled it to 1440. VERO's video shows the site at 1240 px wide, so its numbers are ×1.161; Savor's footer is ×1.095. Numbers marked *observed* are what the reference does, and the ones marked *use* are what we build.

**Color tokens** used below. The palette spec sets the final hex values; the ones shown here are placeholders that follow the brief.

| Token | Placeholder | Role |
|---|---|---|
| `--canvas` | `#F7F7F2` | page background (fixed by Caleb) |
| `--cream` | `#FFFDF7` | cards, type on photos & dark blocks |
| `--olive` | `#5B6F00` | primary buttons, links, progress (fixed family) |
| `--olive-deep` | `#33410A` | deep color blocks, wordmark, headings on light |
| `--lime` | `#D4E03F` | CTA on video, stickers, marquee band (Graza CTA measured `#D1E030`) |
| `--saffron` | `#FFBE2E` | yellow color block, highlighter (app `#FEBE29`) |
| `--butter` | `#FDF0C8` | soft yellow block (VERO butter measured `#FDEFCA`) |
| `--tomato` | `#EB5E3F` | tiny accents only: heart, one sticker, a dot |
| `--brown` | `#5C3A24` | accent only: Caveat notes, small icons |
| `--ink` | `#14160C` | accent only: black pill buttons, scrim base (olive-black, not pure black) |

---

## 1. Hero & heading scale (a2 + a1 + a9)

### 1.1 What each one does

| Ref | Observed | Take | Leave |
|---|---|---|---|
| **a2 Savor** | The headline is **≈14.5vw font**, 2 lines, filling **56% of the width**. Its line-height is **≈0.76**, so the descender of "good" touches "from" on the line below, which is why it feels enormous. Left gutter 3.25vw; last baseline sits **5% of the viewport height** from the bottom. Subhead in a right column at **x = 67%**, ~21 px, 2 lines; button 255 × 68 with "Watch —— Episode", cream `#F0E7D8` on gold. | Scale, tight leading, the bottom-left anchor, and the subhead + CTA in a right column bottom-aligned to the headline's last baseline. Also the rule-between-words button label. | The abstract texture (we show people) and the rectangular button (ours are pills) |
| **a1 Graza** | A full-bleed video of **hands doing the thing** that reads with the sound off. The whole frame is dimmed ~35–45% (sampled bg `#616367`). Headline is only **5vw** (≈72 px), which Caleb called too small. CTA: chartreuse `#D1E030` pill, **27vw wide** but only 36 px tall, mono label. | Video of the real activity, a heavy warm dim, and a **wide chartreuse pill**, which fits our green + yellow palette exactly | The small headline, the 36 px button height, the mono font, the product-on-counter framing |
| **a9 Luminate** | Emotional **close-up faces** in golden light. The subject fills the right 55% of the frame with eyes at ~40% height; text at left 13%. Headline ≈5.5vw serif. A **dark ticker band** (≈60 px, `#252515`) runs under the hero with yellow `#FFC90C` sparkle separators. Cream `#F8EFD4` sections; **big staggered photo pairs** (two portrait photos, the second dropped ~170 px). Yellow rectangular buttons. | Faces up close, warmth, yellow accents on cream, the ticker band, and photos that take ≥ 50% of a section's area, staggered | Small body text, the generic serif, the services grid, tiny rectangular buttons, the "Drag" cursor |

### 1.2 homecookd hero composition (use)

- **Box:** `height: 100svh; min-height: 640px`, full-bleed `<video autoplay muted loop playsinline preload="metadata" poster>`, `object-fit: cover`.
- **Footage brief (for the stock picker):** a family cooking together at home, e.g. a parent or grandparent with an adult child or a kid, hands working at the stove or counter, laughing, steam. The **faces sit in the right 55% and upper 45%**; the **lower-left 45% × 45% is calm** (counter, soft background) because the headline goes there. Warm, golden, shallow depth of field; slow push-in or gentle handheld. No exteriors, no buildings, no studio kitchens, no overhead flat-lays. Any culture; choose one that reads universal.
- **Encode:** a 1920×1080 H.264 at CRF 23–26 (≤ 6 MB, 10–20 s seamless loop, no audio), a 1280×720 file for mobile (≤ 3 MB), and a poster JPG (≤ 200 KB). Mobile `object-position: 65% 35%` (tune per clip) so faces stay in frame.
- **Load motion (VERO hero, §4.3):** the video wrapper goes `scale 1.12 → 1` over 1.6 s, `power2.out`, while the headline letters grow up from the baseline.
- **Scrim.** Use olive-black, never brown or pure black. Three layers on `.hero::after`:
  ```css
  background:
    linear-gradient(180deg, rgb(20 22 12 / .35) 0%, rgb(20 22 12 / 0) 18%),                         /* nav */
    linear-gradient(0deg,   rgb(20 22 12 / .72) 0%, rgb(20 22 12 / .38) 38%, rgb(20 22 12 / 0) 64%), /* bottom */
    linear-gradient(90deg,  rgb(20 22 12 / .42) 0%, rgb(20 22 12 / 0) 58%);                          /* left */
  ```
  Mobile: make the bottom layer start at `.80`. **Check it:** export the 5 brightest frames and measure the text area. Cream text needs ≥ 4.5:1 for the subhead and ≥ 3:1 for the 100 px+ headline. Command: `ffmpeg -i hero.mp4 -vf "crop=iw*0.55:ih*0.45:0:ih*0.55,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null -`. Any YAVG above ~110 means the bottom scrim stop needs to go up.
- **Headline:** Fraunces, `wght 720`, `SOFT 100`, `opsz 144`, cream `--cream`.
  - Size: `font-size: clamp(56px, 11vw, 176px)`, which is **158 px at 1440**. `line-height: .9; letter-spacing: -.03em`.
  - Layout: 2 lines (3 on mobile), max width 66vw. Anchored bottom-left: `left: 3.5vw; bottom: 7svh`.
  - One word in **Fraunces italic `WONK 1`** on the yellow highlighter with ink text, e.g. the rotating relation **Mom → Dad → Grandma → Grandpa**. It swaps every 2.8 s with the arc reveal (§4.2) and holds on "Mom" when the user prefers reduced motion.
  - Mobile (390 px wide): `15vw` ≈ 58 px, `line-height .95`.
- **Right column (a2):** `left: 68vw`, width 26vw, bottom-aligned to the headline's last baseline.
  - Subhead: DM Sans 22 px / 1.4 in cream, 2 lines max.
  - Primary CTA: a `--lime` pill, **68 px tall, ≥ 300 px wide, 20 px DM Sans 600** in ink, with a 52 px `--olive-deep` circle holding a cream → arrow, inset 8 px on the right (the VERO pill, §4.6).
  - Secondary: a cream 2 px outline pill, 60 px tall, "▶ See it work".
  - Mobile: both stack under the headline at full width.
- **Ticker band (a9), directly under the hero:**
  - 60 px tall `--olive-deep` band. Cream DM Sans 18 px / 600, `--saffron` ✦ separators.
  - Content is recipe names by relation, e.g. "Mom's dal ✦ Grandpa's pierogi ✦ Abuela's pozole ✦ Dad's Sunday chili ✦ Lola's adobo ✦ Nonna's ragù".
  - Scrolls 45 s linear, loops, pauses on hover/focus; static with reduced motion.
  - It doubles as the seam the a4 curtain slides over (§6).
- **Pause control:** a 48 px round cream-outline button, bottom-right at `right: 3.5vw; bottom: 7svh`.

### 1.3 Heading scale for the whole page (use)

| Style | Desktop | at 1440 | Mobile (390) | Leading / tracking |
|---|---|---|---|---|
| Hero H1 | `clamp(56px, 11vw, 176px)` | 158 | 58 | .90 / −.03em |
| Section H2 (a9/a7 "big headings") | `clamp(44px, 6.2vw, 100px)` | 89 | 44–48 | .96 / −.025em |
| Statement on a color block (VERO) | `clamp(36px, 4.4vw, 72px)` | 63 | 34 | 1.08 / −.015em |
| Feature H3 (a8 list) | `clamp(32px, 3.6vw, 56px)` | 52 | 30 | 1.0 / −.02em |
| Card title | 28–32 | 30 | 24 | 1.1 |
| Body | 20 / 1.55 | 20 | 18 / 1.55 | — |
| Caption / eyebrow / legal | ≥ 16 | 16 | 16 | eyebrow +.08em caps |

Rule of thumb: H1 : H2 : body ≈ **8 : 4.5 : 1**. A section never carries more than **one H2 + ≤ 2 lines of body**. The visual carries the rest.

---

## 2. Photo-background sections (a6)

**Observed.** The photo fills the section; it was muted and warm and sampled about `#474033` in the background. A softly lit woman fills the **left 35–40%** with a shallow depth of field. Text starts at **x = 41%**. The headline is ≈3.4vw (48 px) white sans with **one italic serif word** ("we *actually* help"). A row of **white cards** (470 × 263 px at 1440, radius ≈ 23 px, 27 px gap) bleeds off the right edge as a carousel peek. A stats row sits up top.

**Use:**
- **Box:** `min-height: 100svh`, `<img>` (or a muted video) with `object-fit: cover`.
  - Subject on one side, 35–45% of the width; mirror the side between consecutive photo sections.
  - **Grade every photo the same:** warm, a little grain, faces never over-sharpened.
- **Desktop scrim, text side only:** `linear-gradient(90deg, rgb(20 22 12 / 0) 30%, rgb(20 22 12 / .50) 62%, rgb(20 22 12 / .58) 100%)`; flip it when the subject is on the right. The subject's face is never under more than 15% darkening.
- **Text column:** starts at 42vw (or ends at 58vw when mirrored), max width 40rem. H2 at the §1.3 size; we go bigger than a6. Cream, with one italic Fraunces word inside the heading (e.g. "Far from *home*").
- **Cards:**
  - Size & surface: `--cream`, 440–480 px wide, radius 24, padding 24–28, ink text, no hard shadow (one soft shadow `0 12px 40px rgb(20 22 12 / .18)` at most).
  - Layout: a row with `overflow-x: auto; scroll-snap-type: x mandatory`. The last card **peeks 30–40%** off the right edge, gap 24.
  - Content: **recipe cards** (photo, dish, "by Grandma · 3 hrs", the cook's own words in a tinted pill), never reviews.
- **Mobile, the important part:**
  - Stack: the photo's sharp part takes the top **55svh** (subject's face). The text block follows over the **same photo, blurred**.
  - Build it with a duplicate image layer (more reliable than `backdrop-filter` with a mask on iOS):
    ```css
    .photoSection .blurLayer { position:absolute; inset:0; background:inherit; /* or a 2nd <img> */
      filter: blur(22px) saturate(1.1); transform: scale(1.12); /* hides blurred edges */
      mask-image: linear-gradient(180deg, transparent 0, transparent calc(55svh - 80px), #000 55svh);
      -webkit-mask-image: linear-gradient(180deg, transparent 0, transparent calc(55svh - 80px), #000 55svh); }
    .photoSection .blurTint { position:absolute; inset:0;
      background: linear-gradient(180deg, transparent calc(55svh - 80px), rgb(20 22 12 / .52) 55svh); }
    ```
  - The blur ramps in over **80 px**, a progressive edge with no hard seam. Cards become a horizontal snap row of 84vw cards.
- **Leave:** the stats row, star ratings, dollar amounts and "Founder of…" titles. We have no real numbers, so we invent none.

---

## 3. Phone-in-hand feature demo (a8, on ONE background)

### 3.1 How a8's composition works
- **Layout:** a 2000×1500 board. The **left panel** (49% wide) is flat green `#308C3D`. A **cut-out photo of a hand** holds an upright phone (≈ 0–2° tilt) whose screen shows the app.
- **Phone size:** outer width **50% of the panel = 25% of the board**; height **71% of the panel**. Top edge 6% from the panel top, phone center at 47% of the panel width. The **hand enters from the bottom-left and bleeds off the bottom edge**; that bleed is what makes it feel held, not placed.
- **Background art:** behind the hand, one **broad tone-on-tone ribbon** (~40 px wide, `#348F40`, only ~2% lighter) loops across the panel. It's barely visible but stops the flat color feeling empty.
- **Right side:** white cards on a mint `#E6F8EB` board. **This is the split Caleb dislikes.**

### 3.2 Our version: one color, sticky phone, features scroll past
- **Background:** the section is a single color edge to edge, with no white panel.
  - **Recommended:** `--olive-deep` with one tone-on-tone ribbon in `color-mix(in oklab, var(--olive-deep), white 5%)`, cream text, lime number pills. The bright app screen pops on dark olive the way a8's white phone pops on green.
  - **Alternative**, if the neighboring sections are already dark: `--butter` with a `--saffron`-toned swirl (VERO's own phone-in-hand section, §4.5) and `--olive-deep` text.
- **Asset:** a transparent WebP/PNG of a **hand holding a modern iPhone, straight-on, ≤ 6° tilt**, with the **screen area knocked out** (transparent), ~1400 px tall. Stack:
  1. `.screen` holds the `<video>`s, absolutely positioned to the measured screen rect in % of the asset box, with `border-radius: 13.5% / 6.2%` (iPhone 15 screen corners: ≈ 55 pt on 393 × 852) and the same `rotate()` as the phone.
  2. `<img class="hand">` sits on top, so **fingers overlap the phone edges**.

  If we can't find a knocked-out asset, use a hand photo plus our own soft-white phone frame (like the app mockups) on top of the video.
- **Desktop geometry (1440 × 900):**
  - Grid: `grid-template-columns: 50vw 1fr`.
  - **Stage** (left): `position: sticky; top: 0; height: 100svh; overflow: clip`.
  - **Phone:** outer width `clamp(260px, 21vw, 340px)` (≈ 300 px), visible height ≈ 68–72% of the viewport (~630 px). Top edge at 9svh, horizontal center at **25vw**. The hand bleeds off the stage's bottom edge.
  - A soft `--lime` or `--saffron` blob (blurred 60 px, 30% opacity) sits behind the phone.
- **Feature list** (right column):
  - Placement: starts at 55vw, max width 34rem, sits on the same color.
  - Each `<li>` is `min-height: 90svh`, content vertically centered:
    - number pill "01" (lime, ink, 36 px tall)
    - H3 (§1.3)
    - 1–2 lines of 20 px body
    - one small **real-app chip** for flavor (e.g. the "▶ 0:42 – 1:58" time pill, or the language switch)
  - Inactive items sit at 35% opacity; the active one is 100%, with a 300 ms transition.
- **Features (Caleb's pitch: set up → record → done, then the payoffs).** Each `<li>` pairs with one screen recording:
  1. **Prop up your phone.** Recording: the record screen.
  2. **Cook like always.** Talking welcome. Recording: recording in progress or the upload.
  3. **The recipe writes itself.** "A handful" stays her words, with "~½ cup" under it. Recording: recipe card, Watch / Hear on a step.
  4. **In your language, in their words.** Recording: the translate switch flipping the recipe.
  5. **Send it to the family.** Recording: the family library, then share.
- **Swap logic** (CSS sticky, no GSAP pin needed, works with Lenis):
  ```ts
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
  }, { rootMargin: '-50% 0px -50% 0px' });            // a line at the viewport middle
  // on setActive(i): videos[i].currentTime = 0; videos[i].play(); others pause();
  // crossfade: .screen video { opacity:0; transition: opacity .45s cubic-bezier(.22,1,.36,1) } video.is-active { opacity:1 }
  ```
  - The phone gets a tiny scale settle on each swap (`.985 → 1`, 450 ms).
  - Progress: 5 small pills under the phone (active one is 28 px wide and lime, others 8 px at cream 40%).
  - Videos: `muted playsinline loop preload="none"`, posters always set, and only the active and next videos get `preload="auto"`.
- **Recordings:**
  - Capture: the **real Expo app** from the simulator (`xcrun simctl io booted recordVideo --codec=h264 out.mp4`) or an iPhone screen recording. Set the clock first with `xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100`. Light mode, slow deliberate taps, 6–10 s per clip.
  - Encode: `ffmpeg -i in.mov -vf "scale=590:-2,fps=30" -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -movflags +faststart -an f1.mp4`, plus a poster from `-frames:v 1`.
- **Mobile (< 900 px): no sticky.** Each feature stacks as number, H3, line, then its own phone (width `min(64vw, 300px)`, hand optional and cropped). Its video plays when ≥ 50% visible and pauses when it leaves. This is simpler and kinder to a 58-year-old thumb.
- **Reduced motion:** posters only, with a ▶ button on each phone; no crossfade scale.
- **Leave:** the split background, white data-viz cards, the stock-farmer app, and the "Nutri-Score" chart look.

---

## 4. VERO (a5): Caleb's favorite restaurant site

### 4.1 Font character & closest Google Fonts match
- **Observed:** a **chunky, low-contrast, soft-bracketed serif** (Recoleta-like) in heavy weights, used in deep green or cream.
  - Tight spacing (≈ −.02em), big round counters, ball-ish terminals.
  - Its **bold italic** is quirky and calligraphic ("A good *BUNCH*", "*and brighten up your lunch breaks*").
  - Headings are sentence case or Title Case, 2–5 words.
  - Body is a plain geometric sans at 14–16 px.
- **Use Fraunces (variable), with all axes loaded:**
  ```ts
  import { Fraunces, DM_Sans, Caveat } from 'next/font/google';
  const fraunces = Fraunces({ subsets:['latin'], axes:['SOFT','WONK','opsz'], style:['normal','italic'], variable:'--font-display' });
  ```
  - Headings: `font-weight: 720; font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 72; letter-spacing: -.02em`. Hero & wordmark use `opsz 144`.
  - Warm emphasis: `font-style: italic; font-weight: 700; font-variation-settings: "SOFT" 100, "WONK" 1`. One phrase per heading at most.
  - True match, if we ever buy it: Recoleta (Latinotype). Free fallback with similar heft: Young Serif (single weight); no italic, so use it only for statements.
  - Body stays **DM Sans**; Caveat for notes.

### 4.2 Section headline "arc unfurl" (exact per-letter recipe)
**Observed** (30 fps frames of "Order Anytime / With Our App"):
- Letters arrive **left to right**. Each one starts **tiny (~20%)**, **rotated clockwise up to ~80–90°**, and **dropped ~0.9em below the baseline**, then rotates, scales and lifts onto the line.
- Several letters are mid-flight at once, and later ones are earlier in their own animation, so they sit lower, smaller and more rotated. That makes the word look like it's **unrolling off a wheel / bending down along an arc** (frame: `Order A n y t ı ɜ .` with the tail curving down-right).
- In-flight letters keep roughly their final x, so small glyphs read as **wide tracking that tightens** as they settle.
- Line 2 starts while line 1's tail is still settling, ≈ 200 ms after line 1's first letter.
- In the video: ≈ 15–20 ms stagger and ≈ 300–400 ms per letter. The shot looks sped up, so we slow it down.

**Use:**
```ts
// markup: <h2 class="unfurl"><span class="w"><span class="c">O</span>…</span> <span class="w">…</span></h2>
// .w { display:inline-block; white-space:nowrap }  .c { display:inline-block; will-change:transform }
const chars = h2.querySelectorAll('.c');
const stagger = Math.min(0.026, 0.55 / chars.length);           // long headings never exceed ~1.25 s
gsap.from(chars, {
  opacity: 0, scale: 0.2, rotate: 80, x: '0.22em', y: '0.6em',
  transformOrigin: '0% 100%',                                    // pivot at bottom-left of each glyph
  duration: 0.7, ease: 'expo.out',                               // = cubic-bezier(0.16, 1, 0.3, 1)
  stagger,                                                       // one global index across lines -> line 2 overlaps line 1
  scrollTrigger: { trigger: h2, start: 'top 85%', once: true },
});
// opacity reaches 1 early: add a second tween { opacity:0 -> 1, duration:0.18, stagger } or use keyframes.
```
- Use it for H2s and color-block statements only, never body text. Keep `aria-label` on the `<h2>` with the full text, and give the char spans `aria-hidden="true"`.
- With `motion` instead of GSAP: `animate(chars, {opacity:[0,1], scale:[.2,1], rotate:[80,0], x:['.22em',0], y:['.6em',0]}, {delay: stagger(0.026), duration:.7, ease:[.16,1,.3,1]})` inside `inView(h2, …, {amount:.2})`.
- **Reduced motion:** headings render static.

### 4.3 Hero "grow from the baseline" (on load)
- **Observed:**
  - The photo starts zoomed (~1.12) and settles to 1 over ~1.5 s.
  - Letters of both lines start **at the same moment** (A & B together), each **growing proportionally from ~30% scale while sitting on the baseline**, upright, with no rotation.
  - ≈ 65 ms stagger, ≈ 300 ms per letter; the headline completes in ≈ 0.7 s.
  - Subhead & pill fade up at ~0.45 s.
- **Use:** per line, `gsap.from(lineChars, {opacity:0, scale:.3, y:'.04em', transformOrigin:'50% 100%', duration:.6, ease:'expo.out', stagger:.055})`. Every line starts at t = 0.15 s.
  - Subhead & CTAs: `{opacity:0, y:16, duration:.6, ease:'power3.out', delay:.55, stagger:.08}`.
  - Rotating relation word: when it swaps, the outgoing word fades in 200 ms and the incoming one plays the §4.2 unfurl with a 20 ms stagger.

### 4.4 Content reveals & section rhythm
- **Section size:** every VERO section is **one viewport tall** (~100vh), content vertically centered. Sections butt edge to edge with **hard color changes** and no rounded section corners; only the photo cards are rounded.
- **Reveal order:** the headline unfurls first. Photo cards ease up `y 40 → 0`, `opacity 0 → 1`, 0.8 s `cubic-bezier(.22,1,.36,1)`, stagger 0.08 s, starting 0.25 s after the headline; images inside go `scale 1.08 → 1`.
- **Grouped cards** (the saffron "offers" stack) appear as a **thin translucent bar that unfolds in height** (≈ 8 px → full, 450 ms, `power3.out`). The items inside then fade in with an 80 ms stagger. Use this for a stack of recipe cards or "what you get" chips.
- **Food trio (canvas section):**
  - Heading centered, 58 px at 1440, `line-height 1.0`, `--olive-deep`.
  - 3 cards, each 409 × 449 (≈ 0.91 aspect), 23 px gap, radius 16, 102 px (7vw) side margins, 52 px below the heading.
  - Each card has a **centered cream label pill** (142 × 46, 14 px dark-green text, 20 px from the bottom).
  - **Use:** recipe photos labeled with the cook ("Grandma's", "Dad's", "Mom's"). Our radius is 24 to match the app.

### 4.5 Color blocks, swirls, cutouts, stickers, inline icons

**Measured VERO colors → our mapping (green + yellow fit):**

| VERO block | Measured | Fits? | Our block |
|---|---|---|---|
| Deep green statement | `#03401F`, cream `#FDF5E8` text | **Yes** | `--olive-deep` + cream; italic phrase in `--saffron` |
| Saffron "Eat more" | `#F0A120` | **Yes** | `--saffron` + `--olive-deep` text (cream only ≥ 48 px and only if it passes 3:1) |
| Butter app section | `#FDEFCA` | **Yes** | `--butter` + `--olive-deep` text |
| Tomato red split & CTA | `#DC3026` | **No** as a block | Swap for `--lime` (ink/olive-deep text) or `--olive`. Tomato survives only as a sticker or heart |
| Cream canvas | `#FDF5E8` | — | `--canvas #F7F7F2` |

Use at most one bold block every 2–3 sections.

- **Swirl pattern:** large organic **topographic bands** (filled bands, not thin lines). Bands are ~40–70 px wide at 1440 and only **ΔL ≈ 3–5%** off the block color (saffron `#F0A120` vs `#EF9920`; butter bands ≈ `#FEF6DC` on `#FDEFC4`).
  - Build: generate once at build time and save as a static SVG per block (`/public/patterns/swirl-olive.svg`, etc.).
  - Recipe: `simplex-noise` (scale ≈ 0.0022 on a 1600 × 1000 field, 2 octaves) → `d3-contour` thresholds every 0.11 → **fill every other band** with the tone color.
  - Apply with `background: var(--olive-deep) url(...) center/cover`. Never behind body-size text on light blocks if it hurts contrast. **Never behind the footer wordmark.**
- **Two-tone split section** ("Dine in…"):
  - Color half **54%**, full-bleed photo half 46%, no gap. Heading 54 px at 1440 (≈ 3.75vw), `line-height 1.07`, max 590 px wide, left padding 6.2vw.
  - Under it: body 16–18 px in cream, then the VERO pill.
  - **Use** for one problem beat (e.g. "Miles apart.", with an `--olive` half and a photo of a kid calling home).
- **Burst/star cut-outs** ("Hungry? We're Ready."):
  - Shape: 8-point stars, outer Ø ≈ **354 px (≈ 25vw)**, inner radius ≈ 0.62, rotated −8° / +12°. Centered vertically on the block, **bleeding ~25 px off the left & right edges**.
  - Left star: a photo clipped to the star.
  - Right star: a yellow star **plus a cut-out person whose head breaks out past the star's top edge** (pop-out).
  - Build:
    ```ts
    export const starClip = (n = 8, inner = .62, rot = 0) => 'polygon(' + Array.from({length: n*2}, (_, i) => {
      const r = i % 2 ? 50*inner : 50, a = Math.PI*i/n - Math.PI/2 + rot*Math.PI/180;
      return `${(50 + r*Math.cos(a)).toFixed(2)}% ${(50 + r*Math.sin(a)).toFixed(2)}%`; }).join(',') + ')';
    // pop-out: <div style={{clipPath: starClip()}}> bg photo or --saffron </div> + an unclipped transparent PNG of the person on top, bottom-aligned.
    ```
  - Entrance: `scale .6 → 1, rotate −20° → final`, 0.9 s `expo.out`, after the headline.
  - **Use** on the final CTA block: a grandparent laughing (left) and a young adult tasting from a spoon (right).
- **Scalloped sticker** ("ORDER NOW"):
  - Shape: a cream circle Ø **215 px** (`#F7F1CD`) holding a yellow **wavy seal** (`#F8C43A`, ~75% Ø, 14–16 bumps), with 2 lines of uppercase dark-green type centered (16 px, Fraunces 800).
  - Placement: on the right of the saffron block at ~65% height, overlapping the photo's edge.
  - **Use:** `--saffron` seal on a cream disc, `--olive-deep` text "HEAR / GRANDMA ▶" or "FREE / EARLY ACCESS". The seal ring slowly rotates (24 s/turn, text static), static with reduced motion.
  - Seal path: sample 360 points of `r(θ) = R·(1 − .07·(.5 − .5·cos(16θ)))`.
- **Cut-out person on a color block** ("Eat More Save More"):
  - Composition: a background-removed portrait, bottom-aligned, center-right, head near the top edge. Heading top-left, cream, ≈ 72 px.
  - A translucent cream "stack" container (6 px `rgb(255 255 255/.35)` ring, radius 14) holds 3 cream rows (`#F5EACC`, radius 10, 18 px dark-green title + 14 px line).
  - **Use:** a saffron block with a cut-out grandparent holding a spoon toward the viewer. The stack holds 3 of the cook's own words ("a handful", "till it smells nutty", "you'll know") with our ~estimate under each.
- **Inline icon in a statement** ("…smile on your lips ✿ *and brighten up your lunch breaks*"):
  - Icon: a yellow 6-petal flower **at cap height**, size `1em`, `vertical-align: -.12em`, margin `0 .14em`. It sits **between the upright half and the italic half**, so it marks the turn to warm italic.
  - Statement: centered, max 62% wide (≈ 894 px), cream on deep green, 3 lines.
  - **Use:** our pot mascot (or the app's sparkle) in `--saffron`. It pops in after the preceding word lands: `scale 0 → 1, rotate −25° → 0`, 0.5 s `back.out(1.4)`, the only "bouncy" moment, and kept tiny. Example: "Her voice on every step [pot] *and her stories in between.*" Rewrite with universal relations: "Their voice… *their stories*", or rotate the relation.
- **VERO pill button:**
  - Shape: cream `#FBEFE1` pill (197 × 66 at 1440, 16 px label in the block color) with a **filled circle (≈ 50 px) holding a white arrow, inset 4–8 px on the right**.
  - Hover: the circle slides 4 px right and the label shifts 2 px.
  - **Use:** for every primary CTA (lime/cream/olive variants), always ≥ 60 px tall.
- **VERO's own phone-in-hand** ("Order Anytime With Our App"): **one color (butter + swirl)** edge to edge.
  - Phone ≈ 350 px wide (24vw), ≈ 67% of the section height, tilted ≈ −12°, held from the bottom-right with the hand cropped by the section bottom.
  - Heading left at 7.4vw, ≈ 52 px. It's proof that a8's idea works on a single background (see §3).

**Leave from VERO:** fake reviews and star ratings, "% off" offers, the red as a big block, App Store badges (we're early access), the 4-column menu grid, and stock models eating at the camera. Our people cook *together*.

---

## 5. Savor footer (a3): the wordmark that grows from its thickest strokes

### 5.1 Observed timing (10 fps frames)
- The footer scrolls in with the wordmark **fully invisible**; there is no flash of the finished word.
- The first sliver appears inside the **spine of "s"** about 0.1 s after the wordmark enters view.
- Next letters start at **≈ 200 ms intervals** (s 0.0 → a 0.2 → v 0.4 → o 0.6 → r 0.8 s).
- Each letter takes **≈ 0.9–1.1 s**: thick stems and bowls show first as **thin pointed slivers centered in the stroke**, then swell to full weight. **Hairlines, joins, serifs and the "r" ear arrive last.**
- Whole word ≈ **1.8 s**, played once.

That is **morphological erosion**: a background-colored outline that starts wider than the thickest stroke and shrinks to 0.

### 5.2 Implementation (A: HTML, quickest; needs a solid footer background)
`homecookd` in Fraunces measures **3.07em of ink width** at weight 900 (3.02em at 800), and the ink height is **0.77em**. The thickest strokes are ≈ 0.18–0.20em.
```css
.wordmark { font-family: var(--font-display); font-weight: 900;
  font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
  font-size: calc((100vw - 2 * var(--gutter)) / 3.07);       /* ≈ 30.7vw at 1440 → fills edge to edge */
  line-height: .8; letter-spacing: -.01em; color: var(--olive-deep); white-space: nowrap; }
.wordmark .c { display: inline-block; position: relative;
  -webkit-text-stroke: var(--erode, 0px) var(--footer-bg); paint-order: normal; } /* stroke paints over fill */
/* hidden state only when JS + motion are OK, so no-JS & reduced-motion users see the finished word */
html.motion-ok .wordmark .c { --erode: .26em; }
/* earlier letters paint ABOVE later ones so a later letter's outer stroke can't bite a finished neighbor */
.wordmark .c:nth-child(1){z-index:6} .wordmark .c:nth-child(2){z-index:5} /* …down to 1 */
```
```ts
const fs = parseFloat(getComputedStyle(wordmark).fontSize);
gsap.fromTo(wordmark.querySelectorAll('.c'),
  { '--erode': `${fs * .26}px` },
  { '--erode': '0px', duration: 1.0, ease: 'power2.inOut', stagger: .14,   // 6 letters → ≈ 1.7 s total
    scrollTrigger: { trigger: wordmark, start: 'top 85%', once: true } });
```
- The stroke straddles the outline, so erosion depth = width ÷ 2. At **0.26em**, nothing shows; at about 0.12em, only stems and bowls peek through, which is the Savor look.
- Measure `3.07` with the shipped font settings once (SOFT and opsz change widths slightly). Or fit at runtime: `font-size = targetWidth / (measuredWidth / currentFontSize)` on resize.
- `--footer-bg` must be **solid & identical** behind the word: no grain, swirl or gradient.

### 5.3 Implementation (B: exact, works over any background)
- **Per-letter SVG mask:** for each letter, `<mask><text fill="#fff" stroke="#000" stroke-width={w} stroke-linejoin="round">e</text></mask>` drawn over the same `<text fill="var(--olive-deep)">`.
- Get letter positions with `textEl.getStartPositionOfChar(i)` after the font loads (`document.fonts.ready`).
- Animate each mask's `stroke-width` from `0.52em` (mask strokes are full width, so double it) to 0 with the same timing.
- It can't bite neighbors and allows a textured footer. Use B if A shows artifacts in Safari.

### 5.4 Footer layout (Savor, scaled to 1440)
- **Box:** `min-height: 100svh`. Background **one tone deeper than the section above** (Savor: page `#FDF8EC` → footer `#EBE4D1`). For us: `--butter`, or a soft lime-cream like `#EEF0DA` (palette spec decides). Wordmark in `--olive-deep`. Padding 112 top / 2.8vw (40 px) sides / 48 bottom.
- **Top row, 12-column grid:**
  - Nav column 1 at the left edge; nav column 2 at +230 px. DM Sans 17 px, 28 px rows.
    - Column 1: How it works · Stories · For families · Questions.
    - Column 2: Instagram · TikTok · Contact.
  - Right block starts at **59% (col 8)**, ~500 px wide:
    - Prompt: 30 px DM Sans 400, line-height 1.2, 3 lines max, e.g. "Hungry for home? Get early access and be the first to cook with your family."
    - 32 px below it, the button: `--olive-deep` pill, cream label, 68 px tall, ~220 px wide, label "Get —— early access" with a 36 px, 1 px rule between the words (Savor's "Join —— now").
- **Wordmark:** 180 px below the button, spanning 94% of the width edge to edge.
- **Legal row:** 60 px below the wordmark, 15–16 px. Privacy · Terms · Photo credits on the left; hello@ in the center; © homecookd 2026 on the right.
- **Mobile:** nav stays 2 short columns, then the prompt (24 px) and a full-width 60 px button. The wordmark uses the same fit formula with 16 px gutters (≈ 31vw). The legal row stacks centered.
- **Leave:** Savor's maroon `#2C0307` (brown/black are accents only) and the rectangular button.

---

## 6. a4: the next section slides over the pinned hero
- Hero `position: sticky; top: 0; height: 100svh; z-index: 0`.
- The next section (the ticker band + first canvas section) has `position: relative; z-index: 1; border-radius: 36px 36px 0 0`, with a soft top shadow `0 -24px 60px rgb(20 22 12 / .18)`.
- Scrubbed while it covers: hero video `scale 1 → .94`, `filter: brightness(1 → .55)`, with `scrollTrigger {scrub: true, start: 'top bottom', end: 'top top'}` on the covering section.
- The sticky cover stays with reduced motion (it's ordinary scrolling); only the scale/dim is dropped.

---

## 7. App motifs the lander must reuse (from `app-mockups.webp`)
Build these as real HTML/CSS where text matters, so the site and the app read as one family. Use universal relations in all labels (Mom / Dad / Grandma / Grandpa), never one name.

1. **Highlighter word:** `--saffron` block behind 1–2 words, ink text, `padding: 0 .12em; border-radius: 3px; box-decoration-break: clone`. It draws in left → right once: `background-size 0 → 100%`, 450 ms, after the heading lands ("Our *family* table", "until *the ghee separates*").
2. **Caveat margin notes** in `--olive` or `--brown` (the brown accent): "6 recipes, 4 cooks, lots of love", "— Grandma, with love", "tap a line to jump there". Max 1–2 per screen, 22–26 px, with a hand-drawn arrow SVG.
3. **Sticker label:** a white pill rotated −4°, Caveat in rose, with a soft shadow ("Family favourite", "Grandma's holiday special"), stuck on the corner of a recipe photo.
4. **Pot mascot:** the smiling pot with steam, with speech lines "you've got this!" and "asking for you, gently". Use it as the logo mark, the inline statement icon (§4.5) and 2–3 small cameos.
5. **Steam squiggles & sparkle:** three wavy lines over hot food photos; a yellow + lime 4-point sparkle next to headings; large faint versions as background art (8–12% of the block color).
6. **Tinted recipe rows/cards:** rose `#F6D5CC`, peach `#F9E3CF`, sage `#E6EBCF`, lavender `#ECE6F2`, butter `#FBEFD0`. Each has a round food thumbnail, the dish in serif, "Dad · 10 min" muted, and a heart. **These are the floating recipe cards for the a7-style scenes.**
7. **Pills everywhere:**
   - Filter chips: active one ink-filled, others oat ("All · Holidays · Weeknight · Sweet").
   - Time pill on video: "▶ 0:42 – 1:58", white at 85% opacity.
   - "Watch Mom · 52 min".
   - Lavender wait banner with a moon: "After an overnight soak, about 10 hrs".
8. **The cook's words + translation:** her line in serif on top, translation in muted sans beneath, the active line on butter-soft `#FFF1C7`, and a rose "a family story" tag. This is the visual proof for the **translation** beat. The language switch is a segmented control (white selected chip on an oat track), e.g. "Tagalog · Español · English".
9. **Ingredient row:** circle checkbox, the cook's words in serif on the left ("a big handful of rice"), "~2 cups rice" muted on the right, strike-through when checked. Below the list, a sage note: "Their words first. ~ amounts are estimated from the video."
10. **Buttons & controls:**
    - Olive filled round play.
    - Olive-soft "🔊 Hear Grandma" pill.
    - Ink-black full-width "Next" (the black accent).
    - Round outlined icon buttons (×, ‹, share).
    - Floating olive "🎙 Record a recipe" pill.
    - Segmented olive step progress ("Step 2 of 9").
11. **Surfaces:** canvas `#F7F7F2`, cards radius 24–28, soft-white phone frames with a 1 px border, no hard shadows. The app uses Newsreader for titles and the lander uses Fraunces, so headings on the lander's phone visuals stay in the app's real font because they're real recordings.

---

## 8. Motion timing summary (use)

| Moment | Trigger | Duration / stagger | Ease |
|---|---|---|---|
| Hero video settle | load | 1.6 s, scale 1.12 → 1 | `power2.out` |
| Hero letters grow | load + 0.15 s | 0.6 s / 55 ms, lines in parallel | `expo.out` |
| Hero subhead + CTAs | load + 0.55 s | 0.6 s / 80 ms, y 16 → 0 | `power3.out` |
| Relation word swap | every 2.8 s | out 0.2 s; in unfurl 0.6 s / 20 ms | `expo.out` |
| H2 / statement unfurl | heading top at 85% | 0.7 s / min(26 ms, 0.55 s ÷ n) | `expo.out` |
| Cards & photos rise | +0.25 s after heading | 0.8 s / 80 ms, y 40 → 0, img 1.08 → 1 | `cubic-bezier(.22,1,.36,1)` |
| Card stack unfolds | with heading | 0.45 s height, items 80 ms | `power3.out` |
| Burst cut-outs | after heading | 0.9 s, scale .6 → 1, rotate −20° → final | `expo.out` |
| Inline icon pop | after previous word | 0.5 s | `back.out(1.4)` (only bounce on the page) |
| Highlighter draw | after heading | 0.45 s | `power2.out` |
| Phone video swap | middle line crossing | 0.45 s crossfade + .985 → 1 | `cubic-bezier(.22,1,.36,1)` |
| Curtain over hero | scroll-scrubbed | scale 1 → .94, brightness 1 → .55 | linear (scrub) |
| Ticker band | always | 45 s loop, pause on hover | linear |
| Footer wordmark erode | wordmark top at 85% | 1.0 s / 140 ms (6 letters ≈ 1.7 s) | `power2.inOut` |

Everything above respects `prefers-reduced-motion: reduce`: static text, posters instead of autoplay, no unfurl, no erosion (finished wordmark), no ticker movement. Only `transform`, `opacity` and the one-off stroke tween animate.

---

## 9. Consolidated "leave" list
Small hero headlines (a1); abstract hero textures (a2); split two-color layouts (a8); white data-viz cards (a8); stats rows, star ratings, dollar amounts, fake reviews (a5, a6, a9); red or maroon as a main color (a3, a5); App Store badges (a5); rectangular or short (< 60 px) buttons (a1, a2, a9); mono or generic serif fonts (a1, a9); any single-name or single-culture framing ("Ammi"): use rotating universal relations.

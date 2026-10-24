# C1 HEARTH: the visual system (lead designer spec)

Reference boards (built from exactly these snippets, rendered with zero warnings):
- `canvas/project/C1-Kid-Home.dc.html`  (open it; copy its tab bar, greeting, hero, section header, row)
- `canvas/project/C1-Parent-Home.dc.html` (copy its peach band, tiles, big buttons, parent tab bar)
- Component proof boards (not on the canvas): `renders/kit-test-kid.dc.html` (Subway hero, sheet,
  option boxes, Watch/Hear, Caveat, sticky CTA) and `renders/kit-test-2.dc.html` (bubble panel,
  status pills, parent Back pill, parent panel row, date tile, parent option boxes).

**Hearth in one line:** the kitchen you grew up in, morning light on the counter. Cream ground, white
rounded cards, olive-green pills, ONE yellow highlighter word per screen, cook-tinted cards, soft
shadows, faces everywhere. Calm, light, familiar. No color blocks, no dark screens, no paper/kraft,
no scalloped stickers (exception: Main may use one), no swirl patterns.

Read BRIEF.md section 8 for the file format and DIRECTION.md section C for copy. This file is the
look. Where it gives a snippet, paste the snippet and change only text, hrefs, images and positions.

---

## 1. Tokens (every hex you may use; nothing else)

| Role | Hex | Notes |
|---|---|---|
| Ground (page root) | `#F7F7F2` | every screen |
| Surface (cards, sheets, tab bar, white pills on photos) | `#FFFDF7` | |
| Sunken (round icon buttons on white, date tiles, unselected pills) | `#EFEFE6` | |
| Hairline | `rgba(71,67,42,0.14)` | 1px borders, dividers, unselected option border 1.5px |
| Empty check ring | `rgba(71,67,42,0.35)` | unselected option ring |
| Dots (inactive) | `rgba(71,67,42,0.25)` | page dots only |
| Primary | `#5B6F00` | filled buttons, check circles, selected outlines, play buttons |
| Primary deep | `#4C5A10` | green TEXT on light (outline-button labels, accent lines, active tab) |
| Sage | `#E6EBCF` | active tab pill, "Hear" voice chip, "You cooked it" pill, icon wells |
| Highlighter | `#FEBE29` | behind ONE headline word per screen (ink text only); "New from Mom" pill |
| Lemon | `#FFE59A` | Caveat signature on a dark photo scrim only |
| Heading ink | `#1E2410` | |
| Body text | `#2D3222` | |
| Muted text | `#5F6352` | the lightest text allowed; OK on canvas, cream, peach, sage, butter, ube |
| Cream text (on green or scrim) | `#FFFDF7` | |
| Heart | fill `#F2A7A0` + stroke `#9A4F47` 1.6 (saved); stroke `#9A4F47` 2, no fill (not saved) | |
| Scrim on photos | `linear-gradient(180deg, rgba(18,20,16,0) 16%, rgba(18,20,16,0.62) 38%, rgba(18,20,16,0.88) 56%, rgba(18,20,16,0.92) 100%)` (tall hero card) / `linear-gradient(180deg, rgba(18,20,16,0) 20%, rgba(18,20,16,0.7) 50%, rgba(18,20,16,0.9) 100%)` (tiles) | only gradients allowed |
| Soft shadows | card float `0 4px 18px rgba(30,36,16,0.06)`; white button on photo `0 2px 8px rgba(0,0,0,0.12)`; green CTA `0 6px 16px rgba(52,67,12,0.22)`; tab bar `0 -6px 20px rgba(30,36,16,0.06)` | no hard shadows |

**Cook tints** (cards, rows, avatar rings, initial tiles; text on them = heading ink / muted / their ink):
Mom peach `#F9E3CF` (ink `#6E4A33`) · Dad sage `#E6EBCF` (ink `#4C5A10`) · Nai Nai rose `#F6D5CC`
(ink `#5A3A22`) · Auntie Lin butter `#FFF1C7` (ink `#8A3F12`) · Leo ube `#ECE6F2` (ink `#3F3558`) ·
Maya lime-wash `#EDF2BE` (ink `#3C4A0B`).
Rule: a card/row tinted by WHO it's from or about (Mom's ramen row = peach; Leo's question = ube).
Green accent text `#4C5A10` passes on all tints. Never put `#9A4F47` text on rose (fails).

**New hexes: none.** Do not use tomato, forest blocks, chartreuse, kraft or dark grounds in C1.

---

## 2. Type

Fonts link (in `<helmet>`), exactly as BRIEF. Strings:
- Display: `font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0;`
- Body/UI: `font-family: 'DM Sans', system-ui, sans-serif;` (set on the root; inherit)
- Notes: `font-family: 'Caveat', cursive; font-weight: 600;`
- The cook's own words: Fraunces italic (`font-style: italic`), weight 400-500, in curly quotes
  `&#8220;…&#8221;`.

| Style | Kid (Leo) | Parent (Mom) | Settings |
|---|---|---|---|
| Screen headline | 40 (greeting name 34) | 44 | Fraunces 600, lh 1.05, ls -0.01em, `#1E2410` |
| Hero title on photo | 36 | 40 | Fraunces 600, lh 1.08, cream, highlighter on 1 word |
| Section header (h2) | 28 (26 inside a bubble panel) | 30 | Fraunces 600, lh 1.1 |
| Card / row title | 21 (19 inside bubble panels) | 22-24 | Fraunces 600, lh 1.2 |
| Cook's quote | 18-20 italic | 20-22 italic | Fraunces italic 400/500, lh 1.25-1.4 |
| Body | 17 | 19 (20 for greeting line) | DM Sans 400/500, lh 1.45 |
| Meta / caption | 15 (500) | 16 (500) | `#5F6352` |
| Accent info line | 15 (700) | 16 (700) | `#4C5A10` |
| Eyebrow / small label | 15 (700) | 16 (700) | ink, sentence case (no ALL CAPS in C1) |
| Button label | 18 (700) | 20-21 (700) | |
| Tab label | 13 (600; 700 active) | 14 (600; 700 active) | lh 1 |
| Caveat note | 24 | 26 | weight 600, `#5B6F00` on light, `#FFE59A` on scrim, `#8A3F12` in a cream pill |

---

## 3. Spacing, radii, sizes

- 8pt rhythm. Side margins 16px. Gaps: 6-10 inside a text stack, 12-16 between controls, 16-24
  between blocks, 24-32 before a section header.
- Top safe area: content starts at **top: 54px** (or a photo runs under it).
- Radii: sheet over hero **32** (top corners only); hero card **28**; bubble panel **28**; cards,
  tiles and rows **24**; option boxes **20**; photos inside rows/cards **16-18**; pills/buttons
  **999**; round icon buttons = circles; date tile **16**.
- Round icon buttons: kid **48** on photos / **44** in rows and headers; parent **56**.
- Buttons: kid secondary 56-60, primary 60 (hero white pill 56); parent secondary 64, primary 72.
- Avatars: 32 (inside pills) · 40-44 (chips, tiles) · 48 (header) · 56-64 (rows, options) · 92 (Main).
- Tab bar: kid **84** tall, parent **92** tall, both with `padding-bottom: 26px`. Leave ≥ 16px
  between content and the bar top (kid bar top = y 760, parent bar top = y 752), unless content is a
  deliberate peek that the bar visibly cuts.

---

## 4. Kid vs Parent deltas (C1)

| | Kid (Leo) | Parent (Mom) |
|---|---|---|
| Top of Home | Greeting row: pot mascot in a 56px peach circle, "Evening," over "Leo" (34), his avatar 48 at right → Main | **Peach band** `#F9E3CF` full width, top 0 to 232px, bottom corners 32: date line (16, `#6E4A33`), "Good morning, Mom." (20/600), headline 44 with highlighter |
| Hero | Google-TV card 342×440 + 20px peek of the next card + page dots | No carousel, no dots. HelloFresh pair of tiles (2 × 171×232) |
| Buttons | Mixed widths allowed; white pill on photos | All full width; primary 72 with a 52px cream mic circle + label + arrow; helper line under it (17, muted, centered) |
| Back | 48px round cream button, chevron only, `aria-label="Back"` | Pill 56 tall: chevron + the word "Back" (19/700) |
| Rows end in | Round heart button (save) or green play button (voices) | Round **arrow** button 56 (`#EFEFE6`); no hearts |
| Sections visible | Up to 3 | Max 2 |
| Decoration | One each max: mascot, Caveat note, steam, Caveat pill on photo | One per screen; mascot only on Main / empty states |
| Selected outline | 2.5px + 24px check | 3px + 32px check, option 88px tall with a face |
| Tab bar | 84 tall, icon 26, pill 64×32, label 13 | 92 tall, icon 28, pill 72×36, label 14 |
| Time of day | Evening (Sun Oct 12, 9:40 pm) | Morning (Mon Oct 13, 8:10 am) |

---

## 5. Snippets (copy-paste)

Every line below was checked against the rendered boards. Only placement differs: where a snippet
has `position: absolute; left/top…`, those numbers are for the board it came from; in a flow layout
drop them (or set your own), and where a snippet has none, wrap it in your own positioned container.

### 5.1 Page root (both)
```html
<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: #F7F7F2; font-family: 'DM Sans', system-ui, sans-serif; color: #2D3222">
  …
</div>
```
Wrap it in the exact BRIEF section 8 skeleton (support.js line, helmet with fonts link + `body{margin:0}`
+ `a{color:inherit;text-decoration:none}`, the `x-dc` script block).

### 5.2 KID tab bar (Home active, as on C1-Kid-Home)
```html
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 84px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #FFFDF7; border-top: 1px solid rgba(71,67,42,0.14); box-shadow: 0 -6px 20px rgba(30,36,16,0.06)">
  <a href="C1-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #4C5A10">
    <span style="width: 64px; height: 32px; border-radius: 999px; background: #E6EBCF; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 700; line-height: 1">Home</span>
  </a>
  <a href="C1-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #5F6352">
    <span style="width: 64px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Recipes</span>
  </a>
  <a href="C1-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #5F6352">
    <span style="width: 64px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Ask</span>
  </a>
  <a href="Main.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #5F6352">
    <span style="width: 64px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Family</span>
  </a>
</nav>
```
**Active-state variants (kid).** To make ANY tab active, make exactly these four edits to that tab and
undo them on Home:
1. add `aria-current="page"` to the `<a>`;
2. `<a>` color `#5F6352` → `#4C5A10`;
3. inner pill span gets `background: #E6EBCF;` (64×32 stays the same; inactive tabs keep the
   transparent 64×32 span so nothing shifts);
4. label `font-weight: 600` → `700`, and add `fill="currentColor" fill-opacity="0.2"` to the icon's
   main shape: Home → the house `<path>`; Recipes → the first book `<path>`; Ask → the bubble `<path>`;
   Family → the first `<circle cx="9" …>` and the first `<path d="M2.5 20…">`.

Which tab is active: Kid-Home + Kid-Home-Scrolled = Home; Kid-Browse = Recipes. (Ask is never active in
our 9 boards; Family = Main has no tab bar.) Kid-Recipe has NO tab bar (back + sticky CTA).

Ready-made active Recipes tab (for Kid-Browse; set Home back to inactive):
```html
  <a href="C1-Kid-Browse.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #4C5A10">
    <span style="width: 64px; height: 32px; border-radius: 999px; background: #E6EBCF; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v13.5"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 700; line-height: 1">Recipes</span>
  </a>
```
Inactive Home tab (for Kid-Browse):
```html
  <a href="C1-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #5F6352">
    <span style="width: 64px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Home</span>
  </a>
```

### 5.3 PARENT tab bar (Home active, as on C1-Parent-Home)
```html
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 92px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #FFFDF7; border-top: 1px solid rgba(71,67,42,0.14); box-shadow: 0 -6px 20px rgba(30,36,16,0.06)">
  <a href="C1-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 60px; color: #4C5A10">
    <span style="width: 72px; height: 36px; border-radius: 999px; background: #E6EBCF; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 700; line-height: 1">Home</span>
  </a>
  <a href="C1-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 60px; color: #5F6352">
    <span style="width: 72px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600; line-height: 1">My recipes</span>
  </a>
  <a href="C1-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 60px; color: #5F6352">
    <span style="width: 72px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600; line-height: 1">Record</span>
  </a>
  <a href="Main.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 60px; color: #5F6352">
    <span style="width: 72px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600; line-height: 1">Family</span>
  </a>
</nav>
```
**Active-state variants (parent):** same four edits as the kid bar (aria-current, color `#4C5A10`,
pill `background: #E6EBCF` on the 72×36 span, label 700 + icon shape `fill="currentColor"
fill-opacity="0.2"`; My recipes → first book path; Record → the `<rect>`; Family → first circle +
first path). Parent-Home and Parent-Home-Scrolled = Home active. Parent-Recipe and Parent-Send have
NO tab bar (Back pill + sticky CTA). Do not make "My recipes" active on Parent-Home-Scrolled (it is
the same Home page scrolled).

### 5.4 KID greeting row (top of Kid-Home; reuse on Kid-Browse with a different first line)
```html
<div style="position: absolute; left: 16px; right: 16px; top: 54px; display: flex; align-items: center; gap: 12px">
  <div style="width: 56px; height: 56px; border-radius: 50%; background: #F9E3CF; display: flex; align-items: center; justify-content: center; flex: none">
    <!-- pot mascot (kit/pot-mascot.svg.txt, smile version) at width 40 height 37 -->
    <svg width="40" height="37" viewBox="0 0 100 92" aria-hidden="true">
      <g fill="none" stroke="#B9A48F" stroke-width="3" stroke-linecap="round"><path d="M38 22c-4-5 4-8 0-13" /><path d="M52 20c-4-5 4-8 0-13" /><path d="M66 22c-4-5 4-8 0-13" /></g>
      <path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill="#F6BFA8" stroke="#6E5A4C" stroke-width="3.5" stroke-linejoin="round" />
      <path d="M22 52h-8M78 52h8" stroke="#6E5A4C" stroke-width="5" stroke-linecap="round" />
      <ellipse cx="50" cy="42" rx="31" ry="7" fill="#F2A98F" stroke="#6E5A4C" stroke-width="3.5" />
      <circle cx="50" cy="33" r="4.5" fill="#6E5A4C" />
      <circle cx="40" cy="59" r="3.6" fill="#4A3B30" /><circle cx="60" cy="59" r="3.6" fill="#4A3B30" />
      <ellipse cx="33" cy="66" rx="5" ry="3" fill="#FFB8AE" /><ellipse cx="67" cy="66" rx="5" ry="3" fill="#FFB8AE" />
      <path d="M45 65q5 5 10 0" fill="none" stroke="#4A3B30" stroke-width="3" stroke-linecap="round" />
    </svg>
  </div>
  <div style="flex: 1; display: flex; flex-direction: column">
    <span style="font-size: 17px; line-height: 1.2; color: #5F6352; font-weight: 500">Evening,</span>
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 34px; line-height: 1.05; color: #1E2410; letter-spacing: -0.01em">Leo</span>
  </div>
  <a href="Main.dc.html" aria-label="Switch person" style="width: 48px; height: 48px; border-radius: 50%; position: relative; overflow: hidden; flex: none; box-shadow: 0 0 0 2.5px #F7F7F2, 0 0 0 4.5px #ECE6F2">
    <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%">
  </a>
</div>
<p style="position: absolute; left: 16px; right: 16px; top: 120px; margin: 0; font-size: 17px; line-height: 1.45; color: #2D3222">Sunday at home means dumplings.</p>
```
Kid screens WITHOUT the greeting (Kid-Home-Scrolled, Kid-Browse) start with a headline instead:
`<h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 40px; line-height: 1.05; letter-spacing: -0.01em; color: #1E2410">Our <span style="background: #FEBE29; padding: 0 6px; border-radius: 6px">family</span> table</h1>`
(Kid-Home-Scrolled is a scrolled page: no greeting, content simply continues from the top edge, and
it may open with a section header cut by the top, or with the "Picked for you" header at ~top 54px.)

### 5.5 PARENT header: the peach band (top of Parent-Home and Parent-Home-Scrolled)
```html
<div style="position: absolute; left: 0; right: 0; top: 0; height: 232px; background: #F9E3CF; border-radius: 0 0 32px 32px"></div>
<div style="position: absolute; left: 16px; right: 16px; top: 54px; display: flex; flex-direction: column; gap: 6px">
  <span style="font-size: 16px; font-weight: 600; line-height: 1.4; color: #6E4A33">Monday, October 13</span>
  <span style="font-size: 20px; font-weight: 600; line-height: 1.3; color: #1E2410">Good morning, Mom.</span>
  <h1 style="margin: 4px 0 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 44px; line-height: 1.05; letter-spacing: -0.01em; color: #1E2410">What will you teach <span style="background: #FEBE29; padding: 0 6px; border-radius: 6px">Leo</span> next?</h1>
</div>
```
Parent-Home-Scrolled: the band is scrolled away; start with a section header at top 54px (no band),
or show only the band's bottom 40px cut by the top edge. Parent detail screens (Recipe, Send) do NOT
use the band; Parent-Send is "Back" pill + headline on the canvas ground.

### 5.6 Section header (+ optional round arrow button)
Kid (28px; arrow 44 on `#EFEFE6`, icon-only allowed on kid with aria-label):
```html
<div style="display: flex; align-items: center; justify-content: space-between">
  <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 28px; line-height: 1.1; color: #1E2410">Picked for you</h2>
  <a href="C1-Kid-Home-Scrolled.dc.html" aria-label="See all picked for you" style="width: 44px; height: 44px; border-radius: 50%; background: #EFEFE6; display: flex; align-items: center; justify-content: center; color: #1E2410">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</div>
```
Parent (30px). Parent headers have NO icon-only arrow; if a "see all" is needed use a text link
(`font-size: 17px; font-weight: 700; color: #4C5A10` "See all") or nothing:
```html
<h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 30px; line-height: 1.1; color: #1E2410">From Leo</h2>
```

### 5.7 Buttons
**Kid primary / sticky CTA** (detail screens; 60 tall on a cream bar with a hairline top):
```html
<div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 16px 30px; background: #FFFDF7; border-top: 1px solid rgba(71,67,42,0.14)">
  <a href="C1-Kid-Recipe.dc.html" style="height: 60px; border-radius: 999px; background: #5B6F00; color: #FFFDF7; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 18px; font-weight: 700; box-shadow: 0 6px 16px rgba(52,67,12,0.22)">Start cooking
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</div>
```
Parent sticky CTA: same bar, button `height: 72px; font-size: 21px` (Parent-Send "Send to Leo" 72),
then the reassurance line under the button inside the bar: `<p style="margin: 10px 0 0; text-align: center; font-size: 17px; font-weight: 500; color: #5F6352">You can close the app. We'll let you know when it's ready.</p>` (bar padding becomes `12px 16px 26px`).

**Parent primary (Record a recipe, as on Parent-Home)** + helper line:
```html
<a href="C1-Parent-Send.dc.html" style="position: absolute; left: 16px; right: 16px; top: 552px; height: 72px; box-sizing: border-box; border-radius: 999px; background: #5B6F00; color: #FFFDF7; display: flex; align-items: center; gap: 14px; padding: 0 24px 0 10px; box-shadow: 0 6px 16px rgba(52,67,12,0.22)">
  <span style="width: 52px; height: 52px; border-radius: 50%; background: #FFFDF7; color: #5B6F00; display: flex; align-items: center; justify-content: center; flex: none">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
  </span>
  <span style="flex: 1; font-size: 21px; font-weight: 700; line-height: 1.15">Record a recipe</span>
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
</a>
<p style="position: absolute; left: 16px; right: 16px; top: 632px; margin: 0; text-align: center; font-size: 17px; font-weight: 500; line-height: 1.3; color: #5F6352">Cook like always. We'll write it down.</p>
```
Same pattern for "Answer with your voice" when it is THE primary of a card/screen (mic circle +
label; helper "Your answer goes right into the recipe, in your voice.").

**Secondary (outline), parent 64 / kid 56:**
```html
<a href="C1-Parent-Recipe.dc.html" style="position: absolute; left: 16px; right: 16px; top: 672px; height: 64px; box-sizing: border-box; border-radius: 999px; border: 2px solid #5B6F00; background: #FFFDF7; color: #4C5A10; display: flex; align-items: center; justify-content: center; gap: 10px">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>
  <span style="font-size: 20px; font-weight: 700">Answer Leo</span>
</a>
```
Kid version: `height: 56px`, label `font-size: 18px`, icon 22.

**Watch / Hear pair (kid recipe; parent uses the same at full width, 64 tall, label 20):**
```html
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
  <button style="height: 60px; border-radius: 999px; border: 2px solid #5B6F00; background: #FFFDF7; color: #4C5A10; display: flex; align-items: center; gap: 10px; padding: 0 14px 0 8px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
    <span style="width: 40px; height: 40px; border-radius: 50%; background: #E6EBCF; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg></span>
    <span style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15"><span style="font-size: 18px; font-weight: 700; white-space: nowrap">Watch Mom</span><span style="font-size: 15px; font-weight: 600; color: #5F6352">0:48</span></span>
  </button>
  <button style="height: 60px; border-radius: 999px; border: none; background: #E6EBCF; color: #1E2410; display: flex; align-items: center; gap: 10px; padding: 0 14px 0 8px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
    <span style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; position: relative; flex: none"><img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%"></span>
    <span style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15"><span style="font-size: 18px; font-weight: 700; white-space: nowrap">Hear Mom</span><span style="font-size: 15px; font-weight: 600; color: #4C5A10">0:24</span></span>
  </button>
</div>
```
The **voice chip** (sage pill, cook's face + name + length) is the Hear button above; use it for every
"Hear X" in C1.

**White pill on a photo (Google-TV hero CTA, kid):** see 5.10 (`Hear Mom · 0:24` with a 44px green
speaker circle). **Round arrow beside it:** 56px, `border: 2px solid #FFFDF7`, cream arrow, `aria-label`.

**Icon buttons**
- Kid on photo (Subway): 48 cream circle, shadow, `aria-label`:
```html
<a href="C1-Kid-Home.dc.html" aria-label="Back" style="position: absolute; left: 16px; top: 54px; width: 48px; height: 48px; border-radius: 50%; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.12)">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
</a>
<div style="position: absolute; right: 16px; top: 54px; display: flex; gap: 10px">
  <button aria-label="Save this recipe" style="width: 48px; height: 48px; border-radius: 50%; border: none; background: #FFFDF7; color: #9A4F47; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.12); cursor: pointer">
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="#F2A7A0" stroke="#9A4F47" stroke-width="1.6" stroke-linejoin="round"/></svg>
  </button>
  <button aria-label="Send to someone" style="width: 48px; height: 48px; border-radius: 50%; border: none; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.12); cursor: pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/></svg>
  </button>
</div>
```
- **Parent Back pill** (always the word "Back"; on a photo or on the ground):
```html
<a href="C1-Parent-Home.dc.html" style="position: absolute; left: 16px; top: 54px; height: 56px; padding: 0 22px 0 14px; border-radius: 999px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.14); box-sizing: border-box; display: flex; align-items: center; gap: 6px; color: #1E2410; font-size: 19px; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,0.08)">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Back
</a>
```
- Row heart (kid): 44 circle, `#FFFDF7` on tinted rows, `#EFEFE6` inside white panels/cards.
  Not saved: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" …>` with `color: #9A4F47`.
  Saved: `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="#F2A7A0" stroke="#9A4F47" stroke-width="1.6" stroke-linejoin="round"/></svg>`
- Row play (voices): 44 circle `#5B6F00`, cream filled play `<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>` at 20px, `aria-label="Play Nai Nai's voice"`.
- Parent row arrow: 56 circle `#EFEFE6`, ink arrow 24 (see 5.11 parent row).

### 5.8 Option boxes (ref 2: selected lights up)
Kid (two side by side, 76 tall):
```html
<div style="display: flex; flex-direction: column; gap: 8px">
  <span style="font-size: 15px; font-weight: 700; color: #2D3222">Cooking for</span>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
    <button aria-pressed="true" style="position: relative; min-height: 76px; border-radius: 20px; border: 2.5px solid #5B6F00; background: #FFFDF7; padding: 12px 14px; box-sizing: border-box; text-align: left; display: flex; flex-direction: column; gap: 2px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; top: 10px; right: 10px"><circle cx="12" cy="12" r="11" fill="#5B6F00"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="font-size: 18px; font-weight: 700; color: #1E2410">Just me</span>
      <span style="font-size: 15px; font-weight: 500; color: #5F6352">Boil 10, freeze 30</span>
    </button>
    <button aria-pressed="false" style="position: relative; min-height: 76px; border-radius: 20px; border: 1.5px solid rgba(71,67,42,0.14); background: #FFFDF7; padding: 12px 14px; box-sizing: border-box; text-align: left; display: flex; flex-direction: column; gap: 2px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
      <span style="position: absolute; top: 10px; right: 10px; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid rgba(71,67,42,0.35); box-sizing: border-box"></span>
      <span style="font-size: 18px; font-weight: 700; color: #2D3222">Friends</span>
      <span style="font-size: 15px; font-weight: 500; color: #5F6352">Cook all 40 tonight</span>
    </button>
  </div>
</div>
```
Parent (full-width stack, 88 tall, face left, big check right; "Who is it for?"):
```html
<button aria-pressed="true" style="position: relative; min-height: 88px; border-radius: 20px; border: 3px solid #5B6F00; background: #FFFDF7; padding: 12px 14px; box-sizing: border-box; display: flex; align-items: center; gap: 12px; text-align: left; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
  <span style="width: 56px; height: 56px; border-radius: 50%; overflow: hidden; position: relative; flex: none"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
  <span style="flex: 1; font-size: 20px; font-weight: 700; color: #1E2410">Leo</span>
  <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" style="flex: none"><circle cx="12" cy="12" r="11" fill="#5B6F00"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
</button>
<button aria-pressed="false" style="position: relative; min-height: 88px; border-radius: 20px; border: 1.5px solid rgba(71,67,42,0.14); background: #FFFDF7; padding: 12px 14px; box-sizing: border-box; display: flex; align-items: center; gap: 12px; text-align: left; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
  <span style="width: 56px; height: 56px; border-radius: 50%; background: #EDF2BE; color: #3C4A0B; display: flex; align-items: center; justify-content: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; flex: none">M</span>
  <span style="flex: 1; font-size: 20px; font-weight: 600; color: #2D3222">Maya</span>
  <span style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(71,67,42,0.35); box-sizing: border-box; flex: none"></span>
</button>
```
Selected video tile (Parent-Send): same rule on a photo tile: `border: 3px solid #5B6F00; border-radius: 20px`
on the tile, the 32px check circle at `top: 8px; right: 8px` with a 2px cream ring
(`box-shadow: 0 0 0 2px #FFFDF7; border-radius: 50%`), caption under the photo "2:10 pm · 12 min" (16/600).
Filter pills (Kid-Browse): selected = `background: #5B6F00; color: #FFFDF7` + 18px cream check icon
before the word; unselected = `background: #EFEFE6; color: #2D3222`; both `height: 44px; padding: 0 16px;
border-radius: 999px; font-size: 16px; font-weight: 700`.

### 5.9 Hero card (KID ONLY, Google TV; exactly as on C1-Kid-Home)
```html
<div style="position: absolute; left: 16px; top: 160px; width: 342px; height: 440px; border-radius: 28px; overflow: hidden; background: #34430C">
  <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's pork and chive dumplings on a steamer tray, flour on the table" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%">
  <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(18,20,16,0) 16%, rgba(18,20,16,0.62) 38%, rgba(18,20,16,0.88) 56%, rgba(18,20,16,0.92) 100%)"></div>
  <svg width="44" height="40" viewBox="0 0 44 40" aria-hidden="true" style="position: absolute; right: 30px; top: 72px"><g fill="none" stroke="#FFFDF7" stroke-width="3.5" stroke-linecap="round"><path d="M8 36c-6-8 6-12 0-22" /><path d="M22 34c-6-8 6-12 0-22" /><path d="M36 36c-6-8 6-12 0-22" /></g></svg>
  <div style="position: absolute; left: 16px; top: 16px; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 4px; border-radius: 999px; background: #FFFDF7; box-shadow: 0 2px 8px rgba(0,0,0,0.12)">
    <span style="width: 32px; height: 32px; border-radius: 50%; position: relative; overflow: hidden; flex: none"><img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%"></span>
    <span style="font-size: 15px; font-weight: 700; color: #1E2410">Just in from Mom</span>
    <span style="font-size: 15px; font-weight: 500; color: #5F6352">6:15 pm</span>
  </div>
  <div style="position: absolute; left: 20px; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 10px">
    <a href="C1-Kid-Recipe.dc.html" style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 36px; line-height: 1.08; letter-spacing: -0.01em; color: #FFFDF7">Sunday <span style="background: #FEBE29; color: #1E2410; padding: 0 6px; border-radius: 6px">Dumplings</span></a>
    <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 400; font-size: 18px; line-height: 1.4; color: #FFFDF7">&#8220;Saved you a bag for Thanksgiving. Now you can make your own.&#8221; <span style="font-family: 'Caveat', cursive; font-style: normal; font-weight: 600; font-size: 24px; line-height: 1; color: #FFE59A; white-space: nowrap">Love, Mom</span></p>
    <div style="display: flex; align-items: center; gap: 10px; margin-top: 6px">
      <button style="flex: 1; height: 56px; border: none; border-radius: 999px; background: #FFFDF7; display: flex; align-items: center; gap: 10px; padding: 0 18px 0 6px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.12)">
        <span style="width: 44px; height: 44px; border-radius: 50%; background: #5B6F00; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>
        </span>
        <span style="font-size: 18px; font-weight: 700; color: #1E2410">Hear Mom</span>
        <span style="margin-left: auto; font-size: 15px; font-weight: 600; color: #5F6352">0:24</span>
      </button>
      <a href="C1-Kid-Recipe.dc.html" aria-label="Open the dumplings recipe" style="width: 56px; height: 56px; border-radius: 50%; border: 2px solid #FFFDF7; box-sizing: border-box; display: flex; align-items: center; justify-content: center; color: #FFFDF7; flex: none">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
    </div>
  </div>
</div>
<!-- the peek of the next card (must exist whenever there are dots) -->
<div style="position: absolute; left: 370px; top: 160px; width: 342px; height: 440px; border-radius: 28px; overflow: hidden; background: #F9E3CF" aria-hidden="true">
  <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%">
</div>
<div style="position: absolute; left: 0; right: 0; top: 614px; display: flex; justify-content: center; gap: 6px" role="img" aria-label="1 of 3">
  <span style="width: 22px; height: 8px; border-radius: 999px; background: #5B6F00"></span>
  <span style="width: 8px; height: 8px; border-radius: 999px; background: rgba(71,67,42,0.25)"></span>
  <span style="width: 8px; height: 8px; border-radius: 999px; background: rgba(71,67,42,0.25)"></span>
</div>
```

**Subway hero + sheet (Kid-Recipe, Parent-Recipe):** photo `top: 0; height: 388px` edge to edge
(runs under the top 54px), round 48 buttons at top 54 (5.7), steam over the hot dish, optional Caveat
pill (5.13); the `#FFFDF7` sheet starts at **top: 360px** (overlaps 28px), `border-radius: 32px 32px 0 0;
padding: 24px 16px 0`, and holds the whole segmented card: title (Fraunces 600, 32 kid / 34 parent,
lh 1.1) → by-line (meta) → cook's quote → option boxes → Watch/Hear → ingredient peek. Separate the
segments with 16px gaps (or 1px hairline dividers). A sticky CTA bar (5.7) sits on top at the bottom.
```html
<div style="position: absolute; left: 0; right: 0; top: 0; height: 388px; overflow: hidden; background: #E6EBCF">
  <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's pork and chive dumplings on a steamer tray" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%">
</div>
<div style="position: absolute; left: 0; right: 0; top: 360px; bottom: 0; background: #FFFDF7; border-radius: 32px 32px 0 0; padding: 24px 16px 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px">
  <div style="display: flex; flex-direction: column; gap: 6px">
    <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 32px; line-height: 1.1; color: #1E2410">Pork &amp; Chive Dumplings</h1>
    <span style="font-size: 15px; font-weight: 500; color: #5F6352">by Mom · 1 hr 20 min · makes ~40</span>
  </div>
  …
</div>
```
Parent-Recipe: put a white pill "Watch yourself · 12 min" (5.10 white pill, label 20, play icon in the
green circle) at `left: 16px; bottom: 44px` on the photo instead of the Caveat pill; Back pill top-left.

**Parent "tiles" (HelloFresh, Parent-Home; reuse the photo tile for "Leo cooked it" elsewhere):**
```html
<div style="position: absolute; left: 16px; right: 16px; top: 304px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px">
  <a href="C1-Parent-Recipe.dc.html" style="position: relative; height: 232px; border-radius: 24px; overflow: hidden; background: #34430C; display: block">
    <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Leo's photo of the ramen he made" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%">
    <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(18,20,16,0) 20%, rgba(18,20,16,0.7) 50%, rgba(18,20,16,0.9) 100%)"></div>
    <span style="position: absolute; left: 12px; top: 12px; width: 44px; height: 44px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 3px #FFFDF7"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
    <div style="position: absolute; left: 14px; right: 12px; bottom: 14px; display: flex; flex-direction: column; gap: 4px">
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 22px; line-height: 1.15; color: #FFFDF7">Leo made your ramen</span>
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 18px; line-height: 1.3; color: #FFFDF7">&#8220;Tasted like home.&#8221;</span>
      <span style="font-size: 16px; font-weight: 500; color: #FFFDF7">Thu, Oct 9</span>
    </div>
  </a>
  <div style="height: 232px; box-sizing: border-box; border-radius: 24px; background: #ECE6F2; padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 10px">
    <div style="display: flex; align-items: center; gap: 10px">
      <span style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; position: relative; flex: none"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
      <span style="font-size: 16px; font-weight: 700; line-height: 1.2; color: #3F3558">Leo asked</span>
    </div>
    <span style="flex: 1; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 22px; line-height: 1.25; color: #1E2410">&#8220;How thin should the wrappers be?&#8221;</span>
    <span style="font-size: 16px; font-weight: 500; line-height: 1.3; color: #5F6352">About dumplings</span>
  </div>
</div>
```

### 5.10 White pill on a photo (Google TV CTA / "Watch yourself")
The `Hear Mom` button inside 5.9. Parent version: `height: 64px`, circle 52, label 20, time 16.

### 5.11 List row: photo left, heart right (ref 7 / 8)
Kid, cook-tinted row (as on C1-Kid-Home; Mom's dishes = peach, Dad's = sage, Nai Nai's = rose,
Auntie Lin's = butter). On Kid-Browse you may use white rows (`#FFFDF7` + 1px hairline border) with
the heart button on `#EFEFE6`, as long as the whole list is consistent.
```html
<div style="display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 24px; background: #F9E3CF">
  <div style="width: 72px; height: 72px; border-radius: 18px; overflow: hidden; flex: none"><img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="A bowl of ramen" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%"></div>
  <div style="flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 21px; line-height: 1.2; color: #1E2410">Ramen, Mom's Way</span>
    <span style="font-size: 15px; font-weight: 700; color: #4C5A10">For exam week</span>
    <span style="font-size: 15px; font-weight: 500; color: #5F6352">10 min · one pot · about $2</span>
  </div>
  <button aria-label="Save Ramen, Mom's Way" style="width: 44px; height: 44px; border-radius: 50%; border: none; background: #FFFDF7; display: flex; align-items: center; justify-content: center; color: #9A4F47; flex: none; cursor: pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>
  </button>
</div>
```
Rows in a list: 12px gap between rows. Row titles must fit one line at 21px when the text column is
~198px; if a title is longer, let it wrap to 2 lines (never truncate the cook's dish names).
Kid-Browse spec (ref 7): photo 84px radius 18, heart right, accent line = cook + reason, muted line =
time · yield.

Parent row (ends in a round arrow; no hearts; inside a bubble panel):
```html
<a href="C1-Parent-Recipe.dc.html" style="display: flex; align-items: center; gap: 14px; padding: 14px 0">
  <span style="width: 76px; height: 76px; border-radius: 18px; overflow: hidden; flex: none"><img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Ramen, Mom's Way" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%"></span>
  <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 22px; line-height: 1.2; color: #1E2410">Ramen, Mom's Way</span>
    <span style="font-size: 16px; font-weight: 700; color: #4C5A10">Leo cooked it ✓</span>
    <span style="font-size: 16px; font-weight: 500; color: #5F6352">Thu, Oct 9 · he sent a photo</span>
  </span>
  <span style="width: 56px; height: 56px; border-radius: 50%; background: #EFEFE6; color: #1E2410; display: flex; align-items: center; justify-content: center; flex: none">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </span>
</a>
```

### 5.12 Bubble panel (ref 8)
White rounded panel with a header + round arrow, rows separated by hairlines (kid rows end in a play
or heart button; parent rows use 5.11 parent row and a 30px header without the icon-only arrow).
```html
<section style="background: #FFFDF7; border-radius: 28px; border: 1px solid rgba(71,67,42,0.14); box-shadow: 0 4px 18px rgba(30,36,16,0.06); padding: 18px 16px 6px">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; line-height: 1.1; color: #1E2410">Hear their voices</h2>
    <a href="C1-Kid-Browse.dc.html" aria-label="See all voices" style="width: 44px; height: 44px; border-radius: 50%; background: #EFEFE6; color: #1E2410; display: flex; align-items: center; justify-content: center; flex: none">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </div>
  <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0">
    <span style="width: 64px; height: 64px; border-radius: 50%; overflow: hidden; position: relative; flex: none"><img src="/_blob/5845b3a84b9a62bd4c8e0da61f982bde" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 40%; transform: scale(1.3); transform-origin: 42% 40%"></span>
    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 19px; line-height: 1.2; color: #1E2410">Why Nai Nai never cuts a noodle</span>
      <span style="font-size: 15px; font-weight: 700; color: #4C5A10">Kept for always</span>
      <span style="font-size: 15px; font-weight: 500; color: #5F6352">In Mandarin, English words · 1:12</span>
    </div>
    <button aria-label="Play Nai Nai's voice" style="width: 44px; height: 44px; border-radius: 50%; border: none; background: #5B6F00; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none; cursor: pointer">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
    </button>
  </div>
  <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid rgba(71,67,42,0.14)">
    … next row (voice rows: face avatar 64 circle; dish rows: photo 64 radius 16) …
  </div>
</section>
```
Kid panels: 3-4 rows. Parent panels: 2-3 rows, header 30, padding `20px 16px 8px`.

### 5.13 Badges, pills and marks
- **Highlighter word** (ONE per screen, ink text, on cream, peach or a photo):
  `<span style="background: #FEBE29; padding: 0 6px; border-radius: 6px">Leo</span>` (on a photo
  title add `color: #1E2410`).
- **Status pills** (Luma; 28 tall, 15/700; put above a row title, or on the bottom edge of a
  thumbnail ≥ 112px wide):
  `<span style="height: 28px; padding: 0 12px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 15px; font-weight: 700; display: flex; align-items: center">New from Mom</span>`
  "You cooked it" = `background: #E6EBCF; color: #4C5A10` + a 14px check icon (stroke 3) before the
  words, `gap: 4px`. "Mom answered" = `#F9E3CF` / `#6E4A33`. "Saved" = `#F6D5CC` / `#5A3A22`.
  Use `align-self: flex-start` inside a column.
- **Eyebrow pill on photo** ("Just in from Mom · 6:15 pm"): see 5.9 (cream pill, 32px face, 15/700 +
  15/500 muted time).
- **Date tile** (ref 3; request cards):
```html
<div style="width: 64px; height: 72px; border-radius: 16px; background: #EFEFE6; display: flex; flex-direction: column; align-items: center; justify-content: center; flex: none">
  <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352">SUN</span>
  <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 28px; line-height: 1; color: #1E2410">19</span>
  <span style="font-size: 13px; font-weight: 600; color: #5F6352">OCT</span>
</div>
```
  (The 13px caps here are the only sub-15px text allowed besides tab labels; it is a tile, read as a
  whole. On a white card use `#EFEFE6`; on a tinted card use `#FFFDF7`.)
- **Steam** (white, over a HOT dish photo only): the 44×40 svg in 5.9.
- **Avatars** (circle crops; verified): see DIRECTION section E. Maya = `#EDF2BE` circle + Fraunces 600
  "M" `#3C4A0B`; Auntie Lin = `#FFF1C7` + "L" `#8A3F12`. Ring an avatar in its cook tint when it is the
  "who" of a header: `box-shadow: 0 0 0 2.5px #F7F7F2, 0 0 0 4.5px #ECE6F2` (Leo).
- **Scalloped sticker:** Main only, max one per group card, 88px, `#FEBE29` with the BRIEF appendix path;
  never on Home/Recipe/Browse in C1.
- **Pot mascot:** kid greeting circle (5.4), Main, and empty states. Never on parent Home screens.

### 5.14 Caveat note
Kid on light (one per screen, decoration only, never the only carrier of info, ≥ 24px):
```html
<p style="margin: 0; font-family: 'Caveat', cursive; font-weight: 600; font-size: 24px; line-height: 1.1; color: #5B6F00; transform: rotate(-2deg)">you've got this, Leo</p>
```
Caveat pill on a photo (Subway hero, kid):
```html
<span style="position: absolute; right: 16px; bottom: 48px; height: 40px; padding: 0 16px; border-radius: 999px; background: #FFFDF7; display: flex; align-items: center; font-family: 'Caveat', cursive; font-weight: 600; font-size: 24px; color: #8A3F12; transform: rotate(-4deg); box-shadow: 0 2px 8px rgba(0,0,0,0.12)">a taste of home</span>
```
Signature on a scrim: `<span style="font-family: 'Caveat', cursive; font-style: normal; font-weight: 600; font-size: 24px; line-height: 1; color: #FFE59A; white-space: nowrap">Love, Mom</span>` (see 5.9).
Parent: Caveat 26, at most once, and only if the screen has no other decoration (Main's "every family
needs both", or a Legacy line flourish).

---

## 6. Layout recipes (where things sit on the 390×844 board)

- **Kid-Home (built):** greeting row top 54 → context line top 120 → hero card 342×440 at top 160 +
  peek at left 370 → dots top 614 → "Picked for you" header top 640 → first row top 698 cut by the bar
  (bar top 760).
- **Parent-Home (built):** band 0-232 (date 54, greeting, 44px headline 2 lines) → "From Leo" top 256
  → tiles top 304 (232 tall) → Record 72 at top 552 → helper top 632 → Answer Leo 64 at top 672 →
  bar top 752.
- **Kid-Home-Scrolled:** canvas ground, no greeting; "Picked for you" list (3 cook-tinted rows with
  status pills) → white bubble panel "Hear their voices" (3 voice rows, play buttons) → butter card
  (`#FFF1C7`, radius 24) "Mom's birthday is in 2 weeks." + outline button "See the recipe". Content
  that reaches the bar is cut by it.
- **Kid-Recipe:** Subway hero + sheet (5.9) + sticky "Start cooking" (5.7). Sheet order: title, by-line,
  Mom's quote (Fraunces italic 20, highlighter on one word, Mom avatar 32 + "Mom says" 15/700 above),
  "Cooking for" boxes (5.8), Watch/Hear (5.7), 3 ingredient rows (feel words Fraunces italic 18 ink,
  `~` estimate 15 muted right-aligned), footnote "~ means about. Close is good enough." (15 muted).
- **Kid-Browse:** headline "Our *family* table" 40 (highlighter on family) + meta "9 recipes, 4 cooks"
  → filter pills (5.8) → rows (5.11, photo 84) → tab bar (Recipes active).
- **Parent-Home-Scrolled:** "Your recipes" bubble panel (3 parent rows) → request card (`#ECE6F2` Leo
  tint, radius 24, date tile left, "Leo asked for your Sunday Eggs" 22 Fraunces, quote italic 20,
  full-width green 64 "Record it Sunday") → legacy line Fraunces italic 22 centered.
- **Parent-Recipe:** Subway hero (ramen) with Back pill + "Watch yourself" white pill; sheet: title +
  meta, Mom's own words, "Who cooked it" (Leo row lit = 5.8 parent selected style with his photo and
  "Thu, Oct 9"; Maya row quiet with a text button "Send to Maya"), ube question card + green 72
  "Answer with your voice" + helper; sticky outline "Send again" is NOT the primary (make the answer the
  primary; Send again = outline 64 at the end of the sheet).
- **Parent-Send:** Back pill top 54 → "Send your *dumplings*" 44 → 3 video tiles (selected, 5.8) →
  "Who is it for?" 3 parent option boxes (Leo lit) → voice note row (sage card, mic circle 60 +
  "Add a few words for Leo" + "Tap to talk") → sticky bar "Send to Leo" 72 + reassurance line.
- **Main:** mascot 56 + "homecookd" (Fraunces 600 22) at top 54; "Who's in the *kitchen*?" 40; peach
  card "The cooks" (Mom, Dad, Nai Nai: 92 circles, name 19/700, context 15) and ube card "The ones who
  miss it" (Leo, Maya, dashed 92 "Add family" circle); "You can switch anytime." 15 muted. Optional
  Caveat "every family needs both". Tapping Mom → C1-Parent-Home, Leo → C1-Kid-Home.

## 7. Checks before you hand in (C1 specifics)
- One highlighter word per screen. One green filled button per screen (the primary).
- Every voice control says whose + how long. Every note/question shows the sender's face.
- No `#E95D3D`, no forest/chartreuse blocks, no dark backgrounds, no ALL-CAPS eyebrows (date tile excepted).
- Parent: no icon-only buttons, no hearts, no horizontal rows, buttons full width, Back says "Back".
- Render with `kit/render.py`, zero warnings; nothing within 16px of the tab bar unless it's a cut peek.

## UPDATE (Oct 15, founder feedback): tab bar
The cream tab bar blended into the page. It is now:
- nav: `background: #E6EBCF; border-top: 1px solid rgba(71,67,42,0.22)` (same height, shadow and padding as before).
- active tab: pill `background: #5B6F00; color: #FFFDF7` (cream icon), label `color: #1E2410; font-weight: 800`.
- inactive: icon + label `#5F6352`, weight 600. Kid labels 14px, parent labels 14-15px.
- 3 tabs only. Kid: Home, Recipes, Ask (C1-Kid-Ask). Parent: Home, My recipes, Record. The Family tab was cut.

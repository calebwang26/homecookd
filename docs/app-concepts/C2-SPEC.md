# C2 SUNDAY SUPPER: the visual system (lead designer spec)

Read BRIEF.md and DIRECTION.md (concept 2) first; this file turns them into exact values and
copy-paste markup. The two finished reference boards are `canvas/project/C2-Kid-Home.dc.html` and
`canvas/project/C2-Parent-Home.dc.html`. Open them (and their renders in `renders/C2-Kid-Home.png`,
`renders/C2-Parent-Home.png`) before you start. Every snippet below is copied verbatim from those
boards or from the rendered component board `c2-test/comps.dc.html` (render: `c2-test/comps.png`).
The `<!-- SNIP:… -->` comments in the boards are only markers; you don't need to copy them.

**The feeling:** the whole family at a loud, full Sunday table. Joyful, festive, the lander brought
into the app. Big saturated color blocks with wave swirls, chunky 800-weight soft Fraunces, scalloped
stickers, the lander's arrow-circle pill, Caveat used once. Clarity is never traded for fun: one
primary action per screen, big type, words under every tab.

---

## 1. Tokens (no other hexes; the only new one is `#F0AE14`)

| Role | Hex | Notes |
|---|---|---|
| Ground | `#FFFDF7` cream | page root background on every C2 screen |
| Forest block | `#34430C` | hero block (kid), tab bar, primary pill on light, selected option fill |
| Chartreuse | `#D1E043` | primary pill ON forest, active tab pill, check circles on forest, accent italic on forest |
| Sun block | `#FEBE29` | greeting band at the top of both homes, "New" pills, date tile, secondary "Hear" pill |
| Sun-deep swirl (NEW) | `#F0AE14` | wave swirl strokes on sun only, decoration only, never text |
| Forest swirl | `#4C5A10` | wave swirl strokes on forest |
| Peach block | `#F9E3CF` | Mom's color; note slips, bubble panels, parent "From Leo" tile |
| Peach swirl | `#FFDDBF` | wave swirl on peach (optional) |
| Lime-wash block | `#EDF2BE` | bubble panels ("When you miss home", parent "Your recipes"), "You cooked it" pill |
| Tomato | `#E95D3D` | DECORATIVE ONLY: sticker dashes, filled saved heart. Never text |
| Tomato-deep | `#C8462A` | accent line text on cream ONLY (row accent lines, Browse) |
| Apricot-ink | `#8A3F12` | accent line text on peach (C8462A fails on peach) |
| Green-deep | `#4C5A10` | accent line text on lime-wash or cream ("Leo cooked it" ✓ line) |
| Ink | `#1E2410` | headlines, text on sun, labels on cream |
| Body | `#2D3222` | body text, date line on sun |
| Muted | `#5F6352` | meta on cream / peach / lime-wash / sage (never on sun: fails) |
| Text on forest | `#FFFDF7` cream; muted `#C9D0AE`; accent `#D1E043` | |
| Note text on peach | `#5A3A22` (quote), `#6E4A33` (Caveat signature) | |
| Hairline | `rgba(71,67,42,0.14)`; strong border `rgba(71,67,42,0.24)`; empty check ring `rgba(71,67,42,0.30)` | |
| Photo scrim | `linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(18,20,16,0.78) 100%)` | the only gradient allowed |
| Cook colors (rings/tints) | Mom `#F9E3CF` · Dad `#E6EBCF` · Nai Nai `#F6D5CC` · Auntie Lin `#FFF1C7` · Leo `#ECE6F2` · Maya `#EDF2BE` (ink `#3C4A0B`) | avatar rings are `box-shadow: 0 0 0 2px <color>` (3px parent) |

**Contrast pairs used (all pass):** ink on sun 9.6 · `#2D3222` on sun ~8 · forest italic on sun ~7 ·
cream on forest 10.6 · chartreuse on forest 7.4 · `#C9D0AE` on forest ~6.9 · forest on chartreuse 7.4 ·
`#5A3A22` on peach ~8 · `#8A3F12` on peach ~6.9 · `#C8462A` on cream 4.73 · `#4C5A10` on lime-wash ~6.6 ·
`#5F6352` on peach/lime-wash/cream ≥ 4.99. **Never:** muted grey on sun, `#C8462A` on peach, any text in
tomato `#E95D3D`, sun text on light.

**Which block is which (keep this logic on every screen):**
- **Sun** = "hello, it's you" (greeting band at the top of a home screen; date tiles; "New" marks).
- **Forest** = "the main thing / the action" (kid hero, primary pills, selected options, tab bar).
- **Peach** = "from family, in their words" (notes, the "From Leo" tile, the first bubble panel).
- **Lime-wash** = "kept / cooked" (lists of recipes, "You cooked it").
- Never stack two forest blocks without a cream or peach gap of ≥ 14px between them.

## 2. Type

Font link and families exactly as BRIEF section 4. Display always carries
`font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0;`.
The accent word in a headline is `font-style: italic` + accent color (forest `#34430C` on sun/cream,
chartreuse `#D1E043` on forest). One accent word per screen. No highlighter block (that's Hearth).

| Use | Font | Kid | Parent |
|---|---|---|---|
| Screen headline (lh 1.0, ls -0.015em) | Fraunces 800 | 42 | 44 |
| Hero title (lh 0.98, ls -0.015em) | Fraunces 800 | 40 (two lines OK: "Sunday / Dumplings") | 30 on a photo scrim / 42 on a block |
| Section / panel header (lh 1.05, ls -0.01em) | Fraunces 800 | 30 | 32 |
| Card title | Fraunces 700 | 22 (24 parent) | 24 |
| Row title (lists, panels) | Fraunces 700, lh 1.15 | 20 | 22 |
| Quote / cook's words | Fraunces 500 italic, lh 1.3 | 19 | 20 |
| Body | DM Sans 400-500, lh 1.4 | 17 | 19 |
| Meta / accent lines | DM Sans 600 (accent 700) | 15 | 16 |
| Greeting line (parent) | DM Sans 800 | n/a | 20 |
| Button label | DM Sans 800 | 18 (17 in paired buttons) | 20-21 |
| Tab label | DM Sans 600, active 800 | 13 | 14 |
| Status pill | DM Sans 800 | 15 | 16 |
| Sticker text | Fraunces 800 uppercase, lh 0.95 | 15 | 15 |
| Caveat | Caveat 600 | 24-26 (one per screen, decoration) | 24 signature only, or none |

Headers must fit ONE line: at 30px a panel header holds ~14 characters next to its arrow button
("Picked for you", "Hear their voices" on forest at full width). "For midterms week" wraps inside a
panel; use it only as a full-width header outside a panel, or say "For exam week".

## 3. Spacing, radii, shadows

- 8pt rhythm. Screen side gutter 16px (blocks, cards, buttons), 20px for text set directly on a
  color band. Gaps between stacked blocks 14-16px. Inner padding of blocks 16-20px.
- Calm top: content starts at y=52-54 (the sun band runs from y=0 under it).
- Radii: color blocks / heroes / panels **32**; cards & option boxes 22 (kid) / 26 (parent); note
  slips 16; photos inside rows 18-22; hero photo is clipped by its block (no own radius); pills 999;
  tab bar top corners 28; sun band bottom corners 32.
- Shadows: none on blocks (color does the separation). Only round icon buttons that sit ON a photo
  get `box-shadow: 0 2px 8px rgba(18,20,16,0.18)`.
- Tilt: note slips `rotate(-1.2deg)` kid / `rotate(-1deg)` parent; stickers `rotate(-8deg)`; Caveat
  note `rotate(-3deg)`. Nothing else tilts. Never tilt a button or a header.
- Tab bar: kid 84px, parent 88px, both with `padding-bottom: 26px`. Content stops ≥ 12px above the
  bar, OR runs under it as a visible peek (a panel whose header shows, cut by the bar).

## 4. Kid vs parent deltas (apply on every C2 screen)

| | Kid (Leo, Sun 9:40 pm) | Parent (Mom, Mon 8:10 am) |
|---|---|---|
| Lead block | **Forest** hero block under a sun greeting band | **Sun** greeting band + **peach** tile from Leo; forest only for the one big action |
| Headline | 42, two lines | 44, two lines; DM Sans 800 20px greeting + 16px date above it |
| Identity chip | "Leo" + 38px face in a cream pill, 48 tall | "Mom" + 44px face in a cream pill, 56 tall |
| Primary | lander pill 58-64 tall (chartreuse on forest, forest on cream) | lander pill **76** tall with a helper line inside, 60px chartreuse circle |
| Secondary | outline pill 56-60, can sit side by side with another | full-width outline pill 64, 2.5px |
| Selected option | forest fill + chartreuse check circle 26 | forest fill + 3px forest border + cream check circle 32 |
| Back | 48px round cream button on the photo (icon only, `aria-label`) | cream pill 56 tall, chevron + the word "Back" |
| Rows end in | heart in a 44px round button | 52px round forest arrow button (no hearts) |
| Stickers | up to 2 ("TASTE OF HOME", "NEW FROM MOM") | exactly 1 ("PASS IT DOWN") and it is the only decoration |
| Caveat | one note per screen (signature or arrow note) | none on essentials; skip it |
| Density | ≤ 3 sections, panels of 3-4 rows, horizontal rows OK with peek + arrow | ≤ 2 sections, panels of 2-3 rows, single column, no horizontal scroll |
| Tabs | Home · Recipes · Ask · Family, icon 24, label 13 | Home · My recipes · Record · Family, icon 28, label 14 |
| Info emphasis | time, cost, how hard ("10 min · about $2") | who cooked, who watched, who's asking |

## 5. Snippets (copy-paste; change only copy, hrefs and images)

### 5.1 Page root (both)
```html
<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: #FFFDF7; font-family: 'DM Sans', system-ui, sans-serif; color: #2D3222">
  … screen …
</div>
```

### 5.2 KID tab bar (forest block). Active = Home here.
To make another tab active: move `aria-current="page"` to it, set its `<a>` color to `#D1E043`, give
its icon `<span>` `border-radius: 999px; background: #D1E043; color: #34430C;`, add
`fill="currentColor" fill-opacity="0.2"` to the icon's main shape, and make its label weight 800. Reset
the old active tab to the inactive markup (color `#C9D0AE`, plain span, weight 600). Active per screen:
Kid-Home + Kid-Home-Scrolled = Home; Kid-Browse = Recipes. Detail screens have no tab bar.
```html
<!-- KID TAB BAR (forest block) -->
<nav style="position: absolute; left: 0; right: 0; bottom: 0; height: 84px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #34430C; border-radius: 28px 28px 0 0">
  <a href="C2-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #D1E043">
    <span style="width: 64px; height: 34px; border-radius: 999px; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg></span>
    <span style="font-size: 13px; font-weight: 800">Home</span>
  </a>
  <a href="C2-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #C9D0AE">
    <span style="width: 64px; height: 34px; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 13px; font-weight: 600">Recipes</span>
  </a>
  <a href="C2-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #C9D0AE">
    <span style="width: 64px; height: 34px; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg></span>
    <span style="font-size: 13px; font-weight: 600">Ask</span>
  </a>
  <a href="C2-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #C9D0AE">
    <span style="width: 64px; height: 34px; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 13px; font-weight: 600">Family</span>
  </a>
</nav>
```
Kid-Browse active state (Recipes) for copy-paste:
```html
<!-- KID TAB BAR (forest block) -->
<nav style="position: absolute; left: 0; right: 0; bottom: 0; height: 84px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #34430C; border-radius: 28px 28px 0 0">
  <a href="C2-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #C9D0AE">
    <span style="width: 64px; height: 34px; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></span>
    <span style="font-size: 13px; font-weight: 600">Home</span>
  </a>
  <a aria-current="page" href="C2-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #D1E043">
    <span style="width: 64px; height: 34px; border-radius: 999px; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 13px; font-weight: 800">Recipes</span>
  </a>
  <a href="C2-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #C9D0AE">
    <span style="width: 64px; height: 34px; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg></span>
    <span style="font-size: 13px; font-weight: 600">Ask</span>
  </a>
  <a href="C2-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 56px; color: #C9D0AE">
    <span style="width: 64px; height: 34px; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 13px; font-weight: 600">Family</span>
  </a>
</nav>
```

### 5.3 PARENT tab bar (forest block, bigger). Active = Home here.
Same active-swap rule as the kid bar (pill 68×36, icon 28). Parent-Home + Parent-Home-Scrolled = Home.
"My recipes" links to `C2-Parent-Home-Scrolled.dc.html`; "Record" to `C2-Parent-Send.dc.html`.
```html
<!-- PARENT TAB BAR (forest block) -->
<nav style="position: absolute; left: 0; right: 0; bottom: 0; height: 88px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #34430C; border-radius: 28px 28px 0 0">
  <a href="C2-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #D1E043">
    <span style="width: 68px; height: 36px; border-radius: 999px; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg></span>
    <span style="font-size: 14px; font-weight: 800">Home</span>
  </a>
  <a href="C2-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #C9D0AE">
    <span style="width: 68px; height: 36px; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 14px; font-weight: 600">My recipes</span>
  </a>
  <a href="C2-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #C9D0AE">
    <span style="width: 68px; height: 36px; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></span>
    <span style="font-size: 14px; font-weight: 600">Record</span>
  </a>
  <a href="C2-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #C9D0AE">
    <span style="width: 68px; height: 36px; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 14px; font-weight: 600">Family</span>
  </a>
</nav>
```
"Record" active variant (if a screen ever needs it):
```html
<!-- PARENT TAB BAR (forest block) -->
<nav style="position: absolute; left: 0; right: 0; bottom: 0; height: 88px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #34430C; border-radius: 28px 28px 0 0">
  <a href="C2-Parent-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #C9D0AE">
    <span style="width: 68px; height: 36px; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></span>
    <span style="font-size: 14px; font-weight: 600">Home</span>
  </a>
  <a href="C2-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #C9D0AE">
    <span style="width: 68px; height: 36px; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 14px; font-weight: 600">My recipes</span>
  </a>
  <a aria-current="page" href="C2-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #D1E043">
    <span style="width: 68px; height: 36px; border-radius: 999px; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="currentColor" fill-opacity="0.2"/></svg></span>
    <span style="font-size: 14px; font-weight: 800">Record</span>
  </a>
  <a href="C2-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; color: #C9D0AE">
    <span style="width: 68px; height: 36px; display: flex; align-items: center; justify-content: center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 14px; font-weight: 600">Family</span>
  </a>
</nav>
```

### 5.4 Top greeting band: KID (sun band + swirls, brand row, identity chip, headline)
Sun band height: 250 on Kid-Home (the hero overlaps it from y=214). On other kid main screens use a
shorter band (e.g. 190) and keep the same top row. Swirl rows sit every 60px; add/remove `<path>`s to
fill the band.
```html
<!-- SUN BLOCK (greeting) -->
<div style="position: absolute; left: 0; top: 0; width: 390px; height: 250px; background: #FEBE29; border-radius: 0 0 32px 32px; overflow: hidden">
  <svg width="390" height="250" viewBox="0 0 390 250" aria-hidden="true" style="position: absolute; left: 0; top: 0"><g fill="none" stroke="#F0AE14" stroke-width="14" stroke-linecap="round"><path d="M-20 40c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 100c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 160c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 220c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 280c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/></g></svg>
</div>

<!-- top row: brand + who you are -->
<div style="position: absolute; left: 20px; right: 20px; top: 54px; height: 48px; display: flex; align-items: center; justify-content: space-between">
  <div style="display: flex; align-items: center; gap: 8px">
    <svg width="40" height="37" viewBox="0 0 100 92" aria-hidden="true"><g fill="none" stroke="#1E2410" stroke-width="3" stroke-linecap="round"><path d="M38 22c-4-5 4-8 0-13"/><path d="M52 20c-4-5 4-8 0-13"/><path d="M66 22c-4-5 4-8 0-13"/></g><path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill="#F6BFA8" stroke="#6E5A4C" stroke-width="3.5" stroke-linejoin="round"/><path d="M22 52h-8M78 52h8" stroke="#6E5A4C" stroke-width="5" stroke-linecap="round"/><ellipse cx="50" cy="42" rx="31" ry="7" fill="#F2A98F" stroke="#6E5A4C" stroke-width="3.5"/><circle cx="50" cy="33" r="4.5" fill="#6E5A4C"/><circle cx="40" cy="59" r="3.6" fill="#4A3B30"/><circle cx="60" cy="59" r="3.6" fill="#4A3B30"/><ellipse cx="33" cy="66" rx="5" ry="3" fill="#FFB8AE"/><ellipse cx="67" cy="66" rx="5" ry="3" fill="#FFB8AE"/><path d="M45 65q5 5 10 0" fill="none" stroke="#4A3B30" stroke-width="3" stroke-linecap="round"/></svg>
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 24px; color: #1E2410; letter-spacing: -0.01em">homecookd</span>
  </div>
  <a href="C2-Profiles.dc.html" aria-label="You are Leo. Switch person" style="display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 6px 0 14px; background: #FFFDF7; border-radius: 999px">
    <span style="font-size: 15px; font-weight: 700; color: #1E2410">Leo</span>
    <span style="width: 38px; height: 38px; border-radius: 50%; overflow: hidden; position: relative; display: block; box-shadow: 0 0 0 2px #ECE6F2"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
  </a>
</div>

<!-- greeting -->
<div style="position: absolute; left: 20px; right: 20px; top: 116px">
  <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 42px; line-height: 1.0; letter-spacing: -0.015em; color: #1E2410">Hi Leo. Sunday came to <span style="font-style: italic; color: #34430C">you.</span></h1>
</div>
```

### 5.5 Top greeting band: PARENT
```html
<!-- SUN BLOCK (greeting) -->
<div style="position: absolute; left: 0; top: 0; width: 390px; height: 270px; background: #FEBE29; border-radius: 0 0 32px 32px; overflow: hidden">
  <svg width="390" height="270" viewBox="0 0 390 270" aria-hidden="true" style="position: absolute; left: 0; top: 0"><g fill="none" stroke="#F0AE14" stroke-width="14" stroke-linecap="round"><path d="M-20 40c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 100c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 160c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/><path d="M-20 220c40-30 80 30 120 0s80-30 120 0 80 30 120 0 80-30 120 0"/></g></svg>
</div>

<!-- top row: greeting + who you are -->
<div style="position: absolute; left: 20px; right: 20px; top: 52px; height: 56px; display: flex; align-items: center; justify-content: space-between">
  <div>
    <p style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 800; color: #1E2410">Good morning, Mom.</p>
    <p style="margin: 2px 0 0; font-size: 16px; line-height: 1.2; font-weight: 600; color: #2D3222">Monday, Oct 13</p>
  </div>
  <a href="C2-Profiles.dc.html" aria-label="You are Mom. Switch person" style="display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 6px 0 16px; background: #FFFDF7; border-radius: 999px; box-sizing: border-box">
    <span style="font-size: 17px; font-weight: 800; color: #1E2410">Mom</span>
    <span style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; position: relative; display: block; box-shadow: 0 0 0 2px #F9E3CF"><img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%"></span>
  </a>
</div>

<!-- headline -->
<h1 style="position: absolute; left: 20px; right: 20px; top: 118px; margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 44px; line-height: 1.0; letter-spacing: -0.015em; color: #1E2410">What will you teach Leo <span style="font-style: italic; color: #34430C">next?</span></h1>
```

### 5.6 Section header (on cream) with the round arrow button
```html
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
  <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 30px; line-height: 1.05; letter-spacing: -0.01em; color: #1E2410">Hear their voices</h2>
  <a href="C2-Kid-Home-Scrolled.dc.html" aria-label="See all voices" style="width: 44px; height: 44px; border-radius: 50%; background: #34430C; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
</div>
```

### 5.7 Buttons
Primary on forest (kid hero; chartreuse lander pill + a paired outline pill):
```html
<div style="display: flex; gap: 10px; margin-top: 16px">
<a href="C2-Kid-Recipe.dc.html" style="flex: 1; display: flex; align-items: center; justify-content: space-between; height: 58px; padding: 0 7px 0 18px; background: #D1E043; border-radius: 999px; color: #34430C; box-sizing: border-box; white-space: nowrap">
  <span style="font-size: 18px; font-weight: 800">Hear Mom <span style="font-weight: 600; font-size: 16px; margin-left: 2px">0:24</span></span>
  <span style="width: 44px; height: 44px; border-radius: 50%; background: #34430C; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg></span>
</a>
<a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; justify-content: center; height: 58px; padding: 0 20px; border: 2px solid #FFFDF7; border-radius: 999px; color: #FFFDF7; font-size: 17px; font-weight: 700; box-sizing: border-box; white-space: nowrap">Recipe</a>
</div>
```
Primary on cream (kid, the lander pill):
```html
<a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; justify-content: space-between; height: 60px; padding: 0 8px 0 24px; background: #34430C; border-radius: 999px; color: #FFFDF7; box-sizing: border-box; white-space: nowrap">
  <span style="font-size: 18px; font-weight: 800">Cook with Mom</span>
  <span style="width: 44px; height: 44px; border-radius: 50%; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
</a>
```
Sticky bottom CTA for detail screens (Kid-Recipe "Cook with Mom"; parent: height 72, label 21, circle 56):
```html
<div style="background: #FFFDF7; border-top: 1px solid rgba(71,67,42,0.14); padding: 12px 16px 30px">
  <a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0 8px 0 26px; background: #34430C; border-radius: 999px; color: #FFFDF7; box-sizing: border-box; white-space: nowrap">
    <span style="font-size: 19px; font-weight: 800">Cook with Mom</span>
    <span style="width: 48px; height: 48px; border-radius: 50%; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center; flex: none"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
  </a>
</div>
```
Parent primary (76 tall, helper line inside):
```html
<!-- PRIMARY: Record a recipe (lander pill) -->
<a href="C2-Parent-Send.dc.html" style="position: absolute; left: 16px; right: 16px; top: 580px; height: 76px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 26px; background: #34430C; border-radius: 999px; color: #FFFDF7; box-sizing: border-box">
  <span style="display: block">
    <span style="display: block; font-size: 21px; font-weight: 800; line-height: 1.15">Record a recipe</span>
    <span style="display: block; font-size: 16px; font-weight: 500; line-height: 1.3; color: #C9D0AE">Just cook and talk.</span>
  </span>
  <span style="width: 60px; height: 60px; border-radius: 50%; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center; flex: none"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></span>
</a>
```
Parent secondary (full width outline):
```html
<!-- SECONDARY: outline pill -->
<a href="C2-Parent-Recipe.dc.html" style="position: absolute; left: 16px; right: 16px; top: 668px; height: 64px; display: flex; align-items: center; justify-content: center; gap: 10px; border: 2.5px solid #34430C; border-radius: 999px; color: #34430C; font-size: 20px; font-weight: 800; box-sizing: border-box">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>Tell Leo well done</a>
```
Kid paired secondaries (Watch + Hear, side by side inside a 358px row with `gap: 10px`; whose + how long
always shown; the sun one is the warmer of the two):
```html
<div style="display: flex; gap: 10px">
<a href="C2-Kid-Recipe.dc.html" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px; height: 60px; padding: 0 16px; border: 2px solid #34430C; border-radius: 999px; color: #34430C; box-sizing: border-box; white-space: nowrap"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none"><rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg><span style="display: block; line-height: 1.1"><span style="display: block; font-size: 17px; font-weight: 800">Watch Mom</span><span style="display: block; font-size: 15px; font-weight: 600">0:48</span></span></a>
<a href="C2-Kid-Recipe.dc.html" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px; height: 60px; padding: 0 16px; background: #FEBE29; border-radius: 999px; color: #1E2410; box-sizing: border-box; white-space: nowrap"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg><span style="display: block; line-height: 1.1"><span style="display: block; font-size: 17px; font-weight: 800">Hear Mom</span><span style="display: block; font-size: 15px; font-weight: 600">0:24</span></span></a>
</div>
```
Icon buttons ON A PHOTO (kid only; aria-label required) and the parent Back pill:
```html
<a href="C2-Kid-Home.dc.html" aria-label="Back" style="width: 48px; height: 48px; border-radius: 50%; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(18,20,16,0.18)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></a>
<button type="button" aria-label="Save" style="width: 48px; height: 48px; border-radius: 50%; border: 0; padding: 0; background: #FFFDF7; color: #C8462A; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(18,20,16,0.18)"><svg width="24" height="24" viewBox="0 0 24 24" fill="#E95D3D" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></button>
<a href="C2-Parent-Home.dc.html" style="display: flex; align-items: center; gap: 6px; height: 56px; padding: 0 22px 0 14px; background: #FFFDF7; border-radius: 999px; color: #1E2410; font-size: 19px; font-weight: 800; box-shadow: 0 2px 8px rgba(18,20,16,0.18); box-sizing: border-box"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Back</a>
```

### 5.8 Option boxes (ref 2: "if you click a button, it lights up")
Kid ("Cooking for", two side by side):
```html
<div role="radiogroup" aria-label="Cooking for" style="display: flex; gap: 10px">
  <a href="C2-Kid-Recipe.dc.html" role="radio" aria-checked="true" style="flex: 1; position: relative; min-height: 92px; padding: 14px 14px 14px 16px; background: #34430C; border: 2.5px solid #34430C; border-radius: 22px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 4px">
    <span style="position: absolute; right: 10px; top: 10px; width: 26px; height: 26px"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#D1E043"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#34430C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    <span style="font-size: 19px; font-weight: 800; color: #FFFDF7">Just me</span>
    <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #C9D0AE">Boil 10, freeze 30</span>
  </a>
  <a href="C2-Kid-Recipe.dc.html" role="radio" aria-checked="false" style="flex: 1; position: relative; min-height: 92px; padding: 14px 14px 14px 16px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 22px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 4px">
    <span style="position: absolute; right: 10px; top: 10px; width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(71,67,42,0.30); box-sizing: border-box"></span>
    <span style="font-size: 19px; font-weight: 800; color: #1E2410">Friends</span>
    <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #5F6352">Cook all 40 tonight</span>
  </a>
</div>
```
Parent ("Who is it for?", stacked full width, face left, check right):
```html
<div role="radiogroup" aria-label="Who is it for?" style="display: flex; flex-direction: column; gap: 12px">
  <a href="C2-Parent-Send.dc.html" role="radio" aria-checked="true" style="display: flex; align-items: center; gap: 14px; min-height: 84px; padding: 12px 18px 12px 12px; background: #34430C; border: 3px solid #34430C; border-radius: 26px; box-sizing: border-box">
    <span style="width: 56px; height: 56px; border-radius: 50%; overflow: hidden; position: relative; display: block; flex: none; box-shadow: 0 0 0 3px #ECE6F2"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
    <span style="flex: 1; display: block">
      <span style="display: block; font-size: 21px; font-weight: 800; color: #FFFDF7">Leo</span>
      <span style="display: block; font-size: 16px; font-weight: 500; color: #C9D0AE">At college</span>
    </span>
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" style="flex: none"><circle cx="12" cy="12" r="11" fill="#FFFDF7"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#34430C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </a>
  <a href="C2-Parent-Send.dc.html" role="radio" aria-checked="false" style="display: flex; align-items: center; gap: 14px; min-height: 84px; padding: 12px 18px 12px 12px; background: #FFFDF7; border: 2px solid rgba(71,67,42,0.24); border-radius: 26px; box-sizing: border-box">
    <span style="width: 56px; height: 56px; border-radius: 50%; background: #EDF2BE; display: flex; align-items: center; justify-content: center; flex: none; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 26px; color: #3C4A0B">M</span>
    <span style="flex: 1; display: block">
      <span style="display: block; font-size: 21px; font-weight: 800; color: #1E2410">Maya</span>
      <span style="display: block; font-size: 16px; font-weight: 500; color: #5F6352">At home</span>
    </span>
    <span style="width: 32px; height: 32px; border-radius: 50%; border: 2.5px solid rgba(71,67,42,0.30); box-sizing: border-box; flex: none"></span>
  </a>
</div>
```

### 5.9 Hero card (kid; Google TV structure in a forest block)
Photo 168 tall on top (status pill top-left, sticker straddling the photo's bottom-right edge), then
avatar eyebrow, two-line title, Mom's note slip, primary + secondary.
```html
<!-- HERO: forest block (Google TV) -->
<div style="position: absolute; left: 16px; right: 16px; top: 214px; background: #34430C; border-radius: 32px; overflow: hidden">
  <a href="C2-Kid-Recipe.dc.html" style="display: block; position: relative; height: 168px">
    <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's pork and chive dumplings on a steamer tray, with flour and a rolling pin" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 38%">
    <span style="position: absolute; left: 14px; top: 14px; display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px 0 10px; background: #FEBE29; border-radius: 999px; font-size: 15px; font-weight: 800; letter-spacing: 0.04em; color: #1E2410">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>NEW TODAY</span>
  </a>
  <!-- sticker -->
  <div aria-hidden="true" style="position: absolute; right: 12px; top: 92px; width: 104px; height: 104px; transform: rotate(-8deg)">
    <svg width="104" height="104" viewBox="0 0 100 100"><path d="M50.0 8.0A8.6 8.6 0 0 1 66.1 11.2A8.6 8.6 0 0 1 79.7 20.3A8.6 8.6 0 0 1 88.8 33.9A8.6 8.6 0 0 1 92.0 50.0A8.6 8.6 0 0 1 88.8 66.1A8.6 8.6 0 0 1 79.7 79.7A8.6 8.6 0 0 1 66.1 88.8A8.6 8.6 0 0 1 50.0 92.0A8.6 8.6 0 0 1 33.9 88.8A8.6 8.6 0 0 1 20.3 79.7A8.6 8.6 0 0 1 11.2 66.1A8.6 8.6 0 0 1 8.0 50.0A8.6 8.6 0 0 1 11.2 33.9A8.6 8.6 0 0 1 20.3 20.3A8.6 8.6 0 0 1 33.9 11.2A8.6 8.6 0 0 1 50.0 8.0Z" fill="#FFFDF7" stroke="#FEBE29" stroke-width="4"/><circle cx="50" cy="50" r="33" fill="none" stroke="#E95D3D" stroke-width="1.5" stroke-dasharray="2 3"/></svg>
    <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 15px; line-height: 0.95; color: #34430C; text-transform: uppercase">Taste<br>of<br>home</div>
  </div>

  <div style="padding: 16px 18px 20px">
    <div style="display: flex; align-items: center; gap: 10px">
      <span style="width: 36px; height: 36px; border-radius: 50%; overflow: hidden; position: relative; display: block; flex: none; box-shadow: 0 0 0 2px #F9E3CF"><img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="Mom" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%"></span>
      <span style="font-size: 15px; font-weight: 700; color: #D1E043">Just in from Mom</span>
      <span style="font-size: 15px; font-weight: 500; color: #C9D0AE">· 6:15 pm</span>
    </div>
    <a href="C2-Kid-Recipe.dc.html" style="display: block; margin-top: 10px; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 40px; line-height: 0.98; letter-spacing: -0.015em; color: #FFFDF7">Sunday<br>Dumplings</a>
    <!-- Mom's note: peach paper slip -->
    <div style="margin-top: 14px; background: #F9E3CF; border-radius: 16px; padding: 12px 16px 10px; transform: rotate(-1.2deg)">
      <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 19px; line-height: 1.3; color: #5A3A22">&#8220;Your favorite. Don&#8217;t skip the ginger.&#8221; <span style="font-family: 'Caveat', cursive; font-style: normal; font-weight: 600; font-size: 24px; line-height: 1; color: #6E4A33; white-space: nowrap; margin-left: 6px">Love, Mom</span></p>
    </div>
    <div style="display: flex; gap: 10px; margin-top: 16px">
      <a href="C2-Kid-Recipe.dc.html" style="flex: 1; display: flex; align-items: center; justify-content: space-between; height: 58px; padding: 0 7px 0 18px; background: #D1E043; border-radius: 999px; color: #34430C; box-sizing: border-box; white-space: nowrap">
        <span style="font-size: 18px; font-weight: 800">Hear Mom <span style="font-weight: 600; font-size: 16px; margin-left: 2px">0:24</span></span>
        <span style="width: 44px; height: 44px; border-radius: 50%; background: #34430C; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg></span>
      </a>
      <a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; justify-content: center; height: 58px; padding: 0 20px; border: 2px solid #FFFDF7; border-radius: 999px; color: #FFFDF7; font-size: 17px; font-weight: 700; box-sizing: border-box; white-space: nowrap">Recipe</a>
    </div>
  </div>
</div>
```
Parent equivalent, the HelloFresh photo tile (peach block, title on the photo over the scrim, the
person's words in a cream slip with their face):
```html
<!-- FROM LEO: peach block -->
<div style="position: absolute; left: 16px; right: 16px; top: 220px; background: #F9E3CF; border-radius: 32px; overflow: hidden">
  <a href="C2-Parent-Recipe.dc.html" style="display: block; position: relative; height: 176px">
    <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="The bowl of ramen Leo cooked from your recipe" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 55%">
    <span style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(18,20,16,0.78) 100%)"></span>
    <span style="position: absolute; left: 14px; top: 14px; display: flex; align-items: center; height: 36px; padding: 0 16px; background: #FFFDF7; border-radius: 999px; font-size: 16px; font-weight: 800; color: #1E2410">Leo&#8217;s photo</span>
    <span style="position: absolute; left: 20px; right: 20px; bottom: 14px; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 30px; line-height: 1.05; letter-spacing: -0.01em; color: #FFFDF7">Leo made your ramen.</span>
  </a>
  <!-- sticker -->
  <div aria-hidden="true" style="position: absolute; right: 10px; top: 10px; width: 100px; height: 100px; transform: rotate(-8deg)">
    <svg width="100" height="100" viewBox="0 0 100 100"><path d="M50.0 8.0A8.6 8.6 0 0 1 66.1 11.2A8.6 8.6 0 0 1 79.7 20.3A8.6 8.6 0 0 1 88.8 33.9A8.6 8.6 0 0 1 92.0 50.0A8.6 8.6 0 0 1 88.8 66.1A8.6 8.6 0 0 1 79.7 79.7A8.6 8.6 0 0 1 66.1 88.8A8.6 8.6 0 0 1 50.0 92.0A8.6 8.6 0 0 1 33.9 88.8A8.6 8.6 0 0 1 20.3 79.7A8.6 8.6 0 0 1 11.2 66.1A8.6 8.6 0 0 1 8.0 50.0A8.6 8.6 0 0 1 11.2 33.9A8.6 8.6 0 0 1 20.3 20.3A8.6 8.6 0 0 1 33.9 11.2A8.6 8.6 0 0 1 50.0 8.0Z" fill="#D1E043" stroke="#34430C" stroke-width="3"/><circle cx="50" cy="50" r="33" fill="none" stroke="#34430C" stroke-width="1.5" stroke-dasharray="2 3"/></svg>
    <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 15px; line-height: 0.95; color: #34430C; text-transform: uppercase">Pass<br>it<br>down</div>
  </div>

  <div style="padding: 16px 16px 18px">
    <div style="display: flex; gap: 12px; align-items: flex-start; background: #FFFDF7; border-radius: 20px; padding: 14px 16px 14px 14px">
      <span style="width: 52px; height: 52px; border-radius: 50%; overflow: hidden; position: relative; display: block; flex: none; box-shadow: 0 0 0 3px #ECE6F2"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="Leo" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
      <div>
        <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 20px; line-height: 1.3; color: #5A3A22">&#8220;First try. The whole hallway smelled like your kitchen.&#8221;</p>
        <p style="margin: 6px 0 0; font-size: 16px; font-weight: 600; color: #5F6352">Leo · Thu, Oct 9</p>
      </div>
    </div>
  </div>
</div>
```

### 5.10 List row: photo left, heart right (ref 7/8), on cream
Accent line `#C8462A` on cream only. Parent rows: see 5.11.
```html
<div style="display: flex; align-items: center; gap: 14px; padding: 10px 0">
  <a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0">
    <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="" style="width: 84px; height: 84px; border-radius: 22px; object-fit: cover; object-position: 50% 45%; flex: none">
    <span style="display: block; min-width: 0">
      <span style="display: block; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 20px; line-height: 1.15; color: #1E2410">Pork &amp; Chive Dumplings</span>
      <span style="display: block; margin-top: 4px; font-size: 15px; font-weight: 700; color: #C8462A">Mom · new today</span>
      <span style="display: block; margin-top: 2px; font-size: 15px; font-weight: 500; color: #5F6352">1 hr 20 min · makes ~40</span>
    </span>
  </a>
  <button type="button" aria-label="Save Pork and Chive Dumplings" style="width: 44px; height: 44px; border-radius: 50%; border: 1.5px solid rgba(71,67,42,0.24); padding: 0; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></button>
</div>
```

### 5.11 Parent list row (no heart; round arrow; who-cooked emphasis)
```html
<a href="C2-Parent-Recipe.dc.html" style="display: flex; align-items: center; gap: 14px; padding: 12px 0">
  <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="" style="width: 88px; height: 88px; border-radius: 22px; object-fit: cover; object-position: 50% 60%; flex: none">
  <span style="display: block; flex: 1; min-width: 0">
    <span style="display: block; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 22px; line-height: 1.15; color: #1E2410">Ramen, Mom&#8217;s Way</span>
    <span style="display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 16px; font-weight: 700; color: #4C5A10"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Leo cooked it</span>
    <span style="display: block; margin-top: 2px; font-size: 16px; font-weight: 500; color: #5F6352">Thu, Oct 9 · he sent a photo</span>
  </span>
  <span style="width: 52px; height: 52px; border-radius: 50%; background: #34430C; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
</a>
```

### 5.12 Bubble panel (ref 8) as a color block
Peach (accent line `#8A3F12`), rows split by a 1.5px rule indented past the photo; heart buttons are
cream circles, saved = tomato fill:
```html
<div style="background: #F9E3CF; border-radius: 32px; padding: 18px 16px 10px 20px">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 30px; line-height: 1.05; letter-spacing: -0.01em; color: #1E2410">Picked for you</h2>
    <a href="C2-Kid-Browse.dc.html" aria-label="See all picked for you" style="width: 44px; height: 44px; border-radius: 50%; background: #34430C; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
  <div style="display: flex; align-items: center; gap: 12px; padding: 10px 0">
    <a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0">
      <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="" style="width: 68px; height: 68px; border-radius: 18px; object-fit: cover; object-position: 50% 60%; flex: none">
      <span style="display: block; min-width: 0">
        <span style="display: block; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 20px; line-height: 1.15; color: #1E2410">Ramen, Mom&#8217;s Way</span>
        <span style="display: block; margin-top: 3px; font-size: 15px; font-weight: 700; color: #8A3F12">For exam week</span>
        <span style="display: block; margin-top: 1px; font-size: 15px; font-weight: 500; color: #5F6352">10 min · one pot · about $2</span>
      </span>
    </a>
    <button type="button" aria-label="Saved: Ramen, Mom's Way" style="width: 44px; height: 44px; border-radius: 50%; border: 0; padding: 0; background: #FFFDF7; color: #C8462A; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="#E95D3D" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></button>
  </div>
  <div style="height: 1.5px; background: rgba(110,74,51,0.16); margin-left: 80px"></div>
  <div style="display: flex; align-items: center; gap: 12px; padding: 10px 0">
    <a href="C2-Kid-Recipe.dc.html" style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0">
      <img src="/_blob/42c862566a3eb3ea62b4a078619b633e" alt="" style="width: 68px; height: 68px; border-radius: 18px; object-fit: cover; object-position: 50% 50%; flex: none">
      <span style="display: block; min-width: 0">
        <span style="display: block; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 20px; line-height: 1.15; color: #1E2410">Sunday Chili</span>
        <span style="display: block; margin-top: 3px; font-size: 15px; font-weight: 700; color: #8A3F12">Lunch all week</span>
        <span style="display: block; margin-top: 1px; font-size: 15px; font-weight: 500; color: #5F6352">Dad · 50 min · makes 6 bowls</span>
      </span>
    </a>
    <button type="button" aria-label="Save Sunday Chili" style="width: 44px; height: 44px; border-radius: 50%; border: 0; padding: 0; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></button>
  </div>
</div>
```
Forest panel ("Hear their voices"; play button instead of a heart for voice rows):
```html
<div style="background: #34430C; border-radius: 32px; padding: 18px 16px 10px 20px">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 30px; line-height: 1.05; letter-spacing: -0.01em; color: #FFFDF7">Hear their <span style="font-style: italic; color: #D1E043">voices</span></h2>
    <a href="C2-Kid-Home-Scrolled.dc.html" aria-label="See all voices" style="width: 44px; height: 44px; border-radius: 50%; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
  <div style="display: flex; align-items: center; gap: 12px; padding: 10px 0">
    <span style="width: 60px; height: 60px; border-radius: 50%; overflow: hidden; position: relative; display: block; flex: none; box-shadow: 0 0 0 3px #F6D5CC"><img src="/_blob/5845b3a84b9a62bd4c8e0da61f982bde" alt="Nai Nai's hands" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 40%; transform: scale(1.3); transform-origin: 42% 40%"></span>
    <span style="display: block; flex: 1; min-width: 0">
      <span style="display: block; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 20px; line-height: 1.15; color: #FFFDF7">Why Nai Nai never cuts a noodle</span>
      <span style="display: block; margin-top: 3px; font-size: 15px; font-weight: 700; color: #D1E043">Her voice, kept for always</span>
      <span style="display: block; margin-top: 1px; font-size: 15px; font-weight: 500; color: #C9D0AE">In Mandarin, English words underneath · 1:12</span>
    </span>
    <a href="C2-Kid-Recipe.dc.html" aria-label="Hear Nai Nai, 1 minute 12" style="width: 48px; height: 48px; border-radius: 50%; background: #D1E043; color: #34430C; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></a>
  </div>
</div>
```
Lime-wash panel: same markup as peach with `background: #EDF2BE`, accent line `#4C5A10`, divider
`rgba(60,74,11,0.16)`.
Peek of a panel above the tab bar (Kid-Home):
```html
<!-- NEXT SECTION PEEK: peach bubble panel -->
<div style="position: absolute; left: 16px; right: 16px; top: 700px; height: 200px; background: #F9E3CF; border-radius: 32px; padding: 18px 16px 0 22px; box-sizing: border-box">
  <div style="display: flex; align-items: center; justify-content: space-between">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 30px; line-height: 1.05; letter-spacing: -0.01em; color: #1E2410">Picked for you</h2>
    <a href="C2-Kid-Home-Scrolled.dc.html" aria-label="See all picked for you" style="width: 44px; height: 44px; border-radius: 50%; background: #34430C; color: #FFFDF7; display: flex; align-items: center; justify-content: center; flex: none"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
</div>
```

### 5.13 Filter pills (Kid-Browse, on a forest header band)
```html
<div style="display: flex; gap: 8px; flex-wrap: wrap">
  <a href="C2-Kid-Browse.dc.html" aria-current="true" style="display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px 0 10px; background: #D1E043; border-radius: 999px; color: #34430C; font-size: 16px; font-weight: 800; box-sizing: border-box"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#34430C"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#D1E043" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Everyone</a>
  <a href="C2-Kid-Browse.dc.html" style="display: flex; align-items: center; height: 44px; padding: 0 16px; border: 1.5px solid rgba(255,253,247,0.45); border-radius: 999px; color: #FFFDF7; font-size: 16px; font-weight: 700; box-sizing: border-box; background: #34430C">Mom</a>
</div>
```

### 5.14 Badges, stickers, marks
Status pills (Luma): sun "New from Mom", lime-wash "You cooked it" (with tick), peach "Mom answered":
```html
<span style="display: inline-flex; align-items: center; height: 30px; padding: 0 12px; background: #FEBE29; border-radius: 999px; font-size: 15px; font-weight: 800; color: #1E2410">New from Mom</span>
<span style="display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 12px 0 8px; background: #EDF2BE; border-radius: 999px; font-size: 15px; font-weight: 800; color: #3C4A0B"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You cooked it</span>
<span style="display: inline-flex; align-items: center; height: 30px; padding: 0 12px; background: #F9E3CF; border-radius: 999px; font-size: 15px; font-weight: 800; color: #6E4A33">Mom answered</span>
```
Date tile (sun; parent request card "SUN 19 OCT"):
```html
<span style="width: 68px; height: 76px; border-radius: 18px; background: #FEBE29; display: flex; flex-direction: column; align-items: center; justify-content: center; flex: none">
  <span style="font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: #1E2410">SUN</span>
  <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 30px; line-height: 1; color: #1E2410">19</span>
  <span style="font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: #1E2410">OCT</span>
</span>
```
Stickers (scalloped, 100-112px, rotate -8°). Three fixed recipes, never change their colors:
- TASTE OF HOME (kid): cream fill, sun 4px rim, tomato dashes, forest text (see 5.9 hero).
- PASS IT DOWN (parent, cooks): chartreuse fill, forest 3px rim, forest dashes, forest text (see 5.9 parent tile).
- NEW FROM MOM (kid): sun fill, cream rim, ink dashes, ink text:
```html
<div aria-hidden="true" style="position: relative; width: 104px; height: 104px; transform: rotate(-8deg); flex: none">
  <svg width="104" height="104" viewBox="0 0 100 100"><path d="M50.0 8.0A8.6 8.6 0 0 1 66.1 11.2A8.6 8.6 0 0 1 79.7 20.3A8.6 8.6 0 0 1 88.8 33.9A8.6 8.6 0 0 1 92.0 50.0A8.6 8.6 0 0 1 88.8 66.1A8.6 8.6 0 0 1 79.7 79.7A8.6 8.6 0 0 1 66.1 88.8A8.6 8.6 0 0 1 50.0 92.0A8.6 8.6 0 0 1 33.9 88.8A8.6 8.6 0 0 1 20.3 79.7A8.6 8.6 0 0 1 11.2 66.1A8.6 8.6 0 0 1 8.0 50.0A8.6 8.6 0 0 1 11.2 33.9A8.6 8.6 0 0 1 20.3 20.3A8.6 8.6 0 0 1 33.9 11.2A8.6 8.6 0 0 1 50.0 8.0Z" fill="#FEBE29" stroke="#FFFDF7" stroke-width="3"/><circle cx="50" cy="50" r="33" fill="none" stroke="#1E2410" stroke-width="1.5" stroke-dasharray="2 3"/></svg>
  <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 15px; line-height: 0.95; color: #1E2410; text-transform: uppercase">New<br>from<br>Mom</div>
</div>
```
Scalloped avatar frame (Profiles: cooks on sun `#FEBE29`, kids on chartreuse `#D1E043`):
```html
<a href="C2-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 6px; width: 112px">
  <span style="position: relative; width: 112px; height: 112px; display: block">
    <svg width="112" height="112" viewBox="0 0 100 100" aria-hidden="true" style="position: absolute; inset: 0"><path d="M50.0 8.0A8.6 8.6 0 0 1 66.1 11.2A8.6 8.6 0 0 1 79.7 20.3A8.6 8.6 0 0 1 88.8 33.9A8.6 8.6 0 0 1 92.0 50.0A8.6 8.6 0 0 1 88.8 66.1A8.6 8.6 0 0 1 79.7 79.7A8.6 8.6 0 0 1 66.1 88.8A8.6 8.6 0 0 1 50.0 92.0A8.6 8.6 0 0 1 33.9 88.8A8.6 8.6 0 0 1 20.3 79.7A8.6 8.6 0 0 1 11.2 66.1A8.6 8.6 0 0 1 8.0 50.0A8.6 8.6 0 0 1 11.2 33.9A8.6 8.6 0 0 1 20.3 20.3A8.6 8.6 0 0 1 33.9 11.2A8.6 8.6 0 0 1 50.0 8.0Z" fill="#D1E043"/></svg>
    <span style="position: absolute; left: 17px; top: 17px; width: 78px; height: 78px; border-radius: 50%; overflow: hidden; display: block"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
  </span>
  <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 22px; line-height: 1.1; color: #1E2410">Leo</span>
</a>
```
Wave swirl: see 5.4 (sun `#F0AE14`); on forest use stroke `#4C5A10`; on peach `#FFDDBF`. Always
`stroke-width="14"`, rows 60px apart, clipped by the block (`overflow: hidden` on the block).

### 5.15 Notes
Mom's note slip (kid; parent version = cream slip with the sender's face, see 5.9):
```html
<div style="background: #F9E3CF; border-radius: 16px; padding: 12px 16px 10px; transform: rotate(-1.2deg)">
  <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 19px; line-height: 1.3; color: #5A3A22">&#8220;Your favorite. Don&#8217;t skip the ginger.&#8221; <span style="font-family: 'Caveat', cursive; font-style: normal; font-weight: 600; font-size: 24px; line-height: 1; color: #6E4A33; white-space: nowrap; margin-left: 6px">Love, Mom</span></p>
</div>
```
Caveat note with hand-drawn arrow (decoration only; 26px; forest on cream, `#D1E043` on forest; one per
kid screen, none on parent):
```html
<div aria-hidden="true" style="display: flex; align-items: flex-end; gap: 4px; transform: rotate(-3deg)">
  <svg width="40" height="44" viewBox="0 0 40 44" fill="none" stroke="#34430C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M34 40C18 40 8 30 8 8"/><path d="M2 14l6-7 6 7"/></svg>
  <span style="font-family: 'Caveat', cursive; font-weight: 600; font-size: 26px; line-height: 1; color: #34430C">she&#8217;ll want a photo</span>
</div>
```

### 5.16 Avatars (verified crops; any square size, `border-radius: 50%; overflow: hidden`)
- Mom `object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%` (`/_blob/6fd63122b3a283a11efb5fe02c7d93c5`)
- Leo `object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%` (`/_blob/4417cbdb3744afb9da843b01fddb1979`)
- Dad `object-position: 37% 30%; transform: scale(2.2); transform-origin: 25% 16%` (`/_blob/dd41c56c78266bad25359c8734bc3081`)
- Nai Nai (hands) `object-position: 42% 40%; transform: scale(1.3); transform-origin: 42% 40%` (`/_blob/5845b3a84b9a62bd4c8e0da61f982bde`)
- Maya: lime-wash circle, Fraunces 700 "M" `#3C4A0B` (see 5.8 parent). Auntie Lin: butter `#FFF1C7`, "L" `#8A3F12`.

## 6. Screen guidance for the other seven boards
- **C2-Profiles**: full forest screen with forest swirls (`#4C5A10`), "Who's at the *table?*" cream 42
  with chartreuse italic; group label + sticker "PASS IT DOWN" over the cooks (Mom, Dad, Nai Nai on sun
  scallops) and "TASTE OF HOME" over the ones who miss it (Leo, Maya on chartreuse scallops, + dashed
  "Add family"); context line under each name 15px `#C9D0AE` (Mom "Leo asked you something" in
  chartreuse); Caveat "every family needs both" + arrow in chartreuse; "You can switch anytime."
- **Kid-Home-Scrolled**: same sun top row but a short band (or none, scrolled); peach panel "Picked for
  you" (3 rows, reasons in `#8A3F12`), forest panel "Hear their *voices*", a sun card "Mom's birthday is
  in 2 weeks." + forest lander pill "See the recipe". Tab bar Home active.
- **Kid-Recipe**: dumplings photo top ~46% with round cream icon buttons (back left; heart right); cream
  card overlapping by 28px, radius 32 top; title Fraunces 800 34, by-line meta; Mom's words in Fraunces
  italic 20; "Cooking for" option boxes (5.8 kid); Watch + Hear pair (5.7); ingredients inside a peach
  block (feel words Fraunces italic 18 `#5A3A22`, `~` estimate DM Sans 15 `#6E4A33`); sticky "Cook with
  Mom" (5.7). One Caveat: "you've got this, Leo".
- **Kid-Browse**: forest header band (radius 0 0 32 32) with "Our *family* table" cream 42 (chartreuse
  italic) + "9 recipes, 4 cooks" `#C9D0AE` + filter pills (5.13); rows on cream (5.10); end-of-list
  "Ask for a recipe" outline pill. Tab bar Recipes active.
- **Parent-Home-Scrolled**: lime-wash panel "Your recipes" (3 parent rows 5.11); sun block "Leo wants
  to learn" with the date tile + his quote + forest "Record it Sunday"; legacy line in a forest block,
  cream Fraunces italic 24.
- **Parent-Recipe**: ramen photo top with the "Back" pill; cream card, title 34; "Watch yourself" as a
  forest lander pill; "Who cooked it": Leo row lit (forest option style + "LEO COOKED IT" stamp-like
  status pill), Maya quiet "Not yet"; peach question block + forest "Answer with your voice" + helper.
- **Parent-Send**: cream ground, "Back" pill, "Send your dumplings" 44; 3 video tiles with check circles;
  "Who is it for?" option boxes (5.8 parent, Leo lit); voice note row; sticky "Send to Leo" 72px forest
  lander pill; reassurance 19px under it. One "PASS IT DOWN" sticker max.

## 7. Don'ts (C2-specific)
- No highlighter block behind words (Hearth), no dark night ground (Lamplight), no paper/kraft/Polaroid
  (Recipe Box), no rectangular buttons (Big Table). C2 buttons are always pills.
- No gradients except the photo scrim. No shadows on blocks. No left-border cards.
- Tomato never carries text. Sun never carries muted grey.
- Two forest blocks never touch. One forest primary per screen; everything else outline, sun or text.

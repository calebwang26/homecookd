# C3 LAMPLIGHT: visual system spec (lead designer)

Read BRIEF.md and DIRECTION.md first (facts, copy, hard rules). This file is the concept-3 system. Two
boards are the source of truth and every snippet below is copied from them or from a rendered test board:
- `canvas/project/C3-Kid-Home.dc.html` (Leo, Sunday 9:40 pm, night kitchen)
- `canvas/project/C3-Parent-Home.dc.html` (Mom, Monday 8:10 am, morning kitchen)
Open their renders (`renders/C3-Kid-Home.png`, `renders/C3-Parent-Home.png`) before you start, and
`renders/c3-test-kid.png` / `renders/c3-test-parent.png` for the components not on the home boards.

**The idea in one line:** the kitchen light left on. Leo's screens are a warm night (walnut and
lamplight yellow, streaming-app structure). Mom's screens are the same structure in morning light
(butter and cream, forest buttons), bigger and calmer. What travels between them (Leo's photo, Mom's
dumplings) keeps its own light: Leo's night photo sits at the top of Mom's morning screen.

---

## 1. Tokens

### Kid (night)
| Role | Hex / value | Notes |
|---|---|---|
| Ground | `#1C1712` night kitchen | page root background; hero scrims end in this |
| Panel / sheet | `#2A221A` walnut | bubble panels (ref 8), the recipe sheet (ref 2) |
| Tab bar | `#121410`, top `1px solid rgba(255,241,199,0.14)` | |
| Hairline on dark | `rgba(255,241,199,0.12)` (rows) / `0.14` (bars) / `0.22` (unselected option border) | |
| Round button fill on dark | `rgba(255,241,199,0.10)` | header arrows, hearts |
| Text | cream `#FFFDF7` | |
| Muted text | `#C9D0AE` | 9.8:1 on walnut, never lighter |
| Lamplight accent | sun `#FEBE29` | accent lines, active tab, selected outline + check, eyebrow pill, the one accent word |
| Notes / time stamp | lemon `#FFE59A` | Caveat note, "Sunday, 9:40 pm", reason pills on posters |
| Primary button | cream `#FFFDF7` pill, label `#1E2410` | Google TV white pill |
| Secondary button | 2px `#FFFDF7` outline pill, cream label, transparent fill | |
| Hearts | `#F2A7A0` filled when saved; cream outline when not | |
| Selected option | 2.5px `#FEBE29` border, fill `rgba(254,190,41,0.10)`, 26px sun check circle with `#1E2410` tick | |
| Unselected option | 1.5px `rgba(255,241,199,0.22)`, transparent, empty ring `rgba(255,241,199,0.45)` | |
| Status pills | New from Mom `#FEBE29`/`#1E2410` · You cooked it `#E6EBCF`/`#4C5A10` · Mom answered `#F6D5CC`/`#5A3A22` · Saved `rgba(255,241,199,0.12)`/cream | |

### Parent (morning)
| Role | Hex / value | Notes |
|---|---|---|
| Ground | `#FFF1C7` butter | page root background |
| Panel / sheet | `#FFFDF7` cream, shadow `0 2px 0 rgba(71,67,42,0.08)` | |
| Tab bar | `#FFFDF7`, top `1px solid rgba(71,67,42,0.14)` | |
| Hairline | `rgba(71,67,42,0.12)` rows · `0.24` borders | |
| Text | heading `#1E2410`, body `#2D3222` | |
| Muted | `#5F6352` (≥4.99 on butter/cream) | never lighter |
| Accent line | apricot-ink `#8A3F12` | sun fails on light, never use sun for text here |
| Primary | forest `#34430C` pill, cream label, 52px sun `#FEBE29` circle with ink icon on the left | |
| Secondary | 2px `#34430C` outline pill, forest label, cream fill | |
| Selected option | 3px `#34430C` border, 32px forest check circle with cream tick | |
| Unselected option | 1.5px `rgba(71,67,42,0.24)`, cream fill, empty ring `rgba(71,67,42,0.4)` | |
| Soft fills | butter `#FFF1C7` (round arrows, "See all" pill, date tile on cream panels), sunken `#EFEFE6` ("Not yet") | |
| Status pills | Leo cooked it `#E6EBCF`/`#4C5A10` · Not yet `#EFEFE6`/`#5F6352` · Leo asked you `#FEBE29`/`#1E2410` | |
| Highlight word | sun block behind ONE ink word (`p-highlight`) | |
| Hero on a photo | the same night scrims as the kid side; text on it is cream | |

### Shared
- Scrims (photo only, never decoration): top `linear-gradient(180deg, #1C1712 0%, #1C1712 38%, rgba(28,23,18,0.55) 70%, rgba(28,23,18,0) 100%)` when the greeting sits on the photo (kid); parent top `linear-gradient(180deg, rgba(28,23,18,0.88) 0%, rgba(28,23,18,0.6) 50%, rgba(28,23,18,0) 100%)` over 170px; bottom `linear-gradient(180deg, rgba(28,23,18,0) 0%, rgba(28,23,18,0.72) 22%, rgba(28,23,18,0.9) 45%, #1C1712 80%)` (kid, fades into the ground). Parent bottom scrim ends at `rgba(28,23,18,0.94)` because the photo has a rounded bottom edge instead of fading.
- **Lamplight grade** on the kid full-bleed hero photo only: `filter: sepia(0.18) saturate(1.1) brightness(0.92)`. Not on thumbnails, not on parent screens.
- Cook colors (rings/tints): Mom peach `#F9E3CF`, Dad sage `#E6EBCF`, Nai Nai rose `#F6D5CC`, Auntie Lin butter `#FFF1C7`, Leo ube `#ECE6F2`, Maya lime-wash `#EDF2BE` (Maya's initial tile: `#EDF2BE` + Fraunces 600 "M" `#3C4A0B`).
- New hexes in this concept: `#1C1712`, `#2A221A` only (the two allowed). Everything else is brand.

## 2. Type scale (px)
Display = `font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0;` · Body = `'DM Sans', system-ui, sans-serif` · Note = `'Caveat', cursive` 600.

| Use | Kid | Parent | Spec |
|---|---|---|---|
| Hero title on photo | **40** (one line: "Sunday Dumplings") | **44**, two lines with `<br>` | Fraunces 600, lh 1.0-1.02, ls -0.02em |
| Greeting / screen headline | 36 ("Still up, Leo?") | 28 greeting on photo ("Good morning, Mom."); 40 for a headline on butter | Fraunces 500 (greeting) / 600 (headline), lh 1.05-1.1 |
| Section header | 26 | 30 | Fraunces 600, lh 1.1 |
| Option/recipe card title in a sheet | 28-34 | 32-40 | Fraunces 600 |
| Row title | 18 | 20 (21 in option boxes) | DM Sans 700, lh 1.25 |
| Body | 17 | 19 | DM Sans 400, lh 1.4 |
| Quote (the cook's or Leo's own words) | 20 (19 in ingredient rows) | 21 | Fraunces italic 400, lh 1.32-1.35, always in curly quotes |
| Meta / accent line | 15 (accent 600) | 16 (accent 700) | DM Sans |
| Eyebrow pill | 15 / 700 | 16 / 700 | DM Sans, ink on sun |
| Time stamp | 15 / 600 lemon | 16 / 600 lemon (on photo) | with moon (kid) or sun (parent) icon |
| Button | 18 / 700 | 20 / 700 (primary 22) | DM Sans |
| Tab label | 13 (600, active 700) | 14 (600, active 800) | |
| Caveat | 26 lemon, one per screen | none | decoration only, never carries info |

## 3. Spacing, sizes, radii
- 8pt rhythm. Text side margin **20px**; panels/cards inset **16px**; panel padding 16-20; gaps 10/12/14/18.
- Top calm space **54px** (no status bar). Content never closer than 16px to the tab bar top (y = 760).
- Radii: panels **28**; parent hero bottom corners **32**; detail-screen sheet top corners **32**; option boxes 20 (kid) / 22 (parent); row thumbnails **14** (72 kid / 76 parent); poster cards **16** (140×190); inset photo 20; pills 999; round buttons **44** (kid, dark) / **48** (cream, over photos) / 52-56 (parent icon circles inside big buttons).
- Buttons: kid 56 (hero), 60 sticky; parent secondary 60, primary/sticky 72.
- Tab bar: 84px tall incl. bottom padding (kid 26, parent 22); icon 26 (kid) / 28 (parent) in a 64×32 (kid) / 64×34 (parent) pill.

## 4. Kid vs parent deltas (explicit)
| | Kid (Leo, night) | Parent (Mom, morning) |
|---|---|---|
| Ground | `#1C1712`, walnut panels | `#FFF1C7` butter, cream panels |
| Hero | full-bleed photo from y=0, greeting on its top scrim, fades into the ground; title 40 one line | full-bleed photo y=0-404 with **rounded bottom (32)**, title 44 on two lines; content continues on butter |
| Accent | sun for lines, checks, active tab; lemon for notes | apricot-ink `#8A3F12` for lines; sun only as fills (eyebrow pill, active tab pill, icon circle, highlight) |
| Primary | cream pill, ink label, 56-60 | forest pill 72, sun icon circle + cream 22px label, helper line under it |
| Back | round 48 cream icon button `aria-label="Back"` | pill 52 with chevron + the word "Back" |
| Rows | photo 72 left, **heart** in a 44 round button right | photo 76 left, round **arrow** circle right, the whole row is one link |
| Panel header action | round 44 arrow button (aria-label) | "See all" pill 48 with the word |
| Horizontal rows | allowed (posters 140×190, peek of the 3rd card + header arrow) | never; single column |
| Density | up to 3 sections visible | 2 sections max |
| Decoration | one Caveat lemon note, one sticker max | none (mascot only on Profiles / empty states) |
| Time stamp | moon + "Sunday, 9:40 pm" | sun + "Monday, Oct 13" |
| Helper text | rare | under every unfamiliar action (17px muted) |

---

## 5. Snippets (copy-paste, exactly as on the boards)

### 5.1 Page skeleton + roots
Use the BRIEF section 8 skeleton verbatim (support.js line, helmet with the font link, the dc script
block). Kid root and parent root:
```html
<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: #1C1712; font-family: 'DM Sans', system-ui, sans-serif; color: #FFFDF7">
  …
</div>
```
```html
<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: #FFF1C7; font-family: 'DM Sans', system-ui, sans-serif; color: #2D3222">
  …
</div>
```

### 5.2 KID tab bar (Kid-Home and Kid-Home-Scrolled: Home active)
```html
<!-- KID TAB BAR (night) -->
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 84px; padding-bottom: 26px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #121410; border-top: 1px solid rgba(255,241,199,0.14)">
  <a href="C3-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #FEBE29">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 32px; border-radius: 999px; background: rgba(254,190,41,0.16)">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 700">Home</span>
  </a>
  <a href="C3-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #C9D0AE">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 32px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600">Recipes</span>
  </a>
  <a href="C3-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #C9D0AE">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 32px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600">Ask</span>
  </a>
  <a href="C3-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #C9D0AE">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 32px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600">Family</span>
  </a>
</nav>
```
Active / inactive tab templates (swap which `<a>` gets the active form; only one active per bar):
```html
<!-- ACTIVE kid tab: sun color, tinted pill, label 700, aria-current; add fill="currentColor" fill-opacity="0.2" on the icon's main shape -->
<a href="C3-Kid-Browse.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #FEBE29">
  <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 32px; border-radius: 999px; background: rgba(254,190,41,0.16)">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v13.5"/></svg>
  </span>
  <span style="font-size: 13px; font-weight: 700">Recipes</span>
</a>
<!-- INACTIVE kid tab: #C9D0AE, no pill background, label 600 -->
<a href="C3-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: #C9D0AE">
  <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 32px">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>
  </span>
  <span style="font-size: 13px; font-weight: 600">Home</span>
</a>
```
Kid tabs, in order: Home → `C3-Kid-Home.dc.html` · Recipes → `C3-Kid-Browse.dc.html` · Ask → `C3-Kid-Home-Scrolled.dc.html` · Family → `C3-Profiles.dc.html`. Kid-Browse = Recipes active.

### 5.3 PARENT tab bar (Parent-Home and Parent-Home-Scrolled: Home active)
```html
<!-- PARENT TAB BAR (morning) -->
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 84px; padding-bottom: 22px; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, 1fr); background: #FFFDF7; border-top: 1px solid rgba(71,67,42,0.14)">
  <a href="C3-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; color: #1E2410">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 34px; border-radius: 999px; background: #FEBE29">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 800">Home</span>
  </a>
  <a href="C3-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; color: #5F6352">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 34px">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600">My recipes</span>
  </a>
  <a href="C3-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; color: #5F6352">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 34px">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600">Record</span>
  </a>
  <a href="C3-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; color: #5F6352">
    <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 34px">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600">Family</span>
  </a>
</nav>
```
Active / inactive parent tab templates:
```html
<!-- ACTIVE parent tab: solid sun pill, ink icon + ink label 800 -->
<a href="C3-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; color: #1E2410">
  <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 34px; border-radius: 999px; background: #FEBE29">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg>
  </span>
  <span style="font-size: 14px; font-weight: 800">Home</span>
</a>
<!-- INACTIVE parent tab: #5F6352, no pill, label 600 -->
<a href="C3-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; color: #5F6352">
  <span style="display: flex; align-items: center; justify-content: center; width: 64px; height: 34px">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
  </span>
  <span style="font-size: 14px; font-weight: 600">Record</span>
</a>
```
Parent tabs, in order: Home → `C3-Parent-Home.dc.html` · My recipes → `C3-Parent-Home-Scrolled.dc.html` · Record → `C3-Parent-Send.dc.html` · Family → `C3-Profiles.dc.html`. Detail screens (Kid-Recipe, Parent-Recipe, Parent-Send) have no tab bar: back button + sticky CTA.

### 5.4 Top greeting / header
Kid (time stamp with moon, greeting 36, Leo's avatar links to Profiles). Sits on the hero's top scrim, or directly on `#1C1712` on screens without a hero:
```html
<!-- TOP: time stamp + greeting (left), Leo (right) -->
<div style="position: absolute; left: 20px; right: 20px; top: 54px; display: flex; align-items: flex-start; justify-content: space-between">
  <div style="display: flex; flex-direction: column; gap: 6px">
    <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; color: #FFE59A">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" fill-opacity="0.25"/></svg>
      Sunday, 9:40 pm
    </span>
    <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 500; font-size: 36px; line-height: 1.05; letter-spacing: -0.01em; color: #FFFDF7">Still up, Leo?</h1>
  </div>
  <a href="C3-Profiles.dc.html" aria-label="Leo. Switch who's cooking" style="position: relative; display: block; flex: 0 0 48px; width: 48px; height: 48px; margin-top: 4px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 2px #FFFDF7">
    <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%">
  </a>
</div>
```
Parent (sun + date in lemon, greeting 28 cream; sits on the photo's top scrim):
```html
<!-- TOP: greeting + date -->
<div style="position: absolute; left: 20px; right: 20px; top: 54px; display: flex; flex-direction: column; gap: 4px">
  <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; color: #FFE59A">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.25"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>
    Monday, Oct 13
  </span>
  <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 500; font-size: 28px; line-height: 1.1; color: #FFFDF7">Good morning, Mom.</span>
</div>
```
On a parent screen WITHOUT a hero photo (e.g. Home-Scrolled), use ink on butter: date line `color: #8A3F12` (sun icon `#8A3F12`), then a Fraunces 600 40px `#1E2410` headline.

### 5.5 Section header with round arrow (kid) / "See all" pill (parent)
Kid (from Kid-Home; also the header row of every kid bubble panel):
```html
<div style="display: flex; align-items: center; justify-content: space-between; padding: 0 20px">
  <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; line-height: 1.1; color: #FFFDF7">Picked for you</h2>
  <a href="C3-Kid-Home-Scrolled.dc.html" aria-label="See all picked for you" style="width: 44px; height: 44px; border-radius: 50%; background: rgba(255,241,199,0.10); color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</div>
```
(The block above continues with the Google TV poster row; see 5.9.) Parent header is inside the panel snippet 5.11.

### 5.6 Buttons
Kid primary + secondary pair (hero; primary flex 1.2, secondary flex 1; `<a>` for navigation, `<button>` for actions):
```html
<div style="display: flex; gap: 12px; margin-top: 18px">
  <button type="button" style="flex: 1.2; height: 56px; border: 0; border-radius: 999px; background: #FFFDF7; color: #1E2410; font-family: 'DM Sans', system-ui, sans-serif; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity="0.2"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>
    Hear Mom · 0:24
  </button>
  <a href="C3-Kid-Recipe.dc.html" style="flex: 1; height: 56px; box-sizing: border-box; border: 2px solid #FFFDF7; border-radius: 999px; color: #FFFDF7; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px">
    Open recipe
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</div>
```
Kid Watch / Hear pair (on the recipe sheet both are outline; the big CTA is the sticky one):
```html
<div style="display: flex; gap: 12px">
  <button type="button" style="flex: 1; height: 56px; box-sizing: border-box; border: 2px solid #FFFDF7; border-radius: 999px; background: transparent; color: #FFFDF7; font-family: 'DM Sans', system-ui, sans-serif; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg>
    Watch Mom
  </button>
  <button type="button" style="flex: 1; height: 56px; box-sizing: border-box; border: 2px solid #FFFDF7; border-radius: 999px; background: transparent; color: #FFFDF7; font-family: 'DM Sans', system-ui, sans-serif; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>
    Hear Mom
  </button>
</div>
```
Kid icon buttons over a photo (Subway, 48 cream rounds, top 54):
```html
<a href="C3-Kid-Home.dc.html" aria-label="Back" style="position: absolute; left: 16px; top: 54px; width: 48px; height: 48px; border-radius: 50%; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.28)">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
</a>
<button type="button" aria-label="Save to my recipes" style="position: absolute; right: 16px; top: 54px; width: 48px; height: 48px; border: 0; border-radius: 50%; background: #FFFDF7; color: #1E2410; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.28); cursor: pointer">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>
</button>
```
Kid sticky CTA (detail screens; replaces the tab bar):
```html
<div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 20px 30px; background: #1C1712; border-top: 1px solid rgba(255,241,199,0.14)">
  <a href="C3-Kid-Recipe.dc.html" style="height: 60px; border-radius: 999px; background: #FFFDF7; color: #1E2410; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px">
    Start cooking
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</div>
```
Parent primary (72, sun icon circle) + helper line:
```html
<!-- PRIMARY: Record a recipe -->
<div style="position: absolute; left: 16px; right: 16px; top: 640px; display: flex; flex-direction: column; align-items: center; gap: 8px">
  <a href="C3-Parent-Send.dc.html" style="width: 100%; height: 72px; box-sizing: border-box; padding: 0 12px 0 12px; border-radius: 999px; background: #34430C; color: #FFFDF7; display: flex; align-items: center; gap: 14px">
    <span style="flex: 0 0 52px; width: 52px; height: 52px; border-radius: 50%; background: #FEBE29; color: #1E2410; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" fill-opacity="0.2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
    </span>
    <span style="font-size: 22px; font-weight: 700">Record a recipe</span>
  </a>
  <span style="font-size: 17px; line-height: 1.3; color: #5F6352">Cook like always. We'll write it down.</span>
</div>
```
Parent secondary (outline 60), from the note panel:
```html
<button type="button" style="height: 60px; border: 2px solid #34430C; border-radius: 999px; background: #FFFDF7; color: #34430C; font-family: 'DM Sans', system-ui, sans-serif; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
  Tell him well done
</button>
```
Parent back pill (always the word "Back"):
```html
<a href="C3-Parent-Home.dc.html" style="position: absolute; left: 16px; top: 54px; height: 52px; padding: 0 20px 0 12px; box-sizing: border-box; border-radius: 999px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); color: #1E2410; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.12)">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
  Back
</a>
```
Parent sticky CTA + reassurance (Parent-Send "Send to Leo", Parent-Recipe "Answer with your voice" with the mic icon):
```html
<div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 16px 28px; background: #FFF1C7; border-top: 1px solid rgba(71,67,42,0.14); display: flex; flex-direction: column; align-items: center; gap: 8px">
  <a href="C3-Parent-Home.dc.html" style="width: 100%; height: 72px; box-sizing: border-box; padding: 0 12px; border-radius: 999px; background: #34430C; color: #FFFDF7; display: flex; align-items: center; gap: 14px">
    <span style="flex: 0 0 52px; width: 52px; height: 52px; border-radius: 50%; background: #FEBE29; color: #1E2410; display: flex; align-items: center; justify-content: center">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/></svg>
    </span>
    <span style="font-size: 22px; font-weight: 700">Send to Leo</span>
  </a>
  <span style="font-size: 17px; line-height: 1.3; color: #5F6352; text-align: center">You can close the app. We'll let you know when it's ready.</span>
</div>
```
Parent text button (quiet third action, e.g. "Send to Maya"):
```html
<a href="C3-Parent-Send.dc.html" style="display: inline-flex; align-items: center; gap: 6px; min-height: 48px; color: #34430C; font-size: 18px; font-weight: 700">
  Send to Maya
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
</a>
```

### 5.7 Option boxes (ref 2), selected + unselected
Kid ("Cooking for", two side by side; check sits in the title row):
```html
<div style="display: flex; flex-direction: column; gap: 10px">
  <span style="font-size: 15px; font-weight: 700; color: #C9D0AE">Cooking for</span>
  <div style="display: flex; gap: 12px">
    <button type="button" aria-pressed="true" style="position: relative; flex: 1; min-height: 88px; padding: 14px 14px 14px 16px; box-sizing: border-box; border: 2.5px solid #FEBE29; border-radius: 20px; background: rgba(254,190,41,0.10); color: #FFFDF7; font-family: 'DM Sans', system-ui, sans-serif; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 4px; cursor: pointer">
      <span style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 18px; font-weight: 700; line-height: 1.2">Just me
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#FEBE29"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#1E2410" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span style="font-size: 15px; line-height: 1.3; color: #C9D0AE">Boil 10, freeze 30</span>
    </button>
    <button type="button" aria-pressed="false" style="position: relative; flex: 1; min-height: 88px; padding: 14px 14px 14px 16px; box-sizing: border-box; border: 1.5px solid rgba(255,241,199,0.22); border-radius: 20px; background: transparent; color: #FFFDF7; font-family: 'DM Sans', system-ui, sans-serif; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 4px; cursor: pointer">
      <span style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 18px; font-weight: 700; line-height: 1.2">Friends
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25" fill="none" stroke="rgba(255,241,199,0.45)" stroke-width="1.5"/></svg>
      </span>
      <span style="font-size: 15px; line-height: 1.3; color: #C9D0AE">Cook all 40 tonight</span>
    </button>
  </div>
</div>
```
Parent ("Who is it for?", full-width rows with a face; Everyone uses a cream circle with the family icon):
```html
<div style="display: flex; flex-direction: column; gap: 12px">
  <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; line-height: 1.15; color: #1E2410">Who is it for?</span>
  <button type="button" aria-pressed="true" style="position: relative; width: 100%; min-height: 84px; padding: 14px 60px 14px 14px; box-sizing: border-box; border: 3px solid #34430C; border-radius: 22px; background: #FFFDF7; color: #1E2410; font-family: 'DM Sans', system-ui, sans-serif; text-align: left; display: flex; align-items: center; gap: 14px; cursor: pointer">
    <span style="position: relative; flex: 0 0 52px; width: 52px; height: 52px; border-radius: 50%; overflow: hidden">
      <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%">
    </span>
    <span style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 21px; font-weight: 700; line-height: 1.2">Leo</span>
      <span style="font-size: 16px; line-height: 1.3; color: #5F6352">At college</span>
    </span>
    <svg style="position: absolute; top: 50%; right: 16px; margin-top: -16px" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#34430C"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <button type="button" aria-pressed="false" style="position: relative; width: 100%; min-height: 84px; padding: 14px 60px 14px 14px; box-sizing: border-box; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 22px; background: #FFFDF7; color: #1E2410; font-family: 'DM Sans', system-ui, sans-serif; text-align: left; display: flex; align-items: center; gap: 14px; cursor: pointer">
    <span style="flex: 0 0 52px; width: 52px; height: 52px; border-radius: 50%; background: #EDF2BE; color: #3C4A0B; display: flex; align-items: center; justify-content: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 24px">M</span>
    <span style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 21px; font-weight: 700; line-height: 1.2">Maya</span>
      <span style="font-size: 16px; line-height: 1.3; color: #5F6352">At home</span>
    </span>
    <svg style="position: absolute; top: 50%; right: 16px; margin-top: -16px" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25" fill="none" stroke="rgba(71,67,42,0.4)" stroke-width="1.5"/></svg>
  </button>
</div>
```

### 5.8 Hero card
Kid (Google TV: photo, eyebrow pill with Mom's face, dots, title, Mom's words, Caveat signature, two buttons). Photo layer + text layer:
```html
<!-- HERO PHOTO (full bleed, fades into the night ground) -->
<a href="C3-Kid-Recipe.dc.html" aria-label="Open Mom's Sunday Dumplings" style="position: absolute; left: 0; top: 0; width: 390px; height: 600px; display: block; overflow: hidden">
  <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's handmade dumplings in a steamer basket, flour on the table" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%; filter: sepia(0.18) saturate(1.1) brightness(0.92)">
  <div style="position: absolute; left: 0; right: 0; top: 0; height: 260px; background: linear-gradient(180deg, #1C1712 0%, #1C1712 38%, rgba(28,23,18,0.55) 70%, rgba(28,23,18,0) 100%)"></div>
  <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 360px; background: linear-gradient(180deg, rgba(28,23,18,0) 0%, rgba(28,23,18,0.72) 22%, rgba(28,23,18,0.9) 45%, #1C1712 80%)"></div>
</a>
```
```html
<!-- HERO TEXT (Google TV) -->
<div style="position: absolute; left: 20px; right: 20px; top: 318px; display: flex; flex-direction: column">
  <div style="display: flex; align-items: center; justify-content: space-between">
    <span style="display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 4px; box-sizing: border-box; border-radius: 999px; background: #FEBE29; color: #1E2410">
      <span style="position: relative; display: block; width: 32px; height: 32px; border-radius: 50%; overflow: hidden">
        <img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="Mom" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%">
      </span>
      <span style="font-size: 15px; font-weight: 700">Just in from Mom · 6:15 pm</span>
    </span>
    <div aria-label="1 of 3" style="display: flex; gap: 6px; align-items: center">
      <span style="display: block; width: 18px; height: 6px; border-radius: 999px; background: #FEBE29"></span>
      <span style="display: block; width: 6px; height: 6px; border-radius: 999px; background: rgba(255,253,247,0.45)"></span>
      <span style="display: block; width: 6px; height: 6px; border-radius: 999px; background: rgba(255,253,247,0.45)"></span>
    </div>
  </div>
  <a href="C3-Kid-Recipe.dc.html" style="display: block; margin-top: 12px; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 40px; line-height: 1.02; letter-spacing: -0.02em; color: #FFFDF7">Sunday Dumplings</a>
  <p style="margin: 12px 0 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 400; font-size: 20px; line-height: 1.35; color: #FFFDF7">“Made these today. Saved you a bag for Thanksgiving.”</p>
  <span style="margin-top: 2px; font-family: 'Caveat', cursive; font-weight: 600; font-size: 26px; line-height: 1.1; color: #FFE59A">Love, Mom</span>
  <div style="display: flex; gap: 12px; margin-top: 18px">
    <button type="button" style="flex: 1.2; height: 56px; border: 0; border-radius: 999px; background: #FFFDF7; color: #1E2410; font-family: 'DM Sans', system-ui, sans-serif; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity="0.2"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>
      Hear Mom · 0:24
    </button>
    <a href="C3-Kid-Recipe.dc.html" style="flex: 1; height: 56px; box-sizing: border-box; border: 2px solid #FFFDF7; border-radius: 999px; color: #FFFDF7; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px">
      Open recipe
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </div>
</div>
```
Parent (photo with rounded bottom, inset "His photo", eyebrow pill with Leo's face, two-line title):
```html
<!-- HERO PHOTO: Leo's night kitchen arriving in Mom's morning (full bleed top, rounded bottom) -->
<div style="position: absolute; left: 0; top: 0; width: 390px; height: 404px; overflow: hidden; border-radius: 0 0 32px 32px; background: #1C1712">
  <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="Leo cooking alone at night in his small kitchen" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 22%">
  <div style="position: absolute; left: 0; right: 0; top: 0; height: 170px; background: linear-gradient(180deg, rgba(28,23,18,0.88) 0%, rgba(28,23,18,0.6) 50%, rgba(28,23,18,0) 100%)"></div>
  <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 230px; background: linear-gradient(180deg, rgba(28,23,18,0) 0%, rgba(28,23,18,0.78) 45%, rgba(28,23,18,0.94) 100%)"></div>
</div>
```
```html
<!-- HIS PHOTO (inset, the ramen he sent) -->
<div style="position: absolute; right: 20px; top: 136px; display: flex; flex-direction: column; align-items: center; gap: 6px">
  <div style="width: 112px; height: 112px; box-sizing: border-box; border: 4px solid #FFFDF7; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 22px rgba(0,0,0,0.35)">
    <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="The ramen Leo made, in a floral bowl" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%; border-radius: 16px">
  </div>
  <span style="padding: 3px 10px; border-radius: 999px; background: rgba(28,23,18,0.82); color: #FFFDF7; font-size: 15px; font-weight: 600">His photo</span>
</div>
```
```html
<!-- HERO TEXT on the scrim -->
<div style="position: absolute; left: 20px; right: 20px; top: 240px; display: flex; flex-direction: column; gap: 12px">
  <span style="display: inline-flex; align-self: flex-start; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 4px; box-sizing: border-box; border-radius: 999px; background: #FEBE29; color: #1E2410">
    <span style="position: relative; display: block; width: 32px; height: 32px; border-radius: 50%; overflow: hidden">
      <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="Leo" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%">
    </span>
    <span style="font-size: 16px; font-weight: 700">From Leo · Thu, Oct 9</span>
  </span>
  <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 44px; line-height: 1; letter-spacing: -0.02em; color: #FFFDF7">Leo made<br>your ramen.</h1>
</div>
```
Detail screens (Kid-Recipe, Parent-Recipe): photo top ~46-48% (`height: 400px`, no fade, no grade on
parent), round buttons (5.6) on it, then a sheet overlapping by 32px: kid `background: #2A221A; border-radius: 32px 32px 0 0`, parent `background: #FFFDF7; border-radius: 32px 32px 0 0`. See `renders/c3-test-*.png` top halves.

### 5.9 Poster row (ref 6, kid only)
140×190, radius 16, reason pill top-left (dark pill, lemon text), third card peeks off the right edge:
```html
<div style="display: flex; gap: 12px; padding: 0 20px; margin-top: 14px">
  <div style="position: relative; flex: 0 0 140px; height: 190px; border-radius: 16px; overflow: hidden; background: #2A221A">
    <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Mom's ramen" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%">
    <span style="position: absolute; left: 8px; top: 8px; padding: 5px 11px; border-radius: 999px; background: rgba(28,23,18,0.86); color: #FFE59A; font-size: 15px; font-weight: 700">Exam week</span>
  </div>
  <div style="position: relative; flex: 0 0 140px; height: 190px; border-radius: 16px; overflow: hidden; background: #2A221A">
    <img src="/_blob/697ebb89d5f6a4f5afc190136cef5a33" alt="Nai Nai's noodle soup" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%">
    <span style="position: absolute; left: 8px; top: 8px; padding: 5px 11px; border-radius: 999px; background: rgba(28,23,18,0.86); color: #FFE59A; font-size: 15px; font-weight: 700">Miss home</span>
  </div>
  <div style="position: relative; flex: 0 0 140px; height: 190px; border-radius: 16px; overflow: hidden; background: #2A221A">
    <img src="/_blob/42c862566a3eb3ea62b4a078619b633e" alt="Dad's Sunday chili" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 50%">
    <span style="position: absolute; left: 8px; top: 8px; padding: 5px 11px; border-radius: 999px; background: rgba(28,23,18,0.86); color: #FFE59A; font-size: 15px; font-weight: 700">Lunch all week</span>
  </div>
</div>
```

### 5.10 List row: photo left, heart right (refs 7/8), inside a kid bubble panel
```html
<section style="margin: 0 16px; padding: 16px 14px 10px 18px; background: #2A221A; border-radius: 28px">
  <div style="display: flex; align-items: center; justify-content: space-between">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; line-height: 1.1; color: #FFFDF7">For midterms week</h2>
    <a href="C3-Kid-Browse.dc.html" aria-label="See all for midterms week" style="flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; background: rgba(255,241,199,0.10); color: #FFFDF7; display: flex; align-items: center; justify-content: center">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </div>
  <div style="display: flex; flex-direction: column; margin-top: 8px">
    <!-- ROW (kid): photo left, heart right -->
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0">
      <a href="C3-Kid-Recipe.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">
        <span style="position: relative; flex: 0 0 72px; width: 72px; height: 72px; border-radius: 14px; overflow: hidden; background: #1C1712">
          <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%">
        </span>
        <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
          <span style="font-size: 18px; font-weight: 700; line-height: 1.25; color: #FFFDF7">Ramen, Mom's Way</span>
          <span style="font-size: 15px; font-weight: 600; line-height: 1.3; color: #FEBE29">For exam week</span>
          <span style="font-size: 15px; line-height: 1.3; color: #C9D0AE">10 min · one pot · about $2</span>
        </span>
      </a>
      <button type="button" aria-label="Saved. Ramen, Mom's Way" aria-pressed="true" style="flex: 0 0 44px; width: 44px; height: 44px; border: 0; border-radius: 50%; background: rgba(255,241,199,0.10); color: #F2A7A0; display: flex; align-items: center; justify-content: center; cursor: pointer">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>
      </button>
    </div>
    <!-- ROW (kid), not saved yet -->
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0">
      <a href="C3-Kid-Recipe.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">
        <span style="position: relative; flex: 0 0 72px; width: 72px; height: 72px; border-radius: 14px; overflow: hidden; background: #1C1712">
          <img src="/_blob/a340c9a7273fb10c8302c2bd55cb14a1" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 50%">
        </span>
        <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
          <span style="font-size: 18px; font-weight: 700; line-height: 1.25; color: #FFFDF7">Ginger-Scallion Fish</span>
          <span style="font-size: 15px; font-weight: 600; line-height: 1.3; color: #FEBE29">Dinner in 20</span>
          <span style="font-size: 15px; line-height: 1.3; color: #C9D0AE">Dad · 20 min</span>
        </span>
      </a>
      <button type="button" aria-label="Save Ginger-Scallion Fish" aria-pressed="false" style="flex: 0 0 44px; width: 44px; height: 44px; border: 0; border-radius: 50%; background: rgba(255,241,199,0.10); color: #FFFDF7; display: flex; align-items: center; justify-content: center; cursor: pointer">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>
      </button>
    </div>
  </div>
</section>
```
Kid voice row ("Hear their voices"; round face/hands avatar 64, sun play button 48 that says whose and how long in its aria-label and the muted line):
```html
<div style="display: flex; align-items: center; gap: 14px; padding: 8px 0">
  <span style="position: relative; flex: 0 0 64px; width: 64px; height: 64px; border-radius: 50%; overflow: hidden">
    <img src="/_blob/5845b3a84b9a62bd4c8e0da61f982bde" alt="Nai Nai's hands" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 40%; transform: scale(1.3); transform-origin: 42% 40%">
  </span>
  <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
    <span style="font-size: 18px; font-weight: 700; line-height: 1.25; color: #FFFDF7">Why Nai Nai never cuts a noodle</span>
    <span style="font-size: 15px; line-height: 1.3; color: #C9D0AE">In Mandarin, English words underneath · 1:12</span>
  </span>
  <button type="button" aria-label="Hear Nai Nai, 1 minute 12" style="flex: 0 0 48px; width: 48px; height: 48px; border: 0; border-radius: 50%; background: #FEBE29; color: #1E2410; display: flex; align-items: center; justify-content: center; cursor: pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>
  </button>
</div>
```
For Kid-Browse (ref 7) use the same row on the `#1C1712` ground (no panel), rows separated by
`border-bottom: 1px solid rgba(255,241,199,0.12)`.

### 5.11 Bubble panel (ref 8)
Kid = 5.10 (walnut `#2A221A`, radius 28, Fraunces 26 header + round 44 arrow, 2-4 rows with hearts).
Parent (cream panel, Fraunces 30 header + "See all" pill, 2-3 rows, each row a single link ending in a round arrow):
```html
<section style="margin: 0 16px; padding: 20px 16px 10px; background: #FFFDF7; border-radius: 28px; box-shadow: 0 2px 0 rgba(71,67,42,0.08)">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 30px; line-height: 1.1; color: #1E2410">Your recipes</h2>
    <a href="C3-Parent-Home-Scrolled.dc.html" style="flex: 0 0 auto; height: 48px; padding: 0 14px 0 18px; border-radius: 999px; background: #FFF1C7; color: #1E2410; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 6px">
      See all
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </div>
  <div style="display: flex; flex-direction: column; margin-top: 8px">
    <!-- ROW (parent): photo left, round arrow right, the whole row is one link -->
    <a href="C3-Parent-Recipe.dc.html" style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(71,67,42,0.12)">
      <span style="position: relative; flex: 0 0 76px; width: 76px; height: 76px; border-radius: 14px; overflow: hidden">
        <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%">
      </span>
      <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
        <span style="font-size: 20px; font-weight: 700; line-height: 1.25; color: #1E2410">Ramen, Mom's Way</span>
        <span style="font-size: 16px; font-weight: 700; line-height: 1.3; color: #8A3F12">Leo cooked it ✓</span>
        <span style="font-size: 16px; line-height: 1.3; color: #5F6352">Oct 9 · sent a photo</span>
      </span>
      <span style="flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; background: #FFF1C7; color: #1E2410; display: flex; align-items: center; justify-content: center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </span>
    </a>
    <a href="C3-Parent-Recipe.dc.html" style="display: flex; align-items: center; gap: 12px; padding: 10px 0">
      <span style="position: relative; flex: 0 0 76px; width: 76px; height: 76px; border-radius: 14px; overflow: hidden">
        <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%">
      </span>
      <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
        <span style="font-size: 20px; font-weight: 700; line-height: 1.25; color: #1E2410">Pork &amp; Chive Dumplings</span>
        <span style="font-size: 16px; font-weight: 700; line-height: 1.3; color: #8A3F12">Sent to Leo Sunday</span>
        <span style="font-size: 16px; line-height: 1.3; color: #5F6352">He watched it 3 times</span>
      </span>
      <span style="flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; background: #FFF1C7; color: #1E2410; display: flex; align-items: center; justify-content: center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </span>
    </a>
  </div>
</section>
```
Parent note panel (Leo's words in Fraunces italic 21 + one secondary action), from Parent-Home:
```html
<!-- HIS NOTE + reply (panel) -->
<div style="position: absolute; left: 16px; right: 16px; top: 420px; padding: 18px 20px 20px; box-sizing: border-box; background: #FFFDF7; border-radius: 28px; box-shadow: 0 2px 0 rgba(71,67,42,0.08); display: flex; flex-direction: column; gap: 14px">
  <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 21px; line-height: 1.32; color: #1E2410">“Made your ramen before my exam. Added the egg like you said. Tasted like home.”</p>
  <button type="button" style="height: 60px; border: 2px solid #34430C; border-radius: 999px; background: #FFFDF7; color: #34430C; font-family: 'DM Sans', system-ui, sans-serif; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
    Tell him well done
  </button>
</div>
```

### 5.12 Badges, pills, marks
Eyebrow pill (sun, with the sender's face): see 5.8 (`Just in from Mom · 6:15 pm`, `From Leo · Thu, Oct 9`).
Kid status pills (Luma), on dark:
```html
<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 15px; font-weight: 700">New from Mom</span>
<span style="display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 11px 0 8px; border-radius: 999px; background: #E6EBCF; color: #4C5A10; font-size: 15px; font-weight: 700"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You cooked it</span>
<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 999px; background: #F6D5CC; color: #5A3A22; font-size: 15px; font-weight: 700">Mom answered</span>
<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 999px; background: rgba(255,241,199,0.12); color: #FFFDF7; font-size: 15px; font-weight: 700">Saved</span>
```
Parent status pills, on cream:
```html
<span style="display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 12px 0 9px; border-radius: 999px; background: #E6EBCF; color: #4C5A10; font-size: 16px; font-weight: 700"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Leo cooked it</span>
<span style="display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px; background: #EFEFE6; color: #5F6352; font-size: 16px; font-weight: 700">Not yet</span>
<span style="display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 16px; font-weight: 700">Leo asked you</span>
```
Date tile (ref 3; parent request card "SUN 19 OCT"):
```html
<span style="flex: 0 0 64px; width: 64px; height: 76px; border-radius: 16px; background: #FFF1C7; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1">
  <span style="font-size: 14px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352">SUN</span>
  <span style="margin: 3px 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 30px; color: #1E2410">19</span>
  <span style="font-size: 14px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352">OCT</span>
</span>
```
Accent word: kid = sun italic word inside a Fraunces headline; parent = sun highlighter block (one per screen):
```html
<em style="font-style: italic; color: #FEBE29">home</em>
```
```html
<span style="background: #FEBE29; padding: 0 6px; border-radius: 6px; color: #1E2410">next</span>
```
Sticker (kid only, max one per screen, Profiles or Kid-Recipe photo corner; "TASTE OF HOME" kids / "PASS IT DOWN" cooks):
```html
<div aria-hidden="true" style="position: absolute; right: 18px; top: 250px; width: 104px; height: 104px; transform: rotate(-8deg)">
  <svg width="104" height="104" viewBox="0 0 100 100"><path d="M50.0 8.0A8.6 8.6 0 0 1 66.1 11.2A8.6 8.6 0 0 1 79.7 20.3A8.6 8.6 0 0 1 88.8 33.9A8.6 8.6 0 0 1 92.0 50.0A8.6 8.6 0 0 1 88.8 66.1A8.6 8.6 0 0 1 79.7 79.7A8.6 8.6 0 0 1 66.1 88.8A8.6 8.6 0 0 1 50.0 92.0A8.6 8.6 0 0 1 33.9 88.8A8.6 8.6 0 0 1 20.3 79.7A8.6 8.6 0 0 1 11.2 66.1A8.6 8.6 0 0 1 8.0 50.0A8.6 8.6 0 0 1 11.2 33.9A8.6 8.6 0 0 1 20.3 20.3A8.6 8.6 0 0 1 33.9 11.2A8.6 8.6 0 0 1 50.0 8.0Z" fill="#FEBE29" stroke="#1C1712" stroke-width="3"/><circle cx="50" cy="50" r="33" fill="none" stroke="#1E2410" stroke-width="1.5" stroke-dasharray="2 3"/></svg>
  <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 800; font-size: 14px; line-height: 1.05; letter-spacing: 0.02em; color: #1E2410">TASTE<br>OF HOME</div>
</div>
```
Ingredient row (cook's words big in Fraunces italic, ~ estimate in sun):
```html
<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid rgba(255,241,199,0.12)">
  <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 19px; line-height: 1.3; color: #FFFDF7">“a big handful of chives, only the green”</span>
  <span style="flex: 0 0 auto; font-size: 15px; font-weight: 700; color: #FEBE29">~1 cup</span>
</div>
```
Parent ingredient row: same structure, text `#1E2410` 20px, estimate `#8A3F12` 16px 700, hairline `rgba(71,67,42,0.12)`.

### 5.13 Caveat note (kid only, lemon, one per screen)
```html
<span style="font-family: 'Caveat', cursive; font-weight: 600; font-size: 26px; line-height: 1.1; color: #FFE59A">she'll want a photo</span>
```
Pot mascot: inline `kit/pot-mascot.svg.txt` as is; on dark, recolor only the steam strokes to `#FFE59A`. Use on Profiles (or an empty state), never on parent home screens.

### 5.14 Avatars (DIRECTION section E crops; box `position: relative; overflow: hidden; border-radius: 50%`)
- Mom `object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%` (`/_blob/6fd63122b3a283a11efb5fe02c7d93c5`)
- Leo `object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%` (`/_blob/4417cbdb3744afb9da843b01fddb1979`)
- Dad `object-position: 37% 30%; transform: scale(2.2); transform-origin: 25% 16%` (`/_blob/dd41c56c78266bad25359c8734bc3081`, avatar crop only)
- Nai Nai (hands) `object-position: 42% 40%; transform: scale(1.3); transform-origin: 42% 40%` (`/_blob/5845b3a84b9a62bd4c8e0da61f982bde`)
- Rings: `box-shadow: 0 0 0 2px #FFFDF7` (identity, kid top-right), `0 0 0 3px #FEBE29` (something is waiting for this person, Profiles).

---

## 6. Rules of thumb for the other seven boards
1. One sun-filled thing per region. On a kid screen, the eyebrow pill and the active tab are the loud sun; poster reasons are dark pills with lemon text. On a parent screen the only big color is the forest primary.
2. Every screen states its time of day once (moon + "Sunday, 9:40 pm" / sun + "Monday, Oct 13"); Parent-Send is Sunday, 4:30 pm (sun icon).
3. Kid photos may run full bleed and fade into `#1C1712`; parent photos end in a 32px rounded edge and content continues on butter.
4. Quotes are always someone's own words in Fraunces italic with curly quotes, with that person's face nearby.
5. Check the render for: text over a bright part of a photo without a scrim (fix with the scrim or a pill), anything within 16px of the tab bar, a second loud button.

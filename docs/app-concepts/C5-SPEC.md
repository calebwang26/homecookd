# C5 BIG TABLE: visual system spec (lead designer)

Reference boards (built and rendered from exactly these snippets):
- `canvas/project/C5-Kid-Home.dc.html` → `renders/C5-Kid-Home.png`
- `canvas/project/C5-Parent-Home.dc.html` → `renders/C5-Parent-Home.png`
- Component sheet (not a canvas board): `c5work/C5-snippets.dc.html` → `renders/C5-snippets.png`

Every snippet below is extracted by script from those files, so they match the boards byte for byte.
Copy them, change only copy, photos and hrefs. Read DIRECTION.md section F concept 5 for screen notes;
this file wins on exact numbers.

---

## 1. The idea in one breath
Large print, nothing to figure out, still warm. Ref 3 (HelloFresh) is the skeleton of both homes:
a solid colored **header band** with the greeting, **big photo tiles**, then **two full-width
rectangular buttons**, then a **beige tab bar** with big icons and words. Warmth comes ONLY from
faces, food photos and the family's own words (quotes in Fraunces italic). No swirls, no stickers,
no mascot, no highlighter, no tilted things. If you feel like adding decoration, add a face instead.

## 2. Tokens (no new hexes in this concept)

| Role | Kid (Leo) | Parent (Mom) |
|---|---|---|
| Ground | `#F7F7F2` | `#F7F7F2` |
| Header band | forest `#34430C`, bottom corners 28 | sun `#FEBE29`, bottom corners 28 |
| Band text | heading `#FFFDF7`; context line `#E6EBCF`; date line `#C9D0AE` | heading + context `#1E2410`; any small line `#2D3222` (**never `#5F6352` on sun: 3.7, fails**) |
| Card / sheet | `#FFFDF7`, border `1.5px solid rgba(71,67,42,0.24)` | same |
| Inner dividers | `1.5px solid rgba(71,67,42,0.14)` | same |
| Primary button | `#4C5A10` fill, `#FFFDF7` label (7.43) | same |
| Secondary button | `#FFFDF7` fill, `2px solid #1E2410`, label `#1E2410` | same |
| Accent info line | `#4C5A10` bold (7.0 on ground, 7.43 on card) | same |
| Text | heading `#1E2410`, body `#2D3222`, muted `#5F6352` (≥5.4 on every C5 surface incl. `#F1F2DC`) | same |
| Selected option | bg pistachio `#F2F6E1` + `3px solid #4C5A10` + 32px filled `#4C5A10` check | same |
| Unselected option | bg `#FFFDF7` + `1.5px rgba(71,67,42,0.24)` + empty 28px ring `2px #5F6352` | same |
| Tab bar | `#F1F2DC`, top `1.5px solid rgba(71,67,42,0.24)`; active = ink `#1E2410` pill 72×40 + cream icon + ink label 800; inactive `#5F6352` 600 | same, pill 76×42 |
| Round icon button bg | `#F1F2DC` (inside cards) or `#FFFDF7` + border (on ground) | same |
| Status pills (Luma) | "New from Mom" `#FEBE29`/`#1E2410` · "You cooked it" / "He cooked it" `#E6EBCF`/`#4C5A10` (+check) · "Mom answered" `#F9E3CF`/`#6E4A33` · "A question" `#ECE6F2`/`#3F3558` · "Missing home" `#F6D5CC`/`#5A3A22` | same set |
| Hearts (kid only) | unsaved: `#FFFDF7` 52px circle, ink stroke, word "Save" `#5F6352`; saved: `#FAD6CB` circle, heart fill `#F2A7A0` stroke `#9A4F47`, word "Saved" `#9A4F47` | **no hearts**; rows end in a 56px `#F1F2DC` round arrow |
| Cook tints (avatars, pills) | Mom `#F9E3CF`, Dad `#E6EBCF`, Nai Nai `#F6D5CC`, Auntie Lin `#FFF1C7`, Leo `#ECE6F2`, Maya `#EDF2BE` (initial `#3C4A0B`) | same |
| Photo scrim (only gradient allowed) | `linear-gradient(180deg, rgba(18,20,16,0) 30%, rgba(18,20,16,0.82) 100%)` | same |

## 3. Type
Fonts link: the BRIEF one. Display = `font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0;`
weight **700** everywhere for headings (quotes: italic 500). Body = DM Sans. Caveat 600 kid only, once per screen, decoration.

| Token | Kid px / weight / lh | Parent px / weight / lh |
|---|---|---|
| Screen headline (detail screens, Fraunces 700, ls -0.01em) | 40 / 700 / 1.08 | 44 / 700 / 1.08 |
| Band greeting (Fraunces 700) | 34 / 700 / 1.08 | 38 / 700 / 1.08 (may wrap to 2 lines; that is fine) |
| Band context line (DM Sans) | 19 / 400 / 1.4 | 21 / 400 / 1.4 |
| Band date line (DM Sans) | 17 / 600 / 22px | (not used on Parent-Home; if used: 18 / 600, `#2D3222`) |
| Hero title on scrim (Fraunces 700) | 32 / 700 / 1.05, cream | 32 / 700 / 1.05 |
| Section header (Fraunces 700) | 30 / 700 / 1.1 (28 inside a bubble panel) | 32 / 700 / 1.1 (30 inside a panel) |
| Numbered step label (Fraunces 700) | 24 / 700 / 1.15, after a 36px ink circle | 26 / 700, after a 40px circle |
| Card / tile title (Fraunces 700) | 22-24 / 700 / 1.12-1.15 | 24-26 / 700 / 1.12 |
| Quote (cook's / kid's words, Fraunces italic 500) | 19 / 1.35 | 20 / 1.25 |
| Body (DM Sans 400) | 19 / 1.5 | 21 / 1.5 |
| Row title (non-Fraunces rows, DM Sans 700) | 19 / 1.25 | 21 / 1.25 |
| Accent line (DM Sans 700, `#4C5A10`) | 17 / 1.3 | 18 / 1.3 |
| Meta / muted line (DM Sans 500-600) | 17 / 1.3 | 18 / 1.3 |
| Helper text under a button (DM Sans 500, `#5F6352`, centered) | 17 | 18 |
| Button label (DM Sans 700) | 20 | 22 |
| Status pill (DM Sans 700) | 17 (16 allowed on a 171px tile) | 17 |
| Labels under round buttons ("Save", "Play") | 15 / 600-700 | 16 |
| Tab label | 15 / 18px (active 800, else 600) | 16 / 19px |
| Caveat 600 (kid only, once) | 28, `#4C5A10` | none |

## 4. Space, size, radius
- 8pt rhythm. Side margins **16** (cards 358 wide). Band inner padding `48-50px 16px 18-20px 20px`.
- Gaps: between cards/buttons **12** (kid) / 12-14 (parent); before a new section +6-12; inside cards 12-16.
- Calm top: no status bar drawn; the band's top padding (48-50px) is the safe area.
- Tab bar: kid **90px** (content stops ≥16px above y=754), parent **94px** (stop ≥16px above y=750).
- Radii: band bottom 28; cards & option boxes **20**; photos **18** (inside cards: top corners follow the card); bubble panels 24;
  buttons **18 (rectangles, never pills)**; status pills, filter pills, back pill, tab pill 999; round buttons 50%.
- Heights: primary button kid **64**, parent **72**; secondary kid 64, parent 64; option boxes **≥ 88**; filter pills 48;
  back pill kid 52, parent 56; round icon buttons kid 48 (header arrow) / 52 (heart, play), parent 56.
- Photos: hero ~358×196 (kid home), home tiles 171 wide, list thumbs **96×96**, voice-row faces 72, band avatar 56 (kid) / 64 (parent).
- Avatar crops: use DIRECTION section E verbatim (Mom/Leo/Dad/Nai Nai transforms). Avatar ring in a band: `box-shadow: 0 0 0 3px #FFFDF7`.

## 5. Kid vs Parent deltas (explicit)
| | Kid | Parent |
|---|---|---|
| Band | forest, cream type, date line + "Hi Leo" + context line, Leo avatar 56 → Profiles | sun, ink type, "Good morning, Mom" (2 lines) + "Leo sent you something.", Mom avatar 64 → Profiles |
| Home hero | ONE big photo card (dumplings + scrim title + Mom's quote + Caveat "Love, Mom") then "Hear Mom · 0:24" filled + "Open the recipe" outline | TWO tiles side by side (photo top 124, white bottom with title + quote, ink on cream, no text on photo) then "Record a recipe" 72 filled + helper, "Answer Leo" 64 outline + helper |
| Type | body 19, buttons 20 | body 21, buttons 22, every heading +2-4 |
| Helper text | rare | under EVERY action button |
| Density | ≤3 regions; next section peeks under the tab bar with a 48px round arrow in its header | ≤2 regions; nothing peeks; single column except the two home tiles |
| Rows end in | heart button with "Save"/"Saved" word, or green "Play" | 56px round arrow (whole row is the link) |
| Back | pill "Back" 52px (on photos: cream solid + soft shadow) | pill "Back" 56px with 2px ink border |
| Caveat | once (e.g. "Love, Mom", "you've got this, Leo") | never |
| Info emphasis | time, cost, Mom's voice | who cooked, who watched, who asked |

## 6. Rules every C5 screen follows
1. Biggest colored thing below the band/hero = the one primary action (`#4C5A10` rectangle). Everything else outline or text.
2. Status in pills on photos (top-left, 10-14px inset). Max 1 pill per photo.
3. Quotes are always the person's own words in curly quotes “…” Fraunces italic; never invent new ones (use the copy bank).
4. Labels on everything: every round button has a word under it ("Save", "Play") or is a header arrow with `aria-label`.
5. No decoration besides photos and faces. No mascot (except Profiles empty-state if truly needed), no swirls, stickers, highlighter.
6. Keep muted lines short so they do not wrap to 3 lines next to a 96px thumb ("1 hr 20 min · makes ~40" wraps once; OK).
7. Buttons: icon left + label, centered. No dashes or slashes inside labels.

---

## 7. Snippets

### 7.1 Page root (full file skeleton; tab bar goes right before the root's closing `</div>`)
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Leo's home</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,0..100,0..1;1,9..144,300..900,0..100,0..1&amp;family=DM+Sans:ital,opsz,wght@0,9..40,400..800;1,9..40,400..800&amp;family=Caveat:wght@500..700&amp;display=swap">
<style>
body{margin:0}
a{color:inherit;text-decoration:none}
</style>
</helmet>
<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: #F7F7F2; font-family: 'DM Sans', system-ui, sans-serif; color: #2D3222">
  … screen …
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
```


### 7.2 Header band: KID (forest)
```html
<header style="background: #34430C; border-radius: 0 0 28px 28px; padding: 48px 16px 18px 20px; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px">
    <div style="display: flex; flex-direction: column; gap: 2px">
      <p style="margin: 0; font-size: 17px; font-weight: 600; line-height: 22px; color: #C9D0AE">Sunday, Oct 12</p>
      <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 34px; line-height: 1.08; letter-spacing: -0.01em; color: #FFFDF7">Hi Leo</h1>
      <p style="margin: 2px 0 0; font-size: 19px; line-height: 1.4; color: #E6EBCF">Mom sent you a recipe today.</p>
    </div>
    <a href="C5-Profiles.dc.html" aria-label="Leo. Switch who's cooking" style="flex: none; width: 56px; height: 56px; border-radius: 50%; overflow: hidden; position: relative; box-shadow: 0 0 0 3px #FFFDF7; margin-bottom: 4px">
      <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%">
    </a>
  </header>
```


### 7.3 Header band: PARENT (sun)
```html
<header style="background: #FEBE29; border-radius: 0 0 28px 28px; padding: 50px 16px 20px 20px; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px">
    <div style="display: flex; flex-direction: column; gap: 2px">
      <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 38px; line-height: 1.08; letter-spacing: -0.01em; color: #1E2410">Good morning, Mom</h1>
      <p style="margin: 4px 0 0; font-size: 21px; line-height: 1.4; color: #1E2410">Leo sent you something.</p>
    </div>
    <a href="C5-Profiles.dc.html" aria-label="Mom. Switch who's cooking" style="flex: none; width: 64px; height: 64px; border-radius: 50%; overflow: hidden; position: relative; background: #F9E3CF; box-shadow: 0 0 0 3px #FFFDF7; margin-bottom: 16px">
      <img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%">
    </a>
  </header>
```

`<main>` after the band: kid `padding: 16px 16px 0; gap: 12px`, parent `padding: 18px 16px 0; gap: 12px` (both `display: flex; flex-direction: column`).

### 7.4 KID tab bar, Home active (Kid-Home, Kid-Home-Scrolled)
```html
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 90px; padding: 8px 8px 21px; box-sizing: border-box; background: #F1F2DC; border-top: 1.5px solid rgba(71,67,42,0.24); display: grid; grid-template-columns: repeat(4, 1fr)">
  <a href="C5-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 800; color: #1E2410">Home</span>
  </a>
  <a href="C5-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Recipes</span>
  </a>
  <a href="C5-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Ask</span>
  </a>
  <a href="C5-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Family</span>
  </a>
</nav>
```


### 7.5 KID tab bar, Recipes active (Kid-Browse)
```html
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 90px; padding: 8px 8px 21px; box-sizing: border-box; background: #F1F2DC; border-top: 1.5px solid rgba(71,67,42,0.24); display: grid; grid-template-columns: repeat(4, 1fr)">
  <a href="C5-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Home</span>
  </a>
  <a href="C5-Kid-Browse.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 800; color: #1E2410">Recipes</span>
  </a>
  <a href="C5-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Ask</span>
  </a>
  <a href="C5-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
    <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Family</span>
  </a>
</nav>
```


### 7.6 KID tab items, active and inactive variant of each tab
```html
<!-- Home: active -->
<a href="C5-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 800; color: #1E2410">Home</span>
</a>
<!-- Home: inactive -->
<a href="C5-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Home</span>
</a>

<!-- Recipes: active -->
<a href="C5-Kid-Browse.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v13.5"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 800; color: #1E2410">Recipes</span>
</a>
<!-- Recipes: inactive -->
<a href="C5-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Recipes</span>
</a>

<!-- Ask: active -->
<a href="C5-Kid-Home-Scrolled.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" fill="currentColor" fill-opacity="0.2"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 800; color: #1E2410">Ask</span>
</a>
<!-- Ask: inactive -->
<a href="C5-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Ask</span>
</a>

<!-- Family: active -->
<a href="C5-Profiles.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" fill="currentColor" fill-opacity="0.2"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 800; color: #1E2410">Family</span>
</a>
<!-- Family: inactive -->
<a href="C5-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 56px">
  <span style="width: 72px; height: 40px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
  <span style="font-size: 15px; line-height: 18px; font-weight: 600; color: #5F6352">Family</span>
</a>
```


### 7.7 PARENT tab bar, Home active (Parent-Home, Parent-Home-Scrolled)
```html
<nav aria-label="Main" style="position: absolute; left: 0; right: 0; bottom: 0; height: 94px; padding: 8px 6px 21px; box-sizing: border-box; background: #F1F2DC; border-top: 1.5px solid rgba(71,67,42,0.24); display: grid; grid-template-columns: repeat(4, 1fr)">
  <a href="C5-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
    <span style="width: 76px; height: 42px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg></span>
    <span style="font-size: 16px; line-height: 19px; font-weight: 800; color: #1E2410">Home</span>
  </a>
  <a href="C5-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
    <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
    <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">My recipes</span>
  </a>
  <a href="C5-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
    <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></span>
    <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">Record</span>
  </a>
  <a href="C5-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
    <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
    <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">Family</span>
  </a>
</nav>
```


### 7.8 PARENT tab items, active and inactive variant of each tab
```html
<!-- Home: active -->
<a href="C5-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.2"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 800; color: #1E2410">Home</span>
</a>
<!-- Home: inactive -->
<a href="C5-Parent-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">Home</span>
</a>

<!-- My recipes: active -->
<a href="C5-Parent-Home-Scrolled.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" fill="currentColor" fill-opacity="0.2"/><path d="M12 6v13.5"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 800; color: #1E2410">My recipes</span>
</a>
<!-- My recipes: inactive -->
<a href="C5-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">My recipes</span>
</a>

<!-- Record: active -->
<a href="C5-Parent-Send.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" fill-opacity="0.2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 800; color: #1E2410">Record</span>
</a>
<!-- Record: inactive -->
<a href="C5-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">Record</span>
</a>

<!-- Family: active -->
<a href="C5-Profiles.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" fill="currentColor" fill-opacity="0.2"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 800; color: #1E2410">Family</span>
</a>
<!-- Family: inactive -->
<a href="C5-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 60px">
  <span style="width: 76px; height: 42px; border-radius: 999px; color: #5F6352; display: flex; align-items: center; justify-content: center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.4 4.6 4"/></svg></span>
  <span style="font-size: 16px; line-height: 19px; font-weight: 600; color: #5F6352">Family</span>
</a>
```


### 7.9 Section header with round arrow button (kid; parent drops the arrow or uses 56px)
```html
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
        <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 30px; line-height: 1.1; color: #1E2410">For this week</h2>
        <a href="C5-Kid-Home-Scrolled.dc.html" aria-label="See everything for this week" style="flex: none; width: 48px; height: 48px; border-radius: 50%; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); color: #1E2410; display: flex; align-items: center; justify-content: center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>
```


### 7.10 Hero card (kid home: photo + scrim title + status pill + cook's note)
```html
<!-- Hero card (ref 6, one tile) -->
    <a href="C5-Kid-Recipe.dc.html" style="display: block; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 20px; overflow: hidden">
      <div style="position: relative; height: 196px">
        <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's pork and chive dumplings on a steamer tray, flour on the table" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%">
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(18,20,16,0) 30%, rgba(18,20,16,0.82) 100%)"></div>
        <span style="position: absolute; left: 14px; top: 14px; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 17px; font-weight: 700">New from Mom · 6:15 pm</span>
        <div style="position: absolute; left: 16px; right: 16px; bottom: 14px">
          <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 32px; line-height: 1.05; color: #FFFDF7">Sunday Dumplings</h2>
          <p style="margin: 4px 0 0; font-size: 17px; font-weight: 500; line-height: 1.3; color: #FFFDF7">Every fold, filmed for you.</p>
        </div>
      </div>
      <div style="display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px 12px 14px">
        <span style="flex: none; width: 48px; height: 48px; border-radius: 50%; overflow: hidden; position: relative; background: #F9E3CF">
          <img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="Mom" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%">
        </span>
        <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 19px; line-height: 1.35; color: #1E2410">“Start with 10. Freeze the rest. You’ll be fine.” <span style="font-family: 'Caveat', cursive; font-style: normal; font-weight: 600; font-size: 28px; line-height: 1; color: #4C5A10; white-space: nowrap">Love, Mom</span></p>
      </div>
    </a>
```


### 7.11 Primary + secondary buttons (kid, 64px)
```html
<!-- Two big full-width buttons (ref 3) -->
    <button type="button" style="all: unset; box-sizing: border-box; width: 100%; height: 64px; border-radius: 18px; background: #4C5A10; color: #FFFDF7; display: flex; align-items: center; justify-content: center; gap: 12px; font-family: 'DM Sans', system-ui, sans-serif; font-size: 20px; font-weight: 700; cursor: pointer">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>
      Hear Mom · 0:24
    </button>
    <a href="C5-Kid-Recipe.dc.html" style="box-sizing: border-box; width: 100%; height: 64px; border-radius: 18px; background: #FFFDF7; border: 2px solid #1E2410; color: #1E2410; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 20px; font-weight: 700">
      Open the recipe
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
```


### 7.12 Primary + secondary buttons with helper text (parent, 72 / 64)
```html
<!-- Two big full-width buttons (ref 3) -->
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px">
      <a href="C5-Parent-Send.dc.html" style="box-sizing: border-box; width: 100%; height: 72px; border-radius: 18px; background: #4C5A10; color: #FFFDF7; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 22px; font-weight: 700">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
        Record a recipe
      </a>
      <p style="margin: 0; text-align: center; font-size: 18px; font-weight: 500; line-height: 1.35; color: #5F6352">Cook like always. We'll write it down.</p>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px">
      <button type="button" style="all: unset; box-sizing: border-box; width: 100%; height: 64px; border-radius: 18px; background: #FFFDF7; border: 2px solid #1E2410; color: #1E2410; display: flex; align-items: center; justify-content: center; gap: 12px; font-family: 'DM Sans', system-ui, sans-serif; font-size: 22px; font-weight: 700; cursor: pointer">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>
        Answer Leo
      </button>
      <p style="margin: 0; text-align: center; font-size: 18px; font-weight: 500; line-height: 1.35; color: #5F6352">Just talk. He'll hear your voice.</p>
    </div>
```


### 7.13 Two big photo tiles (parent home; kid uses the same grid with photo-only tiles + pill, see 7.14)
```html
<!-- Two big photo tiles (ref 3) -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px">
      <a href="C5-Parent-Recipe.dc.html" style="display: flex; flex-direction: column; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 20px; overflow: hidden">
        <div style="position: relative; height: 124px">
          <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Leo's photo of the ramen he made" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 55%">
          <span style="position: absolute; left: 10px; top: 10px; height: 32px; padding: 0 12px; border-radius: 999px; background: #E6EBCF; color: #4C5A10; font-size: 17px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>He cooked it</span>
        </div>
        <div style="padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px">
          <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 24px; line-height: 1.12; color: #1E2410">Leo made your ramen</h2>
          <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 20px; line-height: 1.25; color: #2D3222">“Tasted like home.”</p>
          <p style="margin: 2px 0 0; font-size: 18px; font-weight: 600; line-height: 1.3; color: #5F6352">Thu, Oct 9</p>
        </div>
      </a>
      <a href="C5-Parent-Recipe.dc.html" style="display: flex; flex-direction: column; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 20px; overflow: hidden">
        <div style="position: relative; height: 124px">
          <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="Leo cooking in his kitchen at school" style="width: 100%; height: 100%; object-fit: cover; object-position: 40% 32%">
          <span style="position: absolute; left: 10px; top: 10px; height: 32px; padding: 0 12px; border-radius: 999px; background: #ECE6F2; color: #3F3558; font-size: 17px; font-weight: 700; display: inline-flex; align-items: center">A question</span>
        </div>
        <div style="padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px">
          <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 24px; line-height: 1.12; color: #1E2410">Leo asked you</h2>
          <p style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-weight: 500; font-size: 20px; line-height: 1.25; color: #2D3222">“How thin should the wrappers be?”</p>
        </div>
      </a>
    </div>
```


### 7.14 Kid two-up photo tiles with reason pills (the peek under the tab bar on Kid-Home)
```html
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px">
        <div style="position: relative; height: 200px; border-radius: 18px; overflow: hidden">
          <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Mom's ramen in a floral bowl" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%">
          <span style="position: absolute; left: 10px; top: 10px; height: 30px; padding: 0 12px; border-radius: 999px; background: #E6EBCF; color: #4C5A10; font-size: 16px; font-weight: 700; display: inline-flex; align-items: center">For exam week</span>
        </div>
        <div style="position: relative; height: 200px; border-radius: 18px; overflow: hidden">
          <img src="/_blob/697ebb89d5f6a4f5afc190136cef5a33" alt="Nai Nai's hand-pulled noodle soup" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%">
          <span style="position: absolute; left: 10px; top: 10px; height: 30px; padding: 0 12px; border-radius: 999px; background: #F6D5CC; color: #5A3A22; font-size: 16px; font-weight: 700; display: inline-flex; align-items: center">Missing home</span>
        </div>
      </div>
```

On Kid-Home-Scrolled give each tile a title on the hero scrim (cream Fraunces 700 22) at the bottom.

### 7.15 Back pill, kid, over a photo
```html
<!-- S1 back pill kid on photo -->
<div style="position: relative; height: 120px; border-radius: 18px; overflow: hidden">
  <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover">
  <a href="C5-Kid-Home.dc.html" style="position: absolute; left: 16px; top: 16px; height: 52px; padding: 0 20px 0 14px; border-radius: 999px; background: #FFFDF7; color: #1E2410; display: inline-flex; align-items: center; gap: 6px; font-size: 19px; font-weight: 700; box-shadow: 0 2px 10px rgba(18,20,16,0.18)">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    Back
  </a>
</div>
```


### 7.16 Back pill, parent, on the ground
```html
<!-- S2 back pill parent on ground -->
<a href="C5-Parent-Home.dc.html" style="align-self: flex-start; height: 56px; padding: 0 22px 0 16px; border-radius: 999px; background: #FFFDF7; border: 2px solid #1E2410; color: #1E2410; display: inline-flex; align-items: center; gap: 8px; font-size: 21px; font-weight: 700; box-sizing: border-box">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
  Back
</a>
```


### 7.17 Numbered step label (Kid-Recipe, Parent-Recipe, Parent-Send)
```html
<!-- S3 numbered step label -->
<div style="display: flex; align-items: center; gap: 12px">
  <span style="flex: none; width: 36px; height: 36px; border-radius: 50%; background: #1E2410; color: #FFFDF7; display: flex; align-items: center; justify-content: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 20px">1</span>
  <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 24px; line-height: 1.15; color: #1E2410">Who are you cooking for?</h2>
</div>
```


### 7.18 Option boxes (ref 2), kid two-up: selected + unselected
```html
<!-- S4 option boxes kid -->
<div role="radiogroup" aria-label="Cooking for" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
  <button type="button" role="radio" aria-checked="true" style="all: unset; box-sizing: border-box; position: relative; min-height: 88px; padding: 14px 14px 14px 16px; border-radius: 20px; background: #F2F6E1; border: 3px solid #4C5A10; display: flex; flex-direction: column; justify-content: center; gap: 2px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; top: 10px; right: 10px"><circle cx="12" cy="12" r="11" fill="#4C5A10"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span style="font-size: 20px; font-weight: 800; color: #1E2410; line-height: 1.2; padding-right: 36px">Just me</span>
    <span style="font-size: 17px; font-weight: 600; color: #4C5A10; line-height: 1.3">Boil 10, freeze 30</span>
  </button>
  <button type="button" role="radio" aria-checked="false" style="all: unset; box-sizing: border-box; position: relative; min-height: 88px; padding: 14px 14px 14px 16px; border-radius: 20px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); display: flex; flex-direction: column; justify-content: center; gap: 2px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
    <span aria-hidden="true" style="position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border-radius: 50%; border: 2px solid #5F6352; box-sizing: border-box"></span>
    <span style="font-size: 20px; font-weight: 700; color: #2D3222; line-height: 1.2; padding-right: 36px">Friends</span>
    <span style="font-size: 17px; font-weight: 500; color: #5F6352; line-height: 1.3">Cook all 40 tonight</span>
  </button>
</div>
```


### 7.19 Option boxes, parent full-width with face: selected (Leo) + unselected (Maya)
```html
<!-- S5 option box parent (full-width rows with face) -->
<div role="radiogroup" aria-label="Who is it for?" style="display: flex; flex-direction: column; gap: 12px">
  <button type="button" role="radio" aria-checked="true" style="all: unset; box-sizing: border-box; position: relative; min-height: 88px; padding: 14px 64px 14px 14px; border-radius: 20px; background: #F2F6E1; border: 3px solid #4C5A10; display: flex; align-items: center; gap: 14px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
    <span style="flex: none; width: 56px; height: 56px; border-radius: 50%; overflow: hidden; position: relative"><img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%"></span>
    <span style="font-size: 22px; font-weight: 800; color: #1E2410">Leo</span>
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; top: 50%; right: 18px; margin-top: -16px"><circle cx="12" cy="12" r="11" fill="#4C5A10"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <button type="button" role="radio" aria-checked="false" style="all: unset; box-sizing: border-box; position: relative; min-height: 88px; padding: 14px 64px 14px 14px; border-radius: 20px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); display: flex; align-items: center; gap: 14px; font-family: 'DM Sans', system-ui, sans-serif; cursor: pointer">
    <span style="flex: none; width: 56px; height: 56px; border-radius: 50%; background: #EDF2BE; color: #3C4A0B; display: flex; align-items: center; justify-content: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px">M</span>
    <span style="font-size: 22px; font-weight: 600; color: #2D3222">Maya</span>
    <span aria-hidden="true" style="position: absolute; top: 50%; right: 20px; margin-top: -14px; width: 28px; height: 28px; border-radius: 50%; border: 2px solid #5F6352; box-sizing: border-box"></span>
  </button>
</div>
```

"Everyone" option: same unselected box, avatar = 56px `#F1F2DC` circle with the Family icon in `#1E2410`.

### 7.20 List row (ref 7), kid: photo left, title, accent line, muted line, heart right (saved + unsaved)
```html
<!-- S6 list row kid (ref 7): photo left, heart right with word -->
<div style="display: flex; align-items: center; gap: 14px; padding: 12px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 20px">
  <a href="C5-Kid-Recipe.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">
    <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Pork and chive dumplings" style="flex: none; width: 96px; height: 96px; border-radius: 18px; object-fit: cover; object-position: 50% 45%">
    <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0">
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 22px; line-height: 1.15; color: #1E2410">Pork &amp; Chive Dumplings</span>
      <span style="font-size: 17px; font-weight: 700; line-height: 1.3; color: #4C5A10">Mom · new today</span>
      <span style="font-size: 17px; font-weight: 500; line-height: 1.3; color: #5F6352">1 hr 20 min · makes ~40</span>
    </span>
  </a>
  <button type="button" aria-pressed="true" aria-label="Saved" style="all: unset; flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; font-family: 'DM Sans', system-ui, sans-serif">
    <span style="width: 52px; height: 52px; border-radius: 50%; background: #FAD6CB; color: #9A4F47; display: flex; align-items: center; justify-content: center"><svg width="26" height="26" viewBox="0 0 24 24" fill="#F2A7A0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></span>
    <span style="font-size: 15px; font-weight: 700; color: #9A4F47">Saved</span>
  </button>
</div>
<div style="display: flex; align-items: center; gap: 14px; padding: 12px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 20px">
  <a href="C5-Kid-Recipe.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">
    <img src="/_blob/42c862566a3eb3ea62b4a078619b633e" alt="Dad's Sunday chili" style="flex: none; width: 96px; height: 96px; border-radius: 18px; object-fit: cover">
    <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0">
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 22px; line-height: 1.15; color: #1E2410">Sunday Chili</span>
      <span style="font-size: 17px; font-weight: 700; line-height: 1.3; color: #4C5A10">Dad</span>
      <span style="font-size: 17px; font-weight: 500; line-height: 1.3; color: #5F6352">50 min · makes 6 bowls</span>
    </span>
  </a>
  <button type="button" aria-pressed="false" aria-label="Save" style="all: unset; flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; font-family: 'DM Sans', system-ui, sans-serif">
    <span style="width: 52px; height: 52px; border-radius: 50%; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); box-sizing: border-box; color: #1E2410; display: flex; align-items: center; justify-content: center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></span>
    <span style="font-size: 15px; font-weight: 600; color: #5F6352">Save</span>
  </button>
</div>
```


### 7.21 Bubble panel (ref 8), kid "Hear their voices", rows end in a labelled Play button
```html
<!-- S7 bubble panel (ref 8) kid -->
<section style="background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 24px; padding: 18px 16px 8px">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 28px; line-height: 1.1; color: #1E2410">Hear their voices</h2>
    <a href="C5-Kid-Browse.dc.html" aria-label="See all voices" style="flex: none; width: 48px; height: 48px; border-radius: 50%; background: #F1F2DC; color: #1E2410; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
  <div style="display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1.5px solid rgba(71,67,42,0.14)">
    <span style="flex: none; width: 72px; height: 72px; border-radius: 50%; overflow: hidden; position: relative; background: #F6D5CC"><img src="/_blob/5845b3a84b9a62bd4c8e0da61f982bde" alt="Nai Nai's hands folding a dumpling" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 40%; transform: scale(1.3); transform-origin: 42% 40%"></span>
    <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 19px; font-weight: 700; line-height: 1.25; color: #1E2410">Why Nai Nai never cuts a noodle</span>
      <span style="font-size: 17px; font-weight: 700; line-height: 1.3; color: #4C5A10">Nai Nai · 1:12</span>
      <span style="font-size: 17px; font-weight: 500; line-height: 1.3; color: #5F6352">In Mandarin, English words underneath</span>
    </span>
    <button type="button" aria-label="Play Nai Nai, 1 minute 12" style="all: unset; flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; font-family: 'DM Sans', system-ui, sans-serif">
      <span style="width: 52px; height: 52px; border-radius: 50%; background: #4C5A10; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></span>
      <span style="font-size: 15px; font-weight: 700; color: #4C5A10">Play</span>
    </button>
  </div>
  <div style="display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1.5px solid rgba(71,67,42,0.14)">
    <span style="flex: none; width: 72px; height: 72px; border-radius: 50%; overflow: hidden; position: relative; background: #F9E3CF"><img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="Mom" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%"></span>
    <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 19px; font-weight: 700; line-height: 1.25; color: #1E2410">Mom answered your question</span>
      <span style="font-size: 17px; font-weight: 700; line-height: 1.3; color: #4C5A10">Mom · 0:38</span>
      <span style="font-size: 17px; font-weight: 500; line-height: 1.3; color: #5F6352">Boil them frozen or thawed?</span>
    </span>
    <button type="button" aria-label="Play Mom, 38 seconds" style="all: unset; flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; font-family: 'DM Sans', system-ui, sans-serif">
      <span style="width: 52px; height: 52px; border-radius: 50%; background: #4C5A10; color: #FFFDF7; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></span>
      <span style="font-size: 15px; font-weight: 700; color: #4C5A10">Play</span>
    </button>
  </div>
</section>
```

For a recipe bubble panel ("For midterms week"), put 7.20-style rows inside it without their own border/background
(rows separated by the inner divider), heart buttons on the right. Max 3 rows per panel (parent 2-3, arrow rows).

### 7.22 Parent row (ref 7/8 for Mom): whole row is a link, ends in a 56px round arrow
```html
<!-- S8 parent row with round arrow -->
<a href="C5-Parent-Recipe.dc.html" style="display: flex; align-items: center; gap: 14px; padding: 12px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); border-radius: 20px">
  <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Ramen, Mom's Way" style="flex: none; width: 96px; height: 96px; border-radius: 18px; object-fit: cover; object-position: 50% 60%">
  <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 24px; line-height: 1.12; color: #1E2410">Ramen, Mom's Way</span>
    <span style="font-size: 18px; font-weight: 700; line-height: 1.3; color: #4C5A10">Leo cooked it</span>
    <span style="font-size: 18px; font-weight: 500; line-height: 1.3; color: #5F6352">Thu, Oct 9</span>
  </span>
  <span aria-hidden="true" style="flex: none; width: 56px; height: 56px; border-radius: 50%; background: #F1F2DC; color: #1E2410; display: flex; align-items: center; justify-content: center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
</a>
```


### 7.23 Status pills, date tile (ref 3), Caveat note (kid only, once)
```html
<!-- S9 status pills + date tile + caveat -->
<div style="display: flex; flex-wrap: wrap; gap: 8px">
  <span style="display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 17px; font-weight: 700">New from Mom</span>
  <span style="display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 999px; background: #E6EBCF; color: #4C5A10; font-size: 17px; font-weight: 700"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You cooked it</span>
  <span style="display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 999px; background: #F9E3CF; color: #6E4A33; font-size: 17px; font-weight: 700">Mom answered</span>
  <span style="display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 999px; background: #ECE6F2; color: #3F3558; font-size: 17px; font-weight: 700">A question</span>
</div>
<div style="display: flex; align-items: center; gap: 18px">
  <span style="flex: none; width: 72px; height: 80px; border-radius: 16px; background: #F1F2DC; border: 1.5px solid rgba(71,67,42,0.24); box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center">
    <span style="font-size: 15px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1.1">SUN</span>
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 30px; line-height: 1.05; color: #1E2410">19</span>
    <span style="font-size: 15px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1.1">OCT</span>
  </span>
  <p style="margin: 0; font-family: 'Caveat', cursive; font-weight: 600; font-size: 28px; line-height: 1.1; color: #4C5A10; transform: rotate(-3deg)">you've got this, Leo</p>
</div>
```


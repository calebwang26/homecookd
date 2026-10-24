# C4 RECIPE BOX: the visual system (lead designer's spec)

Reference boards (built and rendered from exactly these snippets, zero render warnings):
`canvas/project/C4-Kid-Home.dc.html` and `canvas/project/C4-Parent-Home.dc.html`
(renders: `renders/C4-Kid-Home.png`, `renders/C4-Parent-Home.png`; component check sheet:
`c4work/C4-Components.dc.html` → `renders/C4-Components.png`).
Open both PNGs before you start. Copy snippets, change only copy/photos/links. BRIEF.md hard rules and
DIRECTION.md (section 0 facts, copy bank, clarity rules) still apply on top of this file.

**Idea.** Letters between home and away, kept in a grandmother's recipe box.
**Lead emotion.** Nostalgia and keepsake: "this is ours, and it's kept."
**Voice.** Letter-like, dated and signed. "Mail from home, Leo." / "Mail from Leo." / "Love, Mom" /
"Letters from home" / "Your recipe cards" / "The family recipe box" / "Mail it home" /
"Who's opening the recipe box?".
**Kid = the mailbox** (envelopes, stamps, postmarks, letters arriving, Mom's handwriting).
**Parent = the box itself** (her cards, stamped by who cooked them; straight, bigger, calmer).

---

## 1. The five signature moves (every C4 screen uses at least two; never more than four)
1. **Kraft** `#E9DCC4` as the "box/envelope" surface: hero envelopes, bubble panels, date tiles,
   unselected index tabs. Never as the page ground.
2. **Paper on kraft**: cream `#FFFDF7` index cards (12 radius, 3px tomato `#E95D3D` top rule) and
   Polaroids (4 radius, 10px frame, 34-40px+ bottom margin) sitting ON kraft or canvas with a soft
   warm shadow. Crisp radii are this concept's fingerprint: cards 12, Polaroids 4, panels 22.
3. **Tomato-deep `#C8462A`** is the ONE action color: primary buttons, active tab, selected outline +
   check, the italic accent word in a headline, accent info lines on cream. Nothing else is red.
4. **Mail marks**: date tile (SUN/12/OCT), postage stamp + postmark (kid hero only), forest
   "COOKED BY LEO" rubber stamp (parent). Stamp text is decorative; the same fact is always in
   readable DM Sans nearby.
5. **Handwriting**: Caveat 600 cocoa `#5A3A22` for Mom's note to Leo and small asides, kid side only
   (parent: never for anything essential; at most one decorative flourish per screen, 28px).

Max 2 tilted items per screen (kid: Polaroid -1.5°, postage stamp +4°; or a row thumbnail -2°).
Parent: tilt photos only, never anything with text; on Parent-Home nothing is tilted except the stamp.

---

## 2. Tokens (every hex used in C4)

| Role | Hex | Notes |
|---|---|---|
| Page ground | `#F7F7F2` | canvas, both versions |
| Paper (cards, Polaroids, tab bar, icon buttons, secondary buttons) | `#FFFDF7` | |
| Kraft (envelope, panels, date tiles, unselected index tabs) | `#E9DCC4` | NEW hex #1. Text on kraft: ink 9.7, `#2D3222`, muted `#5F6352` 4.57, cocoa `#5A3A22` 7.5. **Never tomato text on kraft** (3.55). |
| Index-card ruled lines | `#C9D6E6` | NEW hex #2. 1px, decorative only (row separators on index cards) |
| Index-card top rule | `#E95D3D` | 3px `border-top`, decoration only, never text |
| Primary / selected / active / accent text | `#C8462A` | cream label 4.73. Accent text only on cream/canvas (≥4.5), never on kraft or peach |
| Primary shadow (selected option box) | `rgba(200,70,42,0.14)` | `0 4px 12px` |
| Stamps, "cooked" ticks | `#34430C` forest | "COOKED BY LEO", "Leo cooked it" check line (10.6 on cream) |
| Handwriting, sender meta on kraft | `#5A3A22` cocoa | also secondary-button outline (2px) |
| Headline / titles | `#1E2410` ink | |
| Body | `#2D3222` | |
| Muted (meta) | `#5F6352` | the lightest text allowed; OK on canvas, cream, kraft |
| Hairline | `rgba(71,67,42,0.14)` | tab bar border, sticky bar top edge |
| Unselected outline / quiet round button | `rgba(71,67,42,0.24)` 1.5px | |
| Pill "New from Mom" | `#FEBE29` + `#1E2410` | |
| Pill "You cooked it" | `#E6EBCF` + `#4C5A10` | |
| Pill "Mom answered" | `#F6D5CC` + `#5A3A22` | |
| Pill "Saved" | `#EFEFE6` + `#2D3222` | |
| Heart saved | fill `#F2A7A0`, stroke `#C8462A` | unsaved: stroke `#5A3A22`, no fill |
| Quiet round button fill (heart/arrow inside a cream row) | `#F7F7F2` | |
| Cook tints (avatars/initial tiles only) | Mom `#F9E3CF`, Dad `#E6EBCF`, Nai Nai `#F6D5CC`, Auntie Lin `#FFF1C7`/`#8A3F12`, Leo `#ECE6F2`, Maya `#EDF2BE`/`#3C4A0B` | |

Shadows (warm, never grey-black except on photos):
- Card / row / index card: `0 6px 18px rgba(90,58,34,0.10)`
- Polaroid (big): `0 6px 18px rgba(90,58,34,0.16)`; Polaroid pair on canvas (parent): `0 6px 18px rgba(90,58,34,0.14)`; mini Polaroid thumb: `0 2px 6px rgba(90,58,34,0.22)`
- Floating tab bar: `0 8px 24px rgba(90,58,34,0.16)`
- Round button on kraft: `0 2px 8px rgba(90,58,34,0.12)`; round button on a photo: `0 2px 8px rgba(0,0,0,0.12)`

**No new colors beyond these.** No gradients except a photo scrim
`linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(18,20,16,0.78) 100%)` if you ever put cream text on a
photo (C4 avoids that: text lives on paper, not on photos).

---

## 3. Type (px)

Fonts: display `font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0;`
(ALWAYS both, every Fraunces element); body `'DM Sans', system-ui, sans-serif` (set on the root);
notes `font-family: 'Caveat', cursive; font-weight: 600`.

| Role | Kid | Parent | Spec |
|---|---|---|---|
| Screen headline | 38 | 42 | Fraunces 600, lh 1.08, ls -0.01em (parent one-liner -0.015em + nowrap). One accent word in `<em>` italic `#C8462A` |
| Greeting line above parent headline | n/a | 19 | DM Sans 600 `#5F6352` |
| Context line under kid headline | 17 | 19 | DM Sans 400 `#5F6352`, lh 1.3 |
| Hero title (kid envelope) / recipe title on index card | 28 / 32 | 32 / 36 | Fraunces 600, lh 1.1 |
| Section header | 26 | 30 | Fraunces 600, lh 1.1 (italic allowed for one word) |
| Card / row title | 20 (rows), 22 (cards) | 22 (rows), 24 (cards) | Fraunces 600, lh 1.2 |
| Polaroid caption title (parent) | n/a | 18 | DM Sans 700 ink |
| Quote (the cook's or Leo's own words) | 18-20 | 19-21 | Fraunces italic 400, lh 1.3, `#2D3222`, curly quotes “ ” |
| Body | 17 | 19 | DM Sans 400, lh 1.4 |
| Meta / muted line | 15 | 16 | DM Sans 500 `#5F6352` |
| Accent info line (ref 7) | 15 | 17 | DM Sans 600 `#C8462A` (kid) / 700 `#34430C` for "cooked" facts (parent) |
| Sender line (on kraft) | 17 bold ink + 15 cocoa | 19 bold + 16 cocoa | DM Sans |
| Button label | 18 | 20 | DM Sans 700 |
| Status pill | 15 | 16 | DM Sans 700, height 28-30 (kid) / 32 (parent), padding 0 12px |
| Tab label | 13 (600; active 700) | 14 (600; active 700) | DM Sans |
| Caveat note | 25-28 | 28, decoration only | Caveat 600 cocoa, lh ~1.0 |
| Date tile | 13 / 28 / 13 | same | DM Sans 700 ls 0.08em muted / Fraunces 700 ink / DM Sans 700 |
| Stamp text | 12 | 12 | DM Sans 800 uppercase ls 0.08em (decorative) |

---

## 4. Spacing, radii, layout grid

- **8pt rhythm.** Page gutter 16. Top calm space 56 (no status bar). Page column =
  `display:flex; flex-direction:column; padding:56px 16px 0` with `gap:14px` kid / `16px` parent.
- Inside kraft envelope/panel: padding 16, gap 10-12. Cream index card: padding 14-18 / 16.
  List row: padding 10 (kid) / 12 (parent), gap 10-14.
- **Radii:** index cards & rows 12 · option boxes 12 · Polaroid frame 4 (photo 2) · mini-Polaroid 3 ·
  kraft panels/envelope 22 · date tiles 14 · photos inside rows 6 · index tabs `14px 14px 0 0` ·
  pills, buttons, tab bar 999 · icon buttons 50%.
- **Floating tab bar** (kid): left/right 16, bottom 20, height 64 → its top edge is y=760.
  (parent): left/right 12, bottom 16, height 72 → top edge y=756. Keep ≥16px between the last fully
  visible content and that edge; content that continues underneath must clearly be cut (a peek).
- **Sticky CTA** (detail screens, no tab bar): canvas band with hairline top, kid 104 tall
  (button 60), parent 136 tall (button 68 + one reassurance line).
- Buttons: kid primary 56-60, secondary 56; parent primary 68, secondary 60. Round icon buttons 44
  (kid) / 56 (parent; 48 visual is OK only when the whole row is the link).

---

## 5. Kid vs Parent deltas (explicit)

| | Kid (Leo) | Parent (Mom) |
|---|---|---|
| Metaphor | The mailbox: envelope hero, postage stamp + postmark, Mom's handwriting | The box: Polaroids and recipe cards stamped "COOKED BY LEO", kraft box panels |
| Header | Headline 38 + context line 17 + date tile right | Greeting 19 + headline 42 (one line if possible) + date tile right |
| Type | body 17, meta 15, buttons 18, section 26 | body 19, meta 16, buttons 20, section 30 |
| Buttons | primary 56-60 (may sit side by side with a secondary) | primary 68 full width, secondary 60 full width, helper line under unfamiliar actions |
| Tab bar | 64 tall, icons 24, active pill 52×32, label 13 | 72 tall, icons 28, active pill 60×36, label 14 |
| Back | 44 round cream icon button (`aria-label="Back"`) | 56 pill "Back" with chevron |
| Density | up to 3 sections; kraft panels with 3-4 rows | max 2 sections; panels with 2-3 rows; single column, no horizontal scroll |
| Rows end in | heart (44 round, `#F7F7F2`) | round arrow (48-56) and the whole row is the link |
| Caveat | Mom's note (25-26), one aside ("you've got this, Leo") | never essential; at most one 28px flourish |
| Tilt | ≤2 items (Polaroid -1.5°, stamp +4°, thumbs -2°) | photos only; prefer none |
| Decoration | stamp + postmark OK, one Caveat note | ONE per screen (e.g. the COOKED BY LEO stamp) |
| Info emphasis | time, cost, "makes ~40", "about $2" | who cooked, who watched, who asked |
| Time | Sunday Oct 12, evening | Monday Oct 13, morning |

---

## 6. Screen guidance for the other seven boards
- **C4-Profiles** ("Who's opening the recipe box?"): two groups on kraft panels: "The cooks" (Mom,
  Dad, Nai Nai) and "The ones who miss it" (Leo, Maya, dashed "Add family"). Faces as square
  Polaroid portraits (photo ~96-110, 4 radius frame, alternating -2°/+2° is allowed only here; if you
  tilt, tilt 2 max and keep names straight below the Polaroid in Fraunces 20). Context line 15 under
  each name ("Leo asked you something", "1 new from Mom"). Mom → C4-Parent-Home, Leo → C4-Kid-Home.
  Mascot allowed once (small, beside the headline). "You can switch anytime."
- **C4-Kid-Home-Scrolled**: Home active in the tab bar. "Letters from home" list (letter rows: date
  tile + cream card with status pill, title, reason), then a kraft panel "Picked for you" with
  kid rows + hearts, then a "Nai Nai's voice, kept for always" card (her hands in a Polaroid + a 44
  round tomato play button + "1:12"). Birthday line: "Mom's birthday is in 2 weeks." + "See the recipe".
- **C4-Kid-Recipe**: recipe hero (snippet 7.16) top ~45%, cream index card overlapping by 36px:
  title, by-line, Mom's words (Fraunces italic 20), "Cooking for" option boxes (7.9), a row of two
  secondary (cream, 2px cocoa outline) buttons "Watch Mom · 0:48" + "Hear Mom · 0:24", the ruled
  ingredient card (7.17), sticky tomato "Start cooking" (7.22) as the only filled button.
- **C4-Kid-Browse**: headline "The family recipe box" + meta "9 recipes, 4 cooks"; filter index tabs
  (Everyone selected); kid list rows. Recipes active. End: "Missing a dish? Ask someone to teach you."
- **C4-Parent-Home-Scrolled**: Home active. Kraft box "Your recipe cards" with 3 parent rows
  (accent line in forest when Leo cooked it, cocoa otherwise); request letter with date tile SUN 19 OCT
  "Leo asked for your Sunday Eggs" + quote + primary "Record it Sunday"; legacy line Fraunces italic 22.
- **C4-Parent-Recipe**: hero (ramen) with Back pill; cream index card; "Watch yourself · 12 min"
  pill on the photo or as the first secondary; "Who cooked it" (Leo row with COOKED BY LEO stamp +
  his photo; Maya "Not yet" quiet + text button "Send to Maya"); question letter + primary
  "Answer with your voice" + helper.
- **C4-Parent-Send** ("Mail it home"): Back pill; 3 straight video Polaroids with tomato checks;
  "Who is it for?" parent option boxes (Leo selected); voice note row; sticky "Send to Leo" 68 +
  "You can close the app. We'll let you know." (a small postmark is the screen's one decoration).

Copy picks fixed for C4 (keep consistent): Mom's note = "The kitchen smelled like Sunday. Next time,
you fold with us. Love, Mom". Leo's note = "Not as good as yours. Yet." Kid headline "Mail from home,
Leo."; parent headline "Mail from Leo.". Never write "✓" as a character: use the check SVG.

---

## 7. Copy-paste snippets (exact markup of the final boards)

### 7.1 Page root (whole file skeleton)
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Screen name in a few words</title>
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

  <!-- screen content: page column (flow) + absolute overlays (tab bar / sticky CTA) -->

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

Kid page column:
```html
<div style="display: flex; flex-direction: column; gap: 14px; padding: 56px 16px 0">
  <!-- header, hero, sections... (flow layout, never absolute) -->
</div>
```

Parent page column:
```html
<div style="display: flex; flex-direction: column; gap: 16px; padding: 56px 16px 0">
  <!-- header, block, sections... (flow layout, never absolute) -->
</div>
```


### 7.2 Header (greeting + date tile)
Kid:
```html
<!-- Header: greeting + date tile -->
<header style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
  <div style="display: flex; flex-direction: column; gap: 6px">
    <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 38px; line-height: 1.08; letter-spacing: -0.01em; color: #1E2410">Mail from <em style="font-style: italic; color: #C8462A">home</em>, Leo.</h1>
    <p style="margin: 0; font-size: 17px; line-height: 1.3; color: #5F6352">Sunday at home means dumplings.</p>
  </div>
  <div aria-label="Sunday, October 12" style="flex: none; width: 64px; height: 72px; border-radius: 14px; background: #E9DCC4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px">
    <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1">SUN</span>
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 28px; line-height: 1.1; color: #1E2410">12</span>
    <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1">OCT</span>
  </div>
</header>
```

Parent:
```html
<!-- Header: greeting + headline -->
<header style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
  <div style="display: flex; flex-direction: column; gap: 4px">
    <p style="margin: 0; font-size: 19px; font-weight: 600; line-height: 1.3; color: #5F6352">Good morning, Mom.</p>
    <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 42px; line-height: 1.08; letter-spacing: -0.015em; white-space: nowrap; color: #1E2410">Mail from <em style="font-style: italic; color: #C8462A">Leo</em>.</h1>
  </div>
  <div aria-label="Monday, October 13" style="flex: none; width: 64px; height: 72px; border-radius: 14px; background: #E9DCC4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px">
    <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1">MON</span>
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 28px; line-height: 1.1; color: #1E2410">13</span>
    <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1">OCT</span>
  </div>
</header>
```


### 7.3 KID tab bar (as on C4-Kid-Home, Home active). Paste as the last child of the root.
```html
<!-- Floating tab bar (kid) -->
<nav aria-label="Main" style="position: absolute; left: 16px; right: 16px; bottom: 20px; height: 64px; box-sizing: border-box; padding: 0 6px; background: #FFFDF7; border: 1px solid rgba(71,67,42,0.14); border-radius: 999px; box-shadow: 0 8px 24px rgba(90,58,34,0.16); display: grid; grid-template-columns: repeat(4, 1fr); z-index: 10">
  <a href="C4-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #C8462A">
    <span style="width: 52px; height: 32px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
    </span>
    <span style="font-size: 13px; font-weight: 700; line-height: 1">Home</span>
  </a>
  <a href="C4-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
    <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" /><path d="M12 6v13.5" /></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Recipes</span>
  </a>
  <a href="C4-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
    <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Ask</span>
  </a>
  <a href="C4-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
    <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.4 4.6 4" /></svg>
    </span>
    <span style="font-size: 13px; font-weight: 600; line-height: 1">Family</span>
  </a>
</nav>
```

Active/inactive variant of every kid tab (swap these `<a>` blocks inside the `<nav>`; exactly one
`aria-current="page"`):
**Home: active**
```html
<a href="C4-Kid-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #C8462A">
  <span style="width: 52px; height: 32px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 700; line-height: 1">Home</span>
</a>
```
**Home: inactive**
```html
<a href="C4-Kid-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
  <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 600; line-height: 1">Home</span>
</a>
```
**Recipes: active**
```html
<a href="C4-Kid-Browse.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #C8462A">
  <span style="width: 52px; height: 32px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" /><path d="M12 6v13.5" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 700; line-height: 1">Recipes</span>
</a>
```
**Recipes: inactive**
```html
<a href="C4-Kid-Browse.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
  <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" /><path d="M12 6v13.5" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 600; line-height: 1">Recipes</span>
</a>
```
**Ask: active**
```html
<a href="C4-Kid-Home-Scrolled.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #C8462A">
  <span style="width: 52px; height: 32px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 700; line-height: 1">Ask</span>
</a>
```
**Ask: inactive**
```html
<a href="C4-Kid-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
  <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 600; line-height: 1">Ask</span>
</a>
```
**Family: active**
```html
<a href="C4-Profiles.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #C8462A">
  <span style="width: 52px; height: 32px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.4 4.6 4" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 700; line-height: 1">Family</span>
</a>
```
**Family: inactive**
```html
<a href="C4-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #5F6352">
  <span style="width: 52px; height: 32px; display: flex; align-items: center; justify-content: center">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.4 4.6 4" /></svg>
  </span>
  <span style="font-size: 13px; font-weight: 600; line-height: 1">Family</span>
</a>
```


### 7.4 PARENT tab bar (as on C4-Parent-Home, Home active)
```html
<!-- Floating tab bar (parent) -->
<nav aria-label="Main" style="position: absolute; left: 12px; right: 12px; bottom: 16px; height: 72px; box-sizing: border-box; padding: 0 6px; background: #FFFDF7; border: 1px solid rgba(71,67,42,0.14); border-radius: 999px; box-shadow: 0 8px 24px rgba(90,58,34,0.16); display: grid; grid-template-columns: repeat(4, 1fr); z-index: 10">
  <a href="C4-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #C8462A">
    <span style="width: 60px; height: 36px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
    </span>
    <span style="font-size: 14px; font-weight: 700; line-height: 1">Home</span>
  </a>
  <a href="C4-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
    <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" /><path d="M12 6v13.5" /></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap">My recipes</span>
  </a>
  <a href="C4-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
    <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600; line-height: 1">Record</span>
  </a>
  <a href="C4-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
    <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.4 4.6 4" /></svg>
    </span>
    <span style="font-size: 14px; font-weight: 600; line-height: 1">Family</span>
  </a>
</nav>
```

Active/inactive variant of every parent tab:
**Home: active**
```html
<a href="C4-Parent-Home.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #C8462A">
  <span style="width: 60px; height: 36px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 700; line-height: 1">Home</span>
</a>
```
**Home: inactive**
```html
<a href="C4-Parent-Home.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
  <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 600; line-height: 1">Home</span>
</a>
```
**My recipes: active**
```html
<a href="C4-Parent-Home-Scrolled.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #C8462A">
  <span style="width: 60px; height: 36px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" /><path d="M12 6v13.5" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 700; line-height: 1; white-space: nowrap">My recipes</span>
</a>
```
**My recipes: inactive**
```html
<a href="C4-Parent-Home-Scrolled.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
  <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" /><path d="M12 6v13.5" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap">My recipes</span>
</a>
```
**Record: active**
```html
<a href="C4-Parent-Send.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #C8462A">
  <span style="width: 60px; height: 36px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 700; line-height: 1">Record</span>
</a>
```
**Record: inactive**
```html
<a href="C4-Parent-Send.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
  <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 600; line-height: 1">Record</span>
</a>
```
**Family: active**
```html
<a href="C4-Profiles.dc.html" aria-current="page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #C8462A">
  <span style="width: 60px; height: 36px; border-radius: 999px; background: #C8462A; color: #FFFDF7; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.4 4.6 4" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 700; line-height: 1">Family</span>
</a>
```
**Family: inactive**
```html
<a href="C4-Profiles.dc.html" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #5F6352">
  <span style="width: 60px; height: 36px; display: flex; align-items: center; justify-content: center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.4 4.6 4" /></svg>
  </span>
  <span style="font-size: 14px; font-weight: 600; line-height: 1">Family</span>
</a>
```


### 7.5 Kid hero card: the envelope letter (Kid-Home only; reuse its parts elsewhere)
```html
<!-- Hero: the letter from Mom (kraft envelope) -->
<section aria-label="Just in from Mom" style="position: relative; background: #E9DCC4; border-radius: 22px; padding: 16px; display: flex; flex-direction: column; gap: 10px">

  <!-- Sender row -->
  <div style="display: flex; align-items: center; gap: 12px; padding-right: 84px">
    <div style="flex: none; width: 44px; height: 44px; border-radius: 50%; position: relative; overflow: hidden; box-shadow: 0 0 0 2px #FFFDF7">
      <img src="/_blob/6fd63122b3a283a11efb5fe02c7d93c5" alt="Mom" style="width: 100%; height: 100%; object-fit: cover; object-position: 43% 35%; transform: scale(1.8); transform-origin: 29% 24%; display: block">
    </div>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 17px; font-weight: 700; line-height: 1.2; color: #1E2410">Just in from Mom</span>
      <span style="font-size: 15px; font-weight: 500; line-height: 1.2; color: #5A3A22">Today, 6:15 pm</span>
    </div>
  </div>

  <!-- Postage stamp + postmark (decorative) -->
  <div aria-hidden="true" style="position: absolute; right: 18px; top: 12px; width: 62px; height: 72px; transform: rotate(4deg); z-index: 2">
    <svg width="62" height="72" viewBox="0 0 62 72" style="position: absolute; left: 0; top: 0; filter: drop-shadow(0 2px 3px rgba(90,58,34,0.18))">
      <path d="M4 0h54a4 4 0 0 0 4 4v64a4 4 0 0 0-4 4H4a4 4 0 0 0-4-4V4a4 4 0 0 0 4-4z" fill="#FFFDF7" />
      <g fill="#E9DCC4"><circle cx="12" cy="0" r="2.6" /><circle cx="22" cy="0" r="2.6" /><circle cx="31" cy="0" r="2.6" /><circle cx="40" cy="0" r="2.6" /><circle cx="50" cy="0" r="2.6" /><circle cx="12" cy="72" r="2.6" /><circle cx="22" cy="72" r="2.6" /><circle cx="31" cy="72" r="2.6" /><circle cx="40" cy="72" r="2.6" /><circle cx="50" cy="72" r="2.6" /><circle cx="0" cy="14" r="2.6" /><circle cx="0" cy="25" r="2.6" /><circle cx="0" cy="36" r="2.6" /><circle cx="0" cy="47" r="2.6" /><circle cx="0" cy="58" r="2.6" /><circle cx="62" cy="14" r="2.6" /><circle cx="62" cy="25" r="2.6" /><circle cx="62" cy="36" r="2.6" /><circle cx="62" cy="47" r="2.6" /><circle cx="62" cy="58" r="2.6" /></g>
    </svg>
    <div style="position: absolute; left: 6px; top: 6px; width: 50px; height: 60px; overflow: hidden; border-radius: 1px">
      <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%; transform: scale(2.2); transform-origin: 84% 84%; display: block">
    </div>
    <svg width="84" height="84" viewBox="0 0 100 100" style="position: absolute; left: -62px; top: -4px; color: #C8462A">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3" />
      <circle cx="50" cy="50" r="37" fill="none" stroke="currentColor" stroke-width="1.5" />
      <defs><path id="pmArc" d="M21 50a29 29 0 0 1 58 0" /></defs>
      <text font-family="DM Sans, sans-serif" font-weight="800" font-size="12" letter-spacing="1.6" fill="currentColor"><textPath href="#pmArc" startOffset="50%" text-anchor="middle">FROM HOME</textPath></text>
      <text x="50" y="68" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="700" font-size="16" fill="currentColor">OCT 12</text>
    </svg>
  </div>

  <!-- Polaroid with Mom's handwritten note -->
  <a href="C4-Kid-Recipe.dc.html" aria-label="Open Mom's Sunday Dumplings" style="display: block; background: #FFFDF7; padding: 10px 10px 0; border-radius: 4px; box-shadow: 0 6px 18px rgba(90,58,34,0.16); transform: rotate(-1.5deg)">
    <div style="position: relative; height: 152px; border-radius: 2px; overflow: hidden">
      <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's pork and chive dumplings on a steamer, flour on the table" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 42%; display: block">
    </div>
    <p style="margin: 0; padding: 8px 6px 10px; font-family: 'Caveat', cursive; font-weight: 600; font-size: 25px; line-height: 0.98; color: #5A3A22">The kitchen smelled like Sunday. Next time, you fold with us. <span style="white-space: nowrap">Love, Mom</span></p>
  </a>

  <!-- Title -->
  <a href="C4-Kid-Recipe.dc.html" style="display: flex; flex-direction: column; gap: 2px; padding-top: 2px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 28px; line-height: 1.1; color: #1E2410">Sunday Dumplings</h2>
    <span style="font-size: 15px; font-weight: 500; color: #5F6352">1 hr 20 min · makes ~40 · freezes well</span>
  </a>

  <!-- Actions -->
  <div style="display: flex; gap: 10px">
    <button type="button" style="flex: none; white-space: nowrap; height: 56px; border: none; border-radius: 999px; background: #C8462A; color: #FFFDF7; font-family: inherit; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 18px">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>
      <span>Hear Mom <span style="font-weight: 500">· 0:24</span></span>
    </button>
    <a href="C4-Kid-Recipe.dc.html" style="flex: 1; white-space: nowrap; height: 56px; box-sizing: border-box; border: 2px solid #5A3A22; border-radius: 999px; background: #FFFDF7; color: #1E2410; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px">Recipe <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
  </div>
</section>
```

Its action row on its own (primary + secondary side by side, kid only):
```html
<!-- Actions -->
<div style="display: flex; gap: 10px">
  <button type="button" style="flex: none; white-space: nowrap; height: 56px; border: none; border-radius: 999px; background: #C8462A; color: #FFFDF7; font-family: inherit; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 18px">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>
    <span>Hear Mom <span style="font-weight: 500">· 0:24</span></span>
  </button>
  <a href="C4-Kid-Recipe.dc.html" style="flex: 1; white-space: nowrap; height: 56px; box-sizing: border-box; border: 2px solid #5A3A22; border-radius: 999px; background: #FFFDF7; color: #1E2410; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px">Recipe <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
</div>
```


### 7.6 Parent hero block: two Polaroids (ref 3) then two big buttons
```html
<!-- Two Polaroids (ref 3: two big photos) -->
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px">

  <!-- Polaroid 1: his ramen + his note -->
  <a href="C4-Parent-Recipe.dc.html" style="display: flex; flex-direction: column; background: #FFFDF7; padding: 8px 8px 0; border-radius: 4px; box-shadow: 0 6px 18px rgba(90,58,34,0.14)">
    <div style="position: relative; height: 150px; border-radius: 2px; overflow: hidden">
      <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="The bowl of ramen Leo cooked" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%; display: block">
      <span aria-hidden="true" style="position: absolute; right: 8px; bottom: 10px; transform: rotate(-6deg); padding: 3px; border: 2px solid #34430C; border-radius: 4px; background: #FFFDF7; color: #34430C">
        <span style="display: block; padding: 2px 6px; border: 1px solid #34430C; border-radius: 2px; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; line-height: 1.2">COOKED BY LEO</span>
      </span>
    </div>
    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 10px 4px 14px">
      <span style="font-size: 18px; font-weight: 700; line-height: 1.25; color: #1E2410">Your ramen</span>
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 19px; line-height: 1.3; color: #2D3222">“Not as good as yours. Yet.”</span>
      <span style="margin-top: auto; font-size: 16px; font-weight: 500; line-height: 1.3; color: #5F6352">Thu, Oct 9</span>
    </div>
  </a>

  <!-- Polaroid 2: his face + his question -->
  <a href="C4-Parent-Recipe.dc.html" style="display: flex; flex-direction: column; background: #FFFDF7; padding: 8px 8px 0; border-radius: 4px; box-shadow: 0 6px 18px rgba(90,58,34,0.14)">
    <div style="position: relative; height: 150px; border-radius: 2px; overflow: hidden">
      <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="Leo cooking in his kitchen" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; transform: scale(1.5); transform-origin: 42% 30%; display: block">
    </div>
    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 10px 4px 14px">
      <span style="font-size: 18px; font-weight: 700; line-height: 1.25; color: #1E2410">His question</span>
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 19px; line-height: 1.3; color: #2D3222">“How thin should the wrappers be?”</span>
      <span style="margin-top: auto; font-size: 16px; font-weight: 500; line-height: 1.3; color: #5F6352">Last night</span>
    </div>
  </a>
</div>
```

```html
<!-- Two big buttons (ref 3) -->
<div style="display: flex; flex-direction: column; gap: 12px">
  <div style="display: flex; flex-direction: column; gap: 8px">
    <a href="C4-Parent-Send.dc.html" style="height: 68px; border-radius: 999px; background: #C8462A; color: #FFFDF7; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
      Record a recipe
    </a>
    <p style="margin: 0; text-align: center; font-size: 17px; line-height: 1.35; color: #5F6352">Cook like always. We'll write it down.</p>
  </div>
  <a href="C4-Parent-Recipe.dc.html" style="height: 60px; box-sizing: border-box; border: 2px solid #5A3A22; border-radius: 999px; background: #FFFDF7; color: #1E2410; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></svg>
    Answer Leo
  </a>
</div>
```

Primary (tomato) = the `<a>` 68px; secondary = the outline `<a>` 60px; helper line = the `<p>` 17px.

### 7.7 Section header with round arrow + a peeking row (kid)
```html
<!-- Next section peek: Letters from home -->
<section style="display: flex; flex-direction: column; gap: 10px">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; line-height: 1.1; color: #1E2410">Letters from home</h2>
    <a href="C4-Kid-Home-Scrolled.dc.html" aria-label="See all letters from home" style="flex: none; width: 44px; height: 44px; border-radius: 50%; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); box-sizing: border-box; display: flex; align-items: center; justify-content: center; color: #1E2410">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </a>
  </div>
  <div style="display: flex; align-items: flex-start; gap: 12px; background: #FFFDF7; border-radius: 12px; padding: 12px; box-shadow: 0 6px 18px rgba(90,58,34,0.10); border-top: 3px solid #E95D3D">
    <div style="flex: none; width: 56px; height: 64px; border-radius: 14px; background: #E9DCC4; display: flex; flex-direction: column; align-items: center; justify-content: center">
      <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1">SUN</span>
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 24px; line-height: 1.1; color: #1E2410">12</span>
    </div>
    <div style="flex: 1; display: flex; flex-direction: column; gap: 2px; padding-top: 2px">
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 20px; line-height: 1.2; color: #1E2410">Mom answered you</span>
      <span style="font-size: 15px; font-weight: 600; color: #C8462A">Boil them frozen or thawed?</span>
    </div>
  </div>
</section>
```


### 7.8 Kraft box panel header (parent), as peeking on Parent-Home
```html
<!-- Next section peek: the recipe box (kraft panel) -->
<section style="margin-top: 2px; background: #E9DCC4; border-radius: 22px; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 30px; line-height: 1.1; color: #1E2410">Your recipe cards</h2>
    <a href="C4-Parent-Home-Scrolled.dc.html" aria-label="See your recipe cards" style="flex: none; width: 56px; height: 56px; border-radius: 50%; background: #FFFDF7; box-shadow: 0 2px 8px rgba(90,58,34,0.12); display: flex; align-items: center; justify-content: center; color: #1E2410">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </a>
  </div>
  <div style="height: 96px; background: #FFFDF7; border-radius: 12px; border-top: 3px solid #E95D3D; box-shadow: 0 6px 18px rgba(90,58,34,0.10)"></div>
</section>
```

Replace the empty 96px card with parent rows (7.12) on Parent-Home-Scrolled.

### 7.9 Option boxes (ref 2), KID: selected + unselected
```html
<div role="radiogroup" aria-label="Cooking for" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
  <button type="button" role="radio" aria-checked="true" style="text-align: left; min-height: 84px; box-sizing: border-box; padding: 13px; border-radius: 12px; background: #FFFDF7; border: 2.5px solid #C8462A; box-shadow: 0 4px 12px rgba(200,70,42,0.14); font-family: inherit; display: flex; flex-direction: column; gap: 4px">
    <span style="display: flex; align-items: center; gap: 8px">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#C8462A" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span style="font-size: 18px; font-weight: 700; color: #1E2410">Just me</span>
    </span>
    <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #5F6352">Boil 10, freeze 30</span>
  </button>
  <button type="button" role="radio" aria-checked="false" style="text-align: left; min-height: 84px; box-sizing: border-box; padding: 14px; border-radius: 12px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); font-family: inherit; display: flex; flex-direction: column; gap: 4px">
    <span style="display: flex; align-items: center; gap: 8px">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25" fill="none" stroke="#5F6352" stroke-width="1.5" /></svg>
      <span style="font-size: 18px; font-weight: 600; color: #2D3222">Friends</span>
    </span>
    <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #5F6352">Cook all 40 tonight</span>
  </button>
</div>
```


### 7.10 Option boxes, PARENT (88px, face, check on the right)
```html
<div role="radiogroup" aria-label="Who is it for?" style="display: flex; flex-direction: column; gap: 12px">
  <button type="button" role="radio" aria-checked="true" style="text-align: left; min-height: 88px; box-sizing: border-box; padding: 0 17px 0 15px; border-radius: 12px; background: #FFFDF7; border: 3px solid #C8462A; box-shadow: 0 4px 12px rgba(200,70,42,0.14); font-family: inherit; display: flex; align-items: center; gap: 14px">
    <span style="flex: none; width: 56px; height: 56px; border-radius: 50%; position: relative; overflow: hidden; background: #ECE6F2">
      <img src="/_blob/4417cbdb3744afb9da843b01fddb1979" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 42% 36%; transform: scale(3); transform-origin: 40% 35%; display: block">
    </span>
    <span style="flex: 1; display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 21px; font-weight: 700; color: #1E2410">Leo</span>
      <span style="font-size: 16px; font-weight: 500; color: #5F6352">At college</span>
    </span>
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#C8462A" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  <button type="button" role="radio" aria-checked="false" style="text-align: left; min-height: 88px; box-sizing: border-box; padding: 0 18px 0 16px; border-radius: 12px; background: #FFFDF7; border: 1.5px solid rgba(71,67,42,0.24); font-family: inherit; display: flex; align-items: center; gap: 14px">
    <span style="flex: none; width: 56px; height: 56px; border-radius: 50%; background: #EDF2BE; display: flex; align-items: center; justify-content: center; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; color: #3C4A0B">M</span>
    <span style="flex: 1; display: flex; flex-direction: column; gap: 2px">
      <span style="font-size: 21px; font-weight: 600; color: #2D3222">Maya</span>
      <span style="font-size: 16px; font-weight: 500; color: #5F6352">At home</span>
    </span>
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25" fill="none" stroke="#5F6352" stroke-width="1.5" /></svg>
  </button>
</div>
```


### 7.11 List row, KID (ref 7: mini Polaroid left, heart right, title, accent line, muted line)
Saved heart shown; unsaved heart button below.
```html
<div style="display: flex; align-items: center; gap: 10px; background: #FFFDF7; border-radius: 12px; padding: 10px; box-shadow: 0 6px 18px rgba(90,58,34,0.10)">
  <a href="C4-Kid-Recipe.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">
    <span style="flex: none; width: 80px; box-sizing: border-box; padding: 4px 4px 12px; background: #FFFDF7; border-radius: 3px; box-shadow: 0 2px 6px rgba(90,58,34,0.22); transform: rotate(-2deg)">
      <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Ramen in a floral bowl" style="width: 72px; height: 72px; object-fit: cover; object-position: 50% 60%; border-radius: 2px; display: block">
    </span>
    <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px">
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 20px; line-height: 1.2; color: #1E2410">Ramen, Mom's Way</span>
      <span style="font-size: 15px; font-weight: 600; line-height: 1.3; color: #C8462A">Mom · you cooked it Oct 9</span>
      <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #5F6352">10 min · about $2</span>
    </span>
  </a>
  <button type="button" aria-label="Saved. Ramen, Mom's Way" aria-pressed="true" style="flex: none; width: 44px; height: 44px; border-radius: 50%; border: none; background: #F7F7F2; display: flex; align-items: center; justify-content: center; color: #C8462A">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#F2A7A0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></svg>
  </button>
</div>
```

```html
<button type="button" aria-label="Save Sunday Chili" aria-pressed="false" style="flex: none; width: 44px; height: 44px; border-radius: 50%; border: none; background: #F7F7F2; display: flex; align-items: center; justify-content: center; color: #5A3A22">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></svg>
</button>
```


### 7.12 List row, PARENT (no heart; whole row is the link; round arrow)
```html
<a href="C4-Parent-Recipe.dc.html" style="display: flex; align-items: center; gap: 12px; background: #FFFDF7; border-radius: 12px; padding: 12px; box-shadow: 0 6px 18px rgba(90,58,34,0.10)">
  <span style="flex: none; position: relative; width: 88px; box-sizing: border-box; padding: 5px 5px 14px; background: #FFFDF7; border-radius: 3px; box-shadow: 0 2px 6px rgba(90,58,34,0.22)">
    <img src="/_blob/c75e471923e2f3bfc6e61b1667f145e5" alt="Your ramen" style="width: 78px; height: 78px; object-fit: cover; object-position: 50% 60%; border-radius: 2px; display: block">
  </span>
  <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 22px; line-height: 1.2; color: #1E2410">Ramen, Mom's Way</span>
    <span style="display: flex; align-items: center; gap: 6px; font-size: 17px; font-weight: 700; line-height: 1.3; color: #34430C">Leo cooked it <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
    <span style="font-size: 16px; font-weight: 500; line-height: 1.3; color: #5F6352">Thu, Oct 9 · he sent a photo</span>
  </span>
  <span aria-hidden="true" style="flex: none; width: 48px; height: 48px; border-radius: 50%; background: #F7F7F2; display: flex; align-items: center; justify-content: center; color: #1E2410">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  </span>
</a>
```


### 7.13 Kraft bubble panel (ref 8) with header arrow + rows with hearts (kid)
```html
<section style="background: #E9DCC4; border-radius: 22px; padding: 16px; display: flex; flex-direction: column; gap: 12px">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
    <h2 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 26px; line-height: 1.1; color: #1E2410">Picked for you</h2>
    <a href="C4-Kid-Browse.dc.html" aria-label="See all picked for you" style="flex: none; width: 44px; height: 44px; border-radius: 50%; background: #FFFDF7; box-shadow: 0 2px 8px rgba(90,58,34,0.12); display: flex; align-items: center; justify-content: center; color: #1E2410">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </a>
  </div>
  <div style="display: flex; flex-direction: column; gap: 10px">
    <!-- ROW: paste the kid list row here (2 to 4 rows) -->
    <div style="display: flex; align-items: center; gap: 10px; background: #FFFDF7; border-radius: 12px; padding: 10px; box-shadow: 0 6px 18px rgba(90,58,34,0.10)">
      <a href="C4-Kid-Recipe.dc.html" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px">
        <span style="flex: none; width: 80px; box-sizing: border-box; padding: 4px 4px 12px; background: #FFFDF7; border-radius: 3px; box-shadow: 0 2px 6px rgba(90,58,34,0.22); transform: rotate(-2deg)">
          <img src="/_blob/42c862566a3eb3ea62b4a078619b633e" alt="Bowl of Sunday chili" style="width: 72px; height: 72px; object-fit: cover; object-position: 50% 50%; border-radius: 2px; display: block">
        </span>
        <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px">
          <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 20px; line-height: 1.2; color: #1E2410">Sunday Chili</span>
          <span style="font-size: 15px; font-weight: 600; line-height: 1.3; color: #C8462A">Lunch all week</span>
          <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #5F6352">Dad · 50 min · makes 6 bowls</span>
        </span>
      </a>
      <button type="button" aria-label="Save Sunday Chili" aria-pressed="false" style="flex: none; width: 44px; height: 44px; border-radius: 50%; border: none; background: #F7F7F2; display: flex; align-items: center; justify-content: center; color: #5A3A22">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></svg>
      </button>
    </div>
  </div>
</section>
```


### 7.14 Letter row (Luma rhythm + ref 3 date tile), for "Letters from home"
```html
<a href="C4-Kid-Recipe.dc.html" style="display: flex; align-items: flex-start; gap: 12px">
  <span style="flex: none; width: 56px; height: 64px; border-radius: 14px; background: #E9DCC4; display: flex; flex-direction: column; align-items: center; justify-content: center">
    <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #5F6352; line-height: 1">SUN</span>
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 700; font-size: 24px; line-height: 1.1; color: #1E2410">12</span>
  </span>
  <span style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; background: #FFFDF7; border-radius: 12px; border-top: 3px solid #E95D3D; padding: 12px; box-shadow: 0 6px 18px rgba(90,58,34,0.10)">
    <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's dumplings" style="flex: none; width: 64px; height: 64px; object-fit: cover; object-position: 50% 45%; border-radius: 6px; display: block">
    <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px">
      <span style="height: 28px; padding: 0 10px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center">New from Mom</span>
      <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 20px; line-height: 1.2; color: #1E2410">Sunday Dumplings</span>
      <span style="font-size: 15px; font-weight: 500; line-height: 1.3; color: #5F6352">Today, 6:15 pm</span>
    </span>
  </span>
</a>
```


### 7.15 Status pills (Luma)
```html
<div style="display: flex; flex-wrap: wrap; gap: 8px">
  <span style="height: 30px; padding: 0 12px; border-radius: 999px; background: #FEBE29; color: #1E2410; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center">New from Mom</span>
  <span style="height: 30px; padding: 0 12px; border-radius: 999px; background: #E6EBCF; color: #4C5A10; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center">You cooked it</span>
  <span style="height: 30px; padding: 0 12px; border-radius: 999px; background: #F6D5CC; color: #5A3A22; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center">Mom answered</span>
  <span style="height: 30px; padding: 0 12px; border-radius: 999px; background: #EFEFE6; color: #2D3222; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center">Saved</span>
</div>
```


### 7.16 Recipe hero (ref 1 Subway) + overlapping index card (Kid-Recipe, Parent-Recipe)
Parent version: swap the round back for the "Back" pill (7.21) and use 56px round buttons.
```html
<div style="position: relative; height: 380px; overflow: hidden">
  <img src="/_blob/f94abf705c888d1eedff3bce9dde7040" alt="Mom's pork and chive dumplings on a steamer" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 45%; display: block">
  <div style="position: absolute; left: 16px; right: 16px; top: 54px; display: flex; justify-content: space-between">
    <a href="C4-Kid-Home.dc.html" aria-label="Back" style="width: 44px; height: 44px; border-radius: 50%; background: #FFFDF7; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: flex; align-items: center; justify-content: center; color: #1E2410">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </a>
    <button type="button" aria-label="Save Sunday Dumplings" style="width: 44px; height: 44px; border-radius: 50%; border: none; background: #FFFDF7; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: flex; align-items: center; justify-content: center; color: #1E2410">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></svg>
    </button>
  </div>
</div>
<div style="position: relative; margin: -36px 12px 0; background: #FFFDF7; border-radius: 12px; border-top: 3px solid #E95D3D; box-shadow: 0 6px 18px rgba(90,58,34,0.10); padding: 18px 16px; display: flex; flex-direction: column; gap: 8px">
  <h1 style="margin: 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 32px; line-height: 1.08; color: #1E2410">Pork &amp; Chive Dumplings</h1>
  <p style="margin: 0; font-size: 15px; font-weight: 500; color: #5F6352">by Mom · 1 hr 20 min · makes ~40 · freezes well</p>
  <p style="margin: 4px 0 0; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 20px; line-height: 1.35; color: #2D3222">“Fold them like you're tucking in a baby. Not too tight.”</p>
</div>
```


### 7.17 Ruled index card (ingredients: cook's words big, ~ estimate small)
```html
<div style="background: #FFFDF7; border-radius: 12px; border-top: 3px solid #E95D3D; box-shadow: 0 6px 18px rgba(90,58,34,0.10); padding: 14px 16px 6px">
  <h3 style="margin: 0 0 4px; font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-weight: 600; font-size: 22px; line-height: 1.2; color: #1E2410">Mom's amounts</h3>
  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #C9D6E6">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 18px; line-height: 1.3; color: #1E2410">“a big handful of chives, only the green”</span>
    <span style="flex: none; font-size: 15px; font-weight: 600; color: #5F6352">~1 cup</span>
  </div>
  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #C9D6E6">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 18px; line-height: 1.3; color: #1E2410">“ginger, three coins”</span>
    <span style="flex: none; font-size: 15px; font-weight: 600; color: #5F6352">~3 thin slices</span>
  </div>
  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 10px 0">
    <span style="font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; font-style: italic; font-size: 18px; line-height: 1.3; color: #1E2410">“soy sauce, two spoons”</span>
    <span style="flex: none; font-size: 15px; font-weight: 600; color: #5F6352">~2 tbsp</span>
  </div>
</div>
```


### 7.18 Filter index tabs (Kid-Browse)
```html
<div role="tablist" aria-label="Who made it" style="display: flex; gap: 6px; border-bottom: 2px solid #C8462A">
  <a href="C4-Kid-Browse.dc.html" role="tab" aria-selected="true" style="height: 48px; box-sizing: border-box; padding: 0 14px; border-radius: 14px 14px 0 0; background: #C8462A; color: #FFFDF7; font-size: 17px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    Everyone
  </a>
  <a href="C4-Kid-Browse.dc.html" role="tab" aria-selected="false" style="height: 48px; box-sizing: border-box; padding: 0 14px; border-radius: 14px 14px 0 0; background: #E9DCC4; color: #2D3222; font-size: 17px; font-weight: 600; display: inline-flex; align-items: center">Mom</a>
  <a href="C4-Kid-Browse.dc.html" role="tab" aria-selected="false" style="height: 48px; box-sizing: border-box; padding: 0 14px; border-radius: 14px 14px 0 0; background: #E9DCC4; color: #2D3222; font-size: 17px; font-weight: 600; display: inline-flex; align-items: center">Dad</a>
</div>
```


### 7.19 Marks: COOKED BY stamp (forest), big postmark (tomato-deep), Caveat note
```html
<span aria-hidden="true" style="display: inline-block; align-self: flex-start; transform: rotate(-6deg); padding: 3px; border: 2px solid #34430C; border-radius: 4px; background: #FFFDF7; color: #34430C">
  <span style="display: block; padding: 2px 6px; border: 1px solid #34430C; border-radius: 2px; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; line-height: 1.2">COOKED BY LEO</span>
</span>
```

```html
<svg width="140" height="140" viewBox="0 0 100 100" aria-hidden="true" style="color: #C8462A; transform: rotate(-6deg)">
  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.5" />
  <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="1.2" />
  <text x="50" y="38" text-anchor="middle" font-family="DM Sans, sans-serif" font-weight="800" font-size="10" letter-spacing="1" fill="currentColor">FROM HOME</text>
  <text x="50" y="60" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="700" font-size="20" fill="currentColor">Sun 12</text>
  <text x="50" y="74" text-anchor="middle" font-family="DM Sans, sans-serif" font-weight="800" font-size="9" letter-spacing="0.8" fill="currentColor">OCTOBER</text>
</svg>
```

```html
<p style="margin: 0; font-family: 'Caveat', cursive; font-weight: 600; font-size: 28px; line-height: 1.05; color: #5A3A22; transform: rotate(-2deg)">you've got this, Leo</p>
```


### 7.20 Kid back button and icon button on a photo
```html
<a href="C4-Kid-Home.dc.html" aria-label="Back" style="width: 44px; height: 44px; border-radius: 50%; background: #FFFDF7; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: flex; align-items: center; justify-content: center; color: #1E2410">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
</a>
```

```html
<button type="button" aria-label="Save Sunday Dumplings" style="width: 44px; height: 44px; border-radius: 50%; border: none; background: #FFFDF7; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: flex; align-items: center; justify-content: center; color: #1E2410">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></svg>
</button>
```


### 7.21 Parent back pill
```html
<a href="C4-Parent-Home.dc.html" style="height: 56px; box-sizing: border-box; padding: 0 22px 0 14px; border-radius: 999px; background: #FFFDF7; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: inline-flex; align-self: flex-start; align-items: center; gap: 6px; color: #1E2410; font-size: 19px; font-weight: 700">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
  Back
</a>
```


### 7.22 Sticky CTA (detail screens; paste as the last child of the root)
Kid:
```html
<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 104px; box-sizing: border-box; padding: 12px 16px 32px; background: #F7F7F2; border-top: 1px solid rgba(71,67,42,0.14); z-index: 10">
  <a href="C4-Kid-Recipe.dc.html" style="height: 60px; border-radius: 999px; background: #C8462A; color: #FFFDF7; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px">
    Start cooking
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  </a>
</div>
```

Parent (with reassurance line):
```html
<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 136px; box-sizing: border-box; padding: 12px 16px 26px; background: #F7F7F2; border-top: 1px solid rgba(71,67,42,0.14); display: flex; flex-direction: column; gap: 8px; z-index: 10">
  <a href="C4-Parent-Home.dc.html" style="height: 68px; flex: none; border-radius: 999px; background: #C8462A; color: #FFFDF7; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z" /></svg>
    Send to Leo
  </a>
  <p style="margin: 0; text-align: center; font-size: 17px; line-height: 1.3; color: #5F6352">You can close the app. We'll let you know.</p>
</div>
```


---

## 8. Checklist before you render
- Root exactly 390×844; all styles inline; no classes; `<script src="./support.js"></script>` kept.
- Every Fraunces element carries `font-variation-settings: 'SOFT' 100, 'WONK' 0`.
- Tomato text never on kraft or peach. Muted `#5F6352` is the lightest text.
- One primary (tomato filled) action per screen; everything else outline/cream/text.
- Tab bar on main screens with words; detail screens: back + sticky CTA instead.
- Avatars use DIRECTION's verified crops (Mom, Leo, Dad, Nai Nai hands); Maya/Auntie Lin = initial tiles.
- Render with `kit/render.py`, read the PNG, fix any WARNING, check nothing collides with the bar.

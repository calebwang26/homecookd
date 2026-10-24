# homecookd iOS app: five concepts (BRIEF, the shared facts every agent follows)

Kit folder (everything below lives here): `/private/tmp/claude-501/-Users-calebwang-Documents-GitHub-homecookd/f0fbc04f-9670-4c70-80e4-1ec0f9958829/scratchpad/kit`
Boards folder (where artboards are written): `<kit>/../canvas/project/`
Repo (read-only for you): `/Users/calebwang/Documents/GitHub/homecookd`

We are designing (NOT building) five concepts for the next version of the homecookd iOS app, as static
mockups on a Claude Design canvas. Each concept has two sub-versions: one for the PARENT (the cook)
and one for the KID (the one who misses the cooking). Nothing is coded into the app.

## 1. What homecookd is (one paragraph)
A family cook (usually a parent or grandparent) props up a phone and cooks the way they always do,
talking as they go. They add the videos to homecookd once and can close the app. homecookd turns the videos
into a recipe the family can follow: steps, the cook's "feel" amounts made concrete ("a handful" →
~1 cup), the stories told along the way, and "what made it special", each linked to the exact moment
in the video. On every step the kid can **Watch** (plays just that step's clip) and **Hear** (plays
the cook's voice for that step, with their words as subtitles). Kids can ask the cook follow-up
questions; the cook answers by voice. The cook sees who cooked their recipe. One family = one
account, split into profiles (like Netflix).

## 2. The user's priorities (in his words, condensed; these are the grading rubric)
1. **Emotional intelligence everywhere.** Content is warm and smart; it *knows* the user. The kid is
   missing family connection, so the kid's content targets that. The parent is missing the kid, so the
   parent's content targets that. "Oh, Mom just released this video for you." "Hear your mom's voice."
2. **Intuition and very clear structure.** The worst outcome is a confused user who doesn't know how
   to navigate. Clarity over clutter. Big fonts, big pictures, headers that really stand out and direct
   the user. Very intuitive to navigate.
3. **Two sub-versions per concept** (parent, kid) with slightly different UI.
4. **Who the customers are (his follow-up):** parents who are a little older (50s-60s) and don't know
   tech well, so everything must be obvious; and kids (college-age, first time cooking alone) who are
   missing home. Use language, colors, photos and structure that target the need: **connecting
   families**. Warm, home-based, a little nostalgic; it should trigger those emotions.
5. Take the current app to "the next level", aligned with our existing design choices.

## 3. His notes on each reference (copy the STRUCTURE, not their colors or brands)
Reference images: `<kit>/refs/ref1-…png` to `ref8-…png`. Look at every one.
1. **Subway store page** (`ref1-subway-store.png`): the bottom bar (Home, Pickup, Browse, Me) is very
   clear. The picture is BIG, takes up half the screen at the top, and the text under it is still very
   clear. Loves the roundness of the buttons (round white icon buttons over the photo, pill toggles).
2. **Cold brew detail** (`ref2-coldbrew-detail.png`): tapping in, the image is most of the screen and the
   structure is very clear: the product is segmented into a big white box, which is further segmented
   into Small / Big option boxes; the selected one has a green outline and a green check mark.
   "Prioritize user intuition, everything super, super clear. If you click a button, it lights up."
3. **HelloFresh orders** (`ref3-hellofresh-orders.png`): the bottom bar is segmented off in a different
   color so people always know where to go back; WORDS under every icon. Structured, not too much text:
   two big photos (two dishes) then two big buttons (Change meals / Edit delivery). "Boom, that's
   perfect. It fills the app without looking too cluttered." Also note the date tile (THU / 07 / AUG).
4. **Luma events** (`ref4-luma-events.png`): a catalog on the home page, but with DISHES instead of
   events. Sections like "Your Events", and an emotionally intelligent "Picked for You" section. We
   should have that: "Mom just released this video for you", "Just in from your mom. Hear your mom's
   voice, hear your dad's voice". Emotional intelligence baked into the home page. (Note the small
   status pills on thumbnails: Waitlisted / Going / Invited.)
5. **Netflix profiles** (`ref5-netflix-profiles.png`): one account split into profiles; the FIRST thing
   people see is which profile they are. Families share one account and nudge each other to use it.
   The UI differs if you're a cook vs the one being cooked for. Parent home: "What recipe do you want
   to cook next? Watch your past work." Kid home: "Here are the recipes your parent cooked for you."
   That split is why the profiles page comes first.
6. **Google TV** (`ref6-googletv-hero.png`): the first big recommendation takes about a third of the page
   (photo, big title, one line, one white pill button, page dots); below it "Top picks for you",
   "Popular…" rows. Emotional intelligence in how the page is split into multiple dish rows.
7. **DICE catalog** (`ref7-dice-catalog.png`): opens a catalog list: photo on the LEFT, heart on the
   RIGHT, the title, and info underneath (one accent-colored line, one muted line).
8. **DICE home** (`ref8-dice-home.png`): sections segmented into rounded "bubble" panels ("Popular",
   "Just for Jane") each with a round arrow button in the header, rows inside with photo, title,
   accent line, muted line and a heart in a round button. "Copy this bubble structure with the hearts."

## 4. Our existing design (keep its DNA, take it further)
Look at `<kit>/refs/current-app-*.png` (today's app) and `lander-*.jpg` (the marketing site, which the
team loves). Tokens (from `web/src/styles/tokens.css` and `app/src/theme.ts`):

- Neutrals: canvas `#F7F7F2`, surface/card `#FFFDF7`, sunken `#EFEFE6`, pistachio wash `#F2F6E1`,
  footer `#F1F2DC`, hairline `rgba(71,67,42,0.14)`.
- Text: ink `#1E2410`, text `#2D3222`, muted `#5F6352` (never lighter than this for text on light),
  cream `#FFFDF7`, muted-inverse `#C9D0AE`.
- Greens: forest `#34430C`, green-deep `#4C5A10`, green (primary buttons) `#5B6F00`, leaf `#788C15`,
  lime `#B2C248`, chartreuse `#D1E043`, sage `#E6EBCF`, lime-wash `#EDF2BE`, olive-ink `#3C4A0B`.
- Yellows: sun `#FEBE29`, highlighter `#FFD24D`, lemon `#FFE59A`, butter `#FFF1C7`.
- Warm accents: tomato `#E95D3D`, tomato-deep `#C8462A`, apricot `#FFB677`, apricot-soft `#FFDDBF`,
  apricot-ink `#8A3F12`, peach `#F9E3CF`, peach-ink `#6E4A33`, blush `#FAD6CB`, rose `#F6D5CC`,
  rose-text `#9A4F47`, heart `#F2A7A0`, ube/lavender `#ECE6F2`, ube-ink `#3F3558`, cocoa `#5A3A22`,
  hero-dark `#1E2410`, black `#121410`.
- Type: **Fraunces** (display; the lander uses the SOFT axis at 100 for a chunky, round, soft serif;
  italic for emphasis words), **DM Sans** (body/UI), **Caveat** 600 (small handwritten notes like
  "a taste to start", "you've got this, Leo!"). The app also used Newsreader for the cook's quoted words;
  you may use Fraunces italic for quotes instead.
  Font link (put in `<helmet>`, `&` escaped as `&amp;`):
  `https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,0..100,0..1;1,9..144,300..900,0..100,0..1&amp;family=DM+Sans:ital,opsz,wght@0,9..40,400..800;1,9..40,400..800&amp;family=Caveat:wght@500..700&amp;display=swap`
  Soft Fraunces: `font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0;`
- Shapes: big round corners (cards 22-24, hero media 28, sheets 32-40), pills fully round, round icon
  buttons. Tinted cards (peach, rose, sage, butter, ube). Yellow highlighter mark behind one key word
  in a headline. Steam swirls over hot food. The pot mascot (SVG in `<kit>/pot-mascot.svg.txt`,
  inline it). Scalloped "sticker" badges (lander: "PASS IT DOWN", "TASTE OF HOME"). Swirl patterns.
- Voice: short warm headers (2-5 words), never B2B, never techy. Sell the feeling, not the feature.

## 5. The family (use these people and dishes so all concepts are comparable)
- **Leo** (19): the KID persona. First semester at college, three states away. Cooks alone at night
  in a tiny dorm/apartment kitchen (`photo-young-adult-cooking-night.jpg`), broke, busy, homesick.
- **Maya** (16): Leo's sister, still at home (a second kid profile).
- **Mom**: the PARENT persona. In her late 50s, not techy, warm, misses Leo terribly, worried he
  eats instant noodles. Cooks the family's dumplings every Sunday. (`photo-parent-phone-call.jpg` is
  her lighting up at a photo Leo sent; `photo-cook-recording-phone.jpg` = recording herself cooking.)
- **Dad**: Sunday chili, ginger-scallion fish, mac & cheese.
- **Nai Nai** (grandma, Dad's mom): red-braised pork belly, hand-pulled noodle soup. Speaks Mandarin;
  her recipes show her words with English subtitles (the language barrier is a real pain point).
- **Auntie Lin**: scallion pancakes.
Dishes & photos (asset urls are in `<kit>/assets.json`; use the `url` field VERBATIM, e.g.
`/_blob/f94abf705c888d1eedff3bce9dde7040`):
| dish | cook | photo | facts you may show |
|---|---|---|---|
| Pork & Chive Dumplings | Mom | dish-dumplings.jpg | ~1 hr 20 min · makes ~40 · freezes well · "Sunday dumplings" |
| Ramen, Mom's Way (instant ramen, upgraded) | Mom | dish-ramen.jpg | 10 min · one pot · ~$2 · "for exam week" |
| Banana Bread | Mom | dish-banana-bread.jpg | 1 hr · uses brown bananas |
| Sunday Eggs (shakshuka) | Mom | dish-shakshuka.jpg | 25 min · one pan |
| Sunday Chili | Dad | cover-dad-sunday-chili.jpg | 50 min · one pot · makes 6 bowls |
| Ginger-Scallion Fish | Dad | cover-dad-ginger-scallion-fish.jpg | 20 min |
| Mac & Cheese | Dad | dish-mac-and-cheese.jpg | 35 min |
| Red-Braised Pork Belly | Nai Nai | cover-grandma-red-braised-pork.jpg | 2 hrs · told in Mandarin, English subtitles |
| Hand-Pulled Noodle Soup | Nai Nai | cover-grandma-hand-pulled-noodle-soup.jpg | 3 hrs |
| Scallion Pancakes | Auntie Lin | cover-auntie-lin-scallion-pancakes.jpg | 40 min |
Mood/people photos (use as moments, never claim two different photos are the same person on one
screen): see `assets.json` descriptions (family dinner table, grandma & granddaughter dumplings,
elder hands folding a dumpling, steaming pot, pinch into pot, phone on tripod, etc.).
Realistic product facts you may use: recipes have steps with Watch + Hear; feel amounts ("a handful
of chives" → ~1 cup); stories; "what made it special"; questions the kid asks & voice answers;
"Leo cooked it" with a photo he sent back; a kid can ask a cook to teach a dish (a request).
Never invent stats beyond the small, believable family numbers above (e.g. "Leo watched it 3 times").

## 6. The screens (every concept makes ALL nine, same names, same purpose)
Artboards are 390 × 844 (iPhone). Names: `C{n}-<Screen>.dc.html`, except concept 1's Profiles,
which is the canvas entry and must be named `Main.dc.html`.
| # | file | what it must show |
|---|---|---|
| 1 | `C{n}-Profiles` (C1: `Main`) | Ref 5. First screen of the app. "Who's in the kitchen?"-style chooser; cooks (Mom, Dad, Nai Nai) and the ones who miss it (Leo, Maya), + Add. Make the cook/kid split obvious. Tapping Mom → Parent-Home, Leo → Kid-Home. |
| 2 | `C{n}-Kid-Home` | Leo's first screen (above the fold). Greeting that knows him. A BIG hero (1/3 to 1/2 of the screen) "Just in from Mom" (new dumplings, with Mom's note + Hear Mom). The start of the next section visible. Bottom tab bar with words under icons. |
| 3 | `C{n}-Kid-Home-Scrolled` | The same home scrolled down (same tab bar): "Picked for you" with emotionally intelligent reasons (exam week, cheap, when you miss home, Sunday), a ref-8 bubble panel section with hearts, "Hear their voices" (Nai Nai's voice saved), etc. |
| 4 | `C{n}-Kid-Recipe` | Ref 2. Tapping Mom's dumplings: big photo most of the top; a big segmented white card: title, Mom's own words, a clear selected-state choice (e.g. "Cooking for: Just me ✓ / Friends"), Watch Mom + Hear Mom, a peek of ingredients with feel amounts, and a big "Start cooking" button. |
| 5 | `C{n}-Kid-Browse` | Ref 7. The family recipe catalog: filter pills by cook (one selected), rows with photo LEFT, heart RIGHT, title, accent info line, muted line. |
| 6 | `C{n}-Parent-Home` | Mom's first screen. "What will you teach Leo next?"-style. Big obvious "Record a recipe" action. Something from Leo (he cooked her chili/dumplings and sent a photo + a note; or he asked her a question with a big "Answer with your voice"). Tab bar (parent version). |
| 7 | `C{n}-Parent-Home-Scrolled` | Mom's home scrolled: "Your recipes" (her past work, ref 7/8 style, with who cooked/watched each), "Leo wants to learn…" requests, a legacy line (her recipes kept for the family). |
| 8 | `C{n}-Parent-Recipe` | Mom viewing one of HER recipes: big photo, "Watch yourself", who cooked it (Leo ✓ Oct 9; Maya not yet), a question waiting for her voice answer, "Send again". |
| 9 | `C{n}-Parent-Send` | Ref 2 clarity. Sending a recipe: the videos she picked (✓), "Who is it for?" with Leo SELECTED (outline + check), Maya, Everyone; optional voice note; a huge "Send to Leo" button; reassurance that she can close the app ("We'll tell you when it's ready"). |
Prototype links (plain `<a href="…">` styled as the control; relative to the same folder):
Profiles Mom → `C{n}-Parent-Home.dc.html`, Leo → `C{n}-Kid-Home.dc.html`. Kid tab bar: Home →
Kid-Home, Recipes/Browse → Kid-Browse, profile/family tab → Profiles. Kid hero card → Kid-Recipe.
Parent tab bar: Home → Parent-Home, My recipes → Parent-Recipe (or Parent-Home-Scrolled), Record/Add →
Parent-Send, family/profile → Profiles. A back button → the screen it came from.

## 7. Hard rules for every screen
- **Clarity first.** One job per screen; the most important action is the biggest thing. No more than
  ~3 sections visible at once. Generous spacing. Nothing tiny.
- **Sizes (minimums):** body 17px; meta/caption 15px; tab labels 12px (prefer 13); section headers
  26-30px; screen headlines 34-44px; buttons ≥ 52px tall with ≥ 17px labels; primary CTA 56-64px;
  touch targets ≥ 44px. Parent versions run a notch BIGGER (they're older): body 18-19px, buttons 60px+.
- **Bottom tab bar on every main screen** (Home, Home-Scrolled, Browse, Parent screens): 4 tabs (max 5),
  icon + word under each, active tab unmistakable (filled icon + color + pill/tint), bar visually
  separated (its own color or a clear top edge), ~84px tall including ~26px bottom safe area.
  Detail screens (Recipe, Send) may instead show a back button and a sticky bottom CTA.
- **Selected states light up** (ref 2): outline + check, or filled + check. Unselected stays quiet.
- **No fake iOS status bar**, no notch drawing. Leave ~54px of calm space at the top (or let a hero photo
  run under it). No home indicator drawing either.
- **Icons:** inline stroke SVG (2px, round caps), `aria-hidden="true"` when next to a word; icon-only
  buttons need `aria-label`. Never emoji. No icon fonts.
- **Accessible as drawn:** real `<button>`, `<a href>`; text contrast ≥ 4.5:1 (3:1 at 24px+). White text
  on photos needs a scrim/gradient. Don't put muted grey on tinted cards unless it still passes.
- **Copy:** warm, specific, short. Headers 2-5 words. No lorem, no "[placeholder]" unless a fact is
  truly unknown. No em dash or other rule inside button labels. No exclamation-mark spam (one per
  screen max). No techy words (no "upload", "sync", "AI", "process", "content"); say "send",
  "add your videos", "your recipe will be ready by tonight".
- **No AI tropes:** no gradient washes as decoration, no left-border accent cards, no glassmorphism
  blur, no Inter/Roboto/Arial. Gradients only as photo scrims.

## 8. The .dc.html artboard format (follow EXACTLY; deviations silently break the canvas)
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
  … the screen, ALL STYLES INLINE …
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
Rules:
- Keep `<script src="./support.js"></script>` in `<head>` EXACTLY. Always include the
  `<script type="text/x-dc" data-dc-script …>` block with `class Component extends DCLogic`.
- Root div fixed at exactly `width: 390px; height: 844px; overflow: hidden` (plus position: relative).
- ALL styling inline (`style="…"`) so the canvas properties panel can edit it. `<helmet><style>` holds
  only `body{margin:0}`, the `a` reset, and at most a few `@font-face`/`:root`-free basics. No classes.
- Close every non-void element; quote every attribute; self-close nothing except void tags
  (`<img …>`, `<br>`, `<input …>`; SVG children like `<path … />` are fine inside `<svg>`).
- Copy is literal text in the markup. Do NOT use `{{holes}}`, `<sc-for>`, `<sc-if>`, `<dc-import>` or
  script-built UI. (You may declare ONE optional color tweak in data-props and use `{{accent}}`, but
  only if it truly cuts across the screen; otherwise skip tweaks.) Keep `data-props` with `$preview`.
- Images: `<img src="/_blob/…" alt="…" style="…object-fit: cover…">` with urls from `assets.json`
  VERBATIM. Background images only via `<img>` absolutely positioned (no CSS `url()` inline).
  No `data:` URIs, no other network except the Google Fonts link.
- Inline SVG is fine for icons, the pot mascot, swirls, scalloped stickers. Decorative SVG gets
  `aria-hidden="true"`.
- Use flex/grid with `gap` for layout. Absolute positioning only for overlays (tab bar, sticky CTA,
  stickers, badges on photos).
- Links: `<a href="C3-Kid-Recipe.dc.html" style="…">…</a>` styled as the button/card itself (no
  `<button>` inside an `<a>`).
- `<title>` names the screen in a few words; `lang="en"`.

## 9. Render and look at your work (required)
`python3 <kit>/render.py <file.dc.html> <out.png>` renders the board with headless Chrome (fonts and
local photos included) and prints WARNINGs for format problems. Then Read the PNG and judge it like a
picky senior designer: text clipped or overflowing? anything overlapping the tab bar? sizes big enough?
headline clear? photo cropped well (faces/food centered)? is it obviously warm and obviously usable by
a 60-year-old? Fix and re-render until it's right. Renders go in `<kit>/../renders/`.

# homecookd lander: feature spec

Oct 12, 2026 · @Caleb · Status: draft v4 (app mockups + 6 references, a3 & a5 recordings reviewed). Only the a4 recording is still missing; its effect is described in section 4.

**Workflow:** mockups in Claude Design → iterate → build the winning mockup in Claude Code. Sections 1–12 are the full brief. Section 13 is the prompt to paste into Claude Design.

**Attach with the prompt:** everything in `docs/lander-refs/`:
- `app-mockups.webp`: the five app screens. The lander must look like the same product.
- `a1-graza-hero.webp`, `a2-savor-hero.webp`: hero references.
- `a6-photo-background-section.webp`: a section built on a full-bleed photo.
- `a3-savor-footer-final.jpg` & `a3-savor-footer-fill-frames.jpg`: the footer wordmark & its fill-in animation, frame by frame (video: `a3-savor-footer.mp4`).
- `a5-vero-sections-1.jpg`, `a5-vero-sections-2.jpg` & `a5-vero-letter-reveal.jpg`: Caleb's favorite site, section by section, plus its letter-by-letter headline reveal (video: `a5-vero.mp4`).
- a4 (next section slides over the hero): no file yet; described in section 4.

---

## 1. What we're making

A one-page marketing site for homecookd. It has one job: make a visitor feel what they've lost (or are about to lose), show that homecookd keeps it, & get them to act.

**One-liner:** Mom cooks. homecookd writes the recipe & keeps her voice.

**Brand line:** "Culture we want to preserve, and pass down."

**Brand promise:**
- Helping families connect & spend more time with each other.
- Families send each other recipes.
- Parents & grandparents show their care & love by teaching.
- Kids show their intentionality & respect for the older generation by asking, listening & cooking it back.

**The three problems we solve, & where the page answers each:**

| Problem | What it means | Answered in |
|---|---|---|
| 1. Instructions are vague & slow | Recipes run on "a handful" & "you'll know"; overnight soaks & all-day simmers make them impossible to write down or follow over the phone | 5.2 Never written down, 5.4 Easy as dinner, 5.5 product moment |
| 2. The language barrier | Grandparents & parents cook in Urdu, Spanish, Mandarin…; kids read English. homecookd translates so the generations can talk, & keeps the cook's own words first | 5.3a Her language (new), 5.5 transcript |
| 3. The distance barrier | Food is an essential part of culture. Kids far away feel at home; parents & grandparents strengthen the bond & show their love | 5.3 Two sides of one kitchen, 5.6a Love goes both ways (new), 5.11 final CTA |

**Final copy lives in `docs/lander-copy.md`** (the copy deck); the copy in section 5 is direction only.

**What the visitor should feel, in order:**
1. *That's me.* (recognition: missing home, or a quiet kitchen)
2. *Oh, that's what it does.* (one clear picture of the product)
3. *That's easy enough for my mom / for me.* (no tech anxiety)
4. *I want this before it's too late.* (gentle urgency, never morbid)

**Sell the story, not the tech.** Visitors should leave remembering "I can hear Ammi say 'itna bhuno ke ghee alag ho jaye' on the exact step," not "multimodal video extraction."

---

## 2. Who it's for

Two audiences read the same page. Every section has to work for both, & two sections speak to each one directly.

| | The kid far from home | The parent with a quiet kitchen |
|---|---|---|
| Who | College students & young adults, 18–28, away from family | Parents ~50–60 whose kids have graduated or moved away |
| How they arrive | Instagram / TikTok, a friend's link, on their phone, late at night | A link their kid texted them, on their phone or iPad |
| What they miss | The taste of home; the feeling of being looked after | Being needed; the daily closeness of feeding their kids |
| What they're afraid of | Never being able to make it themselves; it disappearing | Being forgotten; the recipes dying with them; being a burden with "tech stuff" |
| What wins them | "You can actually cook her food in your dorm" | "Cook like you always do, in your own language. Your kids get it forever, in your voice" |
| What loses them | Anything that looks like homework or a meal-kit ad | Small text, jargon, sign-up friction, anything that looks like it'll break |
| Their action | Send it to Ammi / join the waitlist | Say yes to cooking with their kid / join the waitlist |

**Design for the harder reader.** When the two conflict, the 55-year-old on an iPad wins: bigger type, plainer words, fewer moving parts.

### 2.1 The hero family: Sara & Ammi
The app mockups already tell one story from both sides, so the lander uses the same family as its through-line:

- **Sara**, the daughter, far from home. The app greets her ("Salaam, Sara") & cheers her on in cook mode ("you've got this, Sara!").
- **Ammi**, her mom, who cooks in Urdu & English. Her Chicken Biryani is the hero recipe: "Nani taught me this in Lahore. We make it every Eid." It takes 14 hours with an overnight soak, 2 hours hands-on.
- The rest of the family table: Nani (Nihari), Khala (Chicken Karahi), Dad (Doodh Patti Chai), Ammi (Aloo Paratha, Kheer).

Other families appear in supporting roles (a Mexican "Mamá," a Filipino "Lola," a Dad) so nobody feels left out.

---

## 3. Vibe

**Family-centric, intuitive, homey, warm, comfortable, yet clearly a premium service.**

- **Warm, like home.** A kitchen at 6pm, steam on the window, the app's handwritten touches (sticker labels, Caveat notes, the pot mascot).
- **Premium through restraint.** Cinematic video, very large type, consistent photo grading, generous space, few elements per screen, refined motion. Never cheap stock, never busy.
- **Show, don't tell.** Photos & video carry the story; headers are a few words; paragraphs are rare & short.
- **Smooth & dependable.** Motion feels buttery but never fights the user. If an interaction could break or confuse, use a static version.
- **Not B2B SaaS.** No gradient glows, icon feature grids, logo bars, dashboards, or "AI-powered."

---

## 4. References: what we take from each

Take the *qualities* below & combine them into one page. Don't copy any reference's layout, colors, or fonts wholesale. Our colors & look come from the app (section 6).

| # | Reference | File | Take | Leave |
|---|---|---|---|---|
| a1 | Graza homepage hero | `a1-graza-hero.webp` | A full-bleed **video** of real cooking behind the hero; you get the message with the sound off & before reading a word. Warm grade with a dark scrim. A big, wide pill CTA. | The small headline; the mono nav font; product-on-the-counter framing; their chartreuse color |
| a2 | Savor hero | `a2-savor-hero.webp` | A **huge** two-line serif headline in cream over a rich, warm background, filling most of the width. A short subhead set to one side. One clear button. | The abstract texture (we want people); the rectangular button (ours are pills) |
| a3 | Savor footer (savor.it) | `a3-savor-footer-*.jpg`, `a3-savor-footer.mp4` | A **giant wordmark spanning the full footer width**, dark ink on warm beige, very clean. Above it: nav links in two short columns on the left, a newsletter line & one dark button on the right. Below it: one thin row of legal links, email & ©. **The fill-in animation, matched exactly** (section 8): each letter grows outward from its thickest strokes, so thin hairlines & serifs arrive last, with a slight left-to-right sweep. About 1.5 s, played once when the footer comes into view. | Their maroon color (ours is olive or ink) |
| a4 | Section covers hero | none yet (recording not found) | The hero stays pinned while **the next section slides up over it** like a card being laid on top. | — |
| a5 | **VERO** restaurant site, Caleb's favorite (Dribbble shot by Muhammad Shofiuddoula) | `a5-vero-*.jpg`, `a5-vero.mp4` | (1) **Headlines build letter by letter** as they scroll in: each letter starts small, tilted & lower, then settles onto the line in quick succession, so the word seems to unfurl along a small arc. Hero letters grow up from the baseline one by one. Cards & photos ease up after the headline. (2) **A chunky, round, soft serif** (Recoleta-like) in bold, with **bold italic** for warmth ("A good *BUNCH*", "and brighten up your lunch breaks"). (3) **Photo-led**: real people eating & laughing, food photo trios on soft cards, a phone held in a hand, headers of 2–5 words. (4) **Bold color-block sections** (deep green, tomato red, saffron) alternating with cream. (5) **Background designs**: tone-on-tone swirl/topographic patterns on the colored sections, people photos **cut out inside star/burst shapes**, a round scalloped sticker badge ("ORDER NOW"), a small flower icon set inline inside a headline. (6) Spacing that's airy, but every screen has one bold thing: a photo, a color block or a big headline. | Fake reviews with star ratings; its exact red/green/orange (we map to our palette, section 7.1) |
| a6 | Photo-background section (Dribbble, "Caregivez") | `a6-photo-background-section.webp` | A **high-quality, topical photo fills the whole section**: a warm, softly lit person in a real home, subject on one side, shallow depth of field. Text & white rounded cards float on the other side. **On mobile, the photo is blurred wherever text sits on it**, so the words stay easy to read. One italic serif word inside a sans headline for warmth ("we *actually* help"). | Stats row ("$265M+ secured"), star ratings & dollar amounts. We have no real numbers or reviews yet, & invented ones are off the table. |

### 4.1 How they combine, top to bottom
1. **Open (a1 + a2):** full-screen video of Ammi & Sara cooking together, with a giant headline & a giant button over it.
2. **First scroll (a4):** a cream section with rounded top corners slides up over the pinned video.
3. **Middle (a5 + a6 + app):** photo-led storytelling with a rhythm of three section types:
   - canvas sections with chunky round-serif headers, big photos & the app's doodles in the background
   - full-bleed photo sections (a6) where the words float beside a person
   - bold color-block sections (a5) in deep olive or saffron yellow, with swirl patterns, cut-out photos & sticker badges

   Headlines build letter by letter; photos & cards ease up after them.
4. **End (a3 + a5):** a bold color-block call to action, then the cream footer where the giant "homecookd" wordmark grows in.

---

## 5. Page outline & copy direction

**Copy rules (from a5):** headers are 2–6 words; supporting text is 1–2 short sentences; every section has at least one photo, video or app visual; text never covers more than ~40% of a section. Copy below is draft direction; screen names refer to `app-mockups.webp`.

### 5.0 Nav
- Transparent over the hero video with cream text; turns into a canvas-colored bar with ink text once the hero is covered.
- Left: pot mascot + "homecookd" wordmark. Links: How it works · Stories · For parents · Questions. Right: pill "Get early access".
- Mobile: logo + pill only; links in a simple menu.

### 5.1 Hero (a1 + a2)
**Goal:** understand it in 3 seconds without reading.

- **Background video, full-bleed, 100svh:** Ammi & Sara cooking together at home. Sara is back from college; Ammi guides her hand stirring the biryani, they laugh, steam rises, a phone leans on the backsplash recording it. 10–20 s seamless loop, warm golden grade, slow handheld camera. Muted, autoplay, loops, plays inline.
- **Scrim:** a warm dark gradient from the bottom-left (≈ ink at 55% → transparent) so cream text passes AA on every frame.
- **Headline, bottom-left, enormous (a2 scale, a5 font):** "Cook it like / **Ammi** does." in cream Fraunces bold, two lines, filling ~65–75% of the viewport width. "Ammi" is in bold italic on the yellow highlighter (ink text) & slowly rotates: Ammi → Mom → Mamá → Nani → Dad → Lola. Stays on "Ammi" with reduced motion. On load, the letters grow up from the baseline one by one (a5's hero reveal).
- **Subhead, one line, beside or under the headline:** "Her cooking. Her words. Her voice. Kept for your family."
- **Buttons, big:** primary pill 64–72 px tall, ≥ 280 px wide, 20–22 px label: "Get early access". Secondary cream-outline pill: "▶ Hear Ammi" (jumps to 5.5 & plays).
- **Pause control:** small round "Pause video" button in a bottom corner (needed for accessibility).
- Nothing else in the hero: no phone frame, no doodles. The video does the work.

### 5.2 Never written down (slides over the hero, a4)
- Canvas background, 32–40 px rounded top corners, rises over the pinned hero.
- Header: "Never written down."
- Quote wall: big serif quotes scattered like fridge notes, a few on the highlighter, each with a small English translation beneath:
  "Namak andaaze se." *Salt, by feel.* · "Itna bhuno ke ghee alag ho jaye." *Fry until the ghee separates.* · "Un puñito." *A little handful.* · "You'll know."
- Two or three photos tucked between the quotes, slightly rotated with white borders like a fridge collage: a stained handwritten recipe card, hands pinching salt, Nani's steel pot.
- One line: "The best recipes live in her hands."

### 5.3 Two sides of one kitchen (a6)
Two full-bleed photo sections back to back, each ~90–100svh. The photo is the section: the person sits on one side, the words float on the other (mirrored between the two). See 7.6 for the photo-background rules.

- **"Far from home."** (`#for-you`) Photo: Sara in a small dorm kitchen at night, warm lamp light, phone propped on the counter, subject on the left. Right side: header, then "11pm. Craving Ammi's biryani. 'Andaaze se,' she says. Now Sara can watch, hear & follow every step." A small white card floats under it with the cook-mode cheer: pot mascot + "you've got this, Sara!"
- **"A quieter kitchen."** (`#for-parents`) Photo: Ammi at her stove in soft afternoon light, smiling down at a propped phone, subject on the right (like a6's woman). Left side: header, then "Cook it once, your way, in your words. They keep it forever, in your voice." A white card floats under it with one transcript line from the app: "Itna bhuno ke ghee alag ho jaye." / *Fry until the ghee separates.* + a small "Hear Ammi" pill.
- Header style option from a6: a sans header with one italic serif word, e.g. "A *quieter* kitchen." Try it in the mockups against the all-serif header.

### 5.3a Her language, yours too (problem 2, new)
- Canvas section. Left: header, one or two lines ("Ammi cooks in Urdu. Sara reads it in English. Her own words always stay right on top."), & the app's language switch (Urdu · Español · English) with English selected.
- Right: two speech bubbles, like a conversation. A peach bubble from Ammi ("AMMI SAYS · URDU", her line in serif, a small voice waveform & timestamp) & a sage bubble to Sara ("SARA READS · ENGLISH", the translation), joined by a hand-drawn arrow & a Caveat note ("for Sara").
- Below: two small cards with more pairs (Spanish & Urdu), each with the original on top & the translation beneath.

### 5.4 Easy as dinner (how it works)
Three tall cards in the app's tints (peach, sage, butter), each mostly photo or app visual with a 1–3 word title & one line:

1. **"Ask her."** The **Before cooking** speech bubble: "Dish ka naam, aur kis ne sikhaya?" with the highlighted translation. Line: "Simple questions, read aloud in her language."
2. **"She cooks."** Photo of hands at the stove, phone on a stand. Line: "Like always. Talking welcome."
3. **"You keep it."** The **Recipe** screen's ingredient list. Line: "Steps, amounts & her voice, ready to share."

Under the cards, the lavender moon banner from **Cook mode**: "Overnight soak? Just record again in the morning."

### 5.5 Her words. Her hands. Her voice. (the product moment)
The one interactive section. A phone frame plus three short rows; the phone shows the active row (static stack on mobile).

- **Her words.** The **Recipe** ingredient list, built in HTML: "do glass chawal ~2 cups rice", "ek kilo murghi ~1 kg chicken", "teen bari pyaaz ~3 onions", "namak andaaze se salt, to taste". Sage note: "Ammi's words first. ~ amounts are estimated from her video."
- **Her hands.** The **Cook mode** step "Fry the onions", the "0:42 – 1:58" pill, "until the ghee separates" on the highlighter. Line: "Tap Watch. Jump to that exact moment."
- **Her voice.** The **Watch Ammi** transcript, built in HTML: serif Urdu lines with English beneath, the active line on soft butter, the rose "a family story" tag. A real olive-soft **"Hear Ammi"** pill plays a 5–8 s clip & moves the highlight along the transcript. Never autoplays.
- Caveat note with a hand-drawn arrow toward the phone: "her words, not ours".

### 5.6 Statement & moments (a5)
- **Statement band:** a full-width deep-olive (`#4C5A10`) block with a tone-on-tone swirl pattern & one centered statement in cream Fraunces, mixing upright & italic like VERO's "put a smile on your lips 🌼 *and brighten up your lunch breaks*". Ours: "Her voice on every step, [pot mascot icon inline] *and her stories in between.*" The mascot sits inline in the text at cap height, in highlight yellow.
- **Moments band:** directly after, on saffron yellow (`#FEBE29`) with a butter swirl pattern. A full-width row of 6–8 photos, scrolling gently sideways on desktop (pauses on hover) & a 2-column grid on mobile. Real family cooking moments: rolling paratha, chai being poured, an Eid table, a kid tasting from a spoon, Nani's hands, a crowded stovetop. White-bordered, slightly rotated, with short Caveat captions ("Eid, 6am", "first try in the dorm"). One photo is a cut-out of Ammi laughing inside a burst shape, with a round scalloped sticker badge: "Hear Ammi ▶".

### 5.6a Love goes both ways (branding, new)
- Cream section. Header + one sentence: she shows her love by teaching; you show yours by asking, listening & cooking it back.
- Three columns:
  - **Left:** a peach card "For the one who cooks", 3 short lines.
  - **Middle:** a small message thread. Sara sends a photo of her first try; Ammi replies with a warm, slightly funny note in her own words.
  - **Right:** a sage card "For the one who's learning", 3 short lines (ask the questions you never asked, cook it in your own kitchen, send her a photo of your first try).

### 5.7 Everyone's at the table (family table, a6)
- Full-bleed photo background: a warm, softly blurred kitchen or dining table with family around it (a6 treatment).
- Header over the photo: "Everyone's at the table." & the Caveat line "6 recipes, 4 cooks, lots of love".
- A row of white rounded recipe cards floats over the photo & scrolls sideways (a6's card row, with recipes in place of reviews). Each card: round food photo, dish in serif, "by Nani · 8 hrs", a tinted pill with the cook's own words ("namak andaaze se"), heart icon & "Open recipe ↗". Ammi's family first, then three example cards from other families (Mamá's Pozole, Lola's Adobo, Dad's Sunday Chili) labeled as examples.
- Chips above the row: All · Eid · Weeknight · Sweet.

### 5.8 Why we built this
Team photos from `docs/team/`, candid & warm, with 2–3 first-person sentences about our own families' food. Real quotes only; no invented testimonials or star ratings.

### 5.9 A cookbook with her voice in it (coming soon)
A butter-colored (`#FBEFD0`) section: one big photo of a printed family cookbook open on a counter, a QR code on the page that plays the cook's voice. A round scalloped sticker badge (a5's "ORDER NOW" shape) says "Coming soon". Line: "The gift for Eid, Mother's Day, or a wedding."

### 5.10 Questions
Plain accordion with big tap targets:
- **Does Ammi need to download anything?** No. Someone in the family sets it up; she just cooks.
- **Does she have to speak English?** No. Her words show first, with English underneath. (Check against what ships; see open question 1.)
- **Special equipment?** No. Any phone works.
- **What if it takes all day?** Record in pieces. homecookd stitches them together & notes the waits.
- **How does it work?** homecookd watches the video & listens, then writes the steps, amounts & stories, with her words always beside ours. (This is where we say AI does the writing.)
- **Who can see our recipes?** Only your family, unless you share.
- **How much?** Free during early access.

### 5.11 Final call to action (a5)
- A bold color block like VERO's "Hungry? We're Ready.": deep olive (`#4C5A10`), or terracotta if we add it (open question 9), with a swirl pattern.
- Cut-out photos in burst/star shapes on both sides: Ammi laughing on the left, Sara tasting from a spoon on the right.
- Centered, big: "Ask her to cook *with you* this Sunday." in cream Fraunces.
- An email field + a big lime or cream "Get early access" pill, plus a cream-outline pill "Send this to Ammi" (native share on phones). Mascot + Caveat note in yellow: "she'll love being asked."

### 5.12 Footer (a3, matched to savor.it)
- Cream (`#FAF8F3`) background, generous padding, laid out like `a3-savor-footer-final.jpg`:
  - **Top-left:** nav links in two short columns (How it works · Stories · For parents · Questions | Instagram · TikTok · Contact), DM Sans ~18 px.
  - **Top-right:** a two-line prompt in DM Sans ~28–32 px: "Hungry for home? Get early access & be the first to cook with her." Below it, one ink-black button styled like Savor's "Join —— now", with a thin rule between the words: "Get —— early access".
  - **Middle:** the **giant "homecookd" wordmark**, lowercase Fraunces extra-bold, ink (`#0E0F0C`) or deep olive, spanning the full content width edge to edge (~22–25vw), sitting just above the bottom row.
  - **Bottom row**, one thin line: Privacy · Terms · Photo credits on the left, hello@ email in the middle, "© homecookd 2026. Made with love at the venture hackathon." on the right.
- **Wordmark animation (exactly as a3):** when the footer is ~40% in view, the wordmark draws itself in once over ~1.5 s. Each letter starts invisible & **grows outward from its thickest strokes**: thick stems & bowls appear first as thin slivers & swell to full weight, while thin hairlines, joins & serifs arrive last. Letters start with a slight left-to-right stagger (~80–120 ms apart, so "e" leads & the last "e" finishes last), ease-out, so the final swell is slow. See section 8 for how to build it.

---

## 6. App design to carry over

These patterns from `app-mockups.webp` should appear on the lander so site & app feel like one product. Build them as real HTML/CSS where text matters.

| Pattern | In the app | On the lander |
|---|---|---|
| Highlighter word | "Our *family* table"; "until *the ghee separates*" | Hero name; 1–2 key words per section |
| Sticker label | White rotated pill, Caveat in rose: "Ammi's Eid special", "Family favourite" | On story & moment photos |
| Caveat sign-off | "— Ammi, with love"; "6 recipes, 4 cooks, lots of love" | Margin notes & photo captions, max 1–2 per screen |
| Pot mascot | Smiling pot with steam: "you've got this, Sara!", "asking for you, gently" | Logo mark; 2–3 small cameos |
| Steam squiggles & sparkle | Three wavy lines over hot food; yellow & lime sparkle | Over food photos; as large faint background art |
| Her words + translation | Serif line in her language, sans English below | Quote wall (5.2), transcript (5.5) |
| Ingredient row | Her words big serif, "~2 cups rice" small right | Product moment (5.5) |
| Time pill | "▶ 0:42 – 1:58", "Watch Ammi · 52 min" | On video & phone visuals |
| Wait banner | Lavender pill with moon: "After an overnight soak, about 10 hrs" | How it works (5.4) |
| Tinted cards | Rose, peach, sage, lavender, butter | How it works, family table, background shapes |
| Buttons | Olive filled, olive-soft ("Hear Ammi"), ink-black ("Next"), round outlined icon buttons, floating olive "Record a recipe" | Same set, scaled up |

---

## 7. Visual system

### 7.1 Color
Same palette as the app (`app/src/theme.ts`). One accent per section: olive does the work, yellow is only a highlighter, tints are only backgrounds.

| Role | Hex | Use |
|---|---|---|
| Canvas | `#F7F7F2` | Page background |
| Cream | `#FAF8F3` | Alternate sections |
| Card / hero text | `#FFFDF7` | Cards; cream type over video |
| Oat surface | `#F3F0E8` | Chips, inputs, quiet surfaces, footer wordmark "unfilled" state |
| Border | `#E8E3D4` | Dividers, photo borders |
| Primary olive | `#5B6F00` | Primary buttons, play, progress, filled footer wordmark |
| Olive border | `#788C15` | Focus rings, outlined buttons |
| Olive soft | `#E6EBCF` | "Hear Ammi", sage notes |
| Lime | `#B2C248` | Small marks; candidate hero CTA on video (ink text), see 7.7 |
| Highlight | `#FEBE29` | Highlighter behind key words, ink text on top |
| Highlight soft | `#FFF1C7` | Active transcript line |
| Body text | `#292929` | Paragraphs |
| Ink | `#0E0F0C` | Headlines, black buttons, video scrim base |
| Muted | `#6B6B63` | Captions, translations, estimates |
| Peach / rose / butter / sage / lavender | `#F9E3CF` / `#F6D5CC` / `#FBEFD0` / `#E6EBCF` / `#ECE6F2` | Card & shape backgrounds (text: `#6E5A4C` / `#9A4F47` / ink / `#4C5A10` / `#3F3558`) |
| Heart | `#F2A7A0` | Icon only |

**Bold color blocks (a5).** VERO's energy comes from full-width deep green, tomato red & saffron sections. We map them to our palette:

| Block | Background | Text | Pattern | Used in |
|---|---|---|---|---|
| Deep olive (VERO's green) | `#4C5A10` (the app's `accentDeep`) | cream `#FFFDF7`, yellow `#FEBE29` accents | swirl in `#56661A` | 5.6 statement, 5.11 final CTA |
| Saffron yellow (VERO's orange) | `#FEBE29` | ink | swirl in `#FFCB4F` | 5.6 moments band |
| Butter (VERO's pale yellow) | `#FBEFD0` | ink | swirl in `#F6E4B4` | 5.9 keepsake |
| Terracotta (VERO's red), optional | `#C8643B` (homecookd's original accent from `CLAUDE.md`) | cream for headlines ≥ 24 px only; ink for smaller text | swirl in `#D2754E` | 5.11 if chosen (open question 9) |

Use at most one bold block every two or three sections, so the page stays warm & premium rather than loud.

Light mode only.

### 7.2 Type
**Display font: Fraunces** (Google Fonts, variable). a5 uses a chunky, round, soft serif (Recoleta-style), & Fraunces with its softness turned all the way up is the closest free match. It was also the original pick in `CLAUDE.md`. Settings:
- Headlines: weight 650–750, `SOFT` 100, `opsz` auto, tight leading. The cook's words in the same font at weight 400–500.
- Emphasis: **bold italic** (`WONK` 1) for one word or phrase per headline, like VERO's "A good *BUNCH*" ("Ammi" in the hero, "*and her stories in between*").
- Footer wordmark: weight 800–900, `SOFT` 100.
- The app still uses Newsreader. If the lander ships with Fraunces, consider moving the app's titles to it too (open question 3).

Other fonts:
- **DM Sans** for body, buttons, translations, eyebrow labels.
- **Caveat** for sticker labels, captions & 1–2 margin notes per screen.

| Style | Desktop | Mobile |
|---|---|---|
| Hero headline | 140–180 px (≈ 10–12vw), 2 lines | 56–72 px |
| Footer wordmark | ≈ 22–25vw, edge to edge | ≈ 26vw |
| Section header | 64–88 px | 40–48 px |
| Card title | 28–32 px | 24 px |
| Body | 20 px, line-height 1.6 | 18 px |
| Small / caption / eyebrow | ≥ 16 px | ≥ 16 px |

Headlines: tight leading (~0.95–1.0) & slightly negative tracking at large sizes, like a2.

### 7.3 Shape & surface
- Cards 28–32 px radius, photos 24–28 px (or white-bordered "fridge photos" with 4–8 px radius & slight rotation), pills everywhere, round outlined icon buttons.
- Section edges: the section covering the hero has 32–40 px top corners; other section changes are soft color shifts.
- No hard shadows; one soft warm shadow on floating phones & rotated photos at most.
- Soft white phone frames, like the mockups.

### 7.4 Spacing & background designs (a5)
- Airy but never empty: 120–160 px between sections on desktop, 72–96 px on mobile, but every section has a photo, a bold header or background art filling it.
- **Background art:** large faint versions of the app's doodles (steam squiggles, sparkles, hand-drawn pots, spoons, chilies, cardamom pods, a rolling pin) at low contrast (oat on canvas, or 8–12% olive), plus soft tinted blobs (peach, sage, butter) behind photos. It fills space without competing with the content.
- **Swirl patterns (a5):** on bold color blocks only, a tone-on-tone topographic swirl (like VERO's yellow & orange sections), one shade off the background (see 7.1). Large, loose loops, never busy.
- **Cut-out photos (a5):** people cut out from their background & placed inside a burst/star or scalloped shape, overlapping the block's edge. Used 2–3 times on the page (5.6, 5.11).
- **Scalloped sticker badge (a5):** a round badge with a wavy edge, yellow with ink text or cream with olive text, slightly rotated ("Hear Ammi ▶", "Coming soon"). Lives on the corner of a photo, like VERO's "ORDER NOW".
- **Inline icons (a5):** the pot mascot or sparkle set inline inside a statement headline at cap height, in yellow. Once or twice on the page.

### 7.5 Imagery
- **Hero video:** see 5.1. For mockups, use a full-bleed still labeled "video loop". For launch, film our own (preferred) or license stock with a real parent & adult child cooking together.
- **Photo count:** ~15–25 images across the page; at least one per section.
- **Food mid-cooking & the hands making it:** biryani being stirred, onions frying in ghee, paratha rolled, chai poured.
- **Real home kitchens**, warm golden grade, a little film grain, consistent across every image & the video.
- **South Asian family at the center**, other immigrant families in support.
- **Avoid:** glossy overhead food porn, meal-kit flat lays, studio kitchens, stock people laughing at salads.
- Don't feature the "weed" recipes or YouTube-celebrity footage (e.g. the Gordon Ramsay sample).
- Credited Wikimedia/stock stand-ins are fine for mockups (the app mockups do this); real family photos replace them before launch.

### 7.6 Photo-background sections (a6)
Used in 5.3, 5.7 & 5.11. These alternate with plain canvas sections, so the page breathes between photos.

- **The photo:** high resolution, topical (a person from our story in a real home kitchen), shallow depth of field, warm natural light, muted tones. Compose with empty space on one side for the words.
- **Desktop:** the photo stays sharp on the subject's side. The text side gets a gentle warm gradient (ink at ~35–50% → transparent) so cream text passes AA. Cards are white `#FFFDF7`, 24–28 px radius, ink text, no hard shadow.
- **Mobile:** the text stacks over the lower part of the photo, & **the photo is blurred behind the text** (~16–24 px blur, fading in over ~80 px, like a progressive blur) with a warm tint, while the subject's face above stays sharp.
- Text over photos is cream (`#FFFDF7`) on the darkened area, or ink inside white cards; never olive or muted gray directly on a photo.
- Mixed-type header (option to test): DM Sans header with one word in italic display serif, from a6.

### 7.7 Hero CTA color (decide in mockups)
Olive `#5B6F00` disappears on a dark video. Show two variants:
- **A: lime `#B2C248` with ink text.** Pops like a1's button & stays in our palette.
- **B: cream `#FFFDF7` with ink text.** Quieter & more premium.

Below the hero, primary buttons are olive.

---

## 8. Motion (a3, a4, a5)

Smooth, calm & premium. Animate only `transform` & `opacity`; hold 60 fps on a mid-range phone.

- **Headline letter reveal (a5, see `a5-vero-letter-reveal.jpg`):** when a section header is ~20% visible, its letters arrive one after another, ~30–40 ms apart. Each letter starts at ~40% scale, rotated ~20–30° clockwise & dropped ~0.4em, pivoting from its bottom-left corner, then settles onto the baseline over ~550 ms with ease-out & no overshoot. Because later letters start lower & more rotated, the word looks like it unfurls along a small arc. Section headers & statements only, never body text. Whole words stay together when lines wrap.
- **Hero letter reveal (a5):** on page load, the hero headline's letters grow up from the baseline (scale-Y & scale from 0 at the bottom edge), ~40 ms apart, ~600 ms each. The rotating name cross-fades afterwards.
- **Content reveals (a5):** after a header settles, the rest of the section eases in: fade + 24–32 px rise, 600–800 ms, `cubic-bezier(0.22, 1, 0.36, 1)`, once, with groups of cards & photos staggered 60–100 ms. Photos also settle from scale 1.04 to 1.
- **Curtain (a4):** the hero is `position: sticky; top: 0; height: 100svh`. Section 5.2 scrolls up over it with rounded top corners. As it covers, the hero dims (~60%) & scales to ~0.96, linked to scroll. The cover itself is plain CSS sticky; the dim/scale is a progressive enhancement.
- **Footer wordmark (a3, see `a3-savor-footer-fill-frames.jpg`):** grows outward from each letter's thickest strokes, as described in 5.12. **How to build it:** set the wordmark as live text (or SVG text) in solid ink, & give each letter a stroke in the *footer background color* (`-webkit-text-stroke`, or SVG `stroke` painted over the fill). A background-colored stroke straddles the outline, so it eats into the letter from every edge: at ~0.12em width only the thickest parts peek through, & at 0 the full letter shows. Animate each letter's stroke width from ~0.14em to 0 over ~1.2 s, ease-out, with the 80–120 ms left-to-right stagger. It needs a solid footer background (no pattern behind the wordmark). Reduced motion shows the finished wordmark.
- **Small touches:** hero name cross-fade every ~3 s; highlighters draw in left to right once (~400 ms); the transcript highlight glides while "Hear Ammi" plays; steam squiggles drift slowly; the moments band drifts sideways on desktop & pauses on hover.
- **Never:** scroll-jacking or smooth-scroll libraries that change scroll speed, parallax that moves text, cursor effects, bouncy springs, WebGL, autoplaying sound.
- **Reduced motion:** content shows immediately, the poster replaces the video, no rotation, letter reveals or drift. The sticky cover may stay since it's ordinary scrolling.

---

## 9. Voice & words

**Sound like:** a warm older sibling, or the app itself ("asking for you, gently", "you've got this, Sara!"). Specific, sensory, a little funny. Very short.

**Use:** kitchen, Sunday, Eid, taste, handful, call home, her hands, her voice, her words, keep, pass down, family, dinner, by feel.

**Never use:** AI-powered, leverage, seamless, revolutionize, unlock, supercharge, platform, workflow, solution, cutting-edge, next-gen, agentic, multimodal, pipeline, content, users, onboarding.

**Rules:**
- Headers 2–6 words. Supporting text 1–2 short sentences. Let photos tell the rest.
- Her words first: the cook's words in the display serif, in her language (transliterated), with English right beneath. Never only the English.
- Amounts we add always carry "~".
- Urgency stays gentle: "before the recipe is lost," never death or illness.
- Every headline makes sense to a 58-year-old reading it on a phone with no context.

---

## 10. Layout, responsiveness & accessibility

- **Mobile first.** Both audiences mostly arrive on phones. Desktop is a spacious version of mobile.
- Breakpoints ~390 / ~768 / ~1200+; max content width ~1280 px (hero, moments band & footer wordmark go full-bleed).
- Hero on mobile: video fills the screen; headline, subhead & primary button all visible without scrolling.
- Body ≥ 18 px mobile / 20 px desktop; nothing under 16 px; AA contrast everywhere, including text over video.
- Tap targets ≥ 48 px; text labels on buttons; nothing hidden behind hover; full keyboard support with visible olive focus rings.
- Video has a pause control & a poster; `lang` attributes on transliterated lines (`ur-Latn`, `es`); descriptive alt text on every photo.
- One email field for early access; no accounts.

---

## 11. Build notes (Claude Code step, after a mockup is chosen)

- **Stack:** Next.js (App Router) + Tailwind, static export, new `web/` folder, deploy on Vercel. Fonts via `next/font/google`. Images via `next/image` (AVIF/WebP, lazy below the fold).
- **Motion:** IntersectionObserver + CSS transitions for reveals, CSS sticky for the curtain, & CSS scroll-driven animations (with an IntersectionObserver fallback) for the hero dim. Use the Motion library (`motion`) only if a reveal can't be done cleanly otherwise. No smooth-scroll libraries.
- **Letter reveals (a5):** a `SplitHeadline` component wraps each letter in an `aria-hidden` inline-block span (words in a `white-space: nowrap` span so they wrap whole) & puts the full text in the heading's `aria-label`. Per-letter `transform-origin: 0 100%`, staggered with `transition-delay` set from a CSS variable (`--i`).
- **Footer wordmark (a3):** `FooterWordmark` renders one span per letter with `-webkit-text-stroke: var(--w) var(--footer-bg)` & `paint-order: normal`, & animates a registered `@property --w` from 0.14em to 0 (stroke over fill erodes the glyph from its edges). Check Safari & Firefox; if text-stroke misbehaves, swap to an inline SVG `<text>` with `stroke` & `stroke-width` animated the same way.
- **Fonts:** Fraunces variable via `next/font/google` with the `SOFT`, `WONK` & `opsz` axes enabled.
- **Hero video:** H.264 MP4 + WebM, 1080p ≤ 4 MB & 720p ≤ 2 MB for mobile via `<source media>`, AVIF poster preloaded, `muted autoplay loop playsinline preload="metadata"`. Poster only when `prefers-reduced-motion` or `Save-Data`.
- **Tokens** as CSS variables mirroring 7.1, named like the app's theme (`--canvas`, `--ink`, `--accent`, `--highlight`, `--peach`…).
- **Components:** `Nav`, `HeroVideo` (+ `RotatingName`, `PauseButton`), `CurtainSection`, `QuoteWall`, `StoryBlock`, `HowItWorks`, `RecipeShowcase` (+ `IngredientList`, `CookStep`, `Transcript`, `HearTheCookButton`), `MomentsBand`, `FamilyTable`, `TeamStory`, `Keepsake`, `FAQ`, `FinalCTA`, `Footer` (+ `FooterWordmark`), & small parts `Reveal`, `PhoneFrame`, `Highlighter`, `StickerLabel`, `HandNote`, `PotMascot`, `SteamSquiggles`, `TimePill`, `WaitBanner`, `BackgroundArt`.
- **Photo-background blur (a6):** don't use a full-screen `backdrop-filter` while scrolling, because it stutters on mid-range phones. Layer a pre-blurred copy of the same photo (generated at build time, small file) under a `mask-image: linear-gradient(...)`, so the blur fades in behind the text. Use `backdrop-filter: blur()` only on small floating cards, with a solid `#FFFDF7` fallback.
- **Hear Ammi:** plain `<audio>` with a 5–8 s clip & cue times driving the transcript highlight.
- **Early-access form:** TODO destination. Until then, a warm thank-you state that stores nothing.
- **Share:** `navigator.share` with a prefilled message ("Ammi, I want to save your biryani recipe. Will you cook it with me?"), falling back to `sms:` / `mailto:`.
- **Photo credits** from a `credits.ts` list rendered in the footer.
- **Performance:** LCP < 2.5 s on 4G (the poster is the LCP element), CLS ≈ 0, no analytics, chat widgets or third-party embeds in v1.

---

## 12. Done means

- [ ] With the sound off & no reading, a first-time visitor on a phone gets "a family cooking together" from the hero within 3 seconds.
- [ ] The hero headline & button are the biggest things on screen & pass AA on every video frame.
- [ ] Scrolling from the hero, the next section slides up over the pinned video (a4).
- [ ] Section headers build letter by letter along a small arc, then their photos & cards ease in; nothing jumps or shifts layout (a5).
- [ ] Side by side with `a3-savor-footer.mp4`, the footer wordmark grows from its thickest strokes outward with the same timing & left-to-right sweep.
- [ ] Bold color blocks (olive, saffron, butter) appear no more than once every two or three sections.
- [ ] Every section has a photo, video or app visual; no header longer than 6 words.
- [ ] In photo-background sections, text passes AA on desktop & sits on a blurred part of the photo on mobile, while the subject stays sharp.
- [ ] Side by side with `app-mockups.webp`, it looks like the same product.
- [ ] "Hear Ammi" plays a real clip with a moving transcript highlight on iPhone Safari & desktop Chrome, & never autoplays.
- [ ] Every line in the cook's language has English right beneath it.
- [ ] No banned words; no invented testimonials; no weed or celebrity recipes; stand-ins credited.
- [ ] Body ≥ 18 px on mobile, AA contrast, tap targets ≥ 48 px, video pause control present.
- [ ] Reduced-motion users get a calm, static page with the poster image.
- [ ] Lighthouse mobile: Performance ≥ 90, Accessibility ≥ 95.

---

## 13. Paste-ready prompt for Claude Design

Attach every file in `docs/lander-refs/` with this prompt.

```text
Design a one-page marketing site (lander) for homecookd, a consumer app. Mobile (390px) & desktop (1440px), mobile first.

ATTACHED
- app-mockups.webp: the app's five screens. The lander must look like the same product: same colors, sticker labels, pot mascot, highlighter words, tinted cards & pill buttons.
- a1 (Graza) & a2 (Savor): hero references. a6: a section built on a full-bleed photo.
- a3 (Savor footer): the final footer & frames of its wordmark animation.
- a5 (VERO, my favorite): frames of the whole site & of its letter-by-letter headline reveal.
Take the qualities I describe below from each reference & combine them into one cohesive page. Don't copy any reference's layout, colors or fonts.

WHAT IT IS
A family member cooks & talks like always, in their own language, while a phone records. homecookd turns it into a recipe the family can follow: steps, the cook's own words for amounts ("do glass chawal") with an estimate ("~2 cups rice"), the stories told along the way, & a "Hear Ammi" button on every step that plays her real voice with a transcript. "Mom cooks. homecookd writes the recipe & keeps her voice."

WHO IT'S FOR
College students & young adults who miss their family's cooking, & parents ~50–60 whose kids moved away. Family-centric, intuitive, homey, warm & comfortable, yet clearly a premium service. Design for the 58-year-old on an iPad: big type, plain words. Sell the story, not the tech. Not B2B SaaS.

THE FAMILY
Sara (daughter, far from home) & Ammi (her mom, cooks in Urdu & English). Hero recipe: Ammi's Chicken Biryani ("Nani taught me this in Lahore. We make it every Eid."). Family table: Nani's Nihari, Khala's Chicken Karahi, Dad's Doodh Patti Chai, Ammi's Aloo Paratha & Kheer. A few other families as examples (Mamá's Pozole, Lola's Adobo, Dad's Sunday Chili).

WHAT I LOVE IN THE REFERENCES
- a1: the hero background is a video of real cooking, so you get the message before reading a word. Ours: a heartwarming video of Ammi & Sara cooking together. (a1's headline is too small.)
- a2: the hero headline is HUGE & stands out against the background. Make the headline & the button both big.
- a3: a giant wordmark spanning the whole footer, very clean, with nav links & a newsletter line above it & a thin legal row below. It draws in by growing out from each letter's thickest strokes.
- a4 (no file): the hero stays pinned & the next section slides up over it.
- a5: headlines build letter by letter as you scroll, unfurling along a small arc; a chunky, round, soft serif in bold with bold-italic accents; lots of photos of real people & food, with 2–5 word headers; bold full-width color-block sections with tone-on-tone swirl patterns; people cut out inside star/burst shapes; a round scalloped sticker badge; a small icon set inline in a headline. Airy spacing that never feels empty.
- a6: a high-quality, topical photo fills the whole section, with the person on one side & text plus white rounded cards floating on the other. On mobile, the photo is blurred behind the text while the person's face stays sharp. (Leave out its stats row & star ratings; we have no real numbers or reviews.)

PAGE, TOP TO BOTTOM
1. Nav: transparent over the hero with cream text; pot-mascot logo + "homecookd"; links How it works · Stories · For parents · Questions; pill "Get early access".
2. Hero: full-bleed video still (label it "video loop") of Ammi guiding Sara's hand stirring biryani, laughing, steam rising, a phone leaning on the backsplash; warm golden grade; dark warm scrim bottom-left. Enormous cream headline bottom-left in bold Fraunces, 2 lines, ~70% of the width: "Cook it like / Ammi does." with "Ammi" in bold italic on a yellow highlighter (ink text). One-line subhead: "Her cooking. Her words. Her voice. Kept for your family." Big pill button (64–72px tall) "Get early access" + cream-outline "▶ Hear Ammi". Small round pause button. Nothing else.
3. "Never written down." A canvas section with big rounded top corners sliding over the hero. Big serif quotes like fridge notes, each with a small English translation: "Namak andaaze se." (Salt, by feel.) "Itna bhuno ke ghee alag ho jaye." (Fry until the ghee separates.) "Un puñito." (A little handful.) "You'll know." Rotated white-bordered photos between them.
4. Two full-bleed photo sections (a6 style), mirrored: "Far from home." (Sara in a dorm kitchen at 11pm on the left; text & a white card with the mascot + "you've got this, Sara!" on the right) & "A quieter kitchen." (Ammi smiling at a propped phone on the right; text & a white card with one transcript line + a "Hear Ammi" pill on the left). One or two short lines each. Show the mobile version with the photo blurred behind the text. Try one header as DM Sans with an italic serif word: "A *quieter* kitchen."
5. "Easy as dinner." Three tall tinted cards (peach, sage, butter), mostly visual: "Ask her." (the Before cooking speech bubble) · "She cooks." (hands at the stove) · "You keep it." (the ingredient list). Lavender moon banner: "Overnight soak? Just record again in the morning."
6. "Her words. Her hands. Her voice." A phone frame + three rows: ingredient list (her words big serif, "~2 cups rice" small), the Cook mode step with "until the ghee separates" highlighted & a "0:42 – 1:58" pill, & the Watch Ammi transcript (Urdu lines in serif, English beneath, active line soft butter, rose "a family story" tag) with an olive-soft "Hear Ammi" pill. Caveat note: "her words, not ours".
7. Statement & moments (a5): a deep olive #4C5A10 block with a tone-on-tone swirl & one centered cream statement mixing upright & bold italic, with the pot mascot inline in yellow: "Her voice on every step, [mascot] and her stories in between." Then a saffron #FEBE29 band with a butter swirl & 6–8 rotated, white-bordered family cooking photos with short Caveat captions, including one cut-out of Ammi laughing inside a burst shape with a round scalloped sticker "Hear Ammi ▶".
8. "Everyone's at the table." Over a warm, softly blurred photo of a family table (a6 style): Caveat "6 recipes, 4 cooks, lots of love", chips All · Eid · Weeknight · Sweet, & a sideways row of white rounded recipe cards (round food photo, dish in serif, "by Nani · 8 hrs", a tinted pill with the cook's own words, heart). Ammi's family first, then 3 example cards from other families.
9. Why we built this: real team photos & 2–3 first-person sentences. No fake testimonials.
10. "A cookbook with her voice in it." A butter section with one big photo & a round scalloped sticker badge "Coming soon".
11. Questions accordion.
12. Final CTA as a bold deep-olive block with a swirl (like VERO's "Hungry? We're Ready."): cut-out photos in burst shapes on both sides (Ammi laughing, Sara tasting from a spoon), centered cream headline "Ask her to cook with you this Sunday." with "with you" in bold italic, an email field + big lime "Get early access" pill + cream-outline "Send this to Ammi", mascot + yellow Caveat "she'll love being asked."
13. Footer, laid out like the a3 Savor footer: cream background; two short columns of links top-left; top-right a two-line prompt "Hungry for home? Get early access & be the first to cook with her." with an ink button "Get —— early access"; then a giant lowercase "homecookd" wordmark in ink, extra-bold Fraunces, spanning the full width; then one thin legal row. Show a second frame of the wordmark mid-animation: only the thickest strokes of each letter visible as slivers, thin parts missing, further along on the left than the right.

COLOR (light mode; one accent per section)
Canvas #F7F7F2, cream #FAF8F3, card/cream text #FFFDF7, oat #F3F0E8, border #E8E3D4. Olive #5B6F00 (primary buttons), olive border #788C15, olive soft #E6EBCF, lime #B2C248. Highlighter #FEBE29 (ink text on it), soft highlight #FFF1C7. Text #292929, ink #0E0F0C, muted #6B6B63. Tints: peach #F9E3CF, rose #F6D5CC (text #9A4F47), butter #FBEFD0, sage #E6EBCF, lavender #ECE6F2; heart #F2A7A0.
Bold color blocks (a5's green/orange/yellow mapped to ours): deep olive #4C5A10 with cream text & a #56661A swirl; saffron #FEBE29 with ink text & a #FFCB4F swirl; butter #FBEFD0 with a #F6E4B4 swirl. At most one bold block every 2–3 sections.
Hero button on video: show two variants, lime #B2C248 with ink text vs cream #FFFDF7 with ink text.

TYPE
Display: Fraunces, softness all the way up (SOFT 100), weight 650–750 for headlines, bold italic (WONK 1) for one word or phrase per headline, weight 800–900 for the footer wordmark. It should feel chunky, round & energetic like a5's serif. DM Sans for body & buttons; Caveat for stickers, captions & 1–2 notes per screen. Hero headline 140–180px desktop / 56–72px mobile, tight leading. Section headers 64–88px / 40–48px. Body 20px / 18px. Nothing under 16px.

SPACE, SHAPE, BACKGROUND
Generous whitespace, but every section has a photo, a bold header, a color block or background art. Background art: large faint doodles from the app (steam squiggles, sparkles, hand-drawn pots, spoons, chilies, cardamom) & soft tinted blobs behind photos; swirl patterns on color blocks; 2–3 people cut-outs in burst shapes; round scalloped sticker badges. Cards 28–32px radius, pills everywhere, soft white phone frames, no hard shadows. ~15–25 photos total: hands & food mid-cooking in real home kitchens, warm golden grade. No plated food porn, no studio kitchens.

MOTION TO ANNOTATE (static mockups can't move; add small notes)
Hero letters grow up from the baseline on load. Section headers build letter by letter along a small arc, then photos & cards ease up. The section after the hero slides over the pinned video. The footer wordmark grows out from its thickest strokes, sweeping left to right.

WORDS
Headers 2–6 words, 1–2 short sentences max per block. Warm, specific, a little funny. The cook's words come first, with English right beneath. Never: AI-powered, seamless, leverage, unlock, revolutionize, platform, workflow, solution, next-gen, multimodal.

ACCESSIBILITY
Tap targets ≥ 48px; AA contrast everywhere, including text over the video.
```

---

## 14. Open questions

1. **Languages: decided.** Caleb lists the language barrier as one of the three problems homecookd solves, so the lander presents translation as part of the product (section 5.3a). Today's hackathon build is still English-only (`CLAUDE.md`). Before launch, either ship translation or add a small "more languages coming" note.
2. **a4 recording.** Still missing (the 6:13 PM recording wasn't on the Desktop). The effect is clear from the description; send it only if the mockup doesn't match what you meant.
3. **App font.** The lander uses Fraunces (closest to VERO). Should the app's titles move from Newsreader to Fraunces too, so the two match?
4. **Hero video.** Film our own (a parent & adult child from the team cooking together) or license stock for launch?
5. **Hero button on video.** Lime vs cream; decide from the mockups.
6. **Primary CTA.** Waitlist email, a demo link, or both? Where do emails go?
7. **"Hear Ammi" clip.** Whose real recording, with their consent to put it on a public page?
8. **Personalized hero (P1).** Should `?for=ammi` open on the parent's side of the story?
9. **A red-like accent?** VERO's tomato red adds a lot of energy. Our palette has no strong red; terracotta `#C8643B` (homecookd's original accent) could fill that role for the final CTA. Add it, or stay with olive & saffron?

# homecookd lander: copy deck v2

Oct 12, 2026 · written to `docs/lander-build-brief.md` (section ids, character limits and choreography are its contract). This deck replaces `docs/lander-copy.md` (v1). The ★ picks are exported verbatim in `web/src/content/copy.ts`, and the recipe cards live in `web/src/content/recipes.ts`.

## Brand

**Brand line (founder's words, verbatim):** Culture we want to preserve, and pass down.

**One-line pitch:** Set up the camera. Record. Done. homecookd turns a family member's everyday cooking into a recipe the whole family can follow, in their words and their voice.

**The three problems and where the page answers them**

| Problem | What the visitor feels | Answered in |
|---|---|---|
| Family recipes are vague and slow ("a handful", "you'll know", all-day dishes) | "I called home and still couldn't make it." | `the-call`, `how-it-works`, `measures`, FAQ "all day" |
| Language | "Grandpa explains it best in Tagalog, and I read English." | `in-their-words`, FAQ "English" |
| Distance | "I'm four states away. Mom misses cooking for me." | `far-apart`, `early-access` |

**Who we're talking to:** a college student or young adult who misses home, and a parent of about 50 to 60 whose kids moved away. Every line should work for both, read aloud at a kitchen table.

## Voice rules

1. Universal English. Relations rotate (Mom, Dad, Grandma, Grandpa, Auntie, Uncle), genders stay balanced in every row, and families come from many cultures. Other languages show up only as translation examples, always with the English right beneath.
2. Sound like a warm older sibling: specific, sensory, a little funny, short. Headers run 2 to 6 words (the brand line is the one exception). Body copy is 1 or 2 short sentences at a grade 6 to 8 reading level.
3. The cook's own words are always shown. Anything we add carries a "~".
4. "AI" appears once on the page, in the FAQ.
5. No invented stats, reviews, ratings or logos. App clips are real screen recordings of the app with demo recipes; every other family on the page is an illustration, and the footer says so.
6. Never use: AI-powered, seamless, leverage, unlock, revolutionize, supercharge, platform, workflow, solution, cutting-edge, next-gen, agentic, multimodal, pipeline, content, users, onboarding, empower, journey, elevate. Avoid "not X but Y" lines, stacked lists of three and em dashes.

## Notation

- `*word*` is the display italic (Fraunces italic, WONK 1), the heading's one accent.
- `==word==` sits on the yellow highlighter.
- `{R}` is the relation label from the "Cooking with" picker ("Grandma" by default). `{cook}` is a recipe's cook name.
- `(es)`, `(zh-Hans)` and so on mark lines that need a `lang` attribute. Every one of them needs a native-speaker check before launch.
- Character counts in parentheses are measured with "Grandma" filled in.

## What changed from v1

- "Ammi", Urdu and the single family (Sara and Ammi) are gone. The default relation is Grandma, and the hero rotates Grandma, Mom, Dad, Grandpa.
- Cook names on cards are English relations, sometimes with a first name (Grandma Rosa, Grandpa Rey, Auntie Lin, Uncle Minh). Recipe ids stay as the brief wrote them, so the FAN, SHUFFLE, BOX and CLOUD selections still work.
- Three photos didn't match their dish names, so the names follow the photos: Pork Adobo (was chicken), Strawberry Pierogi (was potato), Pho.
- Translation is described honestly: the app works in English today, and translation rolls out during early access.
- The FAQ grew to 8 questions.

---

## nav

- Logo: homecookd
- Links: How it works (`#how-it-works`) · The app (`#see-it-work`) · Languages (`#in-their-words`) · Questions (`#questions`)
- Relation picker, visible label: Cooking with:
- Picker options: Mom · Dad · Grandma · Grandpa · Auntie · Uncle
- Picker, mobile: with {R} ▾ (accessible label: Cooking with)
- Button: Get early access
- Button, mobile: Early access
- Skip link: Skip to how it works

## top (hero)

- H1 options (≤ 30; the relation word sits on the highlighter and rotates Grandma → Mom → Dad → Grandpa once, then stops):
  - ★ A. Cook it like ==*Grandma*== does. (26) The whole promise in five words, and it works for every relation.
  - B. Learn it from ==*Grandma*==. (24) Warmer, but it sounds like a class.
  - C. Keep ==*Grandma*=='s cooking. (25) Clear, but "keep" leans sad for a first line.
- Sub options (≤ 120):
  - ★ A. Prop up a phone while they cook. homecookd turns it into a recipe your family can follow, in their words and their voice. (118)
  - B. Prop up a phone and let them cook like always. homecookd writes the recipe and keeps their voice on every step. (108)
- Beats (three cream-outline pills joined by short rules): Set up the camera · Record · Done
- Primary button: Get early access
- Text link: ▶ See it work
- Pause control: Pause video / Play video
- Video alt text: A grandmother and her granddaughter laughing as they fold dumplings together at home.
- Front recipe card (the hero video lands inside it): Grandma's Sunday Dumplings · by Grandma · ~2 hrs · feel pill "pleat it like a little purse"
- Pills on the card's photo: ● Recording · 0:42 (then crossfades to) ▶ Watch

## pass-down

- H2 options:
  - ★ A. Culture we want to preserve, and *pass down.* The founder's line, word for word. "Preserve" is a kitchen word too.
  - B. The food that raised us, *passed down.*
- Sub (≤ 90): Every family has a dish only one person really knows. Keep it, with them in it. (79)
- Chips over the fan (typing dots for 600ms, then the name; they wobble after): Grandma (forest) · Dad (sun)
- Button: Get early access
- Text link: How it works ↓
- Visually hidden list label: A few family recipes, shown as examples:

## the-call

- Kitchen clock: Sat, 8:15 pm
- L1: You call home: *how much?* [the call card sits in the sentence here]
- L2: "==A handful.==" "You'll know."
- L3: It was never written down. (a hand-drawn strike runs through "never written down.")
- Caveat note above L3: not anymore.
- `aria-label` for the block: You call home: how much? "A handful." "You'll know." It was never written down. Not anymore.
- Call card: {Call} ● 0:42 · Connected. `{Call}` is the picked relation, or "Mom" when nothing is picked.
- Chips while the stack shuffles:
  - Grandpa Rey: "low and slow" (forest, left of line 1)
  - Grandma Rosa: "un puñito" (es) with "a little handful" beneath (sun, right). When the chip flips, the English moves on top and "un puñito" stays small underneath.
- L3 alternatives, if the founder wants the "slow" problem here too:
  - ★ A. It was never written down.
  - B. It takes all day, and it was never written down.

## how-it-works

- Eyebrow: How it works
- Kitchen clock: Sun, 10:00 am
- H2, three lines that fill as each card lands: Set up the camera. / *Record.* / Done.
- Body (≤ 120): They cook and talk like always, and nobody has to measure a thing. homecookd writes the recipe from the videos. (108)
- Pill button: See the real app
- Step card 1 (sage): numeral 1 · H3 "Prop up any phone." · pill "Lean it on the rice jar."
  - Photo alt: A phone on a small tripod on a kitchen counter, ready to record.
- Step card 2 (butter): numeral 2 · H3 "Record them cooking." · rec pill "● REC 0:42" · lavender moon chip "All-day dish? Record in pieces."
  - Photo alt: Hands kneading golden dough on a floured counter.
- Step card 3 (sun): numeral 3 · H3 "Add the videos. Done." · sticker "That's / it."
  - Image alt (real app frame): The Add a recipe screen in homecookd, with Sunday dumplings typed in and Grandma picked as the cook.

## recipe-box

- Eyebrow: Your family table
- Kitchen clock: Sun, 6:30 pm · everyone's home
- H2 options (≤ 32):
  - ★ A. Every recipe, kept *together.* (28) Says "storing" in plain words.
  - B. One family *table.* (17) Echoes the app, but a first-time visitor won't know the app calls it that yet.
  - C. Everyone's at the *table.* (25)
- Body (≤ 100): Sorted by who taught it, so Dad's chili is always one tap from Grandma's noodle soup. (85)
- Caveat note with an arrow to the folder: six recipes, three cooks, so far
- Folder tabs (they mirror the app's chips): Everyone · Auntie Lin · Dad · Grandma · + Add a recipe
- Tab list label (screen readers): Show recipes from

## see-it-work

- Eyebrow: The app
- H2 options (≤ 24):
  - ★ A. Here's the *real* thing. (22) Answers the visitor's question at this point ("is it real?").
  - B. See it in their *hands.* (22)
  - C. Take a look *inside.* (19)
- Caveat note, arrow toward the phone: screen recordings, straight from the app
- Rows (H3 ≤ 28, body ≤ 90):

| # | Clip | H3 | Body | Chip | Mobile tab |
|---|---|---|---|---|---|
| 01 | app-record | Add the videos. | Five gentle prompts get them talking. Then pick the videos from your camera roll. (81) | Sunday dumplings · Grandma | Add videos |
| 02 | app-recipe | Their words, made clear. | "Two heaping rice bowls, maybe a little more" stays hers. ~3 cups sits beside it. (82) | warm like a baby's bath · ~1 cup | Their words |
| 03 | app-cook | Hear them say it. | Each step shows what to look for and the story behind it. Tap Hear Dad for his own voice. (89) | 🔊 Hear Dad | Hear them |
| 04 | app-share | Keep it. Send it home. | Every recipe lives at one family table. Sending one takes a single tap. (71) | Our family table | Keep and share |

- Row 04 fallback, if `app-share` isn't re-recorded with the share sheet: clip app-library · H3 "Kept at the family table." · body "Every recipe, sorted by who taught it, one tap from anyone in the family."
- Optional message bubble beside row 04, quoting what the app really sends: Grandma's Red-Braised Pork Belly by Grandma — from our family table. (This is the app's own text, dash included.)
- Mobile tab list label: What the app does
- Pause control: Pause the app tour / Play the app tour
- Static poster button: Play recording

## every-family

- H2 options (≤ 40):
  - ★ A. Every family calls them *something.* (34) The italic word cycles once: something → Nana → Pop → Grams → Papa → something. `aria-label` stays "Every family calls them something."
  - B. Every family has *that dish.* (28) Use if the cycle gets cut.
  - C. Every kitchen has a *teacher.* (29)
- Body (≤ 95): Whatever you call them, every kitchen has someone worth learning from. (70)
- Hover or tap on a tile: a cream chip with the cook's words and the ~estimate beneath (from `recipes.ts`).
- Visually hidden list label: Family recipes in this section, shown as examples:
- Pause control: Pause moving recipes / Play moving recipes

## in-their-words

- Eyebrow: Languages
- H2 options (≤ 28):
  - ★ A. In their words. *In yours.* (25)
  - B. Their language, *then yours.* (26)
  - C. Said their way. *Read yours.* (25)
- Body (≤ 110): Grandpa explains it best in Tagalog. You follow along in English, with his own words kept right on top. (103)
- Star photo alt: A grandmother fans a wood fire through a bamboo tube while her granddaughter watches from a stool.
- Sticker on the card: Coming to / the app
- Translator card:
  - Radio group label: Pick a language
  - Meta row: {cook} said · {dish}
  - Label above the English: You read
  - Footer rule: Their words always stay on top.
  - Pause control: Pause languages / Play languages
- Note under the card (≤ 80): Today the app is English only. Translation rolls out during early access. (73)

| Chip | Cook | Dish | Original (lang) | You read |
|---|---|---|---|---|
| 中文 Chinese | Grandma | Red-Braised Pork Belly | 糖炒到像茶或蜂蜜的颜色，不要太深。 (zh-Hans) | Cook the sugar to the color of tea or honey, never dark. |
| Español Spanish | Grandpa Luis | Empanadas | Doce pellizquitos alrededor del borde. (es) | Twelve little pinches around the edge. |
| Tagalog | Grandpa Rey | Pork Adobo | Hanggang lumambot, mga isang oras. (tl) | Until it's tender, about an hour. |
| हिन्दी Hindi | Grandma Asha | Chicken Biryani | इतना भूनो कि घी अलग हो जाए। (hi) | Fry it until the ghee separates. |
| 한국어 Korean | Dad | Kimchi Jjigae | 손맛이야. (ko) | It's all in the hands. |
| Italiano Italian | Grandma Lucia | Lasagna | Il ragù non ha fretta. (it) | Ragù is never in a hurry. |

Three grandmas and three grandfathers or dads. Starting language: the visitor's browser language if it's one of these, otherwise 中文.

## far-apart

- H2 options (≤ 32):
  - ★ A. Send it home. *Get one back.* (27) Sharing shown as love both ways.
  - B. Far apart, *same recipe.* (24)
  - C. Love goes *both ways.* (21)
- Body (≤ 110): One tap sends the recipe to whoever misses it most. Then a first-try photo comes back the other way. (100)
- Left card: H3 "Far from home." · kitchen clock "Tue, 11:04 pm" · pill "For the one who's learning"
  - Photo alt: A young man cooking alone at night in a small apartment kitchen.
- Right card: H3 "A quieter kitchen." · pill "For the one who cooks"
  - Photo alt: A woman in her sixties covers her mouth in delight as she looks at her phone in the kitchen.
- Arc card (the recipe that travels): Grandma's Red-Braised Pork Belly, caption pill "from Grandma"
- Chip on the left card when it lands: Delivered ✓
- Reply bubble, with a photo of the dish: First try!! The whole hallway came by. · 11:52 pm
- The cook's answer on the right card (pick the line that matches the arc card):
  - Pork belly: Next time, ten more minutes ♥
  - Chili: Next time, one more shake ♥
  - Noodle soup: Next time, pull them thinner ♥
- Chip after the answer: Delivered · {R} ♥
- Share dock, visually hidden text: Share a recipe by message, email, link, QR code or the family group.
- Footnote under the dock: Illustration. Sharing in the app uses your phone's share sheet.

## measures

- Marquee (Fraunces, ink on chartreuse; captions in small DM Sans beneath):

| Phrase | Caption |
|---|---|
| a handful, only the green part | ~3 scallions |
| warm like a baby's bath | ~1 cup water |
| three coins, this thick | ~3 thin slices ginger |
| un puñito (es) | a little handful |
| the color of tea or honey | the sugar's ready |
| you'll know | we'll ask for you |
| 适量 (zh-Hans) | as much as feels right |
| quanto basta (it) | as much as it needs |

- Marquee label (visually hidden): Things families say instead of measurements
- H2 options (≤ 28):
  - ★ A. Their handful. Your *~½ cup.* (27)
  - B. Their pinch, *your teaspoon.* (27)
- Body (≤ 60): We never replace their words. We just add the ~. (48)
- Chip from the pot mascot after the ingredient drop: you've got this!
- Pause control: Pause moving words / Play moving words

## questions

- H2 options:
  - ★ A. Good *questions.*
  - B. Ask us *anything.*
- Caveat note: better answers than "you'll know," promise
- Phone caption (app-questions clip): homecookd asks a few too.

| Q (≤ 50) | A (≤ 200) |
|---|---|
| Does {R} need to download anything? | No. Someone in the family props up a phone and hits record. {R} just cooks and talks like always, and you add the videos to homecookd afterward. |
| Do we need any special gear? | Just a phone with a camera. Lean it anywhere it can see the stove and their hands. |
| Do they have to speak English? | For now, homecookd works in English. Translation rolls out during early access, with more languages over time, and their own words will always stay on top. |
| What if the dish takes all day? | Record in pieces. Stop for the overnight soak, record again in the morning, and add every video to the same recipe. |
| How does homecookd write the recipe? | It uses AI to watch and listen to the videos, then writes the steps. Amounts stay in the cook's own words with a ~ estimate beside them, and their stories come along too. |
| Can we send recipes to the rest of the family? | Yes. Send any recipe to a brother, a cousin or the family group chat, right from the recipe. |
| Who can see our recipes? | Your family. You choose who you send each recipe to. |
| How much does it cost? | It's free during early access. |

## early-access (final CTA)

- Kitchen clock: This Sunday, 10:00 am?
- H2 options (≤ 32; uses the picked relation when there is one, otherwise "them"):
  - ★ A. Ask {them|R} to *teach you.* (22 / 25)
  - B. Cook *with {them|R}* this Sunday. (29 / 32)
- Body (≤ 75): Teaching is how they say I love you. Asking is how you say it back. (67)
- Email label: Your email
- Placeholder: you@example.com
- Submit button: Get early access
- While sending: Saving your spot…
- Error: That email looks a little off. Mind checking it?
- Thank-you state: You're on the list. Now go call {R}.
- Share button: Send this to {R}
- Share message: {R}, will you teach me your best dish this Sunday? You just cook and talk like always. I'll keep the recipe in your voice. [link]
- Share fallback: Copied. Paste it to {R}. · links "Text it" and "Email it" · email subject "Will you teach me?"
- Reassurance pills: Any phone · No typing for the cook · Free in early access
- Sticker: Free / Early access
- Caveat note, arrow toward the share button: they'll love being asked.
- Star photo alt, left: A grandpa and his teenage grandson talking over a pancake breakfast.
- Star photo alt, right: A grandmother in a green dress pressing tortillas by hand.

## footer

- Prompt (≤ 70): Hungry for home? Get early access and start with one dish. (58)
- Button: Get [rule] early access (accessible name: Get early access)
- Links: How it works · The app · Languages · Questions
- Links: Back to top · Contact
- Wordmark: homecookd
- Legal row:
  - Photo credits (disclosure). Intro line: Photos and video from Pexels.
  - App clips are real screen recordings of homecookd, shown with demo recipes. Other families on this page are illustrations.
  - © 2026 homecookd

## SEO and sharing

- Title (≤ 60): homecookd: cook it like Grandma does (33)
- Description (≤ 160): Prop up a phone while they cook. homecookd turns it into a recipe your family can follow, in their words and their voice. Free in early access. (140)
- OG image alt: Cook it like Grandma does. homecookd.
- Site name: homecookd

## App clip labels (aria-label on each real recording)

| Clip | Label |
|---|---|
| app-record | Screen recording of homecookd: five prompts to read before cooking, then a new recipe called Sunday dumplings with Grandma as the cook. |
| app-recipe | Screen recording of homecookd: Grandma's Hand-Pulled Noodle Soup, with ingredients in her words and estimates beside them. |
| app-cook | Screen recording of homecookd: cook mode for Dad's Sunday Chili, with a highlighted cue, his story and the Hear Dad button. |
| app-share | Screen recording of homecookd: Grandma's Red-Braised Pork Belly, then a tap on Share. |
| app-library | Screen recording of homecookd: the family table, filtered to Dad, then Grandma, then everyone. |
| app-questions | Screen recording of homecookd: three follow-up questions to ask Dad about his chili. |

## Kitchen clock thread

Sat, 8:15 pm (the call) → Sun, 10:00 am (set up) → Sun, 6:30 pm · everyone's home (the recipe box) → Tue, 11:04 pm (far from home) → This Sunday, 10:00 am? (the invitation)

## Every floating chip and pill on the page

| Where | Text | Tone |
|---|---|---|
| Hero card photo | ● Recording · 0:42 → ▶ Watch | white pill |
| Pass-down fan | Grandma · Dad | forest · sun |
| The call | Grandpa Rey: "low and slow" · Grandma Rosa: "un puñito" / a little handful | forest · sun |
| Step 1 | Lean it on the rice jar. | white pill |
| Step 2 | ● REC 0:42 · All-day dish? Record in pieces. | rec · lavender |
| Step 3 sticker | That's / it. | sun on cream |
| See it work chips | Sunday dumplings · Grandma / warm like a baby's bath · ~1 cup / 🔊 Hear Dad / Our family table | cream outline |
| Every family hover | the tile's own words + ~estimate | cream |
| In their words sticker | Coming to / the app | sun on cream |
| Far apart | from Grandma · Delivered ✓ · Delivered · {R} ♥ | caption · green · tomato |
| Measures | you've got this! | cream |
| Final CTA sticker | Free / Early access | chartreuse on forest |

## Recipe cards (`recipes.ts`)

Titles render as "{cook}'s {dish}". Eleven cooks are women and ten are men. Three cards carry an original-language line, always with the English in the feel quote.

| id | Card title | Feel quote (cook's words) | ~Estimate | Time | Tint | Photo |
|---|---|---|---|---|---|---|
| grandma-noodle-soup | Grandma's Hand-Pulled Noodle Soup | two heaping rice bowls, maybe a little more | ~3 cups flour | ~1 hr 15 min | limeWash | app cover |
| grandma-pork-belly | Grandma's Red-Braised Pork Belly | the color of tea or honey, never dark | ~3 tbsp rock sugar | ~2 hrs, plus overnight | forest | app cover |
| dad-chili | Dad's Sunday Chili | three big shakes, about a palmful | ~3 tbsp chili powder | ~4 hrs | green | app cover (cook face: dad and son) |
| dad-fish | Dad's Grilled Fish with Ginger-Scallion Sauce | a piece as big as my thumb | ~2 tbsp minced ginger | ~45 min | sage | app cover |
| auntie-lin-pancakes | Auntie Lin's Scallion Pancakes | when it looks like too much, one more handful | ~8 scallions | ~1 hr | blush | app cover |
| grandma-dumplings | Grandma's Sunday Dumplings | pleat it like a little purse | ~2 tsp filling each | ~2 hrs | sage | dish-dumplings |
| mama-jollof | Mom's Jollof Rice | let the bottom catch a little, that's the best part | ~10 min on low | ~1 hr 30 min | apricotSoft | dish-jollof-rice |
| grandpa-rey-adobo | Grandpa Rey's Pork Adobo | low and slow, till the vinegar stops biting your nose | ~40 min simmer | ~1 hr | peach | dish-adobo |
| abuela-tamales | Grandma Rosa's Tamales | un puñito de sal (es) / a little handful of salt | ~1 tsp salt | ~4 hrs | blush | dish-tamales |
| abuelo-empanadas | Grandpa Luis's Empanadas | twelve little pinches around the edge | ~12 folds each | ~2 hrs | butter | dish-empanadas |
| papa-dal | Papa's Dal Tadka | until it smells like home, then the tadka | ~25 min simmer | ~45 min | lemon | dish-dal |
| nani-biryani | Grandma Asha's Chicken Biryani | water as salty as the sea | ~2 tbsp salt | ~3 hrs | sun | dish-biryani |
| dziadek-pierogi | Grandpa Joe's Strawberry Pierogi | pinch it shut like you mean it | ~24 pierogi | ~2 hrs | limeWash | dish-pierogi (cook face: grandpa chopping) |
| nonna-lasagna | Grandma Lucia's Lasagna | sugo, quanto basta (it) / sauce, as much as it needs | ~3 cups sauce | ~3 hrs | butter | dish-lasagna |
| dad-shakshuka | Dad's Shakshuka | crack the eggs into little wells | ~6 eggs | ~35 min | chartreuse | dish-shakshuka |
| appa-kimchi-jjigae | Dad's Kimchi Jjigae | 신 김치로 해야 맛있어 (ko) / it only tastes right with sour kimchi | ~2 cups kimchi | ~40 min | ube | dish-kimchi-stew |
| uncle-minh-pho | Uncle Minh's Pho | char the onion till it's black, don't be shy | ~1 onion | ~6 hrs | peach | dish-pho |
| nana-apple-pie | Nana's Apple Pie | butter as cold as your hands can stand | ~1 cup cold butter | ~2 hrs | lemon | dish-apple-pie |
| auntie-dee-mac | Auntie Dee's Mac and Cheese | cheese till you can't see the noodles | ~4 cups cheese | ~1 hr | sun | dish-mac-and-cheese |
| grandpa-ken-ramen | Grandpa Ken's Shoyu Ramen | a splash of shoyu, taste, then one more | ~2 tbsp shoyu | ~2 hrs | limeWash | dish-ramen |
| mom-banana-bread | Mom's Banana Bread | bananas uglier than you'd ever eat | ~3 bananas | ~1 hr 10 min | apricotSoft | dish-banana-bread |

The five app recipes and their quotes are copied exactly from `data/synthetic/`, so they match the screen recordings. Alt text for every photo is in `recipes.ts`.

## Open questions for the founder

1. Translation is presented as "coming during early access" with a "Coming to the app" seal, because the app is English only today. Is early access the right promise, or should it say "coming soon"?
2. The row 03 H3 "Hear them say it." matches the Hear Dad button in the clip. The clip never plays audio, because no family recipe has a recording yet. Recording one real cook would make this row fully literal.
3. Native-speaker checks are needed for the six translator lines, the three card originals (es, it, ko) and the three marquee phrases (es, zh, it).
4. Grandpa Joe's card uses the photo of a Black grandfather slicing tomatoes as its cook face, paired with strawberry pierogi. If that pairing feels forced, swap his cook photo onto Auntie Dee's mac and cheese and make that card "Grandpa Earl" (that changes the gender balance; tell us and we'll rebalance).

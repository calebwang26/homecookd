# homecookd lander: copy deck

Oct 12, 2026 · draft v1 · goes with `docs/lander-spec.md` and the `Main.dc.html` mockup. Section ids match the page; every field can be pasted straight in.

## Brand

Brand line: Culture we want to preserve, and pass down.

Positioning: homecookd turns a parent's everyday cooking, in their own language, into a recipe the whole family can follow and keep, with the cook's real voice on every step.

### The three problems

1. Vague and slow. Family recipes run on "a handful" and "you'll know," and the best dishes take all day, so nobody writes them down or stays on the phone that long. Answered in `never-written-down`, `how-it-works` and `product-moment`.
2. Language. Ammi explains it best in Urdu and Sara reads English, so a lot gets lost between them. Answered in `language` and `product-moment`.
3. Distance. The kids live far from home and their parents miss cooking for them, which is how this family has always shown love. Answered in `far-from-home`, `quieter-kitchen`, `both-ways` and `final-cta`.

### Voice rules

1. Her words come first, in her language, with English right under them. Any amount we add carries a "~".
2. Sound like the app, or a warm older sibling: short, specific, a little funny ("asking for you, gently", "you've got this, Sara!").
3. Write for a 58-year-old on a phone. Headers of 2 to 6 words, 1 or 2 short sentences, plain words, "and" instead of "&".
4. Talk about the kitchen and the people. Say "AI" once, plainly, in the FAQ, and never use the banned words in spec section 9.
5. Keep urgency gentle ("before the recipe is lost"). No stats, reviews or made-up quotes; Sara and Ammi are an illustrative family.

### Notation in this deck

- `*word*` is the bold italic display word (Fraunces, WONK 1).
- `==word==` sits on the yellow highlighter.
- `[mascot]` is the pot mascot, inline at cap height.
- `(ur-Latn)` and `(es)` mark lines that need that `lang` attribute. The English line under them is DM Sans, muted.
- The cook's quotes are written bare. The page adds the curly quote marks.

---

## nav

- Logo: homecookd
- Links: How it works · Languages · For parents · Questions
- Link targets: `#how-it-works` · `#language` · `#quieter-kitchen` · `#faq`
- Button: Get early access
- Button (mobile): Early access
- Menu button (mobile): Menu

## hero

- Headline options (the name rotates Ammi, Mom, Mamá, Nani, Dad, Lola):
  - ★ A. Cook it like / *==Ammi==* does.
  - B. Keep cooking / with *==Ammi==*.
  - C. Learn it / from *==Ammi==*.
- Subhead options (static; it stays on Ammi while the headline rotates):
  - ★ A. Ammi cooks like always. homecookd writes the recipe and keeps her voice.
  - B. Ammi cooks in Urdu, like always. You follow along in English.
  - C. Culture we want to preserve, and pass down. (Use only if the statement band takes option B or C.)
- Primary button: Get early access
- Secondary button: ▶ Hear Ammi
- Pause control label: Pause video / Play video
- Video and poster alt text: Ammi guides Sara's hand as they stir a pot of biryani together, both laughing.

## never-written-down

- Header: Never written down.
- Quote 1 (ur-Latn): Namak ==andaaze se==.
  - English: Salt, by feel.
- Quote 2 (ur-Latn): Itna bhuno ke ghee alag ho jaye.
  - English: Fry until the ghee separates.
- Quote 3 (es): Un puñito.
  - English: A little handful.
- Quote 4 (es): Hasta que huela rico.
  - English: Until it smells good.
- Quote 5: You'll know.
  - English: Already in English. Still a mystery.
- Closer: The best recipes take all day, and they live in her hands.
- Caption (stained handwritten recipe card): the only written copy, mostly turmeric
- Caption (hands pinching salt): how much? this much.
- Caption, optional third (Nani's steel pot): Nani's pot, every Sunday

## far-from-home

- Header: Far from home.
- Body: It's 11pm in the dorm, and Sara misses Ammi's biryani. She cooks along with Ammi's voice, and soon the whole hallway smells like home.
- Card (mascot + Caveat): you've got this, Sara!

## quieter-kitchen

- Header: A quieter kitchen.
- Header, a6 variant to test: A *quieter* kitchen.
- Body: The kids moved away, but they still call to ask how you make it. Cook like you always do, in your own language, and they keep it in your voice.
- Card line (ur-Latn): Ab thoda sa namak, andaaze se.
  - English: Now a little salt, by feel.
- Card button: Hear Ammi

## language (new section)

Suggested spot: right after `quieter-kitchen`, before `how-it-works`.

- Header options:
  - ★ A. Her language, then yours.
  - B. Cooked in Urdu. Read in English.
  - C. Nani's Urdu, Sara's English.
- Body: Ammi talks in Urdu while she cooks, like always. Sara reads every step in English, and when she taps Hear Ammi, it's still her mom talking.
- Switch label: Cooked in:
- Switch options: Urdu · Español · English
- Urdu (default state)
  - Tag: Ammi · Chicken Biryani
  - Label above: Ammi said
  - Line (ur-Latn): Eid pe poori gali ko khushboo aati thi.
  - Label above: Sara reads
  - English: On Eid, the whole street could smell it.
- Español
  - Tag: Mamá · Pozole
  - Label above: Mamá said
  - Line (es): Déjalo hasta que reviente el maíz.
  - Label above: You read
  - English: Let it cook until the corn bursts open.
- English
  - Tag: Dad · Sunday Chili
  - Label above: Dad said
  - Line: Let it sit until it argues with you.
  - Label above: You read
  - English: Leave the beef alone until it browns, then turn it.
  - Dev note: nothing to translate here, so the second line is the step written out plainly.
- Small note: The cook's own words always stay on top. English sits right under them.

## how-it-works

- Header: Easy as dinner.
- Step 1 title: Ask her.
  - Line: A few easy questions, read aloud to her in her language.
  - Speech bubble (ur-Latn): Dish ka naam, aur kis ne sikhaya?
  - Bubble English (on the highlighter): The dish, and who taught you?
  - Caveat (with mascot): asking for you, gently
- Step 2 title: She cooks.
  - Line: Like always, with a phone propped up. The more she talks, the better.
- Step 3 title: You keep it.
  - Line: A recipe the whole family can follow, with her voice on every step.
  - Ingredient rows (from the app): do glass chawal / ~2 cups rice · ek kilo murghi / ~1 kg chicken · teen bari pyaaz / ~3 onions
- Wait banner (lavender, moon): Overnight soak? Just record again in the morning.

## product-moment

- Header: Her words. Her hands. Her voice.
- Row 1
  - Label: HER WORDS
  - Title: Her amounts, made clear.
  - Line: "Do glass chawal" stays just as she said it, with ~2 cups rice right beside it.
- Row 2
  - Label: HER HANDS
  - Title: Tap Watch. Land on the moment.
  - Line: Every step opens her video at that exact spot, so you can see how brown "brown" is.
- Row 3
  - Label: HER VOICE
  - Title: Hear her say it.
  - Line: Every step plays her real voice, with her words on screen in Urdu and English.
  - Button: Hear Ammi
- Trust note (sage): Ammi's words first. ~ amounts are estimated from her video.
- Caveat note (arrow toward the phone): word for word, from Ammi
- Phone screen text (unchanged from the mockup and app)
  - Step: Fry the onions · Step 2 · recorded Sat 7:02 am
  - Instruction: Slice thin and fry in ghee, stirring often, ==until the ghee separates==.
  - Time pill: 0:42 – 1:58
  - Transcript label: TRANSCRIPT · tap a line to jump there
  - 0:42 (ur-Latn): Pyaaz patle patle kaatne hain. / Slice the onions thin.
  - 0:58 (ur-Latn): Itna bhuno ke ghee alag ho jaye. / Fry until the ghee separates.
  - 1:20 (ur-Latn): Eid pe poori gali ko khushboo aati thi. / On Eid the whole street could smell it.
  - Story tag: a family story
  - Ingredient rows: dahi, ek katori / ~1 cup yogurt · namak andaaze se / salt, to taste

## statement-band

- Statement options:
  - ★ A (the founder's line, word for word): Culture we want to preserve, [mascot] *and pass down.*
  - B: The food that raised us, [mascot] *kept and passed down.*
  - C: Her cooking is our culture. [mascot] *Let's keep it and pass it down.*
- Why A: it's the brand line as written, and "preserve" is also a kitchen word.

## moments-band

- Header: Eid mornings and Tuesday nights.
- Tagline (Caveat): every day has its dish
- Captions (Caveat, one per photo):
  1. Ammi's paratha, 7am
  2. Dad's chai, 4pm
  3. Eid morning, everyone helps
  4. first try in the dorm. not bad!
  5. Grandma's noodles, never cut
  6. Dad's chili, all Sunday
- Sticker badge (on the Ammi cut-out): Hear Ammi ▶

## both-ways (new section)

Suggested spot: after `moments-band`, before `family-table`.

- Header options:
  - ★ A. Pass it down. Send it back.
  - B. Love goes both ways.
  - C. Cooking is how we say it.
- Sentence: She shows her love by cooking for you, and you show yours by asking her to teach you.
- Column 1 label: From Ammi
  - Alt label: For the one who cooks
  - Her dish, made her way, in her own language.
  - The stories she tells while it cooks.
  - One recipe, sent to every cousin who asks.
- Column 2 label: Back from Sara
  - Alt label: For the one who's learning
  - "Ammi, will you teach me?"
  - Follow-up questions, like "how long do I soak the rice?"
  - A first try, cooked in the dorm and sent home with a photo.
- Message example (two chat bubbles)
  - Sara, with a photo: First try!! A little mushy, but my whole hallway showed up.
  - Ammi (ur-Latn): Shabash beta! Agli dafa paani thoda kam.
  - Ammi, English: Well done, beta! Next time, a little less water.
  - Photo alt text: Sara's first pot of biryani on a dorm stove.

## family-table

- Header: Everyone's at the table.
- Tagline (Caveat): 6 recipes, 4 cooks, lots of love
- Filter chips: All · Eid · Weeknight · Sweet
- Tag on cards from other families: example
- Card link: Open recipe ↗

## why-we-built-this

[team to personalize]

- Header: Why we built this.
- Body: Our family recipes live in "a handful" and "you'll know." Our grandparents live far away and some speak another language, so we built homecookd to keep their cooking, and their voices, in the family.
- Sign-off (Caveat): with love, the homecookd team
- Photo captions: Caleb · Serene · Miles · Salik · Rayan

## keepsake

- Sticker badge: Coming soon
- Header: A cookbook you can hear.
- Body: Your family's recipes in a printed book, and every page plays her voice when you scan it with your phone.
- Caveat note: a gift for Eid, Mother's Day or a wedding
- Button: Tell me when it's ready

## faq

- Header: Ask us anything.
- Caveat note: better answers than "you'll know," we promise
- Q: Does Ammi need to download anything?
  - A: No. Someone in the family sets up the phone, and she cooks and talks like always.
- Q: Does she have to speak English?
  - A: No. She can talk in her own language, the way she always does. Her words stay first on every step, with English right underneath.
- Q: Do we need special equipment?
  - A: No. Any phone works. Lean it on the backsplash or a jar of rice so it can see the stove.
- Q: What if the dish takes all day?
  - A: Record in pieces. Stop for the overnight soak, start again in the morning, and homecookd puts it back together with the waits marked.
- Q: How does homecookd work?
  - A: homecookd uses AI to watch her video and listen to what she says, then writes the steps, amounts and stories. Her own words always sit right beside it, so you can check.
- Q: Who can see our recipes?
  - A: Only your family, unless you choose to share one.
- Q: Can we send recipes to the rest of the family?
  - A: Yes. Send any recipe to a brother, sister or cousin, and they can watch and hear her too.
- Q: How much does it cost?
  - A: Free during early access.

## final-cta

- Header (★): Ask her to *teach you* this Sunday.
- Header, alt: Cook *with her* this Sunday.
- Email label: Your email
- Email placeholder: you@email.com
- Primary button: Get early access
- Secondary button: Send this to Ammi
- Small print under the form: Free during early access.
- Caveat note (with mascot, yellow): she'll love being asked
- Thank-you state: You're on the list. We'll email you when it's your turn.
- Thank-you Caveat note: now go call home
- Share message, prefilled: Ammi, will you teach me your biryani this Sunday? You just cook and talk like always, and I'll keep the recipe in your voice. [link]
- Share message, when we don't know the dish: Will you teach me to cook your food? You just cook and talk like always, and I'll keep the recipe in your voice. [link]

## footer

- Prompt (two lines): Hungry for home? / Get early access and be the first to cook with her.
- Button: Get [rule] early access
- Link column 1: How it works · Languages · For parents · Questions
- Link column 2: Instagram · TikTok · Contact
- Wordmark: homecookd
- Legal row: Privacy · Terms · Photo credits
- Email: hello@[our domain]
- Credit line: © homecookd 2026. Made with love at the venture hackathon.

---

## Open questions

1. Which languages do we promise? The copy says Ammi cooks in Urdu and Mamá in Spanish, with English underneath. Today's build is English only (`CLAUDE.md`, PRD non-goals). Ship it as written, or add a small "more languages coming" line under `language`?
2. Her voice stays in her language. The copy promises English on screen under her real voice and never an English dub. Please confirm that matches the plan.
3. Please get a native-speaker check for the lines that are new to this deck: "Shabash beta! Agli dafa paani thoda kam." (Urdu), "Hasta que huela rico." and "Déjalo hasta que reviente el maíz." (Spanish). Every other Urdu line comes from the spec, mockup or app.
4. Sharing recipes: `both-ways` and the FAQ say families can send recipes to each other. The PRD lists sharing as roadmap. Is it shipping by launch?
5. Privacy answer: The FAQ says recipes stay with the family. Should it also say her video goes to an outside AI service to be written up, and should it mention the opt-in data licensing from the PRD?
6. Header length: I shortened two headers to fit the 6-word rule: the final CTA (was "Ask her to cook with you this Sunday.") and the keepsake (was "A cookbook with her voice in it."). Keep the originals if you prefer them.
7. Nav label: "Stories" became "Languages" so the new section has a link. Is the `#language` anchor OK?
8. "Any phone works": Is Android supported, or should the FAQ say iPhone?
9. Family table tagline: "6 recipes, 4 cooks" counts Ammi's family only. The card row also shows example cards from other families.
10. Early access: The thank-you state assumes a waitlist email (spec open question 6).

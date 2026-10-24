# Direction B: One page

The recipe and the cooking are the same page. Before you start, it is a short preview: photo, two big facts, ingredients, one line per step. "Start cooking" doesn't open another screen. It opens step 1 in place, folds everything you've finished into one row at the top, and turns the bottom bar into Back / Done, next. Nothing opens in a sheet except Ask. A step's video and voice play inside that step's own box.

How B differs from the others: A shows one step per screen and opens All steps as a sheet. C is built around a voice dock. B has no separate step screen, no All steps screen and no dock.

**Artboards.** B-Overview, B-Step, B-AllSteps and B-Story are one interactive artboard, Dad's Grilled Fish, saved four times with different starting states. They open at the overview, step 4, step 4 while re-reading step 2, and step 6 with its story open. Because each copy holds the whole flow, state is never split across files, and "Start cooking" now lands on step 1. B-Recorded (Miles's Weed Steak, all 13 steps clickable) and B-Home are their own artboards.

**B-Home** (5 targets: profile, card, 3 tabs). The whole photo card is the "Cook this" action, with time and servings on it. The weekday eyebrow, the faces/streak row, Invite family and "Explore more dishes" are gone, and so is "More from home" (see Rejected). The card is 540 tall instead of SPEC's 344. That's on purpose: it is the only thing on Home. Title size and shade use SPEC values (34px, 40% to 0.82). The one Caveat accent is "From Dad's kitchen" on the photo, beside Dad's face.

**B-Overview** (about 150 words over 1,839px; it was 521 words over 4,201px). It shows the photo, title, Ask Dad and Save, then two fact cards (~45 min, 4). Ingredients follow. Each row puts the amount first in bold, with Dad's words under it in peach ink, the colour that already means "the cook's words". The "Dad:" prefix and the quote marks are gone. Low-confidence rows (salt, oil, vinegar) don't get a bolded number. They show Dad's words, then the estimate in small type, and the two-use totals say "in all" ("~1 tbsp in all", "~1/2 cup in all"). The steps list is one line per step, using CONTENT §4's preview lines: "medium-high · [no grill? ask Dad]" under step 3 and "about 6 min a side" under step 4. A single "Story from Dad · Friday fish" row opens in place. Substeps, quotes, specials and the second story appear only once you're cooking, so nothing is repeated word for word. After you stop partway, the list shows checks and the button reads "Keep cooking". After "I made it", the app's "You made this" pill appears.

**Cooking, one step model** (B-Step: 6 targets: ×, Ask Dad, the done row, the special, Back, Done next; today's step screen has 10).
- Header: × (stop cooking, back to the recipe), "Step 4 of 6" at 17/700, Ask Dad with Dad's face. The pots sit under it at the top again (Caden), 16px.
- One row folds everything behind you: "Ingredients · Steps 1–3". However many steps a recipe has, the current card starts at y=220. That holds at step 12 of 13 too.
- The current step is the only open card: title at Fraunces 30, 2 or 3 short lines with amounts, heat and timing in bold, then "Done when …". Dad's line shows only where it adds a reason the lines don't already give. That is steps 1 and 2. On steps 3, 4 and 5 it repeats a line or the cue, and on step 6 it is a family rule that the story already tells. Specials are a butter row: eyebrow and text, with the why one tap away. Stories are a lavender "Story from Dad · title" row that opens in place.
- Upcoming steps show as titles only, and you can't tap them. You can see what's coming without being able to read ahead by accident.
- Moving: "Done, next" is the one primary action. "Back" and tapping a finished row do the same thing: they open that earlier step in place inside the done row. Your step stays open below, so you never lose your place, and nothing gets un-completed. Back from step 1 opens the ingredients. There's no "Back to step N" label anywhere.

**B-AllSteps** is the review state: on step 4, re-reading step 2 inside the done row. The file keeps its name, but there is no All steps screen any more. The page itself is the step list.

**B-Story**: step 6 with "Story from Dad · The cheek" open in place, and "I made it" in the bar.

**Ask** (overview and every step): a sheet with the dish and step attached. It offers the data's own follow-up question as one tap when there is one. Step 4 gets q1 (grill temperature). Step 5 gets q2 (how much oil for the sauce), next to its [heat, oil amount: ask Dad] placeholder for Elliot's heat question. The overview gets all three. A message field and Send sit below.

**B-Recorded** (Weed Steak, step 2 of 13, voice playing). Each step has one media box (228 tall) with one control on the frame, "Watch this step · 3:10", which opens full screen with a seek bar and play/pause (drawn: tap it). "Hear Miles · 3:10" sits under the frame. It turns the same box into Miles's voice: one pause button, a scrollable transcript of his own words with the current line larger, and a seek bar. The page doesn't move, so the substeps and the story stay where they were (Neil). While the voice plays, the button under the box becomes "Watch this step". "Story from Miles · Trader Joe's Inspiration" opens in place and has "Hear Miles tell it · 0:32", which plays in the same box. The 13 pots sit at the top at 15px. Header and bar take 31% of the screen (it was 39%). Targets: 9 while the voice plays, including the seek bar; 8 with the video showing.

**Critique fixes applied**
- Split state: All steps and Story are now the same artboard as the steps. Every Back, Done, next, "I made it" and row works.
- Seek: real range inputs, wired to state, for both voice and video. Full screen is drawn.
- Home's dead "More from home" tiles are removed. All artboard comments are removed.
- Placeholders are plain bracketed text in muted ink, so they no longer look like chips or specials. All of CONTENT §4's placeholders are drawn: [rub amount], [degrees, preheat time], [no grill?], [lid open or closed], [heat, oil amount]. Rows you re-read show them too.
- Step 5 says "Heat the oil in a small pot", and its scallion-ring "Done when" is back. Step 4 has a "Done when", and its flip line keeps "blistered and golden". The step 4 and 5 quotes are dropped.
- "whole fish" replaces "whole branzino".
- The 2:39 honey timestamp is gone. The voice opens at 0:04 on Miles's first line. The highlighted line follows the playhead proportionally, because the data has no timestamps per sentence.
- Tokens: SPEC pinned bar (24 gutter, bottom 28, 36px fade), current title 30, special caps 13, text 16/700 and why 15, plain sun sparkle, number discs 32, header frosted at 0.72 with blur, feel lines 15, Miles's "M" tile with SOFT 100.
- Fraunces italic is now actually loaded. The ital axis is added to the same single font link, so the quotes, stories and transcript no longer render as synthetic oblique.

**Rejected, and why**
- *Adding support.js.* It is the canvas runtime, served by the host. A local file would shadow the real one for every direction. The tag stays exactly as FORMAT requires. The flows were checked with a local stand-in runtime kept in scratch, outside the project.
- *A link into B-Recorded.* There is no honest way in. CONTENT §2f keeps Weed Steak off Home, and the Recipes tab isn't drawn. B-Recorded's × and "I made it" go to B-Home.
- *Recipes and Ask tabs on Home.* Those screens are outside this brief and not drawn in any direction, so the tabs stay buttons. Asking now takes one tap from the recipe and is in every step's header.
- *"More from home" (Neil).* Its tiles had no screens to open. It also competed with the one action Home should have, and the Recipes tab is one tap away.
- *Ask on Home.* It would be a second action next to "Cook this".
- *Making "Cook this" start cooking straight away.* The plan wants the preview before committing. The preview is now short, and "Start cooking" doesn't change screens.
- *Showing Dad's feel words only where they add information.* CLAUDE.md says the cook's words are always shown, never only the estimate. They stay on every row, but they're quieter: no prefix, no quotes, 15px peach.
- *Pots in the bottom bar next to "Step 4 of 6" (Joanna's preference).* They went back to the top for Caden. The label is 17/700 now instead of 14.

**New things B adds** (each replaces something bigger): the one done row, which replaces the All steps sheet and button and the header link; the Ask sheet's one-tap data questions; and the Watch / Hear swap under the media box.

**Open questions for Caleb**
1. Missing facts, shown as placeholders: stove heat and oil amount for the sauce (Elliot), grill degrees and preheat time, lid open or closed, what to do with no grill, how much salt goes in the rub, and which fish to use if there's no branzino. A college kid without a grill can't cook this one as written.
2. Substeps are the instruction split at sentence ends. Step 4's flip line merges the instruction with the cue ("when the skin lifts off by itself, blistered and golden in spots"). Is that acceptable as a display rule?
3. The quote rule: show the cook's line only where it adds a reason. That leaves 2 of 6 fish steps. Agree?
4. Should the data's follow-up questions show up as one-tap questions in Ask?
5. Weed Steak: "Ask Miles" or "Ask the family"? Its cues are commentary, so its steps show no "Done when". Its steps other than 2 are split from the data with no bold, because nobody has hand-checked them.
6. The x2 special ("Finishes the sauce with a splash of rice vinegar") restates step 5's last line. Its why is the only new part. Keep it, or show only the why?

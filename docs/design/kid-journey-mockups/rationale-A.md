# Direction A: Guided steps

The recipe is shown one step per screen. The header holds close, "Step N of M", a labelled "All steps" and the pots. The bottom bar holds a labelled Back and one green button. A uses two dishes: Dad's Grilled Fish (no recording) and Miles's Weed Steak (the only real video and voice).

**Click-through paths**
- Fish: Main → card or "Cook this" → A-Overview → "Start cooking" → A-Step (Step 1 of 6) → Next … → "I made it".
- Recorded: Main → "More dishes" (or the Recipes tab) → A-Recipes → Weed Steak (6th row, or the Miles chip) → A-Overview-Steak → "Start cooking" → A-Recorded-Start (Step 1 of 13).
- Ask: the Ask tab opens A-Ask. "Ask Dad" on the overview and "Ask Dad about this step" open a sheet in place.
- The same artboards also start in other states: A-Step-Mid (step 4), A-Review (back on step 2 after reaching 4), A-AllSteps (the sheet in that state), A-Story and A-Story-Open (step 6), A-Step-Ask, A-Recorded (step 2, voice playing at 2:39) and A-Recorded-Watch (full screen).

**Home (Main).** One photo card, a green "Cook this" and a quiet "More dishes ›" link. Sizes now follow the bible: hero 344 tall, title 34, "Hi, Leo" 32, and the "Leo ▾" pill instead of a bare face. Home has 7 targets. The faces row is gone from Home: Neil didn't care about it, and Elliot and Joanna couldn't tell what it was for. It moved to the Ask tab under "Message someone", where tapping a face to message that person is what you'd expect. The card and "Cook this" both go to the overview on purpose. Elliot and Joanna tapped the photo, and Neil asked for a labelled start. "Cook this" picks the dish and "Start cooking" begins step 1, so the two buttons sit on different screens and do different jobs. (The old rationale said "one start button instead of two"; that was only true inside the overview.)

**Overview (A-Overview).** The photo is back to 380. A "Story from Dad" chip on the photo opens Friday fish. It is the one emotional hook before cooking, and it moved here from step 1. The "by Dad" row brings back Dad's face and adds an "Ask Dad" pill, because Neil went to chat from the recipe page. Time and servings are 22 bold, with the heart beside them (Caden). The "6 steps" list now comes before the ingredients, so it starts on the first screen (Caden). Each ingredient shows the estimate in bold, with Dad's words on a plain grey line that starts "Dad:" instead of peach italics (Joanna read the italics as decoration). The name is "whole fish", as in the data. Back now sits in the bottom bar next to "Start cooking", so no floating button covers the list when you scroll.

**Weed Steak overview (A-Overview-Steak), the scale test.** With 13 steps and 22 ingredients the page runs about 2.5 screens. The step list still starts on the first screen, and the pinned button keeps the start in view. Ingredient rows are one line with no feel words, because "about this much" means nothing without the video; Miles's words play in his voice at each step instead. "Full video · 51:43" sits on the photo and opens full screen, with seek and the current step's name ("Step 8 · Add the weed oil…"). The cook time stays "~30 min".

**Step (A-Step).** Top to bottom: title, numbered substeps, one "Ready when" line where it's the heat or doneness test, Dad's tip only when it gives a reason the substeps don't, "You need" for this step, a story row, then Ask.
- The tip appears only on step 1 (why the skin must be dry). On steps 4 and 5 it repeated substep 2, so it's gone. The tip box is smaller now: no avatar, 17/1.4.
- "Ready when" appears on steps 2 to 6. Step 4 gets back "blistered and golden in spots". Step 5 gets back the scallion-ring test, the only heat check before you pour (Elliot asked how hot).
- In "You need", the bold slot holds only an estimate or a dashed placeholder: [rub amount: ask Dad] on step 1 and [sauce oil: ask Dad] on step 5. Uses with no measure (a wipe of oil, a pinch of salt) show the name alone, and the substep gives Dad's words. Step 5 now lists "the ginger and scallion bowl, from step 2".
- Placeholders on screen: [degrees: ask Dad] and [preheat time: ask Dad] (step 3), [lid open or closed: ask Dad] (step 4), [heat: ask Dad] (step 5).
- Step 1 now shows two Dad elements (the tip and Ask) instead of three.
- Pots are bible size (16×13, gap 6), filled up to the furthest step reached, with a short ink bar under the step you're on. The bar is a deviation from the bible's PotDots. It lets the pots keep showing your progress while you look back.
- Looking back (Elliot, "going back to step 4"): there's no extra bar. While you're behind your furthest step, the green button reads "Continue at step 4", and Back still goes back one step. All steps marks "You're here" and "You were here", and it shows "Continue at step 4" only when those differ.
- Sheets have the bible's 48px close button at the top right. The bottom "Back to step N" buttons, which were really close buttons, are gone.
- "Ask Dad about this step" opens a sheet with the dish and step attached and you stay on the step. When the data has a follow-up question for that step (q3 on step 1, q1 on step 4, q2 on step 5), it's already in the box. Sending shows the message in the sheet.

**Recorded step (A-Recorded).** The instruction comes first. Below it is one peach card, labelled once "This step · 3:10". It has voice play and pause, a real seek bar (a range input, 44 tall, draggable and keyboard-operable) and Miles's current line under it (Elliot). Under that is the video frame with a "Watch" button. Voice and video share one timeline. "Watch" plays the same range in the frame, and "Full screen" opens it with captions, seek and pause (Caden). On step 2 the line timings are anchored to the data's first_seen times (water 1:32, salt 2:00, honey 2:39). On other steps the lines are spread evenly, which is mock timing. Stories are s1 (step 2), s4 (step 5) and s8 (step 12); the flagged stories aren't drawn. Placeholders: [heat: ask Miles] (step 1) and [amount: ask Miles] (step 8). Deviation: the frame is 180 tall at radius 20 inside the card, with a labelled "Watch" pill instead of the bible's 260/220 clip box and 68px disc. Two unlabelled play discs on one card wouldn't tell you which one plays what.

**Recipes and Ask (stubs).** Recipes lists Everyone first (Neil), then Favorites, which has an empty state. Search filters the list. Only the fish and Weed Steak rows open, because the other dishes aren't drawn. Ask has "Ask about a dish" (no plus sign; Caden was confused by two), a dish picker, and a chat with that cook with the dish attached.

**Critique items not taken**
1. Making the card and "Cook this" one target. B does that. A keeps the labelled button for Neil.
2. A sticky compact header on the overview. Moving Back into the bottom bar removes the overlap with nothing added. A header that appears on scroll would need a scroll handler, and the canvas only documents click events.
3. Shrinking the step header further. It's 146 now (was 155). The labelled "All steps" and the pots are what fixed Caden's and Joanna's navigation problems.
4. Labelling the faces on Home. They moved to Ask instead. Plan section 3 still decides what happens to the streak flames.
5. Putting Weed Steak on Home. CONTENT keeps it off Home, so it's reached from Recipes.
6. Bringing back "What made it special". x1 repeats the intro and the cheek, and x2 repeats substep 3.
7. Wiring "Leo ▾" and the rows for undrawn dishes. Both are outside this brief.

**How A stays distinct:** one step per screen, the position shown in the header, and an All steps sheet to jump around. Media is a card inside the step, not a docked player (C) or one long page with a bottom progress bar (B).

**Open questions for Caleb**
1. Missing from the data: grill degrees and preheat time, lid open or closed, how hot the sauce oil should be (Elliot), how the salt splits between rub and pinch, how the oil splits between wipe and sauce, the Weed Steak pan heat, and the weed-oil amount.
2. Is a green "Continue at step 4" clear enough on its own?
3. Substeps are the instruction split at sentence ends and lightly trimmed (more trimming on Weed Steak). Keep that as a display rule, or have the pipeline write substeps?
4. Dad's tip shows only when it adds a reason. For the fish that's one step in six. Is that too few for Elliot, who liked the quotes?
5. Steps come before ingredients on the overview. OK, or should the checklist come first?
6. Should the Ask box be prefilled with the data's follow-up question?
7. Is Miles in the family ("Ask Miles") or not ("Ask the family", which is what Elliot saw)?
8. Only one Weed Steak frame is uploaded, so the full-video poster and step 2 use the same image. The app has a real frame for every step.
9. Voice and video share one timeline here, but they're separate players today. Is sharing it clear?
10. Resuming from the overview (Elliot): the button would read "Continue at step 4". Not drawn.

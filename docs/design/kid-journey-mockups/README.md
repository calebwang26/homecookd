Canvas (private to Caleb; 30 clickable screens): https://claude.ai/artifact/1FXGT2LF6xteKtyeUMTzjq
Status (Oct 22): round 1, waiting on Caleb's pick and answers. Nothing here is built. Per-direction rationale is in rationale-{A,B,C}.md.

# Kid cooking journey: three directions to review

These are three mockups of the simpler cooking journey from section 2 of the Oct 21 plan. All three keep the Hearth look, the big dish photo, the pots, voice and video, and Ask Dad. They use real recipe content, and facts the data doesn't have show as [brackets]. The canvas is `canvas/project/canvas.json`: one row per direction, 30 clickable phone screens. Home (`Main.dc.html`) opens first.

- **A · Guided steps** (15 screens, critic score 6): one step per screen. The header shows "Step 4 of 6", the pots and a labelled "All steps". The bottom bar has Back and one green button.
- **B · One scroll** (6 screens, score 5): the recipe and the cooking are one page. "Start cooking" opens step 1 in place, and finished steps fold into one row at the top.
- **C · Cook along with their voice** (9 screens, score 5): a peach dock at the bottom always holds the cook's voice and Ask. You seek in a full-screen player.

## The six validation tasks
| Task | A · Guided steps | B · One scroll | C · Their voice |
|---|---|---|---|
| Choose a dish from Home | Photo card, green "Cook this", "More dishes" link (7 targets) | The whole photo card is "Cook this" (5 targets, biggest photo) | Photo card and green "Cook this" (5 targets). The Recipes tab lists 6 dishes |
| Find time, servings, ingredients | ~45 min and Serves 4 in large type, heart beside them. Ingredients come after the step list | Two big fact cards, then ingredients with the amount first | Two fact cards, then a check-off ingredient list (7 shown, "See all 22") |
| Preview and start cooking | "6 steps" list on the first screen, pinned "Start cooking" | One line per step. "Start cooking" opens step 1 on the same page | Tappable step rows. The button turns into "Keep cooking from step 4" |
| Go forward, then back to an earlier step | Back and Next. The All steps sheet marks "You're here". The button reads "Continue at step 4" | Back opens the earlier step inside the folded row, and your step stays open below it | Back and Next. The All steps sheet marks "You stopped here" |
| Play and seek voice or video while cooking | Voice card inside the step with a seek bar and the current line. Watch, then full screen | One media box per step: Watch (full screen with seek) or Hear (transcript with seek) | Play/pause always in the dock. Seeking only in the full-screen player |
| Ask someone about the dish | "Ask Dad" on the overview and on every step. The sheet is prefilled with the recipe's follow-up question | Ask Dad in every step header. The recipe's questions are one tap | Ask is in the dock, so it's always on screen. The dish or step is attached |

## The five areas
| Area | A | B | C |
|---|---|---|---|
| Home | One card and a labelled button. Faces moved to the Ask tab | One card and nothing else | One card and a button. The Recipes tab works |
| Recipe overview | Steps come before ingredients. "Story from Dad" chip on the photo | Shortest: about 150 words (521 today) | Check-off list, resume state, full video on the photo |
| Cooking steps | Numbered substeps, "Ready when", "You need". Dad's tip only when it explains why | Same text, only the current step open. 6 targets (10 today) | Video frame beside the title, "You need" with the cook's words. 7 controls |
| Step navigation | Position in the header and an All steps sheet. Most familiar | No step screen at all. Can't tap ahead | Like A, plus resuming from the overview |
| Family stories | "Story from Dad" row in the step opens a sheet | Lavender row opens in place. "Hear Miles tell it" | Opens in place and plays in the dock |

## What each direction is betting on
- **A:** kids want one thing at a time and a labelled position ("Step 4 of 6", Back, All steps). It's closest to today's cook screen, so it's the cheapest to build. Risk: Dad's tip, Ask and a media card can still crowd one step.
- **B:** Caden and Joanna just scrolled, so stop making them switch modes. It has the fewest controls and the least text. Risk: the folded "done" row is a new idea nobody has tested, you can't read ahead, and it's the biggest rebuild.
- **C:** the cook's voice is the product (Neil would rather hear than watch, and Elliot listened most of the way through). Risk: the dock, header and bottom bar take 36% of the screen, and Neil and Elliot asked to seek without opening a player. Dishes with no recording look different.

## Recommendation
Build **A** as the base. It scored highest, and it gives the plainest answer to the two problems three of four kids hit: too much text and not knowing how to move between steps.
- From B: make the whole Home card the tap target with "Cook this" inside it, so the label stays and the extra target goes. Use the two big fact cards and amount-first ingredient rows, with the cook's words as quiet peach text under each. Replace A's stacked voice card and video frame with B's one media box that switches between Watch and Hear. Use B's one-tap follow-up questions in Ask.
- From C: "Keep cooking from step 4" on the overview, with done steps checked. Stories play in the cook's voice ("Story from Miles · 0:32"). Specials always show their "why", and specials that repeat a step are dropped.

## Questions for you (quick answers are fine)
1. One step per screen (A), or one long page you scroll (B)? Caden and Joanna both just scrolled.
2. Should the cook's voice sit inside each step (A, B), or in a dock that follows you (C)?
3. Dad's quote shows only where it explains why, which is 1 or 2 of the 6 fish steps. OK, or too few for Elliot?
4. On the overview, should the step list come before the ingredients (A), or after them (B, C)?
5. Should Ask open with the recipe's own follow-up question already typed in?
6. Can you ask Dad for the grill temperature, preheat time, lid open or closed, sauce oil heat and amount, salt for the rub, and what to do without a grill? And Miles for the pan heat and how much weed oil?
7. Is Miles in the test family ("Ask Miles"), or should the button say "Ask the family"?
8. All three took the faces/streak row, Invite family and profile switching off Home. Where should they go? (A put the faces in the Ask tab.)

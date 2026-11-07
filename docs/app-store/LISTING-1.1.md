# The App Store listing for 1.1 (the AWS build)

Written Nov 5, 2026 (App Store, web & builds), for CUTOVER.md step 9. 1.0's listing promises hands-free voice cooking
("Cook hands-free. Say next…") and two of its screenshots show it, but homie's voice is off in 1.1
(`docs/agents/memory/homie-off.md`). Guideline 2.3 needs the listing to show what the build does, so this replaces
the text and the screenshots. Caleb or Salik pastes it into App Store Connect for the 1.1 submission; nothing here is
live until then. The handoff doc ("homecookd App Store submission for Salik") points here from its 1.1 items.

Every line below is checked against the app on `main` (Nov 5) and the site: what each feature is, where it lives.

## Promotional text (170 characters at most; can change without review)

```text
Your kids miss your cooking. They name the dish, you answer out loud, then film it like always. homecookd turns it into a recipe in your words and your voice.
```

## Description

```text
You called home and asked how she makes it. "A handful of this. Cook it until it smells right." You still couldn't make it.

homecookd fixes that. Your kid names the dish they miss. Mom, Dad, Grandma or Grandpa answers out loud, then films it the next time they cook. homecookd turns it into a recipe the whole family can follow, in their words and their voice.

FOR THE COOK
• See what your kids are craving: "Leo wants your tomato egg."
• Tell them how you make it now, in two minutes, out loud.
• Film it the next time you cook. Set a reminder for the day you usually make it.
• Speak the language you cook in. homecookd works in 13 languages, and your own words stay in the recipe.
• Answer your family's questions with a voice note.
• Get a photo when someone makes your dish.

FOR THE FAMILY
• Name a dish from home and get a version you can cook tonight, built on good guesses.
• Ask Mom with one link. She answers by voice from her browser, no app needed.
• "A handful" becomes a real amount you can measure, marked with a ~ so you know it's an estimate.
• Every step links to the moment in the video, so you can watch exactly how it's done.
• Hear the cook say it, in their own voice.
• Send a photo of what you made, so they know it came out right.

MADE FOR FAMILIES
Your recipes are made for your family. Nothing reaches neighbors unless the cook chooses to share it. Invite your family with a link.

homecookd uses AI to write recipes from your videos and voice answers. It asks before anything is sent, always shows the cook's real words first, and marks anything it adds.

Culture we want to preserve, and pass down.

Questions? Write to team@homecookd.app.
Privacy policy: https://homecookd.app/privacy
Terms of use: https://homecookd.app/terms
```

What changed from 1.0, and why:

| 1.0 line | 1.1 | Why |
|---|---|---|
| "Film yourself cooking, or pick videos you already have. No typing, no measuring." | Requests, the 2-minute voice version, filming with a reminder | PRD-V2's cook path: the kid's ask first, filming as the upgrade (`app/src/components/request/`, the parent Home) |
| "Cook hands-free. Say "next" to move on, or ask a question out loud." | Removed | homie's voice is off: cook mode is Back and Next by touch |
| "If the answer isn't in the video, homecookd asks the cook for you." | Removed | That was homie answering; questions now go to the cook as messages ("Answer your family's questions with a voice note" stays) |
| "Speak in the language you cook in." | "…works in 13 languages" | The 13 integrated languages (Oct 26) |
| (none) | "Name a dish from home…", "Ask Mom with one link…" | The kid's web flow, /miss and /a, live since the v2 batch |
| "Invite the family with a text message." | "Invite your family with a link." | Join by link only (`docs/agents/memory/join-link-only.md`) |
| "…and to listen while you cook." | "…from your videos and voice answers." | No live listening while homie is off |

## Keywords (100 characters at most)

Unchanged: `grandma,mom,dad,heritage,cookbook,video,voice,memories,culture,dinner,kitchen,heirloom,dish,meal`.
"voice" still fits: voice answers and the cook's own voice in the recipe.

## What's New

```text
Ask your kids what they're craving. They name a dish from home, and you get a nudge. Tell them how you make it in two minutes, out loud, or film it next time you cook it. Set a reminder for the day you usually make it.
```

## Screenshots

1.0's seven were made Oct 25 on the pre-egg UI, and 03 ("Say next. Keep your hands in the pot.") and 04 ("Stuck?
We'll ask Mom.") show voice cooking. 1.1 looks different everywhere (the egg brand, Kitchen tile palette), so all seven
are re-shot on the 1.1 build, on the TEST family, at 6.9" (1320 × 2868). Captions keep 1.0's style: one short line on
top, the screen below.

| # | Caption | Screen (1.1, TEST family) | Replaces |
|---|---|---|---|
| 01 | Cook it the way they make it | A finished recipe's cover, "Watch yourself" and the cook's own quote (Chicken Biryani) | 01, same idea, new UI |
| 02 | Your kids ask. You answer. | Parent Home with "Leo wants your tomato egg" and Answer Leo | 03 (voice cooking) |
| 03 | Tell them how, out loud | The request sheet: Leo's guess, "Film it next time you make it", "Tell Leo how you make it now" | 04 (voice cooking) |
| 04 | Just cook. We write it down. | Record: "What will you teach today?", the three tips, Start recording | 02, new UI |
| 05 | "A handful" becomes a real amount | The recipe's ingredients: the cook's words with ~ estimates beside them | (new) |
| 06 | Hear it in their voice | The kid's card after Mom answered: her quote and Hear Mom | 05 "Keep the stories, too" |
| 07 | Send home a photo | The "I made it" photo going back to the cook | 06, new UI; 07 "Every family recipe in one place" drops (Apple allows up to 10, 7 kept) |

Who: App screens & recording shot them on Nov 6 (`docs/app-store/screenshots/1.1/raw/`, 1320 × 2868, the web build of
build 12's code on AWS staging; production's TEST family isn't seeded yet), with no test-run leftovers on screen. Its
README lists what to know before they go to Apple. App Store, web & builds frames and captions them into
`docs/app-store/screenshots/1.1/` and the handoff doc.

## App Review guard

- **2.3 Accurate metadata:** every promise above is a feature of 1.1 (sources in the table), and the screenshots are of
  1.1 itself.
- **2.1 Completeness:** the reviewer reaches every screenshot's screen inside the TEST family (the reviewer notes, step 9).
- **5.1.2(i):** the AI line says what is sent (videos, voice answers) and that the app asks first.

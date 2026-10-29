Canvas (private; the Merge Agent approves): https://claude.ai/artifact/EmDq3ZioiEUsrKkBx5H7jy
Status (Oct 29): approved by the Merge Agent (with the three fixes below), and built on the local branch
`claude/phase5-cold-parents` against stubs (`app/src/lib/cravings.ts`) until the Convex functions are deployed.
`phase5-built.jpg` shows the built screens from the web build.
`phase5-screens.jpg` shows the eleven screens on one sheet, and `phase5-flow.jpg` is the map. An independent critic's 8
changes are applied (round 2).

# Phase 5: cold parents in the app

A mom who installs from Facebook gets two doors. The main one asks her kids what they're craving. When a kid names
a dish on the web, she gets "Caleb wants your braised pork", and she either films it next time (with a weekly
reminder) or tells him how she makes it now, in a 2-minute voice note, so he can cook it tonight. homie's voice is
off (#163), so nothing here talks.

## The screens

1. **Two doors** (once, after the language pick, before parent Home). There's a big photo and "Your kids miss your
   cooking." The main door is a green card, "Ask your kids what they're craving". The second door is "Start recording
   now". A quiet "Not now" link goes to Home (3b).
2. **Ask what they're craving** (a sheet). Her message, in her voice, is editable: "What do you miss from home? Tell
   me and I'll make it for you." Under it is a preview of the link the kid will see. Then the app's share row: Copy
   link, Messages, WhatsApp, More.
3. **Home after she sends it.** A butter card says "Sent! We'll tell you when they pick a dish." The green link "Send
   to someone else" reopens the sheet. Invite family hides until a kid joins, because the craving link is the
   invite.
   **3b, Home before she asks** (after "Not now", or if she closes the sheet): a card with "Your kids miss your
   cooking." and "Ask what they're craving" stays at the top until she sends it once.
4. **The push**: "Caleb wants your braised pork · Caleb sent you a voice note. Tap to hear it." With no voice note,
   it reads "Tap to see Caleb's guess."
5. **Home with his ask.** The top card shows the dish photo (when he added one; without one, just the words), "Caleb
   wants your braised pork" and "Answer Caleb".
6. **Request screen.**
   - His voice note comes first.
   - Then "Caleb thinks it's" with "about 1 lb" amounts and "Is Caleb close?", so she wants to correct it.
   - Then two door cards: "Film it next time you make it" (main, green), with "We'll remind you on the day.", and
     "Tell Caleb how you make it now", with "2 minutes, out loud. Caleb can cook it tonight."
7. **When do you make it?** Day chips Sun to Sat, then Morning, Afternoon or Evening. The button is "Remind me on
   Sundays", with "Every Sunday at 4 pm" under it. "I'm making it now" opens Record with the dish filled in.
   - After she sets it, the request screen confirms "We'll remind you Sunday" and offers "Tell Caleb a quick version
     tonight", so a reminder never leaves him with nothing.
   - If notifications are off, the button reads "Turn on reminders" and opens Settings.
8. **Tell Caleb how you make it.**
   - AI consent comes before the first start, because her voice goes to Cartesia and Claude.
   - Three states:
     - Ready: one red "Tap to start".
     - Recording (8): the clock out of 2:00 and only a stop button.
     - Done (8b): "Listen back", "Send to Caleb" and "Start over".
9. **Sent to Caleb**: "Caleb can cook it tonight, in your words." A card shows a line in her words. Then "Caleb misses
   the sound of your voice. Film it next time." with "Remind me", which is hidden when a reminder is already set.

The map (`phase5-flow.jpg`) shows where each piece sits next to today's app and what follows each door.

## Decisions to confirm (Merge Agent)

- **Who sees the two doors.** They show once, to a cook with no recipes and no recordings yet. Existing cooks,
  including the TEST family's Mom and Grandma that Apple's reviewer signs in as, never see them, so the reviewer's
  path stays as the notes describe it. The flag is kept per profile on this phone, like the language screen.
- **Notification permission.** Today `lib/push.ts` never asks on a first launch, so neither the push (4) nor the
  reminder (7) could reach a new mom. Proposal: right after she taps an app in the share row, ask "Want a note when
  they pick a dish?" (PushAskSheet, exempt from the first-launch rule). The reminder asks for permission when she taps
  "Remind me". The push ask is shared with the "Notifications & linking" chat (Phase 4).
- **"We'll remind you Sunday"** could also tell Caleb ("Mom's filming it Sunday"). That needs a field on the ask from
  Convex & accounts. Without it, only she sees the confirmation.
- **The reminder** is local and weekly (expo-notifications `scheduleNotificationAsync`, a weekly trigger, no server).
  - Tapping it opens Record with the dish filled in ("Caleb asked for braised pork"), which wakes `record.tsx`'s
    dormant "asked for" line.
  - It stops once she films that dish.
  - Morning, Afternoon and Evening mean 9 am, 4 pm and 6 pm (a `TODO(caleb)` default).
- **Names, not roles.** Copy uses the kid's name ("Tell Caleb") and the cook's family name ("Mom's braised pork",
  "Aaji's…"), never "him", "son" or "Mom" as a role.
- **States to design during the build** (simple, in the same style):
  - Home after she answers;
  - the voice recipe failing (silent or noisy, "Try once more");
  - a request card with no photo.

## Fixes from the Merge Agent's approval (Oct 29)

- **No stock photo stands in for his dish or her recipe.** The ask card (5) and her recipe (9) use the kid's own
  photo when his ask has one. Otherwise they use a designed dish card: the dish name in Fraunces on a Hearth color,
  with the pot. Her recipe gets a real photo only once she films it.
- **Decoration photos are licensed, with credits on record.** All are Pexels, listed in
  `web/public/media/stock/credits.json`:
  - the mother and daughter (screens 1, 2): cottonbro studio;
  - the young man cooking at night (3b): Riccardo Vespa;
  - the steaming pot (4): Ana Zanuto;
  - the cook filming herself (9): Ron Lach.
  Never data/synthetic posters, and never a real family's photo.
- **Push copy:** "Caleb sent you a voice note. Tap to hear it." only when he sent one. Otherwise "See what Caleb
  guessed."

## Build notes

- **Gate:** `app/src/app/parent/_layout.tsx`, an early return after the language gate (the LanguageTiles pattern).
- **Sheet:** BottomSheet + `components/share/ExternalRow` (`omit: ['instagram']`), as AddFamilySheet does.
- **Voice note:** `lib/voice.ts` `useVoiceRecorder({ maxSeconds: 120 })` with the HelloCard pattern, behind
  `ensureAiConsent()` (an App Review guard path: the PR gets the per-guideline check).
- **Request:** a new route opened by the push (the "Notifications & linking" chat owns registering and handling
  pushes) and by the Home card.
- **Backend:** the Phase 5 routes (the craving link, the kid's ask, the 2-minute voice recipe) come from Convex &
  accounts. The screens run on stubs until then.
- **Words:** every string is a words key, in English plus drafts in the 12 other languages.

## /dish/[id]: the kid's card in the app (mockup, Oct 29; `dish-card.jpg`, canvas artboards 11–13)

The screen that ClaimLink and the "Mom answered" push open (V2-LINKING.md §2.6). It runs on `dishAsks.get` and
`dishAsks.forMe`, which Convex & accounts is adding.
- **11, the kid, waiting:** a designed dish card (never a stock photo), "Your braised pork", and a butter pill "Asked
  Mom · she's filming it Sunday" (the second half only when `filmingDay` is set). Then 1 serving · ~20 min · ~$3,
  "Your guess for tonight · Mom will fix it" with every amount marked "guess", and the steps. The kid side stays
  English.
- **12, the kid, after Mom answers:** "Mom's braised pork", and a sage pill "Mom answered" (plus her filming day).
  Her clip comes first, in her words ("Hear Mom · 0:12"). Ingredients she settled carry a "Mom" tag, and the
  rest stay "guess". Her tip sits under its step, with her clip.
- **13, Mom opens the same card** (in her language): "Your braised pork, for Caleb" / "Caleb can cook it tonight, in
  your words." Then the big green "Surprise Caleb: film it" (→ `/record` with the dish filled in) / "Caleb misses the
  sound of your voice.", what Caleb sees, and "See all of it".
- **Names:** "Mom" is the word the family calls her (`people.relation`). A kid who deleted their account reads as
  "Your kid" (a words key).

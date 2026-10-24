# Founder feedback, Oct 16 (round 3): debloat. Binding plan

Brand **homecookd**. Design bible `docs/design/hearth-bible/`, motion `docs/design/ANIMATIONS.md`,
earlier rounds `docs/build/FEEDBACK-OCT16.md` + `FEEDBACK-OCT16b.md`, API `docs/build/API.md`.

## Principles (Caleb, verbatim intent)
- **Clarity and structural intuitiveness come before cool features.** Less is more. Cut, cut, cut.
- Fewer words, more white space, especially on the parent side. The emptier the app feels, the better.
- Every tab is dedicated to its purpose. Remove any redundancy (the same thing in two places).
- Big, obvious buttons for the core actions (record, invite, send). Tap targets >= 48 pt.
- Every tap gives feedback (press scale/dim, haptic on primary actions, loading -> success states,
  a toast or burst when something is sent). Nothing silently does nothing.
- Never invent data: bind real data, hide what is empty.

## Everyone (parent + kid)
1. **Messages inbox = Instagram DM list.** One row per chat: round avatar (left), name, then one
   line of preview + " · time" (muted). **Unread**: name + preview bold/ink, small accent dot on the
   far right. Read: regular weight, muted preview. No chevrons, no pills, no dish subtitle line, no
   "Waiting" pill (a waiting question is just unread/bold). Generous row height, no hairline clutter.
2. **Voice notes show their transcript automatically**, under the voice bubble (like iMessage), no
   toggle.
3. **Recipes tab (kid and parent):** search bar at the very top (moved from kid Home); much more
   spacing between recipes and more white space overall; delete the count subtitle ("10 recipes from
   6 cooks") and the "Kept for Leo... and their kids someday" line.
4. **Cut "Just me / Friends"** on the recipe page (and its "Just me · ..." / "Cooking for friends"
   line on the ingredients screen, and the remembered choice). It changes nothing.
5. **Cook mode: all-steps overview.** Still one big step per page, but tapping the "Step 3 of 8"
   header opens a sheet listing every step (number + title, current one marked, done ones checked);
   tap one to jump there.
6. **Copy pass:** cut subtitles and helper lines everywhere (e.g. "No measuring, no typing. We'll
   write it down.").
7. **Pipeline:** make sure no step is left out when the AI turns the video into a recipe.

## Kid (tabs stay Home | Recipes | Ask)
8. **Kid Home** = greeting + avatar, the recommendation hero, a big **Invite family** button
   (invites anyone: `components/invite/InviteButton.tsx`), and at the bottom a plain
   **"Explore more dishes ›"** link (no dish images) that switches to the Recipes tab.
   Remove: search (moved to Recipes), the smart rows (Your favorites / Explore / Come back to it),
   "Hear their voices", the holiday card.
9. **Ask about a dish -> attachment.** "+ Ask about a dish" -> pick dish -> pick person (or The
   family) opens the normal chat with that person: the chat is about anything (no pinned
   "About Sunday Chili" header). The dish sits in the composer as an attachment card (thumb + title,
   removable). They type a question and send: the message carries the dish (recipe_id). In the chat
   that message shows the dish card with the text; tapping the card opens the recipe. A cook's reply
   to it must still save into the recipe as before.
10. **After "I made it"**: when the check lights up, offer to send the dish to a loved one:
    "Want to share the love?" with one big send button (family + people not on the app yet via the
    share sheet) and a quiet "Not now". Goal: more people on the app.

## Parent (tabs: Home | Messages | Recipes)
11. **Record is no longer a tab.** It is a screen opened from Home (`/record`).
12. **Parent Home, top to bottom:** (a) **Record a new recipe**: big, first thing on screen. (b) One
    compact **numbered updates card** replacing the big "Leo asked you" card and the "Leo made your
    ..." photo card: header with the total count ("3 updates"; "1 update"), the newest 3 rows, then
    "See all ›" (opens Messages) when there are more than 3. Question / request rows: avatar + "Leo
    asked about Sunday Chili" + the question on one line + a small mic **Answer** (spoken questions:
    a small play button). "Made it" rows: avatar + "Leo made your Sunday Chili" + small dish photo ->
    the recipe; only when someone actually cooked it (never "Leo has your ..." for a dish only sent).
    No updates: the card is gone. (c) A big **Invite family** button. Nothing else ("Send a recipe"
    and recordings-in-progress move to Recipes).
13. **Record screen:** the 3 steps stay; step 3 becomes "Cook like always, and explain out loud".
    Delete "No measuring, no typing. We'll write it down." Make "Use videos I already took" bigger
    and easier to notice.
14. **Your Recipes, top to bottom:** search; a big **Send a recipe** button (opens a sheet of all
    my recipes: tap to select one or more, then send to family members / anyone); recipes still
    processing as greyed rows with a spinner, a progress bar and roughly how long is left; then my
    recipes with more space between them.

## Lanes
Another session (branch `two-sided`) is rewriting sign-in and invites. Do NOT edit:
`app/src/lib/api.ts`, `lib/session.tsx`, `components/profiles/**`, `components/messages/MembersSheet.tsx`,
`app/src/app/index.tsx`, `app/src/app/join*.tsx`, `app/app.json`, anything in `web/`. The root
`app/src/app/_layout.tsx` gets exactly one added line (the `record` screen). Phone-number entry is on
hold.

# Kid profile taps — October 21, 2026

Neil said: "Clicking on profiles, but it doesn't work." The notes don't say which face he tapped or how
the test phone was signed in, so we checked every face a kid sees, on three kinds of phone:

- **own**: the kid's own phone (it signed in as Leo);
- **shared**: a family-code phone with no person of its own, Leo picked on it;
- **lent**: Caleb's phone, with Leo "cooking as" on it.

## What we found

1. **"You" on "This week at the table" did nothing.** The kid's own face looks exactly like Dad's and
   Mom's beside it, but it wasn't a button: no press, no haptic, nothing opened. Every phone.
2. **"Who's in the kitchen?" → Dad's face was a dead end or switched people.** Dad has his own phone,
   so his face opens a small sheet ("Dad uses their own phone."). That sheet acted as the phone's
   owner, not as the kid who opened it:
   - shared phone: no owner, so the sheet showed only the sentence. No recipes, no Message Dad.
   - lent phone: Message Dad (or one of Dad's dishes) quietly switched to Caleb, and Back landed on
     Caleb's parent Home.
   - own phone: worked (the owner is the kid).
3. **Family sheet rows** (the family chat's header, and "+N" on Home): each row's face and
   "Dad · 2 recipes" do nothing. Only the small "Message" pill works.
4. These faces aren't buttons either, but they read as labels, not as things to tap: the 1:1 chat
   header face, the recipe screen's small "by Dad" face, and the face beside "You can cook 4 of
   Grandma's 7" when a cook's chip is picked on Recipes.

Everything else worked: the other faces on the Home row open that person's chat, "Leo ▾" opens
"Who's in the kitchen?", "+N" opens the family list, and the hero card's "From Dad's kitchen" opens
the recipe.

## What we fixed

- **Dad's sheet acts as whoever is in.** Its recipes and Message Dad now come from the person who
  opened "Who's in the kitchen?" (Leo), and fall back to the phone's own person only when nobody is
  picked yet. Shared phone: the sheet shows Dad's recipes and Message Dad. Lent phone: Leo stays Leo,
  and Back lands on Leo's Home. Own phone: unchanged. (`components/profiles/PersonSheet.tsx`.)
  The Home row already opens chats as the current person on every kind of phone, so the server
  allows this.

Nothing new shows on screen: no new pills, icons or words.

## Not changed: "You" on the table row

"You" (point 1) is still just a face, as RETENTION-WIRING describes it. We don't know which face Neil
tapped, so changing it isn't tied to his report, and the same row is on the cook Home, which no kid
feedback covered. What the face row is for is section 3 of the feedback plan (mockups first).

## Decisions for Caleb (mockup phase)

- **Should your own face open "Who's in the kitchen?"** It looks like the faces beside it that open a
  chat, and it's what Neil and Dad (earlier QA) may have tried. Options: make it a button to the
  family gateway (as the "Leo ▾" pill is), scoped to the kid Home only, or make it look different
  from the tappable faces. Either one belongs in the face-row mockups. If it ships, update
  RETENTION-WIRING (the "not a button, like my own" line) and the `parent/home.tsx` header.
  Memorial faces stay never-buttons (guardrail 2).
- **Family sheet rows:** each row's face and "Dad · 2 recipes" do nothing; only the small pill works.
  Making the whole row do what its pill does (Message, or Send again), as the Ask sheet's rows
  already do, is a small change in `components/messages/MembersSheet.tsx`, but it's your call.
- Not fixed, by design of this pass: the label faces in point 4. Giving them a "this person's
  recipes" place is the people/profile navigation in section 3 of the feedback plan (mockups first).

## Repeatable check

Start Expo web, then from `app/` run:

```sh
node scripts/test-profile-navigation.mjs http://localhost:8095
```

It runs each of the three phones in its own browser session with a fake device key and answers every
API call from fixtures, so no real family data is read or written. Recipe photos may load from the
public bucket. It checks:

- own phone: "You" is still just a face; Dad's face opens his chat;
  Leo ▾ → Dad → Message Dad opens the chat as Leo and Back lands on Leo's Home; a failed open shows
  the error, frees the row, and a second tap works;
- shared phone: Dad's sheet has his recipes and Message Dad, which opens the chat as Leo, and Back
  lands on Leo's Home (with the old rule this step times out);
- lent phone: Message Dad opens the chat as Leo and Back lands on Leo's Home, still "Cooking as Leo";
  one of Dad's dishes opens in Leo's Recipes tab;
- no uncaught errors.

Screenshots go to `$SHOTS_DIR` (default `/tmp`) as `profile-*.png`.

## Still not verified

- **A real iPhone.** All of this ran on Expo web. Check Dad's sheet on a shared and a lent phone in
  Expo Go, then the sheet closing, Home, and the chat sliding in (about 0.6 s in all).
- **Which phone Neil used.** Ask Caleb how the test phone was signed in (its own, shared code, or
  Caleb's phone with the kid picked) and repeat Neil's taps on it.
- **Slow connections.** While a face's chat opens, the row dims with a spinner until the server
  answers. On a bad connection that can last up to about 20 s (a 10 s timeout and one retry), which
  could also feel like "it doesn't work". Not changed in this pass.

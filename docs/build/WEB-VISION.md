# homecookd on the web: the shared recipe page

Product name: **homecookd** (all lowercase, one word). Domain: https://homecookd.app
(`edible-psi.vercel.app` still works). The Vercel project is `homecookd`; live cloud names (Supabase project `edible`,
the `edible-*` buckets) are unchanged on purpose; old `edible:r:*` localStorage keys are moved to `homecookd:r:*` on read.

## Vision

Anyone with a link can cook from a family recipe on our own domain, with no account and no app.
Dad taps Share in homecookd, sends `https://homecookd.app/r?s=<token>` over iMessage or
WhatsApp, and whoever opens it gets a limited web version of the app: the same kid view, the same
Hearth design, Dad's words, his voice and his hands on video. Everything that needs a family (saving,
asking Dad a question, the rest of his kitchen, telling him you made it) opens a Spotify-style "Get the
app" popover. From there one short email sheet puts them in the sender's family circle, and they
sign in to homecookd on their phone with that email. The link is the shop window, and the sign-up
comes from the moment they want more.

## What is built (Oct 15)

Route `web/src/app/r/page.tsx` (static export; the token is read on the client), components in
`web/src/components/recipe-web/`, data and helpers in `web/src/lib/recipe-web/`.

- **Flow**: `GET {API}/shares/:token` -> `recipe_url` -> recipe JSON from the public bucket (plus
  `library.json` for "More from Dad's kitchen"). Missing, bad or revoked links get a warm error
  with a link to `/`; a network failure offers "Try again".
- **Screens** (client state, with `#ingredients` / `#step-N` in the URL so the phone's back button
  works): Recipe (bible Kid-Recipe), Ingredients (Kid-Ingredients: checklist saved per recipe in
  the browser, "N of M", a "Not sure how much?" dropdown for the amounts nobody measured), Steps
  (Kid-Step / Kid-Step-Open: segmented progress, the step's clip plays inline and stops at the end of
  its range, Watch / Hear pills, one "More from Dad" dropdown with his words, "In this step",
  "Look for", stories and what made it special). Samples show "Sample recipe, no video".
- **Watch / Hear**: HTML video and audio with start/end ranges (one player at a time). Watch on the
  recipe opens the whole video full-column; Hear shows a floating card with the cook's words as the
  subtitle, scrolling along with the clip.
- **Chrome**: Spotify-web top bar, 52 px (pot + lowercase "homecookd", white "Get the app" pill); on
  the recipe screen the 380 px hero runs under it with the bar frosted and see-through, turning solid
  once the photo scrolls away. If a recipe's Watch/Hear pills would land right against the floating
  "Start cooking", the hero gives up to 64 px so they sit 28 px clear; otherwise the page scrolls under
  the dock's fade. Watch/Hear pill labels never truncate: full label, then 1 px smaller, then without
  the time ("Hear Miles"). Also "<Sender> sent you
  this recipe" on the hero (when the link has a sender), the app's floating tab bar (Home | Recipes
  | Ask, Recipes active). Locked actions open the popover with words for what was tapped.
- **Sign-up** (Oct 16, FEEDBACK-OCT16 A1, the app's email flow): Get App -> bottom sheet "Join
  Dad's family circle", one Email field -> `POST {API}/auth/email {email}`. A known email is
  already in a family: straight to success. A new one (`needs_name`) shows "Your name" ->
  `POST /auth/email {email, name, role: 'learner', share_token}`, which joins the **sender's family**
  as a new learner (not a new family). SuccessBurst "You're in <family name>." + "Open homecookd on
  your phone and sign in with <email>." The family code sits behind a small "Use a family code
  instead" disclosure (with Copy). Errors: 403 "This link is full. Ask Dad for a new one.", 429,
  400 email, 409 name taken (the API's words), network ("Try again"). The button keeps its full
  green fill with a cream spinner while it works. The result is kept in that browser only, so
  reopening the sheet shows it again. Emails are not verified yet (see the TODO in API.md).
- **Motion** (docs/design/ANIMATIONS.md): press scale 0.96, sheet spring, success burst, popover
  pop-in, staggered rise on the recipe, screen cross-fades. Reduced motion falls back to fades.
- **Meta**: `noindex, nofollow`, generic OG "A family recipe on homecookd", not linked from the lander.
- **Dev aid**: on localhost only, `/r?fixture=<recipe-id>[&from=none]` reads that recipe from the
  bucket with a pretend sender and a mocked `/auth/email` (no writes). The email's first part picks
  the answer: `known@`, `full@` (403 on join), `taken@` (409 on join), `busy@` (429), `bad@` (400),
  `offline@`, `server@`; anything else is a new email that joins.

## What's next

1. **Per-recipe link previews**: a serverless OG route (`/r/og?s=`) that renders the dish photo,
   name and "from Dad's kitchen", so the iMessage bubble sells the click. Needs a non-static route
   (Vercel function) alongside the export.
2. **Deep link into the installed app**: universal links on `homecookd.app` (or the app's URL scheme)
   with an "Open in homecookd" pill when the app is installed.
3. **App Store / TestFlight link** in the sheet once there is a public build, instead of "open
   homecookd on your phone".
4. **Verify the email**: send a one-time code (or magic link) before a new device gets a family's
   code; today the typed email is trusted (API.md TODO).
5. **Approval to join**: let the sender (or a cook) approve a newcomer instead of any link holder
   joining directly (capped at 5 per link today).
6. **Analytics**: opens per share (the API already counts them), Watch/Hear plays, popover taps and
   sign-up conversion, to learn which locked action makes people want the app.

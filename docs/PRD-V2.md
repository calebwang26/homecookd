# homecookd v2 PRD

Started 2026-10-29 by Caleb, for the launch that markets to both customers: homesick kids and parent cooks. This is
the guideline for the next version of the app. Every new screen, flow and UI/UX decision is built around the user
pathway below, from how someone first discovers homecookd to becoming a loyal user. When older docs disagree
(`docs/PRD.md`, `docs/build/SPEC.md`, the bible's flows), this wins.

**Status (Oct 29):** Phase 1 (the Convex backend) is approved and being built, with local commits only until Apple
approves. The other phases wait on mockups and the decisions still open in section 5.

## 1. The user pathway, with Caleb's build notes (Oct 29)

Caleb's words. His notes on where each part gets built are marked **Build:**.

### Kids

* Discover through UGC that sells the feeling: the dish only your mom knows, & you can make a version of it tonight
  (very cheap, very simple).
* Click the link in the UGC bio or video. It's hosted on our website to reduce friction & takes them straight to the
  sticky product.
* They type in whatever dish they're really craving from home, add photos & voice notes if they have them, &
  instantly get the tonight version. **Build:** on the web. We have an existing MVP; improve it so it meets all of
  these requirements.
  * It's built on estimates. We don't know exactly which ingredients or methods mom actually uses.
  * The sticky product suggests the kid ask a parent or grandparent to fill in the missing gaps.
  * If the kid taps "Ask Mom," a message opens that's written in the kid's voice & editable, e.g. "Mom how do you make
    your tomato egg? I'm trying to make it here." The kid can add a short voice note ("Mom, I miss your tomato egg").
  * Save recipe works like a Twitter bookmark: "Saved to your recipe box. Get it on your phone," with one download
    ask & two reasons (keep it, & know when Mom answers).
* The parent receives the link. Parents are way more motivated to act because they miss their kids more.

### Parent opens the kid's link

* Hear the kid's voice note → see his guess, shown openly as his guess ("Caleb thinks it's 1 tbsp ketchup & no
  sugar") so she wants to correct it → answer the questions by voice → the recipe fills in with her words (slow,
  satisfying animation) → "Sent to Caleb." **Build:** not built at all yet. On the web, for lower friction.
* Download pop-up, shown after the "Sent" moment:
  * Headline: "Surprise your kid by filming a video." It's more accurate, your kid misses the sound of your voice, &
    you cook it in a way no one else can replicate. Capture that on video. This leads because it's the strongest
    emotional pull & the only reason that genuinely needs the app.
  * Two short supporting lines underneath:
    * Save this recipe so it never gets lost. It's a little piece of connection you share with your kid.
    * Keep being part of your kid's cooking life. We just connected you over one dish; download to keep doing it.
      The web is limited to one recipe.
  * **Build:** all of it on the web page: the download pop-ups, the messaging, everything.

### Parents (cold, from Facebook)

* Discover through UGC on Facebook with messaging hyper-targeted to their kids missing their cooking & generational
  recipes dying.
* Click the link → install the app. The first screen gives two options:
  * "Ask your kids what they're craving." This is the main path: mom sends it to her son, & they're connected through
    the app. **Build:** in the app: the pop-up that sends the kid the "what are you craving" link, its messaging, the
    UI/UX, and the backend for where it leads.
  * "Start recording now," for parents who are already at the stove. **Build:** in the app.
* The kid names a dish on the web, with no install needed. **Build:** this is the sticky feature; see the kid
  pathway for what's left.
* Mom gets a push: "Caleb wants your braised pork." **Build:** these notifications, in the app.
* Record: "Next time you make it, tap record," with a reminder she sets ("I make it on Sundays"). There's a fallback,
  "Tell him how you make it now" (a 2-minute voice version), so the kid gets something tonight & the video becomes
  the upgrade.
* The kid gets the recipe & is asked to download to keep it.
* Hypothesis: filming takes much more activation energy, but once their kid asks for a specific dish, parents will
  put in the time. **Build:** all of this, in the app and on the web, for kid and parent.

## 2. What this changes (for whoever builds the next screen)

- **The kid starts on the web, not the app.** The first product a kid touches is a page on homecookd.app: name a
  dish, get tonight's version from estimates, no install. The app comes later, through "Save" and "know when Mom
  answers".
- **The kid's request is the hook for the parent.** A specific ask from her own kid ("Caleb wants your braised pork")
  is what gets a parent to act. Show the kid's guess openly as a guess, so she wants to correct it.
- **The parent's first contribution is by voice, on the web.** She answers a few questions and the recipe fills in
  with her words. Filming is the upgrade, sold right after "Sent to Caleb".
- **One download ask at a time, after the emotional moment,** with at most one headline and two reasons.
- **The web gives one recipe; the app keeps the connection going.**
- **Cold parents get two doors:** ask your kids what they're craving (main), or start recording now. Recording has
  a reminder ("I make it on Sundays") and a 2-minute voice fallback, so the kid gets something tonight.
- **Earlier decisions this overrides:** the Oct 16 cut of the "Ask Mom" creative bet (`docs/agents/memory/
  dual-icp-playbook.md`). Ask Mom is now the core of the kid path. Homie's voice is off for launch (Oct 29); the
  parent's voice answers here are her own voice recordings, not a talk with homie.

## 3. What exists today (found Oct 29)

| Pathway step | Today | Where |
|---|---|---|
| Kid names a dish, gets a guessed recipe | **Built, never shipped.** "The dish I miss" MVP, `/miss`: dish + relation + optional photo / screenshot / voice note, a card in ~5 s, "~" on guessed amounts, "Ask Mom" tags on gaps, 3 suggested questions. "Tonight's version" (1 serving, ~20 min, ~$3, dorm kitchen) is in the prompt. Cards saved in the browser only. | calebwang26/homecookd PR #40 (branch `feat/dish-i-miss`, Oct 23, open); spec `docs/build/DISH-I-MISS-SPEC.md` on that branch |
| Ask Mom message | **Partly.** Web share sheet (Copy, Messages, Instagram, WhatsApp, More) sends the link + questions. No editable message in the kid's voice, no kid voice note to Mom. | PR #40 `web/src/components/miss/share/AskSheet.tsx` |
| Save + download ask (kid) | **Not built.** | — |
| Mom's page: voice note, the kid's guess, voice answers, recipe fills in, "Sent" | **Partly.** `/a`: one "Hold to talk" per question, no app or account; her answers merge into "Mom's version" with her clips. No kid voice note, no "Caleb thinks…" framing, no fill-in animation, no "Sent to Caleb" moment. | PR #40 `web/src/components/mom/` |
| Mom's download pop-up | **Not built.** The web has a generic Get-the-app handoff (copies the link, opens the App Store). | `web/src/components/invite/Handoff.tsx` |
| Backend for the above | A separate Supabase edge function `miss` (anonymous tokens, IP limits, a 500-a-day cap). Claude Haiku writes; **Gemini** transcribes. Never deployed. | PR #40 `supabase/functions/miss/` |
| App first screen with two doors | **Not built.** Today: sign in → name → role (Record / Learn) → language → parent Home. | `app/src/app/join.tsx`, `parent/_layout.tsx` |
| "What are you craving?" link from the app | **Not built.** The share-sheet pieces exist (`components/share/ExternalRow.tsx`, `shareLink.ts`: Messages, Copy, WhatsApp, More). Family invites are one-use and join the family. | app |
| Kid requests a specific dish | **Half-built, dormant.** Message kind `request` ("Will you teach me your X?"), and `/record` already shows "Leo asked for Sunday eggs" and pre-fills the dish, but nothing sends a request. | `lib/messaging.ts` `request()`, `record.tsx` |
| Push "Caleb wants your braised pork" | **Not built.** All app pushes come from frozen Supabase (`notify()`, `push_tokens`). Convex sends no pushes. | `supabase/functions/api/plumbing.ts` |
| Recording reminder ("I make it on Sundays") | **Not built.** No scheduled notifications anywhere; expo-notifications is installed. | `app/src/lib/push.ts` |
| 2-minute voice fallback → recipe | **Not built.** Voice notes record and upload; Convex transcribes with Cartesia, but nothing turns a voice note into a recipe. The MVP's "Mom's version" merge is the closest. | `convex/transcribe.ts`, PR #40 merge |
| Filming | **Built.** Record → phone camera / videos I took → send. Homie's voice is being turned off. | `app/src/app/record.tsx`, `recording.tsx`, `send.tsx` |

Also true today:
- homecookd.app deploys from **calebwang26/homecookd**, not this repo; `web/` here is a byte-identical copy.
- Nothing in Convex can be called without a signed-in session, except the dinner-invite opener. There's no rate
  limiter in Convex, and no upload path for someone without an account.
- App universal links cover only `/i`, `/r` and `/d`; a new link path needs an AASA entry and an app route.

## 4. Build plan (draft, waiting on section 5)

### The idea in one line
Ship PR #40's web pages, upgraded to this pathway, on a Convex backend. Then connect web and app with links that
carry a token, and pushes from Convex.

### Phase 0: decisions and mockups (before any code)
- Caleb answers section 5.
- Mockups (big UI changes get mockups first): kid web flow (dish → tonight's version → Ask Mom message → Saved),
  Mom's web flow (voice note → "Caleb thinks…" → answer by voice → fill-in → Sent → download pop-up), the app's
  first screen with two doors and the craving-link sheet, and "Caleb wants your braised pork" → record / tell him now.

### Phase 1: one backend for the web flow (Convex & accounts)
New, additive Convex code; no change to today's sign-in.
- **`dishAsks` table** (name to settle): the dish, the kid's display name and relation, the guess (ingredients with
  `estimate` + `isGuess`, steps, tonight's servings / time / cost), photos and the kid's voice note (Convex
  storage), the editable Ask Mom message, a kid token and an ask token (stored hashed, like dinner invites), Mom's
  answers (voice + transcript + translation), "Mom's version", status, and an optional family / person once
  someone signs in. Added to the account-deletion purge.
- **Public HTTP routes** with capability tokens, the pattern `convex/lib/inviteRoutes.ts` already uses: make a card,
  get / update a card, upload URL for a photo or voice note (type + size checked before it's attached), send the
  ask, Mom peeks / answers / finishes.
- **A rate limiter** (per IP and a daily budget) and the word filter `convex/lib/moderation.ts` on every text
  someone else will see; the dish name goes into the prompt as data, like `lib/yesNo.ts`.
- **Models:** Claude for the card and Mom's version (port PR #40's prompts, `convex/lib/textModel.ts`);
  **Cartesia Ink** for voice (`inkTranscribeWithKeys` in `convex/transcribe.ts`) instead of the MVP's Gemini.

### Phase 2: the kid's web flow (App Store, web & builds)
Port PR #40's `/miss` onto current main and the Phase 1 routes, then add what the pathway asks for:
- tonight's version front and center, with every guessed amount shown as a guess;
- **Ask Mom** opens a message in the kid's voice that they can edit, plus a short voice note;
- **Save** works like a bookmark: "Saved to your recipe box. Get it on your phone", one download ask, two reasons
  (keep it, know when Mom answers);
- the UGC landing goes straight into the dish box; no lander in between.

### Phase 3: Mom's web flow (App Store, web & builds)
Upgrade PR #40's `/a`:
- the kid's voice note plays first;
- the guess shown as his guess ("Caleb thinks it's 1 tbsp ketchup & no sugar");
- she answers each question by voice; the recipe fills in with her words, slowly (see `docs/design/ANIMATIONS.md`);
- **"Sent to Caleb"**, then the download pop-up: "Surprise your kid by filming a video", plus the two lines
  (save it so it never gets lost; keep being part of his cooking life, the web is limited to one recipe).

### Phase 4: web ↔ app links and pushes (Convex & accounts + App screens & recording)
- **Push from Convex:** a push-token table in Convex, the app registers its token there too, and Convex calls the
  Expo push API. Events: "Mom answered" (kid), "Caleb wants your braised pork" (parent), the recording reminder.
- **Claim on install:** a kid or Mom who installs from a web page lands in the app with their card. Reuse the web's
  existing copy-the-link handoff and the app's Paste invite, plus `homecookd://` links; new paths get AASA entries
  and app routes. Mom claiming her kid's ask connects them as a family.

### Phase 5: cold parents in the app (App screens & recording, with Convex & accounts)
- **First screen, two doors**, shown once after the language pick, before Home (a gate in
  `app/src/app/parent/_layout.tsx`, the way the language screen works): "Ask your kids what they're craving"
  (main) and "Start recording now" (→ `/record`).
- **Craving link sheet:** a message in her voice ("What do you miss from home? Tell me and I'll make it for you")
  sent with the existing share row; the link opens the kid's web flow already tied to her family.
- **The kid names a dish → Mom gets the push** "Caleb wants your braised pork", which opens a request screen. Wake
  the dormant request pieces (`request()` and `/record`'s "Leo asked for…").
- **Record:** "Next time you make it, tap record", with a reminder she sets (a weekly local notification: "I make it
  on Sundays"), or **"Tell him how you make it now"**: a 2-minute voice note that becomes a recipe in her words
  (transcribe, then the same Claude step as Mom's version). The kid gets it tonight; the video upgrades it later.
- **The kid gets the recipe** on the web and is asked to download to keep it.

### Phase 6: measure the funnel
Events on every step (UGC click → card → Ask Mom sent → Mom opened → answered → install, both sides). The web
already beacons to `/web-events`.

### Who owns what
| Part | Chat |
|---|---|
| Convex tables, public routes, limiter, models, push | Convex & accounts |
| Card and "Mom's version" prompts | Pipeline & recipes (reviews the prompt; Convex & accounts wires it) |
| `/miss`, `/a`, download pop-ups, AASA | App Store, web & builds |
| First screen, craving sheet, request screen, reminder, voice fallback, claim-on-install | App screens & recording |
| Merging, shipping, the tracker | Merge Agent |

Phases 1–3 can run side by side once the route contract is written down (one short spec file, like
`DISH-I-MISS-SPEC.md`). Phase 4 needs 1–3. Phase 5 needs 4.

## 5. Decisions

**Decided (Caleb, Oct 29):**
- **Backend: Convex** ("sounds good, go for it"). Phase 1 is approved: port PR #40's logic to Convex, with Cartesia for
  voice, not Gemini.
- **One repo:** Caleb switched the Vercel project "homecookd" to build `web/` from this repo. A push to main ships
  homecookd.app.
- **A kid without the app** learns Mom answered by downloading it ("know when Mom answers"). A web-only kid sees her
  answer when they reopen their link.
- **Until Apple approves the App Store submission:** nothing is pushed to GitHub and nothing deploys to production.
  Work is committed locally and goes up in order after approval.
- **Unlimited recipes on the web; keeping them needs the app.** "they should be able to generate infinite recipes. but
  in order to actually access them and save them, they need to download the app." No web recipe box: Save is the
  download ask. A card's own link still shows that card and Mom's answer.
- **Budget:** $10 a day of model spend for the web flow (a dollar cap, not a card count), plus the per-IP limits.
- **Keep data forever** for now (cards, answers, photos, voice notes). Uploads never attached to a card are cleaned up.
- **Privacy and App Review text:** updated after Apple approves the current submission, before this launches.
- **Testing during the review:** a separate native build (build 7) on its own `staging` update channel, internal
  TestFlight testers only, not attached to the version in review. EAS Updates go to `staging`, never production,
  until Apple approves.
- **Answered before the overnight build (Oct 29):**
  - If Apple approves, ship homie-off and the queued fixes; v2 stays off the live site and app until Caleb tests it.
  - Build 7 goes to App Store Connect tonight (internal testers only).
  - The UGC link is homecookd.app/miss.
  - Live AI test spend overnight: $25 across all chats.
  - The Supabase sign-in function may change and deploy after Apple approves (deploy rules apply; check Salik).
  - Installing from the other person's link joins the family automatically.
  - Mom's answers show her own words with the English underneath, plus her clip.
  - Download buttons point at the real App Store page (apps.apple.com/app/id6825621614).
  - The Merge Agent approves v2 mockups against this PRD; Caleb reviews the finished flows on build 7 and the web.
  - Phase 4 has its own section chat, "Notifications & linking".

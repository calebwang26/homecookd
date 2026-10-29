# v2 linking and pushes (Phase 4)

The design for `docs/PRD-V2.md` §4 Phase 4: connecting the web flows to the app. Owner: the **Notifications &
linking** chat. Status (Oct 29): design, waiting on the Merge Agent. Built on local commits only until Apple approves.

It builds on Phase 1's contract (`docs/build/DISH-ASK-SPEC.md`, branch `claude/dish-ask`): the `dishAsks` card, its
kid token (`/miss?k=…`) and ask token (`/a?t=…`), and the `familyId?` / `personId?` fields reserved for this phase.

## 0. In one minute

- **Pushes move to Convex for v2 events.** Convex gets a push-token table, the app registers its token there as well
  as with Supabase, and a Convex sender calls the Expo push API with the same rules as Supabase's `notify()`. Events:
  "Mom answered" (kid), "Caleb wants your braised pork" (parent), "Caleb is here" (the other side, when someone joins),
  "Mom filmed it" (kid). Supabase keeps sending today's pushes; nothing moves out of it.
- **A card that belongs to a family is an invite to that family.** Whoever installs second joins the first person's
  family automatically, with no Apple sign-in: Convex signs a short-lived *join ticket*, and one new Supabase route,
  `POST /auth/link`, turns it into a device key, the way a family invite does today. Whoever installs first, with no
  family to join, signs in with Apple or Google as today, and the card joins their new family.
- **The link gets into the app** by the web's existing copy-then-App-Store handoff and the app's Paste button, by
  `homecookd://` links, and by a universal link for the kid's card. Mom's `/a` link stays web-only (she answers there).
- **The only Supabase change** is the new `/auth/link` route plus a shared secret. It deploys after Apple approves.
  Until then the app falls back to "new family" so everything else can be tested.
- **Deleting an account** removes that person's push tokens at once, and the purge removes their cards (kid) or their
  answers (Mom).

## 1. Pushes from Convex

### 1.1 Tables (`convex/schema.ts`)

**`pushTokens`**: one row per phone token.
- `token` (an `ExponentPushToken[…]`, checked by the same pattern Supabase uses), `personId`, `familyId`,
  `platform` (`ios` | `android`), `tz` (IANA zone, for quiet hours), `updatedAt`.
- Indexes `by_token`, `by_personId`.

**`pushLog`**: one row per push we decided to send (or skip), for dedupe, caps and debugging.
- `personId`, `kind`, `dedupeKey`, `status` (`queued` | `sent` | `failed` | `none` | `capped`), `sendAt`,
  `ticketIds?`, `error?`, `createdAt`.
- Indexes `by_personId_and_dedupeKey`, `by_personId_and_createdAt`, `by_createdAt` (a daily cron drops rows older
  than 40 days, the same lookback Supabase uses for caps).

### 1.2 Registering a token (app)

- `app/src/lib/push.ts` `syncRegistration` already runs once someone is signed in. It also calls Convex
  `push.register({ sessionToken, token, platform, tz })`. Convex upserts by token and moves it to the caller, as
  Supabase's `POST /push-tokens` does. At most 5 tokens per person; the oldest goes.
- Sign-out (`leaveFamily` in `session.tsx`) calls `push.unregister({ sessionToken, token })` before `sessions.end`,
  next to today's Supabase `remove`. Neither is awaited.
- Nothing changes about *when* the app asks for permission: only after its own explainer sheet, never on first launch.
  Two new moments to ask, with a fresh reason (App screens & recording builds the sheets, with `askOsAndRegister`):
  - the kid, right after their card lands in the app: "Want a note when Mom answers?";
  - the parent, right after she sends the craving link: "Want a note when he tells you?".

### 1.3 Sending (`convex/push.ts`, `convex/lib/push.ts`)

1. **`queuePush(ctx, { personId, kind, title, body, url, dedupeKey })`**, a helper any mutation calls. In the same
   transaction it checks the person isn't deleted, the dedupe key is new for them, and the caps and quiet hours. It
   writes the `pushLog` row (before sending, as Supabase does, so a failed or capped push still uses its key) and
   schedules delivery at `sendAt`. Convex mutations are transactions, so two at once can't both pass the dedupe.
2. **`push.deliver`** (internal action) reads the person's tokens and posts to `https://exp.host/--/api/v2/push/send`
   in batches of 100, with a 5 s timeout. The message is Supabase's: `sound: "default"`, `priority: "high"`,
   `channelId: "default"`, `data: { url, kind, profile_id }`. `profile_id` is the person's `supabaseProfileId`, so the
   app's `PushBridge` picks the right person on a shared phone with no change.
3. Tickets with `DeviceNotRegistered` delete that token at once. Then **`push.receipts`** runs 15 minutes later on the
   ticket ids (`/--/api/v2/push/getReceipts`) and deletes any token Expo reports there. This is the part Supabase's
   `notify()` leaves as a TODO; most dead tokens show up only in receipts.
4. Nothing retries a failed send, as in Supabase.

**Rules, ported from `plumbing.ts`:**

| Rule | Supabase `notify()` | Convex |
|---|---|---|
| Who gets nothing | removed or memorial profiles | deleted people (`people.deletedAt`) |
| Dedupe | `(profile_id, dedupe_key)` unique | the same, checked in the mutation |
| Caps | only app-initiated pushes (1/day and 3/week for a kid, 1/month for a cook) | none of v2's events is app-initiated, so no caps, except the two below |
| Quiet hours | 21:00–08:00 on the recipient's clock, app-initiated only | the same hours; only `craving` waits for 08:00 (below) |
| Time zone | `profiles.tz`, default `America/Los_Angeles` | `pushTokens.tz` from the phone, the same default |

Two extra guards, because a craving comes from an anonymous web page, not from a family member in the app:
- **`craving` waits out quiet hours** (it's sent at 08:00 her time, not dropped) and **at most 3 a day** reach one
  parent. More cards still show on her request screen; only the push is skipped (`capped`).
- **At most 20 pushes a day to one person**, all kinds together, as a flood guard.

**Expo access token:** not needed. Supabase's secrets have no `EXPO_ACCESS_TOKEN` (checked Oct 29), so the Expo
project (`ef88fb83…`, owner `salikm1234`) doesn't use enhanced push security, and today's pushes go without one.
Convex reads an optional `EXPO_ACCESS_TOKEN` and sends it as `Authorization: Bearer` if it's ever set (then it goes in
Supabase secrets too). **No morning item for Caleb.**

### 1.4 Events

| Kind | To | When | Title / body (English for v1) | Opens | Dedupe key | Who adds the `queuePush` call |
|---|---|---|---|---|---|---|
| `answered` | the kid (`dishAsks.personId`) | Mom's version lands, or her clips go to the kid without one; also when her "tell him now" voice note becomes the card's version (Phase 5) | "Mom answered" / "Her tomato egg, in her words. Tap to hear her." (the relation: Grandma, Dad…) | `/dish/<id>` | `answered:<cardId>:<finishedAt>` | Convex & accounts, in the merge-done mutation (`dishAsks.ts`) |
| `craving` | the parent who sent the craving link (`dishAsks.cookId`) | a kid makes a card from her craving link (Phase 5) | "Caleb wants your braised pork" / "Tell him how you make it." ("Your kid" when there's no name) | `/request/<id>` | `craving:<cardId>` | Convex & accounts, in the Phase 5 route that makes the card |
| `joined` | the person on the card's other side | someone claims a card in the same family (§2.5) | "Caleb is on homecookd" / "You're in the same kitchen now." (to the kid: "Mom joined your kitchen") | `/dish/<id>` | `joined:<cardId>:<side>` | Notifications & linking (`links.claim`) |
| `filmed` | the kid | a recipe is published from a recording Mom made for that card | "Mom filmed her braised pork" / "Watch her make it." | `/recipe/<recipeId>` | `filmed:<recipeId>` | Convex & accounts, in `worker.published`, when the job carries the card (Phase 5 passes `dishAskId` from the request screen to the job) |

- Words for these live in one file, `convex/lib/pushWords.ts`. A web-only kid has no person, so they get no push and
  see Mom's answer when they reopen their link (Caleb, Oct 29).
- Not in v1: a push when Mom opens the link, and localized push words (English only for now; the cook's language is a
  follow-up). Convex's in-app questions (voice cooking) send no push today either; that's a separate follow-up.
- The weekly "I make it on Sundays" reminder is a local notification owned by App screens & recording.

## 2. Claim on install

### 2.1 The links

| Link | Who holds it | Opens the app? |
|---|---|---|
| `https://homecookd.app/miss?k=<kidToken>` | the kid (their card) | yes: universal link (AASA), `homecookd://miss?k=…`, or pasted |
| `https://homecookd.app/a?t=<askToken>` | Mom (the kid's ask) | not as a universal link (she answers on the web); `homecookd://a?t=…` or pasted after "Sent" |
| `https://homecookd.app/miss?c=<cravingToken>` | the kid (a cold parent's craving link, Phase 5) | no: the kid names the dish on the web. The card it makes has a `k` link like any other |

### 2.2 Getting the link into the app

iOS loses a link across an App Store install, and there's no deferred deep-link SDK. So, as `/i` and `/r` do today:

- **Web (App Store, web & builds):** the kid's "Save" pop-up and Mom's pop-up after "Sent" copy the link inside the
  tap (`web/src/lib/app-links.ts`, which writes `text/uri-list` on iPhone), then open
  `https://apps.apple.com/app/id6825621614`. The kid's copies `/miss?k=…`; Mom's copies `/a?t=…`. A secondary "Open
  homecookd" link uses `homecookd://miss?k=…` or `homecookd://a?t=…` for someone who already has the app.
- **App:** the sign-in screen's Paste row (`PasteInvite.tsx`) already notices a link with `hasUrlAsync` (no prompt)
  and pastes it with the native iOS paste button (no prompt either). `parseInviteInput` (`lib/auth/links.ts`) learns
  two more links, `/miss?k=` and `/a?t=` (full links only, never a bare 22-character token, so nothing is mistaken
  for an invite token), and routes them to `/miss?k=…` and `/a?t=…`.
- **AASA (`web/public/.well-known/apple-app-site-association`):** add one component:
  `{ "/": "/miss", "?": { "k": "?*" }, "comment": "A kid's dish card" }`. The plain UGC link `/miss` and craving links
  `/miss?c=…` keep opening the web, since only a `k` matches. `/a` gets no entry: Mom with the app installed should
  still land on the web page to answer by voice. No app rebuild: the app already claims `applinks:homecookd.app`.
- **App routes:** `app/src/app/miss.tsx` and `app/src/app/a.tsx` (flat, query params, like `i.tsx` and `r.tsx`), both
  added to `SIGNED_OUT_ROUTES` in `_layout.tsx`.

### 2.3 The rule: a card with a family is an invite

The card's `familyId` is set by whoever gets there first in the app:
- the kid claims their card (kid token) → the kid's family;
- Mom claims the ask (ask token) → Mom's family;
- a craving link made it → the parent's family, from the start.

Whoever comes second, new to homecookd, joins that family: the kid as a kid (`learner`), the ask-token holder as a
cook. That covers every order:

| Journey | First in the app | Second | Result |
|---|---|---|---|
| Kid saves (installs), then Mom answers on the web and installs | kid: Apple sign-in, new family, card joins it | Mom: `/a` link → join ticket → kid's family, as a cook | one family |
| Kid stays on the web; Mom answers and installs | Mom: Apple sign-in, new family, card joins it | kid later installs from their card → Mom's family | one family |
| Cold parent sends the craving link; kid names a dish | parent (already in the app; the card is born in her family) | kid installs from their card → parent's family | one family |

Each side of a card is claimed once: one kid, one cook. A forwarded ask link that Mom already used opens the card
with "This one's already with Mom" and joins nobody.

### 2.4 The join ticket and Supabase `/auth/link`

Membership lives in Supabase (`convex/sessions.ts` reads `GET /family` with the device key), so joining a family has
to happen there. Supabase can't look inside Convex, so Convex vouches for the join with a signed ticket:

- **Ticket:** `base64url(payload) + "." + base64url(HMAC-SHA256(LINK_JOIN_SECRET, base64url(payload)))`, with payload
  `{ v: 1, fam: <supabaseFamilyId>, role: "learner" | "cook", name: <prefill or null>, exp: <now + 10 min>, jti: <16
  random base62> }`. Made by `convex/lib/joinTicket.ts`, checked by `supabase/functions/api/link.ts`.
- **`POST /auth/link { ticket, name?, device_label? }`** → `{ device_key, profile_id, family_name }`, rate-limited per
  IP like `/invites/accept` (20 in 10 minutes).
  1. The signature (constant-time compare) and `exp` must hold; the family must exist.
  2. `jti` must be new: the join is logged in `signups` with `share_token = "link:<jti>"`, and a ticket already there
     gives `409`. No migration (the column is free text; `email` is `""`).
  3. `name` (the app's edit, else the ticket's) is checked like every name. If it matches an invited profile with the
     same role, that profile is claimed (`canClaim`, as `joinByShare` does); otherwise a new profile is added with the
     ticket's role. The ticket decides the role; the app can't change it.
  4. A device is created (`via: "invite"`, the same kind a family invite makes, so no enum change), the profile's
     invites are revoked, and the family gets the usual quiet note ("Mom joined from Caleb's link").
- **No sign-in with Apple for the second person**, the same as accepting a family invite today. The link is the
  invite. The first person in a family still signs in with Apple or Google (`startFamily` needs an identity).
- **Secret:** `LINK_JOIN_SECRET` (32 random bytes, base64url) in the root `.env`, Convex env and Supabase secrets.
  The Convex dev deployment gets it now; grand-dragon-649 and Supabase get it with the deploys after Apple approves.
  If the `.env` Supabase token can't write secrets, that one step is Caleb's.
- **Before `/auth/link` is deployed** (any 404 from it, or no secret in Convex): the app falls back to the first-person
  path, Apple sign-in and a new family, and the claim still links the card to the person (§2.6). So the whole flow
  except the family join is testable during the freeze.

Why not the alternatives:
- **Pre-made Supabase invites stored in Convex:** they'd need no Supabase change, but they expire after 14 days, are
  one-use (a craving link can bring several kids), and must be minted by an app that happens to be open. They'd also
  put a second family credential in Convex.
- **Supabase calling Convex at sign-in:** this adds a network hop and a Convex outage to every link sign-in, for the
  same result as a ticket.

### 2.5 Convex: `/link/open` and `links.claim`

**`POST /link/open { token }`** (HTTP, public, `convex/lib/linkRoutes.ts`)
- Same CORS and error shape as the `/dish/` routes. The app's fetch sends no `Origin`.
- Rate limits use Phase 1's `lib/rateLimit.ts`: 30 per IP in 10 minutes, plus its bad-token limit.
- Finds the card by kid token, else by ask token. Returns:
  `{ side: "kid" | "cook", dish, kidName, relation, familyName | null, taken: boolean, ticket: string | null, language: string | null }`.
- `ticket` is set only when the card has a family, that side isn't claimed yet, and `LINK_JOIN_SECRET` is set.
  `language` is the Ink code Mom answered in, so the app can pre-pick her cook language.
- It changes nothing, so opening the link twice is harmless.

**`links.claim({ sessionToken, token })`** (mutation, signed in) → `{ dishAskId, side, sameFamily, taken }`
- **Kid token:** sets `personId` to the caller, unless another live person already holds it (`taken`).
- **Ask token:** sets `cookId` to the caller, with the same check. It also fills `people.relation` ("Mom") when unset.
- **The card's family:** it sets `familyId` to the caller's family when unset. A different family is left alone (§2.7).
- **The other side:** when the other side's person is in the same family, it queues `joined` for them.
- **Idempotent:** claiming a card you already hold returns it again.

### 2.6 The app flow (`miss.tsx`, `a.tsx`, `lib/live/links.ts`)

Both screens run the same steps. While they run, they show the dish ("Caleb's tomato egg") on a calm loading card.
There's no confirm tap (Caleb, Oct 29).

1. `POST /link/open`. An unknown token shows "This link doesn't work anymore." with a way home.
2. **Signed in, with someone picked:** `links.claim` → replace to `/dish/<id>`. `taken` shows the card's owner instead.
3. **Signed out, with a `ticket`:** `joinByLink(ticket, name)` in `session.tsx` posts `/auth/link`, then goes through
   today's `adopt()`. The new person is the only one on the device, so they're picked. Then the Convex session,
   `links.claim`, and `/dish/<id>`.
   - **Name:** the kid's comes from their card, and the name step shows only when the card has none. Mom's is the
     relation label ("Mom"), which she can change later.
   - **Language:** `language` pre-picks Mom's cook language.
4. **Signed out, no ticket** (the card has no family yet, or `/auth/link` isn't live):
   - `/join?claim=<path>&name=<kidName>&role=learner|cook`. `join.tsx` treats `claim` the way it treats `s`: the role
     step is skipped and the name is prefilled.
   - Apple or Google sign-in starts a family. `enter()` calls `openAfterPick(<path>)`, and the link opens again,
     signed in, at step 2.
5. Then the push ask from §1.2 ("Want a note when Mom answers?").

`/dish/[id]` (the card in the app: the guess, Mom's version with her clips, and for Mom "Surprise Caleb: film it" →
`/record`) and `/request/[id]` (Phase 5) are App screens & recording's screens, on Convex queries Convex & accounts
adds (`dishAsks.forMe`, `dishAsks.get`).

### 2.7 Someone who already has a family

No one is ever moved out of a family automatically. Auto-join is for people new to homecookd.
- A signed-in kid or Mom whose family differs from the card's still claims their side. The card shows in their app
  and the pushes reach them (both go by `personId` / `cookId`, not by family), but the two families stay separate.
- `/i`'s existing "Join X instead?" move flow is the manual way to merge, unchanged.
- Signed out with an old Apple account: the screen joins by ticket by default. An "I already have an account" link
  goes to Apple sign-in, which lands in their old family, as above.

## 3. Data and deletion

**What gets linked where (Convex):**
- **`dishAsks`** (Convex & accounts' table) gets the fields this phase fills:
  - `familyId?`, the join target;
  - `personId?`, the kid in the app;
  - `cookId?`, Mom in the app, or the parent who sent the craving link;
  - `cravingId?`, set by Phase 5.
  - Indexes: `by_family`, `by_person` (already in the spec), plus `by_cook`.
- **`pushTokens`** and **`pushLog`**: this phase's tables (§1.1).
- **Supabase:** only the profile, device and `signups` row a link join makes, the same rows an invite join makes
  today.

**Account deletion (`convex/account.ts`):**
- **In `deleteMe`, at once:** delete the person's `pushTokens`, so nothing reaches a deleted account even before the
  purge runs.
- **New purge steps** (batched like the others; Convex & accounts writes the dish steps, Notifications & linking the
  push step):
  - `pushLog` rows for the person.
  - **Cards where they're the kid (`personId`):**
    - The card is the kid's ask. When a live Mom holds it (`cookId`), it stays for her, minus the kid's own parts:
      `kidName`, the kid's voice note and photos go, and `personId` is cleared.
    - Otherwise the card is deleted with its answers and files.
  - **Cards where they're the cook (`cookId`):**
    - Her voice is hers: her `dishAnswers` with their clips and her `version` are deleted, and `cookId` is cleared.
    - The card goes back to `asked`, so the kid can ask again.
  - **Their craving links:** deleted. Cards already made from them stay with the kids, with `cookId` cleared.
  - `familyId` alone never deletes anything. One person leaving doesn't delete a family.
- **Supabase:** `/profiles/:id/remove` already revokes devices. Link-joined people are ordinary profiles. No change.
- **Web-only data:** cards nobody claimed keep Phase 1's rule (kept forever for now). Covering them in /privacy is
  the post-approval legal update (PRD §5).

## 4. Who builds what

Proposed split. Each chat edits its own section. Shared files take a small, separate block from each writer.

| Piece | Files | Chat |
|---|---|---|
| Push tables, register, sender, receipts, words, prune cron | `convex/push.ts`, `convex/lib/push.ts`, `convex/lib/pushWords.ts`, `schema.ts` (two tables, own block), `crons.ts` (one line) | **Notifications & linking** |
| Join ticket, `/link/open`, `links.claim`, `joined` push | `convex/links.ts`, `convex/lib/joinTicket.ts`, `convex/lib/linkRoutes.ts`, `http.ts` (one line) | **Notifications & linking** |
| Push token deletion in `deleteMe` + `pushLog` purge step | `convex/account.ts` (own lines) | **Notifications & linking** (Convex & accounts reviews) |
| Supabase `/auth/link` + deno tests | `supabase/functions/api/link.ts` (new), one route line in `index.ts`, `supabase/tests/link_test.ts` | **Notifications & linking** writes it, Convex & accounts reviews (it owns frozen `supabase/`); deploy after Apple approves |
| `dishAsks` link fields + `by_cook`, `dishAsks.forMe` / `get`, dish purge steps, `queuePush` calls for `answered`, `craving`, `filmed`, `cravingLinks` | `convex/schema.ts`, `convex/dishAsks.ts`, Phase 5 files, `convex/worker.ts`, `convex/account.ts` | **Convex & accounts** |
| App: register with Convex, unregister, link parsing, claim client, `joinByLink`, `/miss` + `/a` route screens, `join.tsx` `claim` param, `SIGNED_OUT_ROUTES` | `app/src/lib/push.ts`, `lib/auth/links.ts`, `lib/live/links.ts` (new), `lib/session.tsx` (`joinByLink`, unregister), `lib/api.ts` (`authLink`), `app/src/app/miss.tsx`, `a.tsx`, `join.tsx`, `_layout.tsx` (one line) | **Notifications & linking** (the two route screens use existing sign-in pieces; App screens & recording may restyle them) |
| `/dish/[id]`, `/request/[id]`, the two push-permission asks, Mom's language pre-pick, the Sunday reminder | screens, `components/` | **App screens & recording** |
| AASA entry, the two pop-ups' copy-then-App-Store handoff and "Open homecookd" links | `web/public/.well-known/apple-app-site-association`, `web/src/components/miss/`, `mom/` | **App Store, web & builds** |
| App Review check + reviewer notes for the new link join | handoff doc, PR text | **App Store, web & builds**, with the facts from §6 |

**Order:**
1. Convex & accounts lands Phase 1's `dishAsks` with the link fields.
2. In parallel, I build push, links and `/auth/link` against a stub card table in the tests, and the app pieces.
3. The `queuePush` calls go in once both exist.
4. Web and AASA land with Phases 2–3.
5. After Apple approves, deploy in order (Merge Agent): Convex, then Supabase `/auth/link` (check Salik first), then
   web with the AASA. The app parts go out as an EAS Update to `staging`, since no native change is needed
   (expo-clipboard's paste button, expo-notifications and the associated domain are all in today's builds).

## 5. Tests

**Automated (each runs without the network):**
- **Convex (`npx vitest run`, `npx tsc -p convex --noEmit`):**
  - `convex/push.test.ts`, with Expo stubbed by `stubFetch`:
    - register moves a token between people, keeps at most 5 per person, and unregister drops it;
    - dedupe holds;
    - `craving` waits until 08:00 in the person's zone, and stops at 3 a day;
    - the 20-a-day guard holds;
    - a deleted person gets nothing;
    - batches of 100;
    - `DeviceNotRegistered` from a ticket, and from a receipt, deletes the token;
    - `profile_id` is in `data`.
  - `convex/links.test.ts`:
    - the ticket round-trips and refuses a bad signature or an old one;
    - `/link/open` gives a ticket only with a family, an open side and the secret;
    - `taken` holds;
    - claim sets `familyId`, `personId` and `cookId` and is idempotent;
    - a different family is left alone;
    - `joined` is queued once.
  - `account.test.ts` additions: tokens are gone right after `deleteMe`, and the purge drops the push log.
- **Supabase (`npx --yes deno@2 test … supabase/tests/`):** `link_test.ts` covers the signature, expiry, a reused `jti`
  (409), the role coming from the ticket, claiming an invited profile, and a missing family. The check from
  `deno check` also covers `link.ts`. The same HMAC vectors are shared with the Convex test, so both sides agree.
- **App (`npx tsc --noEmit && npx expo lint`, plus a new `node scripts/test-links.mjs`):**
  - `parseInviteInput` takes `/miss?k=` and `/a?t=` (https, www, `homecookd://`, inside pasted text) and refuses
    other hosts and bare 22-character tokens;
  - the claim screen's pure decision function (claim / join by ticket / sign in first / dead link) covers every row of
    §2.3 and §2.7.
  - Today's `test-signin.mjs` and `test-consent.mjs` still pass.

**On the iOS Simulator (no deploys needed, against a `npx convex dev` deployment):**
- `xcrun simctl openurl booted "homecookd://miss?k=<token>"` and `"homecookd://a?t=<token>"` open the claim screens.
  The signed-in claim and the "no family yet → sign in first" path run end to end.
- **Install handoff:** delete the app, `xcrun simctl pbcopy booted` the card link, reinstall, and tap Paste on the
  sign-in screen.
- **Push taps:** `xcrun simctl push booted com.salik.homecookd payload.json` with the URL and `profile_id` in the
  payload's `body` (where Expo puts `data`). This checks that `/dish/<id>`, `/request/<id>` and `/recipe/<id>` open
  the right screen, cold and warm.
- **What the simulator can't do:** get a real Expo push token (`push.ts` skips registration off a real device), or use
  the universal link before the new AASA is live on homecookd.app.

**On a real iPhone (build 7 on `staging`, after the deploys):**
- A real push from Convex through Expo and APNs, for each event. A dead token is cleaned after the app is deleted.
- The universal link `/miss?k=…` from Messages opens the card.
- The full install journeys of §2.3 with two phones and TestFlight installs, including the automatic family join
  through `/auth/link`, in the TEST family only.

## 6. App Review guard

The app and Supabase changes touch the sign-in path, so the PR that ships them carries the per-guideline check. Here
are the facts it rests on:
- **4.8 (Login services):** Sign in with Apple stays wherever Google is offered. The link join uses no third-party
  login at all, the same as accepting a family invite today.
- **5.1.1(v) (Account deletion):** a link-joined person is an ordinary profile, and "Delete my account" works for them
  unchanged. Deletion also removes their push tokens and their cards or answers (§3).
- **5.1.1 (Data minimization):** a link join stores only a name and a role. No new personal data is asked for.
- **5.1.2(i) (AI consent):** the claim sends nothing to an AI service. The existing consent sheet still guards the AI
  features after sign-in.
- **2.1 (Reviewer access):** the reviewer's path (the TEST family code) is untouched.
- **Reviewer notes:** add one line saying links from homecookd.app can add someone to a family with no sign-in, like
  family invites.

## 7. Open questions

1. **Push words in the cook's language.** v1 sends English. Mom's push ("Caleb wants your braised pork") reads better
   in Marathi or Hindi for many cooks. Is it a follow-up, or in scope now? My default is a follow-up.
2. **`/a` as a universal link later.** That only makes sense once the app has its own "answer by voice" screen. Until
   then, Mom always answers on the web.
3. **Family merges** (§2.7) stay manual. Is that OK for launch? Auto-merging two existing families would need a
   decision from Caleb about whose recipes and people go where.

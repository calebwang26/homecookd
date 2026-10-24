# Two-sided build, Oct 16 (round 3): binding plan

Brand **homecookd** (always lowercase). Builds on `docs/build/SPEC.md`, `docs/build/API.md`,
`docs/build/FEEDBACK-OCT16.md` (section E: lander perf guardrails) and `FEEDBACK-OCT16b.md`. The
app's look is the design bible `docs/design/hearth-bible/` (renders in `renders/*.png`), motion
is `docs/design/ANIMATIONS.md`, and the app's UI kit is `app/src/components/ui/**`.

> CLAUDE.md is the original hackathon brief. Its "Do NOT build" list (auth, accounts, sharing,
> backend server) is superseded by SPEC.md and these founder decisions. Build what this file says.

Caleb's standing rules:
- "Prioritize quality."
- "Keep cutting words; the less wordy, the better."
- The people are parents in their 50s–60s who aren't techy, and their homesick college-age kids.
- Use big type, one obvious action per screen, tap targets of 48 pt or more, and plain words.
- Never invent facts. Bind real data.

**Who does what.** This session (app integration) builds Problems 1, 2 and 5 plus the backend. The
"Lander messaging and ICP targeting" session builds Problems 3 and 4 (the lander) on its own branch
`lander-two-sided`.

**Hands off.** Do not edit any of these:
- `web/src/app/{page.tsx,lander.tsx,layout.tsx,teach,learn}`
- `web/src/content/**`
- `web/src/components/{sections,chrome,providers,chooser}/**`

## The founder's decisions (in his words where it matters)

1. **Sign-in has to be as easy as possible, and free (no Twilio, no texted codes, no email screen).**
   There are three ways in, in this order:
   1. **Invite link.** Someone in the family sends a link from their own iMessage. Tap it, tap
      Join, and you're in.
   2. **Sign in with Apple.** One Face ID tap.
   3. **Sign in with Google.** For Android, or anyone without an Apple ID.

   "Have a family code?" stays as a small backup link. **Each phone gets its own key**, so the
   family code stops being a secret everyone shares. A new person only types their name. The
   role comes from how they arrived:
   - an invite carries the role;
   - a recipe share link means a learner;
   - with neither, ask "What do you want to do first? Record a dish / Learn a dish".
2. **Invite family through iMessage.** Mom taps "+ Add family", picks Dad from her contacts and
   picks cook or learner. Messages opens with the text and link filled in, and she taps send
   (it goes from her own number, so it's free). Dad taps the link, whenever he gets to it, then
   taps **Join**, and he's in as Dad.
   - **The link dies after that one use.** Opening it again says "Already used. Ask Mom for a
     new one."
   - Caleb cancelled the "Dad joined, is that him?" confirmation for Mom: "trust that whoever
     opens the link is the one signing in".
   - Passive safety only, with nothing for anyone to answer:
     - the link expires in 14 days;
     - only a real tap joins (opening or previewing the page never does);
     - a quiet "Dad joined." note goes into the family chat;
     - anyone can be removed from the members list, which signs their phone out.
   - **Dad doesn't have the app yet:** the link's web page shows a "Get the app" button. After
     he installs, he taps **Paste invite** on the first screen and he's in. The web page copies
     the link when he taps "Get the app", and also shows a 6-letter invite code he can type.
3. **(Lander, other session)** Routing by how visitors arrived. My links to the lander carry
   `?aud=`:
   - the /r page links to `/learn?aud=kid&from=app`;
   - an /i invite for a cook links to `/teach?aud=parent&from=app`;
   - an /i invite for a learner links to `/learn?aud=kid&from=app`.

   The backend gives the lander a logging endpoint (`POST /events`, below).
4. **(Lander, other session)** No gate; the parent page is the default; a hero switch; 50/50
   copy; the headline "Record it once. They'll cook it forever."
5. **The research we're copying** (this is how every screen here should feel):
   - **No gates.** The first screen does the job; the other path is one small button away
     (Greenlight, Storyworth, Life360).
   - **The invite page is the second side's landing page.** It names the person who sent it and
     asks for one tap (Partiful, Calendly, ClassDojo).
   - **The less techy side never needs a password or setup.** One tap from a text (Remento,
     Skylight).
   - **The invite sets the role.** Never ask "which one are you?" when the link already knows
     (Remind, ClassDojo).
   - **Invites go through the sender's own Messages.** iMessage disables links from unknown
     senders, so a link from Mom works and a text from a company may not.
   - **Creative bets are cut** ("Ask Mom", setup-for-Mom, no-app recording, holiday asks). The
     first testers are trusted friends and family, and the test is whether they download and use
     the app.

---------------------------------------------------------------------------------------------------
## A. Backend (owner: backend team) — `supabase/functions/api/index.ts`, `supabase/migrations/**`, `docs/build/API.md`

Keep every existing endpoint working. The pipeline, the web /r page and old TestFlight builds use
them: `x-family-code` auth, `POST /auth/email`, `POST /signup`, shares.

### A1. Migration `supabase/migrations/20261017000000_two_sided.sql`
RLS on for every new table, with no policies (same model as the rest).

- **`devices`**:
  `id uuid pk default gen_random_uuid()`,
  `family_id uuid not null → families on delete cascade`,
  `profile_id uuid null → profiles on delete set null` (who signed in on it; null for a legacy
  family-code exchange),
  `key_hash text not null unique` (sha256 hex of the device key),
  `label text` ("iPhone", "Android", "Web"),
  `via text not null check in ('invite','apple','google','code','share')`,
  `created_at`, `last_seen_at timestamptz default now()`, `revoked_at timestamptz null`.
  Indexes on family_id and profile_id.
- **`identities`**: `provider text check in ('apple','google')`, `subject text`,
  `profile_id uuid not null → profiles on delete cascade`, `email text null`, `created_at`,
  `primary key (provider, subject)`, index on profile_id.
- **`invites`**:
  `id uuid pk`, `family_id → families cascade`, `inviter_id → profiles set null`,
  `profile_id uuid not null → profiles cascade` (the person invited; their profile exists from
  the moment of inviting, so their face shows up right away),
  `token_hash text not null unique`, `code_hash text not null unique`,
  `phone text null` (digits from the picked contact, for display only and never used to send
  anything),
  `status text not null default 'pending' check in ('pending','used','revoked')`,
  `expires_at timestamptz not null`, `used_at`,
  `used_device_id → devices on delete set null`, `created_at`.
  Index on family_id and profile_id.
- **`profiles.removed_at timestamptz null`**: soft removal.
- **`lander_events`**:
  `id bigint generated always as identity pk`,
  `event text check in ('land','switch')`, `aud text check in ('parent','kid')`,
  `signal text null check in ('aud','saved','snapchat','link','default','switch')`,
  `app text null`, `utm_source text null`, `utm_campaign text null`, `path text null`,
  `created_at`.
  **No IP, no user agent string.**

### A2. Auth
- New header **`x-device-key`**. Add it to the CORS allowed headers.
- `authenticate()`:
  - if `x-device-key` is present: look up sha256 in `devices` where `revoked_at is null`. A
    match sets the family. Bump `last_seen_at`, throttled to once per 10 min and best effort.
    No match → **401 "This phone was signed out."** (exact text; the app keys on it). Rate-limit
    bad keys like bad codes.
  - else fall back to `x-family-code`, unchanged.
- The device key is 32 random bytes, base64url (43 characters). It is returned once and never
  stored in plain text.
- Removed profiles (`removed_at` not null):
  - they are left out of `ctx.profiles`, `GET /family`, the circle members and the
    `/questions/open` askers;
  - they are rejected as `x-profile-id` (403);
  - **their old messages still render with their name and face** (keep a lookup that includes
    removed profiles for message senders and recipe-note authors).
- `GET /family` adds:
  - `device_profile_id` (the device's own profile, or null);
  - on each profile, `invited: boolean`: true when the profile has a pending, unexpired invite
    and has never signed in (no identity, no live device).
- `POST /devices` (auth by family code or device key) → `{ device_key }` with `via:'code'` and
  `profile_id` null, label from the body. The app uses it once to swap a saved family code for
  its own key.

### A3. Sign in with Apple / Google (public, rate-limited per IP: 30 per 10 min)
`POST /auth/apple` and `POST /auth/google` take
`{ id_token, name?, role?, share_token?, device_label? }`.

**Verify with `npm:jose`** (`createRemoteJWKSet` + `jwtVerify`, with the JWKS cached in module
scope):
- **Apple:** iss `https://appleid.apple.com`; JWKS `https://appleid.apple.com/auth/keys`; `aud`
  must be in `APPLE_AUDIENCES`. That is an env var (comma-separated) defaulting to
  `host.exp.Exponent` (Expo Go) plus the app's bundle id once known. Add a constant with
  `TODO(caleb)`: the bundle id isn't in the repo yet.
- **Google:** iss `accounts.google.com` or `https://accounts.google.com`; JWKS
  `https://www.googleapis.com/oauth2/v3/certs`; `aud` in `GOOGLE_CLIENT_IDS` (env,
  comma-separated). If that env is empty → **503 "Google sign-in isn't set up yet."**
- Reject expired tokens. Use `sub` as the identity key and store `email` if present.

**Outcomes:**
- **Known identity on a live profile:** create a device for that family and profile
  (`via` = provider). Post "<Name> signed in on a new phone" in the circle, as the email flow
  does. Return
  `{ existing:true, needs_name:false, joined:false, device_key, family_name, profile_id }`.
- **Unknown identity with no `name`:** return
  `{ existing:false, needs_name:true, suggested_name }` (Google `given_name` if present). The app
  then asks for a name, and a role when there's no share token, and calls again with the same
  `id_token`.
- **Unknown identity with `name` and a valid `share_token`:** join the share's family as a new
  profile, role `learner` unless given. Mirror the existing email logic:
  - claim a same-name profile with no identity and no live device;
  - respect `MAX_JOINS_PER_LINK`;
  - post the "joined from <sender>'s link" note;
  - link the identity and create the device.
- **Unknown identity with `name`, no token:** `role` is required. Create a family "<Name>'s
  family" with this profile, link the identity and create the device.
- A known identity whose profile was removed counts as unknown: unlink it first.

### A4. Invites
- **`POST /invites`** (auth + me). Takes `{ name, role, phone? }` to invite someone new (creates
  the profile, with the same name rules and MAX_PROFILES as POST /profiles), or `{ profile_id }`
  to re-invite someone not yet joined. A re-invite revokes their older pending invites.
  Returns `{ invite: { id, url, code, expires_at, profile_id }, profile }`.
  - `url = ${WEB_URL}/i?t=<token>&c=<code>`; the token is 16 base62 characters. The code
    rides along in the link so the web /i page can show "Or type this code in the app". It gives
    no more access than the token already in the link. The server keeps only hashes, so the
    link is the only place the code appears after creation.
  - `code` is 6 characters from `CODE_ALPHABET`.
  - Expiry is 14 days.
  - Store only hashes. Rate limit: 50 invites per family per day.
- **`POST /invites/peek`** (public, rate-limited 60 per 10 min per IP; **no side effects**). Takes
  `{ token }` or `{ code }`. Returns
  `{ status: 'pending'|'used'|'expired'|'revoked', family_name, inviter: {name, relation, avatar_key}|null, invitee: {name, role, avatar_key}, expires_at }`.
  Unknown → **404 "That invite link doesn't work."**
- **`POST /invites/accept`** (public, rate-limited 20 per 10 min per IP, plus a bad-token
  limiter). Takes `{ token | code, device_label? }`.
  - Flip `pending → used` **atomically**: one conditional UPDATE … WHERE status='pending' AND
    expires_at > now() RETURNING. Then create the device for `invite.profile_id`
    (`via:'invite'`), set `used_device_id`, and post "<Name> joined." in the circle.
  - Returns `{ device_key, family_name, profile_id }`.
  - Already used, revoked or expired → **410** with `{ error, status }`, where error is
    "This invite was already used." / "This invite expired." / "This invite was turned off.".
- **`POST /profiles/:id/remove`** (auth + me):
  - you can't remove yourself (400);
  - set `removed_at`, revoke that profile's devices, revoke its pending invites, delete its
    identities;
  - post no circle note;
  - return `{ ok:true }`.

### A5. `POST /web-events` (public; for the lander session)
> **Not `/events`.** That path is the app's authenticated recipe view/cook event (`on("POST", "/events")`).
> Public routes are matched first, so a public `/events` would swallow the app's calls.
- Optional `host` (≤ 60 chars; the page's `location.hostname`, so preview and test traffic can be
  filtered). Add a `host text null` column to `lander_events`.
- Takes a JSON body, as `application/json` **or `text/plain`** (sendBeacon).
- Fields:
  - `event` ∈ land|switch;
  - `aud` ∈ parent|kid;
  - `signal` ∈ aud|saved|snapchat|link|default|switch (optional);
  - `app`, `utm_source`, `utm_campaign`, `path`: optional strings of at most 100 characters;
  - `ui`: optional, at most 20 characters ('hero' | 'footer' on switch events). Add a
    `ui text null` column to `lander_events`.
- Invalid → 400. Success → **204**. Rate limit: 120 per 10 min per IP.
- Store nothing about the person.

### A6. Docs and checks
- Update `docs/build/API.md`: auth header, every new route with request and response, error
  texts, and the security model (device keys, single-use invites, removal). Keep the email TODO
  note accurate: the app no longer uses email, but old builds and the endpoint remain.
- Run `npx --yes deno@2 check supabase/functions/api/index.ts` if it works. Add pure-function
  tests where cheap.
- The orchestrator deploys and runs live tests on the **TEST family only**. The code is in
  `docs/build/.test-family-code`. **Never print it, and never write to "Our family".**

---------------------------------------------------------------------------------------------------
## B. App (owners: app core, app screens, app family teams)

New packages are already installed: `expo-apple-authentication`, `expo-contacts`, `expo-sms`,
`@react-native-google-signin/google-signin`. **Expo Go must never crash.** The Google module is
not in Expo Go, so require it lazily, inside try/catch, behind a check that it's available, and
hide the button when it's missing. Apple works in Expo Go on iOS.

### B1. App core (`lib/api.ts`, `lib/session.tsx`, `lib/auth/**`, `app.json` / new `app.config.ts`)
- **`api.ts`:**
  - `setApiAuth({ deviceKey?, code?, profileId? })`. Send `x-device-key` when set, else
    `x-family-code`.
  - Typed methods: `authApple`, `authGoogle`, `devices` (exchange), `createInvite`,
    `invitePeek`, `inviteAccept`, `removeProfile`.
  - Profile gains `invited?: boolean`. Family responses gain `device_profile_id?`.
- **`session.tsx`:**
  - Store the device key in SecureStore (`deviceKey`).
  - Boot: device key → `GET /family`. Else a legacy saved family code → `POST /devices` to get a
    key, save it and **delete the saved code**.
  - Expose `signInWithApple()`, `signInWithGoogle()` (each returns ok, needsName with a
    suggested name, or an error), `finishSignIn({ name, role })`, `acceptInvite(tokenOrCode)`,
    and `joinFamily(code)` (the code backup, also swapped for a device key).
  - Remove `signInWithEmail` from the app.
  - A 401 "This phone was signed out." clears the key and the cache and goes to `needs-code`
    with the error "You were signed out of <Family>." (or the server sentence).
- **`lib/auth/apple.ts`, `lib/auth/google.ts`:** isAvailable() plus a sign-in that returns
  `{ idToken, name? }`.
  - Apple uses `expo-apple-authentication` with FULL_NAME scope. iOS only; on web and Android
    it's unavailable.
  - Google uses `GoogleSignin.configure({ webClientId: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, iosClientId: EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID })`.
    It's unavailable when those are empty or the native module is missing.
- **`app.config.ts`** (reads app.json) adds:
  - `ios.usesAppleSignIn: true`;
  - `ios.associatedDomains: ["applinks:homecookd.app", "applinks:www.homecookd.app"]`;
  - the `expo-apple-authentication` plugin;
  - **the Google plugin only when `GOOGLE_IOS_URL_SCHEME` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
    is set.** The bare entry `expo install` just added to app.json breaks prebuild; move it.

  Leave `ios.bundleIdentifier` out with `TODO(caleb)`: it isn't in the repo, and the TestFlight
  build was made elsewhere.

### B2. App screens (`app/src/app/{join,join-code,i,r}.tsx`, `_layout.tsx`, `components/signin/**`)
- **`join.tsx`** is the first screen, in the bible "Main" look (peach wash, the pot + homecookd
  row, one Fraunces line of 6 words or fewer):
  - **Continue with Apple:** the official `AppleAuthenticationButton`, CONTINUE type, BLACK
    style, ~56 pt tall, full width.
  - **Continue with Google:** Google's branding (white, the G mark, "Continue with Google").
  - **Paste invite:** expo-clipboard's `ClipboardPasteButton` (iOS 16+, no paste prompt) with a
    short line like "Got an invite link?". Where that's unavailable, show "Have an invite
    code?", which opens one 6-letter field.
  - A small "Have a family code?" link.
- **After Apple/Google for a new person:**
  - "What does your family call you?", prefilled from Apple's full name or Google's suggestion;
  - then, only without a share token, two big cards: "Record a dish" (cook) / "Learn a dish"
    (learner);
  - then Continue → Profiles.
- **`/join?s=<share>`** keeps working: Apple/Google sign-in joins that share's family.
- **Paste or typed code** accepts: `https://(www.)homecookd.app/i?t=…`, `homecookd://i?t=…`,
  `…/r?s=…`, a bare 16-character token or a 6-letter code.
  - It routes to `/i?t=`, `/i?c=` or `/join?s=`. When a pasted link has both `t` and `c`,
    `t` wins.
  - Garbage gets "That doesn't look like a homecookd invite."
- **`i.tsx`** (deep link `homecookd://i?t=`, universal link `https://homecookd.app/i?t=`; also
  `?c=` for a code):
  - peek, then a big card: the inviter's face, **"Join Mom's family table?"**, "You're joining as
    Dad." and one big **Join** button;
  - Join → accept → save the key → set me to that profile → that person's home (once; later
    opens show Profiles as always);
  - used, expired or turned off → the server's sentence plus "Ask Mom for a new one." and a
    button back to the first screen;
  - not found / offline: a warm sentence plus retry;
  - already signed in to the same family → "You're already in." → Profiles;
  - signed in to another family → "Join Mom's family table instead?" with Join / Not now.
- **`r.tsx`** (universal link for `/r?s=`): signed in → open the shared recipe if it's in the
  library, else `/send`-style handling or Profiles. Signed out → `/join?s=`.
- **`_layout.tsx`:** `/i` and `/r` are open routes (the needs-code guard must not bounce them);
  add their Stack screens.

### B3. App family (`components/profiles/AddFamilySheet.tsx`, `components/profiles/**` status, `components/messages/MembersSheet.tsx`, new `lib/invites.ts`)
- **"+ Add family" becomes the invite flow:**
  1. **"Choose from contacts"** (expo-contacts system picker; no contacts permission is needed
     for the picker on iOS) fills the name (the given name or nickname) and the phone (the
     mobile/iPhone number first). A typed name works too.
  2. Cooks / Learns (the existing `SegmentedChoice`).
  3. **"Send invite"** → `POST /invites` → `expo-sms` `sendSMSAsync([phone?], text)`.
     - Text: `"<Name>, join our family table on homecookd: <url>"`.
     - If SMS isn't available: the system Share sheet with the same text.
     - Then show "Invite sent to Dad." plus "They tap the link to join." and a small "Copy link".
     - Cancelled → stay, with the invite still valid.

  The new face shows on "Who's in the kitchen?" right away.
- **Reusable from other screens.** Another session is adding an "Add your child to the family"
  button on parent Home and an invite button on kid Home, and both will open this same flow.
  So:
  - export `AddFamilySheet` from `components/profiles` with props
    `{ visible, onClose, initialRole?: Role }` (it must work outside the Profiles screen);
  - `lib/invites.ts` exports at least
    `sendInvite(input: { name: string; role: Role; phone?: string | null } | { profileId: string }): Promise<{ status: 'sent' | 'cancelled' | 'shared' | 'error'; url?: string; error?: string }>`,
    which creates the invite and opens Messages (or the share sheet);
  - document both in the file headers.
- **Profiles tile** for `invited` people: the status line reads "Invited".
- **MembersSheet:**
  - invited people show "Invited" with **Send again** (a re-invite: `POST /invites {profile_id}`,
    then Messages again);
  - everyone except me gets a small, clear **Remove** that opens an in-sheet confirm, "Remove
    Dad? Their phone will be signed out." with Remove / Keep;
  - after removal, refresh the session.
- Remove the email field and the email copy from AddFamilySheet. Keep the library-cook
  suggestion ("Auntie Lin") if it still fits the invite flow.

### B4. App rules
- **Visual and motion:**
  - follow the bible renders and `components/ui` (ActionButton, BottomSheet, SegmentedChoice,
    Txt, PressableScale, ScreenWash);
  - Reanimated springs need `mass: 1`;
  - no scale pops on icons (the fuzzy-heart bug).
- **Words:** a screen has one headline and at most one short line.
- **Accessibility:** accessibility labels on every button, and every error sentence says what to
  do.
- **Safety:** never log or show device keys, family codes or id tokens.
- **Typed routes:** `experiments.typedRoutes` is on. New routes need the generated types; run
  what regenerates them, or cast narrowly with a comment.
- **Checks:**
  - `cd app && npx tsc --noEmit && npm run lint && node scripts/test-recommend.mjs`;
  - screenshots through `node scripts/shot.mjs` (Expo web). Apple and Google don't run on web,
    so render clear stand-ins on web only.

---------------------------------------------------------------------------------------------------
## C. Web handoff (owner: web handoff team) — `web/src/app/i/**`, `web/src/components/invite/**`, `web/src/components/recipe-web/**`, `web/src/lib/recipe-web/**`, new `web/src/lib/app-links.ts`, `web/public/.well-known/**`, `web/vercel.json`

- **`/i?t=<token>` page** (static export; reads `t` on the client):
  - peek → "Join Mom's family table on homecookd", the inviter's face, "You're joining as Dad.";
  - **Get the app**: copies the invite URL to the clipboard inside the click handler, then
    opens the store link;
  - **Open homecookd**: `homecookd://i?t=…`. A universal link never fires from inside the same
    domain, so use the scheme;
  - "Or type this code in the app: K7QM2X";
  - used, expired, turned off or not found: the server's sentence plus "Ask Mom for a new one.";
  - desktop: "Open this link on your phone." plus the code;
  - a small "What's homecookd?" link → `/teach?aud=parent&from=app` for cook invites,
    `/learn?aud=kid&from=app` for learner invites.
  - **Static OG tags** (iMessage previews don't run JS): title "You're invited to a family
    table", a short description, and the existing og image.
  - Look: the homecookd app's warm look, as the /r page already uses. Reuse recipe-web
    primitives where it's natural.
  - Never call accept from the web: joining happens in the app.
- **`/r` "Get the app"** (SignupSheet): replace the email sign-up with the app handoff, because
  the app no longer has email sign-in:
  - "Join <Family> on homecookd" with Get the app (copy the /r URL, then the store) and Open
    homecookd (`homecookd://r?s=…`);
  - "Already have it? Open homecookd and tap Paste invite.";
  - any lander link → `/learn?aud=kid&from=app`, as a **plain `<a href>`, never `next/link`**.
    Soft navigation into the lander leaves its lazily mounted sections blank, because the
    deferred-slot registry and head scripts don't re-run. Today `RecipeWebApp.tsx` (two links)
    and `StatusScreens.tsx` (one) link to "/" with next/link; change all three. The same rule
    applies to the /i page's "What's homecookd?" link.
- **`web/src/lib/app-links.ts`:** `APP_STORE_URL` from `NEXT_PUBLIC_APP_STORE_URL` (a public
  TestFlight or App Store link, `TODO(caleb)`), plus `appSchemeUrl()`. With no store URL, "Get
  the app" says plainly that homecookd is in early testing and asks them to message the person
  who invited them. Don't invent a link.
- **AASA** at `web/public/.well-known/apple-app-site-association` (no extension):
  - `applinks.details[0].appIDs: ["TEAMID.BUNDLEID"]` as a placeholder with `TODO(caleb)`;
  - `components` for `/i`, `/i/*`, `/r`, `/r/*` only. **Never claim `/`, `/learn`, `/teach`
    or `*`**: otherwise iPhones with the app installed would skip the lander;
  - plus `webcredentials`;
  - `vercel.json` header `Content-Type: application/json` for that path;
  - confirm `out/.well-known/apple-app-site-association` exists after `npm run build`.
- **Checks:** `cd web && npm run typecheck && npm run lint && npm run build && npm run perf`.
  Guardrails in FEEDBACK-OCT16 section E apply: no direct 'motion' imports in first-screen
  files, no live blur on phones, never pass 'scale' to gsap quickSetter/quickTo.

---------------------------------------------------------------------------------------------------
## D. Shared rules for every agent
- **Worktree:** work only in `/Users/calebwang/Documents/GitHub/homecookd/.worktrees/two-sided`
  (branch `two-sided`). The main checkout belongs to other sessions; never touch it.
- **Ownership:** edit only the files your team owns, as listed above. Others are working at the
  same time. If a typecheck error is in someone else's file, leave it and mention it in your
  result.
- **Safety:**
  - never print secrets;
  - never run deploys, migrations, `git push`, `git commit` or `git stash`;
  - never edit `.env` files or `CLAUDE.md`;
  - never write to the demo family "Our family".
- **Style:** match the surrounding code (top-of-file intent comments, naming, comment density).
  Leave TODO(caleb) where only Caleb can supply a value (bundle id, Team ID, Google client ids,
  store link).

---------------------------------------------------------------------------------------------------
## E. Round 2 (Oct 17): Caleb's feedback after trying it. This section wins where it disagrees with the earlier ones.

### E1. Lock faces that have their own phone
- Once someone has their own phone (a live device key whose `profile_id` is them), **only that
  phone can be them**. Any request with `x-profile-id` = that person from another phone (another
  device key, or the family code from an old build) gets **403 "<Name> uses their own phone."**.
  This applies to reads too, so their messages stay private.
- People without a phone (Grandma on Mom's iPad) can still be picked from any phone in the family.
- A device's owner is set once and never moves:
  - a device with no owner gets one on its first write as someone without a phone;
  - writes as other phone-less people don't change it.

  This replaces "the code-swapped key follows whoever it last wrote as".
- `GET /family`:
  - each profile gets `locked: true` when it has a phone that isn't this one;
  - the response gets `device_needs_profile: true` when this device joined through a family
    invite and has no owner yet.
- **App:** a locked tile still shows the face and name, but tapping it never enters. It opens a
  small sheet: "<Name> uses their own phone." with one button, **Message <Name>**. The status-line
  hook must not read as locked people (the server refuses that), so their line is a quiet "On their
  phone".

### E2. Invite family: no questions, Spotify-style
- **Sheet layout:** tapping **+** (or "Invite family" anywhere, including the other session's
  InviteButton, which renders `<AddFamilySheet visible onClose />`) opens a share sheet with no
  questions and no inputs:
  - a preview card on top: the family table, "Join <Family name> on homecookd", and the faces of
    the family;
  - then one row of app buttons.
- **Row order:**
  1. **Copy link**
  2. **Messages** (expo-sms composer with the text, no recipient)
  3. **Instagram** (copy the link, then open Instagram so they can paste it in a DM; toast "Link
     copied. Paste it in Instagram.")
  4. Then other installed apps:
     - **WhatsApp** (`whatsapp://send?text=`), only when it can open;
     - **More** (the system share sheet), always last.
- `POST /invites` with an empty body creates a **family invite**:
  - no profile is made;
  - one use, 14 days;
  - each opening of the sheet creates one fresh link, which every button in that opening reuses.

  Keep `AddFamilySheet` as the export name; its props become `{ visible, onClose }`, and
  `initialRole` is accepted and ignored.
- **Text:** "Join our family table on homecookd: <url>".
- **The backend's invite routes:**
  - `peek` returns `invitee: null` for a family invite;
  - `accept` returns `profile_id: null`, creates the device with no owner, and posts no circle
    note yet;
  - the old `{name, role}` and `{profile_id}` invites keep working (Send again for people invited
    the old way).

### E3. The person who opens a family invite onboards themselves
- After Join, the app goes to **"Who's in the kitchen?"** for that family. With
  `device_needs_profile`, a one-line hint above the grid reads "Tap + to add yourself.".
- **+ under "The cooks"** → "What does your family call you?" (one field) → `POST /profiles/self
  { name, role: 'cook' }`. **+ under "The ones who miss it"** does the same with role `learner`.
- The server:
  - creates the profile and sets this device's owner to it;
  - posts "<Name> joined." in the circle;
  - returns the profile.
- The app enters as them (their home).
- (Changed Oct 17: a family-invite phone can no longer become an existing face by writing as it; it
  gets 403 "Add yourself first." To be someone who already exists, it asks with POST /move-requests
  and someone on their own phone approves. Asking, approving and declining post no circle note:
  moving in is seamless. See API.md.)
- `/i` screen copy for a family invite:
  - "Join <Inviter>'s family table?" with no "You're joining as …" line;
  - the button says Join.

### E4. + in both sections, for everyone
- **"Who's in the kitchen?" shows a + tile at the end of both sections** ("The cooks" and "The ones
  who miss it"), for cooks and learners alike.
- **For a phone that already has its person:** either + opens the E2 invite sheet. Anyone can
  invite anyone, and the section doesn't matter because the person picks their own role.
- **For a phone with `device_needs_profile`:** + means "this is me" (E3).

### E5. Send recipe: Spotify's share sheet, almost one to one
- Match the attached Spotify screenshot's structure in Hearth colours:
  - the big preview card on top, keeping the existing ShareCard and swatches;
  - **the first row of icons is everyone else in the family**: round faces with names, in a
    horizontally scrolling row (cooks, then the rest), like Spotify's contacts row. Tapping a face
    sends the recipe inside homecookd to that person (POST /send-recipe), then shows a check +
    "Sent". No section titles beyond what Spotify has;
  - **the second row is outside the app, in the E2 order**: Copy link, Messages, Instagram, then
    WhatsApp (if it can open), More.
- Big round icons with labels underneath, as in the screenshot. Tap targets of 48 pt or more.
- (Changed Oct 17, QA B09: for a recipe the faces go the ones who miss it first, then cooks, with
  whoever cooked or opened this dish at the front; after a tap that face scrolls fully into view
  and "Sent to <Name>" shows as a toast in the sheet above the rows. Five targets fit across both
  share sheets with no scrolling: 56 pt circles on a 390 pt phone.)
- Locked people are fine to send to; sending goes to them, not as them.
- `app.config.ts`: add `ios.infoPlist.LSApplicationQueriesSchemes`
  `["whatsapp", "instagram", "instagram-stories"]` so canOpenURL works in store builds. In Expo Go,
  hide the buttons canOpenURL can't confirm, except Instagram: always show it, since it only opens
  the app.

### E6. Web /i page (family invite)
- With `invitee: null`:
  - "<Inviter> invited you to <Family>'s table on homecookd.";
  - no "You're joining as" line;
  - "What's homecookd?" links to the parent page (`/?from=app`).
- Everything else as before.

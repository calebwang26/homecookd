# homecookd retention build: "the seven" (handoff for Claude Code)

Written Oct 17, 2026 for Caleb. Rationale, research & the full 32-feature scorecard live in the doc
"homecookd — Retention Mechanics Scorecard" (https://claude.ai/code/artifact/3d445765-fbf1-446e-9c01-355fe82aab43).
This file is the build plan. Where it disagrees with older build docs **about these features**, this
file wins; everywhere else the older docs still bind.

---------------------------------------------------------------------------------------------------
## 0. Read this first

**What you're building.** Seven small retention features & the push-notification plumbing under
them. Together they give each side a reason to come back (a trigger & a reward for the cook & for
the kid), a weekly ritual, something that grows & a monthly recap, without adding a tab, a new
kind of action for the cook, or more than one new element to any screen.

**Start from origin/main, not the local checkout.** The local repo may sit on an older branch (e.g.
`lander`). origin/main has "one phone, one person", Profiles v2 & the EAS config this work needs.
```bash
git fetch origin
git checkout -b retention-seven origin/main
```
Ship one PR per step in section 6, as the repo already does (`calebwang26/<branch>` → main).

**Read before coding** (all in the repo):
- `docs/build/SPEC.md` (app architecture, data honesty), `docs/build/API.md` (auth, routes, errors,
  polling), `docs/build/FEEDBACK-OCT16c.md` (two-sided rules, section E wins there),
  `docs/build/FEEDBACK-OCT16c-debloat.md` (Caleb's "cut, cut, cut" rules), `docs/build/LAUNCH-LINKS.md`
  (EAS builds & TestFlight).
- Design: `docs/design/hearth-bible/renders/*.png` (the look), `docs/design/ANIMATIONS.md` (motion),
  `app/src/theme/tokens.ts`, the UI kit in `app/src/components/ui/**`.
- Code you'll touch most: listed per feature below.

**Caleb's standing rules (binding):**
- Clarity & structural intuitiveness before cool features. Less is more. Fewer words.
- One obvious action per screen; tap targets ≥ 48 pt; big type on the cook's side.
- Every tap gives feedback (press scale, haptic, loading → success, toast or burst).
- **Never invent data.** Bind real data; hide anything with no data. The cook's own words are always
  shown exactly as said; estimates carry "~".
- The people: cooks in their 50s–70s who aren't techy, & their homesick college-age kids.
- Brand is **homecookd**, always lowercase. Code and repo say homecookd; the Vercel project is `homecookd`; live cloud names (Supabase project, `edible-*` buckets, `X-Edible-Family`) still say edible.
- Never commit secrets; the family code never appears in code or logs.

**Scope discipline.** Build only what's below. Section 9 lists what is deliberately parked; don't
build it, even partly, even if it looks easy.

---------------------------------------------------------------------------------------------------
## 1. The seven at a glance

| # | Feature | Its job | Where it lives | New for the cook | New for the kid |
|---|---|---|---|---|---|
| 1 | "Leo is cooking your chili" | Cook's trigger: proof her recipe is being passed on | A push & a live row in the cook's existing updates card | Tap a heart | Nothing (one consent prompt) |
| 2 | The Sunday table | The ritual: a weekly flame for each kid & cook | A row of family faces with flames under the greeting on both Homes; a week count in each 1:1 chat header; flames on "Who's in the kitchen?" | Nothing (any reply counts) | Nothing (any cook, question or listen counts) |
| 3 | "I miss home" | Kid's trigger: the feeling becomes the reason to open | A pill on the kid's Sunday table row that plays a random family voice clip | Nothing | Tap it |
| 4 | Send it home, get one back | Kid's reward: Mom's reaction to what he made | Replaces "Want to share the love?" after "I made it"; postcards land in the cook's updates card | Tap "Just like mine" or hold to talk | Snap one photo |
| 5 | Hearts on her dishes | Cook's reward: proof her dishes are loved | A heart count & faces on each of her recipe cards; a row in her updates card | Nothing | Nothing (a one-time note) |
| 6 | Grandma's kitchen, 4 of 7 | What grows: dishes learned from each cook | A count & stamps per cook on the kid's Recipes tab; "Leo can cook 4 of your 7" on the cook's Recipes | Nothing | Nothing |
| 7 | Month in the kitchen | Monthly recap that people share | A card on both Homes from the 1st to the 7th; full-screen story slides | Nothing | Nothing |

Plumbing under all seven: **push notifications**, written in the cook's own words where the app
speaks for itself, capped hard (section 2.4).

---------------------------------------------------------------------------------------------------
## 2. Phase 0: plumbing (push, time zones, cron, events)

There is **no push today** (no expo-notifications, no tokens) & **no realtime** (inboxes poll; see
API.md "Polling"). Keep it that way: pushes come from the `api` edge function; screens keep polling.

### 2.1 Migration (sketch; adapt to the repo's conventions in `supabase/migrations/`)

New file, e.g. `supabase/migrations/20261018000000_retention.sql`. Every new table: RLS enabled, no
policies, grants to `service_role` only, exactly like the existing tables (see `20261016200000_favorites.sql`).

```sql
-- Push tokens: one row per device token, owned by the profile signed in on that phone.
create table public.push_tokens (
  token text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_tokens_profile_idx on public.push_tokens (profile_id);

-- Every push sent: caps, dedupe & quote rotation.
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                 -- 'message' | 'started' | 'postcard' | 'reaction' | 'table_nudge' | 'recap'
  app_initiated boolean not null,     -- true = counts toward caps (2.4)
  dedupe_key text,                    -- e.g. 'started:<kid>:<recipe>:<local yyyy-mm-dd>'
  quote_key text,                     -- e.g. '<recipe_id>#step-3', for 15-day rotation
  sent_at timestamptz not null default now()
);
create unique index notification_log_dedupe on public.notification_log (profile_id, dedupe_key) where dedupe_key is not null;
create index notification_log_recent on public.notification_log (profile_id, sent_at desc);

-- Profiles: local time zone, consent to share live cooking, memorial flag.
alter table public.profiles
  add column tz text,                                   -- IANA name from the app (2.3)
  add column share_cooking boolean not null default true,
  add column memorial boolean not null default false;   -- guardrail 2 (section 5)

-- Recipe events: new kinds, whose dish it was, clip length.
-- (Look up the existing check constraint's real name first; it was created inline in
--  20261015000000_messages_backend.sql as kind in ('viewed','cooked').)
alter table public.recipe_events drop constraint recipe_events_kind_check;
alter table public.recipe_events add constraint recipe_events_kind_check
  check (kind in ('viewed', 'cooked', 'started', 'heard'));
alter table public.recipe_events
  add column cook_id uuid references public.profiles(id) on delete set null,
  add column duration_s numeric;

-- Messages: reactions, postcards.
-- Current kinds (20261016120000_family_circle.sql): text, voice, step, recipe, cooked, request, question, system.
-- Add 'reaction' (body = 'heart' | 'just_like_mine').
alter table public.messages
  add column photo_path text,
  add column rating smallint check (rating between 1 and 5),
  add column reply_to uuid references public.messages(id) on delete set null;

-- Live cooking: who is in cook mode right now (one row per kid, replaced as they move).
create table public.cooking_now (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  recipe_id text not null,
  cook_id uuid references public.profiles(id) on delete set null,
  step int not null,
  total int not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
Storage: a private bucket `photos` (image/jpeg & image/heic, 8 MB cap), path `<family_id>/<uuid>.jpg`,
mirroring the `voice` bucket.

### 2.2 API additions (all in `supabase/functions/api/index.ts`; document each in `docs/build/API.md`)

Follow the existing patterns: `on(...)` for signed-in routes, `requireMe(ctx)`, `HttpError`, `dbFail`,
rate limits where the existing routes have them. The 1000-row PostgREST cap TODO applies to new
queries too; keep windows small (this week, this month, last 52 weeks).

| Method & path | Who | Body / query | Returns |
|---|---|---|---|
| `POST /push-tokens` | me | `{token, platform}` | `{ok}`; upserts, moving the token to this profile |
| `POST /push-tokens/remove` | me | `{token}` | `{ok}`; called on sign-out |
| `POST /events` (extend) | me | `{recipe_id, kind: 'viewed'\|'cooked'\|'started'\|'heard', cook_id?, duration_s?}` | `{ok}`; validates `cook_id` is in my family |
| `POST /cooking` | me | `{recipe_id, cook_id, step, total}` | `{ok}`; upserts `cooking_now`; the first call of a session also logs `started` & pushes the cook (3.1) |
| `POST /cooking/end` | me | `{}` | `{ok}`; deletes my `cooking_now` row |
| `GET /cooking` | me | | `[{profile, recipe_id, cook_id, step, total, updated_at}]` for my family, fresh (< 45 min), skipping `share_cooking = false` |
| `POST /photo-upload` | me | `{content_type}` | Same shape as `/voice-upload`, bucket `photos` |
| `POST /messages/:id/postcard` | me (the sender) | `{photo_path, rating?}` | the updated `Message`; only on my own `cooked` message |
| `POST /threads/:id/messages` (extend) | me | `kind: 'reaction'`, `body: 'heart'\|'just_like_mine'`, `recipe_id?`, `reply_to?` | `Message` |
| `GET /dish-stats?ids=a,b,…` | me | ≤ 50 ids | `{[id]: {hearts: {count, by: [{profile_id, at}]}, cooked: {count, by: [{profile_id, count, last_at}]}}}` across my family, me excluded |
| `GET /hearts/recent?since=<iso>` | me (a cook) | | `[{profile_id, recipe_id, at}]` new hearts on my dishes (the app passes my recipe ids or the server maps them; see 3.5) |
| `GET /table` | me | | see 3.2 |
| `GET /recap?month=YYYY-MM` | me | | `{empty: true}` or `{month, role, slides}` (3.7) |
| `POST /cron/hourly` | cron only | header `x-cron-secret` | `{ok, sent}`; runs 3.2 nudges & 3.7 pushes (2.5) |

Messages that carry a `photo_path` come back with a fresh signed `photo_url` (1 h), the way voice
messages carry `audio_url` today.

**Recipe → cook.** The server doesn't know which profile cooked which recipe; the app resolves it
with `cookProfile(recipe, profiles)` (`lib/messaging.ts`, used by `cooked()`). Keep that: the app sends
`cook_id` with events & `/cooking`; the server only checks it belongs to the family.

### 2.3 App plumbing

- `npx expo install expo-notifications expo-keep-awake` (& `react-native-view-shot` for 3.7). Add the
  `expo-notifications` plugin in `app/app.config.ts`. Remote push needs an EAS build
  (`docs/build/LAUNCH-LINKS.md`); add a `development` profile to `app/eas.json` (`developmentClient: true`)
  for testing. Guard everything so **Expo Go never crashes** (same pattern as the Google sign-in module).
- New `app/src/lib/push.ts`: ask permission, get the Expo push token, `POST /push-tokens`, remove on
  sign-out, & route taps (`data.url` → `router.push`).
- **When to ask** (never on first launch, except the cook's first Send and v2's two moments, a kid's dish card
  saved and the cook's craving link shared; one in-app explainer sheet first, then the iOS prompt):
  - kid: right after their first "I made it" ("Want a note when Mom answers?"), or when they send
    their first question;
  - cook: right after their first Send ("Want a note when Leo cooks it?"), including a recipe sent from
    the share sheet's family row, and **even on the first launch** (Nov 3, #341: a new cook films and
    sends on her first day, so waiting for a later launch never asked her; approved by the Master Agent as
    the default, reversible). Every other first-launch refusal stays.
  - An ask made while another sheet is open waits until that sheet closes (iOS drops a second Modal).
  - "Not now" → don't ask again for 30 days.
- **Time zone:** send `x-tz: <Intl.DateTimeFormat().resolvedOptions().timeZone>` on every API call
  (`lib/api.ts`); the server stores it on the acting profile when it changes. Default
  `America/Los_Angeles` when unknown. Add `x-tz` to the function's CORS allowed headers (today:
  `content-type, x-device-key, x-family-code, x-profile-id`), or the web `/r` page's calls break.
- **Log listening:** every Hear playback that runs ≥ 3 s (recipe page Hear, cook-mode Hear,
  `HearCard`, "I miss home") posts `event(recipeId, 'heard', {cook_id, duration_s})`. Extend
  `api.event` in `lib/api.ts` to accept the new kinds & fields.

### 2.4 The sender & the caps (server)

One helper, e.g. `notify(profileId, {kind, title, body, url, appInitiated, dedupeKey?, quoteKey?})`:
1. Skip if the profile has no tokens.
2. **Caps for app-initiated pushes** (anything not caused by a person's action):
   - kid (learner): ≤ 1 a day & ≤ 3 a week;
   - cook: ≤ 1 a month (in practice only the monthly recap);
   - quiet hours 21:00–08:00 in the recipient's `tz`: skip, don't queue.
   Person-to-person pushes (a message, a postcard, a reaction, "Leo is cooking") have no cap but use
   `dedupeKey` so nothing doubles.
3. Insert into `notification_log`, then send through Expo's push API
   (`https://exp.host/--/api/v2/push/send`, batches of ≤ 100, optional `EXPO_ACCESS_TOKEN` secret).
4. On `DeviceNotRegistered`, delete that token. Failures are logged, never fatal to the request.

### 2.5 Pushes to send

| Trigger | To | Title | Body | Opens | App-initiated |
|---|---|---|---|---|---|
| New text message | recipient(s) | sender's name ("Leo") | the text, ≤ 90 chars | that chat | no |
| New voice note | recipient(s) | "Mom" | "Sent a voice note · 0:38" | that chat | no |
| New question (`question`/`step`) | the cook(s) | "Leo asked about Sunday Chili" | the question | that chat | no |
| Recipe sent / published (`/send-recipe`, & the pipeline's `/jobs/:job_id/published` delivery) | the kid(s) | "Just in from Dad" | the dish name | the recipe | no |
| Kid starts cooking (3.1) | the dish's cook | "Leo is making your Sunday Chili" | "Right now, step 1 of 8." | cook's Home | no; dedupe 1 per kid, dish & local day |
| Postcard (3.4) | the dish's cook | "Leo made your Sunday Chili" | "He sent you a postcard." | cook's Home | no |
| Reaction `just_like_mine` (3.4) | the kid | "Mom" | "“Just like mine.” on your Sunday Chili" | that chat | no |
| Sunday table nudge (3.2) | kid | the cook's name | "“<her exact quote>” · Your week at the table is still open." | that cook's newest recipe | **yes** |
| Monthly recap (3.7) | anyone with a non-empty month | "Your October in the kitchen" | a real line from their recap, e.g. "3 dishes & 40 minutes of family voices." | the recap | **yes** |

No push for: hearts, heart reactions during cooking (in-app only), system notes, a kid's own actions.

**Cron.** One hourly job (Supabase Cron / `pg_cron` + `pg_net`) calls `POST /cron/hourly` with
`x-cron-secret` (a new function secret). The handler picks profiles whose **local** time is in the
target hour (Sunday 17:00 for nudges, the 1st at 10:00 for recaps) & runs those jobs. For tests,
accept an optional `now` override only when the secret is present.

**Acceptance (Phase 0):** a test family's two EAS-build phones register tokens; a text from one
arrives as a push on the other within seconds; tapping opens that chat; signing out removes the
token; an app-initiated push past the cap or in quiet hours is skipped & logged; Expo Go still runs.

---------------------------------------------------------------------------------------------------
## 3. The seven, one by one

### 3.1 "Leo is cooking your chili"

**What:** when a kid opens cook mode on a family cook's dish, that cook gets one push & a live row
on her Home; one tap sends a heart that pops up on the kid's screen mid-cook.

**Kid side** (`app/src/app/cook/[id].tsx`):
- On entering cook mode for a dish whose cook is another family profile: `POST /cooking` with the
  step; again on each step change (debounce 2 s); `POST /cooking/end` on "I made it", on leaving
  cook mode, & after 45 min idle.
- **Consent, once:** the first time, a small sheet: "Let Mom see when you cook her dishes?"
  [Yes] [Not now]. "Not now" sets `share_cooking = false` (send nothing, show nothing). Changeable
  later from the kid's own profile sheet.
- **Heart from the cook:** while in cook mode, poll the 1:1 thread with that cook every 10 s for a
  `reaction`/`heart` newer than the session start; show a small heart burst & a toast
  "Mom sent you a heart". No push (he's in the app).

**Cook side** (`app/src/components/parent/UpdatesCard.tsx`, `kitchen.ts`, `parent/home.tsx`):
- Poll `GET /cooking` every 15 s while Home is focused. A fresh row tops the updates card:
  avatar · "Leo is making your Sunday Chili" · "Step 3 of 8" (live) · a heart button (48 pt).
  The heart sends a `reaction`/`heart` message in their 1:1 thread (haptic + small burst + "Sent").
- The row disappears when the session ends; the postcard (3.4) usually replaces it.

**Later, not now:** the same thing as a Live Activity on the cook's lock screen (expo-widgets, push-to-start).

**Acceptance:** kid opens Dad's chili → Dad's phone gets one push within ~5 s; Dad's Home shows
"Step N of M" updating within 15 s of each step change; Dad taps the heart → Leo sees the burst within
~10 s; a second cook-mode open of the same dish the same day sends no second push; with
"Not now" chosen, nothing is shared.

### 3.2 The Sunday table

**What:** each week (Monday 00:00 → Sunday 23:59, kid's local time) a person's face lights with a
small flame when they did their part. Each kid–cook pair also keeps a count of weeks in a row they
both did. Nothing bad happens when a face stays unlit.

**Lit, per person per week:**
- kid: cooked a family cook's dish, played ≥ 3 s of a family clip (`heard`), or sent any message to a
  family cook;
- cook: sent any message (answer, voice note, reaction, recipe) or had a recording published.

**Pair week (kid K, cook C):** K did something *with C* (cooked or heard C's dish, messaged C) **and**
C did something *toward K* (any message in the K–C thread, or a recipe sent to K).

**Streak rules (keep these exact):**
- `weeks` = consecutive pair weeks ending with the last closed week, plus this week if already lit.
- **Leftovers week:** one missed week per calendar month is forgiven automatically.
- **Ember:** a break that isn't forgiven shows no count for 7 days but keeps the old count; any pair
  week inside those 7 days relights it at old count + 1. After that it starts again at 0, quietly.
- Milestones at 4, 12, 26 & 52 weeks: a one-time burst ("12 weeks at the table with Mom") the next
  time either opens the chat.
- Pairs with a `memorial` cook show no count & never nudge.

**API:** `GET /table` → `{week_start, people: [{profile_id, lit}], pairs: [{kid_id, cook_id, weeks,
ember_until, lit_this_week, milestone?}]}`; only pairs that include me are returned. Compute on read
(families are small); cache per family for 60 s if needed.

**UI:**
- **Both Homes:** one compact row under the greeting, "This week at the table": up to 8 family faces
  (cooks first), each with a small sun-yellow (`#FEBE29`) flame badge if lit; unlit faces get nothing
  (no grey, no sad state). Tap a face → their chat (or `PersonSheet` for people without a phone).
  On the kid's Home the row header also holds the "I miss home" pill (3.3).
- **1:1 chat header** (`app/src/app/chat/[id].tsx`): a flame icon & "6 weeks" between that kid & cook.
- **"Who's in the kitchen?"** (`app/src/app/index.tsx`, `components/profiles/ProfileTile.tsx`): the
  same flame badge on lit faces.
- Use a drawn flame icon in `components/ui/icons.tsx`, not an emoji.

**Sunday nudge (kid only, app-initiated, capped):** from the hourly cron, Sunday 17:00–17:59 kid local
time, if a pair with `weeks ≥ 1` isn't lit this week: one push in the cook's own words (2.5). Pick a
step quote (≤ 90 chars) from that cook's recipes not used for this kid in the last 15 days
(`notification_log.quote_key`). No quote → "Your week at the table with Mom is still open." Never sent
to cooks.

**Acceptance:** with a test family & a `now` override: a kid who cooks Dad's dish & gets Dad's reply in
the same week shows `weeks = 1` & both faces lit; skipping one week in a month keeps the count; skipping
two shows the ember, & a pair week within 7 days restores old + 1; the nudge fires once, only on
Sunday evening, only to the kid, & never past the cap or in quiet hours.

### 3.3 "I miss home"

**What:** a pill on the kid's Sunday table row ("I miss home") plays a random clip of a family cook's
voice from the recipes: a story or a step quote.

- **Clip pool** (client only, from the library): family cooks' recipes (via `recipesByCook`), not
  samples, with `media.audio_url`; candidates are `stories[]` (prefer) & `steps[]` with a `quote`, using
  their `start_s`/`end_s` (cap a clip at 60 s). No clip repeats within 7 days (remember per profile
  with `lib/storage`). Clips of a memorial cook stay in the pool (the kid chose to listen).
- **The sheet:** the cook's avatar & name, the dish, her words as the subtitle, play/pause with the
  live waveform (`components/ui/Waveform.tsx`), "Another" & "Open the recipe". Reuse the Hear player in
  `lib/media.ts` / `components/media/HearCard.tsx`.
- Logs `heard` (2.3), which also lights the Sunday table.
- No clips yet (no family recordings): the pill is hidden.
- The cofounder's long-press on the pot logo is a nice extra **only** if a pot mark is already on that
  screen; the visible pill is the real entry point (Caleb: "instantly intuitive or cut it").

**Acceptance:** tap → audio starts within 1 s on a normal connection; "Another" never repeats a clip
from the last 7 days while others remain; the `heard` event lands with `cook_id` & `duration_s`.

### 3.4 Send it home, get one back

**What:** "I made it" ends with a photo postcard sent to the cook, & she answers with one tap.

**Kid side** (`app/src/components/recipe/MadeIt.tsx`, `app/src/app/cook/[id].tsx`):
- Keep: `cooked` event & the `cooked` message are sent the moment "I made it" is tapped
  (`lib/messaging.ts cooked()`), then the SuccessBurst.
- **Replace** "Want to share the love?" with the postcard step:
  - "Show Mom how it came out" + one big shutter (`expo-image-picker` camera, library as fallback).
  - Optional "How close to Mom's?" with 5 small pot icons (TODO(caleb): pots vs dumplings).
  - Send → `POST /photo-upload` → PUT the bytes → `POST /messages/:id/postcard {photo_path, rating}`
    on the `cooked` message → a short postcard-flying animation → done.
  - A quiet "Share with someone else" link keeps the existing share sheet (growth), & "Not now".
- When the cook is the kid themself or not a family profile, skip the postcard step (keep the old
  share prompt).

**Cook side** (`UpdatesCard.tsx`, `components/messages/Bubbles.tsx`):
- The "made" row becomes a postcard: Leo's photo (slight 1–2° tilt at most), the dish, the rating if
  given, & two actions: **"Just like mine"** (sends `reaction`/`just_like_mine` with `reply_to`) & a
  **hold-to-talk** mic that records a voice reply in place (reuse `lib/voice.ts`; no new screen).
- In chat, a `cooked` message with a photo renders as the postcard; reactions render as a small
  stamp under it.

**Kid gets:** a push for the stamp or the voice note (2.5); in chat, Mom's reaction under his postcard.

**Acceptance:** kid finishes Dad's chili → takes a photo → Dad's Home shows the postcard within one
poll; "Just like mine" reaches the kid as a push & a stamp; hold-to-talk sends a voice reply without
leaving Home; skipping the photo still leaves the plain "Leo made your Sunday Chili" row.

### 3.5 Hearts on her dishes

**What:** the hearts kids already tap on dishes show up on the cook's side as a count & faces.

- **Data:** `favorites (profile_id, recipe_id)` already exists with an index for "who hearted this
  dish" (`favorites_recipe_idx`). `GET /dish-stats?ids=…` counts hearts from profiles in my family,
  me excluded. The cook's app passes her own recipe ids (`recipesByCook`).
- **Cook's Recipes** (`app/src/app/parent/recipes.tsx`, `components/parent/RecipeRow.tsx`): one line per
  card, "♥ 4 · cooked 3 times", plus a small row of the faces who cooked or hearted it (the cofounder's
  bold "faces row"). Hide the parts that are zero.
- **Cook's recipe page** (`app/src/app/my-recipe/[id].tsx`): "♥ 4 · Leo, Maya, Dad" near "Who cooked it".
- **Updates card:** "Leo hearted your Sunday Chili" rows from `GET /hearts/recent` (newest 3, merged
  with the other updates). **No push** for hearts.
- **Kid side** (`components/recipes/HeartButton.tsx`, `lib/favorites.ts`): the first heart after this
  ships shows a toast once per profile: "Mom sees your hearts" (that dish's cook). Hearts still work as
  the kid's favorites everywhere.
- Never a ranking: counts are shown only to that dish's cook, never compared across cooks.

**Acceptance:** Leo hearts Dad's chili → Dad's Recipes card shows ♥ 1 & Leo's face after a refresh,
& an updates row appears; un-hearting removes it; Mom never sees counts for Dad's dishes.

### 3.6 Grandma's kitchen, 4 of 7

**What:** the kid sees how many of each cook's dishes they can make; the cook sees the mirror.

- **Kid Recipes tab** (`app/src/app/kid/recipes/index.tsx`, `components/recipes/RecipeListRow.tsx`):
  when a cook's chip is selected, a header line "You can cook 4 of Grandma's 7" with 7 small dots
  (filled = cooked). Each cooked dish row gets a small hand-drawn stamp beside its activity words.
  When all are cooked: "Keeper of Grandma's kitchen". Data: `/me/recipe-stats` (`cooked`) &
  `recipesByCook`; only family cooks' non-sample dishes count.
- **Milestones** on "I made it": the 1st, 5th & 10th distinct family dish, & completing a cook's set,
  change the SuccessBurst title ("Your first family dish", "Keeper of Grandma's kitchen").
- **Cook's Recipes header:** "Leo can cook 4 of your 7. Maya, 2." from `/dish-stats` (hide when 0).
- Not now: the cofounder's "hidden story unlocked by collecting them all" (it needs Hidden notes, parked).

**Acceptance:** counts match `/me/recipe-stats` exactly; samples & YouTube dishes never count; the
header hides for cooks with no dishes.

### 3.7 Month in the kitchen

**What:** on the 1st of each month, everyone with a non-empty month gets a few story slides about it.

- **API:** `GET /recap?month=YYYY-MM` computes from `recipe_events`, `messages` & `favorites` in that
  month (recipient's tz). `{empty: true}` when nothing happened.
  - Kid slides (each only if it has data): cover · "You cooked 3 family dishes" with their postcards ·
    "Most made: Dad's Sunday Chili, twice" · "40 minutes of family voices" (sum of `heard.duration_s`)
    with a play button for the most-played clip · "Hearts you left: 5" · first postcard beside the
    latest (Then & Now, needs ≥ 2 photos) · close.
  - Cook slides: cover · "Your dishes were cooked 5 times" with the kids' faces · "Most loved: Sunday
    Chili (♥ 4)" · the postcards she got · "Questions you answered: 3" · close.
- **App:** a new modal route `app/src/app/recap.tsx` (register it in `_layout.tsx`): tap to advance,
  thin progress bars on top, Fraunces titles, Hearth colours; a Share button on each slide renders it
  to an image (`react-native-view-shot`) & opens the system share sheet with a homecookd mark.
- **Home card** (both Homes): from the 1st to the 7th, if not empty & not yet opened, "Your October in
  the kitchen" → the recap. One per month.
- **Push** on the 1st at 10:00 local (app-initiated; counts toward caps).
- **First edition:** Dec 1 for November (it covers Thanksgiving). The PR must be merged & live by Nov 30.
- The cookbook offer on the last slide waits until printing exists (TODO(caleb)).

**Acceptance:** an empty month shows no card & sends no push; every number on a slide matches the
database for that month; share produces an image with the dish photo & numbers.

---------------------------------------------------------------------------------------------------
## 4. Little touches that ride along

From the cofounder's list, the **bold** touches on screens the seven already use. Polish only: none
adds an action.

| Touch | Where |
|---|---|
| Screen stays awake in cook mode, with a one-time "Screen stays on" toast | `cook/[id].tsx` (`useKeepAwake` from expo-keep-awake) |
| Small pot dots fill one by one for the steps (keep the tappable "Step 3 of 8") | `cook/[id].tsx` header |
| "2 of 6" ingredient counter fills a tiny pot icon | `recipe/[id]/ingredients.tsx` |
| Ticked ingredients get a hand-drawn strike-through | `recipe/[id]/ingredients.tsx` (SVG stroke) |
| Last step: a steam puff & "Mom would be proud" in the Caveat hand font | `components/ui/SuccessBurst.tsx` variant |
| Hold to record an answer right on the cook's update card | `UpdatesCard.tsx` (shared with 3.4) |
| Send: "Wrapping…" → "On its way to Leo" with a paper plane; "You can close the app" as a pot with its lid on | `app/src/app/send.tsx`, `ActionButton` states |
| Pot mascot moods: sleepy 22:00–06:00, waving on Sunday (birthdays later: no birthday data yet) | wherever `Brand`/the pot mark shows |
| Haptics set: soft tick on checks, firmer on send, double tap for a new family message (app open) | `components/ui/haptics.ts`, used everywhere |
| Live waveform & a pulsing avatar chip while "Hear Mom" plays | `components/kid-home/HomeHero.tsx`, `Waveform.tsx` |
| Heart taps burst into a few tiny particles (keep the glyph itself crisp; see the comment in HeartButton) | `components/recipes/HeartButton.tsx` overlay |
| The meal pick's honest countdown, "next pick in 2:14", to the next real meal window | `kid/home.tsx` heading, from `lib/recommend.ts` windows |

**Not now** (they need plumbing we don't have): word-by-word karaoke transcripts (transcription was
removed on Oct 16 for cost), the 3-2-1 recording countdown (Record opens the system camera; needs an
in-app camera), "Mom is recording…" (needs presence). Also skip the hero tilt & dumpling pull-to-refresh
until the seven are in.

Respect Reduce Motion everywhere (ANIMATIONS.md): fades instead of motion.

---------------------------------------------------------------------------------------------------
## 5. Guardrails (hard rules; review every PR against them)

1. **Never speak for the cook.** Push & UI copy may quote what a cook actually said (verbatim from
   recipe JSON: `steps[].quote`, `ingredients[].feel`, `stories[].text`) & nothing else in her voice. No
   invented feelings ("Mom misses you", "Don't let Mom down"). Her voice never auto-plays from a push.
2. **Memorial.** A profile with `memorial = true`: no nudges about them, no pair counts, no recap slides
   that address them as present. (The UI to set it is TODO(caleb); v1 sets it by SQL.)
3. **Caps.** Kid app-initiated ≤ 1/day & ≤ 3/week; cook app-initiated ≤ 1/month; quiet hours 21:00–08:00
   local. Duolingo needs CEO sign-off to add notification volume; so do we (Caleb).
4. **Weekly, forgiving & private.** Streaks are weekly, forgive a week a month, relight within 7 days &
   show only to the two people in them. No sibling rankings, no public counts.
5. **Honest timers only.** A countdown appears only when something real changes at zero.
6. **Consent for presence.** "Let Mom see when you cook" is asked once & respected everywhere.
7. **No guilt words** anywhere: never "lost", "expired", "broken", "you missed". Empty or unlit states
   are simply quiet.

---------------------------------------------------------------------------------------------------
## 6. Build order & PRs

| PR | Contents | Depends on |
|---|---|---|
| 1. Plumbing | Migration, `/push-tokens`, `notify()` & caps, message pushes (2.5 rows 1–4), `x-tz`, `heard` events, cron runner skeleton, keep-awake & haptics touches | — |
| 2. Leo is cooking | `cooking_now`, `/cooking*`, started push, Home row & heart, consent sheet | 1 |
| 3. Send it home | `photos` bucket, `/photo-upload`, `/messages/:id/postcard`, reactions, postcard UI both sides, hold-to-talk on the card | 1 |
| 4. Hearts & kitchen | `/dish-stats`, `/hearts/recent`, cook Recipes line & faces, kid Recipes header & stamps, milestones, hearts toast | 1 |
| 5. Table & I miss home | `/table`, Home rows, chat header, flames on profiles, Sunday nudge via cron, the "I miss home" sheet | 1, 3 (reactions count) |
| 6. Month in the kitchen | `/recap`, `recap.tsx`, Home card, share image, 1st-of-month push | 1–5; **live by Nov 30** |
| 7. Remaining touches | Section 4 leftovers | any |

PRs 2, 3 & 4 can run in parallel after PR 1 (separate files, except `UpdatesCard.tsx`: 2 & 3 both
touch it, so land 2 first or agree on the row component).

---------------------------------------------------------------------------------------------------
## 7. Verification (every PR)

- App: `cd app && npx tsc --noEmit && npx expo lint`. Web untouched: `cd web && npm run build` still passes.
- Screens: Expo web at `http://localhost:8090` & `node app/scripts/shot.mjs <route>?as=<name> out.png`
  (390×844 @2x); compare against the Hearth renders for spacing, type & colour.
- Backend: curl the new routes with the **test family** (code in `docs/build/.test-family-code`,
  gitignored; never print it). Never write to the demo family.
- Push: two phones on an EAS development or TestFlight build in the test family; Expo Go may not
  receive remote pushes.
- Cron: call `/cron/hourly` with the secret & a `now` override to test Sunday nudges & the 1st-of-month recap.
- Update `docs/build/API.md` for every new route & `docs/build/SPEC.md` for screen changes.

---------------------------------------------------------------------------------------------------
## 8. Open decisions for Caleb (defaults used until he says otherwise; mark each `TODO(caleb)` in code)

1. Quiet hours 21:00–08:00 local. (Default as written.)
2. Kid Home: the Sunday table row sits under the greeting & the big "Invite family" button stays.
   Alternative: a "+" at the end of the row replaces the button.
3. Rating icons on the postcard: small pots (default) or dumplings.
4. The cookbook offer in recaps: hidden until printing exists.
5. Memorial: set by SQL in v1; who can set it in the app later?
6. Heart counts visible only to the dish's cook (default) or to the whole family.

---------------------------------------------------------------------------------------------------
## 9. Parked: do not build

Next, one at a time & only after the seven show up in the numbers: the home-screen widget, Make it
yours, the Mom-isms deck, & "Leo is cooking" as a Live Activity.

Parked: Story of the day, On this day, Sunday letter, holiday & birthday countdowns (the meal pick
already handles holidays), the Developing tracker, Your dish's journey (beyond the faces row in 3.5),
fridge tickets, "Mom is recording…" presence, the Sunday question, Hidden notes, Most-replayed moment,
Care package, Cook-along, Hands-free "Okay Mom, next", Timers in Mom's voice, Fold counter, the
cookbook progress bar, Dinner together, "Which do you miss more?".

**The overwhelm check:** if new families cook less in their first week after one of these PRs ships,
pull the newest feature back out.

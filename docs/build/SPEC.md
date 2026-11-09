# homecookd app build spec (Oct 15): Hearth redesign + messages + sharing + web recipe page

> **BRAND RENAME (binding, overrides every other mention):** the product is now called
> **homecookd** (all lowercase, one word, also at the start of a sentence and in the wordmark;
> never "Edible", "HomeCookd" or "Homecookd"). Domain: **https://homecookd.app** (on the
> Vercel project; `edible-psi.vercel.app` still works as a fallback). Every user-facing string in the
> app, the web recipe page and the lander says homecookd: wordmarks next to the pot mascot, page
> titles, share text ("<Dish> from <cook>'s kitchen, on homecookd: <url>"), the "Get the app" popup
> ("Get homecookd"), sign-up success ("Open homecookd on your phone"), app display name, permission
> copy, alt text, meta/OG tags. The repo, folder and code say homecookd too (renamed Oct 20, 2026). Live cloud names keep "edible":
> Supabase project `edible`, the `edible-*` GCS buckets, upload signer
> and service account, the `X-Edible-Family` header and the API's `EDIBLE_*` secrets.

> **Sign-in and invites changed (Oct 16, round 3).** No email in the app, and nobody needs the shared
> code: each phone gets its own key from an invite link (Join), Sign in with Apple or Google. The
> family code is a small backup that still works (old builds use it, and it can't be changed yet), so
> removing someone can't keep out a phone that has it (API.md, Security model; TODO(caleb)).
> Mom invites from "+ Add family" through her own Messages; the link works once. Binding
> plan: `docs/build/FEEDBACK-OCT16c.md`; routes, errors and the security model: `docs/build/API.md`.
> Where this spec says family code, email or sign-up sheet, those two files win.

Founder's brief (condensed, binding):
- **The design bible is `docs/design/hearth-bible/`** (Caleb's "homecookd · Hearth, Redesigned" canvas).
  Copy it almost 1 to 1 in the Expo app: UI, fonts, structure, spacing, colors, copy tone. Sources
  are `source/*.dc.html` (inline-styled HTML at 390x844; read the exact px values), renders are
  `renders/*.png` (2x). Image ids map to local photos via `blob-map.json`.
- **Motion** comes from `docs/design/ANIMATIONS.md` (button press, loading, success burst, sheets,
  card-to-detail, scroll header, launch). The bible has no motion; the motion spec fills that gap.
- **Messages must really work** (backend, not a mock): family members message each other about a
  dish, with text and voice notes, step questions and recipe cards.
- **Send recipe** does two things: (1) sends it internally to someone in the family through
  Messages; (2) makes a link anyone can open, even without an account.
- **Share sheet** mimics Spotify's share sheet (`docs/design/refs/spotify-share-sheet.webp`): a sheet
  where the top half is a big card (dish photo, dish name, cook, homecookd mark), a row of colour
  swatches for the card, a row of people in the family to send to inside the app, and a bottom row of
  external options: Copy link, Messages, WhatsApp, More.
- **Web recipe page** on our Vercel domain (`https://homecookd.app/r?s=<token>`): a limited
  web version of the app for someone who got the link and has no account. Same UI as the app, kid
  (receiver) view, bottom bar visible, but locked to this one recipe: recipe, ingredients and steps
  work (Watch/Hear included); every other tab or link opens a Spotify-style "Get the app" popup
  (`docs/design/refs/spotify-web-get-app.webp`: title, one line, "Not now" + white "Get App" pill).
  From there they can sign up.
- Quality over speed. Never invent facts in the UI; bind to real data, hide what has no data.

Repo: `/Users/calebwang/Documents/GitHub/homecookd`. App: `app/` (Expo SDK 57, expo-router, RN 0.86,
Reanimated 4, react-native-svg, expo-video/audio). Lander: `web/` (Next 16 static export, deployed to
Vercel project `homecookd` (renamed from `edible` Oct 20, 2026), public domain `https://homecookd.app`, also `https://edible-psi.vercel.app`). Pipeline: `pipeline/` (Python).
Recipes live in the public GCS bucket (`EXPO_PUBLIC_BUCKET_URL`): `library.json` + `<id>/recipe.json`
(+ play.mp4, voice.m4a, poster.jpg, steps/NN.jpg). Types: `app/src/lib/types.ts`.

---------------------------------------------------------------------------------------------------
## 1. People, roles and data honesty

One family = one account (Netflix model). Each phone signs in once and keeps its own **device key**
(invite link, Apple, Google, or the family-code backup; FEEDBACK-OCT16c.md). Inside it, **profiles**:
- cooks (parent side): Mom, Dad, Grandma (seeded). Avatars `app/assets/avatars/{mom,dad,grandma}.jpg`.
- learners (kid side): Leo (avatar `leo.jpg`), Maya (initial tile "M", lime-wash `#EDF2BE`).
A profile's recipes = library entries whose `cook_name` equals the profile name (case-insensitive).
Real recipes today: Dad (Sunday Chili, Grilled Fish), Grandma (Noodle Soup, Red-Braised Pork),
Auntie Lin (Scallion Pancakes), Miles (Swordfish Steak, real video), Gordon & Auntie Bumbi (YouTube).
Non-profile cooks still appear in Recipes under their own names ("Auntie Lin's kitchen").
Mom has no recipes yet; her screens must look great empty (bible tone: warm, one clear action).

Rules: copy the bible's layout and visual design exactly, but fill it with real data. Where the bible
shows a fact we don't have (e.g. "Mom's birthday is in 2 weeks"), either derive an honest equivalent
from real data or leave the section out. Never show the bible's fictional dumplings content as if real.
Sample (synthetic) recipes have no video/audio: Watch/Hear show "Sample recipe, no video" gracefully.

---------------------------------------------------------------------------------------------------
## 2. App information architecture (expo-router, `app/src/app/`)

```
_layout.tsx                 root: fonts (Fraunces 400/500/600 + italics, DM Sans 400/500/600/700),
                            SessionProvider, ShareSheetProvider, ToastProvider, Stack, LaunchSplash
index.tsx                   Profiles  ........ bible Main ("Who's in the kitchen?")
join.tsx                    first screen: Continue with Apple / Google, Paste invite, "Have a family code?"
join-code.tsx               the family-code backup
i.tsx                       an invite link (/i?t= or ?c=): "Join Mom's family table?" + Join
r.tsx                       a recipe link (/r?s=): opens the dish, or /join?s= when signed out
kid/_layout.tsx             Tabs + FloatingTabBar: Home | Ask
kid/home.tsx                bible Kid-Home + Kid-Browse (components/browse/FamilyTable.tsx) in one scroll
                            (+ Kid-Home-Scrolled = same screen, scrolled)
kid/recipes.tsx             hidden redirect to /kid/home (FEEDBACK A2)
kid/ask.tsx                 bible Kid-Messages (inbox)
parent/_layout.tsx          Tabs + FloatingTabBar: Home | Record | Messages | Recipes
parent/home.tsx             bible Parent-Home
parent/record.tsx           bible Parent-Record
parent/messages.tsx         bible Parent-Messages (inbox)
parent/recipes.tsx          bible Parent-Home-Scrolled ("Your recipes")
recipe/[id]/index.tsx       bible Kid-Recipe (also used by the web page's structure)
recipe/[id]/ingredients.tsx bible Kid-Ingredients
cook/[id].tsx               bible Kid-Step / Kid-Step-Open (param `step`, 1-based)
my-recipe/[id].tsx          bible Parent-Recipe
chat/[id].tsx               bible Kid-Chat or Parent-Chat depending on the current profile's role
send.tsx                    bible Parent-Send (after recording; params: localVideos or jobId)
recap.tsx                   Month in the kitchen (retention PR 6; full-screen modal; param `month`)
```
Old screens are replaced: delete `src/app/{index (old library), upload, prompts, questions}`, old
`recipe/[id].tsx`, and components no longer used. Keep `lib/uploads.ts`, `lib/deletes.ts` (reused).
Tab bars: bible's floating white pill (left/right 16, bottom 24, height ~64, radius 999, shadow),
active tab = dark ink `#1E2410` bubble with cream icon+label; inactive `#5F6352`. Kid icons:
house, 2x2 grid (Recipes), speech bubble (Ask). Parent: house, mic (Record), bubble (Messages),
open book (Recipes). Unread count dot on Ask/Messages. Retention PR 7: when the unread count read
from the server goes up for the same person while the app is open, two light haptic taps (never for
what was already waiting when the app opened or came back to the front; nothing on web). One message,
one signal: the taps wait 3 s and stay quiet when a message push arrived with the app open in the
last 20 s (shown, or kept quiet because its chat was on screen) or while a chat is open.
Dev aid: on web, `?as=<profile name>` (e.g. `/kid/home?as=leo`) selects that profile so headless
screenshots can open any screen directly.

---------------------------------------------------------------------------------------------------
## 3. Shared app modules (owned by the foundation agents; screen agents import, never fork)

`src/theme.ts` (rewrite to bible tokens):
- colors: page `#F7F7F2`, card `#FFFDF7`, ink `#1E2410`, text `#2D3222`, muted `#5F6352`,
  hairline `rgba(30,36,16,0.08)`/`rgba(71,67,42,0.14)`, green `#5B6F00`, green-deep `#4C5A10`,
  sage `#E6EBCF`, sun `#FEBE29`, butter `#FFF1C7`, peach `#F9E3CF`, peach-ink `#6E4A33`,
  lavender `#ECE6F2`, lavender-ink `#3F3558`, rose `#F6D5CC`, lime-wash `#EDF2BE`, danger `#9A4F47`,
  record-red `#A84E44` (check bible Parent-Chat recording state for the exact value). Read every
  colour from the bible sources; add any missing one by its hex.
- type roles mirroring the bible (Fraunces 500 for titles at 26-34 px with -0.02em tracking; Fraunces
  italic for quotes; DM Sans 400/500/600/700 for UI at 13-17 px). Provide `type.display(size)` etc.
- radii (cards 24-28, hero 32, pills 999), spacing, shadows exactly as the bible uses them.
`src/components/ui/*`: `Txt`, `PressableScale` (motion spec 5), `ActionButton` (idle/loading/success/
error), `Pill`, `Chip` (selected = sun `#FEBE29` fill like Kid-Browse "Everyone"), `IconButton`
(round 44-48 cream), `Avatar` (profile -> photo or initial tile; sizes; ring; unread dot), `Card`,
`ScreenWash` (the bible's top gradient: lavender `#ECE6F2` for kid, peach `#F9E3CF` for parent,
fading to `#F7F7F2` over ~360 px), `LargeHeader` + `StickyHeader` (motion spec 2), `BottomSheet`
(motion spec 4), `SuccessBurst` (motion spec 5), `Toast`, `Dropdown` (accordion row with chevron,
animated height), `DateTile`, `Waveform`, `SegmentedChoice` (Kid-Recipe "Just me / Friends"),
`FloatingTabBar`, `icons.tsx` (every icon used in the bible, stroke SVG, 1.8-2 px, round caps),
`EmptyState`, `Skeleton`.
`src/lib/`:
- `api.ts`: typed client for section 5 (fetch, 10 s timeout, retries on 5xx, `x-device-key` (else an
  old phone's `x-family-code`), `x-profile-id`). All server types live here.
- `session.tsx`: `SessionProvider`/`useSession()` -> `{family, profiles, me, setMe, isCook,
  isLearner, refresh}` plus the ways in (`acceptInvite`, `signInWithApple/Google`, `joinFamily`);
  keeps this phone's device key in SecureStore, never logged; handles `?as=`.
- `recipes.ts`: library + recipe loading (move/extend `data.ts`: remote with bundled fallback),
  helpers: `recipesByCook(entries, person)`, `stepIngredients(recipe, step)`, `stepClip(step)`,
  `firstQuote(recipe)`, `cookProfile(recipe, profiles)`.
- `format.ts`: `mmss(sec)`, `goodGreeting(date)` ("Good morning"), relative dates
  ("Thursday", "Last night", "Sunday, 7:05 pm"), `minutesLabel`.
- `media.ts`: one place for Watch (video range) and Hear (audio range with subtitle) playback built on
  expo-video/expo-audio (port the working logic in `components/PlayerSheet.tsx`).
- `share.tsx`: `ShareSheetProvider` + `useShare().open({recipeId})`. The share agent implements the
  sheet; screens only call `open`.
- `voice.ts`: record (expo-audio recorder, m4a), upload to the signed URL, play with progress.
- Retention plumbing (docs/build/RETENTION-HANDOFF.md 2.3, Oct 17): `api.ts` sends `x-tz` (the
  phone's zone, `tz.ts`; set by `session.tsx` at launch and each time the app comes back to the
  front, never under the `?as=` dev aid) on every signed-in call; `push.ts` (expo-notifications, loaded lazily: never on web or in Expo Go on Android, and a
  quiet no-op without the EAS project id) registers this phone's push token for its person, forgets
  it in `leaveFamily` (the server is told in the background; sign-out never waits on it), and opens
  a tapped push's screen (root layout `PushBridge`); `components/push/PushAskSheet.tsx` is the one
  "Want a note when Dad answers?" / "Want a note when Leo writes back?" sheet before the OS prompt
  (still "writes back" with PR 2: a kid who says "Not now" to sharing their cooking sends the cook
  no note, so "…cooks it?" waits for Caleb's TODO(caleb) in PushAskSheet.tsx);
- Live cooking (retention PR 2, RETENTION-HANDOFF 3.1): `cookingApi.ts` (the `/cooking*`,
  `/profile/share-cooking` and heart calls, same headers as `api.ts`), `cookingLogic.ts` (pure,
  Node-tested), `useCookingSession.ts` (cook mode) and `useLiveCooking.ts` (the cook's Home, every
  15 s while focused). Cook mode never starts a session under the `?as=` dev aid
  (`session.usingDevAid()`), so a screenshot writes nothing;
  `listening.ts` + `media.ts` log a `heard` event (with `cook_id`) once per play of a cook's recorded
  voice that runs 3 s or more (voice notes never).
- Hearts & kitchen (retention PR 4, RETENTION-HANDOFF 3.5 + 3.6): `dishStatsApi.ts` (`GET /dish-stats`
  in batches of 50, `GET /hearts/recent`; a 404 reads as "nothing to show"), `heartsCopy.ts` (the
  words: "♥ 4 · cooked 3 times", "♥ 4 · Leo, Maya, Dad", "You can cook 4 of Grandma’s 7", "Leo
  hearted your Sunday Chili"), `kitchenCounts.ts` (the counts, the cook's mirror, the "I made it"
  milestones; only a family cook's real dishes count, never samples, YouTube or my own), `heartsNote.ts`
  ("Mom sees your hearts", once per profile on this phone; never for a memorial cook, and not until
  `GET /family` has said `memorial: false`) and `components/hearts/` (the lines, faces
  row, header, stamp and update row, plus `useDishStats` / `useHeartsRecent`, refetched on focus and on
  coming back to the foreground at most every 10 s; hearts also poll with the inbox). The counts are only ever shown to the dish's cook (the server answers only her);
  `useRecipeStats().loaded` says the server has answered at least once (counts and milestones wait for it);
- The Sunday table & "I miss home" (retention PR 5, RETENTION-HANDOFF 3.2 + 3.3): `tableApi.ts`
  (`GET /table`, one shared store for the Homes, the 1:1 chat header and the Profiles tiles: asked on
  focus, on coming back to the foreground and after `invalidateTable()`, which `messaging.ts` calls
  after a send, "I made it", a request or a recipe send and `listening.ts` after a logged listen; at
  most every 10 s otherwise; a 404, offline or junk keeps the last table, null at first, so nothing
  shows rather than made-up flames; no `x-tz` under the `?as=` dev aid), `sundayTable.ts` (pure
  rules: the faces, a chat's pair, "6 weeks", the milestone remembered once it has played,
  `familyRecordings`), `missHome.ts` (the clip pool, scoped to `GET /table`'s `recordings` so only
  THIS family's own recordings play, never another family's same-named cook; the pick that never
  repeats a clip within 7 days), `components/table/` (`TableRow`, `HomeTableRow` = the row wired to
  the table, the family and what a tap opens, `FlameBadge`, `WeeksBadge`, `MilestoneBurst`). The kid
  Home's table row and "I miss home" pill and sheet were cut in kid QA round 2 (Oct 22: Home is a
  portal); the cook Home keeps the row, and the Recap still plays clips from the pool;
- Month in the kitchen (retention PR 6, RETENTION-HANDOFF 3.7): `recapApi.ts` (`GET /recap` with its
  own fetch, `x-tz` like `tableApi.ts`; reading the slides in story order; the Home card's month,
  the 1st-7th only, from Dec 1 for November (`FIRST_MONTH`; no October edition, TODO(caleb));
  "opened" and the card's answer per person per month on this phone),
  `components/recap/` (`useRecapCard` + `RecapCard` = the Home card and its held slot, `RecapScreen` = the route's body with its loading, empty, error and no-person states,
  `RecapStory` = the slides, `story.ts` = the pure story rules). The route `recap.tsx` passes Share:
  `react-native-view-shot` (in Expo Go for SDK 57) captures the slide and `expo-sharing` opens the
  system share sheet;
Dependencies to add with `npx expo install` (all Expo Go compatible): expo-linear-gradient, expo-blur,
expo-haptics, expo-clipboard, expo-sharing (optional), expo-secure-store,
@react-native-async-storage/async-storage, expo-notifications and expo-keep-awake (retention PR 1),
react-native-view-shot (retention PR 6; native, so the EAS build needs a rebuild).
`app.json`: enable camera + microphone permissions for expo-image-picker / expo-audio with warm copy.
Env (`app/.env`, gitignored): add `EXPO_PUBLIC_API_URL=https://qeiednrjkiyzbolkepbk.supabase.co/functions/v1/api`
and `EXPO_PUBLIC_WEB_URL=https://homecookd.app`.

---------------------------------------------------------------------------------------------------
## 4. Backend (Supabase project `edible`, ref `qeiednrjkiyzbolkepbk`, us-west-1)

Access model: ONE edge function `api` (verify_jwt=false, custom auth) using the service role. All
tables have RLS enabled with no policies (deny-all to anon); only the function reads/writes.
Auth: header `x-device-key` (this phone's key, sha256 -> `devices.key_hash`), else `x-family-code`
(old builds, the pipeline) -> `families.code_hash`. Acting profile: `x-profile-id` (must be someone
still in that family). Public routes, invites and Apple/Google sign-in: see `docs/build/API.md`.
CORS: allow `*` origins, headers `content-type, x-device-key, x-family-code, x-profile-id`, methods GET/POST/OPTIONS.
Source of truth in the repo: `supabase/migrations/*.sql`, `supabase/functions/api/index.ts`.

Tables (all `id uuid default gen_random_uuid()` unless noted, `created_at timestamptz default now()`):
- `families(id, name, code_hash unique, created_at)`
- `profiles(id, family_id, name, role check in ('cook','learner'), relation, avatar_key, sort int,
  created_at)` unique (family_id, lower(name))
- `threads(id, family_id, a_profile, b_profile, last_message_at, created_at)`; a_profile < b_profile;
  unique (family_id, a_profile, b_profile)
- `messages(id, family_id, thread_id, sender_id, kind check in
  ('text','voice','step','recipe','cooked','request'), body text, recipe_id text, step_order int,
  audio_path text, audio_url text, clip_start_s numeric, clip_end_s numeric, duration_s numeric,
  transcript text, seed bool default false, created_at)`; index (thread_id, created_at)
- `thread_reads(thread_id, profile_id, last_read_at, primary key(thread_id, profile_id))`
- `shares(token text primary key, family_id, recipe_id, sender_id, created_at, open_count int
  default 0, last_opened_at)`
- `pending_sends(job_id text primary key, family_id, sender_id, recipient_ids uuid[], hello_path
  text, hello_duration_s numeric, created_at, delivered_at, recipe_id text)`
- `recipe_events(id, family_id, profile_id, recipe_id, kind check in ('viewed','cooked'),
  created_at)`
- `signups(id, name, email, share_token, family_id, created_at)`
Storage: private bucket `voice` (audio/m4a, 10 MB cap). Path `<family_id>/<uuid>.m4a`.

Endpoints (JSON in/out, base `${EXPO_PUBLIC_API_URL}`):
| method & path | body / query | returns |
|---|---|---|
| GET `/family` | | `{family:{id,name}, profiles:Profile[]}` |
| POST `/profiles` | `{name, role, relation?}` | `Profile` |
| GET `/threads` | (acting profile) | `ThreadSummary[]`: `{id, other:Profile, last:Message\|null, unread:int, recipe_id:string\|null}` newest first; one per other family member that has any message |
| POST `/threads` | `{other_id}` | `{id, other}` (get or create) |
| GET `/threads/:id/messages` | `?after=<iso>` | `Message[]` oldest first; voice messages carry a fresh signed `audio_url` (1 h) unless `audio_url` is an external clip |
| POST `/threads/:id/messages` | `{kind, body?, recipe_id?, step_order?, audio_path?, duration_s?, clip_start_s?, clip_end_s?}` | `Message` |
| POST `/threads/:id/read` | | `{ok:true}` |
| GET `/unread` | | `{total:int}` |
| POST `/voice-upload` | `{content_type:'audio/m4a'}` | `{path, upload_url, headers}` (signed upload, PUT the file bytes) |
| POST `/send-recipe` | `{recipe_id, to: string[] \| 'everyone', note?}` | `{sent: {profile_id, thread_id, message_id}[]}`; creates a `recipe` message (body = note) in each thread |
| POST `/shares` | `{recipe_id}` | `{token, url}` where url = `https://homecookd.app/r?s=<token>` (token: 10 chars, base62, crypto random) |
| GET `/shares/:token` (public) | | `{token, recipe_id, recipe_url, sender:{name, relation, avatar_key}\|null, family_name}`; increments open_count |
| POST `/signup` (public) | `{name, email, share_token?}` | creates a new family + one learner profile with a fresh code (format `XXXX-XXXX`, no 0/O/1/I), stores the signup; returns `{family_code, family_name}` |
| POST `/pending-sends` | `{job_id, recipient_ids, hello_path?, hello_duration_s?}` | `{ok:true}` |
| POST `/jobs/:job_id/published` | `{recipe_id}` (family code only; called by the pipeline worker) | delivers the pending send: `recipe` message (+ the hello voice note) to each recipient; `{delivered:int}` |
| POST `/events` | `{recipe_id, kind:'viewed'\|'cooked'}` | `{ok:true}` |
| GET `/recipes/:id/activity` | | `{cooked:[{profile, at}], viewed:[{profile, count}], last_sent_at}` |

Types: `Profile{id,name,role,relation,avatar_key}`, `Message{id,thread_id,sender_id,kind,body,
recipe_id,step_order,audio_url,duration_s,clip_start_s,clip_end_s,transcript,created_at}`.
Validation: body <= 2000 chars, voice <= 5 min, names <= 40. Errors: `{error:string}` + 4xx.
Seeding (`seed=true`): the demo family (current `FAMILY_CODE` from the root `.env`, never printed or
committed) with Mom, Dad, Grandma (cooks) and Leo, Maya (learners); a few true-to-data threads, e.g.
Leo -> Dad about *Dad's Sunday Chili* with a `step` message on a real step and Dad's text answer;
Dad -> Leo a `recipe` message for the chili with a note; Leo -> Mom a `request` ("Will you teach me
your Sunday eggs? The ones you made the morning I left."); Leo -> Grandma a question about the noodle
soup. Also a separate **test family** (code stored in `docs/build/.test-family-code`, gitignored) for
agents' write tests, so the demo family stays clean.
Worker hook: after `publish.publish_recipe` succeeds, `pipeline/worker.py` POSTs
`/jobs/<job_id>/published` with the family code (env `HOMECOOKD_API_URL`), failures logged not fatal.

---------------------------------------------------------------------------------------------------
## 5. Screens: binding the bible to real data (screen agents read their bible files first)

- **Profiles (Main)**: cooks + learners grids exactly as bible; subtitles from data: cook with unread
  questions -> "Leo asked you" (green), else "N recipes"; learner with an unread recipe -> "From Dad"
  + "New" badge, else "At home"/relation. "+ Add family" -> sheet (name, cook or learner) -> POST
  /profiles. Tapping routes to `kid/home` or `parent/home`. LaunchSplash plays first (motion spec 1).
  Retention PR 5: a small sun-yellow flame on the faces that did their part at the Sunday table this
  week (`GET /table` faces-only when nobody is picked; nothing on the others; not asked for when the
  phone goes straight to its person's home). Retention PR 7: the pot by "homecookd" (here and on the
  sign-in screens) wears a mood by the phone's clock: sleepy from 22:00 to 06:00 (eyes closed, two
  small z's), waving all Sunday (its right handle up as an arm; it rocks twice when the screen
  shows, nothing under Reduce Motion); sleepy wins on a Sunday night. Not on the launch bloom, photo
  placeholders, share images or recaps.
- **Kid Home**: day greeting + "Hi, Leo" + avatar (tap = switch person -> Profiles). Retention PR 5:
  right under the greeting, "This week at the table" (a compact row: up to 8 family faces, cooks
  first, me as "You"; a small flame on lit faces only, nothing on the others; "+N" when they don't
  fit, N = everyone in the family the row couldn't show, opens the family list; tap a face = our 1:1
  chat (a spinner over that face while it opens, the other faces dimmed and not tappable until it
  slides in or "That didn't open" shows), someone invited who hasn't joined = their "hasn't joined
  yet" sheet with Send again; my own
  face is not a button; a memorial person isn't on the row at all, neither a face nor in "+N" (it's
  this week's table: no standing unlit face, no chat that treats them as present; TODO(caleb) #5);
  hidden until `/table` answers and when nobody else (memorial people aside) is in the family; while it's on its way an
  empty space of the row's height holds its spot, so nothing under it moves when it lands, and it
  goes if no table comes: offline, an older server). Its header holds the peach "I miss home" pill (hidden until this family has a real
  recording with a voice): it opens a sheet with a family cook's face and name, the dish, her words
  as she says them, play/pause with the waveform, "Another" (never a clip from the last 7 days while
  others remain) and "Open the recipe"; it plays as it opens (the kid asked), stops on close, on
  "Open the recipe" and when Home loses focus, and a listen of 3 s or more logs `heard` (which lights
  the kid's face). The whole Home still fits a 375x812 phone down to "Explore more dishes": while
  the row shows, the gaps under the hero tighten and the hero card takes the height left (264-344;
  taller phones keep 344; under 290 the title drops to 28 pt so the line, often the cook's words and
  the live subtitle while Hear plays, keeps 2 lines). Retention PR 6: from the 1st to the 7th (first
  on Dec 1, for November), the olive "Your November in the kitchen" pill (the title and a 48 pt arrow; the month's line reaches
  VoiceOver through the label) takes the big "Invite family" button's place under the hero, at its
  64 pt height, until it's opened; "Invite family" moves a short scroll down, under "Explore more
  dishes". The hero and the fold stay exactly as on any other day. Nothing for an empty month,
  offline or before the server has the route (Invite stays in its place). TODO(caleb): where the
  month's card goes (the other ways: under the table row, which pushes Invite and Explore under the
  tab bar at 375x812; a pill beside "I miss home", no room at 375 pt; #2's "+" in the row). Nothing
  that arrives late moves what's on screen: while the card's first answer is on its way its slot is
  held (empty, Invite's height), the answer is remembered per person per month on the phone so a
  Home drawn again that week has it at once, and after a failed call a card found later appears
  only while Home is off screen. Only the block down to "Explore more dishes" is measured for the
  hero. TODO(caleb) #2: or a "+" at the end of the row instead of the big "Invite family" button. Hero = the latest
  `recipe` message sent to me ("Just in from Dad"), fallback newest recipe by a family cook ("From
  Dad's kitchen"); hero shows poster, title, one short real line (the send note, else the recipe's
  first quote <= 60 chars), "Hear Dad · m:ss" (plays that quote's step audio; hidden for samples)
  and a round arrow -> recipe. Retention PR 7: while it plays, the pill shows pause, a waveform that
  fills as the clip plays (14 bars in a fixed shape per dish, like voice notes in the chat; not the
  sound's real loudness) and the time left; paused, the words come back. When the chip's face is
  the voice that's speaking, a 2 pt sun ring pulses out from it every 1.2 s (Reduce Motion: a still
  ring). The Home still fits 375x812 down to "Explore more dishes". "Picked for you" horizontal cards with honest reasons from data
  (total_time <= 30 min "Quick tonight", soups/noodles "When you miss home", by a cook you haven't
  cooked from). Scrolled part: a real "Hear their voices" list (stories from recipes with audio:
  title + cook + clip length, plays the clip) and an "Ask {cook} about {dish}" card.
- **Kid Recipe**: hero photo with back + heart + share (share opens the share sheet), title, "by
  Dad · ~50 min · serves 6", quote card (a real quote), "Just me / Friends" segmented choice (copy
  from servings), Watch (whole recipe video) + Hear (first quote clip), sticky "Start cooking" ->
  ingredients. Logs a `viewed` event.
- **Kid Ingredients**: "Get these ready", checklist of `feel` (big, the cook's words in quotes) +
  `estimate` (small), "N of M" pill, persisted per recipe+profile; one collapsed dropdown for
  peripheral help (e.g. low-confidence amounts with "Ask Dad"); sticky "Start step 1". Retention PR
  7: the pill holds a tiny pot that fills green from the bottom (done / total; the lid too when
  everything is out; it glides 260 ms, jumps under Reduce Motion), and a ticked row's big words get a
  light green hand-drawn strike-through, one wobbly stroke per line, drawn left to right in 260 ms
  (rows ticked before the screen opened show it drawn; unticking fades it; Reduce Motion fades it in).
  The estimate line is never struck.
- **Kid Step**: "Step N of M" + one small pot per step under it (retention PR 7: 10-16 pt, filling
  green as steps are reached, 240 ms fade each; a jump from "All steps" fills the new ones 45 ms
  apart; a recipe with so many steps that the pots would be under 10 pt keeps the old bars; the
  "Step 3 of 8" button still opens the sheet), media box (step still `image_url` / poster; tap
  play -> plays the step's clip inline), instruction big (Fraunces) with its key cue, Watch m:ss / Hear
  Dad m:ss pills, ONE "More from Dad" dropdown (Kid-Step-Open: quote card, "In this step"
  ingredients with feel + estimate, a "Look for" sensory cue, story/special callouts, and a small
  "Ask Dad about this step" link that opens the chat with a `step` message auto-sent), back chevron
  + "Next step". A step with a "what made it special" note shows a small sun "Special" chip that
  opens the dropdown. Last step: "I made it" -> `cooked` event + `cooked` message to the cook ->
  SuccessBurst ("You made it" / "We told Dad.": facts only, never what the cook will feel; "You made
  it" alone when the note couldn't go). Retention PR 7: three steam curls draw on above its badge and
  rise away (Reduce Motion: they fade in and stay). No extra line: the handoff's "Mom would be proud"
  speaks for the cook, and a last-step quote shown as a send-off would put her instruction in a
  place she never said it. Then, when the dish's cook is someone else in the family
  (not a memorial profile), the postcard (retention PR 3): a flat peach tile with a camera (a
  picture of the postcard to be, not a button) over "Show Dad how it came out", one big shutter
  ("Take a photo", the camera; "Choose a photo" for the library), and once there's a photo, the
  photo in a cream frame, "How close to Dad’s?" with 5 pot buttons (outlined in `muted` until chosen;
  optional: tap one, tap it again to take it back; TODO(caleb): pots vs dumplings) and "Send to Dad"
  (upload -> `POST /messages/:id/postcard` on the `cooked` card just sent, so Dad keeps one card per
  dish made; if that card couldn't send, this sends it). While it sends, the quiet links and the pots
  wait (dimmed links). Sent: the postcard flies up and away with a little turn (a fade under Reduce
  Motion), a toast "Sent to Dad", back to the recipe. Not sent: the button says "Try again" and a
  toast at the top of the screen (an x, clear of the button) says the server's reason for a refusal,
  or "Couldn’t send it to Dad. Try again." when it was the network or the server. Quiet links: "Take
  another" / "Choose a photo", "Not now" (back to the recipe), "Share with someone else" (the existing
  share sheet; stays on the postcard). No note field (QA's one-line note was dropped: the handoff's
  postcard has none). My own dish, or a cook outside the family: the
  share prompt as before ("Want to share the love?", "Send to someone", "Not now"). For a learner, a milestone changes only the burst's title (retention PR 4): the
  1st, 5th or 10th distinct family dish ("Your first family dish", "5 family dishes", "10 family
  dishes") or the last of a family cook's dishes ("Keeper of Grandma’s kitchen"), from my stats as
  they were before this cook, and only once the server has answered them (never offline guesses)
  and saved this cook's `cooked` event (if it failed, the usual title); samples, YouTube and my own dishes never count. The screen stays awake while cooking (expo-keep-awake, its own
  tag), with a one-time toast "Screen stays on" per person, shown only once the phone (or browser)
  has really agreed to keep it on (on another cook's dish, after the "Let Dad see" question below
  is settled; a call that failed counts as settled). When the "I made it" flow ends and the
  cook was told, the push explainer may rise over the recipe ("Want a note when Dad answers?"; never
  on the first launch, a lent phone or within 30 days of "Not now"; only in a build that can push).
  "Leo is cooking" (retention PR 2): on another family cook's dish, opening cook mode tells the
  server at once and each step change 2 s later; "I made it" (first, waiting 2 s at most) and leaving
  end the session. The first time, one sheet asks "Let Dad see when you cook their dishes?" with "Each
  cook in the family gets a note when you start one of their dishes." [Yes] / Not now. Only a tap
  on a button answers (no close button, no backdrop tap, no drag, so no grabber); "Not now" is saved
  and shares nothing, ever. The Android back button (Escape on web) only closes it for this visit:
  nothing saved, asked again next visit. Never asked about a memorial cook (the server answers "no"
  for their dishes and stores nothing). While shared,
  the 1:1 with the cook is checked every 10 s for a heart: a heart pops in the middle with a few
  particles and a toast "Dad sent you a heart" (fades in place under Reduce Motion). Changing the
  answer later needs a home for `ShareCookingRow` (TODO(caleb): there is no kid profile sheet; the
  `/?pick=1` foot, which holds the phone's own settings, is the candidate).
- **Kid Recipes (Browse)**: "Our family table", "N recipes from M cooks", search (title/cook, live
  filter) with mic icon (decorative unless voice search is built), cook chips (Everyone selected =
  sun), sections per kitchen with rows (thumb, title, reason/meta line, heart toggle persisted).
  Retention PR 7: a heart that goes on (here, on photo cards and the recipe hero) bursts into 8 tiny
  particles (dots and little hearts, red / sun / peach) that fly a few points out and fade in about
  half a second, behind the glyph, which never moves or scales. Nothing under Reduce Motion.
  Retention PR 4 (learners only): a family cook's chip opens with her face and "You can cook 4 of
  Grandma’s 7" over a dot per dish (filled = cooked, in list order, only while 12 or fewer fit),
  "Keeper of Grandma’s kitchen" + the stamp once all are cooked, and "Grandma’s 7 dishes" before the
  first (no count, no nudge); a cook with no counted dishes (samples, YouTube, a relative who isn't in
  the family) has no header. Each of her dishes I cooked has a small hand-drawn stamp after its
  activity words. Counts come from my own `/me/recipe-stats` and wait for its first answer. The first
  heart I leave on another family cook's dish shows the toast "Grandma sees your hearts", once per
  profile on this phone, only after the heart is saved, and only when `GET /family` says that cook
  isn't a memorial profile (`memorial: false`; a memorial cook or a missing flag shows nothing and
  leaves the note for a later heart).
- **Messages inbox (kid Ask / parent Messages)**: bible Kid-Messages / Parent-Messages exactly. Kid:
  "Ask your family" + "They answer in their own voice." + thread rows (avatar with unread dot, name,
  time, dish chip, preview: "New voice note · 0:38" pill for voice) + dark "+ Ask about a dish" pill
  -> Ask sheet (pick a person, then a dish) -> chat. Parent: "Messages" + the top "Waiting for your
  answer" card for the newest unanswered learner question with "Answer with your voice" + rows.
  Poll every 8 s while focused; unread badge in the tab bar.
- **Chat**: kid layout = bible Kid-Chat (lavender bubbles for me, peach for the cook, voice bubble
  with play + waveform + duration and a "Show her words" toggle when a transcript exists, step chips
  "Step 3 · Roll the wrappers", recipe card bubbles that open the recipe, composer: text field +
  round dark mic). Parent layout = bible Parent-Chat (Back pill, name right, "About your <dish>",
  the waiting question ringed in sun, bottom panel with a huge "Tap to talk" mic + "Type instead";
  recording state = bible Parent-Chat--recording "Tap again to send"). Send = optimistic bubble that
  pops in (motion spec 5), then server confirm; poll every 3 s while open; marks read. Retention
  PR 5, 1:1 between a kid and a cook only: a small flame and "6 weeks" under the other's name in
  both layouts (only those two people ever see it; nothing for 0 or during an ember; never with a
  memorial cook), and at 4, 12, 26 or 52 weeks a one-time card "12 weeks at the table with Mom" over
  the chat for 2 s (SuccessBurst; never takes a touch; remembered once it has played, so a quick back
  tap leaves it for next time; fades under Reduce Motion).
- **Parent Home**: date + "Good morning, Mom"; under it "This week at the table" in big type (56 pt
  faces, 16 pt names; fewer cells, the rest in "+N"; same flames, taps and hiding as the kid Home,
  no pill), then "Record a new recipe", then the updates card, then "Invite family", and from the 1st
  to the 7th only (first on Dec 1) the "Your November in the kitchen" card after all of them, the last
  thing on the page (retention PR 6: bars, the title, a real line from the month such as "Your dishes
  were cooked 5 times" with two lines of room whatever its length, an arrow; gone once opened, for an
  empty month and offline). Nothing is held while its answer is on its way and nothing moves when it
  arrives: an empty month or a failed call leaves Home as on any other day, and a card fades in
  under Invite (a short scroll down when the updates card is full). TODO(caleb): where it goes. On
  top of the updates card while a kid is cooking one
  of my dishes, a live row per kid: avatar · "Leo is making your Sunday Chili" · a breathing green dot
  and "Step 3 of 8" (follows within 15 s) · a 48 pt heart that sends Leo a heart (light haptic,
  then a fill, a few particles inside the row and "Sent", or "Try again"); the row goes when the
  session ends. Live rows sit above the card's first 3 other rows and never push "is on a new phone"
  or a question behind "See all" (they still count in "N updates"); "Leo hearted your Sunday Chili"
  rows (retention PR 4: the newest 3 hearts on my dishes in the last 14 days, from `/hearts/recent`,
  mixed by time with "Leo made your …" but never above a question or "is on a new phone", which
  need an answer; polled with the inbox while Home is focused; face with a small red heart, the dish photo, an x that
  clears it on this phone; tap -> my recipe page; never a push); "Leo asked you" card (newest unanswered question to
  me: real quote + "About your <dish>" + "Answer with your voice" -> chat); "Leo made your <dish>"
  (latest `cooked` message about my recipe; with a photo it is a postcard, retention PR 3: Leo's
  photo in a cream frame tilted 1-1.5° (flat under Reduce Motion), "How close to yours" + the pots
  if Leo rated it, then two 52 pt pills side by side: "Just like mine" (sun; a medium haptic, then a
  "Just like mine" stamp lands on the photo's corner with a success haptic and the pill reads
  "Sent", disabled, also on the next visit) and "Hold to talk" (hold to record a voice reply right
  there: the pill turns red, "Let go to send", with the time so far ("0:04") on its top edge;
  letting go shows "Sending… Undo" for 3 s (6 s with VoiceOver / TalkBack; a thin bar runs down,
  none under Reduce Motion) and a touch on the pill then takes it back ("Not sent", nothing goes);
  otherwise it sends to our 1:1 answering the card, "Sending" -> "Sent" (it still goes if the row
  or sheet closes first); a hold under 0.8 s says "Hold longer"; only lifting the finger ends a
  hold: a thumb that drifts keeps recording and the page holds still, and a touch the phone takes
  away sends nothing and says "Not sent"; a VoiceOver / TalkBack double-tap hears how to record,
  "double-tap and hold", with a light haptic). A card in the family circle (older builds sent them
  there): the stamp stays under it in the circle, the voice reply goes to our 1:1 as a plain voice
  note. Leo gets a push for each. The words open my recipe, the x clears it; a postcard is a new
  row even if the plain one was cleared, and it lands within one inbox poll; until I answer it
  "Just like mine" it ranks at least as high as the newest "made" row and hearts never go above it,
  so its push ("Sent you a postcard.") never opens Home on a card that hides it behind "See all"); "Record a new recipe" row; pending uploads
  card when a recording is on its way ("Your <dish> is on its way to Leo. Ready by tonight.").
  Empty states for a cook with no recipes/messages (Mom today): warm, one clear action.
- **Parent Recipes**: "Your recipes" + "Kept for Leo, for Maya, and for their kids someday." (names
  from the family's learners) + list (thumb, title, activity line: "Leo watched it 3 times" /
  "Leo cooked it ✓") + request card for an open `request` message (date tile + "Record it" / a real
  reminder if built). Retention PR 4: under "Your recipes", faces + "Leo can cook 4 of your 7.
  Maya, 2." (kids first; only her real dishes; never a remembered person; hidden until someone has
  cooked one); on each card,
  under the activity line, one line: "♥ 4 · cooked 3 times" and up to 3 small faces of who cooked or
  hearted it (each zero part hidden, no line at zero; hearts from everyone in the family but her,
  samples included). The words stay whole and the faces take only the room left beside them (fewer
  with "+N", or none on a narrow phone; the card's label still names who), so a card is never taller
  than its title + 2 lines. When that line says it was cooked and its faces on screen show everyone
  who cooked it, the activity line skips "✓ Leo cooked it" and shows the next true thing (opened, sent,
  the recipe's facts); when the faces don't fit, it keeps "✓ Leo cooked it". "Opened it" never names
  someone who cooked it. TODO(caleb): or always keep "✓ Leo cooked it" above the line (who in words).
- **Parent Recipe**: hero + "Watch yourself · N min", title, "Sent <date>" (from activity), quote
  card, "♥ 4 · Leo, Maya, Dad" (who hearted it, newest first, three names then "+N"; hidden at 0;
  retention PR 4), "Who cooked it" (learners: cooked ✓ with their note, or "Not yet" + "Send to Maya" which uses
  `/send-recipe`), "Leo asked you" card for a question about this recipe + "Answer with your voice".
  Share icon in the hero opens the share sheet.
- **Parent Record**: "What will you teach today?", request chip ("Leo asked for Sunday Eggs") when
  one exists, the 3-step guide with the tripod photo, "Start recording" (camera, video) and "Use
  videos I already took" (library). Both continue to **Send**.
- **Send**: "Send your <dish name or 'recipe'>" (title field if unknown), Today's videos (thumbs,
  selectable, green ring + check), "Who is it for?" chips (learners + Everyone; dark ink when
  selected), "Add a hello" (voice note, optional), big "Send to Leo" ActionButton (retention PR 7:
  "Wrapping…" beside the spinner while it works, also its VoiceOver label then) -> starts the
  existing background upload (`lib/uploads.ts`), POSTs `/pending-sends`, SuccessBurst ("On its way to
  Leo"; retention PR 7: a paper plane in the badge that lifts off up and to the right, and under the
  title a small pot whose lid settles on beside "You can close the app"; Reduce Motion: fades only).
  Uploads need native; on web show a
  friendly "Open homecookd on your phone to send videos". After the burst (on the Recipes tab), the
  push explainer may rise once: "Want a note when Leo writes back?" (same rules as cook mode's;
  "…cooks it?" from PR 2).
- **Push asks (all screens)**: the explainer sheet shows at most at three moments: after "I made it"
  (above), after a learner's question reaches the server (any chat), and after a cook sends (Send,
  or "Send" on a recipe's "Who cooked it"). Yes -> the OS prompt; Not now / close -> nothing for 30
  days. Tapping a push opens its screen (a chat, or a dish where that person's dishes live); a push
  for someone else on a shared phone opens "Who's in the kitchen?". A tap that launches the app is
  held until someone is in, and opens only if they are the one it was sent to (else "Who's in the
  kitchen?"). The cook's Send asks a beat (0.6 s) after the button shows "Sent".
- **Postcards in the chat (retention PR 3)**: a `cooked` card with a photo shows the photo as a
  postcard (cream frame, a 1-1.5° tilt, flat under Reduce Motion) over "Leo made your Sunday Chili",
  with the pots under it when it was rated; "Just like mine" is the stamp under it (below), and a
  voice note held down on the Home card arrives as an ordinary voice note. A postcard that lands on
  a card while the chat is open shows within ~10 s (the chat watches the inbox's `postcards` count
  for 30 minutes after a card from someone else).
- **Reactions in the chat (retention PR 2)**: never a bubble or a raw "heart". One that answers a
  message in the log ("Just like mine" on a dish someone made) is a small stamp under it, on the
  bubble's side ("♥ “Just like mine.” · Mom"); a heart sent mid-cook answers nothing, so it is a quiet
  centred line where it was sent ("♥ Mom", "♥ You" on the sender's side; a few taps in a row show
  once). Reactions never close a question, never show a dish card, never become an inbox preview or
  a profile line, and never count as unread (the server keeps them out of `last` and `unread`).
  A heart after my message doesn't take my "· Sent" away. A quiet line (a heart, a system note)
  carries no time, so when one opens the day, the cook's chat (no day lines) names the day on the
  next time line ("Today, 6:40 pm", not "6:40 pm" under yesterday's).

### Month in the kitchen (`recap.tsx`, retention PR 6, RETENTION-HANDOFF 3.7)
Opened by the Home card (the 1st-7th) or the 1st-of-month push (`/recap?month=YYYY-MM`; missing or
malformed = last month). The first edition is November 2026 (Dec 1); an earlier month opens as an
empty month. A full-screen modal of story slides, one per screen in a Hearth colour:
thin progress bars and "2 of 7" on top, a round Close (and Share on a phone), Fraunces titles whose
numbers carry the slide's accent, the homecookd mark at the foot, a round Back and a big Next at the
bottom (Done on the last slide); a tap on the left third goes back, anywhere else forward; no timer.
Kid: cover, "You cooked 3 family dishes" with their postcards, "Most made: Dad's Sunday Chili, twice"
with the poster and Dad's face, "40 minutes of family voices" with "Hear Grandma · 0:45" (never plays
by itself; the cook's exact words under it; only this family's own recordings; pauses on another
slide, stops on close; a listen of 3 s or more logs `heard`), "Hearts you left: 5", Then & now (needs
2 photos), close. Cook: cover, "Your dishes were cooked 5 times" with each kid's face once (no counts
per kid), "Most loved: Sunday Chili (♥ 4)", "Postcards you got: 2", "Questions you answered: 3",
close. Each slide shows only with data. Opening a non-empty month marks it opened (the Home card
goes). Loading on the cover's colour; an empty month "A quiet November in the kitchen" + Done; a
failed load "Couldn’t load your month" + Try again (nothing marked opened); no person yet "Pick who
you are first". Share renders the slide (colour, photos, numbers, the mark) to a PNG and opens the
system share sheet; it waits for the slide's photos; hidden on web; a failure says "Couldn’t share
that one. Try again." Close with nothing under it lands on the person's Home. Reduce Motion: quicker
plain fades. TODO(caleb) #4: no cookbook offer until printing exists.

### Share sheet (Spotify-like; `components/share/ShareSheet.tsx`)
BottomSheet (cream `#FFFDF7`, grabber) containing: (1) the big card, ~half the sheet: dish photo
(square, radius 20), dish name (Fraunces 24), "by Dad · 50 min", homecookd pot mark + wordmark; card
background follows the selected swatch; (2) swatch row: 3 circles (peach `#F9E3CF`, sage `#E6EBCF`,
ink `#1E2410`; selected = ring); (3) hairline; (4) "Send in homecookd" row: horizontally scrolling family
profiles (64 px avatars + names; not the current user); tap -> `/send-recipe` -> avatar shows a spinner
then a green check + "Sent"; (5) hairline; (6) external row: round 64 px buttons with labels: Copy link
(clipboard + toast "Link copied"), Messages (`sms:&body=`), WhatsApp (`whatsapp://send?text=`), More
(system share). The link comes from POST `/shares` (create once per open, reuse). Message text:
"<Dish> from <cook>'s kitchen, on homecookd: <url>".

---------------------------------------------------------------------------------------------------
## 6. Web recipe page (Vercel, `web/`)

Route: `web/src/app/r/page.tsx` (static export compatible; reads `?s=` on the client). Hidden: not
linked from the lander, `robots: noindex`. Generic OG/meta: "A family recipe on homecookd".
Flow: `GET /shares/:token` -> fetch `recipe_url` from the bucket -> render. Bad token: warm error with
a link to `/`.
UI: the app's kid UI on the web, pixel-matched to the bible (same tokens, Fraunces + DM Sans which the
lander already loads, same components re-implemented in CSS modules): a 430 px max-width phone column
centred on `#F7F7F2` (desktop shows the column with a soft shadow; mobile is full-bleed).
- Top bar like Spotify web: homecookd pot + "homecookd" wordmark left, white "Get the app" pill right.
- A small banner card: "<Sender> sent you this recipe" with their avatar (if a sender).
- Screens inside the column (client-side state, no route change): Recipe (bible Kid-Recipe) ->
  Ingredients (Kid-Ingredients) -> Steps (Kid-Step / Step-Open) with working Watch/Hear (HTML video /
  audio with start/end ranges), checklists, dropdowns.
- Floating bottom bar (Home | Recipes | Ask) exactly as the app, Recipes shown active; Home, Ask, the
  heart, "Ask Dad", other recipes -> **Get the app** popup: Spotify style: a coloured card (green
  `#5B6F00` with cream text, or ink) anchored above the tapped tab with a small pointer, title
  ("Hear Dad's answers in the app" / "Your family's recipes live in the app" etc., specific to what
  was tapped), one line, "Not now" text button + white "Get App" pill. Get App -> the app hand-off
  sheet (`GetAppSheet`): "Join <family> on homecookd", Get the app (copies the link, then the store)
  and Open homecookd (`homecookd://r?s=`). No email sign-up on the web any more.
- `/i?t=` is an invite's web page (`components/invite/`): who sent it, "You're joining as Dad.", the
  same hand-off and the 6-letter code. It only peeks; joining happens in the app.
- Motion: same spec (CSS transitions / `motion` library already in web deps): press scale, sheets,
  success burst, popup pop-in.
- Write `docs/build/WEB-VISION.md`: the vision (anyone with a link gets a limited web app on our
  domain, then signs up), what is built, what's next (per-recipe OG images via a serverless route,
  deep link into the installed app, App Store link, magic-link accounts).
Deploy: `npx vercel@latest --prod` from `web/` (already linked, logged in). Set `NEXT_PUBLIC_API_URL`
and `NEXT_PUBLIC_BUCKET_URL` (public values) in a committed `web/src/lib/config.ts` default or via
`vercel env`. Never break the lander: run `npm run build` and check `/`, `/learn`, `/teach` still load.

---------------------------------------------------------------------------------------------------
## 7. Verification (everyone)

- Typecheck: `cd app && npx tsc --noEmit`; lint: `npx expo lint`. Web: `cd web && npm run typecheck
  && npm run build`.
- Visual: an Expo web dev server runs at `http://localhost:8090` (started by the orchestrator in a
  terminal tab; do not start another). Screenshot: `node /Users/calebwang/Documents/GitHub/homecookd/app/scripts/shot.mjs <route> <out.png>`
  (headless Chrome 390x844 @2x, waits for the app to render; route may include `?as=leo`).
  Compare side by side with `docs/design/hearth-bible/renders/<Screen>.png` and fix differences in
  spacing, size, weight, colour, radius, shadow and copy until they match.
- Backend: curl the endpoints (test family for writes). App screens read the demo family.
- Never commit secrets: `.env*` are gitignored; the family code never appears in code or logs.

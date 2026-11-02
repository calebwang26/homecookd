# homecookd API (Supabase edge function `api`)

Base URL: `https://qeiednrjkiyzbolkepbk.supabase.co/functions/v1/api` (app: `EXPO_PUBLIC_API_URL`,
pipeline: `HOMECOOKD_API_URL`). Source: `supabase/functions/api/index.ts`, schema:
`supabase/migrations/*.sql`, seed builder: `supabase/seed/build_seed.py`.

JSON in, JSON out. Every response carries CORS headers (`access-control-allow-origin: *`; allowed
headers `content-type, x-device-key, x-family-code, x-profile-id, x-tz, authorization, apikey,
x-client-info`; methods `GET, POST, OPTIONS`). `OPTIONS` on any path returns `204`.

## Auth

| header | meaning |
|---|---|
| `x-device-key` | **This phone's own key** (43 characters, base64url). New app builds send this. Handed out once by `POST /auth/apple`, `/auth/google`, `/invites/accept` or `/devices` (family code only); store it in SecureStore and never show or log it. A revoked or unknown key gets `401 "This phone was signed out."` (exact text: clear the key and go to sign-in). |
| `x-family-code` | The family code. Old builds and the pipeline still send it; it works as before. Used only when there's no `x-device-key`. Compared case-insensitively, surrounding spaces ignored (looked up by `sha256(upper(trim(code)))`). |
| `x-tz` | Optional, on any signed-in call: the phone's IANA time zone (`America/New_York`). Stored on the acting profile when it changes (best effort, after the response; anything that isn't a zone name is ignored). Quiet hours, Sunday weeks and the 1st-of-month recap run on it; a profile with none counts as `America/Los_Angeles`. |
| `x-profile-id` | The acting profile (a `Profile.id` from `GET /family`). Must be someone still in the family (a removed person: `403`). Someone with their own phone can only be acted as from that phone (anyone else, the family code included: `403 "Dad uses their own phone."`, reads too). Nobody writes as someone only invited (`403` until they join). A phone that joined through a family invite and has no person yet writes as nobody: any non-`GET` with an `x-profile-id` is `403 "Add yourself first."` (reads are fine). Required where marked **me**. |

One of `x-device-key` / `x-family-code` is required on every route except the public ones:
`POST /auth/apple`, `/auth/google`, `/invites/peek`, `/invites/accept`, `/auth/email`, `/signup`,
`/web-events` (the lander's visit log), `GET /shares/:token`, `POST /events` without a key or
code (an early lander beacon; new clients use `/web-events`), and `POST /cron/hourly` (its own
`x-cron-secret`).

No Supabase JWT is needed: the function is deployed with `verify_jwt=false` because it does its own
auth. Every table has RLS on with no policies and no grants for `anon` / `authenticated`, so the
public Supabase keys can read nothing; only this function (service role) touches the data. Voice
notes live in the private `voice` bucket and are only reachable through signed URLs this API hands out.

### Security model
- **Device keys.** 32 random bytes per phone, returned once; only `sha256(key)` is stored
  (`devices.key_hash`). Each phone can be signed out alone (`POST /devices/revoke`, or removing the
  person). Unknown keys count against the same per-IP budget as wrong family codes (20 per 10 min);
  a revoked key doesn't. `last_seen_at` is bumped at most every 10 minutes.
- **Whose phone it is (set once, never moves on its own).** A key from Apple, Google or a named
  invite belongs to that person for good. A key with no person yet gets one in one conditional
  update (`… where profile_id is null`), so an owner is never replaced:
  - **family invite** (`via: "invite"`): only by adding itself (`POST /profiles/self`) or by a move
    request someone else approves (`POST /move-requests`, see below). Until then every write as an
    existing face is `403 "Add yourself first."` and never sets its person, so whoever opens a
    forwarded link can't become Dad by tapping his face. Reads as phone-less faces still work;
  - **family-code swap** (`POST /devices`, `via: "code"`): as before, the first time it writes (any
    non-`GET`) as someone with no phone of their own who isn't only invited, or when it adds itself.
    The first write counts even if the route then refuses it (a `400`), as the old rule did.

  Once a phone has its person, writes as other phone-less people (Grandma on Mom's iPad) leave it
  alone, and a `GET` never sets it (the Profiles screen reads everyone's lines as each person).
  Removing its person signs it out.
- **Faces with their own phone are locked.** Once someone has a live key that is theirs, only that
  phone can be them: any request with their `x-profile-id` from another key, or with the family code
  (old builds), is `403 "Dad uses their own phone."`, reads included, so their 1:1 chats stay theirs.
  `GET /family` ignores a locked `x-profile-id` instead (a phone that remembers them still loads) and
  marks them `locked: true`. People without a phone (Grandma on Mom's iPad) can still be picked from
  any phone in the family. Signing their phone out (or removing them) unlocks them. The live keys
  are read once per request (also for `has_phone`).
- **Nobody writes as someone only invited.** Until Dad taps his own link, any non-`GET` with his
  `x-profile-id` from a phone that isn't his is `403 "Dad hasn't joined yet. Pick your own face."`
  (else Mom's phone could post messages, questions or notes "from Dad"). Reads still work.
  Only invited means a pending link and nothing else: someone who has signed in, or already sent a
  message (not a system note) or an invite (Grandma, used on Mom's phone before she got a link of
  her own), isn't only invited.
  `POST /devices` takes only the family code; a key can't make a second key that would belong to
  nobody. Emails (old builds' sign-in, which returns the family code) can only be set with the
  family code, so a key can't be traded for the code that way.
- **Moving to a new phone.** Dad lost his phone and joined again through a family link: his new
  phone has a key with no person. It asks to be Dad (`POST /move-requests`, posts "Dad is on a new
  phone." in the circle). Someone else in the family who is **settled** and **on their own phone**
  (their key's person is their `x-profile-id`: not a lent phone, not the family code) lets him in.
  Settled: their first phone joined over 24 hours ago (their earliest key, signed out or not; with
  no key ever, when they were added), or they're the family's first person (the earliest added,
  counting people who have left: if the founder leaves, nobody inherits it). So someone who joined from a forwarded link a minute ago can't let anyone in:
  they get `[]` from `GET /move-requests` and `403 "You can do this after your first day here."`
  from approve / decline. Approval is one
  conditional update (`pending → approved`, first answer wins), then the asking phone becomes Dad's
  (conditional on it still having no person and not being signed out), then every other live key
  that is Dad's is signed out (the lost phone gets `401 "This phone was signed out."`) and links sent
  to him earlier stop working. One pending ask per phone (a partial unique index); an ask lives 7
  days (`expired` is computed, never stored). Nobody can approve an ask to be themselves, and the
  person asked for doesn't see it in their list (so a stranger asking to be Mom is answered by
  someone else). TODO(caleb): any current person can be asked for, phone-less faces and people only
  invited included; approval is the only check.
- **Sign in with Apple / Google.** The id token is checked with `jose` against the provider's
  published keys (cached in the function): signature (RS256), issuer, audience, expiry. Its `sub` is
  the person (`identities`, one row per account); `email` is kept when present. Audiences come from
  `APPLE_AUDIENCES` (comma-separated; default `host.exp.Exponent`, Expo Go, plus `APP_BUNDLE_ID` in
  the code once known) and `GOOGLE_CLIENT_IDS` (comma-separated, the web client id first; empty =
  Google answers `503`). **TODO(caleb), launch blocker:** put the bundle id in `APPLE_AUDIENCES`
  before any TestFlight / App Store build. Until then those builds' Apple tokens answer `503 "Apple
  sign-in isn't set up for this version yet. Try an invite link."` (the function logs the refused
  audience). TODO(security): drop `host.exp.Exponent` then, since any Expo Go project can get Apple
  tokens for it; no nonce is checked yet.
- **Invites.** Each link is a 16-character token (`/i?t=…`) plus a 6-letter code to type, both
  stored only as sha256. Used **once** (a single conditional `UPDATE … WHERE status='pending'
  AND expires_at > now() RETURNING`, so two taps can't both join) and dead after 14 days. Two kinds:
  a **family invite** (`POST /invites {}`, the usual one since Oct 17) names nobody: Join gives the
  phone a key with no person, and it then adds itself (`POST /profiles/self`) or asks to move in as
  someone already here (`POST /move-requests`); removing whoever sent it turns it off. A **named
  invite** (`{ name, role }`, older builds and "Send again") is for one person, whose face exists
  already; a re-invite
  or removing that person turns it off. Only `POST /invites/accept` (the Join tap) joins; peeking or
  previewing never does. "<Name> joined." goes into the circle when a named invite is used, or when
  a family-invite phone adds itself. Misses
  count against the IP (20 per 10 min), on top of each route's own limit. A typed code (6 letters,
  so guessable, unlike a link) is also counted **before** it's looked up: 20 per 10 min per IP and
  100 per 10 min across the whole service, so many IPs together can't sweep the codes. Past the
  service-wide budget codes answer `429 "Invite codes are busy right now. Tap the invite link
  instead."` (logged as `ALERT invite codes`); links are never slowed.
- **Recipe-link sign-ins can't take someone over.** Apple / Google with a `share_token` becomes an
  existing same-name person only when that person was invited ("+ Add family": a pending,
  unexpired invite), hasn't joined (no Apple/Google account, no live phone, no email) and isn't the
  link's sender (whose name the public `/r` page shows). Anyone else is `409 "Mom is already in this
  family. Try another name."`. Old builds' email path skips the invite check (their "+ Add family"
  made no invites) but has all the others.
- **Removal.** Nobody removes anyone else. `POST /profiles/:id/remove` takes only the acting person
  out: from their own phone (which is then signed out), or, for someone with no phone of their own,
  from any phone acting as them (Grandma on Mom's phone; Mom's phone stays in). Anything else is
  `403 "Only <Name> can remove themselves."`. It revokes the person's phones (every key that belongs to
  them, code-swapped ones included), their invites and the family invites they sent (those let
  anyone in, them included; a named invite they sent for someone else stays, since it can only
  become that person), declines pending asks to move in as them, unlinks their Apple/Google account
  and email, and
  hides them from every list (`GET /family`, circle members, `/send-recipe`, `/questions/open`
  askers, recipe activity). Their old messages, 1:1 chats (still in the inbox, marked `removed`,
  read-only) and recipe notes keep their name and face (`former_profiles`; notes embed the author).
  Someone only invited can't be written as, so they can't leave until they join (or their invite
  expires). Limits, until old builds are gone:
  - a request that sends the family code itself (old builds, the pipeline) can't be signed out; it
    just can't act as the removed person any more;
  - the family code can't be changed, and `POST /auth/email` hands it to anyone holding a `/r`
    link, so removal can't keep out someone who has it (they can swap it for a new key).
    **TODO(caleb):** retire `/auth/email` (or add family-code rotation) once old builds are gone;
  - a removed person can come back as someone new through any of the family's `/r` links (their
    Apple/Google link was dropped). **TODO(caleb):** decide whether removal should also turn off
    the links they sent.
- **Rate-limit keys** are an HMAC of the IP / email (key derived from `EDIBLE_CODE_KEY`, else the
  service key), so a stored `rate_hits` key can't be turned back into an IP.

The family code is still made for every family and kept AES-GCM encrypted in `families.code_enc`
(key derived inside the function from the `EDIBLE_CODE_KEY` secret if set, else the service role
key; the family id is bound in as AAD), because old builds sign in by email and get the code back.
Families created before Oct 16 get it the first time any device calls with the plain code. If the
key ever changes, each family re-seals on its next call.

> **TODO (security, before launch): emails are not verified.** The app no longer signs in by email
> (it uses invite links, Apple and Google), and neither does the web, but old TestFlight builds
> still can, so `POST /auth/email` stays. It trusts the typed email: anyone who knows a family
> member's email gets that family's code, and anyone holding a `/r` link can join that family with
> any unused email (and so get its code too).
> Turn it off (or email a one-time code) once old builds are gone. Until then:
> - a system note goes into the family circle on every known-email sign-in ("<Name> signed in on a
>   new phone") and every share-link join ("<Name> joined from Dad's link");
> - one link lets at most 5 people join (then `403`; `POST /shares` hands out a fresh link);
> - the route is rate-limited (20 per 10 min per IP, 5 per hour per email). Limits live in Postgres
>   (`rate_hits` + `hit_rate()`), so they hold across edge isolates. The IP is `cf-connecting-ip`,
>   else `x-real-ip`, else the last `x-forwarded-for` hop (never the client-set first one).

Test family for write tests: the code is in `docs/build/.test-family-code` (gitignored, one line).
Read it into a variable; never print it. The demo family (code = `FAMILY_CODE` in the root `.env`)
is what the app shows; don't write test data into it.

```bash
API=https://qeiednrjkiyzbolkepbk.supabase.co/functions/v1/api
TC="$(tr -d '\n' < docs/build/.test-family-code)"
curl -s "$API/family" -H "x-family-code: $TC"
```

## Which app builds call (off)

`supabase/functions/api/appBuilds.ts`, switched off: `LOG_APP_BUILDS = false`. When it's on, every request but
`OPTIONS` is read for its build. The build comes from iOS's own user agent (`homecookd/6 CFNetwork/… Darwin/…`, and
build 6 is 1.0). OkHttp counts as `android` and a browser as `web`, both with build `unknown`. Anything else is `other`
(the pipeline, `pg_net`, `curl`, a user agent over 512 characters). Each isolate upserts a (UTC day, platform, build)
into `app_builds_seen` once, after the response, with a 2 s timeout and at most 50 a day. A failed write is logged by its
kind only and never changes the answer. Nothing else is kept: not the user agent, the IP or the person. Rows go after
120 days. Turning it on and reading it: `docs/build/CUTOVER.md`, step 13.

## Errors

Always `{"error": "<human sentence>"}` with:
`400` bad input (also `"Only a phone that just joined can ask to move in."`, `"You can't let
yourself in."`), `401` missing / unknown family code, a revoked or unknown device key (`"This phone
was signed out."`) or a bad Apple / Google token, `403` `x-profile-id` not in this family or removed,
someone with their own phone acted as from elsewhere (`"Dad uses their own phone."`), or invited and
not joined yet (on a write), a family-invite phone with no person writing as anyone (`"Add yourself
first."`), answering a move request from a phone that isn't yours (`"Only someone on their own phone
can let people in."`) or before your first day (`"You can do this after your first day here."`),
removing anyone but yourself (`"Only Dad can remove themselves."`), or not allowed (e.g. a learner saving to a recipe, a full share link, an
email from a phone with a key, a message to someone removed), `404` unknown route /
thread / recipe / message / share token / invite, `405` wrong method, `409` duplicate (name or email
taken), already delivered or already joined, a phone that already has its person (`POST
/profiles/self`), a move request already answered (`"Already handled."`) or whose phone stopped
waiting (`"That phone isn't waiting anymore."`), `410` an invite that was used, expired or turned off
(body also has `status`), a move request older than 7 days (`"That request expired."`), `413` body
over 64 KB, `429` too many bad codes or keys (20 per 10 min per IP), sign-ups / new families (5 per
hour per IP), email sign-ins (20 per 10 min per IP, 5 per hour per email), Apple / Google sign-ins (30 per 10 min per IP), `POST /profiles/self` (30 per family per
hour), `POST /move-requests` (30 per family per hour), invites (50 per family per day, both kinds;
peek 60 and accept 20 per 10 min per IP; typed codes 20 per 10 min per IP and 100 across the service),
lander events (120 per 10 min per IP), `POST /push-tokens` (30 per person per hour), `POST /cooking`
(kind `cooking`, 240 per person per hour), `POST /profile/share-cooking` (kind `share-cooking`, 30 per
person per hour), `POST /messages/:id/postcard` (kind `postcard`, 60 per person per hour) or wrong cron secrets (20 per 10 min per IP), `500` server trouble (safe to retry), `503` try again soon
(or Google sign-in isn't set up, or Apple / Google isn't set up for this build's app id).
The `error` text is written to be shown to people as is ("Upload the voice note before sending it").

## Types

```ts
type Profile = { id: string; name: string; role: "cook" | "learner"; relation: string | null; avatar_key: string | null;
  invited?: boolean;             // GET /family, POST /invites, POST /profiles/self: invited, not joined yet
  has_phone?: boolean;           // GET /family, POST /profiles/self: a live key is theirs
  locked?: boolean;             //   ...and it isn't the caller's phone: nothing can be done as them from here
  memorial?: boolean };         // GET /family (retention): remembered, not here; left out when unreadable
type Message = {
  id: string; thread_id: string; sender_id: string;
  kind: "text" | "voice" | "step" | "recipe" | "cooked" | "request" | "question" | "system" | "reaction";
  body: string | null;          // text / question / note / system note
  recipe_id: string | null;     // bucket recipe id, e.g. "dad-sunday-chili"
  step_order: number | null;    // 1-based step, for kind "step"
  audio_url: string | null;     // voice: fresh signed URL (valid 1 h), or a public recipe-audio clip URL
  duration_s: number | null;    // voice length
  clip_start_s: number | null;  // optional range inside the recipe video/audio
  clip_end_s: number | null;
  transcript: string | null;    // "Show her words"
  created_at: string;           // ISO, microsecond precision
  reply_to: string | null;      // the message this answers (always in the same thread)
  answered_by: string | null;   // questions only (see "Questions"): who answered it first
  answered_at: string | null;   //   ...and when. Both null = still open. Derived, never stored.
  saved_to_recipe: boolean;     // a recipe note was made from this message ("Saved to the recipe")
  note_id: string | null;       //   ...that note's id (for POST /recipe-notes/:id/remove, "Undo")
  photo_url: string | null;     // cooked: a photo of the dish they made, fresh signed URL (1 h); else null
  rating: number | null;        // cooked with a postcard: "How close to Mom's?" in pots, 1-5; else null (PR 3)
};
type ThreadSummary = {
  id: string; kind: "pair" | "circle";
  other: Profile & { removed?: true }; // pair: the other person (removed: true = read-only history).
                                // circle: stand-in {id:"family", name:"Family"}
  members: Profile[];           // everyone in the thread, family order (circle: every profile)
  last: Message | null; unread: number; recipe_id: string | null;
  postcards: number;            // cooked cards in it that carry a postcard (PR 3): moves when one lands
};
type RecipeNote = {
  id: string; recipe_id: string; step_order: number | null;
  question: string | null;      // the asker's words (body, else transcript); null for "Save to recipe"
  question_message_id: string | null; asker: Profile | null;
  question_audio_url: string | null;  // spoken question: fresh signed URL (1 h); null when typed
  question_duration_s: number | null;
  answer_text: string | null;   // body, else transcript
  answer_audio_url: string | null; // voice answer: fresh signed URL (1 h), or a public recipe clip
  answer_duration_s: number | null;
  answer_message_id: string; author: Profile; created_at: string;
};
```
```ts
type OpenQuestion = { message: Message; asker: Profile; thread_kind: "circle" | "pair" };
type MoveAsk = { id: string; profile_id: string; status: "pending"; created_at: string }; // POST /move-requests
type MyMove = { id: string; profile_id: string;                                          // GET /move-requests/mine
  status: "pending" | "approved" | "declined" | "expired";
  asked: string[]; let_in_by: string | null } | null;
type MoveRequest = { id: string; profile: Profile; created_at: string };                // GET /move-requests
type RecipeStat = {
  recipe_id: string;
  views: number; last_viewed_at: string | null;    // my "viewed" events (repeat opens within 30 min count once)
  cooked: number; last_cooked_at: string | null;   // my "cooked" events ("I made it")
  favorited: boolean; favorited_at: string | null; // my heart
  sent_to_me_at: string | null;                    // newest recipe card someone else sent me (1:1 or circle)
};
```
`ThreadSummary.recipe_id` = the newest message in the thread that names a recipe (for the dish chip).
The new `Message` / `ThreadSummary` fields are additive; old clients can ignore them.

**Kinds added Oct 16.** `question`: someone (normally a learner) asks; typed (`body`) or spoken
(voice fields), optionally about `recipe_id` + `step_order`. `system`: written only by the server
(e.g. "Sam signed in on a new phone"); `sender_id` = the person it's about; never counts as unread;
posting `kind: "system"` is a 400.

## The family circle

Every family has exactly one **circle** thread (`kind: "circle"`, all members, no fixed pair; in the
database `a_profile` / `b_profile` are null and a partial unique index allows one per family). Kids'
questions go there so any cook can answer. 1:1 `pair` threads are unchanged.

- **Answering**: a cook posts `text` or `voice` with `reply_to` = the question's id. The question is
  then answered (`answered_by` = the first such cook; later cook replies don't change it, a learner's
  reply doesn't count). If the question has a `recipe_id`, each cook answer is also saved as a
  **recipe note** (with the question's `step_order`). Without `reply_to` nothing is answered.
- **Unread** is per profile (`thread_reads`), like pairs. New profiles start with the circle read up
  to the moment they were added, so its history isn't "new" to them.
- **Members**: everyone still in the family, always (derived from `profiles`, nothing to join).
  Removed people leave the list; their old messages stay (draw them from `former_profiles`).

## Questions (circle and 1:1)

| where | what counts as a question | who answers it |
|---|---|---|
| circle | every `question` | the first **cook** other than the asker who posts with `reply_to` = it |
| 1:1 (pair) | a `question`, or a **learner's** `step` message with a `body` (a step question) | only **the other person** in the chat: their first post with `reply_to` = it. A `step` question is also answered by the next message that person sends in the chat (one not linked to a different question), for step questions sent before `reply_to` existed (before 2026-10-16 08:35 UTC; the demo's included) |

The asker's own replies never answer. When the answerer is a **cook** and the question has a
`recipe_id`, their `text` / `voice` reply with `reply_to` also becomes a **recipe note** for the whole
family (same as the circle; the note quotes the question and takes its `step_order`). A learner who
is asked something in a 1:1 answers it, but no note is made. Answered questions leave
`GET /questions/open` at once.


## Endpoints

### `GET /family`
```json
{ "family": { "id": "…", "name": "Our family" },
  "profiles": [ { "id": "…", "name": "Mom", "role": "cook", "relation": "Mom", "avatar_key": "mom",
                  "invited": false, "has_phone": true, "locked": true, "memorial": false }, … ],
  "former_profiles": [ { "id": "…", "name": "Sam", "role": "learner", "relation": null, "avatar_key": null } ],
  "device_profile_id": "…",
  "device_needs_profile": false,
  "move_requests_pending": 0,
  "can_manage": true }
```
Profiles are ordered by `sort` (Mom, Dad, Grandma, Leo, Maya in the demo family); removed people
are left out.
- `invited`: true when the person has a pending, unexpired invite and hasn't joined: never signed
  in (no Apple/Google account linked, no live phone) and never sent a message (system notes aside)
  or an invite. Show "Hasn't joined yet"; don't offer them as "me" (writes as them are `403` until
  they join).
- `has_phone`: true when a live device key belongs to them (Apple, Google, an invite, or a
  code-swapped / family-invite key whose person they are), so removing them signs that phone out.
  false for someone who only ever used the shared family code (an old build): removal can't sign
  that out.
- `locked`: true when they have their own phone and it isn't this one (with the family code: anyone
  with a phone). Show the face, but don't enter as them: every request as them from here is `403
  "Mom uses their own phone."`, reads included, so don't poll their status line either.
- `memorial` (retention, guardrail 2): true for someone the family remembers (set by SQL in v1;
  TODO(caleb): who sets it in the app). Never nudge about them, count them in a pair or address them
  as present. Read apart from the rest, so a database without the column still loads the family:
  then the flag is **left out** (never a guessed false), and the app treats a missing flag as unknown
  (no "Grandma sees your hearts"). Not on `former_profiles`.
- `former_profiles`: people who were removed. **Only** for drawing old messages (sender name and
  face); never list them or offer them as "me".
- `device_profile_id`: this phone's person, set once: who signed in on it (Apple, Google or a named
  invite), who it added with `POST /profiles/self`, who it was let in as (an approved move request),
  or, for a swapped family code, the first phone-less person it wrote as; `null` for the plain family
  code or a key with no person yet.
- `device_needs_profile`: true when this phone joined through a family invite and has no person
  yet. Show "Who's in the kitchen?" with "Tap + to add yourself."; + calls `POST /profiles/self`.
  Tapping an existing face (theirs on a lost phone) asks to move in (`POST /move-requests`); writing
  as anyone before that is `403 "Add yourself first."`. Reads as phone-less faces still work.
- `move_requests_pending`: how many asks to move in this caller can answer (`GET /move-requests`):
  `0` unless the caller is settled and on their own phone (this key's person is the `x-profile-id`).
  Use it for a badge. It is `0` when it can't be read, so it never stops the family loading.
- `can_manage`: the caller may answer asks to move in: settled (see Security model) and on their
  own phone. The caller is the `x-profile-id` (false when that's a lent or shared phone's person),
  else this phone's own person (false for the family code or a key with no person). `false` when it
  can't be read.

A removed or locked `x-profile-id` is ignored here (not `403`), so a phone that remembered them
still loads the family and can pick someone else.

### `POST /devices` (family code)
`{ "device_label": "iPhone" }` (optional, max 40; `label` also accepted) -> `{ "device_key": "…" }`.
Swaps a saved family code for this phone's own key (`via: "code"`). Call it once, save the key,
delete the saved code. The key has no person until it first writes as someone with no phone of
their own (`x-profile-id` on a `POST`); from then on it is theirs for good (see Security model). 30
per family per hour. With a device key instead: `400 "This phone already has its own key."`.

### `POST /devices/revoke` (device key)
-> `{ "ok": true }`. Signs this phone out (Leave / Sign out): the key gets `401 "This phone was
signed out."` from then on. `x-profile-id` isn't read (a phone can always sign itself out). `400`
with only a family code.

### `POST /auth/apple`, `POST /auth/google` (public)
`{ "id_token": "…", "name"?: "Dad", "role"?: "cook" | "learner", "share_token"?: "SE65stMwrw", "device_label"?: "iPhone" }`.
`id_token` from expo-apple-authentication (`identityToken`) or Google Sign-In (`idToken`). Apple
doesn't put the name in the token: send the credential's full name as `name` on the second call.

| case | response |
|---|---|
| known account | `{ "existing": true, "needs_name": false, "joined": false, "device_key", "family_name", "profile_id" }` and "<Name> signed in on a new phone" in the circle (not again for a repeat within 2 min) |
| new account, no `name` | `{ "existing": false, "needs_name": true, "suggested_name": "Dana" \| null }` (Google's `given_name`; Apple: null). Nothing is made: ask "What does your family call you?" (and, with no share token, Record a dish / Learn a dish), then call again with the same `id_token` |
| new account + `name` + valid `share_token` | joins **the share's family** (role `learner` unless given): `{ "existing": false, "needs_name": false, "joined": true, "device_key", "family_name", "profile_id" }`. A same-name person who was invited and hasn't joined (see Security model) is claimed instead (their role stays, their invite stops working); any other same-name person is `409`. Posts "<Name> joined from <sender>'s link". At most 5 joins per link (`403 "This link is full. Ask your family for a new one."`) |
| new account + `name`, no token | `role` required (`400`); a token that no longer works counts as `learner`. Creates "<Name>'s family" with this person: same shape, `joined: false` |

An account whose person was removed counts as new. Errors: `401 "That Apple sign-in didn't work.
Please try again."` (bad, expired or forged token), `503 "Google sign-in isn't set up yet."` (no
`GOOGLE_CLIENT_IDS`), `503 "Apple sign-in isn't set up for this version yet. Try an invite link."`
(a real token for an app id not in `APPLE_AUDIENCES` / `GOOGLE_CLIENT_IDS`), `503 "We couldn't
reach Apple just now. Please try again."` (the key set timed out or didn't come back as 200 JSON),
`409 "Dad is already in this family. Try another name."` (that name is someone who can't be
claimed), `429`. Don't auto-retry after a lost response; a second tap is safe (it signs in as the
account the first one made).

### `POST /invites` (me)
**Family invite** (the app's invite sheet, Oct 17): `{}` (no body is the same; neither `name` nor
`profile_id`). No profile is made: whoever opens it joins, then adds themselves. One use, 14 days,
the same daily budget. Make one per opening of the sheet and reuse it for every button there. ->
```json
{ "invite": { "id": "…", "url": "https://homecookd.app/i?t=Q7xk2LmP9aZt4BvR&c=K7QM2X", "code": "K7QM2X",
              "expires_at": "…", "profile_id": null, "phone": null },
  "profile": null }
```
Text: "Join our family table on homecookd: <url>".

**Named invite** (older builds; "Send again" for people invited that way). New person: `{ "name":
"Dad", "role": "cook", "relation"?: "Dad", "phone"?: "+1 (555) 010-2030" }` (the profile is made
now, same name rules and 30-person cap as `POST /profiles`, so their face shows right away; a blank
`name` is `400`, not a family invite). Again for someone who hasn't joined: `{ "profile_id": "…",
"phone"? }` (older links stop working; the last phone is kept). ->
```json
{ "invite": { "id": "…", "url": "https://homecookd.app/i?t=Q7xk2LmP9aZt4BvR&c=K7QM2X", "code": "K7QM2X",
              "expires_at": "…", "profile_id": "…", "phone": "+15550102030" },
  "profile": { "id": "…", "name": "Dad", "role": "cook", "relation": "Dad", "avatar_key": null, "invited": true } }
```
Put `url` in a text from the sender's own Messages ("Dad, join our family table on homecookd:
<url>"). The code rides in the link (`c`) so the web `/i` page can show "Or type this code in the
app"; it opens nothing the link's token doesn't, and the server keeps only hashes, so the link is
the only place it appears afterwards. `phone` is digits from the picked contact (`null` if
unreadable), only shown back; the server never texts anyone. `code` is for typing in the app
("Paste invite"). `409 "Dad is already in this family"` / `"Dad already joined."` (re-invite
someone signed in), `400 "You're already in."` (yourself), `429` after 50 invites per family per
day.

### `POST /invites/peek` (public; reads only)
`{ "token": "Q7xk2LmP9aZt4BvR" }` or `{ "code": "k7qm2x" }` (case and spaces ignored) ->
```json
{ "status": "pending", "family_name": "Our family",
  "inviter": { "name": "Mom", "relation": "Mom", "avatar_key": "mom" },
  "invitee": { "name": "Dad", "role": "cook", "avatar_key": null },
  "expires_at": "…", "same_family": false }
```
`invitee` is `null` for a family invite (show "Join Mom's family table?" with no "You're joining
as …" line). `status`: `pending` | `used` | `expired` | `revoked` (a named invite whose person was
removed reads `revoked`). `inviter` is `null` if unknown. Never joins and
never returns ids or keys. `same_family` only when the request sends `x-device-key` (optional on
this public route): true when that phone is already signed in to the invite's family (show "You're
already in."), false otherwise, including a bad or signed-out key; it never bumps the key's
`last_seen_at`. `avatar_key` is null for anyone but the seeded demo family: draw their initial,
never a photo guessed from the name. `404 "That invite link doesn't work."` (`"That invite code doesn't
work."` for a code; match on the status, not the text), `400` neither given, `429` (60 per 10 min
per IP; typed codes also have their own budget, see Security model).

### `POST /invites/accept` (public; the Join tap)
`{ "token" | "code", "device_label"?: "iPhone" }` -> `{ "device_key": "…", "family_name": "Our family", "profile_id": "…" | null }`.
Uses the invite up and makes this phone's key (`via: "invite"`). Named invite: the key is the
invited person's, "<Name> joined." goes in the circle; save the key and set me to `profile_id`.
Family invite: `profile_id: null`, the key has no person yet and no note is posted; save the key,
show "Who's in the kitchen?" (`GET /family` says `device_needs_profile: true`), then `POST
/profiles/self` (a new face) or `POST /move-requests` (an existing face, e.g. on a new phone).
`410 { "error": "This invite was already used.", "status": "used" }`, `"This invite expired."`
(`expired`), `"This invite was turned off."` (`revoked`); `404` as peek; `409 "Please tap Join
again."` (rare: a parallel tap just failed); `429` (20 per 10 min per IP).

### `POST /profiles/self` (device key; no `x-profile-id`)
`{ "name": "Dad", "role": "cook" | "learner" }` -> `Profile` (with `invited: false, has_phone: true,
locked: false`). "This is me" for a phone with no person yet (a family invite, or a swapped family
code): makes the profile with `POST /profiles`' rules and makes this phone theirs for good (one
conditional update; if another tap set the phone's person first, the new profile is deleted again
and it's `409`). Posts "<Name> joined." in the circle. + under "The cooks" sends `cook`, + under
"The ones who miss it" `learner`. `x-profile-id` is ignored here.
- `409 "This phone already belongs to Mom."`: the phone has its person (also the answer to a retry
  after a lost response: reload `GET /family`, whose `device_profile_id` is then the new person);
- `409 "Dad is already in this family. Pick another name or tap your face."`;
- `400` bad name (1-40 characters) or role, or no device key (`"Send this phone's x-device-key to
  add yourself."`); `400 "This family already has 30 people"`; `429` after 30 per family per hour.

### `POST /profiles/:id/remove` (me)
-> `{ "ok": true }`. Leave the family: `:id` must be the `x-profile-id` (see Security model). From
your own phone it signs that phone out (the app goes back to its first screen); for someone with no
phone of their own, any phone acting as them can do it and stays signed in (a phone with no person
yet doesn't become theirs on the way). Their phones are signed out, their invites and the family
invites they sent stop working, and pending asks to move in as them are declined. No circle note.
Removing someone already removed is fine. `403 "Only Dad can remove themselves."` for anyone else
(this phone's own person too, while it acts as someone else), `404` not in the family. The name can
be used again afterwards.

### `POST /move-requests` (device key; no `x-profile-id`)
`{ "profile_id": "…" }` -> `{ "id": "…", "profile_id": "…", "status": "pending", "created_at": "…" }`.
"That's me, on a new phone": a phone that joined through a family invite and has no person yet
(`device_needs_profile`) asks to be someone already in the family. Nothing changes until someone
answers (`GET /move-requests/mine` to wait). No circle note. One pending ask per phone:
- the same person again (a repeat tap) returns the same ask;
- someone else replaces it (the old ask reads `declined`);
- an expired ask is declined and a new one made.

`400 "Only a phone that just joined can ask to move in."` (a key that has its person, a swapped
family code, or the family code itself), `400` / `404` `profile_id` not someone in the family now
(removed people included), `409 "Please try again."` (rare: another tap for someone else landed at
the same moment), `429` after 30 per family per hour. `x-profile-id` is ignored here.

### `GET /move-requests/mine` (device key; no `x-profile-id`)
-> `{ "id": "…", "profile_id": "…", "status": "pending" | "approved" | "declined" | "expired",
"asked": ["Mom", "Dad"], "let_in_by": null }`, this phone's latest ask, or `null` (never asked, or the
family code). Poll it on the waiting screen (every 5 s while it's open). `asked`: while pending, the
names of up to 3 people who can let them in (settled, on their own phone, not the person asked for),
in family order; show "Waiting for Mom or Dad" and offer to text them; `[]` otherwise. `approved`:
this phone is now that person (`GET /family`'s `device_profile_id`); enter as them, and `let_in_by`
names who did ("You're back. Mom let you in."; else `null`). `declined` / `expired`: say so and offer to ask again or add
themselves. A phone signed out meanwhile gets the usual `401`.

### `GET /move-requests` (me)
-> `[{ "id": "…", "profile": Profile, "created_at": "…" }]`, newest first: the asks I can answer.
Pending and unexpired, in my family, from a phone still waiting (not signed out, no person yet), for
someone still in the family, and never an ask to be me. `[]` unless I'm on my own phone (this key's
person is my `x-profile-id`; not a lent phone or the family code) and settled (a day in, or the
family's first person). Show "<Name> is on a new phone.
Let them in?" with Let in / Not them.

### `POST /move-requests/:id/approve` (me, on my own phone)
-> `{ "ok": true }`. The asking phone becomes theirs; their other phones are signed out (`401`) and
older invite links to them stop working. No circle note. First answer wins.
- `403 "Only someone on their own phone can let people in."` (a lent phone or the family code);
- `403 "You can do this after your first day here."` (not settled: my first phone joined under 24
  hours ago and I'm not the family's first person);
- `400 "You can't let yourself in."` (an ask to be me);
- `409 "Already handled."` (approved or declined already, by anyone);
- `410 "That request expired."` (older than 7 days);
- `409 "That phone isn't waiting anymore."` (it was signed out, or added itself, after asking; the
  ask becomes `declined` and nobody is signed out);
- `404 "No such request."`.

### `POST /move-requests/:id/decline` (me, on my own phone)
-> `{ "ok": true }`. `pending → declined`; no note; the phone can ask again. Same `403`, `404`, `409
"Already handled."` and `410` as approve.

### `POST /auth/email` (public, no code)
Sign in or sign up with an email. Body: `{ "email", "name"?, "role"?: "cook" | "learner",
"share_token"?, "client"?: "app" | "web" }`. Email is trimmed and lowercased; one email = one
profile across all families.

| case | response |
|---|---|
| known email | `{ "existing": true, "needs_name": false, "joined": false, "family_code": "K7MP-Q2XD", "family_name": "Our family", "profile_id": "…" }` and a system note "<Name> signed in on a new phone" (`client: "web"`: "…on the web") in the circle |
| new email, no `name` | `{ "existing": false, "needs_name": true }` (nothing is created: ask name + cook/learner, call again) |
| new email + valid `share_token` | joins the **share's family** as a new profile (role `learner` unless given): `{ "existing": false, "needs_name": false, "joined": true, "family_code", "family_name", "profile_id" }`. If the family already has someone with that name, **no email**, no Apple/Google account and no live phone, who isn't the link's sender (added by "+ Add family"), that profile is claimed instead (gets the email; its role stays; its invite stops working). Posts "<Name> joined from <sender>'s link" ("…from a shared link" without a sender) in the circle |
| new email, no / unknown token | creates "<name>'s family" with this profile (role `learner` unless given) and its circle: same shape, `joined: false` |

Store `family_code` (SecureStore) and use it as `x-family-code`; people never need to see it.
`400` bad email / role (emails are printable ASCII), `403 "This link is full. Ask your family for a
new one."` (5 people already joined through it), `409` the name is someone in the share's family who
can't be claimed (`"Mom is already in this family. Try another name."`) or the email just got taken,
`429` rate limits above. Unverified emails: see the TODO above.
No "signed in" note when the same email signed itself up in the last 2 minutes (a repeated tap).
Clients should not auto-retry this call: after a lost response the profile may already exist.

```bash
curl -s -X POST "$API/auth/email" -H 'content-type: application/json' -d '{"email":"sam@example.com"}'
```

### `POST /profiles`
`{ "name": "Auntie Lin", "role": "cook", "relation": "Aunt", "email": "lin@example.com" }` -> `Profile`.
Name 1-40 chars, unique per family ignoring case (`409 "Auntie Lin is already in this family"`).
`email` optional and **family code only** (old builds; with a device key: `403 "Emails can't be
added in this version. Send an invite instead."`); when given it must be unused anywhere (`409
"That email is already in a family"`), and that person can later sign in with it (`POST
/auth/email`) and land in this family.
New profiles have `avatar_key: null` (show the initial tile).

### `POST /profiles/:id/email`
`{ "email": "mom@example.com" }` -> `Profile`. **Family code only** (old builds; with a device key:
`403`, as above). Gives someone already in the family an email (or replaces theirs), so they can
sign in with it on a new phone. `409 "That email is already in a family"` when another person has
it; setting the same email again is fine.

### `GET /threads` (me)
`ThreadSummary[]`: the **circle first, always** (even with no messages: `last: null`), then my pair
threads with at least one message, newest first. `last` is the newest message that is not a
`system` note (a system note only when the thread has nothing else).
```json
[{ "id": "…", "kind": "circle", "other": { "id": "family", "name": "Family", … },
   "members": [ { "name": "Mom", … }, { "name": "Dad", … }, … ], "unread": 2,
   "recipe_id": "grandma-hand-pulled-noodle-soup", "last": { "kind": "question", … } },
 { "id": "…", "kind": "pair", "other": { "name": "Dad", … }, "members": [ …2 ], "unread": 1,
   "recipe_id": "dad-sunday-chili", "last": { "kind": "text", "body": "Start with half of my big spoon…", … } }]
```
`unread` = messages from anyone else (not `system`) newer than my last read. `postcards` = how many
`cooked` cards in the thread carry a photo (retention PR 3): a postcard changes its card in place and
never `last`, so a client keying a refetch on `last` also keys it on this. Sending a message marks
the thread read for the sender. Don't use the circle's `other.id` as a profile id. A 1:1 with
someone who was removed stays (its history is theirs too): `other.removed: true`, both people still
in `members`; show it read-only.

### `GET /circle`
-> `{ "id": "<thread id>", "kind": "circle", "members": Profile[] }` (created if missing). Use the id
with the normal `/threads/:id/messages` and `/threads/:id/read` routes; every member can read and post.

### `POST /threads` (me)
`{ "other_id": "<profile id>" }` -> `{ "id": "<thread id>", "other": Profile }`. Get or create; one
thread per pair of people.

### `GET /threads/:id/messages?after=<iso>` (me; pair or circle)
`Message[]`, oldest first (the newest 500). With `after`, only messages created after it: pass the
`created_at` of the last message you have, URL-encoded (`encodeURIComponent`). Voice notes carry a
fresh signed `audio_url` valid for 1 hour, so re-fetch rather than caching URLs. 404 if I'm not in
the thread.

### `POST /threads/:id/messages` (me; pair or circle)
Body by kind (all accept optional `clip_start_s` / `clip_end_s`, end > start, and `reply_to` = a
message id **in this thread**, else `400 "reply_to must be a message in this conversation"`):

| kind | required | optional |
|---|---|---|
| `text` | `body` | `recipe_id` |
| `request` | `body` ("Will you teach me…") | `recipe_id` |
| `step` | `recipe_id`, `step_order` | `body` (the question) |
| `recipe` | `recipe_id` | `body` (the note) |
| `cooked` | `recipe_id` | `body` (how it went), `photo_path` from `/photo-upload` (already uploaded; `400 "Upload the photo before sending it"` otherwise). The app since PR 3 sends the card without one and puts the photo on it afterwards with `POST /messages/:id/postcard`; a photo at send time still works (older builds) |
| `voice` | `duration_s` (0-300) and `audio_path` from `/voice-upload` (already uploaded) | `transcript`, `recipe_id`, `step_order`; or instead of `audio_path`, `audio_url` pointing at a recipe's audio in the public bucket (a "Hear Dad" clip, with `clip_start_s`/`clip_end_s`) |
| `question` | `body`, or the voice fields (`audio_path` + `duration_s`) for a spoken one | `transcript`, `recipe_id`, `step_order` (needs `recipe_id`) |
| `reaction` | `body`: `heart` (a cook's heart mid-cook) or `just_like_mine` (needs `reply_to`: a `cooked` message someone else sent) | `recipe_id`, `reply_to` (only a `cooked` message by someone else) |

`body` <= 2000 chars. `recipe_id` must exist in the bucket (`404 "No recipe with that id"`). In a
1:1 with someone removed: `403 "Dad isn't in the family anymore."`.
Returns the stored `Message` (use it to replace the optimistic bubble). A cook's `text` / `voice`
reply that answers a question with a `recipe_id` (any circle question; in a 1:1, one asked of that
cook) comes back with `saved_to_recipe: true` (the note is made in the same request).
Reactions: `400 "body must be heart or just_like_mine"`, `400 "A reaction answers a dish someone
made"` (a `reply_to` that isn't someone else's `cooked` message, or `just_like_mine` without one).
The same reaction to the same message twice returns the first one (one stamp). A reaction never
answers a question, and it is never a thread's `last`, never unread, and never keeps a 1:1 in the
inbox by itself. Sending one doesn't mark the thread read for the sender or move it up the inbox (a
heart from Home leaves the kid's unread messages unread). Every message sent here pushes the other people in the thread (see "Retention:
push"), never the sender; a question only whoever can answer it, and `just_like_mine` only the one who
made the dish, even in the circle. The app's chat log draws a reaction as a small stamp under the
message it answers ("♥ “Just like mine.” · Mom"), or, answering nothing (a heart mid-cook), as a quiet
centred line where it was sent ("♥ Mom"); never as a bubble or a raw "heart".
```bash
CIRCLE=$(curl -s "$API/circle" -H "x-family-code: $TC" | jq -r .id)
curl -s -X POST "$API/threads/$CIRCLE/messages" -H "x-family-code: $TC" -H "x-profile-id: $LEO" \
  -H 'content-type: application/json' \
  -d '{"kind":"question","recipe_id":"dad-sunday-chili","step_order":3,"body":"How much bean paste?"}'
# Dad answers it (saved into the chili recipe, step 3):
curl -s -X POST "$API/threads/$CIRCLE/messages" -H "x-family-code: $TC" -H "x-profile-id: $DAD" \
  -H 'content-type: application/json' -d '{"kind":"text","body":"Half my big spoon.","reply_to":"<question id>"}'
```

### `POST /threads/:id/read` (me)
-> `{ "ok": true }`. Call when the chat is open (after each poll that returned new messages).

### `GET /unread` (me)
-> `{ "total": 3 }` across the circle and all my threads (tab-bar dot).

### `GET /questions/open` (family code; `x-profile-id` optional)
`OpenQuestion[]`, newest first (max 50), for the cooks' "Waiting for your answer" cards: the
circle's unanswered questions, and, when `x-profile-id` is a **cook**, the unanswered 1:1 questions
asked of them (`thread_kind: "pair"`). With `x-profile-id`, my own questions are left out, and so
are circle questions asked before I was added to the family (`profiles.created_at`), so a newcomer
starts with no backlog. Without it: circle only (as before). Which of these belong on a cook's Home
is the app's call ("for me": a 1:1 question, or a circle question about my dish; one with no family
cook's dish shows as "Leo asked the family" only when it reads as a question).
```json
[{ "message": { "kind": "question", "body": "Grandma, how long do you knead it?…", "thread_id": "…",
                "recipe_id": "grandma-hand-pulled-noodle-soup", "step_order": 2, "answered_by": null, … },
   "asker": { "name": "Leo", "role": "learner", … }, "thread_kind": "circle" },
 { "message": { "kind": "step", "body": "Grandma, how many cups is one of your heaping rice bowls…", … },
   "asker": { "name": "Leo", … }, "thread_kind": "pair" }]
```
Answer it by posting into `message.thread_id` with `reply_to` = `message.id`; it leaves this list at
once (see "Questions").

### `POST /recipe-notes` (me = a cook)
`{ "message_id": "<id>" }` -> `RecipeNote`. "Save to recipe" for one of **my own** messages (`text`,
`voice`, `step`, `recipe`, `cooked`) that is about a recipe: its own `recipe_id`, or the recipe of the
question it replies to (then the note quotes that question and takes its step). Idempotent: saving
the same message again returns the same note. `403` learner or someone else's message, `400` not
about a recipe / nothing to save / a `question`, `request` or `system` message, `404` unknown message.

### `POST /recipe-notes/:id/remove` (me)
Takes a saved answer back out of the recipe (one saved by mistake). Allowed for the answer's author,
the person who asked, or the dish's cook (`cook.name` in the recipe's `recipe.json`, matched to my
name; cached 10 min). The note is deleted and the answer message's `reply_to` is cleared, so the
question is open again (back in `GET /questions/open`) unless someone else answered it too. The
message itself stays in the chat, now with `saved_to_recipe: false`, `note_id: null`.
-> `{ "ok": true, "answer_message_id": "…", "question_message_id": "…" | null }`. `403 "Only the
person who answered, the person who asked, or the cook can take this out."`, `404 "That answer isn't
in the recipe anymore."` (unknown, or already taken out).

### `GET /recipes/:id/notes` (family code)
-> `RecipeNote[]` for this recipe in this family, by `step_order` (recipe-wide notes last), then
oldest first. Voice answers carry a fresh signed `answer_audio_url` (1 h): re-fetch, don't cache.
```json
[{ "id": "…", "recipe_id": "dad-sunday-chili", "step_order": 3,
   "question": "How do I know the spices are toasted and not burnt?", "asker": { "name": "Leo", … },
   "answer_text": "About a minute. When the oil turns brick red…", "answer_audio_url": null,
   "answer_duration_s": null, "author": { "name": "Dad", … }, "created_at": "…", … }]
```

### `GET /recipes/:id/questions` (family code; `x-profile-id` optional)
`RecipeQuestion[]`, newest first (max 50): the open (unanswered) questions about this dish, for cook
mode's "waiting" line under a step's Ask. The circle's questions (everyone sees those), plus, with
`x-profile-id`, the ones **I** asked in a 1:1 chat. Other people's 1:1 questions stay private
(the person asked sees them in their chat and `GET /questions/open`, not here). A question whose
asker or the person asked has left the family is dropped. Answered ones leave at once.
```ts
type RecipeQuestion = { id: string; thread_id: string; thread_kind: "circle" | "pair";
  step_order: number | null; body: string | null;   // body, else a spoken question's transcript
  created_at: string; asker: Profile; mine: boolean;
  waiting_for: Profile | null };                     // pair: the person asked; circle: null (any cook)
```
```json
[{ "id": "…", "thread_kind": "pair", "step_order": 3, "body": "How much salt?", "mine": true,
   "asker": { "name": "Leo", … }, "waiting_for": { "name": "Dad", … }, "created_at": "…" },
 { "id": "…", "thread_kind": "circle", "step_order": 2, "body": "How long do I knead it?", "mine": false,
   "asker": { "name": "Leo", … }, "waiting_for": null, "created_at": "…" }]
```

### `POST /voice-upload` (me)
`{ "content_type": "audio/m4a" }` (default `audio/m4a`; also `audio/x-m4a`, `audio/mp4`,
`audio/aac`, `audio/mpeg`, `audio/webm` for web recordings, `audio/wav`, `audio/ogg`) ->
```json
{ "path": "<family_id>/<uuid>.m4a",
  "upload_url": "https://qeiednrjkiyzbolkepbk.supabase.co/storage/v1/object/upload/sign/voice/…?token=…",
  "method": "PUT", "headers": { "content-type": "audio/m4a" },
  "max_bytes": 10485760, "expires_in_s": 7200 }
```
Then `PUT` the raw file bytes to `upload_url` with exactly those `headers` (no API key needed;
`200 {"Key": "voice/…"}`), then send a `voice` message with `audio_path: path`. Using expo:
`FileSystem.uploadAsync(upload_url, fileUri, { httpMethod: 'PUT', headers, uploadType: BINARY_CONTENT })`
or `fetch(upload_url, { method: 'PUT', headers, body: blob })`. Bucket cap 10 MB.

### `POST /photo-upload` (me)
`{ "content_type": "image/jpeg" }` (default `image/jpeg`; also `image/png`, `image/heic`,
`image/webp`) ->
```json
{ "path": "<family_id>/<uuid>.jpg",
  "upload_url": "https://qeiednrjkiyzbolkepbk.supabase.co/storage/v1/object/upload/sign/photos/…?token=…",
  "method": "PUT", "headers": { "content-type": "image/jpeg" },
  "max_bytes": 10485760, "expires_in_s": 7200 }
```
The postcard after "I made it": `PUT` the photo's bytes to `upload_url` with exactly those `headers`,
then `POST /messages/:id/postcard` with `photo_path: path` on the `cooked` message "I made it" sent
(retention PR 3; older builds sent a second `cooked` message with `photo_path` instead, which still
works). The `photos` bucket is **private**, like `voice`: messages carry a fresh 1-hour signed
`photo_url`, so re-fetch rather than caching it. `photo_path` on any other kind is a `400`. Bucket
cap 10 MB.

### `POST /send-recipe` (me)
`{ "recipe_id": "dad-sunday-chili", "to": ["<profile id>", …] | "everyone", "note": "Try it Sunday" }` ->
`{ "sent": [ { "profile_id": "…", "thread_id": "…", "message_id": "…" } ] }`.
One `recipe` message (body = note) per person; `everyone` = every other profile in the family.
Sending to yourself is skipped (400 if that leaves nobody). Each person gets a push "Just in from
Mom" with the dish's title, opening the recipe.

### `POST /shares` (family code; `x-profile-id` optional = the sender shown on the web page)
`{ "recipe_id": "dad-sunday-chili" }` -> `{ "token": "SE65stMwrw", "url": "https://homecookd.app/r?s=SE65stMwrw" }`.
Token: 10 chars base62 from `crypto.getRandomValues`. The same family + recipe + sender gets the
same link back (so calling it every time the sheet opens is fine) until 5 people have joined
through it; then a fresh link.

### `GET /shares/:token` (public, no code)
```json
{ "token": "SE65stMwrw", "recipe_id": "dad-sunday-chili",
  "recipe_url": "https://storage.googleapis.com/edible-media-379797517579/dad-sunday-chili/recipe.json",
  "sender": { "name": "Dad", "relation": "Dad", "avatar_key": "dad" },
  "family_name": "Our family" }
```
`sender` is `null` when the link was made without a profile. Increments the link's open count.
Never returns ids, codes or messages. Unknown/malformed token -> `404 "This link doesn't work anymore"`.

### `POST /signup` (public, no code; kept for old clients, new ones use `POST /auth/email`)
`{ "name": "Sam", "email": "sam@example.com", "share_token": "SE65stMwrw" }` (token optional) ->
`{ "family_code": "K7MP-Q2XD", "family_name": "Sam's family" }`.
Creates a new family (with its circle) with one learner profile and a fresh code `XXXX-XXXX`
(alphabet without 0/O/1/I). The email is only logged in `signups` (not put on the profile), and each
call makes a new family.

### `POST /pending-sends` (me = the cook who recorded)
`{ "job_id": "<upload job id>", "recipient_ids": ["<leo id>"], "hello_path": "<path from /voice-upload>", "hello_duration_s": 6.2 }`
(`hello_*` optional; the hello must already be uploaded) -> `{ "ok": true }`.
Call right after the background upload starts. Re-posting the same `job_id` replaces the
recipients until it's delivered (then `409`). If the worker already published that job, it is
delivered immediately and the response is `{ "ok": true, "delivered": 1 }`.

### `POST /jobs/:job_id/published` (family code only; called by the pipeline worker)
`{ "recipe_id": "<published recipe id>" }` -> `{ "delivered": 2 }`.
Delivers the pending send: for each recipient a `recipe` message, then (if recorded) the hello
`voice` message, from the cook. Idempotent: a second call returns `{ "delivered": 0, "already": true }`;
an unknown job returns `{ "delivered": 0 }`. Each recipient gets a push "Just in from Dad" with the
dish's title (once: a repeat delivers nothing and pushes nothing).
The worker (`pipeline/worker.py`, `notify_published`) calls it after `publish` succeeds and the job
is marked published:
```python
requests.post(f"{HOMECOOKD_API_URL}/jobs/{job_id}/published", json={"recipe_id": job_id},
              headers={"x-family-code": FAMILY_CODE}, timeout=10)
```
Failures are logged and never fail the job.

### `POST /events` (me)
`{ "recipe_id": "dad-sunday-chili", "kind": "viewed" | "cooked" | "started" | "heard", "cook_id"?: "<profile id>", "duration_s"?: 12, "start_s"?: 42 }`
-> `{ "ok": true, "counted": true }`.
The app's recipe activity. `started` = cook mode opened; `heard` = a cook's recorded voice played for
`duration_s` (>= 3) seconds from `start_s` (a recipe's step or story clip; voice notes never log it).
`cook_id` = whose dish it is (the app resolves it by name); it must be someone in this family. A
repeat `viewed` by the same person within 30 min (or `cooked` / `started` within 1 min, or the same
`heard` clip within 5 s) returns `counted: false` and isn't stored, so it's safe to call on every
screen focus. `400 "kind must be viewed, cooked, started or heard"`, `400 "cook_id must be someone
in your family"`, `400 "duration_s must be at least 3 for heard"`. `GET /me/recipe-stats` and
`GET /recipes/:id/activity` count only `viewed` and `cooked`. This shape without a key or code is `401`. Without a key or code, a lander visit (the `/web-events`
body) is still logged here, so an early lander beacon lands; new clients use `/web-events`.

### `POST /web-events` (public; the lander's visit log)
JSON as `application/json` or `text/plain` (`navigator.sendBeacon`):
`{ "event": "land" | "switch" | "tap", "aud": "parent" | "kid", "signal"?: "aud" | "saved" | "snapchat" | "link" | "default" | "switch", "app"?, "utm_source"?, "utm_campaign"?, "path"?, "ui"?: "hero" | "footer" | "cta" | "see" | "send" | "sticky", "host"? }`
(`tap` = a hero button: `ui` "cta" is "Get early access", "see" is "See it work", "send" is the kid hero's "Send this to {R}"; "sticky" is the kid page's sticky send button on phones. On `switch`, `signal` carries the visitor's arrival signal.)
(`app`, `utm_*`, `path` at most 100 characters; `ui` at most 20; `host` = `location.hostname`, at
most 60, so preview and test traffic can be filtered) -> `204`, no body. Stored in `lander_events`
with nothing about the person (no IP, no user agent). `400` invalid, `413` over 64 KB, `429` after
120 per 10 min per IP. Not `/events`: that path is the app's signed-in recipe activity.
```js
navigator.sendBeacon(`${API}/web-events`, JSON.stringify({ event: "land", aud: "kid", signal: "aud", app: "app", path: "/learn", host: location.hostname }));
```

### `GET /favorites` (me)
-> `{ "recipe_ids": ["dad-sunday-chili", …] }`: the dishes I hearted, newest first. Stored per
profile on the server (table `favorites`), so they follow the person to any device.

### `POST /favorites` (me)
`{ "recipe_id": "dad-sunday-chili", "on": true }` (`on: false` removes it) ->
`{ "ok": true, "recipe_id": "dad-sunday-chili", "on": true, "recipe_ids": [ … ] }` (my favorites
after the change, newest first). Idempotent both ways, so it's safe to retry. `400` bad id or `on`
not a boolean, `404 "No recipe with that id"` when hearting a dish that isn't in the bucket.

### `GET /me/recipe-stats` (me)
`RecipeStat[]`: one row per dish I have any history with (viewed, cooked, hearted, or sent to me),
most recent activity first. Views and cooks are my `POST /events`; `sent_to_me_at` is the newest
`recipe` message from someone else in one of my 1:1 chats or the circle (pending sends included).
Dishes with no history aren't listed (treat them as all zero).
```json
[{ "recipe_id": "gordon-gnocchi", "views": 3, "last_viewed_at": "…", "cooked": 1, "last_cooked_at": "…",
   "favorited": true, "favorited_at": "…", "sent_to_me_at": "…" }]
```
Kid Home: "Your favorites" = `favorited` first, then most `views`; "Explore" = `sent_to_me_at` (or
new family recipes) with `cooked == 0`; "Come back to it" = `last_cooked_at` older than ~3 weeks.

### `GET /recipes/:id/activity` (family code)
```json
{ "cooked": [ { "profile": Profile, "at": "…", "note": "Made it!" } ],
  "viewed": [ { "profile": Profile, "count": 3 } ],
  "last_sent_at": "…" }
```
`cooked`: one entry per person (latest), `note` = the body of their latest `cooked` message about
this recipe. `viewed`: counts per person, most first. `last_sent_at`: newest `recipe` message
about it in this family, or `null`.

## Retention: push (docs/build/RETENTION-HANDOFF.md 2.2-2.5)

All routes come from `supabase/functions/api/retention.ts` (`makeRetention`, `prs: [1, 2, 4, 5, 6]` today);
later PRs turn theirs on there.

### `POST /push-tokens` (me)
`{ "token": "ExponentPushToken[…]", "platform": "ios" | "android" }` -> `{ "ok": true }`. This phone's
Expo push token, for **the phone's own person** (on a lent phone, the owner, not whoever is acting;
a family-code caller registers who it acts as). Upserts: the same token from another person or
family moves to this one. `400 "token must be an Expo push token"`, `400 "platform must be ios or
android"`, `429` after 30 per person per hour. Send it whenever the person on the phone changes.

### `POST /push-tokens/remove` (signed in; no `x-profile-id` needed)
`{ "token": "ExponentPushToken[…]" }` -> `{ "ok": true }`. Sign-out: sent with the device key the app
captured before dropping it (a key that is already revoked is refused, which is fine). The app fires
it in the background and never waits for it; tokens of revoked phones and removed people are skipped
and pruned at send time anyway.

### `POST /cron/hourly` (public; `x-cron-secret`)
`{ "now"?: "<iso>" }` -> `{ "ok": true, "due": { "nudge": 0, "recap": 0 }, "sent": 0, "jobs": { … } }`.
Called every hour by `pg_cron` through `pg_net` (`20261018100100_retention_cron.sql`); the secret is
generated in Vault and checked by the database (`cron_secret_ok`), never in git or the function's env.
`now` overrides the clock for tests (only with the secret). Runs the jobs the PRs that are on
register: `table_nudge` (PR 5, the Sunday nudge; `jobs.table_nudge` = pushes it sent) and `recap`
(PR 6, Month in the kitchen; `jobs.recap` = pushes it sent). `due.recap` (people at local 10:xx) is
reported but unused: the recap job picks its own people. `401 "Not allowed"` without the right
secret, `400 "now must be an ISO time"`.

### Pushes sent
One helper (`notify` in `plumbing.ts`) sends every push: skipped for removed and memorial people and
phones that were signed out, logged in `notification_log` (a per-person dedupe key stops doubles),
sent through Expo (`https://exp.host/--/api/v2/push/send`), and tokens Expo calls
`DeviceNotRegistered` are deleted. A push never fails or delays the request (it runs after the
response). App-initiated pushes (the Sunday nudge, PR 5; the monthly recap, PR 6) are capped: a
learner 1 a day and 3 a week, a cook 1 a month, never 21:00-08:00 local (TODO(caleb): quiet hours);
a skipped one is logged with its `skipped_reason`.
Each push carries `data: { url, kind, profile_id }`; the app opens `url` (a push for someone else on
a shared phone opens "Who's in the kitchen?").

| Trigger | To | Title | Body | Opens |
|---|---|---|---|---|
| Text or request | everyone else in the thread | sender's name | the text, <= 90 chars | the chat |
| Voice note | everyone else in the thread | sender's name | "Sent a voice note · 0:38" | the chat |
| Question (`question`, or a learner's `step` with words) | the person asked (circle: every cook but the asker) | "Leo asked about Sunday Chili" | the question | the chat |
| `reaction` `just_like_mine` | the one who made it | sender's name | "“Just like mine.” on your Sunday Chili" (the dish as people say it; "“Just like mine.”" when the bucket is unreachable) | the chat |
| A postcard (`POST /messages/:id/postcard`, PR 3) | the dish's cook (the family member named on it; in a 1:1, only if that's the other person) | "Leo made your Sunday Chili" | "Sent you a postcard." | the cook's Home (`/parent/home`) |
| `POST /send-recipe`, a pipeline delivery | each recipient | "Just in from Dad" | the dish's title | the recipe |
| A kid starts cook mode on my dish (`POST /cooking`, PR 2) | the dish's cook | "Leo is making your Sunday Chili" | "Right now, step 1 of 8." | the cook's Home (`/parent/home`) |
| The Sunday nudge (cron `table_nudge`, PR 5; **app-initiated**, capped) | a kid at local Sunday 17:xx with a streak not lit this week | the cook's name | "“<her own step words>” · Your week at the table is still open." (no quote left: "Your week at the table with Mom is still open.") | the quoted dish, else the cook's first recording this family published, else a sample under the cook's name, else `/kid/home` |
| Month in the kitchen (cron `recap`, PR 6; **app-initiated**, capped) | anyone (kid or cook) whose last month wasn't empty, on their local 1st from 10:00 until quiet hours (first: Dec 1, for November) | "Your November in the kitchen" | a real line from their slides, e.g. "3 dishes & 40 minutes of family voices." | `/recap?month=YYYY-MM` |

No push for a `cooked` message by itself, a heart, a system note, or anything to the sender. "Leo is
making" goes at most once per kid, dish and kid-local day (dedupe key
`started:<kid>:<recipe>:<yyyy-mm-dd>`), and never for a kid who hasn't said yes or a memorial cook. A
postcard pushes once per `cooked` message (dedupe key `postcard:<message id>`), however often its
photo is replaced.

## Retention: Leo is cooking (PR 2; docs/build/RETENTION-HANDOFF.md 3.1)

Cook mode on another family cook's dish tells the server where the kid is, so that cook gets one push
and a live row on their Home, and can send a heart back. Nothing is stored, logged or pushed until the
kid says yes once (`profiles.share_cooking`, null = never asked).

### `POST /cooking` (me)
`{ "recipe_id", "cook_id", "step", "total" }` -> `{ "ok": true, "shared": bool, "consent": "yes" | "no" |
"unasked", "memorial"?: true, "started_at": "<iso>" | null, "new_session": bool }`. Sent when cook mode opens and then 2 s
after each step change. `cook_id` must be another cook in my family and the dish's cook (recipe.json
`cook.name`, case-insensitively; not checked when the bucket is unreachable). Until my `share_cooking`
is true, nothing is stored, logged or pushed and `consent` says why (`unasked` = show the question).
A memorial cook is checked first: nothing is stored, logged or pushed, and the answer is
`{ "shared": false, "consent": "no", "memorial": true }` whatever my stored answer (never `unasked`, so
the app never asks "Let Grandma see…" about someone who can't; `share_cooking` is left as it is). The first call of a session (no row, a
row older than 45 min, or another dish) logs a `started` event with `cook_id` and pushes the cook (see
"Pushes sent"). Later calls only move the step (a call naming another cook than the session's is
checked like a new session). `started_at` is the session's start (server clock, always
`toISOString()` form, the same string on every call of a session): hearts newer than it count.
`400`: "recipe_id is required", "recipe_id is not a valid recipe id", "cook_id must be someone else in
your family", "cook_id must be a cook in your family", "cook_id must be the dish's cook", "step/total
must be a whole number", "… must be between 1 and 200", "step must be at most total". `429` (240 an hour).

### `POST /cooking/end` (me)
`{ "recipe_id"? }` -> `{ "ok": true }`. "I made it", leaving cook mode, 45 min idle. With a `recipe_id`
it ends only that dish's session.

### `GET /cooking` (me)
-> `[{ "profile": {id, name, role, relation, avatar_key}, "recipe_id", "cook_id", "step", "total",
"started_at", "updated_at" }]`: people in my family cooking **my** dishes right now (step changed in
the last 45 min, and they said yes), newest first. The cook's Home polls it every 15 s while focused.

### `GET /profile/share-cooking` (me)
-> `{ "share_cooking": true | false | null }` (null = never asked).

### `POST /profile/share-cooking` (me)
`{ "share": boolean }` -> `{ "ok": true, "share_cooking": bool }`. The consent answer, or a later
change. `false` also ends my live session at once. `400 "share must be true or false"`, `429` (30 an hour).

### Hearts mid-cook
The cook's heart is a `POST /threads/:id/messages` `{ kind: "reaction", body: "heart", recipe_id }` in
their 1:1 with the kid (no `reply_to`, never a push). The kid's cook mode reads
`GET /threads/:id/messages?after=<newest seen>` in that 1:1 every 10 s while it is shared and shows
a heart burst for each heart newer than `started_at`.

## Retention: Send it home, get one back (PR 3; docs/build/RETENTION-HANDOFF.md 3.4)

"I made it" sends the `cooked` card at once (as before); the kid's postcard then puts a photo, and
an optional rating, on **that same card**, so the cook's chat and Home keep one card per dish made.
The cook answers with a `reaction` `just_like_mine` (`reply_to` the card) or a voice note held down
on the card (`kind: "voice"`, `reply_to` the card), both through `POST /threads/:id/messages`.
This route lives in `index.ts` (on qa-cook's photo helpers), not in `retention.ts`; its push copy is
`cooking.ts`'s `postcardPush()`.

### `POST /messages/:id/postcard` (me = the card's sender)
`{ "photo_path": "<family_id>/<uuid>.jpg", "rating"?: 1-5 | null }` -> the updated `Message` (a
fresh signed `photo_url`, `rating`). Only on my **own** `cooked` message; `photo_path` comes from
`POST /photo-upload` and must already be uploaded (qa-cook's path rule and private bucket). Posting
again replaces both the photo and the rating (a retry, "Take another"; no rating = `null`). After the
response, the dish's cook gets one push per card ("Leo made your Sunday Chili" / "Sent you a
postcard.", opening their Home; see "Pushes sent"): the family member named on the dish
(`recipe.json` `cook.name`), never me, and in a 1:1 only when that is the other person (a card sent
to someone else tells nobody "your"); with the bucket unreachable, a 1:1's other person if they're a
cook ("Leo made your recipe"). `notify()` skips removed and memorial people.
Errors: `400 "photo_path is required"`, `400 "photo_path must be a path returned by /photo-upload"`,
`400 "Upload the photo before sending it"`, `400 "rating must be a whole number from 1 to 5"`,
`400 "A postcard goes on a dish you made"` (not a `cooked` message), `403 "Only whoever made the
dish can send its postcard"`, `403 "Dad isn't in the family anymore."` (the 1:1 is read-only),
`404 "No such message"` (unknown, malformed, or another family's), `429` (60 an hour).
```bash
UP=$(curl -s -X POST "$API/photo-upload" -H "x-family-code: $TC" -H "x-profile-id: $LEO" \
  -H 'content-type: application/json' -d '{"content_type":"image/jpeg"}')
curl -s -X PUT "$(jq -r .upload_url <<<"$UP")" -H 'content-type: image/jpeg' --data-binary @bowl.jpg
curl -s -X POST "$API/messages/<cooked message id>/postcard" -H "x-family-code: $TC" -H "x-profile-id: $LEO" \
  -H 'content-type: application/json' -d "{\"photo_path\":\"$(jq -r .path <<<"$UP")\",\"rating\":4}"
```

## Retention: Hearts & kitchen (PR 4; docs/build/RETENTION-HANDOFF.md 3.5 + 3.6)

The hearts kids already leave (`favorites`) and the dishes they cook (`recipe_events` kind `cooked`)
shown to **the dish's cook only**: her Recipes cards ("♥ 4 · cooked 3 times" + faces), "Leo can cook
4 of your 7" on her Recipes, "♥ 4 · Leo, Maya, Dad" on her recipe page and "Leo hearted your Sunday
Chili" rows in her updates card. A dish is mine when library.json's `cook_name` is my name,
case-insensitively (the app's `cookProfile()` rule). Both routes are reads; no migration (the tables
already have every column) and **no push for hearts**. The kid's "4 of 7" counts need no route: they
come from `GET /me/recipe-stats` (which counts views and cooks only, so `heard`/`started` rows never
push cooks out of its row cap). The kid's one-time "Grandma sees your hearts" toast needs `GET
/family`'s `memorial: false` for that cook (a memorial cook, or a server that leaves the flag out,
shows nothing).

### `GET /dish-stats?ids=a,b` (me)
Up to 50 distinct recipe ids, comma-separated ->
`{ "<id>": { "hearts": { "count", "by": [{ "profile_id", "at" }] }, "cooked": { "count", "by": [{ "profile_id", "count", "last_at" }] } } }`,
each `by` newest first. Only the asked-for ids **whose cook is me** come back (anyone else's are left
out, so Mom never sees Dad's counts); every one of mine is present, zeros included (the app hides
zero parts). Hearts and cooks count only people in my family now (removed people drop out), never
me. Hearts on sample dishes count (real hearts from real people; TODO(caleb)); the app's "4 of 7"
counts and mirror line never count samples or YouTube dishes. `{}` when the bucket can't be reached.
`400`: "ids is required", "ids must be recipe ids separated by commas", "ids: at most 50". The app
asks in batches of 50 and refetches on focus and on coming back to the foreground, at most every 10 s.

### `GET /hearts/recent?since=<iso>` (me)
-> `[{ "profile_id", "recipe_id", "at" }]`: hearts on my dishes from my family since `since`
(default 14 days ago, never more than 30 days back, never after now), newest first, at most 20. An
un-heart deletes the `favorites` row, so it leaves this list too. The server maps my dishes (the app
passes no ids). `400 "since must be an ISO time"`. The cook's updates card shows the newest 3 it
hasn't cleared on this phone (never above a question or a new-phone request), polling with the inbox
while Home is focused.

## Retention: the Sunday table (PR 5; docs/build/RETENTION-HANDOFF.md 3.2 + 3.3)

Each week (Monday 00:00 to Sunday 23:59, the kid's local time) a person's face lights with a small
flame once they did their part, and each kid & cook pair keeps a count of weeks in a row they both
did (a leftovers week forgiven per calendar month; a break shows no count for 7 days, then quietly
starts again). Shown on both Homes ("This week at the table"), in each 1:1 chat header ("6 weeks")
and on "Who's in the kitchen?". Lit: a kid cooked a family cook's dish, listened to a family clip for
3 s or more (`heard`), or messaged a family cook; a cook sent any message (a heart included) or had a
recording delivered. Needs `20261018100300_retention_table.sql` (the `public.table_activity` RPC,
service role only) applied **before** the function with `5` in `prs`; without it `GET /table` is a
`500` and the nudge skips every family.

### `GET /table` (signed in; `x-profile-id` optional, like `/family`)
-> `{ "week_start": "YYYY-MM-DD", "people": [{ "profile_id", "lit" }], "pairs": [{ "kid_id", "cook_id",
"weeks", "ember_until", "lit_this_week", "milestone"? }], "recordings": ["<recipe_id>"] }`.
- `people`: every current member, cooks and kids, with this week's flame (a memorial cook stays,
  never lit; the Homes' "This week at the table" row leaves memorial people out).
- `pairs`: only the kid-cook pairs that include the caller (none with no one picked; never with a
  memorial cook). `weeks` is null while an ember shows; `milestone` is 4, 12, 26 or 52 in the week
  it's reached (the app plays its one-time burst then).
- `recordings`: the dishes this family's own recordings became (`pending_sends` delivered with a
  `recipe_id`), sorted. The kid Home's "I miss home" plays clips only from these: library.json ties a
  dish to a cook by name alone and is shared by every family, so another family's real "Mom"
  recording would otherwise play as this family's Mom. The same scope the nudge quotes from.
- The week is Monday-start in the caller's zone (`x-tz`, else their stored zone; a cook with exactly
  one kid uses that kid's zone, TODO(caleb)). No 4xx of its own; a database failure is `500`.
  Computed on read; rows older than ~8 days are cached 60 s per family, the last 8 days are always
  read fresh (a flame shows the moment it's earned). The app asks on focus, on coming back to the
  foreground and after anything that can light a face (a send, "I made it", a listen), at most every
  10 s otherwise; never polled.

### The Sunday nudge (cron job `table_nudge`, push kind `table_nudge`, app-initiated)
To a kid at local Sunday 17:xx whose longest streak with a cook isn't lit yet this week (`weeks >= 1`,
or an ember's kept count); never to cooks, never about a memorial cook. One per kid and week (dedupe
`table_nudge:<kid>:<week_start>`), through the caps and quiet hours. The quote is the cook's own step
words (<= 90 chars, verbatim) from real recordings this family published, not used for that kid in
the last 15 days (`notification_log.quote_key`); never another family's recording, whatever its
cook is called. See "Pushes sent" for the copy and what it opens.

## Retention: Month in the kitchen (PR 6; docs/build/RETENTION-HANDOFF.md 3.7)

A few story slides about last month for anyone whose month had something in it, opened from a Home
card (the 1st to the 7th) or the 1st-of-month push. No migration: it reads `recipe_events`,
`messages` and `favorites` (the columns come from `20261018100000_retention_plumbing.sql` and
`20261018000000_cooked_photos.sql`) and rides the existing hourly cron.

### `GET /recap?month=YYYY-MM` (me)
-> `{ "empty": true }` or `{ "month": "YYYY-MM", "role": "cook" | "learner", "slides": [Slide] }`.
- `month` missing = last month on my clock (`profiles.tz`); not `YYYY-MM` = `400 "month must be
  YYYY-MM"`; no person = `400 "x-profile-id header is required for this request"`. A month before
  the first edition (November 2026; `FIRST_MONTH` in recapPr.ts & recapApi.ts) or after this one is
  empty, and so is a memorial or removed person's.
- Each slide has `type` and `title` and shows only when it has data, `cover` first and `close` last.
  Learner: `cooked {value, photos}`, `most_made {value, recipe_id, cook_id}`, `voices {value, seconds,
  clip: {recipe_id, cook_id, start_s, plays}}` (family cooks' real recordings only, never a sample's
  audio), `hearts_left {value}`, `then_now {photos: [first, latest]}` (needs 2 photos). Cook:
  `dishes_cooked {value, faces: [{profile_id}]}` (each kid once, in the order they first cooked one of
  her dishes that month; no count per kid, so nothing ranks siblings), `most_loved {value,
  recipe_id}`, `postcards {value, photos}`, `answered {value}` (the questions she answered first that
  month, by the same rule as the chat's "answered"; reactions never count).
- A photo is `{ message_id, photo_url, recipe_id, at }`: a `cooked` message's postcard with a 1-hour
  signed URL from the private `photos` bucket, never the storage path. One that can't be signed is
  dropped (and a Then & now without two photos with it); the numbers still show.
- Every number counts that month's rows in my time zone. Sample dishes count everywhere but the
  minutes of family voices (TODO(caleb), recap.ts). `503 "Can’t reach the family recipes right now.
  Try again."` while library.json can't be read (the numbers would come out too small); the app keeps
  the Home card and doesn't mark the month opened.

### The monthly push (cron job `recap`, push kind `recap`, app-initiated)
Title "Your November in the kitchen", body a real line from the slides, `data.url`
`/recap?month=YYYY-MM`. The first one goes out on Dec 1, for November: there is no October edition
(TODO(caleb): one is possible by setting `FIRST_MONTH` to `2026-10` on both sides). Once a month per person (dedupe `recap:YYYY-MM`), through the caps (a cook's
one a month) and quiet hours, only for a non-empty month, never for a memorial or removed person or
a phone that was signed out. The job runs every hour of the local 1st from 10:00 until quiet hours, so
a later hour still sends when the library was unreachable at 10 (with no library it sends nothing
and logs nothing); someone capped that day is logged as skipped and not tried again.

## Checks

- Offline (no database, no network; an in-memory stand-in for PostgREST and Expo's push API):
  `npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/`
- Typecheck: `npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/*.ts`
- Live, after deploying (test family only; prints PASS / FAIL lines and never a code or key):
  `node supabase/tests/two_sided_live.mjs` (`API_URL` overrides the base URL). It acts as a test
  family member with no phone and no pending invite, whom it gives a test key for the run (revoked
  at the end). It also checks that a family-invite key can't write as a face (`"Add yourself
  first."`) and runs a move to a new phone end to end (ask, list and count, approve, the old key
  signed out, `/mine` approved, no circle note) and a decline. Approving takes a settled person:
  the acting member is settled once an earlier run gave them a key over a day ago; until then it
  checks the `403 "You can do this after your first day here."` instead and prints a NOTE. Test
  people leave by themselves (nobody removes anyone else). Each run leaves its test people
  soft-removed, four "<Name> joined." circle notes, one 1:1 text and two `move_requests` rows (approved, declined; one declined when not settled) in the test family, and three
  `lander_events` rows with `app = 'two_sided_live'` (leave those out of lander numbers). Every key
  it made is revoked.
- Retention (PR 1): apply `20261018100000_retention_plumbing.sql` (push tokens, the notification
  log, `profiles.tz` / `memorial` / `share_cooking`, the widened `recipe_events` and `messages`
  kinds) **before** the function that imports `retention.ts`: `x-tz`, the message pushes and the new
  event kinds all write there. Deploy **every** file under `supabase/functions/api/` (index.ts,
  retention.ts, plumbing.ts, time.ts, table.ts, recap.ts, cooking.ts, hearts.ts, tablePr.ts,
  recapPr.ts) with `verify_jwt: false`; a deploy missing one fails the import. Then apply
  `20261018100100_retention_cron.sql` (earlier, the hourly call would only 404). Deploy the function
  (with `x-tz` in CORS) **before** the app build that sends `x-tz`, or the web app's preflight fails.
  `EXPO_ACCESS_TOKEN` is only needed if Enhanced Push Security is turned on.
- Retention (PR 3): apply `20261018100400_retention_postcard.sql` (MCP `apply_migration`, name
  `retention_postcard`; a no-op after `20261018100000`, which already adds `messages.rating`)
  **before** the deploy that has `POST /messages/:id/postcard`: from then on every message read
  selects `rating`. `20261018000000_cooked_photos.sql` (the `photos` bucket, `photo_path`) must be in
  too. Deploy the function **before** the app build with the postcard step (an older server answers
  the postcard `404`, and the step says "Try again").
- Retention (PR 6): no migration. Deploy every function file (recapPr.ts included) with `6` in
  `prs`; the app build with the recap needs an EAS rebuild (react-native-view-shot is native; Expo Go
  already has it). First edition: Dec 1 for November, so it must be live by Nov 30.
- Retention (PR 5): apply `20261018100300_retention_table.sql` (MCP `apply_migration`, name
  `retention_table`; after `20261018100000` and `20261018100100`) **before** the deploy with `5` in
  `prs`, then check its grants (anon / authenticated can't execute it). The function then answers
  `GET /table` and the hourly cron runs `table_nudge`. Deploy the function **before** the app build
  that shows the table (the app hides the row while `/table` answers 404).
- Deploy order: apply `20261018000000_cooked_photos.sql` (`messages.photo_path` and the private
  `photos` bucket) **before** the function that has `/photo-upload`: every message read selects
  `photo_path`, so without it every message route is a `500`. Apply `20261017020000_move_requests.sql` (the `move_requests` table) **before** the
  function that has `/move-requests`: without it every move route is a `500` (`GET /family`'s
  count falls back to `0` and removal's clean-up only logs). Apply
  `20261017010000_open_invites.sql` (family invites: `invites.profile_id`
  nullable) **before** the function that has `POST /invites {}` and `POST /profiles/self`, else a
  family invite fails with a `500`. Apply `20261017000000_two_sided.sql` **before** the function (the function reads
  `profiles.removed_at` on every call). Env: `APPLE_AUDIENCES` (**set the bundle id before any
  store build**), `GOOGLE_CLIENT_IDS`, `EDIBLE_WEB_URL` (invite links; default
  `https://homecookd.app`). The migration makes the profile-name index partial (`where removed_at
  is null`), so `supabase/seed/build_seed.py`'s `on conflict (family_id, lower(name))` needs `where
  removed_at is null` added before the seed is rebuilt. Deploying resets rate-limit windows once
  (their keys are now an HMAC). Deploy the function with `POST /recipe-notes/:id/remove` (and
  `Message.note_id`) **before** the app build that shows "Undo" / "Remove" on saved answers.

## Polling

No realtime. Inbox screens: `GET /threads` every 8 s while focused (the circle is in it). Cooks'
Home / Messages: `GET /questions/open` on focus and with the inbox poll. Both Homes, 1:1 chats and
"Who's in the kitchen?": `GET /table` on focus, on coming back to the foreground and after a send, "I
made it" or a listen (one shared answer between them; at most every 10 s otherwise). Cooks' Home:
`GET /hearts/recent` on focus, with the inbox poll and on coming back to the foreground (at most every
10 s, so about every 16 s; hearts send no push). A postcard changes a `cooked` message in place (no
new message), so the cook's Home refetches a thread when its `postcards` count moves (or its `last`
gains a photo). An open chat holding a `cooked` card from someone else from the last 30 minutes
also reads `GET /threads` (at most every 8 s) and fetches the whole thread when that thread's
`postcards` count moves, so a postcard that lands while the chat is open shows within ~10 s. Cooks' Recipes and recipe page: `GET /dish-stats` on
focus and on coming back to the foreground (at most every 10 s; no polling). Kid Home / Recipes:
`GET /favorites` and `GET /me/recipe-stats` on focus (no polling). Cook mode: `GET /recipes/:id/questions` on
focus and every 30 s. Open chat: `GET
/threads/:id/messages?after=<last created_at>` every 3 s, then `POST /threads/:id/read` when it
returned anything. Tab badge: `GET /unread` on focus and with the inbox poll. A phone waiting to
move in: `GET /move-requests/mine` every 5 s on its waiting screen. Everyone else: `GET /family`'s
`move_requests_pending` (and `GET /move-requests` when it's above 0) on focus. Stop polling when the
app is backgrounded. All calls are cheap (a few small indexed queries).

## Demo data

The demo family ("Our family": Mom, Dad, Grandma cooks; Leo, Maya learners) has `seed = true`
messages built from the real recipes: Dad -> Leo the chili with a note, Leo's step-3 question and
Dad's answer (unread for Leo); Leo -> Mom a request for her Sunday eggs (unread for Mom); Leo ->
Grandma a step-1 question on the noodle soup (unread for Grandma; still **open**, so it shows in
Grandma's `/questions/open` as a 1:1 question); Grandma -> Maya the noodle soup (unread for Maya).
Leo's step-3 question to Dad counts as answered (Dad wrote back after it).

Family circle (demo and test family alike): Leo asks "How do I know the spices are toasted and not
burnt?" (`dad-sunday-chili` step 3, ~1 day 22 h ago) and Dad answers it (~1 day 19 h ago, so it is
**answered** and has a **recipe note**); Leo asks "Grandma, how long do you knead it? Mine still
sticks to my hand." (`grandma-hand-pulled-noodle-soup` step 2, ~9 h ago, **open**: shows in
`/questions/open` for every cook). No emails are set on demo profiles.

Rebuild: `.venv/bin/python supabase/seed/build_seed.py <scratch>/seed.sql` (everything) or
`… build_seed.py --circle-only <scratch>/seed.sql` (just the circles), run the SQL, delete the file
(replaces seed messages only; real messages stay).

## Join links (Oct 29, docs/build/JOIN-SIMPLE.md; deploys after Apple approves 1.0)
- `POST /join-links` (signed in) → `{ url: "<WEB_URL>/i?t=<22 chars>", expires_at }`: the family's link, any number of joins, 7 days (the same link while it has more than a day left). `POST /join-links/revoke` → `{ ok: true }`. Table `join_links` (migration 20261029100000).
- `POST /invites/peek` answers a 22-char token with `kind: "link"`; `POST /invites/accept` with one gives 426 "Update homecookd to join this family."
- `POST /auth/apple|google` also take `join_token` (a 22-char link or a 1.0 16-char invite), `link_ticket` (Convex `/link/open`), `role`, `move`. A known account in another family gets `{ existing: true, needs_move: true, from_family, to_family }` and moves only with `move: true` (then `moved: { receipt }` for Convex `links.moved`). A new account joins as a new profile. `POST /auth/link` was removed before shipping.
- The 1.1 app no longer uses codes, `/invites/accept`, `/auth/email`, `share_token` joins or `/profiles/self` after an invite; they stay for 1.0 until 30 days after 1.1 is live (TODO(caleb)).

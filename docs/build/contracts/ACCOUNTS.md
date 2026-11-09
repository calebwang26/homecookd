# Accounts: the api contract for the app (1.1)

Nov 2, 2026. Read from `aws-migration` at `686ca23f5`, and checked against staging with a few calls that change nothing. For the App screens & recording chat. This covers sign-in, sessions, joining by link, sign-out, leaving, deleting an account, and the family and people screens. 1.1 talks only to the AWS api: no Supabase, no Convex, no adapter for 1.0. **One id per person: the `personId` that `POST /v1/sessions/start` returns.** Every person 1.1 makes is a new row, and on a new row sign-in's `profile_id`, `GET /family`'s `profiles[].id`, `x-profile-id` and every `/v1` id are that same value (a uuid). Store it once; there's no mapping table and no name matching.

The "Conventions" section applies to every area.

## Conventions (all areas)

### Address

| | |
|---|---|
| App settings | `EXPO_PUBLIC_BACKEND=aws`; base URL `EXPO_PUBLIC_AWS_URL`, no trailing slash. Paths below are absolute. |
| Staging today | `http://homecookd-staging-950685515.us-west-2.elb.amazonaws.com`, plain HTTP. |
| Staging over HTTPS | `https://d2zh46br3dalyf.cloudfront.net`: CloudFront in front of the same load balancer, and the one to put in `EXPO_PUBLIC_AWS_URL`. iOS refuses plain HTTP unless a build adds an App Transport Security exception. Behind it, the api sees CloudFront's address as the caller's, so per-address rate limits are shared by everyone testing. |
| Production | Not up yet. **TODO(caleb):** its name (planned `api.homecookd.app`) needs his DNS step. |
| One host, two services | The load balancer sends `/cook*`, `/record*`, `/speak*` and `/homie/*` to the voice service. Everything else goes to the api. Code: `infra/envs/staging/main.tf`. |
| Who can reach staging | Any address, except during a real-AI test window, when `alb_allowed_cidrs` may allow one address only. |
| From a browser | Staging's `/v1/*` answers CORS for the app's web build on `http://localhost:8081`, `8082` and `8083` (`APP_WEB_ORIGINS`, `api/src/cors.ts`). Every CORS answer lets the page read `retry-after` and `x-request-id`, and takes `x-request-id` and `Idempotency-Key`. Production allows no origin. |
| Up? | `GET /health` answers `ok` (text). `GET /ready` answers `{"database":"ok"}`, or 503. |

### Two credentials

| | Device key | Session token |
|---|---|---|
| Looks like | 43 characters, base64url | 43 characters, base64url |
| From | `device_key` in `POST /auth/apple`'s answer | `sessionToken` from `POST /v1/sessions/start` |
| Lasts | Until revoked: sign-out, leaving, moving to another family, deleting, or the family ending | 30 days from when it was made. Use doesn't extend it. |
| Sent as | `x-device-key: <key>` | `Authorization: Bearer <token>` |
| Used by | The Accounts family routes (`/family`, `/profiles…`, `/join-links…`, `/devices/revoke`), and `/v1/sessions/start` (in the body) | Every `/v1/*` route but three: `/v1/sessions/start` and `/v1/shares/open` are public, and `/v1/sessions/end` reads the token without checking it |

- **Both, at once.** The family and people routes take only the device key. No `/v1` route lists the family, adds a person, leaves or makes a join link. So 1.1 keeps both credentials (open item 2).
- **`x-profile-id: <personId>`**, next to the device key, says who is acting. **Required** on `/join-links`, `/join-links/revoke`, `/profiles/:id/remove`, `/profiles/:id/role`. **Optional** on `/family`, `/profiles`. **Ignored** on `/devices/revoke`.
- **Keep them in SecureStore.** Never log or show either one. Only their SHA-256 is stored on the server.
- **No refresh route.** When a `/v1` call answers 401 `signed_out`, call `/v1/sessions/start` once with the stored key and the same `profileId`, then repeat the call once. If that answers 401 `signed_out` too, the key is dead: clear everything and go to sign-in.
- **One person per session.** A session is one person on one phone. To act as someone with no phone (Grandma on Mom's phone), start a second session with her id.
- **Who can be acted as.** This phone's own person, or anyone in the family with no phone of their own. Anyone else is 403 `own_phone` ("<Name> uses their own phone.").

Code: `api/src/auth.ts` (sessions), `api/src/modules/accounts/proofs.ts` (device keys and `x-profile-id`), `sessions.ts`.

### Requests

- **JSON.** Send `content-type: application/json` and a JSON object. If a POST has nothing to send, send `{}`. With that content type, an empty body is 400 `invalid`. A body that isn't an object is 400 `invalid`. A body over 1 MB is 413 `too_large`.
- **`x-request-id`** (optional): 8 to 64 of `A-Z a-z 0-9 -`. The api uses it as the request's id, or makes one. Every answer carries `x-request-id`, and every error body carries the same id as `requestId`. Put it in the app's error logs.
- **`Idempotency-Key`**: 8 to 128 of `A-Z a-z 0-9 _ -`. Writes in other areas require or accept one. The same key with the same body returns the first answer. With another body or route it's 409 `idempotency_conflict`. Where it's required and missing, or malformed, it's 400 `invalid` with `field: "Idempotency-Key"`. Accounts routes don't read it. Code: `api/src/idempotency.ts`.
- **`x-tz: <IANA zone>`**: today only `GET /v1/table` reads it. Accounts doesn't store a zone (open item 6).
- **Paging**: a list that pages takes `?cursor=` and answers `nextCursor`, which is null at the end. A bad cursor is 400 `invalid` with `field: "cursor"`. Code: `api/src/paging.ts`.
- **How long calls can take.** `/auth/*` can wait up to 5 s for Apple's keys. `/v1/apple/revoke` can take about 30 s: up to three calls to Apple, 10 s each. Database queries stop at 10 s.

### Differences between route families the app must handle

| | Accounts family routes (`/family`, `/profiles…`, `/join-links…`, `/devices/revoke`, `/invites/peek`, `/auth/*`) | `/v1/*` |
|---|---|---|
| Field names | snake_case (`profile_id`, `avatar_key`, `device_key`) | camelCase (`personId`, `sessionToken`, `avatarKey`) |
| A kid's role | `"learner"`, in and out (`"kid"` is refused) | `"kid"` |

Errors are the same on both: the one shape below.

### Errors

**Agreed Nov 2 with App screens & recording, and what the api answers since the one-error-shape PR (#291).** Every code, where it comes from and what the app does: `ERROR-CODES.md`, the checklist for the app's words in each language.
- **One shape on every route:** `{error: <code>, message?: <English sentence>, requestId}`, plus extra fields only where a code needs them (`field` on `invalid`, `status` on `gone`). `retry-after` is a header, on 429 and 503.
- **The app shows its own words, keyed by `error`, in the person's language.** `message` is an English fallback for a code the app doesn't know yet. Never show it when the code is known, and never match on its text.
- **One code per case, never renamed once shipped.** The shared ones:

  | Status | Code | Means |
  |---|---|---|
  | 400 | `invalid` (+`field`) | Bad input. Don't retry. |
  | 401 | `signed_out` | The session or device key is gone |
  | 403 | `forbidden`, `removed_from_family`, `own_phone`, `account_deleted`, `not_in_family` | Not allowed, each its own case |
  | 404 | `not_found` | A row that's gone or isn't yours |
  | 404 | `no_route` | No such path: treat as down (an older api), not as gone |
  | 409 | `conflict`, `name_taken`, `idempotency_conflict` | `conflict` only where the app can't act on the difference |
  | 410 | `gone` (+`status`) | A link expired or was turned off |
  | 413 | `too_large` | |
  | 429 | `rate_limited`, `retry-after` | Wait, then retry |
  | 500 | `server_error` | Reads retry. A write retries only with its same `Idempotency-Key` (each area's contract lists them); without one, "didn't send, try again". |
  | 501 | `not_moved` | Staging only: that area's switch isn't on there. Production 1.1 never sees it. |
  | 503 | `unavailable`, `retry-after` | Overload, a lock or the pool. Nothing was written: retry after `retry-after`. |

  Refusals a person acts on keep their own codes, listed in each area's contract: `full`, `already_asked`, `answered`, `own_family`, `not_shared`, `declined`, `closed`, and 422 `words` for blocked wording, among others.
- **Not JSON, or 502/503/504 with no JSON body** (the load balancer or CloudFront with no healthy task): treat as `unavailable` and retry in 5 to 15 s.

**The final codes.** The shared ones above, plus each area's own. Codes are snake_case and never renamed once shipped. `api/test/errorShape.test.ts` fails if the api can send a code `ERROR-CODES.md` leaves out.

| Status | Codes |
|---|---|
| 400 | `invalid` (+`field`), `family_full` |
| 401 | `signed_out` (a session or device key: missing, ended, expired, revoked; also the retired family code), `sign_in_failed` (a bad Apple or Google token) |
| 403 | `forbidden`, `removed_from_family`, `own_phone`, `account_deleted`, `not_in_family`, `only_self`, `link_full`, `ticket_expired`, `origin`; Messages' `other_left`; Community's `not_a_guest`; Cravings' `not_asked_of_you` |
| 404 | `not_found` (a row), `no_route` (a path) |
| 409 | `conflict`, `name_taken`, `idempotency_conflict`, `retry` (a race: "Please try again.", repeat once), `link_used`, `already_joined`, `already_on_card`, `not_in_family` (a claim), `answered`, `already_delivered`, `already_asked`, `full`, `own_family`, `not_shared`, `declined`, `closed` |
| 410 | `gone` (+`status`: `expired`, `revoked`, or a 1.0 invite's `used`), `live_off` |
| 413 | `too_large` |
| 415 | `bad_type` (a file's type isn't allowed). A body with a content type that isn't JSON is 415 `invalid`. |
| 422 | `words`, `not_a_dish` |
| 426 | `update_app` (1.0 only) |
| 429 | `rate_limited`, `budget` (`/dish/*`'s daily model budget), `link_full` (a craving link's caps on `/dish/cards`), each with `retry-after` |
| 500 | `server_error` |
| 501 | `not_moved` (staging only) |
| 502, 503 | `provider_down`: S3 or a model (502); Apple's or Google's keys, or the recipe library (503). Nothing was written; try again. |
| 503 | `unavailable` (+`retry-after`), `not_set_up` (a server setting isn't there: retrying won't help), `accounts_not_moved` (staging only, while the switch is off) |

**What changed from the old shapes,** for anyone reading 1.0's code: every sentence that was in `error` is now `message`, beside its code. `bad_request` and Messages' per-field 400 codes are `invalid` with `field`; `rate` is `rate_limited`; `busy` is `unavailable`; `server` is `server_error`; `storage`, `model` and `note_failed` are `provider_down`; `no_such_recipe` is `not_found`; an unknown path is `no_route`, not `not_found`. `/dish/*` and `/invite/*` answer the same shape as everything else, `/link/open`'s 429 now carries `retry-after`, and `/invite/open`'s body over 1,000 bytes is 413 `too_large`, as everywhere, where it was 400.

**Nothing was written** on these, in every area:
- 401, and a 403 from the session or key check: both are checked before the body is read;
- 400 from validation;
- 429;
- 503 `unavailable`: `api/src/overload.ts` says "nothing was written, and the phone may simply try again";
- 502 or 503 `provider_down`, and 503 `not_set_up`;
- 503 `accounts_not_moved`.

On the Accounts routes in this doc, each write is one transaction, so any refusal (409 and 410 too) rolls all of it back. Only rate-limit counters move.

### When the api can't be reached (no stubs)

- Never show stub or made-up data. A 404 `no_route` means the path isn't there (an older api, or a route not built yet): treat it as down, never as gone.
- Keep the last good data on screen, with a quiet line: "can't reach homecookd, trying again".
- With `retry-after`, wait that long. Without it, back off: 5 s, doubling to 60 s, with jitter (LIVE-UPDATES.md's `poll.ts`). When the app comes back to the foreground, try at once.

### Live updates (polling)

`GET /v1/live/<topic>?since=<version>`, with the session. The first call sends an empty `since`. Code: `api/src/modules/live/routes.ts`.

| Answer | Means |
|---|---|
| 200 `{changed: false, version, pollAfterMs}` | Nothing new. Ask again after `pollAfterMs`. |
| 200 `{changed: true, version, pollAfterMs, data}` | New state. Keep `version` as the next `since`. |
| 401 `signed_out` | Stop polling |
| 410 `live_off` | The topic is turned off on the server. In 1.1 there's no Convex to go back to: stop polling it and read on focus (open item 7). |
| 429 `rate_limited`, `retry-after` | 120 polls a minute per person, or 30 refused calls a minute per address |
| 503 `unavailable`, `retry-after` | Keep what's on screen |

**Topics that exist: `jobs` only.** LIVE-UPDATES.md plans these, and none is built: `questions:forRecipe`, `questions:openForCook`, `live:recording`, `liveEvents:forRecording`, `liveEvents:frame`, `dishAsks:get`, `dinners:get`, `recipes:list`, `cravings:forCook`, `messages:madeMyDish`, `glasses:videos`, and the Community lists. **`people:me` isn't planned as a topic.** The plan marks it "focus only". So Accounts has no live topic. Read `GET /v1/me` and `GET /family` again when a screen gains focus and when the app returns to the foreground.

## Sign-in and sessions

Code: `api/src/modules/accounts/signin.ts`, `identity.ts`, `sessions.ts`, `routes.ts`.

### The flows

**A new person, with no link:**
1. Sign in with Apple. Take its `identityToken`.
2. `POST /auth/apple {id_token}` answers `{existing: false, needs_name: true, suggested_name}`. Nothing is made yet.
3. Ask what their family calls them, and whether they cook or learn.
4. `POST /auth/apple {id_token, name, role}`, with the same token while it's still valid, answers `{existing: false, needs_name: false, joined: false, device_key, family_name: "<name>'s family", profile_id}`.
5. `POST /v1/sessions/start {deviceKey: device_key, profileId: profile_id}` answers `{sessionToken, familyId, personId, role}`. From here on, `personId` is the id.

**A returning person on a new phone, or after sign-out:** step 2 answers `{existing: true, needs_name: false, joined: false, device_key, family_name, profile_id}` right away. Then step 5. The circle gets "<Name> signed in on a new phone", but not again within 2 minutes.

**A phone that still has its key:** no sign-in. Step 5 when it has no session, or after a 401 `signed_out`.

**Joining a family by link.** A family's link is `https://homecookd.app/i?t=<22 characters>`, from `POST /join-links`.
1. `POST /invites/peek {token: t, name?}` shows "Join <family_name>?". With a typed `name`, `claimable` may offer "Are you Leo?".
2. Sign in with Apple, then `POST /auth/apple {id_token, join_token: t, name?, role?, claim_profile_id?}`:
   - a new account with no `name` gets `needs_name`: ask, then call again;
   - "Yes, that's me" sends `claim_profile_id: claimable.id`, and the new account becomes that person;
   - a known account already in that family just signs in;
   - a known account in another family gets `needs_move` (below).
3. `POST /v1/sessions/start`.

**A dish card's link** (also 22 characters):
1. `POST /link/open {token}` says what the card is.
2. Not signed in, and `ticket` isn't null: sign in with Apple, then `POST /auth/apple {id_token, link_ticket: ticket, name?}`. The ticket lasts 10 minutes. The card's side sets the role.
3. Signed in: `POST /v1/links/claim {token}` puts the card in the app.

**Moving to another family.** `needs_move` comes with `from_family`, `to_family` and `would_delete`.
1. Warn first. The people in `would_delete` are deleted by the move.
2. If they say yes, sign in with Apple again and call with `move: true` and the fresh `id_token`. The answer carries `moved: {receipt}`.
3. Start a session as the new person. Then, if `receipt` isn't null, `POST /v1/links/moved {receipt}` brings their recipes along when nobody else signs in to the old family.

**Sign out:**
1. If this phone registered a push token, `POST /v1/push-tokens/remove {token}` with the session (Messages area).
2. `POST /devices/revoke {}` with `x-device-key` answers `{ok: true}`. The key and every session on this phone stop at once.
3. Clear the key and the tokens.

`POST /v1/sessions/end` ends only one session. The key keeps working, so it isn't a sign-out.

**Delete account** (App Review 5.1.1(v)):
1. `GET /v1/apple/revoke-ready` answers `{ready}`.
2. If `ready` and they signed in with Apple: ask Apple to confirm again, then `POST /v1/apple/revoke {authorizationCode}`. It answers `{revoked: true}`, or `{revoked: false, reason}`. Go on either way.
3. `POST /v1/account/delete {}` answers `{deleted: true}`.
4. Clear the key and the tokens. Every phone and session of theirs has ended. There's no follow-up call: 1.0's `/profiles/:id/remove` after a delete isn't needed.

These three routes work for someone who left the family too: every other route answers them 403 `removed_from_family`. A retry after a lost answer gets 401 `signed_out`, which here means it worked. To delete a phone-less person, such as Grandma from Mom's phone: warn first, start a session with her id, then step 3. When the last signed-in person deletes, leaves or moves, the phone-less people left are deleted too and the family ends (ACCOUNTS-MIGRATION.md, C2). Warn about that as well.

### `POST /auth/apple` (public)

`POST /auth/google` is the same with Google's `idToken` and "Google" in the sentences.

| Body field | Type | Notes |
|---|---|---|
| `id_token` | string, required, at most 8000 | Apple's `identityToken`. Checked: RS256, issuer `https://appleid.apple.com`, audience in `APPLE_AUDIENCES` (default `com.salik.homecookd` and Expo Go's `host.exp.Exponent`), not expired. |
| `name` | string, at most 40 | What the family calls them. Apple doesn't put the name in the token, so send it on the second call. |
| `role` | `"cook"` or `"learner"` | Required for a new person with no link. With `join_token` or `share_token` it defaults to `learner`. A ticket's side sets it. |
| `device_label` (or `label`) | string, at most 40 | The phone's name. Display only. |
| `join_token` | string | A family link's `t` (22 characters). 16 characters is a 1.0 invite. |
| `link_ticket` | string | From `POST /link/open`. Never together with `join_token`. |
| `claim_profile_id` | uuid | Peek's `claimable.id`. Only with `join_token`. |
| `move` | boolean | `true` to move families after `needs_move`. |
| `share_token` | 10 characters | A recipe share link's `s`. A new person joins the sharer's family, at most 5 per link. |

| Case | Answer (200) |
|---|---|
| New account, no `name` | `{existing: false, needs_name: true, suggested_name: string \| null}`. Nothing is made. |
| Known account | `{existing: true, needs_name: false, joined: false, device_key, family_name, profile_id}` |
| New, no link | `{existing: false, needs_name: false, joined: false, device_key, family_name, profile_id}`, in a new family called "<name>'s family" |
| New, through a link | `{existing: false, needs_name: false, joined: true, device_key, family_name, profile_id}` |
| Known, link to another family, no `move` | `{existing: true, needs_move: true, from_family, to_family, would_delete: [{profile_id, name}]}`. Nothing changed. |
| Known, `move: true` | `{existing: true, needs_name: false, joined: true, device_key, family_name, profile_id, moved: {receipt: string \| null}}` |

A repeat with the same valid token is safe. The account is found again and gets a new key, and a key from a lost answer is never used.

| Status | `error` | `message`, and when |
|---|---|---|
| 400 | `invalid` (+`field`) | "id_token is required", "name must be at most 40 characters", "role must be cook or learner", "claim_profile_id is not a valid id", "claim_profile_id goes only with a family join link.", "Send join_token or link_ticket, not both.", "move must be true or false" |
| 400 | `family_full` | "This family already has 30 people" |
| 401 | `sign_in_failed` | "That Apple sign-in didn't work. Please try again.": a bad, expired or forged token |
| 403 | `ticket_expired` | "This link didn't work. Open it again.": a bad or expired ticket |
| 403 | `link_full` | "This link is full. Ask your family for a new one.": a share link |
| 404 | `not_found` | "That invite link doesn't work.", "That family isn't on homecookd anymore." |
| 409 | `name_taken` | "<Name> is already in this family" (a link join), "<Name> is already in this family. Try another name." (a share link) |
| 409 | `link_used` | "This link already brought someone in. Ask them for an invite.": a card side was used |
| 409 | `not_in_family`, `already_joined` | "That person isn't in this family.", "That person is already on homecookd.": claims |
| 409 | `retry` | "Please try again.": a race. Repeat once with a fresh token |
| 410 | `gone` (+`status`) | "This link expired." or "This link was turned off.", with `status: "expired" \| "revoked"` |
| 429 | `rate_limited` | "Too many attempts. Please wait a few minutes." Limits: 30 per 10 minutes per address; 5 new families per hour; 20 link joins per 10 minutes; 20 unknown links per 10 minutes. |
| 503 | `not_set_up` | "Apple sign-in isn't set up yet.", "Apple sign-in isn't set up for this version yet. Try an invite link." (the audience isn't listed), "Links aren't set up yet." (a ticket, with no `LINK_JOIN_SECRET`) |
| 503 | `provider_down` | "We couldn't reach Apple just now. Please try again." |
| 503 | `accounts_not_moved` | |
| 500 | `server_error` | "Couldn't create your family. Please try again." |

### `POST /v1/sessions/start` (public: the key is in the body)

**Body:** `{deviceKey, profileId}`, both required. `profileId` is still needed. It's the person to act as: this phone's own person (`profile_id` from sign-in, or `device_profile_id` from `/family`), or a phone-less person in the family. It must be a uuid. For every person made on this api it equals the `personId` the answer returns.

**Answer:** `{sessionToken, familyId, personId, role: "cook" | "kid"}`.

| Status | `error` | `message`, and when |
|---|---|---|
| 400 | `invalid` (+`field`) | "Sign in again.": `deviceKey` or `profileId` is missing. "x-profile-id must be a profile id": `profileId` isn't a uuid (`field` and the sentence name the header even here) |
| 401 | `signed_out` | "This phone was signed out." |
| 403 | `account_deleted` | "This account was deleted." |
| 403 | `removed_from_family` | "That person isn't in this family anymore." |
| 403 | `not_in_family` | "That profile isn't part of this family" |
| 403 | `own_phone` | "<Name> uses their own phone." |
| 403 | `forbidden` | "Add yourself first.", "They haven't joined yet." (1.0 phones only) |
| 429 | `rate_limited` | "Too many attempts. Please wait a few minutes.": 20 unknown keys per 10 minutes per address |

### `POST /v1/sessions/end` (Bearer)

`{}` answers `{ok: true}`, always. It ends that one session. The device key keeps working.

### `POST /link/open` (public)

**Body:** `{token}`, a card's 22 characters. It changes nothing but rate-limit counters.

**Answer:** `{side: "kid" | "cook", dish, kidName: string | null, relation, familyName: string | null, taken, ticket: string | null, language: string | null, joinable: "yes" | "taken" | "window" | "no_family" | "off"}`.
- `relation`: one of `mom`, `dad`, `grandma`, `grandpa`, `auntie`, `uncle`, `none`.
- `taken`: someone still here holds that side.
- `ticket`: set only when `joinable` is `"yes"`.
- `language`: the cook side only.

**Errors:**
- 400 `invalid`, `field: "token"`, "token is required";
- 404 `not_found`, "This link doesn't work anymore.";
- 429 `rate_limited` with `retry-after`, "Too many tries. Please wait a few minutes and try again." (30 per 10 minutes per address; 20 unknown tokens; 5 tickets per hour per card side).

The app sends no `Origin`, so the 403 `origin` check doesn't apply to it. Code: `links.ts`.

### `POST /v1/links/claim` (session)

**Body:** `{token}`, a card's 22 characters.

**Answer:** `{dishAskId, side: "kid" | "cook", sameFamily, taken}`.
- `taken: true`: someone else holds that side, and nothing changed.
- A card with no family joins the caller's family.
- Claiming again gives the same answer.

**Errors:**
- 404 `not_found`, "This link doesn't work anymore.";
- 403 `removed_from_family`, "That person isn't in this family anymore.";
- 409 `already_on_card`, "You're already on this card.";
- 503 `accounts_not_moved` on the cook's side while the switch is off, because the claim also sets the cook's relation.

### `POST /v1/links/moved` (session, as the new person)

**Body:** `{receipt}`. It's good for an hour.

**Answer:** `{recipes, faces}`, both counts. A repeat answers 0.

**Error:** 403 `forbidden`, "That move can't be checked. Your recipes stay where they were.".

### `GET /v1/apple/revoke-ready`, `POST /v1/apple/revoke`, `POST /v1/account/delete` (session, even for someone who left)

| Route | Body | Answer | Errors |
|---|---|---|---|
| `GET /v1/apple/revoke-ready` | none | `{ready: boolean}`: Apple's key is set on the server | 401 `signed_out` |
| `POST /v1/apple/revoke` | `{authorizationCode}` | `{revoked: true}` or `{revoked: false, reason}`. Reasons include `"not configured"`, `"no code"`, and Apple's status. | 401 `signed_out`; 429 `rate_limited`, "Too many attempts. Please wait a few minutes." (20 per hour per person); 503 `accounts_not_moved` |
| `POST /v1/account/delete` | `{}` | `{deleted: true}` | 401 `signed_out` (also the answer to a retry after it worked); 404 `not_found`; 503 `accounts_not_moved`; 503 `unavailable` |

Code: `routes.ts`, `appleRevoke.ts`, `deletion.ts`.

## Family and people

Code: `api/src/modules/accounts/family.ts`, `invites.ts`, `routes.ts`; `api/src/modules/people/` for `/v1/me`.

### `GET /v1/me` (session)

**Answer:** `{person: {id, name, role: "cook" | "kid", language: string | null}, family: {id, name}}`.
- `person.id` is the `personId`.
- `language` is a code like `"mr"`; null means English.

**Errors:** 401 `signed_out`; 403 `removed_from_family` (they left the family); 404 `not_found`.

### `GET /family` (`x-device-key`; `x-profile-id` optional)

**Answer:**

```json
{ "family": { "id": "…", "name": "Asha's family" },
  "profiles": [ { "id": "…", "name": "Asha", "role": "cook", "relation": null, "avatar_key": null,
                  "invited": false, "has_phone": true, "locked": false, "memorial": false } ],
  "former_profiles": [ { "id": "…", "name": "Sam", "role": "learner", "relation": null, "avatar_key": null } ],
  "device_profile_id": "…",
  "device_needs_profile": false,
  "move_requests_pending": 0,
  "can_manage": true }
```

| Field | Meaning |
|---|---|
| `profiles` | People in the family now, in family order (`sort`, then when added). Removed and deleted people are left out. |
| `locked` | They have their own phone and it isn't this one. Show the face, but don't act as them: it's 403 `own_phone`. |
| `has_phone` | A live key belongs to them. |
| `memorial` | Always present here. When true, never address them as present. |
| `invited` | A 1.0 invite that isn't used yet. Always false in a family made by 1.1. |
| `former_profiles` | People who left. Only for drawing old messages; never list them or offer them as "me". |
| `device_profile_id` | This phone's own person. |
| `device_needs_profile`, `move_requests_pending`, `can_manage` | For 1.0's phones and move requests. In a family made by 1.1, `device_needs_profile` is false and `move_requests_pending` is 0. |

A removed or locked `x-profile-id` is ignored here, not refused, so a phone can always load the family.

**Errors:** 401 `signed_out`, "This phone was signed out." (or "Missing family code (x-family-code header)" with no `x-device-key`); 400 `invalid`, `field: "x-profile-id"`, "x-profile-id must be a profile id"; 403 `not_in_family`, "That profile isn't part of this family".

### `POST /profiles`: add someone with no phone (`x-device-key`; `x-profile-id` optional)

**Body:** `{name, role, relation?}`.
- `name`: required, at most 40 characters.
- `role`: `"cook"` or `"learner"`, required.
- `relation`: at most 40 characters.

An `email` is refused: 403 `forbidden`, "Emails can't be added in this version. Send an invite instead.".

**Answer:** `{id, name, role, relation, avatar_key}`. No note goes in the circle.

**Errors:**
- 400 `invalid` (+`field`): "name is required", "role is required", "role must be cook or learner", "name must be at most 40 characters";
- 400 `family_full`, "This family already has 30 people";
- 409 `name_taken`, "<name> is already in this family" (names are unique per family, ignoring case);
- 404 `not_found`, "That family isn't on homecookd anymore.";
- 503 `accounts_not_moved`.

### `POST /profiles/:id/remove`: leave the family (`x-device-key` + `x-profile-id`)

**Body:** `{}`. `:id` must be the `x-profile-id`. The caller must be on their own phone, or be someone with no phone acted as from here.

**Answer:** `{ok: true}`.
- From their own phone, it signs this phone out. The key dies, so clear it.
- Their sessions, phones and Apple login end.
- The name can be used again.
- If they were the last signed-in person, the phone-less people left are deleted and the family ends. Warn first.

**Errors:**
- 400 `invalid`, `field: "x-profile-id"`, "x-profile-id header is required for this request";
- 403 `only_self`, "Only <Name> can remove themselves.";
- 404 `not_found`, "id: no such person in this family";
- 503 `accounts_not_moved`.

A retry after a lost answer gets 401 `signed_out` (own phone) or 403 `removed_from_family`, "That person was removed from this family. Pick who you are." (a lent phone). Both mean it worked.

### `POST /profiles/:id/role`: move between the cooks and the ones who miss it (`x-device-key` + `x-profile-id`)

Caleb, Nov 9. **Body:** `{role: "cook" | "learner"}`. Allowed when `:id` is this phone's own person, or someone with no phone (any phone in the
family can move them): the same rule as leaving, and as `/family`'s `locked`. Nobody changes someone else who has their own phone.

**Answer:** their profile, as `/family` lists it: `{id, name, role, relation, avatar_key, invited, has_phone, locked: false, memorial}`. The same role
again is a no-op 200. Only the role changes: their recipes, jobs, messages and asks stay. Their next `POST /v1/sessions/start` answers the new `role`.

**Errors:**
- 400 `invalid`, `field: "role"`, "role must be cook or learner";
- 403 `only_self`, "Only <Name> can change this, on their own phone.";
- 404 `not_found`, "id: no such person in this family";
- 429 `rate_limited` (30 an hour per family);
- 503 `accounts_not_moved`.

### `POST /join-links`: the family's link (`x-device-key` + `x-profile-id`)

**Body:** `{}`.

**Answer:** `{url: "https://homecookd.app/i?t=<22 characters>", expires_at}`.
- The link works for anyone, any number of times, for 7 days.
- The same link comes back while it has more than a day left.
- A link made on staging points at staging's own `/i` page (`EDIBLE_WEB_URL`).

**Errors:**
- 400 `invalid`, `field: "x-profile-id"`, "x-profile-id header is required for this request";
- 429 `rate_limited`, "That's a lot of invites for one day. Try again tomorrow." (50 per family per day);
- 500 `server_error`, "Couldn't make a link. Please try again.".

### `POST /join-links/revoke`: turn the link off (`x-device-key` + `x-profile-id`)

**Body:** `{}`.

**Answer:** `{ok: true}`. The next `POST /join-links` makes a new link.

### The reviewer's link (no route)

The TEST family also has one link with no expiry (`expires_at` null, no inviter), for Apple's reviewer. Only the team makes or turns it off, with the one-off task `node dist/reviewerLink.js make|revoke <familyId>` (`api/src/reviewerLink.ts`; `infra/README.md`, "Production before launch", 8.3). It joins like any family link. `POST /join-links` never returns it, and `POST /join-links/revoke` leaves it on. `POST /invites/peek` answers it with `expires_at: null`. Only one family has one at a time.

### `POST /invites/peek`: what a link says (public; `x-device-key` optional)

**Body:** `{token, name?}`.

**Answer for a 22-character family link:** `{status: "pending" | "expired" | "revoked", family_name, inviter: {name, relation, avatar_key} | null, invitee: null, expires_at: string | null, same_family?: boolean, kind: "link", claimable: {id, name, avatar_key} | null}`.
- `same_family` is there only when `x-device-key` was sent. It's true when this phone is already in that family.
- `claimable` is the one person of exactly the typed `name` with no account yet.
- Peeking reads only. It never joins.

**Errors:**
- 404 `not_found`, "That invite link doesn't work.";
- 400 `invalid`, `field: "token"`, "token or code is required";
- 429 `rate_limited`, "Too many attempts. Please wait a few minutes." (60 per 10 minutes per address; unknown links 20).

### `POST /devices/revoke`: sign this phone out (`x-device-key`)

**Body:** `{}`.

**Answer:** `{ok: true}`. The key and every session on this phone stop at once.

**Error:** 401 `signed_out` if the key is already dead. That also means it's signed out.

### On the api, but not for 1.1

| Route | Why not |
|---|---|
| `POST /profiles/self` | Adds a person to a phone that has none. Every 1.1 sign-in gives the phone its own person. Only 1.0 invites and family codes made phones with none. |
| `POST /move-requests`, `GET /move-requests`, `GET /move-requests/mine`, `POST /move-requests/:id/approve`, `/decline` | Only a phone that joined through a 1.0 invite can ask: 400 `invalid`, "Only a phone that just joined can ask to move in.". Someone on a new phone signs in with Apple and is themselves at once. |
| `POST /devices` | Swaps a family code for a key. Family codes are retired. |
| `POST /invites`, `POST /invites/accept` | 1.0's one-use invites. Given a family link, `/invites/accept` answers 426 `update_app`, "Update homecookd to join this family.". |

## What the app calls today, and what replaces it

The rows come from APP-BACKEND-INVENTORY.md's "Sign-in, people and family" on `main`, plus the calls `app/src/lib/api.ts` defines.

| Today | App wrapper | 1.1 |
|---|---|---|
| Supabase `POST /auth/apple` | `session.tsx:providerAuth` | `POST /auth/apple`, the same. The app's `ProviderAuth` type lacks `needs_move`'s `would_delete`: read it and warn. |
| Supabase `POST /auth/google` | `session.tsx:providerAuth` | `POST /auth/google`. Google stays in 1.1, beside Apple (Android, Caleb, Nov 2). Until Caleb creates the Google clients and API sets `GOOGLE_CLIENT_IDS`, it answers 503 `not_set_up`, "Google sign-in isn't set up yet.", and the app keeps the button hidden (open item 8). |
| Convex `sessions:start` | `convex.ts:convexSession`, `deleteMyAccount` | `POST /v1/sessions/start` |
| Supabase `GET /family` | `session.tsx:SessionProvider` | `GET /family`, the same shape |
| Convex `people:me` | `convex.ts:useMe` | `GET /v1/me`. The shape changed: `person.id`, not `personId`; `language` null means English (Convex sent `"en"`); no `relation` (read it from `/family`). Read it on focus; it isn't live. |
| Convex `people:family` | `convex.ts:convexKidIds` | Gone: `/family`'s ids are the ids every `/v1` route takes. Kids are `role: "learner"` there. `GET /v1/circle`'s `members` lists the same people with the session (Messages area). |
| Convex `cooking:current`, `messages:list`, `questions:openForCook`, as `convexPersonIdByName` | `convex.ts` | Gone in 1.1: one id, so no name matching. The calls themselves belong to their own areas. |
| Convex `people:setLanguage` | `convex.ts:setLanguage` | **Not built.** No route sets a person's language (open item 5). |
| Supabase `POST /profiles` | `AddPhonelessSheet.tsx` | `POST /profiles`, the same |
| Supabase `POST /profiles/:id/remove` | `MembersSheet.tsx`, `SessionProvider` | The same for "Leave". Drop the call after deleting an account: it isn't needed. |
| Supabase `POST /profiles/self` | `SessionProvider` | Gone in 1.1: see "On the api, but not for 1.1" |
| Supabase `POST /devices` | `SessionProvider` | Gone in 1.1: family codes are retired |
| Supabase `POST /devices/revoke` | `SessionProvider` | `POST /devices/revoke`, the same |
| Supabase `POST /invites/peek` | `useClaimPeek.ts` | `POST /invites/peek`, the same |
| Supabase `POST /join-links` | `invites.ts:familyJoinLink` | `POST /join-links`, the same |
| Supabase move requests (5 calls) | `moveRequests.ts` | Gone in practice: the routes exist, but no 1.1 phone can ask (open item 9) |
| Supabase `GET /shares/:id` | `handoff.ts:peekShare` | `POST /v1/shares/open {token}`, a camelCase answer (Messages & questions area). A new person still joins a share link's family with `share_token` on `/auth/apple`. |
| Supabase `POST /push-tokens`, `/push-tokens/remove`; Convex `push:register`, `push:unregister` | `_layout.tsx`, `SessionProvider`, `pushTokens.ts` | `POST /v1/push-tokens {token, platform, tz}`, `POST /v1/push-tokens/remove {token}`, with the session (Messages & questions area) |
| Convex `apple:revokeReady` | `convex.ts:appleRevokeReady` | `GET /v1/apple/revoke-ready` |
| Convex `apple:revoke` | `convex.ts:revokeAppleSignIn` | `POST /v1/apple/revoke` |
| Convex `account:deleteMe` | `convex.ts:deleteMyAccount` | `POST /v1/account/delete`. It answers `{deleted: true}`; Convex answered null. |
| Convex `links:claim` | `links.ts:claimLink` | `POST /v1/links/claim` |
| Convex `links:moved` | `links.ts:linksMoved` | `POST /v1/links/moved` |
| Convex HTTP `/link/open` | `links.ts:openLink` | `POST /link/open` on the api |
| `POST /invites` (defined, never called) | `api.ts:createInvite` | Not for 1.1 |
| `POST /invites/accept` (not called today) | none | Gone in 1.1: a 1.1 phone joins through `/auth/apple` with `join_token` |
| `POST /auth/email`, `/signup`, `/profiles/:id/email` (not called) | none | Not built, and not needed |
| The `x-family-code` header | `api.ts`, `cookingApi.ts`, `moveRequests.ts`, and others | Gone: family codes are retired |
| The `x-tz` header | `api.ts` | Read only by `GET /v1/table`. Nothing stores it on the person (open item 6). |

## Staging testing

**Real Sign in with Apple works against staging** from a TestFlight or dev build: the api checks Apple's token itself, and `APPLE_AUDIENCES` defaults to the app's bundle id.

**For scripts, a staging-only test sign-in.** Sign in with Apple can't run in a script, so:
- `POST /v1/test/sign-in`, header `x-test-signin-key: <TEST_SIGNIN_KEY from the root .env>`.
- The body is `/auth/apple`'s with `test_id` (1 to 40 of `a-z 0-9 -`) in place of `id_token`: `{test_id, name?, role?, join_token?, link_ticket?, claim_profile_id?, move?, share_token?}`. The answers are `/auth/apple`'s, and then `POST /v1/sessions/start` as usual.
- The same `test_id` is the same person each time, so pick one per test person (`cook-1`, `kid-1`). Its account can never be a real Apple account's.
- A wrong or missing key is 401 `signed_out`. Without the key on the server, the route doesn't exist: production answers 404 `no_route`, and Terraform refuses the key in production.

**Accounts is on for staging:** `ACCOUNTS_OWNS_PEOPLE=1`, staging-only `LINK_JOIN_SECRET` and `LEFT_IDENTITY_SECRET`, and `EDIBLE_WEB_URL` pointing at staging's web page. Staging runs no sync, so the api owns its people. What staging still can't do, per `infra/envs/staging/main.tf`:

| Setting not set | Effect |
|---|---|
| `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY` | `revoke-ready` answers `{ready: false}` |
| `GOOGLE_CLIENT_IDS` | Google sign-in is 503 `not_set_up` |

`OVERLOAD_SHED=on` is set on staging. Its one small api task turns requests away with 503 `unavailable` under load, so the retry path gets used.

## Open items

Owners: **API** is the AWS backend chat, **App** is App screens & recording, **Caleb** is a decision only he makes.

1. Production has no address yet. Caleb: the DNS step for `api.homecookd.app`.
2. No `/v1` route lists the family, adds a person, leaves, makes or turns off a join link, or signs a phone out, so 1.1 must keep the device key and send `x-device-key` alongside the session. App: say if you'd rather have `/v1` versions and one credential, and API adds them.
3. Staging has none of Apple's revocation keys (`APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY`), so revocation before delete can't be tested there. Caleb: whether to put the real key on staging.
4. A person copied from Supabase by the sync, if any is on staging, has two ids: `supabase_id` on the family routes and `id` on `/v1` (`extId` in `data.ts`). Test 1.1 only with families made on the AWS api, or have the api stop sending `supabase_id`.
5. No route sets a person's language (`people:setLanguage` isn't built). API builds it.
6. Nothing stores the phone's time zone on the person. Supabase stored it from `x-tz`; today only push tokens carry `tz`. API builds it.
7. `/v1/live`'s 410 `live_off` still means "go back to Convex", which 1.1 won't have. App: treat it as "read on focus".
8. Google sign-in stays in 1.1, beside Apple, because Caleb wants Android eventually (Nov 2: "keep google too - we want to support android too"). No Google OAuth clients exist yet (`app/src/lib/auth/google.ts`'s `TODO(caleb)`). Caleb first: create the web, iOS and Android clients in Google Cloud. Then API puts their public ids in `GOOGLE_CLIENT_IDS` on staging and production (they aren't secrets), and App sets them in the app's settings; showing the iOS button needs a new native build, for Google's URL scheme. Until then `/auth/google` answers 503 `not_set_up`, and the app keeps the button hidden.
9. A 1.1 phone can never make a move request, so the "on a new phone" screens and `/family`'s `move_requests_pending` serve no one in 1.1. Recommendation: App drops them.
10. Field names and role words differ between the family routes (snake_case, `learner`) and `/v1` (camelCase, `kid`). Stays as documented unless App asks for item 2's `/v1` versions.
11. `APPLE_AUDIENCES` still defaults to include Expo Go. ACCOUNTS-MIGRATION.md recommends dropping it at the switch. Caleb: it's his `TODO(caleb)` in `identity.ts`.

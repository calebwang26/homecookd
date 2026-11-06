# Every error code the api can return

Nov 2, 2026. For the App screens & recording chat: the checklist of codes that need the app's own words, in every language it speaks. The shape and the rules are in ACCOUNTS.md, "Conventions" → "Errors". `api/test/errorShape.test.ts` reads every code out of `api/src/` and fails if one is missing here.

**The shape, on every route** (`/v1/*`, the family routes, `/auth/*`, `/dish/*`, `/link/open`, `/invite/*`):

```json
{ "error": "<code>", "message": "<English sentence>", "requestId": "<id>" }
```

- `error` is always one of the codes below, never a sentence. Pick the words by it.
- `message` is optional: an English fallback for a code the app doesn't know yet. Never match on its text.
- Extra fields only where a code needs them: `field` on `invalid` (the request field that's wrong, as the caller named it: `"kind"`, `"edits.2.kind"`, `"x-profile-id"`, `"Idempotency-Key"`), `status` on `gone`.
- `retry-after` (seconds) is a header, on every 429 and on 503 `unavailable`.
- `GET /ready`'s 503 also keeps `database: "unreachable"`.
- A body that isn't JSON, or a 502/503/504 with no JSON (the load balancer or CloudFront with no healthy task): treat it as `unavailable` and retry in 5 to 15 s.

**Staging only** marks a code production 1.1 never sees. **1.0 only** marks one only an old build's calls can reach: the routes are on the api, but 1.1 doesn't call them.

## 400

| Code | Where | The app does |
|---|---|---|
| `invalid` (+`field`) | Every route: a missing, wrong-typed, too-long or malformed field, a forged cursor, a bad `Idempotency-Key`, a NUL byte. Also 415 for a body sent with a content type that isn't JSON | Fix the call; don't retry. A few carry a sentence a person caused (Jobs' "Pick 1 to 20 videos.", Community's "Seats go from 1 to 20.", Cravings' "Your message must be 1 to 300 characters."): check those before sending, and fall back to `message` |
| `family_full` | `POST /profiles`, and joining through `/auth/apple` or `/auth/google` with a link: a family has at most 30 people | "This family already has 30 people." |

## 401

| Code | Where | The app does |
|---|---|---|
| `signed_out` | Every `/v1` route with a session: the session is missing, expired, ended, or its person deleted. The family routes and `/v1/sessions/start`: the device key is missing, unknown or revoked (and the retired family code). `/v1/test/sign-in` and `/v1/test/recipe` with a wrong key (**staging only**) | On `/v1`: start a session once with the stored key, then repeat the call once. If `/v1/sessions/start` or a family route says `signed_out`, the key is dead: clear everything and go to sign-in |
| `sign_in_failed` | `/auth/apple`, `/auth/google`: a bad, expired or forged token | "That Apple sign-in didn't work. Please try again." Sign in again for a fresh token |

## 403

| Code | Where | The app does |
|---|---|---|
| `forbidden` | `/v1`: the role may not do this (a kid on a cook's route), or it isn't theirs (a postcard on someone else's dish, saving someone else's message, taking out a note, delivering someone else's recording, answering another cook's question, sharing another cook's recipe, taking another cook's recipe off the map). `/v1/links/moved`: a receipt that can't be checked. **1.0 only:** "Add yourself first.", "They haven't joined yet.", emails on `POST /profiles`, the move-request rules | Don't offer what's refused. If it comes anyway, show "You can't do that" |
| `removed_from_family` | Every `/v1` route with a session, except account deletion and Apple revocation: the session's person left the family. `/v1/sessions/start` and `/v1/links/claim` for someone who left. A family route whose `x-profile-id` left | Only account deletion still works for them. On a lent phone: "Pick who you are" |
| `own_phone` | The family routes and `/v1/sessions/start`: acting as someone who has their own phone | "<Name> uses their own phone." Don't offer them as "me" (`/family`'s `locked`) |
| `account_deleted` | `/v1/sessions/start` for someone who deleted their account | Clear the key and the tokens; say the account was deleted |
| `not_in_family` | `x-profile-id` or `profileId` names someone who was never in this family (also 409 on a claim, below) | Reload `/family` and pick again |
| `only_self` | `POST /profiles/:id/remove` for someone else | "Only <Name> can remove themselves." |
| `link_full` | `/auth/apple` with `share_token`: a recipe link brings in at most 5 people. (Also 429 from `/dish/cards`, below) | "This link is full. Ask your family for a new one." |
| `ticket_expired` | `/auth/apple` with `link_ticket`: the ticket is bad or older than 10 minutes | "This link didn't work. Open it again." Call `POST /link/open` again for a fresh ticket |
| `origin` | `/dish/*`, `/link/open`, `/invite/open`, `/v1/shares/open` from a web page on another site (`/v1/shares/open` takes only `SITE_ORIGINS`) | Never from the app (it sends no `Origin`). On the web, a bug |
| `other_left` | Messages: a conversation with someone who left the family | "<Name> isn't in the family anymore." |
| `not_a_guest` | `POST /v1/dinners/:id/invite-link`: only the host and their guests | "Only the host and their guests can invite friends." |
| `not_asked_of_you` | Cravings (`/v1/cravings/:id/*`): a request asked of someone else in the family | "Only <Name> can answer this one." The sentence names them |

## 404

| Code | Where | The app does |
|---|---|---|
| `not_found` | Any route with an id or a token: the row is gone, or isn't this family's (the same answer for both). A dead token on `/dish/*`, `/link/open`, `/invite/open`, `/invites/peek`, `/v1/links/claim`, `/v1/shares/open` | Show that it's gone, and drop it from the screen |
| `no_route` | Any path no route has, under every prefix | Not "gone": an older api, or a route that isn't built. Treat it as down: keep what's on screen and try again later |

## 409

| Code | Where | The app does |
|---|---|---|
| `conflict` | Messages: a pending send that belongs to someone else. `/v1/test/recipe` with a `jobId` already finished (**staging only**). **1.0 only:** an email already in a family, a phone that already belongs to someone, a phone that stopped waiting | Nothing the app can act on: show `message`, then reload |
| `name_taken` | `POST /profiles`, joining through `/auth/apple` (a link or a share link), `POST /profiles/self`, `POST /invites` | "<Name> is already in this family." Ask for another name |
| `idempotency_conflict` | Any write with an `Idempotency-Key`: the same key with another body or route | A bug: a new write needs a new key |
| `retry` | `/auth/apple` and `/auth/google` when two taps race; **1.0 only:** `/invites/accept`, `POST /move-requests` | "Please try again." Repeat once, with a fresh sign-in token |
| `link_used` | `/auth/apple` with `link_ticket`: that side of the card already brought someone in | "This link already brought someone in. Ask them for an invite." |
| `already_joined` | `/auth/apple` with `claim_profile_id`: that person already has an account or a phone. **1.0 only:** re-inviting someone who joined | "That person is already on homecookd." |
| `already_on_card` | `POST /v1/links/claim`: the caller holds the card's other side | "You're already on this card." |
| `not_in_family` | `/auth/apple` with `claim_profile_id`: the person peek offered has left | "That person isn't in this family." Join as someone new |
| `answered` | `POST /v1/questions/:id/answer`, share asks and dinner requests (`/respond`); **1.0 only:** move requests | "You already answered." Reload |
| `already_delivered` | `POST /v1/pending-sends` after the recipe went out | "That recipe was already delivered." |
| `already_asked` | `POST /v1/dinners/:id/join` again | "You already asked to join." |
| `full` | `POST /v1/dinners/:id/join`, and accepting a guest | "That dinner is full." |
| `own_family` | Community: asking your own family for a recipe or a dinner | "This is your family's dinner." |
| `not_shared` | Community: a dinner or a swap with a recipe that isn't shared | "Share this recipe first." |
| `taken_down` | `POST /v1/share-requests`: the team took this recipe off the map after a report (its `hiddenAt` is set), for anyone in the family | "Our team took this recipe off the map after a report. It stays with your family." Don't offer sharing it (`takenDown` in the chooser) |
| `declined` | Community: asking again after they said no. `POST /v1/share-requests` within 24 hours of the cook's no or unclear answer (MESSAGES.md, flow 8) | "They said not this time." For a share ask: "<Cook> said not now. Ask again tomorrow.", the cook named as in `message` |
| `closed` | `/dish/*` and Cravings: the answers were already sent | "These answers were already sent." |

## 410, 413, 415, 422, 426

| Code | Where | The app does |
|---|---|---|
| `gone` (+`status`) | `/auth/apple` with `join_token`: `status` is `expired` or `revoked` (and `used` for a 1.0 invite). **1.0 only:** `/invites/accept`, and an expired move request | "This link expired." or "This link was turned off." Ask the family for a new link |
| `live_off` (410) | `GET /v1/live/:topic`: the topic is turned off on the server | Stop polling it; read on focus (ACCOUNTS.md, open item 7) |
| `too_large` (413) | Any body over its limit (1 MB; 64 KB on `/dish/*` and `/web-events`; 1,000 bytes on `/invite/open`). A file over its size when asking for an upload link (`/v1/uploads`, `/v1/video-uploads`, `/dish/files`, Cravings) | "That file is too big." Before sending, check the size |
| `bad_type` (415) | A file whose content type isn't allowed, when asking for its upload link: `/v1/uploads`, `/dish/files`, `/dish/ask/answer/upload`, Cravings' `/v1/cravings/:id/voice-recipe/upload`. Bytes that aren't the type their link was signed for, at the check after the PUT, which deletes the upload: `/v1/uploads/confirm`, `/dish/files/confirm`, `/dish/ask/answer`, `/v1/cravings/:id/voice-recipe`. Raw bytes sent to `/dish/*` | Pick another file. A body that isn't JSON is `invalid`, not this |
| `words` (422) | `/dish/cards*`, Cravings' message, Community dinners and share asks: blocked wording | "Some of those words can't be used here. Try other words." |
| `not_a_dish` (422) | `POST /dish/cards`: what was typed isn't a dish | "Tell us a dish." |
| `update_app` (426) | **1.0 only:** `/invites/accept` given a 1.1 family link | "Update homecookd to join this family." |

## 429

| Code | Where | The app does |
|---|---|---|
| `rate_limited` | Any limit: per address, per person, per family, per link. Header `retry-after` | Wait `retry-after` seconds, then retry. The refused call isn't counted |
| `budget` | `POST /dish/cards` only: today's model budget is spent. `retry-after` runs to the next UTC midnight. Mom's side never gets it: her clips are saved, and her hearing, translation and merge wait for the next day once they're $1 past it (DISH.md) | "homecookd has made all the recipes it can today. Try again tomorrow." |
| `link_full` | `POST /dish/cards` with a `cravingToken`: her craving link made 20 cards in all, or 5 in the last 24 hours (both `TODO(caleb)`). `retry-after` is when the day's cap frees a card, or a day for a link that's used up. `message` keeps Convex's sentence, "This link has had a lot of requests. Ask for a new one." | Never from the app. On the web: make the kid's card a plain one, keeping what they typed (her next link from the app is a new one). The site's `isLinkBusy` matches the sentence today; it should read this code |

## 5xx

| Code | Where | The app does |
|---|---|---|
| `server_error` (500) | Anything unexpected; also "Couldn't create your family.", "Couldn't make a link.", "Couldn't make an invite." | Reads: retry. Writes: retry only with the same `Idempotency-Key`; without one, "Didn't send, try again". An Accounts write is one transaction, so it happened fully or not at all |
| `not_moved` (501) | **Staging only:** a route whose area's switch isn't on there (recipe writes, among them a cook's own tap on `POST /v1/share-requests`; `/v1/test/recipe`) | Never in production 1.1. On staging, say it isn't built yet |
| `provider_down` (502, 503) | 502: S3 or a model failed (uploads, the photo note, `/dish/*`, Cravings, video uploads). 503: Apple's or Google's keys couldn't be fetched, or the recipe library couldn't be reached (`/v1/recap`) | Nothing was written. "That didn't work. Try again in a moment." |
| `unavailable` (503) | Any route: overload, a row lock that waited too long, or a full pool. Header `retry-after` (5 to 15 s). `/ready` too | Nothing was written. Keep what's on screen and retry after `retry-after` |
| `not_set_up` (503) | A server setting isn't there: Google sign-in until `GOOGLE_CLIENT_IDS` is set, an app id not in `APPLE_AUDIENCES`, a `link_ticket` with no `LINK_JOIN_SECRET`, the photo note's or `/dish/*`'s model key | Retrying won't help. Hide the feature (the Google button) or say it isn't ready |
| `accounts_not_moved` (503) | **Staging only**, while `ACCOUNTS_OWNS_PEOPLE` is off: every write to people and families | Retrying won't help. It's on for staging now, so it shouldn't appear |

## Not on any route

| Code | Where |
|---|---|
| `recipes_read_only` (409) | The team's report script (`api/src/reports.ts`), when the recipes switch isn't open, so a recipe's review can't write it. No phone sees it |

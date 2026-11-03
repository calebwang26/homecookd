# Community: the api contract for the app (1.1)

Nov 2, 2026. Read from `aws-migration` at `2f71c8f24` (#323, the report alarm, included), and checked against staging with GET calls that change nothing, plus one test report that set off the alarm. For the App screens & recording chat, with a section for App Store, web & builds (the `/d` page). This covers the neighborhood feed and map, a shared recipe's page, swaps and "cook together", dinners (hosting, asking to join, the host's answer, the invite link and its public page), "Report or block" and the team's side of it. It's the fifth contract: [ACCOUNTS.md, "Conventions"](ACCOUNTS.md#conventions-all-areas) applies (the address, the session on every route here but `POST /invite/open`, JSON bodies, `Idempotency-Key`, paging, no stubs, polling), and every code is in [ERROR-CODES.md](ERROR-CODES.md). Share asks and story cards are in [MESSAGES.md](MESSAGES.md), flow 8; the cook's craving routes (`/v1/cravings*`) are in [DISH.md](DISH.md). Every person id is the `personId` a session returns, and a recipe id is a family recipe's `_id` from `GET /v1/recipes` (JOBS.md). Field names are Convex's, in camelCase, and times are epoch milliseconds.

**Where it stands.** Every Community call in the app's wrappers has a route, except two: turning a shared recipe off (`community.setShare` with `on: false`) and setting a person's place (`community.setLocation`) (open items 1 and 2). No live topic and no push. The Community tab is off in the app since Oct 25 (`app/src/app/kid/_layout.tsx`, `href: null`); its screens stay in the code, and the cook's "Share with people nearby" switch on her recipe page (`my-recipe/[id].tsx`, `ShareNearbyRow`) still shows (open item 12).

**Privacy.** What leaves a family, and how the code holds to it:

| What | The rule in the code | Code |
|---|---|---|
| Recipes | Only a `ready` recipe with `shared_at` set reaches another family. Anything else reads as missing | `service.ts` `feed`, `recipe`; `safety.ts` `seesRecipe` |
| A recipe that isn't ready | No recipe at all in Community, to anyone. Its own cook gets 409 `own_family` from report and block; anyone else gets the 404 a missing id gets. Hosting, swaps, the recipe page and share asks need it ready, from its cook too | `recipes/read.ts` `shownTo`; `service.ts` `ownerOf`; `dinners.ts` `hostable` |
| What neighbors read | A whitelist: the title, each step's `order`, `title` and `text`, the story card, the cook's name, the family's label, a distance label and the grid cell. Never video, moments, memories, `libraryId`, person or family ids, or an address | `service.ts`; `community.test.ts` (`FORBIDDEN`) |
| The family's name | `families.public_name` ("The Rao family"), else the cook's first name ("Asha's family"). Never `families.name`. Nothing on the api sets `public_name` (Convex's only setter was the team's `seedCommunity:publicName`), so in 1.1 every family reads "<first name>'s family" | `storyCard.ts` `familyLabel`, `plainStory` |
| The cover | A stock photo only (`https://homecookd.app/media/<cover_stock_path>`), never a video frame. The AWS worker writes `cover_stock_path = null`, so a 1.1 recipe's `coverUrl` is null | `storyCard.ts` `coverUrl`; `pipeline/queue_db.py` |
| Places | Rounded to 2 decimals (about 1 km) and stored as `numeric(5,2)`. People see only `distanceLabel` and the grid cell. Nothing sets a place yet, so everyone sits at the demo venue (open item 2) | `geo.ts`; `006_community.sql` |
| The story card | One she said no to the stories for reads as the plain line, with no culture | `storyCard.ts` `publicCard` |
| A dinner's address | Only the host (the person, not the host's family) and guests the host accepted | `dinners.ts` `viewDinners` |
| Who asked to join | Only the host, and never a guest from a family either side blocked | `dinners.ts` `viewDinners` |
| The public invite page | Only the dish, the host's whole name and when. Never the place, the address or an id | `dinners.ts` `openInvite` |
| Hidden, blocked, reported, filtered, another family's | The same 404 bytes as a missing row on every route, `requestId` aside | `errors.ts` `notFound`; `communityRoutes.test.ts` (29 cases) |
| Logs and alerts | No dish, name, address or token in a log line. A report's alert line carries its kind, the item's id and counts; the email the team gets carries the alarm's name only | `communityRoutes.test.ts` ("logs carry no family content"); `tasks.ts`; `communitySafety.test.ts` |

## What another family sees

| The item is | In their feed | Its page | Their writes on it |
|---|---|---|---|
| Not shared, or not ready | No | 404 | 404 |
| Reported by their family (anyone in it) | No, for the whole family, at once and for good: a team `keep` doesn't bring it back for them | 404 | Report again: 200, nothing new. Anything else: 404 |
| Reported by 2 or more families, still open | No, for every family but its own, until the team reviews it | 404 | 404 |
| A recipe the team took down (`remove`) | No, for every family, its own too (it's unshared) | 404 | 404. Its own family sharing it again: 409 `taken_down` |
| Its family and theirs blocked, either way | No | 404 | 404 |
| Caught by the word filter (an older row) | No | 404 | |
| A dinner whose dish is hidden from them, reported, or from a blocked family | No | 404 | 404 |
| A dinner the team took down | No | 404 (`cancelled`, `hidden_at` set) | 404 |
| A dinner that's cancelled, not hidden | No | 200, `status: "cancelled"` | join, invite link, report: 404 |
| A dinner that has started | No | 200 | join: 404 |
| A dinner whose dish was unshared later | Yes, while open | 200, with `recipeId: null` and `coverUrl: null` | As any dinner |

Reports and blocks never hide a family's own recipes and dinners from it. They read `ours: true`.

## Ids

| Name | Looks like | Notes |
|---|---|---|
| `recipeId` | uuid text | A family recipe's `_id` |
| `dinnerId`, `requestId`, `swapId`, `blockId` | uuid text | `requestId` is one ask to join a dinner |
| Invite token | 43 characters, base64url | `/d?t=<token>`. Stored only as its sha256 and sealed with `EDIBLE_CODE_KEY`; the same link comes back each time |
| `deviceId` | 16 to 64 of `A-Z a-z 0-9 _ -` | Made up by the phone or browser that opens an invite, and kept. The app's is `invite.deviceId` in `kv` |

A route's `:id` is 1 to 100 characters; longer is 400 `invalid`, `field: "id"`.

## Flows

### 1. The feed and the map

1. `GET /v1/community/feed?maxMiles=` answers `{here, recipes, dinners, nextCursor, dinnersCursor}`. `here` is the viewer's grid cell, the map's middle. Leave out `maxMiles` for no limit.
2. `recipes`: 50 a page, nearest first, then newest shared. They come from a window of the 200 newest shared recipes, so a page can be short with a `nextCursor`. Follow `?cursor=<nextCursor>`. A row can repeat across pages when something is shared meanwhile: dedupe by `recipeId` (COMMUNITY-MIGRATION.md, Known limits). The family's own shared recipes are in it, with `ours: true`.
3. `dinners`: the first 20 open dinners ahead from other families, soonest first, from a window of the 100 soonest. Every feed page repeats this same first page. More: `GET /v1/community/dinners?cursor=<dinnersCursor>`, then its own `nextCursor`. Full dinners, ones that have started, and the family's own are left out.
4. A recipe row's `dinner` is the soonest of those dinners for that dish with a seat left, with its own distance (it's where its host is), or null.
5. Tap a recipe: `GET /v1/community/recipes/:id`. Tap a dinner: flow 3.

### 2. Swaps and "Cook together"

1. Ask another family for their shared recipe: `POST /v1/community/swaps {recipeId, myRecipeId?}`, offering one of your family's shared recipes or none. "Cook together": `POST /v1/community/cook-together {recipeId}`. Either answers `{swapId}`.
2. One ask per family, dish and kind. Asking again, by anyone in the family, answers the same `swapId` while it's pending or accepted. After a no it's 409 `declined`, for good.
3. Anyone in the family that was asked answers: `POST /v1/community/swaps/:id/respond {accept}`. Once.
4. Both families read it in `GET /v1/community/swaps`, newest first. Nothing in a swap shows new recipe text: both dishes are shared already.
5. After a yes to "cook together", the family that asked may host a dinner of that dish (flow 3). A swap's yes changes nothing on the server.

### 3. A dinner

1. **Host.** Anyone in the family (any role) may host one of the family's ready, shared recipes, or another family's shared dish after their yes to "cook together". `POST /v1/dinners {recipeId, startsAt, placeKind?, placeName, address, seats}` with an `Idempotency-Key` answers 201 `{dinnerId}`. The dish name is the recipe's title at that moment.
2. **Where it is.** The dinner sits on the host's own grid cell at the time it's made (the demo venue when they have none), never at the address: nothing reads the address but people. `placeName` is public. `address` is private.
3. **Ask to join.** Anyone signed in from another family: `POST /v1/dinners/:id/join` answers `{requestId}`, pending. One ask per person per dinner, ever: after the host's no, asking again is 409 `already_asked`.
4. **The host answers.** Only the host, not their family: `POST /v1/dinner-requests/:id/respond {accept}`, once per ask. A yes gives that guest the address. The yes that takes the last seat sets `status: "full"`, under the dinner's row lock, so two yeses can't both take it (409 `full` for the second).
5. **Seats.** `seatsLeft` is `seats` minus accepted guests. Nothing frees a seat: there's no route to take back a yes or to leave a dinner.
6. **Invite friends.** The host, or a guest they accepted: `POST /v1/dinners/:id/invite-link` answers `{token, url}`, the same link every time. Share `url`.
7. **The link opens** on the website's `/d?t=` or in the app (`homecookd://d?t=`): `POST /invite/open {token, deviceId}`, public. It answers `{dish, hostName, startsAt}` and counts that phone or browser once in the dinner's `inviteOpens` ("X going"): while the dinner is ahead, at most 300 in all, and at most 60 new ones per 10 minutes. Past that, or once it has started, the page still opens, uncounted.
8. **Reading.** `GET /v1/dinners/:id` for one (the host also sees `requests`); `GET /v1/dinners/mine` for the dinners this person hosts, then the ones they asked to join. A dinner someone else in the family hosts is in neither their feed nor their `mine`; it opens by id with `ours: true`.
9. **Called off.** No route calls a dinner off, on the api or on Convex. `status: "cancelled"` comes only from the team taking it down, or from its host, or the cook of its dish, deleting their account. The app shows "This dinner was called off." (`components/community/labels.ts`).

**Time and place rules.**

| Rule | Code |
|---|---|
| `startsAt` must be after the server's clock when it's made ("Pick a time that hasn't passed."). No later limit but JavaScript's last date (8.64e15) | `dinners.ts` `createDinner`; `routes.ts` |
| It leaves the feed the moment it starts (`starts_at > now()` in SQL), and asking to join is refused from then | `data.ts` `openDinnersAhead`; `dinners.ts` `requestJoin` |
| `placeKind`: `campus_kitchen` (the default), `community_center`, `cafe` or `home` | `data.ts` `PLACE_KINDS` |
| `placeName` and `address`: trimmed, 1 to 200 characters | `dinners.ts` `text` |
| The word filter reads the dish's title, `placeName` and `address`: 422 `words` | `dinners.ts`; `dish/moderation.ts` |
| `seats`: a whole number from 1 to 20 | `dinners.ts` |
| The distance label is from the viewer's grid cell to the dinner's | `dinners.ts` `viewDinners`; `geo.ts` `distanceLabel` |

### 4. Report or block (App Review 1.2)

**What the app offers today** (`components/community/ReportSheet.tsx`, `report.ts`): a quiet "Report or block" link at the foot of every other family's recipe page and dinner page, only where `ours` is false. It opens one sheet with three reasons ("Not about food" `not_food`, "Rude or hurtful" `rude`, "Something else" `other`), a Report button, "Block <family>" with "You won't see each other in Community.", and the team's email. A report shows "Thanks. We'll look at it within a day."; a block, "Blocked". Then the page goes back. The families yours blocked are listed under "You" with Unblock (`YouCard.tsx`). In 1.1 all of it stays; only the calls under it change.

**On the server, a report** (`service.ts` `report`, `safety.ts` `fileReport`):
1. One row per family and item. A second report by anyone in that family changes nothing and answers 200.
2. It hides the item from the reporter's whole family at once, for good, dinners around a reported recipe included.
3. Open reports from 2 families hide it from every other family too, until the team reviews it. A dinner's hide is stored (`hidden_at`); a recipe's is worked out from `reports` when it's read.
4. In the same transaction it queues `community.report_alert`. That task logs `ALERT community report needs review` with `{kind, targetId, families, open}` at error level, and the `<env>-community-report` alarm emails the team's alerts address within about 5 minutes (`tasks.ts`; `infra/modules/env/alerts.tf`, #323). No family content. The old webhook (`REPORT_ALERT_URL`) stays unset on AWS.
5. `community.remind_open`, from a daily schedule at 16:00 UTC, logs `ALERT community reports still open` with `{open}` when reports have been open past 12 hours, and the `<env>-community-reports-open` alarm emails the same address. Staging has the schedule; production's is in the production-config PR, not merged yet.

**A block** (`service.ts` `block`): one row from the blocking family to the other, and a `family` report for the team (the same alert). Both ways from then on: neither family sees the other's recipes, dinners, swaps or join asks. Open swaps between them leave both lists and can't be answered; a guest's ask leaves the host's list and can't be answered; an accepted guest's dinner page and invite link answer 404. New asks either way are refused as if nothing were there. The blocked family isn't told and doesn't see it in their own list. Only the family that blocked can unblock, and then everything comes back, pending asks still pending, except what that family reported. Blocking again answers 200.

**What the reporter sees after:** `{ok: true}`. The item is gone from their family's feed, and its page answers 404, which the app reads as "not there anymore" behind its thank-you. Nobody hears how the team decided. A report can't be taken back.

**When the team hears:** the alarm email within about 5 minutes of a report or block, and once a day while any has been open past 12 hours. That's what keeps the sheet's "We'll look at it within a day" true on AWS. Proven on staging Nov 2: a test report at 05:43:00 UTC set the alarm off at 05:44:22, and it published to the alerts topic's confirmed email. A report taken by an old task during the few minutes a deploy overlaps runs that task's older code.

**The team** (COMMUNITY-MIGRATION.md, "The team's reports"): `node dist/reports.js open` lists open items by id, oldest first, with how many families reported each and why. `node dist/reports.js review <recipe|dinner|family> <id> keep|remove`, run as a one-off ECS task, resolves every open report on it. `keep`: it shows again for everyone but the families that reported it (a recipe the team took down stays unshared until its cook shares it again). `remove` on a dinner calls it off and keeps it hidden. `remove` on a recipe unshares it and sets `hiddenAt`, so it leaves every other family's map. Its family sees `hiddenAt` on the recipe and `takenDown: true` in the share chooser, and sharing it again is 409 `taken_down`. With the recipes switch closed, a recipe's review is refused, `recipes_read_only`, and nothing changes. A block's report is only resolved.

## Routes

Code: `api/src/modules/community/` (`routes.ts`, `inviteRoutes.ts`, `service.ts`, `dinners.ts`, `safety.ts`, `shareAsks.ts`, `data.ts`), mounted in `api/src/app.ts` (`communityRoutes`; `inviteRoutes` under `/invite`).

`Authorization: Bearer <sessionToken>` on every route but `POST /invite/open`, checked before the body. **Any role** may call each one; where only some people may, the "Who" column says so. Swaps, reports and blocks act for the whole family.

**Shared codes.** Every `/v1` route here can also answer: `signed_out` (401), `removed_from_family` (403: they left; only account deletion still works), `invalid` (400 from the schema: a missing field, a wrong type, a value off its list, an `id` over 100, a `cursor` that isn't one of ours or is over 500 characters, a NUL byte; 415 for a content type that isn't JSON), `too_large` (413: over 1 MB, or 16 KB on `POST /v1/dinners`), `unavailable` (503 with `retry-after`: nothing was written), `server_error` (500). The tables list each route's own. A `/v1` route here has no rate limit of its own.

**Bodies.** `POST /v1/dinners/:id/join`, `/invite-link` and `DELETE /v1/community/blocks/:id` take no body: send `{}` as ACCOUNTS.md says, or no body and no `content-type` (an empty body with `content-type: application/json` is 400 `invalid`).

**Retries and `Idempotency-Key`.**

| Write | Key | Safe to send again? |
|---|---|---|
| `POST /v1/dinners` | Accepted, not required: 8 to 100 of `A-Z a-z 0-9 _ -` (open item 11). Always send one | With a key, yes: the same key and body answer 201 with the first `dinnerId` for 7 days, even if the dish has been unshared or the time has passed since. Another body is 409 `idempotency_conflict`. Without a key a retry makes a second dinner |
| `POST /v1/community/swaps`, `/cook-together` | Not read | Yes: the family's ask comes back |
| `POST /v1/community/swaps/:id/respond`, `POST /v1/dinner-requests/:id/respond` | Not read | A retry after it worked is 409 `answered`: it worked |
| `POST /v1/dinners/:id/join` | Not read | A retry after it worked is 409 `already_asked`: it worked |
| `POST /v1/community/reports`, `/blocks` | Not read | Yes: 200, nothing new |
| `DELETE /v1/community/blocks/:id` | Not read | A retry after it worked is 404 |
| `POST /v1/dinners/:id/invite-link`, `POST /invite/open` | Not read | Yes: the same link; a phone counts once |

### The feed and a shared recipe

| Route | Who | Query | Answer |
|---|---|---|---|
| `GET /v1/community/feed` | Anyone | `?maxMiles=` (a number, 0 or more), `?cursor=` | `{here: {lat, lng}, recipes: [FeedRecipe], dinners: [FeedDinner], nextCursor, dinnersCursor}` |
| `GET /v1/community/dinners` | Anyone | `?maxMiles=`, `?cursor=<dinnersCursor>` | `{dinners: [FeedDinner], nextCursor}`, 20 a page |
| `GET /v1/community/recipes/:id` | Anyone; another family's only when shared | | CommunityRecipe |

```json
{ "here": { "lat": 42.36, "lng": -71.09 },
  "recipes": [ { "recipeId": "0b6f2c1e-…", "dish": "Kanda Poha", "familyName": "The Rao family", "cookName": "Asha",
                 "distanceLabel": "Under a mile", "approx": { "lat": 42.37, "lng": -71.09 }, "ours": false,
                 "story": "Asha's poha, the Sunday breakfast she grew up on.", "culture": "Maharashtrian", "quote": "Not too long, or it goes soft.",
                 "quoteTranslated": true, "coverUrl": null, "stepCount": 6,
                 "dinner": { "dinnerId": "7d1e…", "startsAt": 1794700800000, "seatsLeft": 3, "hostName": "Leo", "distanceLabel": "Under a mile" } } ],
  "dinners": [ { "dinnerId": "7d1e…", "dish": "Kanda Poha", "hostName": "Leo", "placeName": "Elm Hall kitchen",
                 "startsAt": 1794700800000, "seatsLeft": 3, "distanceLabel": "Under a mile" } ],
  "nextCursor": null, "dinnersCursor": null }
```

| FeedRecipe field | Meaning |
|---|---|
| `familyName`, `cookName` | The family's label (Privacy, above) and the cook's whole name |
| `distanceLabel` | "In your building" (under 0.05 mi), "Under a mile", or "About N mi" |
| `approx` | The cook's grid cell. Draw the map from this and `here` only |
| `ours` | The viewer's own family's dish. It never carries a Report link |
| `story`, `culture`, `quote` | The story card: AI, so label it. Null until the card is written. `quote` is one of her own step quotes, or null |
| `quoteTranslated` | She said the quote in another language: tag it "Translated" |
| `coverUrl` | A stock photo, or null (Privacy, above) |
| `dinner` | Flow 1, step 4 |

**CommunityRecipe:** `{recipeId, dish, familyName, cookName, ours, story, steps: [{order, title, text}]}`. The viewer's own family's ready recipes open here too, shared or not.

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | The two lists | `field: "maxMiles"` (below 0), `"cursor"` | A bug |
| `not_found` (404) | Recipe | No `message`: missing, not ready, not shared, hidden, blocked, reported, or caught by the filter | Show that it's gone |

### Swaps and "Cook together"

| Route | Who | Body or query | Answer |
|---|---|---|---|
| `GET /v1/community/swaps` | Anyone | `?cursor=` | `{swaps: [Swap], nextCursor}`, newest first, 50 a page, both ways, none with a blocked family |
| `POST /v1/community/swaps` | Anyone | `{recipeId, myRecipeId?}`: another family's shared dish, and one of yours to offer | `{swapId}` |
| `POST /v1/community/cook-together` | Anyone | `{recipeId}` | `{swapId}` |
| `POST /v1/community/swaps/:id/respond` | Anyone in the family that was asked | `{accept: boolean}` | `{ok: true}` |

**Swap:** `{swapId, kind: "swap" | "cook", status: "pending" | "accepted" | "declined", incoming, ourDish: {recipeId, dish} | null, theirDish: {recipeId, dish} | null, familyName}`. `incoming`: the other family asked us. Your own family's dish always shows; the other family's only while it's still shared and visible to you, else null. `familyName` is the other family's label.

```json
{ "swapId": "e3a9…", "kind": "swap", "status": "pending", "incoming": true,
  "ourDish": { "recipeId": "0b6f2c1e-…", "dish": "Kanda Poha" }, "theirDish": { "recipeId": "41c0…", "dish": "Dumplings" },
  "familyName": "Nadia's family" }
```

| Code | Route | When | The app does |
|---|---|---|---|
| `not_found` (404) | Ask, cook together | "That recipe isn't shared anymore.": missing, not ready, not shared, hidden, blocked or reported | Drop it |
| `own_family` (409) | Ask, cook together | "This is your family's recipe." | Don't offer it on `ours` |
| `not_shared` (409) | Ask | "Share that recipe first.": `myRecipeId` isn't one of your family's ready, shared recipes | Offer only shared ones |
| `declined` (409) | Ask, cook together | "They said not this time.": the family already said no to this ask | Say so; no asking again |
| `not_found` (404) | Respond | "Only the family that was asked can answer.": missing, not asked of your family, or a block either way | Drop it |
| `answered` (409) | Respond | "You already answered." | Reload |

### Dinners

| Route | Who | Body or query | Answer |
|---|---|---|---|
| `POST /v1/dinners` | Anyone, for a dish the family may host (flow 3) | `{recipeId, startsAt, placeKind?, placeName, address, seats}`; header `Idempotency-Key` | 201 `{dinnerId}` |
| `GET /v1/dinners/mine` | Anyone | `?cursor=` | `{dinners: [Dinner], nextCursor}`: up to 50 they host, soonest first, then up to 50 of their newest asks' dinners, soonest first. Past and cancelled ones stay |
| `GET /v1/dinners/:id` | Anyone who can see it (What another family sees) | | Dinner |
| `POST /v1/dinners/:id/join` | Anyone outside the host's family | none | `{requestId}` |
| `POST /v1/dinner-requests/:id/respond` | The host | `{accept: boolean}` | `{ok: true}` |
| `POST /v1/dinners/:id/invite-link` | The host, or a guest they accepted | none | `{token, url}`: `url` is `<EDIBLE_WEB_URL, else https://homecookd.app>/d?t=<token>` |

**Dinner:**

```json
{ "dinnerId": "7d1e…", "dish": "Kanda Poha", "recipeId": "0b6f2c1e-…", "coverUrl": null,
  "hostName": "Leo", "familyName": "The Rao family", "ours": false,
  "placeKind": "campus_kitchen", "placeName": "Elm Hall kitchen", "startsAt": 1794700800000,
  "seats": 4, "seatsLeft": 3, "inviteOpens": 5, "status": "open", "distanceLabel": "Under a mile",
  "isHost": false, "myRequest": { "requestId": "a20c…", "status": "accepted" }, "address": "12 Elm St, Apt 3",
  "requests": null }
```

| Field | Meaning |
|---|---|
| `recipeId`, `coverUrl` | Set only while the viewer may open the dish (shared and visible, or their own family's); else null. Open it with `GET /v1/community/recipes/:id` |
| `ours` | The host's family is the viewer's. No Report link |
| `status` | `open`, `full` or `cancelled` |
| `inviteOpens` | Phones and browsers that opened the invite link, once each |
| `isHost` | The viewer is the host (the person) |
| `myRequest` | The viewer's own ask: `pending`, `accepted` or `declined`, or null |
| `address` | Only for the host and accepted guests; else null |
| `requests` | The host only: `[{requestId, guestName, status}]`, oldest first, at most 200, none from a blocked family. Null for everyone else |

| Code | Route | When | The app does |
|---|---|---|---|
| `not_found` (404) | Host | "Pick one of your family's recipes.": missing; your family's but not ready; another family's that you can't see, isn't shared, or has no yes to "cook together" | Offer only dishes you may host |
| `not_shared` (409) | Host | "Share this recipe first.": your family's ready recipe isn't on the map | Offer sharing first |
| `invalid` (400) | Host | `field: "startsAt"` ("Pick a time that hasn't passed."), `"seats"` ("Seats go from 1 to 20."), `"placeName"` ("Add the place's name."), `"address"` ("Add the address."; also over 200), `"placeKind"`, `"Idempotency-Key"` (no `message`) | Check before sending |
| `words` (422) | Host | "Some of those words can't go in Community. Try other words." | Say so |
| `idempotency_conflict` (409) | Host | "That was already sent with different details.": a reused key | A bug: a new dinner needs a new key |
| `not_found` (404) | Read | No `message` | Drop it |
| `not_found` (404) | Join | "That dinner isn't happening anymore.": missing, hidden from you, cancelled, or started | Show it's over |
| `own_family` (409) | Join | "This is your family's dinner." | Don't offer it on `ours` |
| `already_asked` (409) | Join | "You already asked to join.", after a no too | Reload |
| `full` (409) | Join | "That dinner is full." | Say so |
| `not_found` (404) | Respond | "Only the host can answer.": missing, not the host, or the guest's family and yours blocked | Drop it |
| `answered` (409) | Respond | "You already answered." | Reload |
| `full` (409) | Respond, a yes | "Every seat is taken." | Reload |
| `not_found` (404) | Invite link | "That dinner isn't happening anymore.": missing, hidden from you, or cancelled | Show it's over |
| `not_a_guest` (403) | Invite link | "Only the host and their guests can invite friends.": the host's family included | Show the button only to `isHost` or an accepted `myRequest` |
| `server_error` (500) | Invite link | `EDIBLE_CODE_KEY` isn't set on the server | Retry later |

### Report and block

| Route | Who | Body or query | Answer |
|---|---|---|---|
| `POST /v1/community/reports` | Anyone, for the family | `{kind: "recipe" \| "dinner", targetId, reason?: "not_food" \| "rude" \| "other"}` | `{ok: true}` |
| `POST /v1/community/blocks` | Anyone, for the family | `{kind: "recipe" \| "dinner", targetId}`: blocks the family behind it | `{ok: true}` |
| `GET /v1/community/blocks` | Anyone | `?cursor=` | `{blocked: [{blockId, familyName}], nextCursor}`, 100 a page: only the ones your family made. `familyName` is how the cards named them when you blocked ("A family" once anyone in that family deleted their account) |
| `DELETE /v1/community/blocks/:id` | Anyone in the family that blocked | none | `{ok: true}` |

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | Report, block | `field: "kind"` (`"family"` too: only a block files those), `"reason"`, `"targetId"` | A bug |
| `not_found` (404) | Report, block | "That recipe isn't shared anymore." or "That dinner isn't happening anymore.": you can't see it now (missing, not ready, not shared, cancelled, hidden, blocked either way), unless you already reported it, or, for a block, already blocked that family | It's gone already: close the sheet |
| `own_family` (409) | Report, block | "This is your family's recipe." or "This is your family's dinner." (a recipe that isn't ready, to its own cook) | Don't offer it on `ours` |
| `not_found` (404) | Unblock | No `message`: missing, or another family's block. Also a retry after it worked | Reload the list |

### Public: `POST /invite/open`

Code: `inviteRoutes.ts`, `dinners.ts` `openInvite`. No session: the token is the capability. The path has no `/v1`, so the site and old apps need only a new host.

- **Body:** `{token, deviceId}`: `token` 20 to 64 of `A-Z a-z 0-9 _ -`, `deviceId` 16 to 64. Read as JSON whatever its `content-type`. At most 1,000 bytes.
- **Answer:** `{dish, hostName, startsAt}`. `Cache-Control: no-store`.
- **CORS:** `https://homecookd.app`, `https://www.homecookd.app`, `http://localhost`, `127.0.0.1` or `[::1]` on any port, and `SITE_ORIGINS`. Any other `Origin` is 403, its preflight too. The app sends no `Origin`.

| Code | When | The page does |
|---|---|---|
| `invalid` (400) | `field: "token"` or `"deviceId"`, "token and deviceId are required"; no `field`, "The body must be JSON." | "This link doesn't work" |
| `not_found` (404) | "No such dinner.": unknown, cancelled, hidden, or its dish hidden by reports | "This link doesn't work" |
| `origin` (403) | "This site can't use these routes." | A bug |
| `too_large` (413) | "That's too much to send at once." | A bug |
| `rate_limited` (429) | No `message`, with `retry-after`: 120 opens per 10 minutes per address, or 20 tokens that name no dinner per 10 minutes per address. A real link to a dinner that's off doesn't count as a guess | Wait `retry-after` |

Also `unavailable`, `server_error` (every open is 500 without `RATE_LIMIT_SALT`) and `no_route`.

### Share asks

`POST /v1/share-requests {recipeId}` → `{result: "asked" | "shared"}` and `GET /v1/share-requests/dishes` are Community's routes (`shareAsks.ts`), but their contract is [MESSAGES.md, flow 8 and "Share asks"](MESSAGES.md#8-a-share-ask-and-its-story-card), because the ask is the cook's question. What it means here: `shared` sets `shared_at`, and from then the recipe is in other families' feeds, with its story card once the task has written it (the plain line until then, or on any failure). Her own tap on her own ready recipe is the only "on" switch. There's no "off" (open item 1).

## Live topics

None. `/v1/live/` serves `jobs` only (`api/src/modules/live/routes.ts`, `topics`). Checked on staging Nov 2: `/v1/live/dinners:get` and `/v1/live/community:feed` answer 404 `no_route` (open item 9). Read the plain routes instead, at LIVE-UPDATES.md's pace:

| Convex subscription | Plan | Until it's built, read |
|---|---|---|
| `dinners:get` | 30 s on the dinner screen | `GET /v1/dinners/:id` on focus, and every 30 s while it's open |
| `community:feed`, `dinners:mine`, `community:mySwaps`, `shareRequests:familyDishes` | Focus, 60 s | The route, every page, on focus and every 60 s |
| `community:recipe`, `community:blocked` | Focus only | The route on focus |

After a report or block lands, read the feed again: the item is gone.

## Push notifications

None. A join ask, a host's yes or no, a swap or "cook together" ask or answer, a report and a block send no push, as on Convex (COMMUNITY-MIGRATION.md, Deferred; open item 10). A share ask sends none either (MESSAGES.md, flow 8). The team's report alerts are alarm emails, not pushes to a phone.

## Behind switches and settings

Community has no switch of its own and doesn't read `ACCOUNTS_OWNS_PEOPLE`. What it does read:

| Setting | Read by | Without it | Staging (`main.tf`) | Production (`main.tf`) |
|---|---|---|---|---|
| `RECIPE_WRITES=on` | `recipes/switch.ts`, through `shareAsks.ts` and `messages/storyCards.ts` | Her own tap on `POST /v1/share-requests` is 501 `not_moved` ("This can't be done here yet."), and her yes to an ask is kept on the question without sharing (COMMUNITY-MIGRATION.md, blocker 4). Nothing else here writes recipes | On | On in the production-config PR (open item 8) |
| `EDIBLE_CODE_KEY` | `sealed.ts`, from `inviteLink` | `POST /v1/dinners/:id/invite-link` is 500. Links already made still open | Named | Named in the production-config PR |
| `RATE_LIMIT_SALT` | `rateLimit.ts`, from `/invite/open` | Every `POST /invite/open` is 500 | Named | Named in the production-config PR |
| `EDIBLE_WEB_URL` | `dinners.ts` `inviteOrigin` | Invite links point at `https://homecookd.app` | Staging's site | `https://homecookd.app` in the production-config PR |
| `SITE_ORIGINS` | `cors.ts`, `inviteRoutes.ts` | Only homecookd.app, www and localhost pages may call `/invite/open` | Staging's site | homecookd.app, www |
| `REPORT_ALERT_URL` (with `REPORT_ALERT_TOKEN`, `REPORT_ALERT_EMAIL`) | `alerts.ts` `sendAlert` | No webhook. The task still logs its alert line, and the alarm emails (#323) | None named: unset on AWS by design | None named in the production-config PR |
| The `community.remind_open` schedule | `scheduled.ts` | No daily reminder | 16:00 UTC daily | 16:00 UTC daily, in the production-config PR |
| `APP_WEB_ORIGINS` | `cors.ts` | The app's web build can't call `/v1` from a browser | `localhost:8081` to `8083` | None |

## What the app calls today, and what replaces it

From `app/src/lib/live/community.ts` and `live/invite.ts` on `aws-migration`, and the screens that call them. Each Convex call had a stub for when Convex was off: 1.1 has none (no stubs).

| Today | App wrapper | 1.1 |
|---|---|---|
| Convex `community:feed {now, maxMiles?}`, live | `useCommunityFeed` | `GET /v1/community/feed?maxMiles=`: adds `nextCursor` and `dinnersCursor`; `now` is gone (the server's clock decides). Not live |
| Convex `community:recipe`, live | `useCommunityRecipe` | `GET /v1/community/recipes/:id`. 404 where Convex gave null |
| Convex `community:setShare {on: true}` | `setShare`, from `ShareNearbyRow.tsx` | `POST /v1/share-requests {recipeId}` as her own tap: `{result: "shared"}` |
| Convex `community:setShare {on: false}` | the same | **Not built** (open item 1) |
| Convex `community:setLocation` | `setLocation` (defined, no screen calls it) | **Not built** (open item 2) |
| Convex `shareRequests:familyDishes`, `shareRequests:ask` | `useFamilyDishes`, `askToShare` | MESSAGES.md, "What the app calls today" |
| Convex `community:mySwaps`, live | `useMySwaps` | `GET /v1/community/swaps`: `.swaps`, every page |
| Convex `community:requestSwap`, `cookTogether` | `requestSwap`, `cookTogether` | `POST /v1/community/swaps`, `/cook-together`: `.swapId` |
| Convex `community:respondSwap` | `respondSwap` | `POST /v1/community/swaps/:id/respond {accept}`: `{ok: true}` where Convex gave null |
| Convex `dinners:create` | `createDinner`, from `dinner/new.tsx` | `POST /v1/dinners` with an `Idempotency-Key`: 201 `.dinnerId` |
| Convex `dinners:get`, live | `useDinner` | `GET /v1/dinners/:id`. 404 where Convex gave null |
| Convex `dinners:mine`, live | `useMyDinners` | `GET /v1/dinners/mine`: `.dinners`, every page |
| Convex `dinners:requestJoin` | `requestJoin` | `POST /v1/dinners/:id/join`: `.requestId` |
| Convex `dinners:respond` | `respond`, from `DinnerParts.tsx` | `POST /v1/dinner-requests/:id/respond {accept}` |
| Convex `dinners:inviteLink` (an action) | `inviteLink`, from `DinnerInviteBody.tsx` | `POST /v1/dinners/:id/invite-link`: `{token, url}`, the same shape |
| Convex `community:report`, `block` | `report`, `block`, from `ReportSheet.tsx` | `POST /v1/community/reports`, `/blocks`. Read the error's code, not Convex's sentence (`labels.ts` `errorText`) |
| Convex `community:blocked`, live; `unblock` | `useBlocked`, `unblock`, from `YouCard.tsx` | `GET /v1/community/blocks` (`.blocked`); `DELETE /v1/community/blocks/:id` |
| Convex HTTP `POST /invite/open` | `live/invite.ts:openInvite`, its host made from `EXPO_PUBLIC_CONVEX_URL` | `POST /invite/open` on `EXPO_PUBLIC_AWS_URL`: the same body and answer. The wrapper reads 400 and 404 as gone and anything else as offline, so a 429 shows as offline |

Convex's error sentences are now `message` beside a code. Its `null` answers are now 404 on reads and `{ok: true}` on writes.

## What the website uses (App Store, web & builds)

`/d?t=` (`web/src/lib/dinner-invite.ts`): `POST /invite/open {token, deviceId}` with `content-type: application/json`, from the browser, on `CONVEX_SITE_URL` today. `deviceId` is a uuid kept in `localStorage` (`homecookd.inviteDevice`). It reads 400 and 404 as "gone", anything else but 200 as "offline", and a 200 by its fields. The api answers the same shapes and statuses, plus 429, which the page shows as offline (COMMUNITY-MIGRATION.md, difference 11). To move it: point its host at the api; `SITE_ORIGINS` already lets homecookd.app in, and staging's site on staging. The app's `homecookd://d?t=` uses the same route. No other website page calls Community.

## Staging testing

`https://d2zh46br3dalyf.cloudfront.net`, signing in as in ACCOUNTS.md, "Staging testing". Checked Nov 2 with no session: `/health` answers `ok`; every Community GET (`/v1/community/feed`, `/dinners`, `/swaps`, `/blocks`, `/v1/dinners/mine`, `/v1/dinners/:id`, `/v1/share-requests/dishes`) answers 401 `signed_out`, so they're deployed. No POST was called.

**What's different there:** `RECIPE_WRITES=on`, so her own tap shares. No model key outside a `real_ai` window, so a story card is the plain line. Nobody has a place, so everyone, and every dinner, is "In your building". A report or block emails the alerts address within about 5 minutes (the `homecookd-staging-community-report` alarm), so close each test report afterwards (`node dist/reports.js review recipe <id> keep`, as a one-off task), or the daily reminder emails too. Invite links point at staging's site, whose `/d` still calls Convex until Web moves it. Behind CloudFront every tester shares one address, so `/invite/open`'s 120 opens and 20 unknown tokens per 10 minutes are shared.

**A dinner, end to end** (each line one call; `/v1/test/*` needs `x-test-signin-key`):
1. Two families: `POST /v1/test/sign-in {test_id: "cook-a", name: "Asha", role: "cook"}` and `{test_id: "cook-b", name: "Nadia", role: "cook"}`, each with no link, then `POST /v1/sessions/start` for each.
2. As cook-a: `POST /v1/test/recipe {}` → `{recipeId}` (JOBS.md), then `POST /v1/share-requests {recipeId}` → `{result: "shared"}`.
3. As cook-b: `GET /v1/community/feed` lists it.
4. As cook-a: `POST /v1/dinners {recipeId, startsAt: <an hour ahead>, placeName: "Test kitchen", address: "1 Test St", seats: 2}` with an `Idempotency-Key` → 201 `{dinnerId}`.
5. As cook-b: `POST /v1/dinners/<dinnerId>/join {}` → `{requestId}`. As cook-a: `GET /v1/dinners/<dinnerId>` shows it in `requests`; `POST /v1/dinner-requests/<requestId>/respond {accept: true}`. As cook-b: the dinner now has `address`.
6. As either: `POST /v1/dinners/<dinnerId>/invite-link {}` → `{token}`; `POST /invite/open {token, deviceId: "staging-test-device-01"}` → `{dish, hostName, startsAt}`, and `inviteOpens` goes up by one.
7. As cook-b: `POST /v1/community/reports {kind: "dinner", targetId: <dinnerId>, reason: "other"}`; the dinner is now 404 to cook-b. A third test family's report hides it from everyone but cook-a's family.
8. Block and unblock: `POST /v1/community/blocks {kind: "recipe", targetId: <recipeId>}`, `GET /v1/community/blocks`, `DELETE /v1/community/blocks/<blockId> {}`.

Each test person is one `test_id`, the same person every time. Use a new test recipe for a clean slate, since reports and blocks stay.

## Open items

Owners: **API** is the AWS backend chat, **App** is App screens & recording, **Web** is App Store, web & builds, **Caleb** is a decision only he makes.

1. No route turns sharing off. The cook's switch (`ShareNearbyRow.tsx`) calls Convex's `community:setShare` with `on: false`, which cleared `shared_at` and kept the card, for the recipe's cook only; on the api only "on" exists (her own tap on `POST /v1/share-requests`). `communityShareAsks.test.ts` checks there's no share route, and COMMUNITY-MIGRATION.md, blocker 1, held it back because the sync owned `recipes`. Since Nov 2 no sync runs (`recipes/switch.ts`), so it can be built behind the recipes switch, as her tap is. **API**
2. Nothing on the api sets a person's place: `setLocation` has no route (blocker 2; the same test), and only the sync and account deletion write `people.approx_*`. So everyone and every dinner sits at `DEMO_LOCATION` (`geo.ts`, a placeholder at MIT, `TODO(caleb)`), every distance reads "In your building", and `maxMiles` filters nothing. The app defines `setLocation` but no screen calls it. Say whether 1.1 asks for a place. **Caleb**, then API
3. ~~The team can't take a recipe down.~~ **Done (#328):** `remove` unshares the recipe and sets `hidden_at` behind the recipes switch (`recipes/writes.ts` `reviewRecipeIfOpen`), as Convex's review did, and `keep` clears `hidden_at`. Sharing a taken-down recipe again is 409 `taken_down`, and its family sees `hiddenAt` and `takenDown` (flow 4, "The team"). **App:** on her recipe page, show that the team took it off the map in place of the share switch when `hiddenAt` is set.
4. ~~Report alerts reach nobody on AWS.~~ **Done (#323):** a report or block logs its alert line, and an alarm emails the team within about 5 minutes. Open reports past 12 hours email once a day. Proven on staging Nov 2 (flow 4). Production gets the same with the production-config PR. **API**
5. Once Convex is gone the team can't see what a reported item is: `node dist/reports.js open` prints ids only. COMMUNITY-MIGRATION.md, open question 2, recommends a `show <kind> <id>` run from a laptop, which needs a database connection from outside the VPC. **Caleb**
6. A host who leaves the family, or moves to another, keeps their dinners. `removePerson` (`accounts/family.ts`) ends their sessions but touches no dinner, where account deletion cancels them (`deletion.ts`, `cancelDinnersOfPerson`). Their open dinners stay in the feed, and nobody can answer the asks: only the host may, and a host who left can't act in that family again (403 `removed_from_family`). **API**
7. A host can still say yes on a cancelled or past dinner, and that guest then reads its address: `respondToJoin` (`dinners.ts`) checks neither (COMMUNITY-MIGRATION.md, Known limits). **API**
8. Production's settings for this area aren't in `infra/envs/production/main.tf` on `aws-migration` yet: `RATE_LIMIT_SALT` (every `/invite/open` is 500 without it), `EDIBLE_CODE_KEY` (asking for an invite link is 500), `RECIPE_WRITES=on` (her tap is 501) and the `community.remind_open` schedule. **Built** on `claude/aws-production-config`, a PR after this one. Its first apply is Caleb's. No `REPORT_ALERT_URL`: the alarm emails instead (item 4). **API**, with Caleb's OK for production
9. No live topic for Community. LIVE-UPDATES.md plans `dinners:get` (30 s on the screen), the four lists (focus, 60 s) and `community:recipe` and `community:blocked` (focus only); `/v1/live/` serves `jobs` only. Until then the app reads the plain routes ("Live topics", above). **API**
10. Nothing pushes: a host hears of a guest's ask, and a guest of the host's answer, only by opening the dinner; the same for swaps (COMMUNITY-MIGRATION.md, Deferred: Convex sent none). Say whether 1.1 wants these pushes. **Caleb**
11. `POST /v1/dinners` checks its own `Idempotency-Key` (`routes.ts`: optional, 8 to 100 characters, 400 with no `message`) instead of `idempotency.ts`'s (8 to 128), and hashes the body as sent (`dinners.ts`, `JSON.stringify(input)`), so a retry that orders its keys differently is 409 `idempotency_conflict`; `idempotency.ts` sorts keys first. **API**
12. The Community tab is off in the app (Caleb, Oct 25, `kid/_layout.tsx`), but the cook's "Share with people nearby" switch shows on her recipe page, and the dinner and invite screens remain. Say whether 1.1 shows Community. If it does, the blocked list with Unblock (`YouCard.tsx`) lives on that tab and must stay reachable. **Caleb**, then App
13. `TODO(caleb)`: the host's whole name on the public invite page, which anyone a guest forwards the link to sees (`dinners.ts` `openInvite`), and the demo venue's coordinates (`geo.ts`). **Caleb**
14. `/d` calls `/invite/open` on Convex's host (`web/src/lib/dinner-invite.ts`, `CONVEX_SITE_URL`), and the app's `live/invite.ts` makes its host from `EXPO_PUBLIC_CONVEX_URL`: point both at the api. **Web**, **App**

## Doc drift

1. COMMUNITY-MIGRATION.md's blockers 1, 2 and 5, its open questions 1, 3 and 4, and "What the app and site need at the switch" ("Old versions call through an adapter"), plus the comments at the top of `service.ts`, `safety.ts` and `reports.ts`, assume a sync owns `recipes` and `people` and Convex runs beside the api. Since Nov 2 there's one switch, no sync and no adapter (`recipes/switch.ts`; ACCOUNTS.md's opening). `service.ts` also still says the story card isn't built; it's in `messages/storyCards.ts`.
2. COMMUNITY-MIGRATION.md, "Secrets and env", says `RATE_LIMIT_SALT`, `REPORT_ALERT_URL`, `REPORT_ALERT_TOKEN` and `REPORT_ALERT_EMAIL` "are already set". Staging's Terraform names none of the three alert settings, and `alerts.tf` says `REPORT_ALERT_URL` stays unset on AWS: since #323 an alarm emails instead (its "How a report reaches the team on AWS"). Its "What `infra/` needs" says staging lacks `EDIBLE_CODE_KEY`; `infra/envs/staging/main.tf` names it now.
3. COMMUNITY-MIGRATION.md, difference 12: "a body over 1000 bytes is still its 400". The code answers 413 `too_large` (`communityInvites.test.ts`), as ACCOUNTS.md says.
4. COMMUNITY-MIGRATION.md, "Routes": "`message` is the sentence the app shows". Since #291 the app shows its own words by `error`, and `message` is the English fallback (ACCOUNTS.md, "Errors").
5. ERROR-CODES.md, `own_family`: "asking your own family for a recipe or a dinner". Reporting or blocking your own family's recipe or dinner answers it too.
6. ERROR-CODES.md, `answered`: names dinner requests' `/respond` but not `POST /v1/community/swaps/:id/respond`, which answers it too.
7. ERROR-CODES.md, `declined`: "asking again after they said no". That's swaps and "cook together"; a guest the host turned down gets 409 `already_asked` when asking again.
8. ERROR-CODES.md, `too_large`: leaves out `POST /v1/dinners`'s 16 KB body limit.
9. ERROR-CODES.md, `not_moved`: "Never in production 1.1". That holds only once production sets `RECIPE_WRITES=on`, which `infra/envs/production/main.tf` doesn't yet (JOBS.md, open item 14).
10. ACCOUNTS.md, "Requests": `Idempotency-Key` is 8 to 128 characters. `POST /v1/dinners` takes 8 to 100 (item 11 above).

No code is missing: every one this area sends is in ERROR-CODES.md (`invalid`, `signed_out`, `removed_from_family`, `not_a_guest`, `origin`, `not_found`, `no_route`, `own_family`, `not_shared`, `taken_down`, `declined`, `answered`, `already_asked`, `full`, `idempotency_conflict`, `too_large`, `words`, `rate_limited`, `not_moved`, `server_error`, `unavailable`, and the team script's `recipes_read_only`). Community never sends `forbidden`.

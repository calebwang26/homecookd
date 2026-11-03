# Dish cards and cravings: the api contract for the app (1.1)

Nov 2, 2026. Read from `aws-migration` at `517368c95`, and checked against staging with calls that change nothing but rate-limit counters. For the App screens & recording chat, with a section for App Store, web & builds. This covers a kid asking a cook for a dish (a "card"), craving links, the cook's side of a card (her answers, her clips, her voice recipe, her filming day), the merge that writes her version, reading cards, claiming a card's side, filming a recipe for a card, and live updates for cards. It's the fourth contract: [ACCOUNTS.md, "Conventions"](ACCOUNTS.md#conventions-all-areas) applies (the address, the session, JSON bodies, `Idempotency-Key`, paging, no stubs, polling), every code is in [ERROR-CODES.md](ERROR-CODES.md), and [JOBS.md](JOBS.md) and [MESSAGES.md](MESSAGES.md) have the jobs and the pushes these hang off. Every person id is the `personId` a session returns. Times are epoch milliseconds.

**Where it stands.** The web side (`/dish/*`) is built, craving links included (`POST /dish/craving/peek`, `cravingToken` on `POST /dish/cards`, and the `craving` push, #321). The cook's side in the app (`/v1/cravings*`), the claim, and a signed-in read of one card by id (`GET /v1/dish-asks/:id`, Convex's `dishAsks.get`, #321) are built. **One thing isn't:** the list of a person's cards (`dishAsks.forMe`), which the app doesn't call today (open item 2).

**Privacy.** A recipe that isn't ready is its cook's alone (#305), and her answers are hers until she sends them. How cards hold to it:

| What | The rule in the code | Code |
|---|---|---|
| A card never names a recipe | No card or ask field carries a `recipeId`. The only tie is `dishAskId` on a job | `dish/pages.ts`, `cravings.ts` `cravingAsk` |
| `dishAskId` on `POST /v1/jobs` | Kept only for a card asked of her (`requested_of`) in her own family; any other is dropped with no error | `dish/links.ts` `isRequestOf`, `jobs/service.ts` |
| The `filmed` push | Queued only when the recipe is `ready` and its cook is the card's cook, and sent only to a kid in the recipe's family | `messages/published.ts`, `pushEvents.ts` `pushFilmed` |
| `answered` on an ask | Means her voice version exists. Filming never sets it, so a processing recipe shows nowhere on a card | `cravings.ts` `cravingAsk` |
| Her clips before Send | The kid's card lists no answer until she sends, or leaves them 20 minutes without Send (that counts as sent: the kid's look on the web or in the app, never hers). Words show only with her version | `pages.ts` `cardJson`, `service.ts` `kidLook` (`ABANDONED_MS`) |
| Her requests | `GET /v1/cravings` and `/:id` show only cards asked of her. Her family's card asked of someone else is 403 `not_asked_of_you` on writes and 404 on the read | `cravings.ts` `getAsk`, `askedOfMe` |
| A card in the app | `GET /v1/dish-asks/:id` answers only its kid (`person_id`) and its cook (`requested_of`). Anyone else, her family included, gets the same 404 as a card that isn't there | `service.ts` `myCard` |
| A card from her craving link | Born in her family and asked of her (`family_id`, `requested_of`, `craving_id`, `cook_claimed_at`); the kid stays no one in the app until a claim, and nobody joins her family. The peek shows only her first name, what the family calls her and her line | `service.ts` `createCard`, `cravingLinks.ts` |

## Ids and tokens

| Name | Looks like | Who holds it | Notes |
|---|---|---|---|
| `dishAskId` | uuid text | The app, after a claim | The card's id. The web never sees it |
| `kidToken` | 22 base62 | The kid: `/miss?k=<kidToken>` | Reads and edits the card. Stored only as its sha256, so a lost one can't be sent again |
| `askToken` | 22 base62 | Mom: `/a?t=<askToken>`, inside `card.askUrl` | Derived from `kidToken`. Reads her page and takes her answers |
| craving token | 22 base62 | Kids: `/miss?c=<token>` | From `POST /v1/cravings/link`. Stored hashed and sealed. The web sends it as `cravingToken` |
| `fileId` | 22 base62 | Whoever asked for the upload link | A capability for one web upload, never an S3 key |
| `audioKey` | `private/dish/<uuid>` | The cook, for her voice recipe | A signed-in upload's key, checked by the file guard |

## Flows

1. **The kid asks from the app.** There's no such call today: the app makes no card, and the kid names the dish on the web (PRD-V2, Phase 2). `POST /dish/cards` takes the app's call (it sends no `Origin`), and a claim would then put the card in the app, but no screen does this (open item 13).
2. **The kid asks on the web** (`/miss`):
   1. Optional photos (up to 3) and a voice note: `POST /dish/files?kind=photo|voice`, a PUT to `uploadUrl`, `POST /dish/files/confirm`.
   2. `POST /dish/cards {dish, relation, kidName?, photos?, voiceNote?}` waits on the models (about 4 to 8 s, 60 s at most) and answers 201 `{kidToken, card}`, `status: "draft"`, with the guess and 3 suggested questions.
   3. The kid edits the guess and picks questions: `POST /dish/cards/update`, `POST /dish/cards/ask`.
   4. The kid shares `card.askUrl` and the page calls `POST /dish/cards/sent {via}`: `status: "asked"`.
3. **The kid asks through a craving link** (`/miss?c=`):
   1. `POST /dish/craving/peek {cravingToken}` → `{parentName, relation, message}`: her first name, what the family calls her, and her line. A dead link is 404 `not_found`, and the page shows the plain one.
   2. `POST /dish/cards {dish, kidName, cravingToken, photos?, voiceNote?}`, with no `relation`: the kid is asking her, by what the family calls her when it's one of the six, else `mom`. Her link's checks run before any model: 404 for a dead link, 429 `link_full` past its caps.
   3. The card is born asked of her, in her family (`requested_of`, `family_id`, `craving_id`, `cook_claimed_at`), `status: "draft"`. It's in her `GET /v1/cravings` at once, and the `craving` push goes to her with it ("<Kid> wants your <dish>", `/request/<id>`). The kid carries on as in flow 2.
4. **The cook sees the ask and answers.**
   - **On the web** (`/a?t=`): `POST /dish/ask/peek {askToken, lang?}` (the first one sets `openedAt`); per question, `POST /dish/ask/answer/upload?q=&lang=&durationS=`, a PUT, `POST /dish/ask/answer?q=&lang=&durationS=`; then Send, `POST /dish/ask/finish`. The page polls peek every 2 s while `merging`.
   - **In the app** (after she claims the cook side, flow 8, or for a craving card): `GET /v1/cravings` lists what was asked of her; `POST /v1/cravings/:id/filming-day {day}` tells the kid the day; "Tell him now" is `POST /v1/cravings/:id/voice-recipe/upload`, a PUT, then `POST /v1/cravings/:id/voice-recipe {audioKey, durationS, language?}`. That one answer to "How do you make it?" sends at once and starts the merge; `voiceRecipe` goes `writing`, then `ready` or `failed`.
5. **Her clips.** Each clip queues `dish.hear` on the `scheduled` queue: Ink writes it down, and Claude puts it in English if she spoke another language. A replaced clip is deleted. Before her version, the kid's card lists none of her answers (privacy table above).
6. **A merge.** After Send (web) or her voice recipe (app), `dish.merge` writes her version from the guess and all her words, then the word filter reads it. All her answers or none. A failed try is tried again 3 minutes on, 5 tries at most. Mom's work may pass the daily budget by $1 (`MOM_OVERAGE_USD`); past that it waits for the next UTC day. While it runs, `merging` is true (about 10 to 20 s). It ends with `version` set and `status: "answered"`, or, when no version will come (no words heard, or every try failed), with her clips going to the kid as they are. Either end queues the `answered` push.
7. **The kid gets the answer.**
   - **On the web:** `POST /dish/cards/get {kidToken}`, every 3 s while `merging`, else every 15 s while asked.
   - **In the app:** the `answered` push opens `/dish/<id>`, which reads `GET /v1/dish-asks/<id>`: every 3 s while `merging`, else on focus (Live, below). Only a web-only kid with no person gets no push.
8. **Claiming a card from a link** (ACCOUNTS.md, "A dish card's link"):
   1. `POST /link/open {token}` (the kid's or Mom's token) says which side and the dish, and gives a join `ticket` when the card has a family, that side was never claimed, and the card had activity in the last 30 days.
   2. Signed out with a ticket: sign in with `link_ticket`. The side sets the role.
   3. `POST /v1/links/claim {token}` answers `{dishAskId, side, sameFamily, taken}`. The kid's token makes them the card's kid (`person_id`), Mom's makes her its cook (`requested_of`, and her relation if she has none). A card with no family joins the caller's. It queues `joined` to the other side if they're in the claimer's family.
   4. Open `/dish/<dishAskId>`: `GET /v1/dish-asks/<dishAskId>` answers either side at once. The cook side shows in `GET /v1/cravings` at once too.
9. **Filming a recipe for a card.** From the request screen (`/record?ask=<id>`), send `dishAskId: <id>` on `POST /v1/jobs` (JOBS.md, flow 1). The id comes from `GET /v1/cravings`' `asks[].id`, which exists now. The app doesn't send it yet, to Convex or AWS (open item 6). When the recipe is `ready`, the kid gets `filmed`, which opens `/recipe/<recipeId>`. A card claimed across two families keeps working, but its job drops the id, so no `filmed` (the kid couldn't open that family's recipe anyway).

## Routes

### The web's routes: `/dish/*` (public, a token in the body)

Code: `api/src/modules/dish/routes.ts` (checks), `service.ts` (rules), `pages.ts` (shapes), `uploads.ts` (files), `values.ts` (limits, errors), `merge.ts`, `budget.ts`.

How to call them:
- `POST` only. The body is JSON whatever its `content-type`: the site sends `text/plain`, so there's no preflight. No body reads as `{}`. Over 64 KB is 413 `too_large`. A raw `image/*`, `audio/*` or `video/*` body is 415 `bad_type`, unread.
- No session. The token is the credential, in the body. The two answer routes also take `X-Dish-Token`; the site doesn't send it.
- `Idempotency-Key` is allowed in CORS but not read. Retries are in "Retries" below.
- CORS: `https://homecookd.app`, `www`, `http://localhost`, `127.0.0.1` or `[::1]` on any port, `DISH_WEB_ORIGIN`, and `SITE_ORIGINS`. Any other `Origin` is 403 `origin`, its preflight too. The app sends no `Origin`. Every answer is `Cache-Control: no-store`.

| Route | Body (query) | Answer | Codes |
|---|---|---|---|
| `POST /dish/files?kind=photo\|voice` | `{contentType, size}` | 201 `{fileId, kind, contentType, size, uploadUrl, uploadHeaders, expiresInS}`. PUT the bytes to `uploadUrl` with `uploadHeaders` within `expiresInS` (120) | `invalid` (`kind`, `size`), `bad_type`, `too_large`, `rate_limited`, `provider_down` |
| `POST /dish/files/confirm` | `{fileId}` | 201 `{fileId, kind, contentType, size}` once S3 has the bytes. Safe to repeat | `invalid` (`fileId`; "The file is empty."), `not_found`, `too_large`, `bad_type` (the bytes don't match: the file is deleted), `provider_down` |
| `POST /dish/craving/peek` | `{cravingToken}` | `{parentName, relation, message}`. `relation` is what her family calls her ("Mom", "Aai"), or null | `invalid` (`cravingToken`), `not_found`, `rate_limited` (unknown tokens) |
| `POST /dish/cards` | `{dish, relation?, kidName?, photos?, voiceNote?, cravingToken?}` | 201 `{kidToken, card}` | `invalid` (`dish`, `relation`, `kidName`, `photos`, `voiceNote`, `cravingToken`), `words`, `not_a_dish`, `budget`, `not_found` (a file; a craving link that's unknown, stopped, or whose maker left), `link_full` (the craving link's caps), `rate_limited`, `provider_down`, `not_set_up` |
| `POST /dish/cards/get` | `{kidToken}` | `{card}` | `invalid` (`kidToken`), `not_found` |
| `POST /dish/cards/update` | `{kidToken, relation?, kidName?, message?, voiceNote?, voiceNoteS?, edits?}` | `{card}` | `invalid`, `words`, `closed`, `not_found` |
| `POST /dish/cards/ask` | `{kidToken, questions: [{id?, text?, about?}]}` | `{card}` | `invalid`, `words`, `closed`, `not_found`, `rate_limited` |
| `POST /dish/cards/sent` | `{kidToken, via}` | `{card}` | `invalid` (`via`; "Pick who you're asking first."), `not_found` |
| `POST /dish/ask/peek` | `{askToken, lang?}` | `{ask}` | `invalid` (`askToken`, `lang`), `not_found` |
| `POST /dish/ask/answer/upload` (`?q=&lang=&durationS=`) | `{askToken, contentType, size}` | 201 the upload link, as `/dish/files` | `invalid` (`q`, `lang`, `durationS`, `size`; `q`: "That question wasn't asked."), `bad_type`, `too_large`, `closed`, `not_found`, `rate_limited`, `provider_down` |
| `POST /dish/ask/answer` (`?q=&lang=&durationS=`) | `{askToken, fileId}` | `{ask}` | `invalid`, `closed`, `not_found`, `provider_down`, and at the server's check of her clip's bytes `too_large`, `bad_type` or `invalid` (empty), each deleting the upload |
| `POST /dish/ask/finish` | `{askToken, lang?}` | `{ask}` | `invalid`, `not_found` |

Every `/dish/*` route can also answer `origin` (a browser only), `too_large` (the body), `no_route`, `unavailable` and `server_error`.

**Field rules.**

| Field | Rule |
|---|---|
| `dish` | 2 to 200 characters, unless there's a photo or a voice note |
| `relation` | `mom`, `dad`, `grandma`, `grandpa`, `auntie`, `uncle`, or `none` (no one yet: asking is off). Defaults to `mom` |
| `kidName` | Up to 40. Required with `cravingToken` ("kidName is required") |
| `cravingToken` | The `c` of her `/miss?c=` link. A string, else 400; malformed is the same 404 as an unknown one. With it, leave out `relation` |
| `photos` | Up to 3 `fileId`s of confirmed `photo` uploads, none twice. JPEG, PNG or WebP, 5 MB each |
| `voiceNote` | A confirmed `voice` upload: 3 MB, one of `audio/webm`, `ogg`, `mp4`, `m4a`, `x-m4a`, `aac`, `mpeg`, `wav`. On `/cards/update`, `null` removes it |
| `voiceNoteS` | The page's own measure, more than 0 and up to 60 s |
| `message` | What Mom reads, 1 to 500 characters. It starts as "Mom, how do you make your <dish>? I'm trying to make it here." and follows `relation` until the kid changes it |
| `edits` | Up to 20: `{kind: "ingredient", index, name?, amount?}` or `{kind: "line", step, line, text?}`. The part becomes `status: "stated"` |
| `questions` | 1 to 3 at a time, 6 in all. `id` is `q1` to `q3` (a suggestion), or left out for the kid's own (`q4` to `q6`). `text` 3 to 120. `about` (`{kind: "ingredient", index}` or `{kind: "line", step, line}`) with no `text` gets a question written from the guess. One she answered is kept; a list of only answered ones is 409 `closed`. Asking again after her Send opens her link again |
| `via` | `copy`, `sms`, `instagram`, `whatsapp`, `more`. The first one sets `askedAt`; a draft becomes `asked` |
| `q` | `q1` to `q6`, and asked on this card |
| `lang` | Her language for Ink: `en`, `hi`, `mr`, `gu`, `ta`, `te`, `pa`, `ur`, `bn`, `zh`, `ko`, `es`, `tl`, `ar`, `pt`, `vi`. On peek and finish, any other value (or `en`) means English |
| `durationS` | More than 0 and up to 125; saved as at most 120 |
| Answer clips | Up to 5 MB, the voice types above |

**The Card** (the kid's): `{dish, relation, kidName, status: "draft" | "asked" | "answered", guess: Recipe, version: Recipe | null, answers: [{id, words, english, audioUrl, durationS}], merging, asked: [{id, text}], message, kidVoiceUrl, kidVoiceS, photoUrls, askUrl, askedAt, openedAt, finishedAt, createdAt, filmingDay}`.
- `askUrl` is `<DISH_WEB_ORIGIN>/a?t=<askToken>`, or null while `relation` is `none`.
- `answers` holds only what she sent, once it's in her version or no version will come. `words` and `english` are filled only once there's a `version`.
- `filmingDay`: 0 (Sunday) to 6, or null.

**The Ask** (Mom's): `{dish, relation, kidName, message, kidVoiceUrl, kidVoiceS, guess, inLang, photoUrls, questions, answered, clips: [{id, audioUrl, durationS}], finished, version, merging}`.
- `questions` lists only the ones she hasn't answered; `answered` lists their ids.
- `inLang` is `{lang, guess, questions, message, version}` in her page's language, once translated, or null. The first peek in a language waits on Claude; the site gives it 30 s.
- `version` is null while `merging`.
- `kidName` is null once the kid deleted their account. The card stays for her, without the kid's name, photos, voice notes or message.

**A Recipe:** `{dish, servings, time, cost, ingredients: [{name, amount, status, ask, clip, was, quote, isGuess}], steps: [{title, lines: [{text, detail, short, status, ask, clip, was, quote, isGuess}], uses, tip: {words, english, clip} | null}], questions: [{id, text}]}`.
- `status` is `stated` (the kid said it), `guessed` (ours, amount starts with `~`), `unknown`, or `mom` (her answer settled it).
- `was` is what her version replaced; `quote` is `{words, english}`, her words that settled it; `clip` is the answer that backs it.
- `**bold**` marks words in `text`.

Links (`audioUrl`, `kidVoiceUrl`, `photoUrls`) are signed and good for 1 to 2 hours. One that can't be made is null, or left out of `photoUrls`. A page open longer reloads the card when a tap finds a dead link.

**Limits, per address unless marked** (behind CloudFront, everyone testing staging shares one):

| What | Limit |
|---|---|
| `POST /dish/cards` | 6 per 10 minutes and 30 a day, counted before the body is read |
| `POST /dish/files` | 30 per 10 minutes |
| `POST /dish/cards/ask` | 30 per 10 minutes |
| `POST /dish/ask/answer/upload` | 30 per 10 minutes. `/dish/ask/answer` has only the next one |
| An unknown token or file (any route, and `/link/open`) | 20 per 10 minutes, shared. A dead craving link counts too |
| Translating Mom's page | 3 tries an hour per card and language (never an error: her page stays English) |
| A craving link's cards (per link, not address) | 5 in 24 hours and 20 in all (both `TODO(caleb)`): then 429 `link_full`. The peek still answers. A used-up link stays used up; her next "Share" in the app makes a new one |

A 429's `message` is "Too many tries. Please wait a few minutes and try again.", with `retry-after`. `link_full`'s is Convex's, "This link has had a lot of requests. Ask for a new one.", with `retry-after` when the day's cap frees a card (a day for a used-up link).

**The daily model budget.** Every model call adds its cost to today's total (UTC day). Once it reaches `DISH_DAILY_BUDGET_USD` (production's default $10, `TODO(caleb)`; staging $1), `POST /dish/cards` is 429 `budget` ("homecookd has made all the recipes it can today. Try again tomorrow."), with `retry-after` to the next UTC midnight. Mom's side never gets `budget`: her clips are saved, and her hearing, translation and merge go on to $1 past the budget, then wait for the next day with `merging: false`. Calls in flight still land, so the total can pass the cap (DISH-MIGRATION.md, Known limits). The team gets one alert a day.

**Retries.**

| Route | Safe to send again? |
|---|---|
| `POST /dish/cards` | **No.** A retry can't be recognized: the first `kidToken` is gone, and its files answer `not_found`. Upload the files again and make a new card (DISH-MIGRATION.md, open question 2). From a craving link, each card counts against its caps and pushes her |
| `/dish/files`, `/dish/ask/answer/upload` | Each call makes a new upload. One no card takes is deleted within the hour |
| `/dish/files/confirm`, `/dish/craving/peek`, `/dish/cards/get`, `/update`, `/sent`, `/dish/ask/peek`, `/finish` | Yes. `voiceNote` and `fileId` attaches are one even when two race |
| `/dish/ask/answer` | Yes: the same clip on the same question again changes nothing, even after Send |
| `/dish/cards/ask` | Replaces the open questions with the same ones |

**What the codes mean here, and what to do:**

| Code | When | Do |
|---|---|---|
| `invalid` (400, `field`) | A field above, dotted (`photos.0`, `edits.2.kind`, `questions.1.text`). No `field`: "The body must be a JSON object." | Fix the call. The sentence may be shown on the web |
| `not_found` (404) | A token, `fileId` or `cravingToken` that doesn't work: "This link doesn't work anymore." or "That file doesn't work anymore. Add it again." Every refused file gets the same answer. A craving link is dead when it's unknown, stopped, or its maker left her family or deleted her account | A token: the link is dead. A file: upload it again. A craving link: the plain page |
| `link_full` (429) | A craving link past its caps, on `/dish/cards` | The plain page, keeping what the kid typed. Read the code, not the sentence (open item 11) |
| `closed` (409) | Her answers were sent ("<Mom> already sent her answers.", "These answers were already sent.", "That answer was already sent."), a card already sent can't go to `none`, or every question was answered | Reload the card |
| `words` (422) | Blocked words in the dish, name, message, edits, questions, or the guess | "Some of those words can't be used here. Try other words." |
| `not_a_dish` (422) | The models say it isn't a dish | "Tell us a dish." |
| `budget` (429) | Above | Say so; try tomorrow |
| `rate_limited` (429) | Above | Wait `retry-after` |
| `bad_type` (415), `too_large` (413) | A file's type or size, at the link or at confirm | Pick another file |
| `provider_down` (502) | S3 or a model failed. Nothing was written | Try again |
| `not_set_up` (503) | The model key isn't set | Say it isn't ready |
| `origin` (403) | A browser on another site | A bug |

### A card in the app: `GET /v1/dish-asks/:id` (session)

Code: `api/src/modules/dish/cravingRoutes.ts`, `service.ts` `myCard`. Replaces Convex's `dishAsks.get`, which `dishCards.ts:useMyCard` reads for `/dish/[id]`.

`Authorization: Bearer <sessionToken>`. Any role. No `Idempotency-Key`, no rate limit of its own.

| Route | Answer | Codes |
|---|---|---|
| `GET /v1/dish-asks/:id` | `MyCard` | `not_found` ("Not found."): no such card, or the caller holds neither side. The same bytes for both |

Every route here can also answer `invalid` (`id` over 100 characters), `signed_out`, `removed_from_family`, `unavailable` and `server_error`.

- **MyCard** is the web's Card above, with `askUrl: null`, then `id` (the card's `dishAskId`) and `side: "kid" | "cook"`: `{dish, relation, kidName, status, guess, version, answers, merging, asked, message, kidVoiceUrl, kidVoiceS, photoUrls, askUrl, askedAt, openedAt, finishedAt, createdAt, filmingDay, id, side}`. Convex answered null where this answers 404.
- **Who reads it:** the card's kid (`person_id`, after a kid-side claim) is `side: "kid"`; its cook (`requested_of`: a cook-side claim, or a card from her craving link) is `side: "cook"`. No one else, as on Convex: being in the card's family isn't enough.
- **Her clips:** `answers` is the kid's list on both sides, so Mom sees her own clips here only once they've gone to the kid. Before her Send it's `[]`, `status` stays `asked` and `merging` is false. The kid's read counts her answers left 20 minutes without Send as sent, and starts her version (then `merging` is true), as `POST /dish/cards/get` does. Her own read changes nothing.
- **Her version:** `version` and `status: "answered"` on both sides, once the merge lands (her web Send, or her voice recipe from `/v1/cravings/:id/voice-recipe`).
- **Polling:** there's no live topic (Live, below). Read it again every 3 s while `merging`, else on focus.
- **Retries:** a read; safe to repeat.

### The cook's routes in the app: `/v1/cravings*` (session)

Code: `api/src/modules/dish/cravingRoutes.ts`, `cravings.ts`, `cravingData.ts`.

`Authorization: Bearer <sessionToken>` on each. Any role may call them; the app shows them to cooks. None reads `Idempotency-Key`. None has a rate limit of its own.

| Route | Body | Answer | Codes |
|---|---|---|---|
| `POST /v1/cravings/link` | `{message?}` (`{}` for none) | `{url}`: `<DISH_WEB_ORIGIN>/miss?c=<22>` | `invalid` (`message`: "Your message must be 1 to 300 characters."), `words` |
| `POST /v1/cravings/link/revoke` | none, or `{}` | `{ok: true}` | |
| `GET /v1/cravings?cursor=` | | `{asks: [CravingAsk], nextCursor}`, 50 a page, newest first, answered ones too | `invalid` (`cursor`) |
| `GET /v1/cravings/:id` | | `CravingAsk` | `not_found`: not asked of her (her family's included) |
| `POST /v1/cravings/:id/filming-day` | `{day}`: 0 (Sunday) to 6, or null to clear | `{ok: true}` | `invalid` (`day`: "Pick a day of the week."), `not_found`, `not_asked_of_you` ("Only <Name> can pick the day.") |
| `POST /v1/cravings/:id/voice-recipe/upload` | `{contentType, size}` | 201 `{audioKey, contentType, size, uploadUrl, uploadHeaders, expiresInS}`. PUT within `expiresInS` (120) | `bad_type`, `too_large` ("That answer is too long."), `invalid` (`size`), `not_found`, `not_asked_of_you` ("Only <Name> can answer this one."), `provider_down` |
| `POST /v1/cravings/:id/voice-recipe` | `{audioKey, durationS, language?}` | `{ok: true}`. Then read the ask again: `voiceRecipe` is `writing` | `invalid` (`durationS`: "A voice recipe is 1 second to 2 minutes long."; `language`: "Pick a language from the list."), `not_found`, `not_asked_of_you`, `closed` ("This one already has her answer."), and at the server's check of the bytes `too_large`, `bad_type` or `invalid` (empty), each deleting the upload |

Every route here can also answer `signed_out`, `removed_from_family`, `unavailable` and `server_error`.

- **Her link:** one live link, reused. A new `message` replaces its line (the default is "What do you miss from home? Tell me and I'll make it for you."). A new link is made when she has none, stopped hers, or it made 20 cards (`TODO(caleb)`). Cards a stopped link made stay.
- **CravingAsk:** `{id, kidName, dish, guess: [{amount, name}], kidVoiceUrl, photoUrl, message, createdAt, answered, voiceRecipe: "writing" | "ready" | "failed" | null, filmingDay}`. `kidName` is `""` once the kid deleted their account. `answered` is true once her version exists (her web answers or her voice recipe), never from filming. `voiceRecipe` is `failed` when no words were heard or every merge try failed: she may send again, which replaces it.
- **What's in her list:** cards whose cook is her (`requested_of`): a web ask whose cook side she claimed, or a card from her craving link. There's no CravingAsk version of her clips or version: Mom's full view of a card is `GET /v1/dish-asks/:id`, above.
- **The voice recipe:** `language` defaults to her person's language, else English. 1 to 125 s, saved as at most 120. The same `audioKey` again changes nothing. A second recording replaces the first. Her upload goes through the file guard: someone else's key is 404.
- **Retries:** `link` returns the same link; `revoke` and `filming-day` are safe to repeat; `voice-recipe` with the same `audioKey` is too. Each `voice-recipe/upload` makes a new upload, deleted within the hour if unused.

### Links and claims (session, or public)

Code: `api/src/modules/accounts/links.ts`, `routes.ts`; `api/src/modules/dish/links.ts`. Bodies, answers and codes are in [ACCOUNTS.md](ACCOUNTS.md): `POST /link/open` and `POST /v1/links/claim`. What a claim does to a card:

| Token | Sets | Also |
|---|---|---|
| `kidToken` | `person_id` = the caller; `kid_claimed_at`, once and for good | |
| `askToken` | `requested_of` = the caller; `cook_claimed_at`, once and for good | The caller's `relation` ("Mom") when unset. The card shows in her `GET /v1/cravings` |
| Either | `family_id` = the caller's family, when unset; the card's files join that family | `joined` push to the other side, if they're in the claimer's family. One ticket-join per side, ever |

`taken: true` means someone still here holds that side, and nothing changed. A claim never moves anyone between families.

### `dishAskId` on `POST /v1/jobs` (session, a cook)

Code: `api/src/modules/jobs/service.ts`, `dish/links.ts` `isRequestOf`. In [JOBS.md](JOBS.md), "The job": optional, a string of 1 to 100. Kept only for a card asked of her in her family; any other is left off with no error.

### Pushes about cards

Code: `api/src/modules/messages/pushEvents.ts`; words and limits in [MESSAGES.md](MESSAGES.md), flow 9.

| Kind | To | Opens | On AWS |
|---|---|---|---|
| `answered` | The card's kid | `/dish/<cardId>` | Queued by the merge |
| `joined` | The other side, in the claimer's family | `/dish/<cardId>` | Queued by the claim |
| `craving` | The cook who sent the craving link | `/request/<askId>` | Queued with the card from her link, in its transaction (`service.ts` `createCard`); once per card. At most 3 a day reach her, and one waits out her quiet hours (MESSAGES.md, flow 9) |
| `filmed` | The card's kid, in the recipe's family | `/recipe/<recipeId>` | Queued when a job with `dishAskId` publishes a ready recipe |

`/dish/<cardId>` reads `GET /v1/dish-asks/:id`. `/request/<askId>` reads `GET /v1/cravings/:id`. `/recipe/<recipeId>` reads `GET /v1/recipes/:id` (JOBS.md).

## Live

`/v1/live/` serves `jobs` only. Checked on staging Nov 2: `GET /v1/live/dishAsks:get` and `/v1/live/cravings:forCook` answer 404 `no_route`.

| Convex subscription | Screen | Plan (LIVE-UPDATES.md) | Today on AWS |
|---|---|---|---|
| `dishAsks:get` | `/dish/[id]` | A topic, 15 s on that screen | No topic (open item 4). Read `GET /v1/dish-asks/:id` on focus, and every 3 s while `merging` |
| `cravings:forCook` | cook Home; `/record`, `/request/*` through `useCravingAsk` | On focus, and every 60 s | No topic. Read `GET /v1/cravings` (every page) on focus and every 60 s on cook Home |
| `jobs:mine` | the processing card for a recipe filmed for a card | Built: `jobs` | JOBS.md |

While a merge runs, the web polls faster: the kid's page every 3 s while `merging`, Mom's every 2 s. The app should do the same on `/dish/[id]` (`GET /v1/dish-asks/:id`) and `/request/voice` (`GET /v1/cravings/:id`): every 3 s while `merging` or `voiceRecipe: "writing"`, else on focus.

## What the app calls today, and what replaces it

The rows come from APP-BACKEND-INVENTORY.md's "Cravings and kid asks (v2)" and "Sign-in" on `main`, checked against `app/src/lib/cravings.ts`, `dishCards.ts`, `live/convex.ts`, `live/links.ts` and `aws/accounts.ts` there.

| Today | App wrapper | Screens | 1.1 |
|---|---|---|---|
| Convex `dishAsks:get`, live | `dishCards.ts:useMyCard` | `/dish/[id]` | `GET /v1/dish-asks/:id` → `MyCard`, the same fields: the Card above plus `id` and `side: "kid" \| "cook"`, `askUrl: null`. 404 where Convex gave null. Not live: on focus, and every 3 s while `merging` |
| Convex `dishAsks:forMe` | not called (only `dishView.ts`'s type names it) | | **Not built**, and not called today: App says first (open item 2) |
| Convex `cravings:forCook`, live | `cravings.ts:useCravingAsks`, and `useCravingAsk(id)` finds one in that list | `/parent/home`, `/record`, `/request/[id]`, `/request/sent`, `/request/voice` | `GET /v1/cravings?cursor=` → `.asks`, every page; same fields. Not live: on focus and every 60 s |
| Convex `cravings:get` | not called | | `GET /v1/cravings/:id`. Use it for `/request/<id>` from a push, and for an ask past the first page (open item 7). 404 where Convex gave null |
| Convex `cravings:createLink` | `convex.ts:cravingLink` (soft: falls back to the plain `/miss`) | `/parent/home` and the request screens | `POST /v1/cravings/link {message?}` → `{url}`. No fallback link: an error is an error (no stubs) |
| Convex `cravings:revokeLink` | not called | | `POST /v1/cravings/link/revoke` → `{ok: true}` |
| Convex `cravings:setFilmingDay` | `convex.ts:setCravingDay` | the request screens | `POST /v1/cravings/:id/filming-day {day}` → `{ok: true}` |
| Convex `files:uploadUrl` + `cravings:sendVoiceRecipe {id, audioId, durationS}` | `convex.ts:sendCravingVoice` | `/request/voice` | Three steps: `POST /v1/cravings/:id/voice-recipe/upload {contentType, size}`, a PUT, `POST /v1/cravings/:id/voice-recipe {audioKey, durationS, language?}`. Its errors are codes now, not Convex sentences |
| Convex `jobs:create` from `/record?ask=` (no `dishAskId` today; `askReminders.ts:noteFilmingAsk` keeps it on the phone) | `convex.ts:createJob` | `/record`, `/recording`, `/send` | `POST /v1/jobs {…, dishAskId}` (open item 6) |
| Convex HTTP `/link/open` | `live/links.ts:openLink` | `/miss`, `/a`, and the other link screens | `POST /link/open`: `aws/accounts.ts:openCard`, already written |
| Convex `links:claim` | `live/links.ts:claimLink` | the same | `POST /v1/links/claim`: `aws/accounts.ts:claimCard`, already written |
| Convex `links:moved` | `live/links.ts:linksMoved` | `/_layout` | `POST /v1/links/moved` (ACCOUNTS.md). It brings her cards along too |
| `/dish/*` | none: the app makes no card | | Not needed unless open item 13 says so |

`app/src/lib/aws/errors.ts` still expects `/dish` and `/link/open` to answer `{error: <sentence>, code}`. Since #290 they answer the one shape (checked on staging).

## What the website uses (App Store, web & builds)

Code: `web/src/lib/dish/api.ts`, `components/miss/MissApp.tsx`, `components/mom/MomApp.tsx`, `lib/dinner-invite.ts`.

**The switch.** `NEXT_PUBLIC_DISH_UPLOADS === 'links'`, compiled in, selects the new api's way:
- Files: ask for a link with the blob's size, PUT with `uploadHeaders`, confirm. Mom's clip: `/dish/ask/answer/upload`, a PUT, `/dish/ask/answer` with `{askToken, fileId}`. Unset, the site sends raw bytes to Convex.
- Errors: reads the code from `error` and the sentence from `message`. Unset, it reads Convex's `{error: <sentence>, code}`.
- Set it with `NEXT_PUBLIC_DISH_URL` (the base; it follows `NEXT_PUBLIC_CONVEX_SITE_URL` when unset) in one build (CUTOVER.md, step 11). The craving routes it waited on are built (#321).

| Page | Calls | Expects |
|---|---|---|
| `/miss` | `/dish/files`, PUT, `/dish/files/confirm`; `/dish/cards` (60 s); `/dish/cards/get`; `/dish/cards/update`; `/dish/cards/ask` and `/dish/cards/sent` (kept alive: sent during the share tap) | `{kidToken, card}` and `{card}` as above. `?k=` reopens a card; `?c=` peeks first |
| `/miss?c=` | `/dish/craving/peek {cravingToken}` → `{parentName, relation, message}`; then `/dish/cards` with `cravingToken` and `kidName`, no `relation` | As Convex: a dead link is 404, which the page reads as stopped (the plain page). A full one is 429 with Convex's sentence, so `isLinkBusy` still matches it, now with the code `link_full` (open item 11). `dishWebClient.test.ts` runs the site's own `peekCraving`, `createCard` and `isLinkBusy` against it |
| `/a` | `/dish/ask/peek` (30 s), `/dish/ask/answer/upload`, PUT, `/dish/ask/answer`, `/dish/ask/finish` | `{ask}` as above; polls peek every 2 s while `merging` |
| `/d` | **Not `/dish/*`:** `POST /invite/open {token, deviceId}` on `NEXT_PUBLIC_CONVEX_SITE_URL` | `{dish, hostName, startsAt}`, 404 for a dead link. The api's `community/inviteRoutes.ts` answers the same (WEB-MIGRATION.md) |

- **How the site reads an answer** (`call` in `api.ts`): 404 `not-found`; 429 `budget` when `error` is `budget`, else `rate`; 409 `closed`; 422 `words` when `error` is `words`, else `not-a-dish`; other 4xx `bad`; 5xx, a failed PUT, or a 200 that isn't JSON: `busy`; no answer: `network`. Timeouts: 15 s a call, 60 s a card, 30 s a file's PUT, 45 s a clip's.
- **Every call is `text/plain`** with its token in the body, so none preflights. A PUT preflights against the `private` bucket's CORS, which allows `homecookd.app`, `www`, `DISH_WEB_ORIGIN` and localhost.
- **CORS on the api:** `/dish/*` allows `SITE_ORIGINS`; on staging that's its site, `https://d3jv0pihavue4r.cloudfront.net` (preflight 204, checked). `/link/open` allows `DISH_WEB_ORIGIN` but not `SITE_ORIGINS`; on staging both are the same site. The site doesn't call `/link/open`.
- `isLinkBusy` matches the words "a lot of requests" in `message`, Convex's sentence for a craving link past its caps. AWS answers the same 429 and sentence, with the code `link_full` (open item 11).
- The api's Card adds `filmingDay`, which `web/src/lib/dish/types.ts` doesn't list. Harmless.

## Staging testing

What staging runs, from `infra/envs/staging/main.tf`:

| Setting | Effect |
|---|---|
| `DISH_FAKE_AI=1` (unless a `real_ai` window) | No model is called. The guess is a fixed card that passes the real checks. The dish `asdf qwerty` is 422 `not_a_dish`. Ink "hears" "Two big spoons of ketchup." in any clip of 100 bytes or more, and nothing in a smaller one. Her English is "(English) " and her words; Mom's page in another language is the English with `[<lang>] ` in front. Fake calls still count: a card $0.001, a version $0.002, a clip $0.0002, an English line $0.0005, a page translation $0.003 |
| `DISH_DAILY_BUDGET_USD` = `dish_budget_usd`, default `"1"` | $1 a day, plus $1 for Mom's side. With fake models the per-address card limits (30 a day) bind first. In a `real_ai` window it's real money: Caleb's OK |
| `DISH_WEB_ORIGIN` = staging's site | `askUrl` and craving links point at `https://d3jv0pihavue4r.cloudfront.net` (`/a?t=`, `/miss?c=`) |
| `SITE_ORIGINS` = staging's site | That site may call `/dish/*` |
| `LINK_JOIN_SECRET`, `ACCOUNTS_OWNS_PEOPLE=1` | `/link/open` gives tickets, and claims work |
| The `scheduled` queue runs inside the api's tasks | Hearing and merges run on staging |
| CloudFront in front | Every tester shares one address, so `/dish/cards`' 6 per 10 minutes and 30 a day are shared |

**Make and read a card in a script** (no browser, so no `Origin` and no CORS; each step is one call):
1. `POST /dish/cards {dish: "tomato egg", relation: "mom", kidName: "Leo"}` → `{kidToken, card}`. The `askToken` is the `t` in `card.askUrl`.
2. `POST /dish/cards/sent {kidToken, via: "copy"}`; `POST /dish/cards/ask {kidToken, questions: [{id: "q1", text: card.guess.questions[0].text}]}`.
3. **The kid in the app:** `POST /v1/test/sign-in {test_id: "kid-1", name: "Leo", role: "learner"}` with `x-test-signin-key` (ACCOUNTS.md, "Staging testing"), `POST /v1/sessions/start`, then `POST /v1/links/claim {token: kidToken}` → `{dishAskId, side: "kid", sameFamily: true, taken: false}`. The card is now in kid-1's family.
4. **Mom joins from her link:** `POST /link/open {token: askToken}` → `ticket`. `POST /v1/test/sign-in {test_id: "cook-1", link_ticket: ticket, name: "Mom"}` (she joins as a cook), `POST /v1/sessions/start`, `POST /v1/links/claim {token: askToken}` → `side: "cook"`. kid-1 gets `joined` if a push token is registered.
5. **Her side in the app:** `GET /v1/cravings` as cook-1 lists the card with `id: dishAskId`. `POST /v1/cravings/<id>/filming-day {day: 0}`.
6. **Her answer**, either way:
   - web: `POST /dish/ask/answer/upload?q=q1&lang=en&durationS=5 {askToken, contentType: "audio/mp4", size}`, PUT at least 100 bytes, `POST /dish/ask/answer?q=q1&lang=en&durationS=5 {askToken, fileId}`, `POST /dish/ask/finish {askToken}`;
   - app: `voice-recipe/upload`, a PUT, `voice-recipe {audioKey, durationS: 5}`.
7. **Read it:** poll `POST /dish/cards/get {kidToken}` until `status: "answered"` and `version` is set (seconds, with fake models), or `GET /v1/cravings/<id>` until `voiceRecipe: "ready"`. In the app, `GET /v1/dish-asks/<id>` as kid-1 (`side: "kid"`) or cook-1 (`side: "cook"`) reads the same card; anyone else gets 404.
8. **Filmed:** as cook-1, `POST /v1/jobs {…, dishAskId}`, then `POST /v1/test/recipe {jobId}` (JOBS.md). kid-1 gets `filmed`.

**A craving card:** as cook-1, `POST /v1/cravings/link {}` → `{url}`; its `c` is the token. `POST /dish/craving/peek {cravingToken}`, then `POST /dish/cards {dish: "braised pork", kidName: "Leo", cravingToken}` → 201. `GET /v1/cravings` as cook-1 lists it at once, and she gets `craving` if a push token is registered. A link makes 5 cards a day, so testers on one link share them.

Each test person is one `test_id`, the same person every time.

## Open items

Owners: **API** is the AWS backend chat, **App** is App screens & recording, **Web** is App Store, web & builds, **Caleb** is a decision only he makes.

1. ~~**API, before the Dish screens:** a signed-in read of one card by id (Convex's `dishAsks.get`): `MyCard` (the Card plus `id` and `side`, `askUrl: null`) for its kid or its cook, 404 for anyone else; `/dish/<id>`, the `answered` and `joined` pushes, and Mom's view of her clips and version all need it.~~ **Fixed in #321:** `GET /v1/dish-asks/:id` answers `MyCard` to the card's kid and its cook, and the same 404 `not_found` as a missing card to anyone else (routes, above). The kid sees none of her clips until she sends or leaves them 20 minutes; her own read changes nothing. **API**
2. **App says first,** then API if it's wanted: the list of a person's cards on both sides (Convex's `dishAsks.forMe`, 50 newest). The app doesn't call it today, so it isn't built (not in #321): App says whether a kid's screen lists their cards. Built, it would be `GET /v1/dish-asks` → `{cards: [MyCard]}`, the kid's and the cook's cards together, newest first, from the two indexes `dish_asks_person_recent` and `dish_asks_requested_recent`.
3. ~~**API, before the Dish screens:** `POST /dish/craving/peek` and `cravingToken` on `POST /dish/cards` (the card born asked of her, in her family, with the link's caps of 5 a day and 20 in all), and the `craving` push with it; the migration docs say these wait for the one-way sync, but 1.1 has no sync and the api owns its people on staging, so only the PR is missing.~~ **Fixed in #321**, as Convex has them: the peek (`{parentName, relation, message}`; a dead link is 404, a full one still peeks), and a card from the link born asked of her in her family, its link checked before any model and again under the link's row lock, so cards racing for its last one make one. Past its caps it's 429 `link_full` (an existing code, at a new status), with Convex's sentence. The `craving` push is queued in the card's transaction, once per card (MESSAGES.md, open item 6). **API**
4. API: the `dishAsks:get` live topic (15 s on the screen); until it's built, the app polls item 1's read.
5. API: the `cravings:forCook` topic isn't built, and the plan's "focus, 60 s" can be the plain `GET /v1/cravings`: say which, so App builds it once.
6. App: send `dishAskId` on `POST /v1/jobs` from `/record?ask=`; the id is `GET /v1/cravings`' `asks[].id`, which exists now.
7. App: read one ask with `GET /v1/cravings/:id` (from a push, and past the first page), not by finding it in the list.
8. ~~API: ERROR-CODES.md says `budget` comes from `/dish/cards` "and Mom's answers", but only `/dish/cards` sends it; and its `bad_type` row leaves out `/dish/files/confirm` and the Cravings voice-recipe routes. Every code these routes send is listed.~~ **Fixed in #321:** `budget` is `POST /dish/cards` only, and `bad_type` names the link routes and the checks after the PUT (`/dish/files/confirm`, `/dish/ask/answer`, both voice-recipe routes, `/v1/uploads/confirm`). `/dish/ask/answer`'s row above now lists what its byte check sends. **API**
9. ~~API: DISH-MIGRATION.md ("Deferred") and COMMUNITY-MIGRATION.md ("Deferred") still list claiming a card as not built and say `person_id`, `family_id` and `requested_of` stay null, and `routes.ts` and `cravingData.ts` say "waiting for the sync"; the claim is built and sets all three.~~ **Fixed in #321:** both docs' "Deferred" lists now say the claim, `get` and the craving routes are built and who sets those columns, and the comments are gone from `routes.ts`, `cravingData.ts`, `data.ts` and `account.ts`. **API**
10. Web, then API: a retried `POST /dish/cards` makes a second card or fails on its files (DISH-MIGRATION.md, open question 2, left for now).
11. Web: `isLinkBusy` matches words in `message`. Since #321 the api's link caps answer 429 `link_full`, with Convex's sentence kept so today's check still works: read `error === "link_full"` instead.
12. Web: the switch (`NEXT_PUBLIC_DISH_UPLOADS=links` and `NEXT_PUBLIC_DISH_URL` in one build) waited on item 3, which is built (#321), so `/miss?c=` links reach the cook on the api.
13. App: confirm 1.1 makes no card in the app (the kid names the dish on the web, PRD-V2); if it should, it's `POST /dish/cards`, then a claim with the `kidToken`.
14. Caleb: the `TODO(caleb)` numbers: production's daily budget ($10), Mom's overage ($1), a craving link's 20 cards and 5 a day, and the 30-day join window.

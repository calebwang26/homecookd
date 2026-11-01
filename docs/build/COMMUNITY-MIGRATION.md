# Community on the new api

Step 7 of `docs/build/AWS-MIGRATION.md`, the third item in its area order, Oct 31, 2026. A draft on `aws-migration`: nothing live points at it. The code is `api/src/modules/community/`, `api/src/modules/dish/cravings.ts` and `cravingRoutes.ts`, plus read-only `modules/recipes/` and two read functions in `modules/people/`. `data.ts` and `cravingData.ts` list each query with its index, and `020_community.sql` adds three indexes.

## Tables that cross areas (AWS-MIGRATION asks for these first)

| Table | Owner | What Community does |
|---|---|---|
| `families`, `people`, `recipes` | The temporary one-way sync | Reads only. Nothing in this PR writes them, and a test checks the purge doesn't |
| `questions` | Messages, next | Inserts `kind = 'share'` rows and reads them. Written here because `shareRequests.ask` is listed for this step, but see Open questions, 3 |
| `dish_asks`, `dish_answers`, `craving_links`, `files` | Dish | Cravings' signed-in side, built inside the dish module so its SQL stays with its tables |
| `outbox`, `idempotency_keys` | Platform | Report alerts, and a retry key on a new dinner |

## Blockers

Each of these writes a row the sync owns, so I stopped short. None is written around.

1. **`community.setShare` writes `recipes.shared_at`.** No route: it answers the catch-all 404.
2. **`community.setLocation` writes `people.approx_*` and `campus`.** No route.
3. **The story card (`storyCards.writeStoryCard`) writes `recipes.story_card_*`.** It only runs after a share, so it waits with it. Community reads the card here.
4. **`shareRequests.ask` from the cook's own tap, and `shareRequests.settle` on her yes, write `recipes.shared_at`.** Her tap answers 501 `not_moved`, and never says "shared" without sharing. `settle` isn't here (Deferred).
5. **A report's two-family hide, and `reports.review`, write `recipes.hidden_at` and `shared_at`.** See below, because this one had to keep working.

**Recommendation for 1 to 4:** an adapter keeps these on Convex until the jobs area moves `recipes`, and the sync brings the result to Postgres. A dish just shared takes as long as the sync to reach the feed, so M1's "within minutes" sets the delay. A person's new place does too. The alternative is moving ownership of those few columns to Postgres now, with the sync told to skip them. It gets rid of the delay, but Convex's own reads of `shared_at` (`storyFacts`, recipes.list) would then be wrong for as long as old phones use them, so I don't recommend it.

**What I did for 5.** The brief says the thresholds and hiding must carry over, and also that `recipes` can't be written, so the hide is worked out when it's read: a recipe counts as hidden when `hidden_at` is set or when `reports` holds open reports from 2 families. This writes nothing to `recipes`. Everything that asks whether a recipe is hidden goes through `seenRecipes` in `safety.ts`. A dinner is Community's own row, so its hide is stored, as on Convex.

`reviewReport` can't write the recipe either, so a recipe's review works in this order. It's refused with `recipes_read_only`, and nothing changes, until the copy shows the decision:
- **Take it down:** run Convex's `reports:review` with `keep: false`. Convex holds no reports for it, so it only changes the recipe. When the sync shows `hidden_at` set and `shared_at` null, `reviewReport` here resolves the reports.
- **Keep it:** if the recipe has no `hidden_at`, `reviewReport` resolves the reports and the hide lifts. If Convex hid it before the move, run Convex's review with `keep: true` first.

When the jobs area moves `recipes`, `reviewReport` writes it directly, and the sync's two steps go away. The worked-out hide can stay, or `fileReport` can start storing it again.

## Routes

Everything under `/v1` needs `Authorization: Bearer <sessionToken>` and answers 401 `signed_out` first. A refusal is `{error, message?, requestId}`, and `message` is the sentence the app shows. Times stay epoch milliseconds and field names stay Convex's.

**The adapter's mapping from Convex function to route.** "Reply" says what an adapter does to give an old app the same result.

| Convex function | Route | Reply |
|---|---|---|
| `community.feed` | `GET /v1/community/feed?maxMiles=&cursor=` | The same, plus `nextCursor` and `dinnersCursor`. The app's `now` is dropped |
| | `GET /v1/community/dinners?maxMiles=&cursor=` | New: more of the feed's dinners, `{dinners, nextCursor}` |
| `community.recipe` | `GET /v1/community/recipes/:id` | The same; 404 becomes `null` |
| `community.setShare` | none | Blocker 1: stays on Convex |
| `community.setLocation` | none | Blocker 2: stays on Convex |
| `community.requestSwap` | `POST /v1/community/swaps` `{recipeId, myRecipeId?}` | `.swapId` |
| `community.cookTogether` | `POST /v1/community/cook-together` `{recipeId}` | `.swapId` |
| `community.respondSwap` | `POST /v1/community/swaps/:id/respond` `{accept}` | `{ok}` becomes `null` |
| `community.mySwaps` | `GET /v1/community/swaps?cursor=` | `.swaps` |
| `community.report` | `POST /v1/community/reports` `{kind, targetId, reason?}` | `{ok}` becomes `null` |
| `community.block` | `POST /v1/community/blocks` `{kind, targetId}` | `{ok}` becomes `null` |
| `community.blocked` | `GET /v1/community/blocks?cursor=` | `.blocked` |
| `community.unblock` | `DELETE /v1/community/blocks/:id` | `{ok}` and 404 both become `null` |
| `dinners.create` | `POST /v1/dinners`, optional header `Idempotency-Key` | 201; `.dinnerId` |
| `dinners.get` | `GET /v1/dinners/:id` | The same; 404 becomes `null` |
| `dinners.mine` | `GET /v1/dinners/mine?cursor=` | `.dinners` |
| `dinners.requestJoin` | `POST /v1/dinners/:id/join` | `.requestId` |
| `dinners.respond` | `POST /v1/dinner-requests/:id/respond` `{accept}` | `{ok}` becomes `null` |
| `dinners.inviteLink` | `POST /v1/dinners/:id/invite-link` | The same |
| `/invite/open` | `POST /invite/open` | The same path, shapes and statuses, plus 429 |
| `shareRequests.ask` | `POST /v1/share-requests` `{recipeId}` | `.result`; 501 `not_moved` goes to Convex |
| `shareRequests.familyDishes` | `GET /v1/share-requests/dishes?cursor=` | `.dishes` |
| `cravings.createLink` | `POST /v1/cravings/link` `{message?}` (send `{}` for none) | The same |
| `cravings.revokeLink` | `POST /v1/cravings/link/revoke` | `{ok}` becomes `null` |
| `cravings.forCook` | `GET /v1/cravings?cursor=` | `.asks` |
| `cravings.get` | `GET /v1/cravings/:id` | The same; 404 becomes `null` |
| `cravings.setFilmingDay` | `POST /v1/cravings/:id/filming-day` `{day}` | `{ok}` becomes `null` |
| `cravings.sendVoiceRecipe` | `POST /v1/cravings/:id/voice-recipe/upload` `{contentType, size}`, a PUT to S3, then `POST /v1/cravings/:id/voice-recipe` `{audioKey, durationS, language?}` | Can't be adapted alone: see Open questions, 1 |

An adapter turns any refusal into `ConvexError(message)`. Where a 404 has no `message`, the Convex function answered `null`.

**Team only, no route:** `reports.open` and `reports.review` are `openReports()` and `reviewReport()` in `reports.ts` (Open questions, 2).

## Deferred

- **`shareRequests.decide`, `settle`, `answerFor` and `questions.translateForCook`:** with Messages, which owns `questions.answer`. `settle` also needs the blocker lifted. A new ask stays in English until then, which costs nothing yet, because the cook can't see it until Messages moves (Open questions, 3).
- **`dishAsks.forMe` and `get`, and claiming a card:** still with the dish area's signed-in step.
- **`POST /dish/craving/peek` and `cravingToken` on `POST /dish/cards`:** "card-making stays with the dish module", so they still answer 404 (DISH-MIGRATION.md). **So a real craving card can't be made on the new api yet.** Tests make one with SQL. `people` is readable now, so these need only a small dish PR once the sync runs.
- **`seedCommunity`:** the demo families come over by backfill (C6).
- **`pushEvents`:** with push, in Messages. A dinner ask or a swap sends no push on Convex today, so nothing is lost here.

## Must-carry rules, and where each is held

| Rule | Where | Test |
|---|---|---|
| Blocks both ways | `shieldFor`, `seesRecipe`, `seesDinner` | "a block works both ways" |
| Report thresholds and hiding | `HIDE_AFTER`, `seenRecipes`, `fileReport` | "reports from two families", "a dinner goes with its dish", the race test |
| The address only to host and accepted guests | `viewDinners` | "a dinner's address reaches only…", including the host's own family |
| Approximate places only | `numeric(5,2)`, `roundToGrid` | "the feed places each dish…", "a dinner is placed…" |
| No family name unless set | `familyLabel`, `plainStory` (only `public_name`) | "a family's private name never reaches a neighbor", plus the whitelist's forbidden words |
| Past dinners don't crowd out new ones | `openDinnersAhead`: `starts_at > now()` and the upcoming index | "dinners that have passed don't crowd out new ones": 150 past open dinners |
| Wrong family or blocked, the same as missing | One `notFound(sentence)` per route | `sameAsMissing`, 29 cases plus 4 for cravings, comparing every byte but `requestId` |

## Behavior differences

1. **The clock.** The feed uses the server's clock, and the app's `now` is ignored. A dinner leaves the feed when it starts, where Convex's could wait up to 15 minutes for the app's rounded clock, and a wrong phone clock no longer matters.
2. **The feed bug is fixed.** Convex read the oldest 100 open dinners, past ones included, so once 100 past dinners piled up the feed showed none. This reads the soonest 100 ahead. Far-away dinners can still fill those 100, and a window with few nearby ones sets `dinnersCursor`, so the next page continues.
3. **Lists page.** Each reply is an object with its list and `nextCursor`; the first page matches Convex's limit (50 swaps from each direction became 50 in all; 50 dinners each way; 100 blocks; 100 dishes; 50 asks). A family past the limit used to lose its older rows. Two more that follow from this: a family past 50 asks can no longer ask twice for the same dish, and can still host a dish whose yes is past the 50th (both Convex bugs, below).
4. **Status codes, not `null`.** Reads answer 404 where Convex answered `null`, and writes that said nothing now say `{ok: true}`.
5. **`unblock` of another family's block, or a missing one, is 404.** Convex returned `null` either way, and a phone's retry after a lost reply also gets 404 here. The adapter maps both to `null`.
6. **Blocked is the same as missing.** Convex said "That ask isn't open anymore." on `respondSwap` and `dinners.respond`. Now each says the route's one sentence ("Only the family that was asked can answer.", "Only the host can answer.").
7. **A host's no to a blocked guest is refused too.** Convex let the decline through, though the app never showed that row. Under the same rule it's now the same 404. On unblocking, the ask comes back pending.
8. **`respondSwap` checks blocked before "already answered".** Otherwise that answer would say a row exists.
9. **Refusals get real statuses:** 400, 403, 409, 422, as listed in each service. The sentences are Convex's, in `message`.
10. **Validation before our sentences.** A wrong type (`recipeId: 12`, a `reason` not on the list) is a plain 400 `bad_request` with no sentence, where Convex's validator threw its own error. The app never sends these.
11. **`POST /invite/open` has per-address limits:** 120 opens per 10 minutes, and 20 tokens that don't work. Convex had only the per-dinner burst. It's a 429 with `retry-after`, and the site reads anything but 200, 400 and 404 as "offline".
12. **`/invite/open` needs `RATE_LIMIT_SALT`**, and a body over 1000 bytes is still its 400.
13. **Report alerts** go through `outbox`, so a failed webhook is retried. Convex logged and moved on. The text's "Review:" line now names this doc in place of `npx convex run`.
14. **The log line.** Convex logged `community report: <kind> <id> (<reason>)`. It's gone: the alert's payload holds the kind and reason, and there's no family content anywhere.
15. **One open share ask per dish** is now a unique index (`questions_one_open_share`), so two kids tapping at once ask her once. Convex's mutation did this by serializing. A backfill must count violations first.
16. **`latestAsk` finds a share ask however many cooking questions follow it.** Convex read the newest 100 questions and could miss it, then asking her again a day early.
17. **Dinner retries.** `POST /v1/dinners` takes an optional `Idempotency-Key`: the same key and body returns the first dinner, and another body is a 409. Without one, as on old builds, a retry makes a second dinner, as on Convex.
18. **The voice recipe is three steps,** because bytes skip the api: the upload link, the PUT, the send.
19. **A bad recording is refused at the link,** by its declared type and size, before anything exists. If the bytes then don't match, it's deleted and refused at the send, as on Convex. The size's sentence is the dish module's "That answer is too long.", where Convex said "That recording is too long."
20. **Any file for a voice recipe must be her own upload for this card.** Convex's check was "a fresh file no card holds", and a storage id was enough to reach someone's. An old upload is refused once the hourly sweep has marked it, not at exactly an hour.
21. **Her clip's link names the card,** so a clip uploaded for one card can't land on another, and a clip she never sent is swept after an hour.
22. **`kidVoiceUrl` and `photoUrl` are signed links good for 1 to 2 hours,** as DISH-MIGRATION's difference 3. A link that can't be made comes back `null`.
23. **`requireOwnFiles` now goes by person where a file has an owner** (DISH-MIGRATION's open question 3). Refusing a file something already holds is done in the service, under the card's row lock. No route used this guard before.
24. **`dinners.mine`'s asks** are the newest 50 per page; Convex took the oldest 50. Past dinners stay in the list, as on Convex.
25. **Reports' 500 limit.** `shieldFor` reads up to 500 reports and 500 blocks each way for a family, as Convex does. The order isn't by time in either.

### Against SYSTEM-DESIGN.md

- **"Modules call each other's services, never each other's tables."** `community/data.ts` touches `questions` directly, because Messages has no module yet. Messages should take over `latestShareAsks` and `insertShareAsk`. Everything else goes through a service, and `recipes` got a small read-only module for it.
- **"Writes from a phone take an idempotency key."** Only `POST /v1/dinners` needs one. Swaps, reports, blocks, invite links and voice recipes are safe to repeat as they are. `join` isn't quite: a retry after a lost reply says "You already asked to join.", as on Convex, and nothing is duplicated.
- **`/invite/open` stays unversioned,** so the site and old apps need only a new host.

## Tests

`cd api && TEST_DATABASE_URL=… npm test`, on real Postgres with fake models and a fake S3.

| File | What |
|---|---|
| `community.test.ts` | `convex/community.test.ts`'s reading half |
| `communitySafety.test.ts` | `convex/safety.test.ts`, plus the recipe review's order and the alert's contents |
| `communitySwaps.test.ts` | `convex/swaps.test.ts`, plus past-50-asks |
| `communityInvites.test.ts` | `convex/dinnerInvites.test.ts`, plus many opens at once and the rate limits |
| `communityShareAsks.test.ts` | `convex/shareRequests.test.ts`'s kid side |
| `cravings.test.ts` | `convex/cravings.test.ts`'s signed-in side, plus the attach refusals and the sweep |
| `communityRoutes.test.ts` | No session on every route (found mechanically), same-as-missing, bad cursors, paging to the microsecond, races, retries, logs |
| `communityAccount.test.ts` | SCHEMA.md section 4, called by hand |
| `communityCopies.test.ts` | Fails when Convex's geo, quote rules or numbers change, so a fix reaches both |
| `files.test.ts` | The guard's real-app test now lists this route and refuses another family's and another person's key |

**Carried with the same meaning (titles Convex's unless noted):**
- `community.test.ts`: 9 of 19 whole (geo, whitelist, stock covers, past and full dinners, the address, grid cells, culture, a dish's dinner, a dinner's distance). 3 in part: "goes plain" and "without Muse" keep their reading half, with their titles reworded; "story card rules" keeps the quotes.
- `safety.test.ts`: 8 of 9.
- `swaps.test.ts`: 3 of 3. `dinnerInvites.test.ts`: 4 of 4.
- `shareRequests.test.ts`: 1 whole ("after a no"), 2 in part: the kid's ask without its translation, and "her own tap" as a `not_moved` refusal.
- `cravings.test.ts`: 5 whole (filming day, writing to ready, a silent clip and the budget, the next free question, the maker's deletion), 3 in part: `createLink` without its peeks and cards, `forCook` with a card tied by SQL, and the send's refusals, which now split between the link and the send.

**Changed in meaning:** the refusals in difference 6 and 7. Covers: "Upload" and "Lookalike" can't be stored now, so the test asserts the column's check refuses them.

**Changed only in how they run:** a test sets `recipes` and `people` with SQL where Convex's called `setShare` or `setLocation`. Time moves by changing stored times. `reviewReport` for a take-down follows a SQL change standing in for Convex and the sync.

**Not carried:**
- `community.test.ts`: `setLocation`, "only the recipe's own cook can share", the three Muse and Claude writer tests, and "Muse picks" (blocked), the two seed tests (seed deferred).
- `safety.test.ts`: "a Muse card the filter catches goes plain" (writer).
- `shareRequests.test.ts`: her typed yes, the two `TEXT_PROVIDER` tests, "without Gemini", the Marathi voice note, the yes/no reader, "only a yes" (Deferred).
- `cravings.test.ts`: peek, a card tied to her, a card's name and words, the link's caps (card-making), `forMe` and `get`.
- `lib/storyCard`'s `cleanCulture` and `parseMuseCard` assertions (writer).
- `convex/account.test.ts`'s Community assertions move as `communityAccount.test.ts`, but the account purge itself isn't run.

The 10-minute rate tests can flake across a real window edge, as `rateLimit.test.ts` can.

### Queries, checked

`EXPLAIN` on 17 of the main queries, with synthetic rows on the local Docker image (300 families, 3,000 recipes, 20,000 dinners, up to 60,000 asks, 5,000 swaps, 5,000 reports, 30,000 questions). Open dinners ahead and shared recipes read their partial indexes with an incremental sort, as does each next window. Family recipes, swaps, asks, reports and share asks use the index named in `data.ts`. `blocks` chose a full scan on 2,000 rows, and an empty `dish_asks` was scanned too, both the right call at those sizes. `my asks` first read all of `dinners` because the limit came after the join, so the page of asks is now taken first. Plans show an index is chosen, not that speed targets hold.

## Long work

Report alerts go through `outbox` on the `scheduled` queue. A voice recipe's merge goes through `dish.merge`, as Mom's Send does. Payloads hold a kind, a reason or an id.

| Task | Why a repeat is safe |
|---|---|
| `community.report_alert` | It only tells the team, so a repeat tells them twice. There's no mark like the budget alert's, because one more ping about a report does no harm |
| `community.remind_open` | Run by a schedule, and the same |

## Account deletion (SCHEMA.md section 4)

`community/account.ts`, tested with the person's ids by hand. **Nothing calls it yet:** the account purge moves last. Each runs safely twice.

| Table | Done | How |
|---|---|---|
| `dinners` | Yes | At once (`cancelDinnersOfPerson`): hosted and around her recipes cancelled. Then hosted deleted, and another family's around her recipe stays cancelled, `recipe_id` null, `dish` text kept |
| `dinner_invite_opens` | Yes | Cascades with the dinner |
| `dinner_requests` | Yes | With the dinner, and her own asks |
| `swap_requests` | Yes | She asked, or either recipe is hers |
| `reports` | Yes | `reporter_person_id` null. The family's hide stays |
| `blocks` | Yes | `label` becomes `'A family'` where her family is the blocked one |
| `craving_links` | Yes | Already in `dish/account.ts` |
| `idempotency_keys` | Yes | Rows with her id as `scope` |
| `questions` (share asks) | **No** | Messages' purge: SCHEMA.md's row says "they asked, or on their recipes: deleted" |
| `recipes`, `people`, `families` | **No** | The account purge, when their area moves |

**Order:** `cancelDinnersOfPerson` must run before her recipes are deleted, because it finds dinners by recipe. `purgeCommunityForPerson` works before or after that delete: the FKs null a dinner's recipe and cascade its swaps. `/privacy` is untouched, and no new store of family data is added.

## Secrets and env the api now needs (names only)

Nothing new. `RATE_LIMIT_SALT`, `REPORT_ALERT_URL`, `REPORT_ALERT_TOKEN`, `REPORT_ALERT_EMAIL`, `DISH_WEB_ORIGIN` and `PRIVATE_BUCKET` are already set. No model is called from this area's own code, and voice recipes use the dish module's.

## What `infra/` needs (not done: this PR touches only `api/` and `docs/build/`)

- An EventBridge schedule into `scheduled`: `{"payload":{"task":"community.remind_open"}}` daily at 16:00 UTC, as Convex's cron.

## What the app and site need at the switch

- **The site:** point `web/src/lib/dinner-invite.ts`'s host here. Its 429 reads as "offline". Nothing else changes.
- **The app:** nothing yet. Old versions call through an adapter, and new ones need the list shapes and the voice recipe's steps.

## Before a backfill

- Count violations of `questions_one_open_share`: more than one undecided share ask for a dish.
- `dinners.invite_token` is stored readable (SCHEMA.md M6, on AWS-MIGRATION's "Before real data").
- A dinner's `recipe_id` needs its recipe copied first (M1's just-in-time upsert).

## Known limits

- **A family with over 500 reports or blocks** loses the rest from `shieldFor`, as on Convex.
- **The feed's window is everyone's.** The soonest 100 dinners and newest 200 recipes are read before distance is applied, so a neighborhood's rows can fall onto later pages if the whole product grows. At 500 daily users this doesn't matter. A geographic index is the fix, if measurements call for it.
- **Paging the feed's recipes by distance can repeat or skip a row** when something is shared between pages, because distance ranks within a window. The app dedupes by id.
- **An upload link can be used again until it expires** (DISH-MIGRATION.md, known limits).
- **`dinners.respond` still accepts on a cancelled or past dinner** (Convex bug, below; kept for now).

## Open questions, with recommendations

1. **`sendVoiceRecipe` can't go through an adapter alone.** An old app uploads through Convex's `files.uploadUrl` and sends a Convex storage id. **Recommendation:** keep `cravings.sendVoiceRecipe` on Convex for old apps until they're gone, which means its cards must stay readable there, so switch all of `cravings.*` together. Only a new app uses the three steps.
2. **How the team runs `openReports` and `reviewReport`.** Convex's were `npx convex run`, and there's no equivalent here. **Recommendation:** a small script run from a task, in the same PR as the switch. A signed-in admin route would add a surface for no gain.
3. **`shareRequests.*` should switch with Messages, not Community.** A question written in Postgres isn't seen by Convex's `questions.openForCook`, so switching this route first means the cook never sees the ask. `familyDishes` must read from the same side. **Recommendation:** an adapter keeps both on Convex until Messages switches. This is the biggest ordering risk in this step.
4. **`reports` and `blocks` move as one, once.** Convex's two-family hide and Postgres's would disagree if each side took reports during a window. **Recommendation:** freeze report writes for the area's planned window, copy, switch, as AWS-MIGRATION already describes.
5. `TODO(caleb)`: the host's whole display name on `/invite/open` (kept from Convex), the words homie asks with, the demo venue's coordinates, and the 20-card link total are all still his, and carry their markers.

## Convex bugs noticed (reported, not fixed there)

- **`community.feed`** reads the oldest 100 open dinners, so past dinners crowd out new ones (known).
- **`familySwaps`' `take(50)`:** a family past 50 asks can file a second ask for the same dish, and `cookingTogether` can miss an accepted yes, so hosting is refused.
- **`shareRequests.latestAsk`'s `take(100)`** can miss the share ask behind 100 newer questions, so she could be asked again inside the day.
- **`dinners.respond`** accepts a guest on a cancelled or past dinner, and that guest then gets the address of a dinner that's called off.
- **`/invite/open`** has no per-address limit, so tokens can be guessed at any rate. They're 256 bits, so this is about load and not about guessing one.

## Not verified

- **The app and the site against these routes.** No client calls them yet, and no adapter exists. Nothing has run on a phone or in a browser.
- **The sync.** It isn't built here, so every "the sync brings it" step is a SQL update in a test.
- **Real S3, SQS or RDS, load or latency.** The voice recipe's PUT is a fake store. The p95 target is unmeasured.
- **Same behavior tests on old and new at once.** These were ported by reading and run on the new api. Old and new haven't been compared on real requests.

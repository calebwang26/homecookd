# Messages on the new api

Step 7 of `docs/build/AWS-MIGRATION.md`, the fourth item in its area order, Nov 1, 2026. A draft on `aws-migration`: nothing live points at it, and live Supabase, its data and what build 6 calls don't change. The code is `api/src/modules/messages/`, in the dish area's shape: routes check the input, the services hold the rules, and the data files hold the SQL and list each query with its index.

It covers threads, messages, read marks, recipe notes, questions, follow-ups, shares, favorites, recipe events, pending sends, push tokens and pushes, the Sunday table and the monthly recap. It rebuilds `convex/messages.ts`, `questions.ts`, `followUps.ts`, `transcribe.ts`, `push.ts`, `pushEvents.ts`, `lib/push*.ts`, `storyCards.ts` with `community.shareOn`, and those parts of Supabase's `index.ts`, `plumbing.ts`, `hearts.ts`, `table*.ts`, `recap*.ts`.

**Left for their own areas:** asking to share and the map (`shareRequests.ask`, `familyDishes`, `setShare`: Community), Supabase's `/cooking` routes, `POST /web-events` and the lander half of `POST /events`, and `homie.news`.

## Routes

Every route checks the session, and every route below `/v1`. The one exception is `POST /v1/shares/open`: the link is the capability.

**New shapes:** camelCase, as dish and Convex use. Times are ISO text with microseconds. A list is `{<items>, nextCursor}` with `?limit=` and `?cursor=`. `GET /v1/table` and `GET /v1/recap` keep the pure modules' own snake_case shapes, including `role: "learner"`, so an adapter passes them through.

**Writes that create what someone wrote require an `Idempotency-Key` header:** the two message sends, `send-recipe`, `questions`, an answer and `pending-sends`. Writes that are already the same however often they run (favorites, read marks, tokens, notes, a postcard) honor one where it matters, and don't need one.

### From Convex

| Old | New |
|---|---|
| `messages.list` | `GET /v1/messages` |
| `messages.madeMyDish` | `GET /v1/messages/made-my-dish` |
| `messages.send` | `POST /v1/messages`. `fileId` becomes `audioKey` or `photoKey` by kind |
| `messages.sharePhoto` | `POST /v1/messages/photo-note` |
| `questions.forRecipe` | `GET /v1/recipes/:recipeId/questions` |
| `questions.openForCook` | `GET /v1/questions/open` |
| `questions.answer` | `POST /v1/questions/:id/answer`. `audioId` becomes `audioKey` |
| `questions.ask`, `/voice/question` | `POST /v1/questions`, with the kid's session |
| `questions.translateForCook`, `textOf`, `saveTextForCook` | task `questions.translate` |
| `transcribe.questionAnswer`, `audioFor`, `saveTranscript` | task `questions.transcribe` |
| `followUps.askFollowUps` | `askFollowUps()` in `questions.ts`, for the worker's step |
| `followUps.decide`, `answerFor`, `settle` | task `questions.read_follow_up` |
| `shareRequests.decide`, `answerFor`, `settle` | task `questions.read_share` |
| `shareRequests.applyYes`, `community.shareOn` | `shareOnYes()` and `shareOn()` in `storyCards.ts`. Community's switch and her own tap call `shareOn()` once they're built |
| `storyCards.writeStoryCard`, `storyFacts`, `saveStoryCard` | task `story_cards.write` |
| `push.register`, `push.unregister` | `POST /v1/push-tokens`, `POST /v1/push-tokens/remove` |
| `push.queue`, `queuePush` | `queuePush()` in `push.ts`, for other areas |
| `push.deliver`, `forDelivery`, `finish` | task `push.deliver` |
| `push.receipts`, `ticketsOf`, `forget` | task `push.receipts` |
| `push.dropTokensOf`, `dropLogOf` | `account.ts` |
| `push.prune` | task `messages.daily` |
| `pushEvents.answered`, `requested`, `filmed` | tasks `push.dish_answered`, `push.dish_requested`, `push.dish_filmed` |

### From Supabase

| Old | New | For the adapter |
|---|---|---|
| `GET /threads` | `GET /v1/threads` | Old returns an array, new `{threads, nextCursor}`: read every page. `recipe_id` is `libraryId` |
| `POST /threads` `{other_id}` | `POST /v1/threads` `{otherId}` | |
| `GET /circle` | `GET /v1/circle` | |
| `GET /threads/:id/messages?after=` | `GET /v1/threads/:id/messages?after=` | Same `after`. Old took the newest 500, new takes 100 a page, newest first. A poll with more than a page waiting gets the newest page: it must follow `nextCursor` back until it reaches its `after`, or the older ones are skipped |
| `POST /threads/:id/messages` | `POST /v1/threads/:id/messages` | An old build has no key: the adapter makes one per request, so it behaves as today, with no dedupe. `audio_path` becomes `audioKey`, `audio_url` `clipKey` (strip the host), `photo_path` `photoKey`, `recipe_id` `libraryId` |
| `POST /threads/:id/read` | `POST /v1/threads/:id/read` | |
| `GET /unread` | `GET /v1/unread` | Adds `lastMessageAt` |
| `GET /questions/open` | `GET /v1/chat-questions/open` | |
| `POST /recipe-notes` `{message_id}` | `POST /v1/notes` `{messageId}` | |
| `POST /recipe-notes/:id/remove` | `POST /v1/notes/:id/remove` | |
| `GET /recipes/:id/notes` | `GET /v1/dishes/:libraryId/notes` | Paged |
| `GET /recipes/:id/questions` | `GET /v1/dishes/:libraryId/chat-questions` | |
| `POST /voice-upload`, `/photo-upload` | `POST /v1/uploads`, then `POST /v1/uploads/confirm` | One more step, and `size` is required: see the differences below |
| `POST /messages/:id/postcard` | `POST /v1/messages/:id/postcard` | |
| `POST /send-recipe` | `POST /v1/send-recipe` | `sent` has `personId`, `threadId`, `messageId` |
| `POST /shares` | `POST /v1/shares` | |
| `GET /shares/:token` | `POST /v1/shares/open` `{token}` | So the token stays out of logs |
| `POST /pending-sends` | `POST /v1/pending-sends` | `job_id` is `uploadId`, as in SCHEMA.md |
| `POST /jobs/:job_id/published` | `POST /v1/pending-sends/:uploadId/published`, `deliverPending()` for the worker | Only the sender on the route. Supabase's took the family code, so the pipeline's call must become the worker's `deliverPending()` |
| `POST /events` (signed in) | `POST /v1/events` | `start_s` is `startS` |
| `GET /favorites`, `POST /favorites` | same under `/v1` | The POST no longer returns the whole list: read `GET /v1/favorites` after it |
| `GET /me/recipe-stats` | `GET /v1/me/recipe-stats` | `{stats, nextCursor}` |
| `GET /recipes/:id/activity` | `GET /v1/dishes/:libraryId/activity` | |
| `GET /dish-stats`, `GET /hearts/recent` | same under `/v1` | `profile_id` is `personId`, `last_at` `lastAt` |
| `GET /table`, `GET /recap` | same under `/v1` | Same shapes |
| `POST /push-tokens`, `/push-tokens/remove` | same under `/v1` | Takes `tz` |
| `POST /cron/hourly` | task `messages.hourly`, on a schedule | No public route |

### Refusals

Every refusal is a code. An adapter maps each back to the sentence an old build reads.

| Status, code | Old sentence (Supabase unless marked) |
|---|---|
| 400 `body_required` | "body is required for a text message" and its like; Convex "Write something first." |
| 400 `too_long` | "body must be at most 2000 characters"; Convex "That message is too long." |
| 400 `bad_kind` | "kind must be one of …" |
| 400 `system_not_sent` | "System notes are written by homecookd, not sent" |
| 400 `library_id_required`, `bad_library_id` | "recipe_id is required for a … message", "… is not a valid recipe id" |
| 400 `step_needs_recipe` | "recipe_id and step_order are required for a step message", "step_order needs a recipe_id" |
| 400 `duration_required`, `audio_required` | "duration_s is required", "audio_path is required for a voice message" |
| 400 `audio_only_on_voice`, `photo_only_on_cooked` | "audio_path is only for voice messages and questions", "photo_path is only for cooked messages" |
| 400 `reply_not_in_thread` | "reply_to must be a message in this conversation" |
| 400 `bad_reaction`, `reaction_needs_dish` | "body must be heart or just_like_mine", "A reaction answers a dish someone made" |
| 400 `cant_message_yourself`, `pick_someone_else` | "You can't start a conversation with yourself", "Pick someone other than yourself" |
| 400 `text_has_no_file`, `photo_required` | Convex "A text message has no file.", "photo_path is required" |
| 400 `bad_rating`, `postcard_needs_dish` | "rating must be a whole number from 1 to 5", "A postcard goes on a dish you made" |
| 400 `not_about_a_recipe`, `nothing_to_save`, `cant_save_that_kind` | "That message isn't about a recipe", "There's nothing in that message to save", "That message can't be saved to a recipe" |
| 400 `heard_too_short`, `cook_not_in_family` | "duration_s must be at least 3 for heard", "cook_id must be someone in your family" |
| 400 `bad_month`, `bad_time`, `ids_required`, `bad_ids`, `too_many_ids` | "month must be YYYY-MM", "since must be an ISO time", "ids is required", "ids must be recipe ids separated by commas", "ids: at most 50" |
| 400 `bad_push_token`, `bad_platform` | "token must be an Expo push token", "platform must be ios or android" |
| 400 `answer_required` | Convex "Say or type an answer first." |
| 403 `other_left` | "Dad isn't in the family anymore." The adapter finds the name |
| 403 `not_your_dish`, `not_your_message`, `cant_take_this_out` | "Only whoever made the dish can send its postcard", "You can only save your own messages", "Only the person who answered, …" |
| 403 `not_your_recording` | New: Supabase let anyone in the family deliver |
| 403 `only_the_recipes_cook`, `forbidden` | Convex "Only the recipe's cook can answer this.", "Only the cook can do that." |
| 404 `not_found` | "No such conversation", "No such message", "That answer isn't in the recipe anymore."; Convex "That question isn't here anymore." and "They aren't in this family." A refused file also reads this way |
| 404 `no_such_recipe` | "No recipe with that id"; Convex "That recipe isn't here anymore." |
| 409 `already_answered` | Convex "That question already has an answer." |
| 409 `upload_is_someone_elses`, `already_delivered` | "That job belongs to someone else" (now also someone else in the same family), "That recipe was already delivered" |
| 409 `idempotency_conflict` | New |
| 413 `too_large`, 415 `bad_type` | Convex "That file is too big."; "content_type must be one of …" |
| 502 `storage`, `note_failed`; 503 `note_writer_not_set_up`, `library_unreachable` | New; Convex "Couldn't draft a note just now."; "The note writer isn't set up yet."; "Can't reach the family recipes right now." |

## Never losing or duplicating what someone wrote

Sending is one transaction: the idempotency key, the file's attach, the message, the thread's time, the read mark, a recipe note and the push's outbox row land together or not at all. A failure reaches the phone as an error, and its retry can't write twice.

- **The same key:** the second call gets the first message back. Two at once: the second waits on the first's commit, then does the same.
- **The same key with a different body, or on another route:** 409 `idempotency_conflict`.
- **A failed try frees its key,** because the claim is in the same transaction.
- **`idempotency_keys` holds a hash and ids,** never a body.
- **Within a thread, commit order is created_at order.** A message takes the thread's row lock, then the clock. So a poll reading "after my newest" can't miss a row that committed late. Tested with eight sends at once.

## File safety

This is DISH-MIGRATION's open question 3, decided here. `requireOwnFiles` (a route's `fileKeys`) stays the first gate: the file is this family's and uploaded. Then `attachFile`, in the row's own transaction, also requires: the file's owner is the caller when it has one, it's the right kind, and nothing holds it. Two rows can't win one file, and a family check alone would let one person's account deletion take another's message file.

Every refusal is the same 404. The only retry that re-attaches is the same photo on the same postcard. Idempotency keys cover the rest.

`messagesFiles.test.ts` runs every refusal against each of the 7 fields that attach a key, and fails if a route with a key isn't on its list. The photo note reads a key without holding it, and has its own test. `clipKey` and `/v1/uploads/confirm`'s `key` say `notFileKeys`, each with its own check and tests: a clip must be shaped like public library media and have no row in `files`; confirming goes by owner.

**The sweep:** its S3 deletes now also reach signed-in uploads in the private bucket, by `owner_person_id`. That closes part of DISH-MIGRATION's known limit. A backfilled file with no owner and no capability, or one in another bucket, still stays marked and undeleted, and AWS-MIGRATION's "Before real data" still stands. Signed-in orphans wait 24 hours, not the anonymous hour: a phone can upload a voice note and send it later, and a file swept early is a message lost.

## Pushes

`queuePush` decides inside the caller's transaction and writes the log row and an outbox row together. `push.deliver` then calls Expo with no connection held. Expo sits behind `PushSender` (`expo.ts`), and tests use a fake.

| | Supabase's kinds (`message`, `question`, `recipe`, `postcard`, `reaction`, `started`, `table_nudge`, `recap`) | Convex's kinds (`answered`, `craving`, `joined`, `filmed`) |
|---|---|---|
| Caused by a person | Never capped | |
| Sent on its own | Caps (kid 1 a day and 3 a week, cook 1 a month), skipped in quiet hours and logged | |
| A flood guard | | 20 a day, cravings 3 a day, among these kinds only |
| Quiet hours | | A craving waits them out |
| No phone | No log row | Logs `none`, which uses its key |

Quote rotation reads `push_log.quote_key` for 15 days, leaving out pushes that weren't seen. One holder sends a push (`push_log.delivering_at`), and a holder that died is taken over after 4 minutes, under SQS's visibility. So a crash after Expo took a push can send it twice, which is the one duplicate I can't rule out. Expo can't dedupe.

**The hourly job** finds families with someone due and queues one message per family. One family's trouble can't hold up another, and a failed family is retried alone. A repeat is a no-op, through dedupe keys.

## Long work

| Task | Why a repeat is safe |
|---|---|
| `messages.push`, `messages.push_postcard` | One dedupe key per message and recipient. Does nothing if the message or its sender is gone |
| `push.deliver` | A conditional claim, above |
| `push.receipts` | Clears its tickets, so a second run finds none |
| `push.dish_answered`, `dish_requested`, `dish_filmed` | The same dedupe keys as Convex's |
| `questions.translate` | Saves only where `text_for_cook` is empty |
| `questions.transcribe` | A claim (`answer_transcribing_at`), so Ink runs once. The words and what reads them land together |
| `questions.read_follow_up`, `read_share` | The read is noted once, by a conditional update |
| `story_cards.write` | Writes only while a card is due, so a repeat finds the card already matching and calls no model |
| `messages.hourly`, `nudge_family`, `recap_family` | Dedupe keys |
| `messages.daily` | Prunes old pushes and marks day-old uploads, a batch at a time |

## Story cards

`storyCards.ts`, from Convex's `storyCards.ts` and `community.shareOn`. The pure rules sit with Community's reading half in `community/storyCard.ts`, as Convex's `lib/storyCard.ts` holds both.

- **What starts one: sharing, never publishing.** On Convex every way the cook says yes runs `shareOn`: her switch (`community.setShare`), her own tap (`shareRequests.ask`) and her yes to a kid's ask (`shareRequests.settle`). It sets `shared_at` and, in the same transaction, queues the card when there's none yet or it no longer matches her answer about her stories. Here only the third is wired: `questions.read_share` reads her clear yes and `recipeEffects.shareYes` calls `shareOnYes`. The switch, her tap and the kid's ask are Community's and answer 501 or have no route (COMMUNITY-MIGRATION.md, blockers 1 and 4), so today the only share asks are ones copied from Convex.
- **What it writes:** `recipes.story_card_text`, `_written_at`, `_used_stories`, `_culture` and `_quote`, in one statement. That's Convex's `storyCard` `{text, writtenAt, usedStories, culture, quote}`, which `GET /v1/recipes/:id` and Community's feed already read. Sonnet gets Convex's prompt and facts (her name, the dish, its first three steps, her quotes by number, and her stories only after her yes), held to Convex's JSON schema. Its answer goes through Convex's checks: one sentence of at most 25 words, a culture of one to three words or none, a quote picked by number from her own, and the word filter.
- **Never half a card.** A failed call, no key, an unusable answer, a word the filter catches and a cook past her limit all give the plain line ("Rajani's Kanda Poha, from the Pawar family."), with no culture and her first quote, as on Convex. A save that fails leaves the old card as it was and fails the task, so the queue tries again.
- **Who.** There's no route. Only the recipe's own cook, answering a share ask in her family, shares it: `POST /v1/questions/:id/answer` refuses another cook or a kid (403) and another family (404). Her family reads the whole card on `GET /v1/recipes/:id`. Other families read only its words, through Community's whitelist, as before.
- **While `recipes` isn't the api's.** Both writes are in `recipes/writes.ts`, behind the switch, and do nothing unless it's open, like a stopped job's card. Locked or closed, her yes is kept on the question (`share_said`), nothing is shared or queued, and a card task already queued returns before the model, so nothing is paid for. Convex shares and writes the card meanwhile, and the sync brings both over. Answering 501, as the routes do, would send a task that isn't broken to the dead-letter queue.
- **Limits and cost.** 30 cards an hour per cook (`messages-story-card`); past that, the plain line. Each call writes `model_calls` with `purpose = 'story_card'`, its prompt version and the recipe. No daily budget, as for the area's other calls.

## What a poll reads

The live-updates draft (`claude/aws-live`) plugs in here, and I built no subscriptions.

- **Is anything new?** `GET /v1/unread`: `lastMessageAt` moves on every new message, and `total` on every unread one.
- **What's new in this thread?** `GET /v1/threads/:id/messages?after=<newest createdAt>`.
- **A postcard landing on an older card** changes that row in place, not `lastMessageAt`. `postcards` in `GET /v1/threads` is what tells a cook's Home to look again, as on Supabase.
- **Questions:** `GET /v1/questions/open`, `GET /v1/recipes/:recipeId/questions`. Each answer sets `answered_at`, and a transcript lands later, in place.

## Behavior differences

1. **Lists page.** Old lists took a fixed number and stopped. A list now keeps going with `nextCursor`.
2. **A file not uploaded, or not yours, is a 404,** where Supabase says 400 "Upload the voice note before sending it" and Convex accepted any storage id.
3. **Uploads take a confirm step, and the size up front.** Supabase's link took any size up to its limit.
4. **Read links last 1 to 2 hours,** from `storage.ts`. Supabase's lasted 1, and Convex's never expired.
5. **A retried old-build voice note whose file is already held is a 404,** where Supabase would send a second message with the same file. The fix for a new build is the key.
6. **Replacing a postcard's photo deletes the old one.** Supabase left it in the bucket for good.
7. **A push's words come off its log row once sent.** `title` and `body` were kept for 40 days on Convex's log, and Supabase's had neither. A recipient's row can quote someone who later deletes their account, and the purge can't find that row by them.
8. **Expo errors are stored with tokens scrubbed.** Expo's message can include the token.
9. **A retry on Expo:** a refused batch (429, 5xx) is tried once more after 500 ms. Neither old system retried. A timeout isn't retried, because Expo may have taken it.
10. **Two "Just like mine" at the same moment are one,** by a new unique index. Supabase could race into two.
11. **Two events at the same moment count once,** under an advisory lock. Supabase's check could let both in.
12. **A delivery is all-or-nothing.** Supabase released its claim by hand after a failure, which could leave some recipients with a copy and resend to them on retry.
13. **`POST /v1/shares/open` is rate limited** by IP (120 in 10 minutes). Supabase's wasn't.
14. **The photo note is limited** to 30 an hour per person. Convex's wasn't, and it's a paid call.
15. **Someone outside a pair gets a 404 on a postcard and on saving a note,** where Supabase's 403 said the message exists. Taking a note out (`POST /v1/notes/:id/remove`) stays a 403 for anyone who didn't answer, ask or cook the dish: a saved note belongs to the whole family, so its existence isn't private.
16. **Stats are counted in SQL,** so `/me/recipe-stats` no longer undercounts past 1000 rows, and the recap no longer pages.
17. **The table's 60-second cache of old rows is gone.** SYSTEM-DESIGN: the api keeps no state in memory, and no measurement asks for one. The library's 10-minute cache stays, because it avoids an outside call per push.
18. **A recap job with the library down fails its task,** so the queue retries it, and after 3 tries it raises the dead-letter alert. Supabase logged it and waited for the next hour. The next hour still tries here too.
19. **Claude only.** No Gemini or Muse path: translate on Opus, the yes/no on Haiku, the photo note and the story card on Sonnet. Convex's flags still choose in production today, so comparing old and new needs them set to Claude.
20. **Model calls write `model_calls`.** Ink's and the translations' costs don't count toward the dish ask's daily budget.
21. **A voice note's transcript failing is logged and read as unclear,** with no retry, as on Convex.
22. **`GET /v1/messages` shows every kind,** because the table is now shared. Nothing in the app reads it today.
23. **No `x-profile-id`.** A session is one person. See blockers.
24. **A dish's activity shows only notes and times from threads the caller is in.** Supabase showed everyone the words a cook-made note carried, even from someone else's pair, and when a recipe last went between two others. Who cooked it stays family-wide.
25. **Someone removed from the family is refused on every route with a session,** a 403 from `requireSession`, so no area can forget it. That includes `GET /v1/me`. Supabase's `GET /family` still loads for them, so the adapter's path for it (blocker 4) has to answer that itself. Their session lasts until it ends: ending it on removal is accounts' step.
26. **Only a recording's sender can change its list or deliver it.** Supabase let anyone in the family overwrite the sender and recipients with the upload id, or deliver it as the sender.
27. **A replaced hello, or one taken off, is marked for deletion in the same transaction,** under the row's lock. Supabase left it in the bucket for good. A postcard's replaced photo was already marked, and now under the message's lock, so two at once can't leave one unmarked.
28. **A push that won't go keeps no words.** `none` and `capped` rows hold no title or body, as `skipped` rows don't. Known limits covers one that's waiting.
29. **A read mark only moves forward,** so a late write can't turn read messages unread.
30. **A forged cursor is a 400 `bad_request`, as on Community** (`paging.ts`), and a forged `after` a 400 `bad_time`. Either could reach Postgres as a 500 before.
31. **Only her yes to a kid's ask starts a story card here.** Her switch and her own tap stay on Convex until Community builds them.
32. **A repeat of the card task does nothing,** because it writes only while a card is due. Convex's wrote, and paid, every time it ran.
33. **Story cards are limited** to 30 an hour per cook, then the plain line. Convex's weren't.
34. **A failed card call is logged with its error's type only,** and a missing key is logged too. Convex logged the first 200 characters of the error, and nothing without a key.
35. **A card's cost row names its recipe** (`model_calls.recipe_id`). Convex kept no cost row.

### Against SYSTEM-DESIGN.md

- **"Requests stay quick."** `POST /v1/messages/photo-note` waits on Claude in the request, because the app's contract returns the draft. No connection is held, and it has a timeout and a bounded retry. A send also waits up to 5 s for the library's "does this dish exist?", before its transaction and cached for 10 minutes, as Supabase does. An unreachable host doesn't hold up a send.
- **"Bytes never pass through the api."** `questions.transcribe` reads a voice note from S3 to hand it to Ink, in a task, as dish's does.
- **"Every outside call has a plan for when it fails."** A failed push is recorded on its row and not retried past the one try above, so a person-to-person push can be lost when Expo is down. The message itself isn't. Both old systems do the same. **Recommendation:** add an alarm on `failed` rate before launch.

## Disagreements between Convex and Supabase

| What | Convex | Supabase | Kept, and why |
|---|---|---|---|
| Who keeps a chat after a deletion | The other half stays | Both halves go | Convex's: C1 |
| Caps, a person's pushes | 20 a day | Never capped | Both, by kind: SCHEMA.md says the rules stay apart |
| No phone | Logs `none` | No row | Both, by kind |
| Removed or memorial people | Only a deleted person is skipped | Skipped | Supabase's for every kind: nobody should push the dead or the gone |
| A signed-out phone's token | No device on the token | Dropped | Supabase's for every kind |
| Tokens per person | At most 5 | No limit | Convex's for every kind |
| Dead tokens from receipts | Checked | A TODO | Convex's for every kind |
| Which clock for quiet hours and caps | The token's zone | The person's | A craving goes by the token's, then the person's, as on Convex. Caps go by the person's, then the token's, because `people.tz` can't be written here (blockers) |
| A zone with an offset, like `+05:30` | Accepted | Refused | Supabase's: Postgres reads those backwards |
| File size | 20 MB | 10 MB | 20 MB, so nothing that sends today stops |
| Writing to someone who left | Allowed unless deleted | Refused | Supabase's |
| A message to yourself | Allowed | Refused | Supabase's: a pair can't hold it. **Backfill:** old Convex rows with `to == from` have no thread, so count them first |
| Convex's route: does a text push? | No | Yes, on the thread route | It pushes on both now, and a photo pushes on neither. `TODO(caleb)`: the app only sends photos by this route, so nothing changes today |
| Is a `photo` message a postcard? | Its own kind | `cooked` with a photo | Kept apart, as SCHEMA.md says. `madeMyDish` reads `photo`, and the recap reads `cooked`. See open questions |
| Answering | Any cook, or the recipe's cook on a share or follow-up | The one asked, or any cook but the asker in the circle | Both: `questions` and chat questions stay apart, as SCHEMA.md says |
| Answered | A status on the row | Worked out from replies | Both, for the same reason |

## Blockers: what writes people, families or recipes

These tables are read-only here. Each writes nothing today, and each needs its owner.

1. **A follow-up's yes writes `recipes.addedIngredients`.** `recipeEffects.ingredientYes` runs in the settle's transaction and does nothing yet. The answer is stored either way (`follow_up_said`). **Recommendation:** the recipes area fills this in, and applies old yeses from `questions` when it moves.
2. **A share's yes runs `shareOn`, which writes `recipes.sharedAt`.** Built behind the recipes switch (Story cards, above): with writes open her yes shares the recipe and queues its card, and with them off it does nothing and her answer is kept. Community's own `shareRequests.ask` writes `questions`, so that's a table crossing to settle when both are in.
3. **`x-tz` wrote `people.tz` on every call.** It isn't stored here. `GET /v1/table` reads the header for that request, and `POST /v1/push-tokens` stores a zone on the token, which pushes read when the person has none. **Recommendation:** the accounts area takes the header. Until then a kid's stored zone can go stale.
4. **`x-profile-id` and a lent phone.** Supabase lets a phone write as a phone-less face, or read with no person at all. A session here is one person. Old builds can't go through `/v1` until the accounts step decides how an adapter speaks for them. **Recommendation:** an adapter-only path that takes a device key and a profile id, checks Supabase's owner rule, and calls these services directly.
5. **`pushEvents` and system notes have callers elsewhere.** The dish area's merge doesn't queue `push.dish_answered` yet, because a card's `person_id` is always null until the sync. `postSystemNote` and `queuePush` are ready for accounts' "Sam joined." and "joined" pushes.
6. **`POST /v1/pending-sends/:uploadId/published` is the sender's now, and the worker has no route yet.** **Recommendation:** when jobs move, the worker calls `deliverPending()` with no person.

## Account deletion

`account.ts` applies SCHEMA.md section 4 and C1 for these tables: messages, read marks, notes, questions, pending sends, shares, favorites, events, push tokens and log, retry keys, and spare uploads. Batches of 500, each its own transaction, and safe to run again. A file is marked before its row goes. The account purge calls it (`accounts/purgeSteps.ts`). These tests set the tombstone by hand; `accountDeletion.test.ts` runs the whole purge.

- `dropPushTokens` and `deleteQuestionsOnRecipes` are for the purge's at-once step: `questions` never cascades, so they must go before a recipe does.
- A pair stays, pointing at the tombstone. If nothing is left in it, it drops out of the other person's inbox. Otherwise it reads `removed: true`, and the other person can't write to it.
- Outbox rows left behind find nothing to do.
- **A story card** is columns on her recipe, so it goes with it at once (`accountDeletion.test.ts`'s kitchen holds one). A card task left behind finds no recipe, and one in the middle of its call writes nothing. Its cost row's `recipe_id` goes null.
- **`/privacy`:** still says "your one-to-one chats" go. Changing that is already on AWS-MIGRATION's "Waiting on Apple" list. No new store of family data was added. A story card's facts go to Anthropic, which `/privacy` already names, as Convex's do with `WRITER_PROVIDER=claude`.

## Tests

`cd api && TEST_DATABASE_URL=… npm test`, on real Postgres with a fake S3, library, Expo and models.

| File | What |
|---|---|
| `messagesThreads.test.ts` | Threads, kinds, reactions, reads, recipe notes, chat questions, `send-recipe`, system notes, Convex's `send`, `list`, `madeMyDish` |
| `messagesFiles.test.ts` | Attach refusals per field, uploads, the sweep's reach, a key never leaving the server |
| `messagesIdempotency.test.ts` | Retries, a different body, racing tries, a failure halfway |
| `messagesPush.test.ts` | `convex/push.test.ts`, `pushEvents`, `notify`, message pushes, postcards, Expo down, a repeat |
| `messagesQuestions.test.ts` | Flow, translation, Ink, follow-ups, share answers, the real adapters' requests against a stubbed fetch |
| `messagesActivity.test.ts` | Pending sends, shares, hearts, events, stats, the library |
| `messagesRetention.test.ts` | The history query, `GET /v1/table`, the nudge, `GET /v1/recap`, the recap push, the hourly job |
| `messagesAccount.test.ts` | Section 4 and C1 |
| `messagesStoryCards.test.ts` | Her yes shares and queues the card once, in Convex's fields, from Convex's facts; stories only after her yes; a card going plain and written again; another family, cook or kid refused; a failed or unusable answer giving the whole plain line; the limit; a failed save; the switch locked and closed; deletion; Claude's request against a stubbed fetch; the rules and prompt against Convex's |
| `messagesLogs.test.ts` | No words, tokens, names or file keys in logs, and ids only in the outbox |
| `routeCoverage.test.ts` | One table of every route the app registers, in every area: no session, expired, deleted, removed, another family, and someone outside the pair or a stated family-wide reason, then the same request working. An anonymous route says why and shows its capability refusing. A new route fails until it's added |
| `messagesCopies.test.ts` | Fails when Supabase's `time.ts`, `table.ts`, `recap.ts`, Convex's `pushWords.ts`, or a prompt or cap changes, so a fix reaches both |
| `retentionTable.test.ts`, `retentionRecap.test.ts`, `retentionRules.test.ts` | Supabase's own pure tests, run unchanged but for imports and field names |

**Changed in meaning:**
- A not-uploaded file: 400 to 404 (difference 2).
- A pair outsider on a postcard or note: 403 to 404 (difference 15).
- A self-addressed photo in the `madeMyDish` test now goes to someone else, because a pair can't hold one.
- A follow-up's yes asserts the effect ran, not `recipes.addedIngredients` (blocker 1).
- `sendExpoPush`'s failed batch now makes one more call (difference 9).

**Not carried, and why:**
- **`convex/flow.test.ts`:** the Muse path and the Gemini call shapes. This api has neither.
- **`convex/language.test.ts`:** the Gemini cases, for the same reason.
- **`convex/followUps.test.ts`:** `recipes.get` carrying the ingredient, and `homie.news` naming the follow-up (their areas). `parseRecipeJson`: the worker's area.
- **`convex/shareRequests.test.ts`:** asking, `familyDishes`, the day's wait after a no and the map: Community. Only the answering half is here.
- **`convex/community.test.ts`'s story card tests:** carried, but not Muse's request shape, since this api has no Muse. Their `setShare` steps call `shareOn()` directly, because the switch has no route yet.
- **`convex/links.test.ts`:** the end-to-end claim: needs accounts.
- **`convex/account.test.ts`:** every table outside this area, and `deleteMe` itself.
- **`supabase/tests/api_test.ts`:** sign-in, invites, devices, moves, the lander, `x-tz` storage (blocker 3), `PR 2` cooking, and `x-profile-id` cases (blocker 4).
- **`retention_test.ts`:** `runInBackground` (the outbox replaced it), `syncTz` (blocker 3), `/cron/hourly`'s secret (no public route), `buildDishStats` (SQL now; `/v1/dish-stats` carries its meaning), and "a broken database never throws" (a task now fails visibly and retries).
- **`hearts_test.ts`:** assertions on which filters a fake database saw. The behavior is carried.
- **`tablePr_test.ts`:** `parseActivity` (rows come from SQL now), the cache (difference 17).
- **`recap_route_test.ts`:** paging (difference 16) and assertions on which queries ran.
- **`table_activity_sql_test.ts`:** the SQL's security settings: there's no function now. Its row cases run against the new query.
- **`retention_migrations_sql_test.ts`, `retention_wiring_test.ts`:** Supabase's own migrations and module graph.
- **`two_sided_live.mjs`, `retention_live.mjs`:** run against a live deployment, so not run. Used as a checklist. Their chat checks are covered here, and the rest are accounts'.

## What `infra/` needs (not done: this draft touches only `api/` and `docs/build/`)

- **Settings:** `MEDIA_BASE_URL`, where public recipe media lives. Without it the library reads as unreachable: a send isn't held up, push copy says "a new recipe", a clip's link is null and `GET /v1/recap` answers 503.
- **Secrets:** `EXPO_ACCESS_TOKEN`. `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY` and `RATE_LIMIT_SALT` are already set for dish.
- **EventBridge schedules into `scheduled`:** `{"payload":{"task":"messages.hourly"}}` hourly, and `{"payload":{"task":"messages.daily"}}` daily.
- **S3:** a phone's PUT has no CORS need. A website calling these routes would.

## Before real data

Add to AWS-MIGRATION's list, as backfill counts:
- Doubles of a reaction (the new unique index).
- Convex messages with `to == from`.
- `questions.follow_up_said = 'yes'` with no matching ingredient, and share yeses, to apply when `recipes` moves.

## Known limits

- **A craving waiting out quiet hours holds the kid's name** on its queued row, up to 11 hours. It doesn't go if the kid or cook has deleted or the card is gone: `push.deliver` reads the card again, and the kid's purge clears the row's words at once. One already claimed for sending can still go, like any push in flight. A kid who only leaves the family (not deleted) still sends: the check is for deleted accounts.
- **A cook's answer to a pair question becomes a family-visible recipe note.** Caleb's call, Nov 1: it stays that way.

## Open questions

1. **One photo, two sends.** `PostcardStep` sends the postcard to Supabase and the photo with its note to Convex, two uploads into two systems. On one api, sending one key to both routes gets a 404 on the second, because a file has one holder. App 1.1 needs one upload per route, or one call that does both. **Recommendation:** one call, which also means one card per dish in the cook's chat. `TODO(caleb)`: whether the note then sits on the postcard. Old builds aren't affected.
2. **camelCase or snake_case.** I chose camelCase to match dish, which makes the adapter map Supabase's fields both ways. **Recommendation:** keep it, since the adapter goes away.
3. **A person's push when Expo is down isn't retried.** Above, under SYSTEM-DESIGN.
4. **`shares.token` is still readable,** on AWS-MIGRATION's list (M6).

## Not verified

- **Real S3, SQS, Expo, Claude, Ink, RDS or a phone.** Everything ran against fakes, on the Docker image. The Claude adapters' requests were checked against a stubbed fetch, and Ink's is dish's.
- **Load or latency.** `EXPLAIN` on 13 of the main queries with synthetic rows (300 families, 60,000 messages, 50,000 events, 20,000 pushes): all used an index. One, the push caps, chose `push_log (person_id, dedupe_key)` over the one SCHEMA.md names, and "my events" chose the dedupe index. The inbox's summary as a whole wasn't run through `EXPLAIN`, and its unread count reads a thread's unread rows.
- **The adapter.** It's a table here, not code. Nothing has called these routes as an old build would.
- **Why the end-to-end queue test failed once (`scheduled.test.ts`).** It was never reproduced. Its wait went from 2 s to 60 s because that flow came close to 2 s under load, 1.26 to 1.50 s, and that's suggestive, no more. A pass with the longer wait isn't proof of the cause, or that the loop is fast enough: the load test is still the production gate.
- **A deliberately crashed task.** Takeover and repeats are tested by running a message twice and by moving a holder's time back, not by killing a process.
- **Against Convex and Supabase side by side.** The behavior tests have the same meaning, but old and new haven't answered the same request.

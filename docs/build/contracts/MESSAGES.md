# Messages: the api contract for the app (1.1)

Nov 2, 2026. Read from `aws-migration` at `d011766dc`, and checked against staging with GET calls that change nothing. For the App screens & recording chat. This covers the family circle and one-to-one threads, messages, questions (a kid asking a cook, in chat or in cook mode, and her answer), recipe notes, "I made it", postcards and photos, voice and photo uploads, share links, story cards, recordings on their way, hearts and stats, the Sunday table and the recap, push tokens and pushes, and live updates for them. Everything in [ACCOUNTS.md, "Conventions"](ACCOUNTS.md#conventions-all-areas) applies: the address, the session (`Authorization: Bearer <sessionToken>` on every route here but `POST /v1/shares/open`), JSON bodies (`{}` when there's nothing to send), `Idempotency-Key`, paging, the one error shape ([ERROR-CODES.md](ERROR-CODES.md)), no stubs, and live polling. [JOBS.md](JOBS.md) has the recipes these hang off. Every person id is the `personId` a session returns. Fields are camelCase and times are ISO text with microseconds (`2026-11-02T18:04:05.123456Z`), except `GET /v1/table` and `GET /v1/recap`, which keep Supabase's snake_case shapes.

**Two ids for a dish.** Chat, notes, shares, hearts, events and stats take a `libraryId` (`^[a-z0-9][a-z0-9-]{0,99}$`): a public library dish's id, or a family recipe's `libraryId` (JOBS.md, "A Recipe"). Cook-mode questions, the photo note, photo messages and "made my dish" take a family recipe's `_id` from `GET /v1/recipes`, as `recipeId`.

**Two kinds of question,** kept apart on purpose (SCHEMA.md):

| | Chat questions | Cook-mode questions |
|---|---|---|
| Stored as | A message of kind `question`, or a kid's `step` message with words | A row in `questions` |
| Asked with | `POST /v1/threads/:id/messages` | `POST /v1/questions`; a share ask, `POST /v1/share-requests` (flow 8) |
| Keyed by | `libraryId` | `recipeId` |
| Who answers | In a pair, the one asked. In the circle, any cook but the asker | Any cook in the family. A share ask or a follow-up: only the recipe's cook |
| How | A reply in the thread with `replyTo`, saved as a recipe note | `POST /v1/questions/:id/answer` |
| Open list | `GET /v1/chat-questions/open` | `GET /v1/questions/open` |
| Push | To whoever can answer | None, as on Convex |

## Flows

### 1. A kid asks in cook mode, the cook answers, the kid sees it

1. The kid's phone needs the family recipe's `_id` (`GET /v1/recipes`). A library dish with no family recipe has no cook-mode questions: use chat (flow 2).
2. Ask: `POST /v1/questions {recipeId, stepOrder?, text}` with an `Idempotency-Key`, as the kid. 201 `{questionId, status: "asked_cook"}`. Text only (open item 5). Leave out `found`: it's the voice service's, for a moment the video already answers.
3. If the cook's `language` isn't English, a task adds `textForCook`, the question in her language, a few seconds later (Claude). If that fails it stays English.
4. The cook sees it in `GET /v1/questions/open`: open questions on recipes she cooked. Show `textForCook ?? text`. No push (open item 10).
5. She answers. Typed: `POST /v1/questions/:id/answer {text}`. By voice: upload the note (flow 4, `kind: "voice"`), then `{audioKey}`. With an `Idempotency-Key`. The answer is `{ok: true}`, and the question is `answered` at once.
6. A voice answer gets `answer.transcript` (Ink, in her language), and `answer.translation` (English) when her language isn't English, a few seconds later, on the same row.
7. The kid sees it in `GET /v1/recipes/:recipeId/questions`: `status: "answered"`, `answer.text` or `answerAudioUrl`, then `answer.transcript`. No push: poll while cook mode is open (open item 1).
8. A second answer is 409 `answered`.

### 2. Asking in chat

1. Open the thread: the pair with the cook (`POST /v1/threads {otherId}`) or the circle (`GET /v1/circle`).
2. Ask with `POST /v1/threads/:id/messages` and an `Idempotency-Key`. Typed: `{kind: "question", libraryId, stepOrder?, body}`. Spoken: `{kind: "question", libraryId, stepOrder?, audioKey, durationS, transcript?}`.
3. A `question` push goes to the one asked (pair), or to every cook but the asker (circle).
4. Who's waiting: the cook's `GET /v1/chat-questions/open`. Under a step in cook mode, `GET /v1/dishes/:libraryId/chat-questions`: the circle's open ones, and the kid's own in a pair.
5. The cook replies in that thread with `replyTo: <question id>`, typed or by voice. The question then reads `answeredBy` and `answeredAt`. A reply from a cook who may answer it is saved as a recipe note in the same transaction: the reply reads `savedToRecipe: true` and `noteId`. The kid gets a `message` push.
6. The kid sees the reply in the thread, and the note in `GET /v1/dishes/:libraryId/notes`, which the whole family reads.
7. Undo: `POST /v1/notes/:id/remove`, by whoever answered, asked, or cooked the dish. The reply stays in the chat but stops answering, so the question is open again. A cook can save one of her own messages by hand: `POST /v1/notes {messageId}`.

### 3. The family circle and one-to-one threads

1. `GET /v1/circle` answers `{id, kind: "circle", members}`. It's made on first use. `members` is the family now.
2. Inbox: `GET /v1/threads`. The circle comes first (first page only), then pairs that have a message, newest first.
3. A pair: `POST /v1/threads {otherId}` answers `{id, other}`. There's one per two people. It isn't in the inbox until it has a message.
4. A thread's messages: `GET /v1/threads/:id/messages` gives the newest 100, oldest first in the array.
   - Older: `?cursor=<nextCursor>`.
   - New since: `?after=<createdAt of the newest you have>`. If `nextCursor` isn't null, more than a page was waiting: page back with it, keeping `after`, until it's null.
5. Send: `POST /v1/threads/:id/messages`, with a new `Idempotency-Key` per message. The answer is the stored message: put it in place of the one on screen.
6. While a thread is on screen: `POST /v1/threads/:id/read {}`. Sending marks your own thread read. Reactions and homecookd's notes ("Sam signed in on a new phone") never count as unread.
7. The badge: `GET /v1/unread` answers `{total, lastMessageAt}`. When `lastMessageAt` moves, read the inbox again. A postcard landing on an older card moves the inbox's `postcards`, not `lastMessageAt`.
8. Someone who left: a pair with them stays readable, with `other.removed: true`, and a send is 403 `other_left`. The circle's `members` drops them. Their old messages keep `senderId`: draw them from `/family`'s `former_profiles`.

### 4. Uploading a voice note or a photo

1. `POST /v1/uploads {kind: "voice" | "photo", contentType, size}`. 201 `{key, kind, contentType, size, uploadUrl, uploadHeaders, expiresInS: 120, maxBytes: 20971520}`. `size` is the exact byte count.
2. PUT the file's exact bytes to `uploadUrl`, with exactly `uploadHeaders` (`Content-Type`), within 2 minutes. S3 checks the link when the PUT starts, and it's signed for that type and length. After a 403, start again at step 1. The unused key is deleted after 24 hours.
3. `POST /v1/uploads/confirm {key}` answers `{key, kind, contentType}`. It's required: a key that isn't confirmed is 404 wherever it's sent. Safe to repeat.
4. Send the key once, as `audioKey`, `photoKey` or `helloKey`. A key goes on one row only, so a second send with it is 404 `not_found`. The photo note reads a key without taking it.
5. A confirmed key that nothing takes within 24 hours is deleted.
6. Reading: messages, notes and answers carry `audioUrl`, `photoUrl` or `answerAudioUrl`, never a key. Each link is good for at least an hour and stays the same within the hour. Read again for fresh ones.

| `kind` | `contentType` |
|---|---|
| `voice` | `audio/m4a`, `audio/mp4`, `audio/x-m4a`, `audio/aac`, `audio/mpeg`, `audio/webm`, `audio/wav`, `audio/x-wav`, `audio/ogg` |
| `photo` | `image/jpeg`, `image/jpg` (kept as `image/jpeg`), `image/png`, `image/heic`, `image/webp` |

### 5. "I made it", the postcard and the photo note

1. "I made it": `POST /v1/events {libraryId, kind: "cooked", cookId?}`. If the dish's cook is someone else in the family: `POST /v1/threads {otherId: <cook>}`, then `POST /v1/threads/:id/messages {kind: "cooked", libraryId, body?}` with a key. Keep that message's `id`. A `cooked` message sends no push.
2. The postcard: upload the photo (flow 4), then `POST /v1/messages/:messageId/postcard {photoKey, rating?}`, with `rating` 1 to 5. The photo goes on that `cooked` message, so the cook's chat and Home keep one card per dish made. Only its sender may. Posting again replaces the photo and rating ("Take another"), and the old photo is deleted. The dish's cook gets one `postcard` push however often it's replaced.
3. The photo note, for a family recipe only: upload the photo again, as its own key (open item 3). `POST /v1/messages/photo-note {recipeId, photoKey}` answers `{draft, aiDrafted: true}`. Nothing is sent. Claude writes it while the call waits: up to 45 s a try, with one retry.
4. The kid edits the draft, then `POST /v1/messages {kind: "photo", photoKey, recipeId, to: <cook's personId>, text, aiDrafted: true}` with a key. A `photo` message sends no push.
5. The cook's "Just like mine": `POST /v1/threads/:id/messages {kind: "reaction", body: "just_like_mine", replyTo: <cooked message id>, libraryId}` with a key. One per card: a second tap returns the first. It pushes whoever made the dish. `body: "heart"` never pushes.

### 6. "Made my dish" on the cook's Home

1. `GET /v1/messages/made-my-dish` answers `{messageId, fromName, recipeTitle, libraryId, photoUrl, text, at}` or `null`.
2. It's the newest `photo` message (flow 5, step 4) from someone else, in the circle or one of her pairs, about a family recipe she cooked, from the last 14 days. It looks at the family's newest 200 messages in that time. Postcards don't count.
3. There's no live topic yet (open item 1): read it on focus.

### 7. A share link

1. `POST /v1/shares {libraryId}` answers `{token, url}`. `url` is `https://homecookd.app/r?s=<token>` (on staging, staging's own site). The same link comes back each time, until 5 people have joined through it. Then it's a new one.
2. Whoever opens it: `POST /v1/shares/open {token}`, with no session. It answers `{token, libraryId, recipeUrl, sender: {name, relation, avatarKey} | null, familyName}`. `recipeUrl` is the dish's `recipe.json`: for the family's own ready recipe, the same link as its `recipeJsonUrl` on `GET /v1/recipes/:id`; for a library dish, `<libraryId>/recipe.json`. Any bad token is 404 `not_found`.
3. Someone new joins the sharer's family by signing in with `share_token` (ACCOUNTS.md, `POST /auth/apple`): at most 5 a link, then 403 `link_full`.

### 8. A share ask and its story card

A story card is one AI sentence that introduces a shared recipe to neighbors, with a culture label and one of the cook's own quotes. The app only reads it: `storyCard: {text, writtenAt?, usedStories?, culture?, quote?}` on `GET /v1/recipes/:id` (JOBS.md). Label it AI. Sharing starts it, never publishing.

1. Anyone in the family but the recipe's cook asks: `POST /v1/share-requests {recipeId}`, on a ready family recipe. It answers `{result: "asked"}`. No key needed: asking again while it waits answers `asked` and writes nothing, so there's one open ask per dish, however many ask.
2. The ask is a cook-mode question with `kind: "share"` on her recipe, from the asker, in Convex's words (`TODO(caleb)`): "Shreya wants to put your Kanda Poha on the map for neighbors. They'd see the recipe, one line you said and homie's guess at where the dish is from, never your video. Is that okay?". If her `language` isn't English, `textForCook` follows a few seconds later, as in flow 1. It's in her `GET /v1/questions/open`, and never in `GET /v1/recipes/:recipeId/questions`. No push, as on Convex.
3. Her own tap on her own recipe is the same route: `{result: "shared"}`, on the map at once, with no question (501 `not_moved` while recipe writes are off: JOBS.md, open item 14). It's `{result: "shared"}` too, for anyone, when the dish is on the map already.
4. She answers as in flow 1, step 5. Only the recipe's cook may (403 `forbidden` for anyone else).
5. A task reads her answer (Claude Haiku), after the transcript for a voice note, against a fixed question, never the family's words. `shareDecision: {said: "yes" | "no" | "unclear", at}` lands on the question. Only a clear yes counts.
6. Her yes on a ready recipe puts it on the neighborhood map (`sharedAt`) and queues the card, unless the word filter catches the recipe.
7. A no, or an answer homie can't read, keeps it in the family, and for 24 hours from `shareDecision.at` anyone in the family who asks gets 409 `declined` ("Rajani said not now. Ask again tomorrow."). After that, asking makes a new question.
8. A task writes the card (Claude Sonnet): at most 25 words, from her name, the dish, its first three steps, her quotes, and her stories only if she opted in. A failure, no key, or a 31st card in an hour for her gives the plain line ("Rajani's Kanda Poha, from the Pawar family.").
9. Read `storyCard` on the recipe again. No push.
10. The "Share your recipe" chooser: `GET /v1/share-requests/dishes` lists the family's ready dishes with `asked` (waiting on her, or on homie reading her answer) and `notNowAt` (when homie read a no or an unclear answer; compare it with 24 hours on the phone's clock).

### 9. Push tokens, and the pushes that exist

1. After a session starts, get the Expo push token, then `POST /v1/push-tokens {token, platform: "ios" | "android", tz}` with this phone's own person's session. `tz` is the phone's IANA zone. A bad zone is dropped, not refused. Send it again on each launch: it updates in place.
2. A token belongs to one person: whoever registered it last. Don't register from a lent-phone session (Grandma on Mom's phone), or Mom's pushes move to Grandma.
3. A person keeps their newest 5 tokens. The tokens of a phone that was signed out, and ones Expo says are dead, are dropped when a push goes.
4. Sign-out: `POST /v1/push-tokens/remove {token}` first, then `POST /devices/revoke` (ACCOUNTS.md).
5. Every push carries `data: {url, kind, profile_id}`. `profile_id` is the recipient's `personId`. On a phone with more than one person, open `url` only as that person.

| `kind` | When | To | Title / body | `url` |
|---|---|---|---|---|
| `message` | A `text`, `request` or `voice` message, or a `step` with no words | Everyone else in the thread who's still in the family | The sender's name / the words, "Sent a voice note · 0:38", "Sent a clip from <dish> · 0:12", "Sent step 3 of <dish>" | `/chat/<threadId>` |
| `question` | A chat question | The one asked; in the circle, every cook but the asker | "<Name> asked about <dish>" or "<Name> asked you" / the words, or "Sent a voice question · 0:12" | `/chat/<threadId>` |
| `recipe` | A `recipe` message: send-recipe, or a delivered recording | Its recipient | "Just in from <Name>" / the dish, or "A new recipe" | `/recipe/<libraryId>` |
| `reaction` | "Just like mine" | Whoever made the dish | The name / "“Just like mine.” on your <dish>" | `/chat/<threadId>` |
| `postcard` | A postcard, once per `cooked` message | The dish's cook: the family cook named on the dish; in a pair, only the other person | "<Kid> made your <dish>" / "Sent you a postcard." | `/parent/home` |
| `table_nudge` | Sunday 17:00 to 17:59 in a kid's zone, when a pair is worth a note | The kid | The cook's name / "“<quote>” · Your week at the table is still open." | `/recipe/<libraryId>` or `/kid/home` |
| `recap` | The 1st, from 10:00 in their zone, for last month (months from 2026-11) | Anyone with a phone and a month to show | From the recap's slides | `/recap?month=YYYY-MM` |
| `answered` | Mom's version of a dish card lands (her web answers, or her voice recipe from a request), or her clips go to the kid without one | The card's kid, once they have the app | "Mom answered" / "Tap to hear how Mom makes <dish>." | `/dish/<cardId>` |
| `joined` | Someone claims a side of a dish card (`POST /v1/links/claim`) | Whoever holds the other side, in the claimer's family | To Mom: "<Kid> is on homecookd"; to the kid: "Mom joined your kitchen" / "You're in the same kitchen now." | `/dish/<cardId>` |
| `filmed` | A recipe filmed for a request card (`dishAskId` on `POST /v1/jobs`, JOBS.md) is ready | The card's kid, if they're in the recipe's family | "Mom filmed <dish>" / "Watch Mom make it." | `/recipe/<recipeId>` |
| `craving` | A kid names a dish from her craving link (`POST /dish/cards` with `cravingToken`, DISH.md flow 3) | The link's maker | "<Kid> wants your <dish>" / "Show <Kid> how you make it." | `/request/<cardId>` |

- `table_nudge` and `recap` are homecookd's own: skipped from 21:00 to 08:00 local, and capped at 1 a day and 3 a week for a kid, 1 a month for a cook. Pushes a person caused are never capped.
- No push for: `cooked` and `photo` messages, hearts, homecookd's notes, cook-mode questions and answers, and jobs (JOBS.md).
- Removed, memorial and deleted people get none.
- `answered`, `joined`, `filmed` and `craving` are Convex's kinds, in the recipient's language (13, Marathi read as Hindi): at most 20 a day to one person among them, each once by its dedupe key, and a person with no phone logs `none`. "Mom" is the card's word for her (Dad, Grandma…).
- `craving` is queued in the transaction that makes the card, once per card (`craving:<cardId>`). A kid's page is anonymous, so at most 3 a day reach her (more still list in `GET /v1/cravings`), and one waits out her quiet hours rather than being skipped. It doesn't go if the card is gone, or its kid deleted their account, before it's sent.
- The other kinds' words are English. A dish is named from its `recipe.json` title (the family's own ready recipe's file, else the library's), else the family recipe's.

### 10. Sending a recipe, and a recording on its way

1. Send a dish: `POST /v1/send-recipe {libraryId, note?, to: "everyone" | [personId, …]}` with a key. It answers `{sent: [{personId, threadId, messageId}]}`: one `recipe` message in each pair, and a `recipe` push each.
2. A recording on its way: `POST /v1/pending-sends {uploadId, recipientIds, helloKey?, helloDurationS?}` with a key (JOBS.md, flow 1, step 6). Sending again for the same `uploadId`, with a new key, replaces the list and the hello voice note.
3. Delivery is the server's: when the recipe is ready (the worker's publish, or `POST /v1/test/recipe {jobId}` on staging), each recipient still in the family gets what send-recipe sends, the `recipe` message with the dish's `libraryId`, then the hello after it, in their pair, and one `recipe` push. Once, however often the publish's message comes. Then the send is done, and registering it again is 409 `already_delivered`.
4. Registered after the recipe is out: it goes at once, and the register answers `{ok: true, delivered}`.
5. Only the recording's cook sends it. Once a job has the upload, a register by anyone else is 409 `conflict`, and a list someone else registered first never goes.
6. A recording that never finishes (stopped, failed, still processing) delivers nothing, and the send stays as it is.
7. `POST /v1/pending-sends/:uploadId/published {libraryId}`, by the sender, is still there and needn't be called: after a delivery it answers `{delivered: 0, already: true}`.

**At least once, and now and then about 5 minutes late.** The delivery rides the worker's `recipe_published` message on the `scheduled` queue, which SQS hands out at least once; a repeat delivers nothing twice (step 3). If the answer to the api's receive is lost on the way, SQS keeps that message hidden for its 300 s visibility timeout and then hands it out again, so the `recipe` message, the hello and the push arrive about 5 minutes after the recipe is ready. That happened once on Nov 2 (outbox row 267). The app shouldn't show a send as failed in that time. The api now logs each such message as "scheduled message redelivered", with how late it is.

### 11. Hearts, stats, the table and the recap

Plain reads and writes, in "Routes": `POST /v1/events` when someone opens, starts, cooks or listens to a dish; hearts with `/v1/favorites`; her dishes' hearts and cooks with `/v1/dish-stats` and `/v1/hearts/recent`; one dish's activity for the share sheet; `GET /v1/table` with `x-tz`; and `GET /v1/recap?month=`.

## Routes

Code: `api/src/modules/messages/` (`routes.ts`, and the files named per group), `api/src/idempotency.ts`, `api/src/files.ts` (the key guard), `api/src/storage.ts` (links).

**Shared codes.** Every route here can also answer: `signed_out` (401: start a session once, ACCOUNTS.md), `removed_from_family` (403: only account deletion still works), `invalid` (400 from the schema, a NUL byte, a body that isn't JSON, a bad `cursor` or `limit`; 415 for a content type that isn't JSON: fix the call), `too_large` (413: a body over 1 MB), `unavailable` (503 with `retry-after`: nothing was written, retry), `server_error` (500). The route tables list only each route's own. A field holding a key (`audioKey`, `photoKey`, `helloKey`) that isn't this person's confirmed upload is 404 `not_found`, before the route's own checks. Lists take `?limit=` up to the max shown.

**Idempotency.** The app retries a write only with the same key. The same key with the same body returns the first answer, for 7 days. The same key with another body, or on another route, is 409 `idempotency_conflict`. Keys are per person.

| Write | `Idempotency-Key` |
|---|---|
| `POST /v1/threads/:id/messages` | Required |
| `POST /v1/messages` | Required |
| `POST /v1/send-recipe` | Required |
| `POST /v1/questions` | Required |
| `POST /v1/questions/:id/answer` | Required |
| `POST /v1/pending-sends` | Required |
| `POST /v1/messages/:id/postcard` | Accepted. Without one it's still safe to repeat as sent: the same photo isn't taken twice, and the push goes once |
| Every other write here | Not read. Each is safe to repeat as sent, except that `POST /v1/uploads` makes a new key each call, and `POST /v1/messages/photo-note` drafts again and counts against its limit |

Required and missing, or malformed, is 400 `invalid` with `field: "Idempotency-Key"`.

**Limits, per person unless marked:** postcards 60 an hour (counted before the route's own checks); uploads 120 an hour; photo notes 30 an hour; push-token registers 30 an hour; story cards 30 an hour per cook, then the plain line; `POST /v1/shares/open` 120 per 10 minutes per address. Sends, reads and answers have none of their own. A `rate_limited` 429's `retry-after` runs to the end of the window.

### Threads and messages

Code: `service.ts`, `data.ts`, `threadAccess.ts`, `answers.ts`, `views.ts`.

| Route | Who | Body or query | Answer |
|---|---|---|---|
| `GET /v1/threads` | Anyone | `?cursor=&limit=` (100, max 200) | `{threads: [Thread], nextCursor}` |
| `POST /v1/threads` | Anyone | `{otherId}` | `{id, other: Person}` |
| `GET /v1/circle` | Anyone | | `{id, kind: "circle", members: [Person]}` |
| `GET /v1/unread` | Anyone | | `{total, lastMessageAt}` |
| `GET /v1/threads/:id/messages` | The circle: anyone. A pair: its two people | `?after=&cursor=&limit=` (100, max 200) | `{messages: [Message], nextCursor}`, oldest first |
| `POST /v1/threads/:id/messages` | The same | See "Sending", below | Message |
| `POST /v1/threads/:id/read` | The same | `{}` | `{ok: true}` |
| `POST /v1/messages` | Anyone | `{kind: "text" \| "voice" \| "photo", text?, audioKey?, photoKey?, to?, recipeId?, aiDrafted?}`. No `to` means the circle | Message |
| `GET /v1/messages` | Anyone | `?cursor=&limit=` | `{messages: [Message + {to, fromName}], nextCursor}`, newest first. 1.1 doesn't need it |
| `GET /v1/messages/made-my-dish` | Anyone; meant for a cook | | Flow 6, or `null` |

**Person:** `{id, name, role: "cook" | "kid", relation, avatarKey}`.

**Thread:** `{id, kind: "circle" | "pair", other, members: [Person], last: Message | null, unread, libraryId, postcards}`. For the circle, `other` is a stand-in, `{id: "family", name: "Family", role: "cook", relation: null, avatarKey: null}`. For a pair with someone who left, `other` adds `removed: true`. `libraryId` is the newest dish named in it, and `postcards` counts its `cooked` messages with a photo.

**Message:**

| Field | Meaning |
|---|---|
| `id`, `threadId`, `senderId`, `createdAt` | |
| `kind` | `text`, `voice`, `step`, `recipe`, `cooked`, `request`, `question`, `reaction`, `photo`, or `system` (homecookd's own; never sent) |
| `body` | The words; for a reaction, `heart` or `just_like_mine` |
| `libraryId`, `stepOrder` | The dish and step it's about |
| `recipeId` | A family recipe, on `photo` messages |
| `audioUrl`, `durationS`, `transcript` | A voice note's read link, or a library clip's public link, with `clipStartS`, `clipEndS` |
| `photoUrl`, `rating` | A postcard or a photo |
| `replyTo` | The message this answers |
| `aiDrafted` | The photo note's words came from Claude |
| `answeredBy`, `answeredAt` | On a question: who answered first, and when |
| `savedToRecipe`, `noteId` | On a reply: it's a recipe note, and its id for Undo |

**Sending** (`POST /v1/threads/:id/messages`):

| `kind` | Needs | May have |
|---|---|---|
| `text`, `request` | `body` | `libraryId`, `stepOrder`, `replyTo` |
| `voice` | `durationS` (over 0, at most 300), and `audioKey` or a library `clipKey` | `transcript`, `clipStartS`, `clipEndS`, `libraryId`, `stepOrder`, `replyTo` |
| `question` | `body`, or the voice fields | `libraryId` (needed with `stepOrder`), `transcript`, `replyTo` |
| `step` | `libraryId`, `stepOrder` | `body` (a kid's words make it a question) |
| `recipe` | `libraryId` | `body` |
| `cooked` | `libraryId` | `body`, `photoKey` |
| `reaction` | `body`: `heart` or `just_like_mine` | `replyTo`: a `cooked` message someone else sent. `just_like_mine` needs it |

`body` is trimmed, at most 2,000 characters. `transcript` at most 5,000. `stepOrder` 1 to 200. Clip times 0 to 86,400, with `clipEndS` after `clipStartS`. `replyTo` must be in the same thread. A `libraryId` the library says isn't there is 404 `not_found`.

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | `POST /v1/threads` | `field: "otherId"`: malformed, or yourself | A bug |
| `not_found` (404) | `POST /v1/threads` | That person isn't in the family now | Reload `/family` |
| `not_found` (404) | `/v1/threads/:id/…` | Not a thread of yours, or another family's | Drop it |
| `invalid` (400) | Sends | `field` names it: `kind`, `body` ("Write something first.", "That message is too long."), `libraryId`, `stepOrder`, `durationS`, `audioKey`, `clipKey`, `clipEndS`, `photoKey`, `replyTo`, `transcript`; on `POST /v1/messages`, `text` and `to` (yourself) | Check before sending |
| `not_found` (404) | Sends | The dish or recipe isn't there ("That recipe isn't here anymore."), `to` isn't in the family, a clip isn't public, or a file isn't usable | Drop the dish, or upload again |
| `other_left` (403) | `POST /v1/threads/:id/messages` | The pair's other person left | "<Name> isn't in the family anymore." |
| `idempotency_conflict` (409) | Sends | A reused key | A bug |
| `invalid` (400) | `GET /v1/threads/:id/messages` | `field: "after"`: not an ISO time | Send `createdAt` as it came |

### Cook-mode questions

Code: `questions.ts`, `models.ts`.

| Route | Who | Body or query | Answer |
|---|---|---|---|
| `POST /v1/questions` | Anyone in the family; meant for a kid | `{recipeId, stepOrder?, text, found?}` | 201 `{questionId, status: "asked_cook" \| "found_in_video"}` |
| `GET /v1/questions/open` | A cook; a kid gets `[]` | `?cursor=&limit=` (100, max 100) | `{questions: [Question], nextCursor}`, newest first |
| `GET /v1/recipes/:recipeId/questions` | The family | `?cursor=&limit=` (100, max 100) | `{questions: [Question], nextCursor}`, newest first, without share asks. Another family's or a missing recipe: `[]` |
| `POST /v1/questions/:id/answer` | A cook. A share ask or follow-up: the recipe's cook | `{text?, audioKey?}`, at least one | `{ok: true}` |

- `GET /v1/questions/open` reads 100 of the family's open questions a page and keeps hers, so a page can come back short with a `nextCursor`. Follow it.
- `text` is trimmed, at most 2,000 characters. `stepOrder` is a whole number. `found` is `{startS, endS, quote}`.

**Question:**

| Field | Meaning |
|---|---|
| `id`, `familyId`, `recipeId`, `recipeTitle`, `stepOrder`, `createdAt` | |
| `askedBy`, `askedByName` | `askedByName` is "homie" for a follow-up |
| `text`, `textForCook` | `textForCook` is the cook's language, once the task has run; else null |
| `kind` | `cooking`, `share` or `followUp` |
| `status` | `asked_cook`, `answered`, or `found_in_video` (the video answered it) |
| `found` | `{startS, endS, quote}` or null |
| `answer` | `{by, text, transcript, translation, at}` or null |
| `answerAudioUrl` | Her voice note's read link, or null |
| `followUp` | `{id, ingredient, said}` or null |
| `shareDecision` | `{said, at}` or null |

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | Ask | `field: "text"` ("Write something first.", "That message is too long."), `stepOrder`, `found` | Check before sending |
| `not_found` (404) | Ask | "That recipe isn't here anymore." | Drop the ask |
| `forbidden` (403) | Answer | A kid; another cook on a share ask or follow-up ("Only the recipe's cook can answer this.") | Don't offer it |
| `not_found` (404) | Answer | No such question in this family, or the voice note isn't usable | Drop it, or upload again |
| `answered` (409) | Answer | It has an answer already | "You already answered." Reload |
| `invalid` (400) | Answer | No field: "Say or type an answer first." `field: "text"`: too long | Check before sending |
| `idempotency_conflict` (409) | Both | A reused key | A bug |

### Share asks

Code: `api/src/modules/community/shareAsks.ts` (the routes, Community's), `messages/shareAsks.ts` (the ask and its question), `questions.ts` (`read_share`), `storyCards.ts`. Field names and `notNowAt` (epoch ms) are Convex's, as in the rest of Community.

| Route | Who | Body or query | Answer |
|---|---|---|---|
| `POST /v1/share-requests` | Anyone in the family. Not the cook: asks her. The cook, on her own recipe: shares it | `{recipeId}`: a ready family recipe's `_id` | `{result: "asked" \| "shared"}` |
| `GET /v1/share-requests/dishes` | Anyone in the family | `?cursor=` (100 a page) | `{dishes: [{recipeId, dish, cookName, mine, shared, takenDown, asked, notNowAt}], nextCursor}`, newest first, ready dishes only. `takenDown`: the team took it off the map after a report, so don't offer it |

- The question is a row in `questions`, so it reads as a Question (above) with `kind: "share"`, `askedBy` the asker, and `text` the words in flow 8, step 2.
- Safe to repeat as sent: an open ask answers `asked` again, and a shared dish `shared`. No `Idempotency-Key` is read.

| Code | Route | When | The app does |
|---|---|---|---|
| `not_found` (404) | Ask | "Pick one of your family's recipes.": not this family's, missing, or not ready (to its cook too) | Drop it |
| `declined` (409) | Ask | Within 24 hours of homie reading her no or unclear answer: "<Cook> said not now. Ask again tomorrow." The sentence names the cook | Say she said not now; offer it again after `notNowAt` + 24 h |
| `words` (422) | Ask, her own tap | "Some words in this recipe can't go on the map. It stays with your family." | Say so; nothing changed |
| `taken_down` (409) | Ask, her own tap | "Our team took this recipe off the map after a report. It stays with your family.": the team's review removed it (`hiddenAt`). Nobody is asked, and her yes to an older ask shares nothing | Say so; don't offer it (`takenDown`) |
| `not_moved` (501) | Ask, her own tap | Recipe writes are off: nothing is shared | Not in production 1.1 (JOBS.md, open item 14) |
| `forbidden` (403) | Answer (`POST /v1/questions/:id/answer`) | Anyone but the recipe's cook: "Only the recipe's cook can answer this." | Don't offer it |

### Chat questions and recipe notes

Code: `notes.ts`, `answers.ts`, `views.ts`.

| Route | Who | Answer |
|---|---|---|
| `GET /v1/chat-questions/open` | Anyone: the circle's open questions from others, asked since they joined; for a cook, also the ones asked of her in a pair | `[{message: Message, asker: Person, threadKind}]`, newest first, at most 50 |
| `GET /v1/dishes/:libraryId/chat-questions` | Anyone: the circle's, and their own in a pair | `[{id, threadId, threadKind, stepOrder, body, createdAt, asker: Person, mine, waitingFor: Person \| null}]`, open only, at most 50 |
| `GET /v1/dishes/:libraryId/notes` | The family | `{notes: [Note], nextCursor}`, by step, then oldest first. `?limit=` 200, max 500 |
| `POST /v1/notes {messageId}` | A cook, for her own `text`, `voice`, `step`, `recipe` or `cooked` message about a dish | Note |
| `POST /v1/notes/:id/remove {}` | Whoever answered, whoever asked, or the dish's cook | `{ok: true, answerMessageId, questionMessageId}` |

**Note:** `{id, libraryId, stepOrder, question, questionMessageId, questionAudioUrl, questionDurationS, asker: Person | null, answerText, answerAudioUrl, answerDurationS, answerMessageId, author: Person, createdAt}`.

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | The three dish routes | `field: "libraryId"` | A bug |
| `forbidden` (403) | `POST /v1/notes` | A kid, or "You can only save your own messages." | Don't offer it |
| `invalid` (400) | `POST /v1/notes` | `field: "messageId"`: malformed, the wrong kind, nothing to save, or not about a dish | Don't offer it |
| `not_found` (404) | Both writes | Gone, or in a pair you're not in | Drop it |
| `forbidden` (403) | Remove | "Only the person who answered, the person who asked, or the cook can take this out." | Don't offer it |

### Uploads

Code: `uploads.ts`, `api/src/files.ts`, `api/src/storage.ts`.

| Route | Body | Answer |
|---|---|---|
| `POST /v1/uploads` | `{kind, contentType, size}` | 201 `{key, kind, contentType, size, uploadUrl, uploadHeaders, expiresInS, maxBytes}` |
| `POST /v1/uploads/confirm` | `{key}` | `{key, kind, contentType}` |

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | Upload | `field: "kind"` or `"size"` (not a whole number over 0) | A bug |
| `bad_type` (415) | Both | A type flow 4 doesn't list; at confirm, S3 has another type (the file is deleted) | Pick another file |
| `too_large` (413) | Both | Over 20 MB (at confirm, the file is deleted) | Check before sending |
| `rate_limited` (429) | Upload | 120 an hour | Wait `retry-after` |
| `provider_down` (502) | Both | S3 couldn't sign or say | Retry |
| `not_found` (404) | Confirm | Not yours, or not in S3 yet | PUT again, then confirm |
| `invalid` (400) | Confirm | No field: S3 has an empty file (it's deleted) | Upload again |

### Postcards and the photo note

Code: `service.ts` (`postcard`, `sendToPerson`, `madeMyDish`), `photoNote.ts`, `models.ts`.

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /v1/messages/:id/postcard` | The `cooked` message's sender | `{photoKey, rating?}` | Message |
| `POST /v1/messages/photo-note` | Anyone; meant for a kid | `{recipeId, photoKey}` | `{draft, aiDrafted: true}` |

| Code | Route | When | The app does |
|---|---|---|---|
| `not_found` (404) | Postcard | No such message, or in a pair you're not in | Drop it |
| `forbidden` (403) | Postcard | "Only whoever made the dish can send its postcard." | A bug |
| `invalid` (400) | Postcard | `field: "id"` (not a `cooked` message), `photoKey`, `rating` | A bug |
| `other_left` (403) | Postcard | The pair's other person left | "<Name> isn't in the family anymore." |
| `rate_limited` (429) | Both | 60 postcards, or 30 photo notes, an hour | Wait `retry-after` |
| `not_found` (404) | Photo note | "That recipe isn't here anymore.", or the photo isn't usable | Drop it, or upload again |
| `invalid` (400) | Photo note | `field: "photoKey"` | A bug |
| `provider_down` (502) | Photo note | No read link, or Claude failed ("Couldn't draft a note just now.") | Let her write her own words |
| `not_set_up` (503) | Photo note | "The note writer isn't set up yet." (no model key: staging today) | Let her write her own words |

### Share links, sending a recipe, recordings on their way

Code: `activity.ts`, `service.ts` (`sendRecipe`, `deliverRecipe`), `published.ts` (delivery on the recipe's publish), `api/src/sealed.ts`.

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /v1/shares` | Anyone | `{libraryId}` | `{token, url}` |
| `POST /v1/shares/open` | **Public**, no session | `{token}`: 10 letters and digits | `{token, libraryId, recipeUrl, sender, familyName}` |
| `POST /v1/send-recipe` | Anyone | `{libraryId, note?, to}`: `"everyone"`, or 1 to 30 `personId`s | `{sent: [{personId, threadId, messageId}]}` |
| `POST /v1/pending-sends` | The sender | `{uploadId, recipientIds, helloKey?, helloDurationS?}`: 1 to 30 people, the hello at most 300 s | `{ok: true}`, or `{ok: true, delivered}` |
| `POST /v1/pending-sends/:uploadId/published` | The sender | `{libraryId}` | `{delivered, already?}` |

| Code | Route | When | The app does |
|---|---|---|---|
| `invalid` (400) | All but open | `field`: `libraryId`, `note`, `to` (none left once you're taken out), `uploadId`, `recipientIds`, `helloDurationS` | A bug |
| `not_found` (404) | All | A dish that isn't there; someone not in the family; the hello not usable; on open, any bad token | Drop it. On open: "This link doesn't work anymore." |
| `rate_limited` (429) | Open | 120 per 10 minutes per address | Wait `retry-after` |
| `conflict` (409) | Pending send | That `uploadId` is someone else's: another person's list, or another cook's recording | A bug |
| `already_delivered` (409) | Pending send | "That recipe was already delivered." | Stop |
| `forbidden` (403) | Published | "Only whoever recorded this can send it." | A bug |
| `idempotency_conflict` (409) | Keyed writes | A reused key | A bug |

### Hearts, events, stats, the table and the recap

Code: `activity.ts`, `retention.ts`, `table.ts`, `recap.ts`. "My dishes" are the library's entries whose `cook_name` is my name.

| Route | Body or query | Answer | Own codes |
|---|---|---|---|
| `POST /v1/events` | `{libraryId, kind: "viewed" \| "cooked" \| "started" \| "heard", cookId?, durationS?, startS?}`. `heard` needs `durationS` of 3 or more | `{ok: true, counted}`. A repeat within 30 min (viewed), 60 s (cooked, started) or 5 s (the same clip) isn't counted | `invalid` (`libraryId`, `kind`, `cookId`, `durationS`, `startS`); `not_found` (the dish) |
| `GET /v1/favorites` | `?cursor=&limit=` (200, max 1000) | `{libraryIds, nextCursor}`, newest first | |
| `POST /v1/favorites` | `{libraryId, on: boolean}` | `{ok: true, libraryId, on}`. Read the list again after | `invalid` (`libraryId`, `on`); `not_found` (the dish, when `on`) |
| `GET /v1/me/recipe-stats` | `?cursor=&limit=` (200, max 500) | `{stats: [{libraryId, views, lastViewedAt, cooked, lastCookedAt, favorited, favoritedAt, sentToMeAt}], nextCursor}` | |
| `GET /v1/dish-stats` | `?ids=a,b` (1 to 50) | `{<libraryId>: {hearts: {count, by: [{personId, at}]}, cooked: {count, by: [{personId, count, lastAt}]}}}`, only my dishes, others in the family only | `invalid` (`ids`) |
| `GET /v1/hearts/recent` | `?since=<ISO>` (default 14 days, at most 30 back) | `[{personId, libraryId, at}]`, at most 20 | `invalid` (`since`) |
| `GET /v1/dishes/:libraryId/activity` | | `{cooked: [{person, at, note}], viewed: [{person, count}], lastSentAt}`. Notes and times only from threads you're in | `invalid` (`libraryId`) |
| `GET /v1/table` | header `x-tz` | Supabase's shape: `{week_start, people, pairs, recordings}` | |
| `GET /v1/recap` | `?month=YYYY-MM` (default last month) | Supabase's shape: `{empty: true}` or `{month, role: "cook" \| "learner", slides}` | `invalid` (`month`); `provider_down` (503, "Can't reach the family recipes right now."): keep the Home card, try later |

### Push tokens

Code: `pushTokens.ts`, `push.ts`, `pushRules.ts`, `pushData.ts`, `pushEvents.ts` (`answered`, `craving`, `filmed`, `joined`), `expo.ts`, `tasks.ts`.

| Route | Body | Answer | Own codes |
|---|---|---|---|
| `POST /v1/push-tokens` | `{token, platform: "ios" \| "android", tz?}`. `token` is `ExpoPushToken[…]` or `ExponentPushToken[…]` | `{ok: true}` | `invalid` (`token`, `platform`): a bug; `rate_limited` (30 an hour) |
| `POST /v1/push-tokens/remove` | `{token}` | `{ok: true}`, also when it wasn't there | `invalid` (`token`) |

## Live topics

`GET /v1/live/<topic>?since=` works as in ACCOUNTS.md, "Live updates". **The only topic in code is `jobs` (JOBS.md).** `api/src/modules/live/routes.ts`'s `topics` has one line. On staging, `/v1/live/questions:forRecipe`, `/v1/live/questions:openForCook`, `/v1/live/messages` and `/v1/live/circle` answer 404 `no_route` (Nov 2).

| What the app needs | Plan (LIVE-UPDATES.md) | In code | Until it's built, read |
|---|---|---|---|
| `questions:forRecipe`, cook mode | 10 s on that screen | No (open item 1) | `GET /v1/recipes/:recipeId/questions` |
| `questions:openForCook`, cook Home | 30 s | No (open item 1) | `GET /v1/questions/open` |
| `messages:madeMyDish`, cook Home | Focus, 60 s | No (open item 1) | `GET /v1/messages/made-my-dish` |
| The circle, the inbox, unread, a thread | Unread and the inbox as plain topics; a thread taking `since` as its `after` cursor | No (open item 2) | `GET /v1/unread`, `GET /v1/threads`, `GET /v1/threads/:id/messages?after=` |

The plain reads have no `version` or `pollAfterMs`, and no limit of their own. The app polls Supabase this way today: 3 s in an open thread, 8 s for the inbox and open questions, 30 s for a dish's chat questions (`app/src/lib/messaging.ts`).

## What the app calls today, and what replaces it

From APP-BACKEND-INVENTORY.md on `main` (`b16061e06`): its "Messages, questions and media", the question rows of "Kid cooking", the stats and share rows of "Recipes and library", the push and share rows of "Sign-in, people and family", and "Table and recap", checked against `app/src/lib/messaging.ts` and `app/src/lib/live/` on `main`. Field renames for every Supabase body: `recipe_id` is `libraryId`, `step_order` `stepOrder`, `audio_path` `audioKey`, `audio_url` `clipKey` (with no host), `photo_path` `photoKey`, `reply_to` `replyTo`, `duration_s` `durationS`, `profile_id` `personId`, `other_id` `otherId`, `message_id` `messageId`, `last_at` `lastAt`, `start_s` `startS`.

| Today | App wrapper | 1.1 |
|---|---|---|
| Supabase `GET /threads` | `messaging.ts:loadThreads` | `GET /v1/threads`: `{threads, nextCursor}`, not an array. Read every page |
| Supabase `POST /threads` | `messaging.ts:openChatWith`, `cookingApi.ts:threadWith` | `POST /v1/threads {otherId}` |
| Supabase `GET /circle` | `messaging.ts:openCircle` | `GET /v1/circle` |
| Supabase `GET /threads/:id/messages` | `messaging.ts:fetchNew`, `fetchAll`; `cookingApi.ts:heartFetcher` | `GET /v1/threads/:id/messages?after=`: 100 a page, where it was 500. A poll with more than a page waiting follows `nextCursor` back |
| Supabase `POST /threads/:id/messages` | `messaging.ts:deliver`, `cooked`, `sendPostcard`, `sendJustLikeMine`, `sendVoiceReply`, `sendVoiceQuestion`, `request`; `cookingApi.ts:sendHeart` | `POST /v1/threads/:id/messages`, with an `Idempotency-Key` now |
| Supabase `POST /threads/:id/read` | `messaging.ts:markRead` | `POST /v1/threads/:id/read {}` |
| Supabase `GET /unread` (defined, never called) | `api.ts:unread` | `GET /v1/unread`, which adds `lastMessageAt` |
| Supabase `GET /questions/open` | `messaging.ts:loadOpen` | `GET /v1/chat-questions/open` |
| Supabase `GET /recipes/:id/questions` | `messaging.ts:useRecipeQuestions` | `GET /v1/dishes/:libraryId/chat-questions` |
| Supabase `GET /recipes/:id/notes` | `messaging.ts:loadNotes` | `GET /v1/dishes/:libraryId/notes`: `{notes, nextCursor}` |
| Supabase `POST /recipe-notes` | `messaging.ts:saveToRecipe` | `POST /v1/notes {messageId}` |
| Supabase `POST /recipe-notes/:id/remove` | `messaging.ts:removeNote` | `POST /v1/notes/:id/remove {}` |
| Supabase `POST /messages/:id/postcard` | `messaging.ts:sendPostcard` | `POST /v1/messages/:id/postcard {photoKey, rating?}` |
| Supabase `POST /voice-upload` | `voice.ts:uploadVoice` | `POST /v1/uploads {kind: "voice", contentType, size}`, the PUT, then `POST /v1/uploads/confirm`. The exact `size` is required now |
| Supabase `POST /photo-upload` | `photos.ts:uploadPhoto` | The same, with `kind: "photo"` |
| Convex `files:uploadUrl` (answers, photo notes) | `convex.ts:uploadFile` | The same three steps. The key goes in `audioKey` or `photoKey`, where Convex took a storage id |
| Convex `questions:openForCook` | `convex.ts:useCookQuestions` | `GET /v1/questions/open`: `{questions, nextCursor}`. `_id` is `id` and times are ISO. **No live topic yet** (open item 1) |
| Convex `questions:answer` | `convex.ts:answerQuestion` | `POST /v1/questions/:id/answer {text}` or `{audioKey}`, with an `Idempotency-Key` |
| Convex `questions:forRecipe` | `answers.ts:useRecipeAnswers` | `GET /v1/recipes/:recipeId/questions`, by the family recipe's `_id`. **No live topic yet** (open item 1) |
| Convex `/voice/question`, from the voice service's `/cook` socket | `voice.ts:useVoiceCooking` (only when `HOMIE_ON`) | `POST /v1/questions`, with the kid's session. The voice service isn't moved (JOBS.md), so in 1.1 the app would call it itself (open item 5) |
| Convex `messages:madeMyDish` | `convex.ts:useMadeMyDish` | `GET /v1/messages/made-my-dish`. `at` is ISO text, not ms. `libraryId` and `text` may be null. **No live topic yet** (open item 1) |
| Convex `messages:sharePhoto` | `convex.ts:sharePhoto` | `POST /v1/messages/photo-note {recipeId, photoKey}` |
| Convex `messages:send` | `convex.ts:sendPhoto` | `POST /v1/messages {kind: "photo", photoKey, recipeId, to, text, aiDrafted}`, with a key. Not with the postcard's key (open item 3) |
| Convex `messages:list` | `convex.ts:convexPersonIdByName` | Gone in 1.1: one id, so no name matching (ACCOUNTS.md) |
| Supabase `POST /send-recipe` | `sendRecipe.ts:sendRecipes`, `messaging.ts:sendRecipe` | `POST /v1/send-recipe`, with a key. `sent` lists `personId`, `threadId`, `messageId` |
| Supabase `POST /shares` | `shareLink.ts:getShareLink` | `POST /v1/shares {libraryId}` |
| Supabase `GET /shares/:id` | `handoff.ts:peekShare` | `POST /v1/shares/open {token}`, public: the token stays out of logs |
| Supabase `POST /pending-sends` | `uploads.ts:ensurePendingSend` | `POST /v1/pending-sends`, with a key. `job_id` is `uploadId` |
| Supabase `POST /jobs/:job_id/published` (defined, never called) | `api.ts:jobPublished` | Not needed: the recipe's publish delivers it (flow 10). `POST /v1/pending-sends/:uploadId/published {libraryId}` stays, the sender only |
| Supabase `POST /events` | `messaging.ts:cooked`, `logViewed` | `POST /v1/events` |
| Supabase `GET /favorites`, `POST /favorites` | `favorites.ts:load`, `send` | `GET /v1/favorites`: `{libraryIds, nextCursor}`. `POST /v1/favorites` no longer returns the list |
| Supabase `GET /me/recipe-stats` | `stats.ts:load` | `GET /v1/me/recipe-stats`: `{stats, nextCursor}` |
| Supabase `GET /recipes/:id/activity` | `ShareSheet.tsx:ShareBody` | `GET /v1/dishes/:libraryId/activity` |
| Supabase `GET /dish-stats?ids=` | `dishStatsApi.ts:fetchDishStats` | `GET /v1/dish-stats?ids=` |
| Supabase `GET /hearts/recent` | `dishStatsApi.ts:fetchHeartsRecent` | `GET /v1/hearts/recent` |
| Supabase `GET /table` | `tableApi.ts:refreshTable` | `GET /v1/table`, the same shape, with `x-tz` |
| Supabase `GET /recap?month=` | `recapApi.ts:recapApi.get` | `GET /v1/recap?month=`, the same shape |
| Supabase `POST /push-tokens` | `_layout.tsx:registerPush` | `POST /v1/push-tokens {token, platform, tz}`. `tz` in the body is new |
| Supabase `POST /push-tokens/remove` | `session.tsx:SessionProvider` | `POST /v1/push-tokens/remove {token}` |
| Convex `push:register`, `push:unregister` | `pushTokens.ts:convexPush` | Gone in 1.1: one token route serves every kind of push |
| Convex `shareRequests:ask` | `community.ts:askToShare` | `POST /v1/share-requests {recipeId}`: `{result: "asked" | "shared"}` where Convex returned the word. A no within the day is 409 `declined`, where Convex threw its sentence |
| Convex `shareRequests:familyDishes` | `community.ts:useFamilyDishes` | `GET /v1/share-requests/dishes`: `{dishes, nextCursor}`, not an array. Read every page. No live topic: read it on focus |
| Supabase `POST /cooking`, `GET /cooking`, `POST /cooking/end`, `/profile/share-cooking` | `cookingApi.ts` | **Not built** (JOBS.md, open item 12) |

## Staging testing

`https://d2zh46br3dalyf.cloudfront.net`, signing in as in ACCOUNTS.md, "Staging testing". Checked Nov 2 with no session: `/health` answers `ok`, `/ready` `{"database":"ok"}`, every GET route in this doc answers 401 `signed_out` (so they're deployed), and the four topic names above answer 404 `no_route`. The POST routes weren't called.

**What works:** threads, the circle, every message kind, read marks, chat questions and notes, uploads to staging's real S3 `private` bucket, postcards, reactions, send-recipe, share links, events, hearts, push tokens. This area's tasks (pushes, transcripts, translations, the hourly and daily schedules) run on the `scheduled` queue inside the api's own tasks (`api/src/scheduled.ts`), not the worker, so they run on staging.

**What's different there**, from `infra/envs/staging/main.tf`:

| Setting | Effect |
|---|---|
| No `EXPO_ACCESS_TOKEN` | The api calls Expo with no token. This project's Expo needs none (V2-LINKING.md: Supabase's live pushes go without one), so staging's pushes should reach a real phone whose token was registered on staging. Not tried |
| No `ANTHROPIC_API_KEY` on the api, unless a `real_ai` window | The photo note is 503 `not_set_up`. `textForCook` never lands, so the cook reads English. A share answer reads "unclear". A story card would be the plain line |
| `DISH_FAKE_AI=1` | A voice answer's `answer.transcript` is the fake "Two big spoons of ketchup." (empty under 100 bytes). For a cook whose language isn't English, `answer.translation` is "(English) " and her words |
| `worker` `desired_count = 0` | No recipe is ever `ready` (JOBS.md) but through `POST /v1/test/recipe`, and a kid's `GET /v1/recipes` is `[]` until then. A pending send goes when the test recipe finishes its job |
| `RECIPE_WRITES=on` (#300) | A cook's `POST /v1/jobs` makes a "processing" card with a `recipeId`, and `POST /v1/test/recipe` (#303) makes or finishes a ready one |
| `MEDIA_BASE_URL` is staging's own media host, with no `library.json` and no library recipes (JOBS.md, open item 15) | `dish-stats` and `hearts/recent` answer empty. `GET /v1/recap?month=2026-11` answers 503 `provider_down`; any earlier month is `{empty: true}`. A test recipe from `POST /v1/test/recipe` is read from its own `recipe.json`, so its pushes name it, its postcard finds its cook, and its cook can take out a note. Any other dish: push copy says "A new recipe", a postcard in the circle finds no cook to push (in a pair it goes to the other person if they're a cook), and its cook can't take out a note by being its cook |
| The `private` bucket's CORS allows PUTs only from staging's web site and `localhost:3105` | Voice notes and photos upload from an iPhone build only, not the app's web build on 8081 to 8083 |
| CloudFront in front | Every tester shares one address, so `POST /v1/shares/open`'s 120 per 10 minutes is shared too |
| `OVERLOAD_SHED=on`, a small api task | Some 503 `unavailable` under load |

**Testing without the missing parts:**
- **Cook-mode questions and photo messages need a ready family recipe.** Make one with `POST /v1/test/recipe` (JOBS.md, "Staging testing"; staging only, #303), with or without a `jobId`. Since #305 a recipe that isn't ready reads as missing to everyone but its cook, and cook mode, the photo note and a photo message need it ready even from her.
- **Library dishes:** since #305 a `libraryId` must exist: the family's own ready recipe (found by its row), or a file on the media host. Staging's media host has no library recipes, so on staging use the `libraryId` of a test recipe from `POST /v1/test/recipe`; anything else is 404 `not_found`.
- **Pushes:** use a TestFlight or dev build, register its token with `POST /v1/push-tokens`, and send from a second test person. Expect English words, and a test recipe's own title for its dish name. `joined`: claim a test card's two sides as two test people. `filmed`: make a job with `dishAskId` for a card asked of the cook, then `POST /v1/test/recipe {jobId}`.
- **Models:** the photo note, the cook's translation and the share reading need a `real_ai` window, with Caleb's OK, since it costs money.
- **Pending sends:** make a job (JOBS.md, flow 1), register a send for its `uploadId`, then `POST /v1/test/recipe {jobId}`: the recipients' pairs get the recipe and the hello within seconds.
- **Share asks:** without a `real_ai` window every answer reads `unclear`, so after one answer that dish's asks are held off for 24 hours (409 `declined`). To ask again sooner on staging, use another test recipe.
- **The nudge and the recap** go only to people with a registered token: a kid with a pair worth a note gets the nudge Sunday at 17:00 in their zone; the first recap push would be Dec 1, for November, and needs the library.

## Open items

Owners: **API** is the AWS backend chat, **App** is App screens & recording, **Caleb** is a decision only he makes.

1. The live topics `questions:forRecipe` (10 s, cook mode), `questions:openForCook` (30 s, cook Home) and `messages:madeMyDish` aren't built: `/v1/live/` serves only `jobs`, so until they are the app polls the plain reads. **API**
2. No live topic covers the circle, the inbox, unread or a thread, which LIVE-UPDATES.md plans as plain topics with an `after` cursor, so chat polls `GET /v1/unread`, `GET /v1/threads` and `GET /v1/threads/:id/messages?after=` as it polls Supabase today. **API**
3. One photo can't go on both the postcard and the `photo` message, because a file has one holder and the second send is 404, and "made my dish" reads only `photo` messages: decide between two uploads per photo and one call that does both (MESSAGES-MIGRATION.md, open question 1, recommends one call). **Caleb**, then API or App
4. ~~Nothing on AWS made a share ask or translated a follow-up question.~~ **Fixed in #311:** `POST /v1/share-requests` asks the cook, or shares her own dish (flow 8), and only the recipe's cook answers. Her yes shares it and queues the story card. A no holds asks off for 24 hours (409 `declined`), and there's one open ask per dish (a unique index). The worker's publish writes the follow-up questions, and its `recipe_published` message now has them translated into her language. **API**
5. `POST /v1/questions` takes only `text`, so a kid's spoken cook-mode question needs the phone's own speech-to-text, the chat path (a `question` message with `audioKey`), or a voice field API would add: say which. **App**
6. ~~The `answered`, `craving`, `filmed` and `joined` pushes had words and handlers but nothing on AWS sent them.~~ **Fixed in #311** for three, as on Convex (flow 9): the dish merge queues `answered` with her version, or when her clips go without one; a claim queues `joined` in its own transaction; and a job made for a request card (`dishAskId`, new on `POST /v1/jobs`) queues `filmed` when its recipe is ready, never before. **Fixed in #321** for `craving`: queued in the transaction of a card made from her craving link (`dish/service.ts` `createCard`, DISH.md open item 3), once per card. The app sends `dishAskId` from `record.tsx` when filming from a request. Cook-mode questions and answers still push nothing, as on Convex (open item 10). **API**, then **App** for `dishAskId`
7. ~~`library().exists` counted only a 404 as missing.~~ **Fixed in #305:** S3's 403 behind the CDN reads as missing, so a made-up `libraryId` is 404 `not_found` on sends, send-recipe, shares, hearts and events; a 5xx or no answer still can't say, isn't cached, and doesn't hold up a send; the family's own ready recipe is found by its row first. **API**
8. ~~Routes took another cook's processing recipe by id.~~ **Fixed in #305:** every route that takes a recipe id goes through one rule: to anyone but its cook, a recipe that isn't ready reads as a missing id (Caleb, Nov 1). Cook-mode ask, the photo note and `POST /v1/messages` with `recipeId` need it ready, from its cook too. **API**
9. ~~Nothing delivered a pending send when a recipe was done.~~ **Fixed in #311:** the worker's `recipe_published` message delivers it (`messages/published.ts`), and so does `POST /v1/test/recipe {jobId}`: what send-recipe sends, to each recipient once, the send marked delivered and tied to its job. A register after the publish delivers at once, from the jobs table, where it read the old signer's job file. Only the recording's cook's list goes (flow 10). **API**
10. Neither a cook-mode question nor its answer sends a push, as on Convex, so the cook learns of it only on Home and the kid only in cook mode: say whether 1.1 wants those pushes. **Caleb**
11. MESSAGES-MIGRATION.md, LIVE-UPDATES.md and a comment in `messages/routes.ts` disagree with the code in places (which writes honor a key, `askFollowUps` and `postSystemNote` callers, the infra still needed, `live_off` meaning "back to Convex"): bring them up to date. **API**

12. ~~`POST /v1/shares/open` built `recipeUrl` as `<libraryId>/recipe.json`, and push titles read the same path.~~ **Fixed in #309:** one helper, `recipeJsonKey` in `api/src/modules/recipes/read.ts`, says where a dish's `recipe.json` is: the family's ready recipe's own key, linked as `GET /v1/recipes/:id` links `recipeJsonUrl`, else `<libraryId>/recipe.json`. A share's `recipeUrl`, push titles, the postcard's and "Just like mine"'s dish and cook, taking a note out as the dish's cook, and the Sunday nudge's quotes use it. A recipe that isn't ready is never used: a share of one that stops being ready opens at `<libraryId>/recipe.json`, which the CDN answers 403. **API**
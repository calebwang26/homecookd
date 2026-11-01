# The kid's web flow on the new api

Step 5 of `docs/build/AWS-MIGRATION.md`, Oct 31, 2026. A draft on `aws-migration`: nothing live points at it. The code is `api/src/modules/dish/`, and it's the template for later areas: routes check the input, the service holds the rules, `data.ts` holds the SQL and lists each query with its index.

## Routes

**Moved, same path, shapes, statuses and sentences:** `POST /dish/cards`, `/cards/get`, `/cards/update`, `/cards/ask`, `/cards/sent`, `/ask/peek`, `/ask/finish`, and `OPTIONS /dish/*`.

**Moved, changed so bytes skip the api (see Open questions, 1):**

| Route | Today | Here |
|---|---|---|
| `POST /dish/files?kind=` | the raw file; 201 `{fileId, kind, contentType, size}` | JSON `{contentType, size}`; 201 with those fields plus `uploadUrl`, `uploadHeaders`, `expiresInS` |
| `POST /dish/files/confirm` | none | New. `{fileId}`; 201 `{fileId, kind, contentType, size}`, once S3 has the bytes |
| `POST /dish/ask/answer/upload?q=&lang=&durationS=` | none | New. JSON `{askToken, contentType, size}`; 201 with an upload link. Runs every check the old route ran before storing, and takes the rate limit |
| `POST /dish/ask/answer?q=&lang=&durationS=` | `X-Dish-Token`, the raw audio; `{ask}` | Same query and reply. The body is JSON `{askToken, fileId}`. Both routes still take the token in `X-Dish-Token`, but the site doesn't send it |

**Deferred: they need `people` and `families`, so they wait for the one-way sync (SCHEMA.md, M1):**
- `POST /dish/craving/peek` answers the catch-all 404 for now. It needs her first name and relation.
- `cravingToken` on `POST /dish/cards` answers 404. Making a plain card instead would quietly not reach her.
- Claiming a card, `dishAsks.forMe` and `get`. The signed-in `cravings.*` functions, `sendVoiceRecipe` and `setFilmingDay` are now built: `COMMUNITY-MIGRATION.md`.
- `pushEvents.requested` and `answered`. `answered` does nothing without a `personId`, which is always null here.
- `dish_asks.person_id`, `family_id` and `requested_of` stay null.

## Anonymous file safety

There's no session, so `fileKeys` can't apply. `fileId` is a capability, stored only as `files.capability_hash`. Routes declare `fileId`, `photos` and `voiceNote` in `notFileKeys`, and `uploads.ts` is their guard. `looksLikeFileKey` now also catches photo, voice note, clip and audio names, which it missed. `dishFiles.test.ts` fails if a new exempt field has no check.

- A file held by a card or a dish answer is refused, including on another card. The claim is one conditional `UPDATE`, so two cards racing for a file can't both win.
- A clip's link names its card from the start (`files.ask_id`), so it can't land on another card or be used by a kid.
- The same caller's retry of the same attach succeeds and changes nothing, even after Send. Two at once stay one attach, one answer and one hearing, because the second waits on the card's row lock. This holds for `voiceNote` on `cards/update` and `fileId` on `ask/answer`. **It can't hold for `POST /dish/cards`** (Open questions, 2).
- Anything else gets one 404 with the same bytes: a guess, someone else's file, not uploaded, deleted, being deleted, the wrong kind. A malformed id stays a 400, because it says nothing about any file.
- Tokens are looked up by sha256, so a lookup's timing says nothing about the token, and no route compares a raw token.
- Files can pair with the session guard once a card is claimed: the claim sets `files.family_id`, and then `requireOwnFiles` covers them.

## Behavior differences

1. Uploads and Mom's answers take the steps above.
2. A raw file at either route is refused unread: 415 `bad_type`.
3. `photoUrls`, `kidVoiceUrl` and `audioUrl` are signed links good for 1 to 2 hours. Convex's never expired. Each stays the same for its hour, so Mom's 2-second polling doesn't change it.
4. **A file of the wrong kind is a 404, where Convex says 400** ("photos must be photos"), under the rule that every refusal reads the same. The site never sends the wrong kind.
5. Attaching the same `voiceNote` twice is 200 with no change, where Convex says 404.
6. Rate limits count an answer at its upload link, so `/dish/ask/answer` itself has only the bad-token limit. 30 answers in 10 minutes still holds.
7. S3 failing is a new 502 `storage`. The site reads it as "busy", as it does `model`.
8. Craving routes, as above.
9. No `DISH_IP_SALT` fallback: without `RATE_LIMIT_SALT` a route fails loudly. The IP comes from `req.ip`. Old `ip_key` values can't match new ones, and nothing compares them.
10. Responses add `x-request-id` and, on a 429, `retry-after`.
11. Other methods under `/dish/` get a JSON 404 here, not Convex's router 404.
12. Logs no longer hold the model's rejected text, dropped lines or a long card's time. Each call now writes `model_calls`.
13. A failed budget alert is retried by the queue, where Convex logged it and moved on.
14. `DISH_FAKE_AI` is ignored when `DEPLOY_ENV` is `production`.
15. A deleted file's row stays a week after S3's delete; Convex removed it at once.
16. **The sweep.** Convex took 200 orphans a run and scheduled itself again when a batch was full. Here one message works through batches for up to 60 s, then queues itself, and a file that was on a card is deleted before any orphan. It reaches only the private bucket's anonymous uploads (Known limits).
17. **One clip, one hearing.** On Convex a hear and a merge at the same moment could both pay for a clip, and the later one's words replaced the earlier's. Here one holder hears a clip and the first words saved stay. A merge that finds a clip being heard gives its try back and looks again in 10 s, up to 130 s if the holder died.
18. A merge try stops hearing after 45 s and queues itself, keeping what it heard. Convex ran on past its 3-minute mark.
19. A read link that can't be made comes back as `null`, or is left out of `photoUrls`, and goes to Sentry. Both shapes already existed for a missing file. The page still answers, so `POST /dish/cards` can't lose a card this way.
20. A translation is saved only if the card still says what was translated. Convex saved it whatever had changed.

### Against SYSTEM-DESIGN.md

- **"Requests stay quick."** `POST /dish/cards` and `/ask/peek` with a new language wait on models in the request, because the site's contract returns the result. No database connection is held meanwhile, and each call has a timeout and a bounded retry. Moving them to a queue needs a site change. It's worth doing after the move, not during it.
- **"Bytes never pass through the api."** Holds for phones. The api does read a kid's photos and clips from S3 to hand them to Claude and Ink, up to 15 MB in memory for one card. A presigned URL to Claude could replace the photos' read, but it's a behavior change I didn't test.
- **"Version the api."** `/dish/*` stays unversioned, so the site needs only a URL change.
- **"Writes from a phone take an idempotency key."** The site sends none. Attaches are safe to repeat without one; a retried card isn't (Open questions, 2).

## Tests

`cd api && TEST_DATABASE_URL=… npm test`, on real Postgres with fake models and a fake S3.

| File | What |
|---|---|
| `dish.test.ts` | `convex/dishAsks.test.ts`, except deletion |
| `dishAccount.test.ts` | Its 3 deletion tests, with C3 and C4 |
| `dishFiles.test.ts` | Capability safety, and one test per attach rule |
| `dishModel.test.ts` | `convex/dishAskModel.test.ts`, all 20, against a stubbed fetch |
| `scheduled.test.ts` | The queue consumer, repeats, one holder per clip (Ink held open, so the overlap is forced), a try's limits, the sweep's reach and speed, the budget under concurrency |
| `storage.test.ts` | The real S3 adapter's signing, with no network |
| `dishWebClient.test.ts` | The site's own `web/src/lib/dish/api.ts` with `NEXT_PUBLIC_DISH_UPLOADS=links`, unchanged but for its base URL, over a local port: uploads and an answer end to end, with PUTs routed to the fake store, and a failed PUT reading as `busy` |
| `dishCopies.test.ts` | Fails when Convex's recipe code, prompts or word list change, so a fix reaches both |

**Carried over:** 41 of 41 from `dishAsks.test.ts` and 20 of 20 from `dishAskModel.test.ts`. 60 keep their exact titles, and the kid-deletes test's title now also names the message and `ip_key`.

**Changed in meaning (3 assertions):** the wrong-kind cases, 400 to 404, in "cards from photos" and "cards/get, update" (difference 4). The kid-deletes test also expects the message and `ip_key` gone (C3).

**Changed only in how they run:** raw uploads became the link steps. Fake timers became `advance()`, which moves stored times back, because Postgres's clock can't be faked. A new rate window deletes that bucket's rows. Deletion calls `purgeDishForPerson` with `person_id` set by hand, because `account.deleteMe` isn't here.

**Not carried, because they're deferred:** `convex/cravings.test.ts`, and any `pushEvents` or `account.test.ts` assertion on these cards.

**The pages, in real Chrome:**
- `web/scripts/qa/dish-e2e.mjs` runs the site with `next dev` against its fake server, in either mode. `--uploads links` is this contract: a PUT endpoint that checks the signed type and size, a failed PUT and a dead read link. The default is today's: raw files, read links that never expire, and a clip that won't load reloads nothing. The fake refuses the contract it isn't speaking, so a site built for one fails against the other.
- `web/scripts/qa/dish-api-e2e.mjs` runs the whole flow against a real api: a kid's card from a made-up dish with a test photo, Save, Ask Mom, her answers on Chrome's fake audio device, Send, and the kid reopening to her version. It checks states rather than a model's sentences, and any failed request or CORS error fails it. Locally it runs on `api/test/localApi.ts`: the real routes and Postgres, fake models, and a stand-in for S3 that checks the signed type, size and expiry and answers CORS. That file is under `test/`, so it's never in the api's image.

## Long work

Convex's scheduler became `outbox` in the same transaction, on the `scheduled` queue. `api/src/scheduled.ts` is the consumer: a long-polling loop in every api task, at most 5 tasks at once, deleting a message only after its task succeeds. Failures reach the dead-letter queue after SQS's 3 tries.

| Task | Why a repeat is safe |
|---|---|
| `dish.hear` | Takes the clip first (`dish_answers.hearing_at`, from `010_dish_hearing.sql`). A second holder does nothing. Words and English are written only where empty |
| `dish.merge` | A claim under the row lock, and her version saves only while it holds that claim. It takes each clip the same way, so her version quotes what's stored |
| `dish.budget_alert` | A mark per day in `idempotency_keys`, removed if the webhook fails so the queue tries again |
| `dish.sweep` | Orphans after an hour, S3 deletes for what's marked, old rows, C4. A failed S3 delete fails the message; a sweep out of time queues itself |
| `platform.prune` | Old `rate_hits`, sent `outbox` rows, expired `idempotency_keys` |

**How long a try takes.** One clip's worst case is 120 s: 34 s for the S3 read, 25 s for Ink and 60 s for the English. Six unheard clips would run far past the 3-minute stale mark and SQS's 300 s, so a try stops hearing after 45 s and queues itself, keeping what it heard. Its worst case is now 165 s for hearing (45 s plus one clip), or 150 s for 45 s of hearing, her version (60 s) and the page's translation (45 s, no retry). `scheduled.test.ts` holds those sums against the stale mark and reads the visibility from Terraform.

## The load balancer

The load balancer's `idle_timeout` is 3700 s, and Fastify's default keep-alive is 72 s. So the api could close an idle connection just as the load balancer sent a POST down it, and the caller would get a 502, which a retried card can't recover from. `app.ts` now sets `keepAliveTimeout` to 3720 s, above the load balancer's, and a test reads the Terraform and fails if this falls behind. `requestTimeout` is 30 s: it limits how long a caller takes to send a request, not how long we take to answer, and bodies here are at most 64 KB.

**Follow-up, Terraform:** that 3700 s is for hour-long cooking calls, and voice runs on Cloud Run until homie is back. Lowering it to about 120 s now would mean fewer idle connections held open, and the api's setting stays safe either way. Raise it again when voice moves.

## Account deletion

`account.ts` applies SCHEMA.md section 4 for dish asks, tested with hand-set ids: the kid's and Mom's rules, C3 (message and translations go, the guess stays), `ip_key`, and craving links.

**Called by the account purge** (`docs/build/ACCOUNTS-MIGRATION.md`); `person_id` stays null until the sync or a claim sets it. **C4 runs in the sweep**, needing nothing else. I also null `files.ip_key` after 90 days; C4 names only the card, but the file's HMAC is the same data.

## Secrets and env the api now needs (names only)

- **Secrets:** `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_API_KEYS_BACKUP`, `RATE_LIMIT_SALT`, `REPORT_ALERT_URL`, `REPORT_ALERT_TOKEN`.
- **Settings:** `REPORT_ALERT_EMAIL`, `DISH_WEB_ORIGIN`, optional `DISH_MODEL` and `CLAUDE_TRANSLATE_MODEL`. `PRIVATE_BUCKET` and `SCHEDULED_QUEUE_URL` are already set.
- **Tests only:** `DISH_FAKE_AI`.
- **Models:** today's, kept: `claude-haiku-5-5` for the guess and merge, `claude-opus-5-5` for translations, `ink-whisper` for voice. Voice stays on Cartesia, which AGENTS.md's "Off Gemini" rule allows for audio.

## What `web/` needs (written, on `aws-migration` only)

`web/` stays owned by App Store, web & builds. All of this is behind **`NEXT_PUBLIC_DISH_UPLOADS=links`**: unset, the site sends raw files to Convex as it always has, and the build holds none of the code below (`web/next.config.ts` always gives it a value, so the compiler drops the rest, and `scripts/check-merge-safe.mjs` reads the bundle). At the switch, set it and `NEXT_PUBLIC_DISH_URL` in one build (`CUTOVER.md`, step 11).

**The craving routes have to exist first.** `main`'s site now reads `/miss?c=` and calls `POST /dish/craving/peek`. Here that answers 404, which the site takes for a dead link, so a parent's link would quietly become a plain card. It's the "Deferred" list above, and the switch waits on it.

- `web/src/lib/dish/api.ts`: `uploadFile` asks for the link with `blob.size`, PUTs to `uploadUrl` with `uploadHeaders`, then confirms. `sendAnswer` uses `/dish/ask/answer/upload`, a PUT, then `/dish/ask/answer`. Their callers don't change. A failed PUT, of any kind, reads as `busy`, as a 502 does. Limits: 15 s for each api call, and 30 s for a file's PUT or 45 s for a clip's. It reads the PUT's reply to the end, because Chrome reports a fetch with an unread body as cancelled.
- **Preflights:** every api call stays `text/plain` with its token in the body, so none needs a preflight. That's why the two answer routes now take `askToken` in the body. With the header, each answer would have added two preflights, never cached, because `durationS` changes the URL. A PUT always needs one, from S3's CORS, so an answer costs 1 preflight, as the old raw route did.
- `components/dish/parts.tsx`: `useAudio(onStale)` reloads the card when a tap finds a source that won't load (`NotSupportedError`), because a page open over an hour holds a dead link. The tap itself plays nothing; the next one plays the fresh link. `CardScreen`, `IntroScreen` and `FillScreen` pass it. Only `CardScreen`'s path is tested in a browser.

**Localhost against staging:** `ORIGINS` in `routes.ts` already allows `http://localhost`, `127.0.0.1` and `[::1]` on any port and on every deployment, production included, as Convex's does. So `http://localhost:3105` against the staging api needs no change, and staging's S3 CORS already lists it. `webOrigin()` still takes only https. A test pins all of this. `TODO(caleb)`: closing localhost on production would be a small change at the switch; I left it matching today.

## What `infra/` needs (done, except as noted)

- The secrets above, on the api's `secret_names` and `secrets`.
- `s3:ListBucket` on `private` for the api. Without it, S3 answers 403 for a missing object, and an unuploaded file gets a 502 instead of the one not-found.
- CORS on `private`: `PUT` with `Content-Type` from homecookd.app, www, `DISH_WEB_ORIGIN`, and localhost for dev.
- The lower `idle_timeout` above, if wanted.
- EventBridge schedules into `scheduled`: `{"payload":{"task":"dish.sweep"}}` hourly and `{"payload":{"task":"platform.prune"}}` every 6 hours.

## Known limits

- **When the api's 10 database connections all stay busy past 5 seconds, requests wait those 5 seconds and then answer a 500.** `/health` keeps
  answering, so the load balancer keeps sending traffic, and `/ready` answers 503. Nothing sheds load or scales yet; autoscaling and 2+
  tasks are on the launch list. A model cost is retried, up to about 15 s, and goes to Sentry as `DishSpendLost` if it's still lost, so the
  budget can undercount only under long overload. A load test will show when this starts (SYSTEM-DESIGN).

- **An upload link can be used again until it expires, even to put back a file just deleted or swap one just confirmed.** It's now 2 minutes, down from 15, and the type and size stay signed. A later `If-None-Match: *` on the signed PUT would stop overwrites, but it needs real S3 to test and doesn't stop re-creating a deleted file.
- **The budget can overrun by whatever's in flight.** The check runs before a call and the cost lands after it. A card costs about $0.001, but a first-time page translation on Opus can reach about $0.30, so 100 at once could pass the cap by tens of dollars. A reservation would close this, but it needs a refund path for failed calls, and per-IP limits and the 3-an-hour per-card translation limit bound it today. **Recommendation:** add one only if `daily_spend` shows real overruns.
- **The sweep reaches only the private bucket's anonymous uploads.** (`jobs.sweep` in `docs/build/JOBS-MIGRATION.md` adds `uploads` and the rest of `private`, in draft. `media` stays unreached.) `objectStore()` knows one bucket, so a row in `media` or `uploads` would be "deleted" from the wrong bucket while the file survived. The purge's `markFilesForDeletion` can still mark any key: until a sweep can address `files.bucket`, a backfilled file with no capability stays marked and isn't deleted. **This must be solved before a backfill or the account purge goes live.**

**Fixed in review, so no longer limits:** a merge try outrunning the stale mark, and a translation in flight during an account deletion bringing back the kid's message.

## Open questions

**Decided in review (Oct 31):**

1. **Raw uploads: the rule stays.** The site's change is written on `aws-migration` and ships with the switch, owned by App Store, web & builds. The alternative, a temporary relay on the old routes, breaks the rule and holds up to 5 MB in memory per request.
2. **A retried `POST /dish/cards`: left for now.** The first try's `kidToken` is stored only as a hash, so a retry can't get it back, and its files answer not-found, as today. A later fix: the site sends a client id that a retry repeats, and the kid token comes from a server secret and that id.
3. **By person or by family: done in the signed-in step (`COMMUNITY-MIGRATION.md`, `MESSAGES-MIGRATION.md`), by the person rule where there's an owner.** What was written here first: decide in the signed-in step, matching the person rule where there's an owner. Convex's in-review check (PR #215, `convex/lib/fileOwner.ts`) goes by person. `api/src/files.ts` `requireOwnFiles` goes by family, and it doesn't refuse a file something already holds. Not changed here. My recommendation for that step: require `owner_person_id` to match when it's set and refuse a file already held, apart from a same-row retry. A family check alone lets one member attach another's upload, and then purging the second account deletes the first's message file.
4. **How long a read link lasts: left at 1 to 2 hours.** It may end sooner if the task's role credentials expire first; not measured. `TODO(caleb)` if a kid's page should hold audio longer.
5. **Craving links on the site: a confirmed reading, raised with Caleb.** `MissApp` reads only `k`, so a `/miss?c=` link makes a plain card that doesn't reach the parent, if the app hands those links out.
6. **A card with both people gone: left.** Kid deletes, then Mom deletes: the card stays with its guess and no owner, as on Convex. SCHEMA.md doesn't say. My recommendation is to delete it then. `TODO(caleb)`

## Not verified

- **The deployed site with an HTTPS api.** Unproven: every browser run so far is `next dev` on localhost over plain http. `dish-api-e2e.mjs` is built to run against staging, and hasn't yet.
- **Real S3 from a browser.** A presigned PUT and read link, and S3's CORS and its 403 on a dead link, are stood in for locally. Only the signing was checked against the real adapter, offline.
- **Real SQS, Claude or Ink, RDS, load or latency.**
- **Browsers other than Chrome.** Safari's `play()` failure on a dead link and its PUT of an iPhone recording haven't been run. A browser that fails `play()` with another error name won't reload the card.
- **Mom's dead read link** in a browser (`IntroScreen`, `FillScreen`). It's the same hook as the kid's, which is tested.

The 10-minute and daily rate tests can flake across a real window edge, as `rateLimit.test.ts` can.

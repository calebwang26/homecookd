# The kid's web flow on the new api

Step 5 of `docs/build/AWS-MIGRATION.md`, Oct 31, 2026. A draft on `aws-migration`: nothing live points at it. The code is `api/src/modules/dish/`, and it's the template for later areas: routes check the input, the service holds the rules, `data.ts` holds the SQL and lists each query with its index.

## Routes

**Moved, same path, shapes, statuses and sentences:** `POST /dish/cards`, `/cards/get`, `/cards/update`, `/cards/ask`, `/cards/sent`, `/ask/peek`, `/ask/finish`, and `OPTIONS /dish/*`.

**Moved, changed so bytes skip the api (see Open questions, 1):**

| Route | Today | Here |
|---|---|---|
| `POST /dish/files?kind=` | the raw file; 201 `{fileId, kind, contentType, size}` | JSON `{contentType, size}`; 201 with those fields plus `uploadUrl`, `uploadHeaders`, `expiresInS` |
| `POST /dish/files/confirm` | none | New. `{fileId}`; 201 `{fileId, kind, contentType, size}`, once S3 has the bytes |
| `POST /dish/ask/answer/upload?q=&lang=&durationS=` | none | New. `X-Dish-Token`, JSON `{contentType, size}`; 201 with an upload link. Runs every check the old route ran before storing, and takes the rate limit |
| `POST /dish/ask/answer?q=&lang=&durationS=` | `X-Dish-Token`, the raw audio; `{ask}` | Same query, header and reply. The body is JSON `{fileId}` |

**Deferred: they need `people` and `families`, so they wait for the one-way sync (SCHEMA.md, M1):**
- `POST /dish/craving/peek` answers the catch-all 404 for now. It needs her first name and relation.
- `cravingToken` on `POST /dish/cards` answers 404. Making a plain card instead would quietly not reach her.
- Claiming a card, `dishAsks.forMe` and `get`, the `cravings.*` functions, `sendVoiceRecipe`, `setFilmingDay`: the signed-in side.
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
| `scheduled.test.ts` | The queue consumer, repeats, the sweep, the budget under concurrency |
| `storage.test.ts` | The real S3 adapter's signing, with no network |
| `dishWebClient.test.ts` | The site's own `web/src/lib/dish/api.ts`, unchanged but for its base URL, over a local port |
| `dishCopies.test.ts` | Fails when Convex's recipe code, prompts or word list change, so a fix reaches both |

**Carried over:** 41 of 41 from `dishAsks.test.ts` and 20 of 20 from `dishAskModel.test.ts`. 60 keep their exact titles, and the kid-deletes test's title now also names the message and `ip_key`.

**Changed in meaning (3 assertions):** the wrong-kind cases, 400 to 404, in "cards from photos" and "cards/get, update" (difference 4). The kid-deletes test also expects the message and `ip_key` gone (C3).

**Changed only in how they run:** raw uploads became the link steps. Fake timers became `advance()`, which moves stored times back, because Postgres's clock can't be faked. A new rate window deletes that bucket's rows. Deletion calls `purgeDishForPerson` with `person_id` set by hand, because `account.deleteMe` isn't here.

**Not carried, because they're deferred:** `convex/cravings.test.ts`, and any `pushEvents` or `account.test.ts` assertion on these cards.

**`web/scripts/qa/dish-e2e.mjs` was not run.** It starts its own fake server in-process and reads that fake's state (`fake.cards`), and its checks expect the fake's canned card, not `DISH_FAKE_AI`'s. It needs an `--api` mode that reads state another way, and the `web/` upload change. `dishWebClient.test.ts` covers the contract instead, not the pages.

## Long work

Convex's scheduler became `outbox` in the same transaction, on the `scheduled` queue. `api/src/scheduled.ts` is the consumer: a long-polling loop in every api task, at most 5 tasks at once, deleting a message only after its task succeeds. Failures reach the dead-letter queue after SQS's 3 tries.

| Task | Why a repeat is safe |
|---|---|
| `dish.hear` | Saves words only while the clip is still the answer's; skips what's heard. A hear and a merge at the same moment can both pay for one clip, as on Convex |
| `dish.merge` | A claim under the row lock, and her version saves only while it holds that claim |
| `dish.budget_alert` | A mark per day in `idempotency_keys`, removed if the webhook fails so the queue tries again |
| `dish.sweep` | Orphans after an hour, S3 deletes for what's marked, old rows, C4. A failed S3 delete fails the message |
| `platform.prune` | Old `rate_hits`, sent `outbox` rows, expired `idempotency_keys` |

## Account deletion

`account.ts` applies SCHEMA.md section 4 for dish asks, tested with hand-set ids: the kid's and Mom's rules, C3 (message and translations go, the guess stays), `ip_key`, and craving links.

**Deferred:** calling it. The account purge moves last, and `person_id` is null until the sync. **C4 runs in the sweep**, needing nothing else. I also null `files.ip_key` after 90 days; C4 names only the card, but the file's HMAC is the same data.

## Secrets and env the api now needs (names only)

- **Secrets:** `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_API_KEYS_BACKUP`, `RATE_LIMIT_SALT`, `REPORT_ALERT_URL`, `REPORT_ALERT_TOKEN`.
- **Settings:** `REPORT_ALERT_EMAIL`, `DISH_WEB_ORIGIN`, optional `DISH_MODEL` and `CLAUDE_TRANSLATE_MODEL`. `PRIVATE_BUCKET` and `SCHEDULED_QUEUE_URL` are already set.
- **Tests only:** `DISH_FAKE_AI`.
- **Models:** today's, kept: `claude-haiku-5-5` for the guess and merge, `claude-opus-5-5` for translations, `ink-whisper` for voice. Voice stays on Cartesia, which AGENTS.md's "Off Gemini" rule allows for audio.

## What `web/` would need (not made)

- `NEXT_PUBLIC_DISH_URL` pointed here.
- `web/src/lib/dish/api.ts`, about 25 lines. `uploadFile`: ask for the link with `blob.size`, `PUT` to `uploadUrl` with `uploadHeaders`, then confirm. `sendAnswer`: `/ask/answer/upload`, `PUT`, then `/ask/answer` with `{fileId}`. Their callers don't change.
- `components/dish/parts.tsx`: when `a.play()` fails, reload the card for a fresh link, because a page open over an hour holds an expired one. Today it stops silently.
- `dish-fake-server.mjs` and `dish-e2e.mjs` to match.

## What `infra/` would need (not made)

- The secrets above, on the api's `secret_names` and `secrets`.
- `s3:ListBucket` on `private` for the api. Without it, S3 answers 403 for a missing object, and an unuploaded file gets a 502 instead of the one not-found.
- CORS on `private`: `PUT` with `Content-Type` from homecookd.app, www, `DISH_WEB_ORIGIN`, and localhost for dev.
- EventBridge schedules into `scheduled`: `{"payload":{"task":"dish.sweep"}}` hourly and `{"payload":{"task":"platform.prune"}}` every 6 hours.

## Open questions

1. **Raw uploads.** The rule and the site's contract conflict. I kept the rule: the site changes about 25 lines, ships in the same deploy as the URL, and nothing else calls these routes (the app uses Convex functions). The alternative, a temporary relay on the old routes, breaks the rule and holds up to 5 MB in memory per request. **Recommendation:** keep the link flow.
2. **A retried `POST /dish/cards`.** The first try's `kidToken` is stored only as a hash, so a retry can't get it back, and its files answer not-found, as today. Its first card is then unreachable. **Recommendation:** leave it for now; later, have the site send a client id that a retry repeats, and generate the kid token from a server secret and that id.
3. **By person or by family?** Convex's in-review check (PR #215, `convex/lib/fileOwner.ts`) goes by person. `api/src/files.ts` `requireOwnFiles` goes by family, and it doesn't refuse a file something already holds. Not changed here. **Recommendation:** in the first signed-in area's PR, require `owner_person_id` to match when it's set and refuse a file already held, apart from a same-row retry. A family check alone lets one member attach another's upload, and then purging the second account deletes the first's message file.
4. **How long a read link lasts.** 1 to 2 hours, and it may end sooner if the task's role credentials expire first; not measured. `TODO(caleb)` if a kid's page should hold audio longer.
5. **Craving links on the site.** `web/src` on `origin/main` has no `cravingToken` or `/miss?c=` handling, though the spec describes both. Worth checking whether the app hands those links out today.
6. **A card with both people gone.** Kid deletes, then Mom deletes: the card stays with its guess and no owner, as on Convex. SCHEMA.md doesn't say. **Recommendation:** delete it then. `TODO(caleb)`

## Not verified

Real S3, SQS, Claude or Ink; the browser against presigned links; `dish-e2e.mjs`; RDS; load or latency. The sweep has no schedule until `infra/` adds one. The 10-minute and daily rate tests can flake across a real window edge, as `rateLimit.test.ts` can.

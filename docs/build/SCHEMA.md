# homecookd's one Postgres schema

**Oct 31, 2026.** Reviewed by the Master Agent, with Caleb's product calls in section 6. The SQL is in
`api/migrations/` (files `001`-`008` hold these 46 tables; later files add to them, and `012` is the temporary sync's, which comes off at cutover). It has been applied only to throwaway empty databases, and no real data has been
copied or read. The rules it follows are in `docs/build/SYSTEM-DESIGN.md`.

Words used below: an **index** is a sorted lookup that makes a query fast. A **foreign key** (FK) makes the database refuse a
reference to a row that doesn't exist. A **tombstone** is a blanked row kept only so other rows can still point at it.

## 1. Where every table goes

### Convex (28 tables, plus `_storage`)

`convex/schema.ts` defines 28 tables. `_storage` is Convex's file system table, listed last because its data has to move too.

| Convex table | New home | Notes |
|---|---|---|
| `families` | `families` | Merged with Supabase's |
| `people` | `people` | Merged with Supabase's `profiles` |
| `sessions` | `sessions` | Kept apart from `devices`; gains an optional `device_id` |
| `accountDeletions` | `account_deletions` | Same meaning; URLs become keys, legacy URLs kept until GCS is off |
| `recipes` | `recipes` | `steps`, `memories`, `addedIngredients` stay documents; the story card becomes columns |
| `jobs` | `jobs` | Gains times, cost, model, prompt, idempotency key |
| `cookingSessions` | `cooking_sessions` | Merged with Supabase's `cooking_now` |
| `questions` | `questions` | Nested objects become columns; `shareRecipeId` dropped (always equals `recipe_id`) |
| `recordings` | `recordings` | |
| `homiePrompts` | `homie_prompts` | `familyId` dropped: never read, and `links.moved` leaves it stale |
| `liveEvents` | `live_events` | Same |
| `liveFrames` | `live_frames` | One row per recording, so the recording id is the primary key |
| `liveWindows` | `live_windows` | `familyId` dropped, as above |
| `dinners` | `dinners` | `recipe_id` may be null: another family's cancelled dinner can outlive the dish. `inviteToken` is sealed (M6) |
| `dinnerInviteOpens` | `dinner_invite_opens` | |
| `dinnerRequests` | `dinner_requests` | |
| `swapRequests` | `swap_requests` | `kind` unset becomes `'swap'` |
| `reports` | `reports` | `target_id` has no FK: it can name three tables, and a report outlives its target |
| `blocks` | `blocks` | |
| `messages` | `messages` | Moves into Supabase's thread shape (section 2) |
| `pushTokens` | `push_tokens` | Merged with Supabase's |
| `pushLog` | `push_log` | Merged with `notification_log` |
| `dishAsks` | `dish_asks` | `momLang` moves to `dish_ask_translations`; `photos` becomes `photo_keys` |
| `cravingLinks` | `craving_links` | `token` is sealed (M6) |
| `dishAnswers` | `dish_answers` | Gains `english_settled` for Convex's three states of `english` |
| `dishFiles` | `files` | The file ledger's public-route columns (`capability_hash`, `ip_key`) |
| `dishSpend` | `daily_spend` | One row per day and scope, with `'dish_ask'` as today's scope |
| `rateHits` | `rate_hits` | This shape wins over Supabase's |
| `_storage` | `files` | The metadata (size, type, time) moves to `files`; the bytes move to S3 |

Convex's other system table, `_scheduled_functions`, isn't counted above. What it did becomes `outbox` (section 2).

### Supabase (21)

| Supabase table | New home | Notes |
|---|---|---|
| `families` | `families` | Merged; codes come from here |
| `profiles` | `people` | Merged; `learner` becomes `kid` |
| `threads` | `threads` | This shape wins |
| `messages` | `messages` | This shape wins; `audio_path`, `audio_url`, `photo_path` become keys |
| `thread_reads` | Theirs deleted |
| `shares` | `shares` | Gains an id, and `token` is sealed (M6) |
| `pending_sends` | `pending_sends` | `job_id` is the signer's folder, so it's renamed `upload_id`; a real `job_id` FK is added |
| `recipe_events` | `recipe_events` | |
| `signups` | `signups` | Gains `person_id`, so deletion can reach it |
| `recipe_notes` | `recipe_notes` | Stays apart from `questions` (section 2) |
| `rate_hits` | `rate_hits` | Dropped as a shape; rows aren't copied: they live for a day |
| `favorites` | `favorites` | |
| `devices` | `devices` | Kept apart from `sessions` |
| `identities` | `identities` | |
| `invites` | `invites` | |
| `lander_events` | `lander_events` | Unchanged |
| `move_requests` | `move_requests` | |
| `push_tokens` | `push_tokens` | Merged with Convex's |
| `notification_log` | `push_log` | Merged with `pushLog` |
| `cooking_now` | `cooking_sessions` | Merged; only live rows matter |
| `join_links` | `join_links` | |

**Supabase's functions and jobs:** `share_opened` becomes a plain `UPDATE`. `hit_rate` becomes an upsert on `rate_hits`.
`table_activity` becomes a query in the api: it existed only to dodge PostgREST's 1000-row cap. `cron_secret_ok`,
`run_cron_hourly` and the `homecookd-hourly` job become an EventBridge schedule. The `homecookd-cron-sweep` job is dropped:
it only cleaned pg_cron's own log. Row-level security is dropped: only the api and worker connect, with a limited login.

**New, with no old table:** `dish_ask_translations` (was a field), `model_calls`, `idempotency_keys`, `outbox`.

## 2. The decisions, and why

### Ids

- **Every primary key is `text`.** One column has to hold both Convex ids and uuids, and one id type across every FK keeps
  the code simple. It costs some index space, which doesn't matter at this size.
- **A row from Convex keeps its Convex id.** Links, Moss's `family-<id>` index names and `signups`' `link:<card>:<side>`
  values (a hash of the card's id) keep working.
- **A row from Supabase keeps its uuid, as lowercase text.** Nothing has to be rewritten unless the row merged with a Convex
  row (below).
- **A new row gets `gen_random_uuid()::text`.** It's already the form Supabase uses, it's built in, and nothing can collide.
  The column is text, so time-sorted ids can come later with no migration. Lists sort by `created_at`, not by id.
- **Merged rows use the Convex id**, and the old uuid stays in `supabase_id`, because phones and signed tickets still send
  it. Every Supabase reference to that person is rewritten at backfill.

### Overlaps

| Looks alike | Decision | Which shape wins, and how old rows map |
|---|---|---|
| `families` / `families` | **Merge** | One row. Id from Convex when mirrored, else the uuid. `name` and codes from Supabase (Convex's copy can be stale), `public_name` and Moss fields from Convex |
| `people` / `profiles` | **Merge** | One row, same id rule. Name, role, email, tz and consent from Supabase; language, voice clone, place from Convex; `relation` from Convex, else Supabase. `removed_at` (left the family, keeps name and face) and `deleted_at` (blank tombstone) stay separate: they mean different things |
| `sessions` / `devices` | **Keep both** | A device key lasts until revoked and mints sessions; a session lasts 30 days. Old phones send either one, so both must work. New `sessions.device_id` lets revoking a phone end its sessions |
| `messages` / `messages` | **Merge, Supabase's shape** | Threads hold more: pairs, the circle, replies, read marks. A Convex row with no `to` goes in the family's circle; with `to`, in that pair's thread (made if missing). `fileId` becomes `audio_key` or `photo_key` by kind. Convex's `photo` stays its own kind: turning it into `cooked` would change the Sunday table's counts |
| `pushTokens` / `push_tokens` | **Merge** | The token is the key. When both have it, the newer `updated_at` wins |
| `pushLog` / `notification_log` | **Merge** | Convex's status plus Supabase's caps and quote fields. The kinds don't overlap, so the rules stay apart. A Supabase row with no `skipped_reason` is `sent`, otherwise `skipped`. Pruned at 40 days for both: every Supabase cap and quote window is shorter |
| `rateHits` / `rate_hits` | **Convex's shape** | One counter per key and window is cheaper than one row per hit, and is atomic as a plain upsert. It changes Supabase's sliding window to a fixed one, so a burst across a window edge can reach twice the limit. Nothing is copied |
| `questions` / `recipe_notes` | **Keep both** | A question is a work item with a status, one Moss may answer, keyed by a Convex recipe. A note is the saved result of a chat, made from two messages, keyed by library id. They meet only in the app's screens |
| `cookingSessions` / `cooking_now` | **Merge** | The same fact: who's cooking now. Convex's shape, which keeps history (`ended_at`), with `step_total`, `cook_id` and `library_id` added. At most one open row per kid. Only live `cooking_now` rows copy; a stale one ends itself |
| `jobs` / `pending_sends` | **Keep both** | A job is the pipeline's work. A pending send is "deliver this to these kids when it's ready". Linked by a new FK, matched on the upload folder |

### Two ways of naming a recipe

Convex uses `recipes.id`. Supabase's tables use a library id: recipe.json's `id`, which can name a public sample recipe that
has no row anywhere. So `favorites`, `recipe_events`, `shares`, `recipe_notes`, `messages`, `cooking_sessions` and
`pending_sends` keep `library_id` as plain text with no FK. `messages` and `cooking_sessions` have both columns.
Several families can hold the same library id on a seeded demo, so it isn't unique.

### Files

- **A column holds an S3 key, and the type enforces it.** The `s3_key` type refuses `://` and a leading `/`, so a full URL
  can't be stored, even by a bug.
- **`files` is a new ledger of private uploads.** It says whose file it is and whether anything uses it. It replaces
  `_storage`'s metadata and `dishFiles`, and it fixes three things: a person's files can be listed, orphans can be found, and an
  upload can be attached only by its own family. Today `files.uploadUrl` records no owner, an unattached upload is never deleted,
  and `messages.send` accepts any storage id.
- **Deleting is durable.** S3 can't join a database transaction, so a delete marks the row (`delete_requested_at`) and a sweep
  does the S3 call and sets `deleted_at`.
- **Other tables have no FK to `files`,** because a key can also name public library media, which has no row there. So the api's
  attach check is the only guard, and that gap is live today in `messages.send`. **Required test, for every route that takes a
  key: attaching another family's key is refused.**
- **Keep the folder, not a guess.** `recipes.media_prefix` is set only when the pipeline made the recipe from this family's
  upload. It replaces both `account_purge.py`'s folder name derived from a job id and the check that a recipe was uploaded.
- **Covers:** `cover_key` is a family's file; `cover_stock_path` is one of our website's stock photos. Community may show only
  the second, so the `PUBLIC_COVER` pattern check becomes a column. `cover_version` keeps `?v=` cache-busting.

### Jobs

- `upload_finished_at` and `finished_at` measure the 30-minute target. Old rows leave them null, and an old row is left out of
  the measure rather than given a guessed time.
- `result_model`, `result_prompt_version` and `cost_usd` say what made the result. `model_calls` has every call, including the
  dish ask's and story cards'. It holds no family content: `prompt_version` is a template's name or hash.
- **Safe to repeat:** the job id is unique, a claim is a conditional update (a second one changes no rows, tested below), and
  `(family_id, idempotency_key)` is unique for a phone's retry. Old builds have no key, so their upload folder is the key.
- `cancelled_at` replaces matching the words `"Cancelled."` in `error`. The stage stays `failed`, so old clients don't change.

### What's a document, and what's a column

Documents (jsonb): `recipes.steps` and `memories`, `dish_asks.guess`, `version` and `asked`. Each is written whole and read
whole, and nothing queries inside it. `recipes.step_count` is a generated column, so lists needn't load the steps.

Columns: the story card, `questions.answer`, `questions.found`, `people.approx`, `homiePrompts.said`. These are small, fixed and
sometimes indexed (`answer.by`). `momLang` became a table because Mom's page polls every 2 seconds and needs one language.

### Foreign keys

- People and families are never hard-deleted, so a reference to them is a plain FK that refuses a delete.
- **A row that holds a file key never cascades.** Deleting a recipe that still has questions fails rather than silently losing
  the only record of a voice note that must come off S3. Rows without keys may cascade (`dinner_requests`, `homie_prompts`).
- Every FK column has an index, checked mechanically.
- **Stated exceptions:** `for_kid_ids` and `recipient_ids` are arrays with no FK: they're read whole with their row, and a person
  row is never removed. `reports.target_id` names three tables. `account_deletions`' lists name rows that are gone by then.

### Enforced by the database, not by code

Places are `numeric(5, 2)`, so anything finer rounds to the 1 km grid on write. A tombstone can't hold personal data
(`people_tombstone_blank`). Upsert-style uniqueness: one open cooking session per kid, one report per family and item, one
follow-up per recipe and id, one join per card side.

### `outbox`: the part of Convex's scheduler Postgres doesn't give us

A Convex mutation's scheduled call commits with the mutation. Sending to SQS after a commit can be lost in a crash, and SQS can't
delay past 15 minutes, while a craving can wait out quiet hours. So work is written to `outbox` in the same transaction and a
sender moves due rows to SQS. Payloads hold ids only. Convex's code makes 33 scheduler calls, so this one table saves writing
many separate sweeps.

### What doesn't change

The schema changes storage, not what phones receive. The route layer still sends `learner`, epoch milliseconds and Convex's
field names to any app version that expects them.

## 3. The main queries, and the index behind each

Lists page with keyset cursors on `(created_at, id)`. Today's Convex code uses `.take(n)` with no cursor, so these keep the same
limits and can now page.

### Dish asks

| Read | From | Index |
|---|---|---|
| The kid's page, Mom's page | `byKid`, `byAsk` | `dish_asks.kid_token_hash`, `ask_token_hash` (unique) |
| A card's answers | `answersOf`, every page view | `dish_answers (ask_id, question_id)` unique |
| Mom's page in her language | `inLangOf` | `dish_ask_translations (ask_id, lang)` primary key |
| My cards, cards asked of me | `forMe`, `forCook` | `dish_asks_person_recent`, `dish_asks_requested_recent` |
| A craving link's cards today | `checkLinkCaps` | `dish_asks_craving_recent` |
| A craving link, her newest | `openLink`, `newestLink` | `craving_links.token_hash` (unique), `craving_links_person_newest` |
| Is this clip in use? | `saveVoiceRecipe` | `dish_answers.audio_key` (unique), `files` primary key |
| An anonymous upload | `usableFile` | `files.capability_hash` (unique) |
| Uploads nothing took | `dropOrphanFiles` | `files_orphans` |
| Today's spend | `spentOn`, `addSpend` | `daily_spend (scope, day)` primary key |
| Rate limits | `lib/rateLimit.ts` | `rate_hits (key, window_start)`; prune: `rate_hits_prune` |

### Community

| Read | From | Index |
|---|---|---|
| Shared recipes, newest | `community.feed` | `recipes_shared_recent` |
| Open dinners ahead | `community.feed` | `dinners_open_upcoming` (today it reads the oldest 100 open, past ones included) |
| Dinner's guests, seats left | `acceptedCount`, `view` | `dinner_requests (dinner_id, guest_id)` unique |
| My dinners, my asks | `dinners.mine` | `dinners_host`, `dinner_requests_guest` |
| An invite link, its opens | `openInvite`, `inviteOpens` | `dinners.invite_token_hash` (unique), `dinner_invite_opens` unique |
| My family's swaps, both ways | `familySwaps` | `swap_requests` unique, `swap_requests_asked_of_us` |
| What my family reported | `shieldFor` | `reports (reporter_family_id, kind, target_id)` unique |
| Who reported this | `fileReport`, `review` | `reports_target` |
| Open reports | `reports.open`, `alerts` | `reports_open` |
| Blocks, both ways | `shieldFor`, `blocked` | `blocks` unique, `blocks_reverse` |

### Messages

| Read | From | Index |
|---|---|---|
| A thread's page | `GET /threads/:id` | `messages_thread_recent` |
| My 1:1 threads, newest | `GET /threads`, stats | `threads_a_recent`, `threads_b_recent` |
| Family messages | `messages.list`, `madeMyDish`, recap, Sunday table | `messages_family_recent` |
| Questions, recipes received | `index.ts` 2267, 2284, 3215 | `messages_thread_kind` |
| Messages about a dish | `index.ts` 2374, 3263 | `messages_family_library` |
| Replies to a message | `index.ts` 501, 2223 | `messages_reply_to` |
| Unread | `index.ts` 1143 | `thread_reads` primary key, `thread_reads_person` |
| A recipe's notes | `index.ts` 2357 | `recipe_notes_family_library` |
| Questions on a recipe | `forRecipe`, `latestAsk`, `askFollowUps` | `questions_recipe_recent`, `questions_one_follow_up` |
| Questions waiting, answered | `openForCook`, `homie` | `questions_family_status_recent` |
| Push dedupe | `queuePush`, `notify` | `push_log (person_id, dedupe_key)` unique |
| Push caps, quote rotation | `queuePush`, `plumbing.ts` 429, `tablePr.ts` 310 | `push_log_person_recent`, `push_log_person_kind` |
| A person's phones | `queuePush`, `plumbing.ts` 359 | `push_tokens_person` |
| Pushes due, old pushes | new sweep, `push.prune` | `push_log_due`, `push_log_prune` |
| Dish stats, my stats | `index.ts` 3204, 3260 | `recipe_events_family_library`, `recipe_events_person_recent` |
| Sunday table, recap | `tablePr.ts`, `recapPr.ts` | `recipe_events_family_recent`, `pending_sends_family_delivered` |
| Hearts | `hearts.ts` | `favorites` primary key, `favorites_library`, `favorites_recent` |
| A share link | `index.ts` 2547, 2528 | `shares.token_hash` (unique), `shares_family_library` |

### Jobs and recordings

Later additions: `files.upload_id` (`070`) and `recipes.updated_at` (`071`). `docs/build/JOBS-MIGRATION.md` says why.

| Read | From | Index |
|---|---|---|
| An upload's files | the upload-complete check, a stop, the purge | `files_upload` |
| My family's jobs (the live list) | `jobs.forFamily` | `jobs_family_recent` |
| Claim the oldest queued job | `worker.claim` | `jobs_queued` |
| Is this folder a job, and whose? | `jobs.create` | `jobs_upload_key` |
| Stop by upload id, signer's check | `cancelUpload`, `signer.owns` | `jobs_family_upload`, `recipes_family_library` |
| Stuck or unfinished jobs | `cancelUnfinished`, new alarm | `jobs_unfinished` |
| Which job made this recipe | re-runs | `jobs_recipe` |
| The 30-minute target | new report | `jobs_measured` |
| A job's model calls | new report | `model_calls_job` |
| A family's recipes | `recipes.list`, Moss, `homie` | `recipes_family_recent` |
| Recipes Moss doesn't have | `reindexMissing` | `recipes_moss_missing` (was a full scan) |
| Live recordings, idle ones | `glasses.active`, `abandonIdle` | `recordings_live` |
| Has homie met her? | `sessionView` | `recordings_cook_started` |
| Her family's glasses videos | `glasses.videos` | `recordings_family_recent` |
| What was said, seen, missed | `homieLog`, `liveLog`, `forRecording` | `homie_prompts_recording`, `live_events_recording`, `live_windows_recording` |
| Newest frame | `liveEvents.frame` | `live_frames` primary key |
| Who's cooking | `cooking.current`, `homie`, `cooking.ts` 391 | `cooking_sessions_family_recent`, `cooking_sessions_cook_open` |
| Idle cooking sessions | `endIdle` | `cooking_sessions_idle` (today it looks only at the newest 500 rows) |

### Sessions and accounts

| Read | From | Index |
|---|---|---|
| Every signed-in request | `findSession` | `sessions.token_hash` (unique) |
| Every old-build request | `familyForDevice` | `devices.key_hash` (unique) |
| A family code | `familyForCode` | `families.code_hash` (unique) |
| Old ids from phones and tickets | `sessions.mirror`, `links.moved` | `families.supabase_id`, `people.supabase_id` (unique) |
| A family's people | `GET /family`, `people.family` | `people_family_order` |
| Sign in by email | `POST /auth/email` | `people_email_unique` |
| Sign in with Apple or Google | `POST /auth/*` | `identities` primary key, `identities_person` |
| Who has a live phone | `index.ts` 669, 1337 | `devices_family_live`, `devices_person` |
| Invites, join links | `index.ts` 1745, `joinLinks.ts` 173 | `invites.token_hash`, `code_hash`, `join_links.token_hash` (unique) |
| A family's live join link | `joinLinks.ts` 131 | `join_links_family_live` |
| Move requests | `index.ts` 1985, 2047, 2083 | `move_requests_family_pending`, `move_requests_one_pending`, `move_requests_device` |
| One join per card side | `claimSide` | `signups_link_token_unique`, `signups_share_token` |
| Sign-up rate check | `index.ts` 2662 | `signups_email_recent` |
| Expired sessions | `purgeExpired` | `sessions_expiry` |
| Purges that stopped | `restartPurges` | `account_deletions_purge_open` |
| Next outside purge | `nextDeletion` | `account_deletions_external_open` |
| Each purge step | `account.ts` | `recipes_cook`, `messages_sender`, `questions_asked_by`, `questions_answer_by`, `cooking_sessions_kid_recent`, `recordings_cook_started`, `jobs_cook`, `dinners_host`, `dinner_requests_guest`, `swap_requests_requester`, `dish_asks_person_recent`, `dish_asks_requested_recent`, `craving_links_person_newest`, `push_log_person_recent`, `files_owner` |

**Read in a loop over a whole table on purpose:** `recapPr.ts` pages through `push_tokens` by primary key, which is fine for a
monthly job.

## 4. What account deletion does, per table

`accountDeletions`' meaning carries over: a blank tombstone at once, a batched purge after it, a restart if it stops, then a
separate purge of everything outside the database, reported on the same row.

**At once, in one transaction:** write `account_deletions` with what was found; blank the person; end their sessions; revoke
their phones; drop their sign-in links and push tokens; cancel their jobs; abandon their recordings; cancel dinners; delete their
recipes with those recipes' questions, cooking rows and swaps. **Then in batches of 500:** everything else below, restarted by a
schedule if it stops.

The rule for any row with a file key: mark the key in `files` first, then delete the row.

"**New**" marks where this reaches something today's code doesn't.

| Table | What happens |
|---|---|
| `families` | Stays, with its name and code, until its last signed-in person deletes, leaves or moves: then the phone-less people left are deleted the same way, `name`, `public_name` and both code columns are blanked, and the row stays for the FKs (C2) |
| `people` | Blank tombstone: `name = 'Deleted'`, everything personal null. The check constraint enforces it |
| `devices` | `person_id` null, revoked. **New:** `label` null too |
| `identities` | Deleted, which frees the Apple or Google account |
| `sessions` | Deleted |
| `invites` | Naming them: deleted. Sent by them: `inviter_id` null |
| `join_links` | `inviter_id` null. The family's link keeps working |
| `move_requests` | Asking to be them: deleted. Decided by them: `decided_by` null |
| `signups` | **New** (today nothing touches it): email null, name `'Deleted'`. A `link:` row stays to keep "one join per side"; others are deleted |
| `account_deletions` | Stays as proof. Its lists of ids and keys clear 60 days after the outside purge (C5) |
| `recipes` | Theirs deleted at once. Their folder goes by `media_prefix` |
| `recordings` | Theirs deleted, after everything saved with them |
| `jobs` | Theirs deleted, with `upload_key` noted first |
| `homie_prompts`, `live_events`, `live_windows` | Cascade from the recording |
| `live_frames` | Deleted before the recording; frame file marked |
| `cooking_sessions` | As the kid: deleted. On their recipes: cascade. As the cook of a library dish: `cook_id` null |
| `pending_sends` | Sent by them: deleted, hello file marked. To them: removed from `recipient_ids` |
| `craving_links` | Deleted. Cards made from one follow the next rows |
| `dish_asks` | As the kid: with Mom still here, the card stays without the name, photos, voice notes and (**new**) `ip_key`; otherwise the whole card goes. As Mom: answers, version and filming day cleared; the card stays for the kid. A card's `family_id` alone deletes nothing. With Mom still here, the kid's `message` is blanked too (C3) |
| `dish_ask_translations` | As Mom: deleted. As the kid: **new**, deleted, because translations copy the kid's message |
| `dish_answers` | With the card, or as Mom. Clips marked |
| `files` | Theirs and any from rows above: marked, deleted from S3 by a sweep, and the row removed later. Anonymous kids' uploads are found by `ask_id` |
| `model_calls` | Stays for cost history. Ids go null. No family content |
| `daily_spend` | Nothing: no person in it |
| `dinners` | They host: deleted. Another family's around their recipe: cancelled, `recipe_id` null, `dish` text stays |
| `dinner_invite_opens` | With the dinner |
| `dinner_requests` | With the dinner, and their own asks |
| `swap_requests` | They asked, or either recipe is theirs: deleted |
| `reports` | **New:** `reporter_person_id` null. The family's hide stays |
| `blocks` | **New:** `label` becomes `'A family'` where their family is the blocked one, since it can hold a cook's first name |
| `threads` | Their pairs stay, pointing at the tombstone, so the other person keeps their half (C1). The circle stays |
| `thread_reads` | Theirs, and any on those threads |
| `messages` | Everything they sent, in pairs and the circle. What others sent stays, voice notes included (C1). Replies to deleted rows: `reply_to` null |
| `recipe_notes` | Answered by them or from a deleted message: deleted. Asked by them: `asked_by` and `question` null |
| `questions` | They asked, or on their recipes: deleted. Their answer to someone else's: taken off, status back to `asked_cook` |
| `shares` | `sender_id` null. The link stops working once the recipe's files go |
| `favorites` | Theirs deleted |
| `recipe_events` | Theirs deleted. `cook_id` null where it names them |
| `push_tokens` | Deleted at once |
| `push_log` | Deleted (titles and bodies name people) |
| `rate_hits` | Nothing: holds only an HMAC, pruned after 2 days |
| `idempotency_keys` | Rows with their id as `scope` deleted |
| `outbox` | Nothing: ids only, cleared in days. Handlers skip a deleted person |
| `lander_events` | Nothing: nothing about a person |

**Outside the database:** S3 objects (by key and by `media_prefix`), the Cartesia voice clone, the Moss index re-sync. While they
still exist, also GCS and Supabase's rows and buckets: AWS-MIGRATION says purge both stores during media's move, which is why
`media_urls_legacy` is kept. **Backups:** production keeps RDS backups 14 days and S3's old versions 28 days, both inside what
`/privacy` promises (30 more days).

**Built:** `api/src/modules/accounts/purgeSteps.ts`, with `060_accounts.sql` adding `families.blanked_at`, `account_deletions.lists_cleared_at` and `files.purge_deletion_id`. Three small additions to this table came out of building it, all in `docs/build/ACCOUNTS-MIGRATION.md`: a family invite they sent is also revoked, a kept `link:` signup also loses its `person_id`, and a blanked family's phones, sessions and links stop.

**Personal data** is tagged `-- personal` in the SQL. Also sensitive, though not readable as-is: `key_hash`, `token_hash`,
`code_hash`, `kid_token_hash`, `ask_token_hash`, `invite_token_hash` (hashes of live credentials; `shares.token_hash` is keyed);
`ip_key` and `rate_hits.key` (IP HMACs); `approx_*` (rounded place); and the sealed values, which open only with `EDIBLE_CODE_KEY`:
`families.code_enc`, `join_links.token_enc`, `craving_links.token_enc`, `dinners.invite_token_enc`, `shares.token_enc` (M6).

## 5. How old data maps across (the hard parts)

1. **People merge first, and every id follows.** Build a map of uuid to new id, then rewrite each Supabase table's person and
   family columns through it. Pairs must be re-sorted after the rewrite, because `a < b` may flip.
2. **Duplicate people.** `people.supabase_id` is unique here, but Convex doesn't enforce it. By my reading, a face moved between
   families can get two rows: `sessions.mirror` adds one for the new family, then `links.moved` moves the old one in. Find
   duplicates and repoint them first.
3. **Half-merged rows.** Convex-only people (`seed:` ids), Supabase-only people (never signed in on a build with Convex), and
   tombstones whose Supabase row is already gone. A Convex name that collides with a live one in the family's unique index.
4. **Family disagreements.** After a move the two systems can disagree about someone's family. Supabase wins, because
   membership lives there today.
5. **Deletions in flight.** An `accountDeletions` row still open at cutover must finish, on the old stores, before its data moves.
   Never copy a tombstone's old rows back in.
6. **`_storage` ids.** The Convex export includes the files. Each gets a key like `convex/<storageId>` and a `files` row with
   `legacy_ref`, and every column holding one is rewritten: `messages.fileId`, `questions.answer.audioId`,
   `recordings.coverStorageId`, `liveFrames.storageId`, `dishAsks.photos`, `dishVoiceNote`, `kidVoiceNote`, `dishAnswers.audio`,
   `dishFiles.storageId`.
7. **Full URLs.** `https://storage.googleapis.com/<bucket>/<path>?v=<generation>` splits into the key, `files.bucket` and
   `cover_version`, for `recipes.coverUrl`, `recipeJsonUrl`, `recordings.videoUrl`, `messages.audio_url` and
   `recipe_notes.answer_audio_url`. `https://homecookd.app/media/stock/...` goes to `cover_stock_path`.
8. **URLs that aren't in the database.** recipe.json and library.json in the bucket hold full `video_url`, `audio_url`, `poster_url`,
   `image_url` and `recipe_url` values, and so do the app's bundled copies. Code that writes or checks them: `publish.py`
   (`public_url`, `versioned_url`), `account_purge.py` (`media_objects` accepts only that host), `index.ts` (`BUCKET_URL`), and
   `lib/recipeJson.ts`. The GCS host must keep working for old builds.
9. **Supabase's private files.** `audio_path`, `photo_path`, `answer_audio_path` and `hello_path` become keys under new prefixes.
   The old family uuid inside a path is harmless: keys are opaque.
10. **Old rows missing new fields.** `jobs` have no finish times, no cost and no model; leave them null. Costs do exist in
    `data/out/*/work/usage.json` on the laptop, and could be imported to `model_calls`.
11. **Empty versus null.** Epoch ms converts with `to_timestamp(ms / 1000.0)`, and `_creationTime` becomes `created_at` everywhere.
    Convex can tell unset from `null`, and Postgres can't: only `dishAnswers.english` needed a new column. `momLang.key` is
    re-hashed into `source_hash`. `forKidId` and `forKidIds` become one array, reading both as `lib/forKids.ts` does.
12. **Signups to people.** Old rows have no `person_id`. Match by email first, then family and name. Whatever doesn't match can
    only be removed by a person looking.
13. **Moving one area at a time.** See question M1: it decides what gets copied when.
14. **Link tokens go in sealed (M6).** `cravingLinks.token`, `dinners.inviteToken` and Supabase's `shares.token` are never copied as
    they are. Each row gets its lookup hash (sha256; for a share, the keyed hash) and the token sealed with the row's id, through
    `api/src/sealed.ts` with `EDIBLE_CODE_KEY`. A Supabase share gets a new id, and a `signups.share_token` holding its token becomes
    `share:<id>`.

## 6. Open questions

### For the Master Agent

Answered Oct 31:

- **M1: yes, with conditions.** One-way sync. Postgres's copies of `families`, `people` and `recipes` are read-only until their area
  moves, and a scheduled reconcile counts differences. An account deletion reaches the copy within minutes, not on the next sync.
  The sync is temporary, so removing it is on AWS-MIGRATION's Cutover list.
- **M2: yes.** A `private` bucket, in its own infra PR, with versioning and old-version expiry like `uploads`.
- **M3: keep `files` and `outbox`.** The sender must use `FOR UPDATE SKIP LOCKED`, and SQS consumers must tolerate repeats.
- **M4: no change needed.** C1 keeps the other person's half, which is what `convex/account.test.ts` already pins. The behavior tests keep it; Supabase's purge is what changes.
- **M5: yes,** in the api skeleton PR. A transaction-per-file runner can't use `CREATE INDEX CONCURRENTLY`, so the runner needs a
  stated way to run a file outside a transaction once tables have real rows.
- **M6: done (Nov 2, `077_sealed_links.sql`),** before any backfill. Each of the three keeps a hash to look the token up by and the
  token sealed as `join_links.token_enc` is (AES-GCM, `EDIBLE_CODE_KEY`, its own salt, the row's id as additional data), so its owner
  is shown the same link again and a copy of the database alone opens none. Craving and dinner tokens are 22 characters and up, so
  their hash is a plain sha256, as join links'. A share's token is the old apps' 10 characters, few enough to search for, so its
  hash is keyed from the same secret. `shares` gained an id, and `signups` logs a join through one as `share:<id>`. A sealed token
  that can't be opened gets a new link: a craving or share link's old one still opens, and a dinner's is replaced. Section 5, item
  14 says how the backfill writes them.

The questions as asked:

- **M1. FKs while areas move one at a time.** Dish asks move first, but `dish_asks.person_id` needs `people`, which moves last, and
  Community reads `recipes`, which moves with jobs. **Recommendation:** a one-way sync from Convex and Supabase keeps `families`,
  `people` and `recipes` copied into Postgres from the start, with a just-in-time upsert before any write that references one.
  All FKs stay on from day one. The alternative, adding cross-area FKs later, trades a real check for less sync work.
- **M2. A private bucket.** Terraform has `media` and `uploads` only. Voice notes and photos are private today, and must not sit
  on the CDN's public path. **Recommendation:** add a `private` bucket, read with short presigned links. `files.bucket` already
  allows for it. This changes `infra/`.
- **M3. `files` and `outbox` aren't straight ports.** They're the two additions beyond what Convex and Supabase had.
  **Recommendation:** keep both, for the reasons in section 2. Reject them here if you disagree, since adding them later means
  another backfill.
- **M4. Convex's test pins the opposite of C1.** `convex/account.test.ts` line 222 expects Shreya's voice note to a deleted person to
  stay. AWS-MIGRATION wants the same behavior tests before and after. **Recommendation:** whichever way C1 goes, change that test
  in its own PR.
- **M5. Migration runner.** Files are plain SQL and assume one transaction per file. **Recommendation:** decide in the api skeleton
  PR; a small runner with a `schema_migrations` table is enough. The limited login (AWS-MIGRATION, phase 5) gets data rights only.
- **M6. Readable link tokens.** `craving_links.token`, `dinners.invite_token` and `shares.token` are stored as they are.
  **Recommendation:** seal them as `join_links.token_enc` does, in a later PR. Not a blocker.

### Caleb's answers (Oct 31, 2026)

- **C1: the other person's half stays.** When someone deletes their account, what they sent goes, and what the other person sent
  stays, voice notes included (Caleb confirmed). Convex does this today; Supabase's purge deletes both halves, so the new purge follows Convex.
  **`/privacy` says "your one-to-one chats" go, so its wording has to change** (AWS-MIGRATION, "Waiting on Apple's approval").
- **C2: blank it.** When a family's last signed-in person deletes, leaves or moves (Caleb, Nov 1), the phone-less people left are deleted through the normal path, so their rows and
  files get purged too, and `name`, `public_name`, both code columns and every join link are blanked. A family with only phone-less faces doesn't outlive them. The row stays for the FKs.
- **C3: remove the kid's message and its translations.** The guess stays, because Mom's version is built on it.
- **C4: null an anonymous card's `ip_key` after 90 days.** A sweep does it.
- **C5: keep the deletion record as proof.** Clear its lists of ids and keys 60 days after the outside purge.
- **C6: the seeded demo families come along for now.** Drop them at launch if real neighbors exist.

## 7. How it was tested, and what wasn't

### Apply test

Run from the repo root, once on a new container and again on a second new container, with the local `postgres:17` image:

```bash
docker run -d --rm --name homecookd-schema-test -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=homecookd postgres:17
until docker exec homecookd-schema-test psql -U postgres -d homecookd -tAc 'select 1' >/dev/null 2>&1; do sleep 1; done
for f in api/migrations/*.sql; do
  docker exec -i homecookd-schema-test psql -U postgres -d homecookd -v ON_ERROR_STOP=1 --single-transaction -q < "$f" || echo "FAIL $f"
done
docker exec homecookd-schema-test psql -U postgres -d homecookd -tAc "select count(*) from pg_tables where schemaname='public'"
docker rm -f homecookd-schema-test
```

Result both times, when `001`-`008` were all the files: PostgreSQL 17.11, 0 tables before, all 8 applied with no errors, 46 tables, 202 indexes, 101 FKs.

### Also checked, on that throwaway database

- Every table named in section 1 exists, checked by a script that reads this file against `pg_tables`.
- No FK column lacks an index (a query over `pg_constraint` and `pg_index` returned none).
- The refusals work: a full URL as a key, a tombstone with an email, `learner` as a role, a second open cooking session, a pair
  in the wrong order, deleting a recipe that has a question, deleting a person who owns a recipe, a repeated push dedupe key, a
  repeated job idempotency key, a finish time on an unfinished job, a fourth photo.
- What should work does: a place rounds to 42.36, -71.09; a blank tombstone saves; a second job claim updates 0 rows; deleting a
  recipe cascades its cooking rows and nulls a message's `recipe_id`.
- `EXPLAIN` on 35 of the main queries with synthetic rows (300 families, 60,000 messages, 50,000 events). 33 used an index,
  though 2 of those picked a different one than section 3 names: `jobs.forFamily` when a family had about 20 rows, and the rate
  limit, whose key matches one row either way. The other 2 (`account_deletions`, `blocks`) chose a full scan on tables of 200 and
  300 rows, which is the right call at that size. Queries in section 3 outside those 35 weren't run through `EXPLAIN`.

### Not verified

- **No real data.** Convex and Supabase weren't touched, so these are all assumptions about real rows, and the backfill must count
  violations of each one first:
  - **New uniqueness rules:** `people.supabase_id`, `swap_requests`, `dinner_requests`, `reports`, follow-up ids, one
    job per upload folder (only the newest job in a folder gets the idempotency key), and `shareRecipeId = recipeId`.
  - **New CHECKs and domains:** `body` <= 2000, `duration_s` <= 300, the `library_id` pattern, `hex_digest` (lowercase hex hashes),
    `s3_key`, `lang_code`, `tz`, the phone pattern, and the photo count.
- **Query coverage.** Convex's reads come from a grep of every `withIndex` and `query` call outside tests, plus reading most
  functions. Supabase's come from a script listing every `.from()` chain (213 call sites) and reading the sign-in, join and
  removal paths; I didn't read all 7,700 lines. `dishAskModel.ts`, `dishAskRoutes.ts`, `voice/`, `glasses/` and `cloud/signer` were
  read only for their database and file calls. The app's calling code was read only where ids bridge the two systems.
- **Real speed.** Plans on synthetic rows show an index is chosen, not that targets hold. No load test.
- **The purge and backfill.** Section 4 and section 5 are specs. Neither has been written or run.
- **RDS itself.** Tested on the Docker image, not on RDS. No extension is needed: `gen_random_uuid` is built in.
- **`/privacy`.** This doesn't change it, but moving real data will need "Where it's kept" updated first (AWS-MIGRATION).

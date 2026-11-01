# Jobs, recipes and recordings on the new api

Step 7 of `docs/build/AWS-MIGRATION.md`, the fifth item in its area order, Nov 1, 2026. A draft on `aws-migration`: nothing live points at it. It has run only against real Postgres 17 in Docker, a fake S3, fake SQS and made-up rows, never on AWS and never on a real video. The code is `api/src/modules/jobs/`, `modules/recipes/`, `modules/recordings/`, `modules/people/reads.ts`. Each `data.ts` lists its queries with their indexes. `070_job_uploads.sql` adds `files.upload_id`, and `071_recipes_updated.sql` adds `recipes.updated_at`.

**This is the route the worker was waiting for.** `queued` and the worker's message commit in one transaction, once the upload is complete (`queueJob` in `data.ts`). It's tested on real Postgres against the worker's own code: see "The worker's contract".

## Tables that cross areas

| Table | Owner | What this area does |
|---|---|---|
| `jobs`, `recordings`, `cooking_sessions`, `pending_sends`, `live_*`, `homie_prompts` | This area | `jobs`: created, queued, stopped here, and everything else by the worker. The rest: reads and deletion only |
| `recipes` | The temporary sync, until `moved_at` | Reads now. Writes behind the switch below |
| `families`, `people` | The sync | Reads only (`people/reads.ts`) |
| `files` | Platform | Video rows, `upload_id`, marks. The worker never touches it |
| `questions` | Messages | The purge deletes those on her recipes, because they block the recipe's delete. Goes to Messages' module when it lands, as Community's draft also says |
| `outbox`, `idempotency_keys`, `rate_hits` | Platform | As they're built to be used |

## The switch for `recipes`: off

`api/src/modules/recipes/switch.ts`. SYNC-MIGRATION.md's rule is that a migration sets `sync_copies.moved_at` when an area moves, and then the api may write. This adds `RECIPE_WRITES=on` above that, so writes can go off with no release. **Both are off today, and nothing here turns them on.**

| State | When | Edits | A new job |
|---|---|---|---|
| open | `RECIPE_WRITES=on` and `moved_at` set | Written | Gets its "processing" card |
| locked | The copy is read-only and not moved | 501 `not_moved` | 501 `not_moved`: the worker couldn't save its recipe at the end, so it would spend her money for nothing. A retry of a job already made still gets it |
| closed | Anything else (the sync has never run: only fake data) | 501 `not_moved` | Made with no card, `recipeId: null`, and the worker makes the recipe when it publishes. This is how the whole loop runs on staging |

All of the api's writes to `recipes` are in `recipes/writes.ts`, and a test fails if one writes before it asks the switch. `sync.test.ts` still fails if any other file writes the table; that file is its one named exception, and the trigger still refuses until `moved_at` is set. The purge doesn't wait for the flag, because a deletion must happen: only `locked` stops it, and then the sync has already removed the recipe.

**To switch on:** set `moved_at` in the release that switches the worker (SYNC-MIGRATION.md, decision 4), then the flag. It comes off with the sync: `sync_copies` goes then, so `switch.ts` goes too.

## Routes

Everything under `/v1` needs `Authorization: Bearer <sessionToken>` and answers 401 `signed_out` first. A refusal is `{error, message?, requestId}`, and `message` is the sentence the app shows, in Convex's and the signer's words. Field names stay Convex's and times stay epoch milliseconds. Another family's row reads the same as a missing one.

### Mapping from each old function

| Old | Route | What an adapter does with the reply |
|---|---|---|
| `cloud/signer` POST | `POST /v1/video-uploads` `{videos: [{contentType, size, durationS?}]}`, header `Idempotency-Key` required | 201, or 200 on a retry. `{uploadId, uploadPath, uploads: [{index, url, method, headers, expiresInS}], expiresInS}`. No `status_url`: the job list replaces the status file |
| new | `POST /v1/video-uploads/:uploadId/links` | New links for files not in yet, when one has run out |
| new, was the status file and `worker.release` | `POST /v1/video-uploads/:uploadId/complete` | `{complete, missing, cancelled, job}`. Safe to repeat |
| `jobs.create` | `POST /v1/jobs` `{uploadId, source, title?, language?, forKidId?, forKidIds?, recordingId?}` | 201 new, 200 a retry. `{jobId, recipeId}`, and `recipeId` may be null (the switch). `uploadId` is `uploadPath` without the slash |
| `jobs.forFamily` | `GET /v1/jobs?cursor=` | `.jobs`, 20 a page, and `.nextCursor` |
| new | `GET /v1/jobs/:id` | One job |
| `jobs.cancel` | `POST /v1/jobs/:id/cancel` | `{stopped}`. 404 becomes `false` |
| `jobs.cancelUpload`, signer's `action: cancel` | `POST /v1/video-uploads/:uploadId/cancel` | `{stopped}` |
| `jobs.cancelUnfinished` | none | An operator's tool: one `update`, written when someone needs it |
| `recipes.list` | `GET /v1/recipes?cursor=` | `.recipes`, 100 a page, whole, as today |
| `recipes.get` | `GET /v1/recipes/:id` | 404 becomes `null` |
| `recipes.setMemoriesOptIn` | `POST /v1/recipes/:id/memories-opt-in` `{optIn}` | Behind the switch. `{ok}` becomes `null` |
| `cooking.current` | `GET /v1/cooking` | `.cooking` |
| `live.recording` | `GET /v1/recordings/:id` | 404 becomes `null` |
| `liveEvents.forRecording` | `GET /v1/recordings/:id/log` | 404 becomes `null` |
| `liveEvents.frame` | `GET /v1/recordings/:id/frame` | `.frame`; 404 becomes `null` |
| `glasses.videos` | `GET /v1/recordings/glasses-videos` | `.videos` |
| `worker.claim`, `progress`, `published`, `release`, `requeue` | none here | `pipeline/queue_db.py`, which writes Postgres itself |
| `lib/recipeJson.ts` | none here | `queue_db.recipe_row` in the worker |
| `signer.owns` | none | The api checks these itself |

### Deferred, because homie is off (`HOMIE_ON = false`)

Voice stays on Cloud Run and the glasses VM has been stopped since Oct 25, so these keep calling Convex. Each needs its own PR when homie or the glasses come back:

- **For the app:** `live.startRecording`, `endRecording`, `startFilming`, `setCover`, `cooking.finish`. With homie off, `record.tsx` skips `startRecording` for a library pick and a phone-only camera. Only its other paths call it, and those need the glasses, which are off.
- **For the voice service:** `live.person`, `sessionView`, `setStatus`, `touch`, `addPrompt`, `updatePrompt`, `promptSaid`, `setOptIn`, `cooking.setStep`, all of `lib/liveRoutes.ts`, `/voice/session`, `/voice/step`.
- **For the glasses:** `glasses.active`, `finished`, `saveVideo`, `liveEvents.ingest`, `setFrame`, all of `lib/glassesRoutes.ts`. `live_*` rows therefore only arrive by backfill, and these reads have nothing new to show.
- **Sweeps with nothing to do without those writers:** `cooking.endIdle`, `live.abandonIdle`, `live.abandon`.
- **`homie.news` and `newsByToken`.** Off with homie, and it needs Messages' `questions`.

A `POST /v1/jobs` can still name a recording, with its guard, for rows that arrive by backfill.

### Deferred, for other reasons

- **The signer's `action: delete`.** `lib/deletes.ts` still calls the signer, and the queue worker has no `deletions/` handling. A route needs a decision on what a delete does to S3 (the old path moves it to `trash/`, recoverable), and `s3:ListBucket` on media. So **the signer can't be turned off with this PR alone.**
- **`recipes.setShare`, `setLocation`, the story card, reports' `hidden_at`.** COMMUNITY-MIGRATION.md's blockers. `recipes/writes.ts` is where they'd go once the switch is on.
- **What Convex did when a recipe published.** The worker's `recipe_published` message is now understood and does nothing: Moss sync, translating follow-ups into her language, delivering a pending send and its push. Moss goes away after approval anyway (`moss-sync-off-after-approval`), and the other two are Messages'. `worker.synced`, `requestMossSync`, `reindexMissing` go with them. Linking `pending_sends.job_id` waits for that too.
- **`worker.nextDeletion`, `deletionDone`, `retryDeletion`.** The outside purge, with Accounts.

## Uploads, in place of the signer

1. `POST /v1/video-uploads`. The api writes one `files` row per video, with `upload_id`, and signs one PUT each. The folder is a random uuid, so a key holds nothing she typed (the signer's held a slug of her dish's name).
2. The phone starts its background PUTs, and `POST /v1/jobs` at any point after that. The job waits as `uploading`, which the app already shows as "still sending".
3. `POST /v1/video-uploads/:id/complete` when the phone sees them finish. The api asks S3 for each file, outside any transaction, then in one transaction marks what landed and, when all are in, queues the job with its message.
4. **If the phone never gets to say so,** `jobs.sweep` does the same check. That's what the old worker's 30-second re-queue caught.

`uploaded_at` and so `upload_finished_at` are S3's own time for the last file, however late anyone asks, which is what the worker's own `coalesce(upload_finished_at, max(modified))` means. `finished_at` is set by the worker, by a stop and by an upload that never comes. For the 30-minute target, leave out `cancelled_at is not null`.

**Who may attach.** An upload belongs to the person who asked for its links, not only the family. That's DISH-MIGRATION's open question 3, decided the same way Community's draft did: a family check alone lets one member attach another's upload, and then her purge deletes it. `uploadId` isn't an S3 key field and isn't in `config.fileKeys`: `ownUpload` and `createJob` are its guard, and the tests go through each route. A `recordingId` must be the cook's own, and every kid a live kid of her family.

**Limits, per person:** 30 upload requests an hour and 100 a day, 120 new-link calls and 240 complete checks an hour, 240 job creates an hour. Generous, because phones retry; they stop a broken loop or a stolen session signing without end. They don't cap bytes. `TODO(caleb)`: 100 uploads × 20 files × 5 GB is a lot of S3 for one stolen session, so a daily byte cap may be worth it after real numbers.

## The worker's contract

`pipeline/queue_worker.py` and `queue_db.py` are unchanged. `api/test/jobsWorker.test.ts` runs them, in a child process, on the same Postgres as the api's routes: the real `Worker.handle`, the real `PostgresStore`, and the real body `sendDue` would put on SQS. Only S3, SQS and the video child are faked, with `pipeline/test_queue_worker.py`'s own fakes. Checked both ways:

- A stray message can't start a job still `uploading`: the claim finds nothing, and the worker holds the message.
- A real message `{outboxId, requestId, payload: {jobId}}` starts the job, with the request id in the worker's logs. It fills in the route's card, or makes the row when there's no card. Then `/v1/jobs` and `/v1/recipes/:id` read the result, with the kid not seeing stories. A repeat is dropped.
- A stop at every stage: `heartbeat` says cancelled, and `release`, `fail`, `finish` and `sweep` change nothing. A stop beats a publish that comes after it, and a publish that won can't be stopped.
- A stop while still uploading has no message in flight, so the api writes one. The worker receives it, deletes the raw video and lets go. Without that row nothing would.
- `workerFolder` in the purge gives the same folder as the worker's `recipe_folder`.

**To run it:** `PIPELINE_PYTHON=<python with pipeline/requirements.txt and requirements-queue.txt>`. CI's api job has one, and fails rather than skips if it can't import them.

**Found by this:** the worker's `recipe_published` row says `kind`, and `handleMessage` read only `task`, so every published recipe would have failed three times and reached the dead letters. `scheduled.ts` reads either now.

## Live updates

The live-updates draft (`claude/aws-live`, `docs/build/LIVE-UPDATES.md`) wrote `recentJobs`, `toLiveJob` and `liveJobs` in these same two files. They're here unchanged, so its route needs nothing different, and `jobView` is built on `toLiveJob`, so there's one mapping. **The two branches add `modules/jobs/data.ts` and `service.ts` both: on merge, take this branch's versions.** A trial merge with its commit `c1778f423` conflicted only on those two files. With this branch's versions it typechecked, and its `live.test.ts` passed with no change. `paging.ts`, `errors.ts` and the NUL check in `app.ts` are copied from Community's draft, so those should merge as they are; `scheduled.ts`'s `TASKS` line will conflict with Community's, and keeps all of them.

This area adds no subscription. A topic is one line in its `topics`, with a `read` from these services:

| Subscription | Read | Note |
|---|---|---|
| `jobs:forFamily` | `liveJobs` | Built, on its branch |
| `live:recording` | `readRecording(signed, id)` | Needs its path-parameter helper. Null reads as gone |
| `liveEvents:forRecording` | `readLiveLog(signed, id)` | Same |
| `liveEvents:frame` | `readLiveFrame(signed, id)` | Same, and its open question 4 |
| `glasses:videos` | `readGlassesVideos(signed)` | |
| `cooking:current` | `readCooking(signed)` | Convex's, for a recipe row only |
| `recipes:list` | `recipesVersion(familyId)`, then `listRecipes` | Its doc asks for this: a cheap version first, so whole recipes load only on a change. `071` adds `recipes.updated_at`, kept by a trigger, because three writers touch the table |

**A sweep checking an upload doesn't touch `updated_at`.** That column says the job moved, and `liveJobs` reads it to keep phones at the fast rate, so a waiting upload would hold them there for 7 days. A job waiting on a very long upload does hold them for the first 2 hours, by its `STALE_MS`, which seems right.

## Behavior differences

1. **A video over 5 GiB is refused, where the signer took 20 GB.** S3 takes at most 5 GiB in one PUT. See Decisions, 1.
2. **A job starts at `uploading`, not `queued`, and is queued only when complete.** Old: queued at once, and the worker found out. The app's `ProcessingRow` and `resendStep` already read `uploading` as still sending, and treat it the same. A cook with an upload running over an hour after a killed app can be offered a re-send, as she could on Convex once the worker had looked.
3. **An upload link lasts 6 hours or less, not 7 days,** and a phone can ask for new ones. The app's upload loop treats a 403 as final today, so it needs the change below.
4. **A retry of asking for links gets the same folder,** because it carries an `Idempotency-Key`. The signer made a new folder each time.
5. **Kids can't ask for upload links.** The signer let any signed-in person, and `jobs.create` then refused them.
6. **A stopped upload with no job yet marks its files,** so a late `POST /v1/jobs` is refused. On Convex it could still be made.
7. **`jobs.cancel` on another family's job, or a missing one, is 404,** where Convex said `false`. `cancelUpload` keeps `false` for both, with the same bytes, because a folder name isn't a row of hers. A malformed id too, except that one over 100 characters is Fastify's own 414 before the session check.
8. **`recipes.get`, `live.recording` and `forRecording` are 404, where Convex said `null`.**
9. **An upload that never finishes fails visibly 7 days after the phone's last word,** with the worker's words. What never arrived expires and what landed stays ("Landed video is never deleted by a clock"). Convex's stayed in `uploading` or `queued`.
10. **An upload no job took, with nothing in S3, is forgotten after 7 days.** One with anything landed stays, as the signer's did, and a person is asked.
11. **A stopped job gets `finished_at` and `cancelled_at`,** and the worker no longer matches `"Cancelled."`. `error` still says it, for old clients. `toLiveJob` keeps its rule, that a stop reads as failed at once.
12. **A second cook in the family can't take over another's upload** (a retry of a job already made still gets it, by family, as on Convex).
13. **A file with no row in the ledger is refused,** so a signer-made folder can't become a job here. An in-flight upload at the switch finishes on Convex.
14. **Setting `optIn` nulls `moss_indexed_at`,** so the next re-sync finds the row. It doesn't sync. See Decisions, 3.
15. **`cooking.current` leaves out a deleted kid and a row with no recipe.** Convex's type required a recipe. Library-only rows from Supabase's `POST /cooking` move with Messages.
16. **The folder name is a uuid,** where it held a slug of the dish's name. Logs and alerts get nothing from it.
17. **New in the shape:** `stepCount` on a recipe, and `updatedAt`, `uploadFinishedAt`, `finishedAt`, `cancelledAt` on a job. A recording has no `coverStorageId`, which the app's `LiveRecording` doesn't read, and `videoUrl` is built from a key.
18. **`coverUrl` and `recipeJsonUrl` are built from keys** on `MEDIA_BASE_URL`, with `?v=` from `cover_version`. Without the setting a route with a key fails loudly, as `objectStore()` does.
19. **S3 failing is a new 502 `storage`.**
20. **Lists page.** Each keeps Convex's limit: jobs 20, recipes 100, and `glasses.videos` and `cooking.current` stay at theirs with no paging.

### Against SYSTEM-DESIGN.md

- **"Requests stay quick."** `complete` makes up to 20 S3 HEADs in parallel, each bounded by the client's 2 s connect and 15 s request timeouts, with 2 tries. Normally a few tens of ms, and it holds no database connection meanwhile. Slower than the 300 ms target only when S3 is. The sweep is the fallback, so a phone could use a short timeout.
- **"Add a cache only when measured."** No cache. `GET /v1/recipes` reads whole recipes, as Convex's did, up to 100. `SCHEMA.md` hoped lists wouldn't need to; `convex.ts` only needs `_id`, `libraryId` and `cookId`, so a lean field set is an easy later change, but it's a shape change and I kept the comparison with Convex exact.
- **"Modules call each other's services, never each other's tables."** The purge touches `questions` directly, and `account_deletions`, which Accounts will own. Both noted above.

## Long work

| Task | Why a repeat is safe |
|---|---|
| `jobs.sweep`, every 5 minutes | Each job's check is the same conditional queue as the route's. Oldest first; a full batch carries on from its last job on a new message. Deletes what's marked in `uploads` and non-anonymous `private`, each after the 7-hour grace for a link still in a phone's hands, a row kept a week. A failed S3 call fails the message, so it's retried and alarms |
| `recipe_published` | Does nothing yet. Each thing added here must be safe to repeat |

The worker also deletes a stopped job's raw video as soon as it sees it, so the sweep's delete is the second one, for a PUT that landed after that.

## Account deletion

`jobs/account.ts` applies SCHEMA.md section 4 to these tables. **Nothing calls it yet.** When this area moves before Accounts does, `purgeJobsForPerson` goes in `sync.purge_person`. Both refuse to run on someone who hasn't deleted.

- **`stopPersonsWork(c, personId)`**, in the deletion's own transaction: unfinished jobs stop, recordings are abandoned, recipes go with their questions, cooking rows and swaps.
- **`purgeJobsForPerson(personId)`**, in batches of 500, each a transaction, safe to repeat: any recipe published a moment later; cooking rows as the kid, and `cook_id` null as the cook of a library dish; recordings, each after its frame, with cover and frame marked (prompts, events and windows cascade); jobs; pending sends made by them, with the hello marked, and them taken off others' lists; everything else in the ledger; their retry keys. `model_calls` keeps its cost history with the ids nulled.
- **What's written first, on `account_deletions`:** recipe and job ids, `upload_keys`, `media_keys`, `media_prefixes`. It adds to what's there, and makes the row if there isn't one. That includes the folder a job with no recipe yet publishes to (`recipe-<job>/`), because a job stopped part way can leave files nothing else names.

**The outside purge isn't written.** Raw videos are reached by the sweep through their ledger rows. Published folders in the media bucket are on `account_deletions` for an S3 purge nobody has written yet (WORKER-MIGRATION.md, open question 7). **That still blocks real data.**

## Secrets and env the api now needs (names only)

No new secrets. **Settings:** `MEDIA_BASE_URL` (new on the api), `RECIPE_WRITES` (leave unset). `UPLOAD_BUCKET`, `PRIVATE_BUCKET`, `JOBS_QUEUE_URL` and `SCHEDULED_QUEUE_URL` are already set. `RATE_LIMIT_SALT` is required, as it already is for the dish routes.

## What `infra/` needed (in the infra PR, not applied)

- **`s3:ListBucket` on `uploads` for the api. This blocks a real run.** Without it, S3 answers 403 for a file not there yet, so every `complete` during an upload is a 502 and the sweep's message fails.
- `MEDIA_BASE_URL` on the api.
- An EventBridge schedule into `scheduled`: `{"payload":{"task":"jobs.sweep"}}` every 5 minutes.

## What `app/` needs (not written)

Only for 1.1 and after, at the switch. Build 6 keeps calling Convex and the signer.

- `lib/uploads.ts startUpload`: `/v1/video-uploads` with a stored `Idempotency-Key`, the `uploadPath` it returns, and no `status_url`: `fetchJobStatus` and the home card read the job list.
- On a PUT that answers 403, ask `/links` and go on, in place of treating it as final. Today's code retries only 408, 429 and 5xx.
- `POST /complete` when `settled` resolves, and on every launch for a job still `uploading`.
- `createJob` sends `uploadId`. `cancelLiveJob` and `cancelLiveUpload` read `stopped`. `lib/deletes.ts requestCancel` is no longer needed.
- The `fileSizeFor` fallback of 0 now fails: a link is signed for an exact size, so a size of 0 is refused before uploading.

## Tests

`cd api && TEST_DATABASE_URL=… PIPELINE_PYTHON=… npm test`, on real Postgres with a fake S3.

| File | What |
|---|---|
| `jobs.test.ts` | `convex/cancel.test.ts`, routes, races, the outbox's one transaction, wrong family, logs |
| `jobsUploads.test.ts` | Links, retries, limits, the sweep, both buckets, and the real S3 adapter's signing, offline |
| `jobsWorker.test.ts`, `queueWorkerDriver.py` | Both sides of the worker's contract, on real Postgres |
| `recipes.test.ts` | `convex/memories.test.ts`, reads, the switch, the poll's check |
| `recordings.test.ts` | The read halves of `live`, `glasses` and `flow`; a check that the deferred routes don't exist |
| `jobsAccount.test.ts` | SCHEMA.md section 4 for these tables, the read-only case, a batch boundary, a re-run |

**Carried, same meaning:** all of `cancel.test.ts` but its signer test (5 of 6, with the first split between `jobs.test.ts` and `jobsWorker.test.ts`, each keeping its title). `memories.test.ts`'s "the kid gets the stories", less its last line, about the voice service's fields. `signer.test.ts`'s meaning, in the cancel tests. `forKids.test.ts`'s "a job takes the kids", less the worker's names. `language.test.ts`'s job from a recording, for title, language and kid. `flow.test.ts`'s upload-to-recipe test, on the real worker, less Moss. `account.test.ts`'s "a cook deleting", for these tables.

**Not carried, and why:**

| Test | Why |
|---|---|
| The signer's "recognises a stopped job" | No marker file and no `owns`: the api does the stop itself |
| `signer.test.ts`'s recipe half | `action: delete` is deferred |
| `forKids.test.ts`'s "the worker sees every name" | `pipeline/worker.py` and the queue worker don't read `forKidNames` |
| `live.test.ts`, all 8; `homie.test.ts`, all 3; most of `glasses.test.ts`; `forKids.test.ts`'s first 2 | The writes they test are deferred with homie. Their read halves are in `recordings.test.ts` |
| `glasses.test.ts`'s `cancelUnfinished` half | Not built |
| `language.test.ts`'s `/worker/release`, `/worker/published` | Replaced by the upload check, and tested in `pipeline/test_queue_worker.py` |
| `memories.test.ts`'s "each memory keeps where it sits" | `queue_db.recipe_row`, `test_recipe_row_matches_convexs_shape` |
| `flow.test.ts`'s Moss tests, questions, voice, photo notes | Moss is deferred, and the rest are Messages' |
| `followUps.test.ts` | The worker writes them, and their translation is Messages' |
| `account.test.ts`'s Moss and Community assertions | Moss is deferred. Community has its own purge |

**What can't work until something else is in place:**

- **Every route here needs a real session.** `findSession` reads `sessions`, which nothing fills. Until SYNC-MIGRATION's decision 1, or LIVE-UPDATES's open question 1, they answer 401 for every real phone. Tests write sessions straight in.
- **A new person** has no `people` copy for about 15 minutes, so a job from them fails its foreign key with a 500. SYNC-MIGRATION's decision 2 leaves this for each area to choose: this one hasn't, and a new cook filming in her first 15 minutes is a real case.
- **The worker must be on queue mode,** with `moved_at` set in the same release (SYNC-MIGRATION's decision 4).
- **The behavior tests haven't run against Convex side by side.** They were carried by reading them. "Old and new answers compared on real requests" can't happen until the above.

## Decisions

1. **Videos over 5 GiB. Caleb's call.** `cloud/signer` says a 3-hour iPhone recording is about 10 GB, and S3 takes 5 GiB in one PUT. I refuse above that with a sentence asking her to split it, and built nothing more. **Recommendation:** presigned multipart, before the switch: the api can sign parts, but the phone has to slice the file and upload the slices in the background, which is real work in `lib/uploads.ts`. Check first how long real recordings are. `TODO(caleb)`
2. **Job creation with the switch off.** Closed makes a job with no card, and locked refuses. The alternative was refusing in both, but then the loop couldn't run on staging at all until `moved_at` is set there.
3. **Taking stories back while Moss is on.** Convex's `setMemoriesOptIn` re-syncs, so her stories leave the index. Here it marks the row and nothing re-syncs. It's safe only if Moss is off by the time this switch is on. **Recommendation:** make that a condition of turning it on, or add the sync to `recipe_published`'s task list.
4. **A link's 6 hours.** Long enough for a phone to start a queued upload, and short enough to limit a leaked link. **Not measured:** on a task role, S3 refuses a link when the signing credentials expire, and those may be sooner. The phone asking again covers it, once the app does.
5. **A new cook's first 15 minutes.** See above. **Recommendation:** read her from Convex just this once on a job's insert, or tell her to wait. It's the same question for every signed-in area.

6. **Another cook stopping a job. Caleb's call (`TODO(caleb)`, `service.ts`).** Convex lets any cook in the family cancel a job, and its footage stayed. Deleting the raw video on that stop would be new, and footage can't be replaced. **Default until he answers:** it stops the job and keeps her video (`jobs.keep_upload`), and the worker leaves it. Her own stop deletes it, as Convex mode does.

## Landed video is never deleted by a clock

Nothing automatic deletes a clip that fully landed, unless its owner stops it or deletes their account. The signer kept these forever, and they can't be replaced.

- **An upload no job took:** the sweep asks S3 first, because a phone can land everything and die before saying so. If anything landed, or S3 can't answer, nothing is marked. Only an upload with nothing in S3 expires, 7 days after its last link.
- **A job waiting on its upload:** the clock runs from its last link or last landed clip, not from when it began. When it runs out the job fails visibly, what never arrived expires, and what landed stays.
- **Someone is told:** the sweep raises one Sentry issue, "Landed videos are waiting on a person", with a count and no names. **A person decides, and there's no tool for it yet:** today it's a query on `files`, and asking the cook. How long raw footage is kept is still `TODO(caleb)` (AWS-MIGRATION.md).
- **The sweep also notices** a job queued with no change for 26 hours, which a worker stopping on a job's last receive leaves behind, as well as the dead-letter alarm. It doesn't re-queue, because that could spend her money. And an ended job whose card still says "processing" because recipe writes were off: it's fixed once they're open, and reported until then.

## Known limits

- **A link can be used until it expires,** even to put back a file just deleted. The sweep deletes again 7 hours after a mark, past a link's life, but a PUT that started in time and ran past that is left behind. An upload link is also usable until then after the file is confirmed, to overwrite it with the same type and size. `If-None-Match: *` would stop overwrites, and needs real S3 and iOS to test.
- **The sweep doesn't reach `media`.** `files` rows in that bucket stay marked. No such rows exist today; the outside purge takes those folders.
- **`stopPersonsWork` marks nothing.** A crash between it and the purge leaves files unmarked until a restart, as Convex's did: Accounts' restart has to cover it.
- **Costs of an abandoned attempt** aren't this area's: WORKER-MIGRATION.md.

## Not verified

- **Real S3.** A presigned PUT of real video bytes, HEAD and its 403 or 404, `LastModified`, a task role's credential life. Only the signing was checked, offline: expiry, and that type and size are signed.
- **iOS's background upload against a signed `Content-Length`.** `URLSession` should send the file's length, and then S3 accepts it. If it sends anything else, every upload fails. Nothing here has run on a phone.
- **Real SQS, RDS, load or latency.** A test runs `EXPLAIN` on 19 of the main queries, with sequential scans off and almost no rows, so it shows an index can serve each, not what the planner picks at size. `jobs_unfinished` serves the sweep's stage filter, then sorts a few rows. `who's cooking` picked `cooking_sessions_idle` on the empty table, which is small either way.
- **The real child process and a real video.** The worker's child is faked in the contract test. It has its own tests in `pipeline/test_queue_worker.py`.
- **Any real row.** A backfilled `jobs` row without `idempotency_key` falls through to "another family's" check and the ledger check, and fails with "Upload the video" on a retry.
- **Old app versions.** They don't call any of this: they stay on Convex and the signer.
- **The purge against a real sync run,** or alongside Community's and Messages' purges in their real order.

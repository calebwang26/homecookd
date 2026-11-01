# The video worker on SQS and Postgres

Step 6 of `docs/build/AWS-MIGRATION.md`'s build order. **A draft. Nothing live uses it.** It has run only against fakes and a
throwaway local Postgres, never on AWS or on a real video.

## What's built

A new mode beside today's. The laptop's Convex mode is untouched: `worker.py` has no line that reaches this code, and its default
in the container stays Convex.

| File | What it does |
|---|---|
| `pipeline/queue_worker.py` | The loop: SQS long poll, one job at a time, claim, watch, settle. The only process that writes to Postgres |
| `pipeline/queue_job.py` | One job in a child process: download, `prep`, `process`, schema check, `publish`. Never touches the database |
| `pipeline/queue_db.py` | Postgres: the claim, every fenced write, the final transaction |
| `pipeline/queue_aws.py` | SQS, S3, and an S3 bucket shaped like the GCS one `publish.py` expects |
| `pipeline/test_queue_worker.py` | Every scenario on a fake store and, with `TEST_DATABASE_URL`, on real Postgres |
| `api/migrations/011_worker_heartbeat.sql` | Adds nullable `jobs.heartbeat_at` |

**Why a child process.** `process.run` can't be stopped from inside: once its thread pool has started, a raised error still waits
for every queued extraction, and they keep spending. Killing a process group stops ffmpeg and model calls at once, so cancel, the
spend cap and SIGTERM all work mid-step. It also keeps the steps' prints, which quote transcripts, out of CloudWatch.

**Driver: `psycopg[binary]` 3, pinned.** It's the standard Postgres driver for Python, the binary package needs no system libraries,
and it supports `verify-full` for RDS. pg8000 is smaller but less widely used. It and `boto3` are in `requirements-queue.txt`, which
the Dockerfile installs and CI and the laptop don't, and both are imported only when a connection or client is made.

## How it's run

```bash
docker run --entrypoint python <image> pipeline/queue_worker.py [--once]
```

It reads no `.env`, and exits unless `JOBS_QUEUE_URL`, `UPLOAD_BUCKET`, `MEDIA_BUCKET`, `MEDIA_BASE_URL` and `DEPLOY_ENV` are set.
On staging, Terraform sets that entry point on the worker's container (`entry_point` in `infra/envs/staging/main.tf`). Production's stays
Convex mode until it's chosen. Its `desired_count` is 0 today. A Terraform apply that changes the worker registers a task definition with
the `:bootstrap` image, so run "Deploy to AWS" for `worker` before running a task by hand.

**Message contract:** `{outboxId, requestId, payload: {jobId}}`, from `api/src/outbox.ts` with `queue: "jobs"`. No api route sends
one yet. The api must set the job to `queued` and write the outbox row in one transaction, only once the upload is complete.

**Safe to repeat.** Only a conditional `UPDATE` starts a job (`queued`, or running with a heartbeat older than 10 minutes). It adds 1
to `attempts`, and every later write names that attempt, so a worker that lost its claim changes nothing. Each attempt publishes to
its own folder, `<recipe folder>/<job>-a<n>/`, so it can't overwrite another's files. One transaction then saves the recipe, the
follow-up questions, the job's end and an outbox row (`recipe_published`, ids only).

**Timing.** Heartbeat every 30 s, which is also how late a cancel can be noticed. Visibility is extended to 15 minutes every 2 minutes.
Lease 10 minutes. A job over 10 hours fails visibly, because SQS can't hold a message past 12 hours from a receive.

**Failures.** Final, with words for the cook and the message deleted: bad model output, no steps, too long, an empty upload, the job
spend cap. Worth another try: anything else, 5 then 10 minutes later. On the third try the job fails visibly and the message goes on
to the dead letters, which alarm. Every failure goes to `observability.report_failure`, and logs carry only ids, stages and error
types.

**Spend caps, and they aren't complete: they count Claude, not Cartesia.** `TODO(caleb)` on the amounts.

**Spend caps.** `PIPELINE_JOB_CAP_USD` (default $12, across all attempts) and `PIPELINE_DAILY_CAP_USD` (default $30, UTC day, in
`daily_spend`). Both are `TODO(caleb)` defaults. Before any model runs, the video's length is checked at `COST_PER_HOUR_USD`. Over
the job cap, the job fails. Over the daily cap, it waits in `queued` until the new UTC day with the paused words, and the team is
told once. Cartesia's transcription isn't in `usage.json`, so it isn't counted.

## What each crash does

Every attempt starts clean from the raw upload, which this assumes is still there (live GCS deletes after 14 days and S3 has no rule: `TODO(caleb)` in AWS-MIGRATION). So a re-run pays for its model calls again, and they count toward the job cap.

| The worker dies... | State left behind | What the re-run does |
|---|---|---|
| After receiving, before the claim | Nothing changed | Message back within 15 minutes; a normal first run |
| While downloading or in `prep` | Job running, heartbeat stops | Claimed once the lease is over, `attempts` + 1, starts over. No money lost |
| During model calls | Calls saved up to the last tick stay in `model_calls`, `cost_usd`, `daily_spend` | Starts over; the calls of the last 2 seconds can go unrecorded |
| During `publish` | Files in that attempt's folder, nothing pointing at them | New attempt, new folder. Old files stay until the account purge takes the prefix |
| After the child finished, before the final transaction | Same | Same, and it pays again. A database blip gets 4 tries first |
| After the commit, before deleting the message | Job `done`, recipe live | The repeat sees `done`, deletes the message, runs nothing |
| On the last try | Job running, no tries left | The sweep fails it visibly within 5 minutes of the lease ending; the message goes to the dead letters |
| Only the child, say out of memory | The parent is alive | Counts as a failed try |
| Database down mid-job | The parent stops the child before the lease could lapse, and writes nothing | Message returns; re-runs once the database is back |

**Every worker deploy uses one of a job's 3 receives,** so three deploys during one long job send it to the dead letters, which alarm. Don't deploy the worker repeatedly during a long job.

**SIGTERM:** stops taking messages, kills the child, sets the job back to `queued`, hands the message back at once. A job that had
already finished its work saves first. This uses up one of the 3 receives, so a stop on the last one reaches the dead letters with
the job still `queued`. The alarm says so, and a person re-drives it.

**Cancel:** seen within 30 seconds. The child is killed, the raw video and this job's published files are deleted (as Convex mode
does, with S3 versioning as a 28-day undo), and the message goes. If S3 fails, the message stays and retries, then alarms.

## Seams changed in existing files

Only two. `worker.py`, `prep.py`, `process.py`, `account_purge.py`, `observability.py` and `requirements.txt` are unchanged.

- `pipeline/publish.py`, `public_url`: uses `bucket.public_base` when the bucket has one. A GCS bucket doesn't, so its URLs don't change.
- `pipeline/Dockerfile`: installs `requirements-queue.txt` and adds RDS's certificates. The entry point is unchanged.

`recipe.json` in the bucket still holds full CDN URLs, because the app reads them. The database holds keys only.

## Env and permissions needed (names only)

**Already on the task:** `JOBS_QUEUE_URL`, `UPLOAD_BUCKET`, `MEDIA_BUCKET`, `PRIVATE_BUCKET`, `DB_HOST`, `DB_CREDENTIALS`, `DEPLOY_ENV`,
`RELEASE`, `SENTRY_DSN_WORKER`, `MEDIA_BASE_URL` (the worker's only).

**To add for a real run:** `PIPELINE_JOB_CAP_USD`, `PIPELINE_DAILY_CAP_USD`, `EXTRACTOR`, `TEXT_PROVIDER`, `COVER_PROVIDER`,
`ALIGN_PROVIDER`, `RECIPE_WRITER`, `WRITER_PROVIDER`, `TRANSCRIPT_PROOFREAD`, `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_API_KEYS_BACKUP`.
Staging has none of those keys today. `QUEUE_WORKER_DEBUG` shows the steps' output, which can quote family content: fake data only.

**Permissions (`infra/modules/env/iam.tf`):** `s3:ListBucket` on `uploads` and `media`, and `s3:GetObject` on `private` for the plate photo.
Not `s3:ListBucket` on `private`, so a missing photo answers 403, which `download_cover` already treats as no photo.

**Infra:** Fargate's default 20 GB disk may be too small; see below. Terraform leaves it until a job is measured: the measuring task sets it
with `run-task --overrides '{"ephemeralStorage":{"sizeInGiB":100},"containerOverrides":[{"name":"worker","command":["--once"]}]}'`.

**Database login (when the limited one replaces master):** read and write `jobs`, `recipes`, `questions`, `model_calls`, `daily_spend`;
insert `outbox`; read `people`, `recordings`, `homie_prompts`.

## Queries and their indexes

| Query | Index |
|---|---|
| Claim, heartbeat, every job write | `jobs` primary key |
| Sweep for abandoned jobs, limit 50 | `jobs_unfinished` |
| Today's spend | `daily_spend` primary key |
| Homie's log, limit 200 | `homie_prompts_recording` |
| Follow-up upsert | `questions_one_follow_up` |
| Link calls to the recipe | `model_calls_job` |

## How to measure a real job

**Needs Caleb's OK each time, and only his own consenting test footage, never a family's video:** `/privacy` doesn't list AWS yet. It costs real money, past the caps' Claude-only count.

**Needs Caleb's OK: it costs money and needs real footage.** Use his own consenting test video on staging, never a family's. `/privacy`
doesn't list AWS yet. Expect roughly $2.50 an hour of video.

1. Pick 3 clips: about 5, 30 and 60 minutes.
2. Run each on a fresh task, with `--once`, so the peak figures belong to one job: 2 vCPU, 8 GB, 100 GB of ephemeral storage. Set
   `PIPELINE_JOB_CAP_USD=10` and `PIPELINE_DAILY_CAP_USD=25`.
3. Upload the clip, insert a `queued` job, and add an outbox row or send the message by hand.
4. Read the log line `job stopped`: `seconds`, `stages`, `cost_usd`, `video_s`, `cpu_s`, `max_rss_mb`, `disk_peak_mb`. Disk is sampled every 30 s.
5. Read `upload_finished_at` to `finished_at` from `jobs`, which is the 30-minute target's own measure.
6. Decide. Expect `prep` to be slower than the laptop's: the laptop has hardware encoding, and Fargate uses `libx264`.
   - **Fargate** if peak memory stays under about 6 GB, disk under 100 GB, and 95% of the expected lengths finish in 30 minutes.
   - **EC2** if encoding needs more CPU than Fargate's size options give at a sensible price, or disk or memory run out.
   - Set the maximum video length for the 30-minute target from these results (SYSTEM-DESIGN asks for this).

## Open questions, with recommendations

1. **Who says an upload is complete?** There's no signer file in this mode, and the worker can't tell 2 of 3 clips from all of them.
   **Recommend** the api: `queued` only once `files.uploaded_at` is set for every clip. Until that route exists, a partial folder would run as it is.
2. **Who consumes `recipe_published`?** Today Convex does Moss, translating follow-ups and more. Nothing reads the `scheduled` queue
   yet, so the job goes straight to `done` without `indexing`. **Recommend** the api's jobs area handles it. Moss is going away anyway.
3. **Glasses' live analysis.** `liveLog` and `liveGaps` aren't carried over; `video_gaps` is. **Recommend** porting them when the glasses
   return. The VM has been stopped since Oct 25.
4. **Should a failed job that's final also alarm?** Today it goes to Sentry, not the dead letters. **Recommend** a Sentry alert on these types.
5. **Are the $12 and $30 caps right?** Caleb's call. **Recommend** resetting them after the measured jobs.
6. **The CDN ignores `?v=`.** `Managed-CachingOptimized` leaves query strings out of the cache key, so `cover_version` busts nothing.
   Attempt folders make that harmless for this mode. **Recommend** the media phase checks old GCS-style overwrites.
7. **Account purge on S3 isn't written** (phase 4 and phase 6). `account_purge.py` only accepts GCS hosts. **Blocks real data.** It should take
   `recipes.media_prefix` and `jobs.upload_key`.

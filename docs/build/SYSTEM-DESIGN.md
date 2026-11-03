# homecookd backend: system design rules

Written Oct 31, 2026. Read this before designing or changing anything in the AWS backend. `docs/build/AWS-MIGRATION.md`
says what moves and when; this file says how the result must be built.

When a change breaks a rule here, say so in the PR and explain why. Don't quietly work around it.

## What we're building for

A parent films a family dish, and a kid follows the recipe. About 500 daily users is the next target.

- **The irreplaceable thing is a family's videos, voices and stories.** Losing them is the worst failure we can have. Being
  down for an hour is bad, but it can be recovered from.
- **Traffic is small and spiky.** Most requests are simple. The heavy work is video processing, which runs in the background.
- **The team is small, with agents doing much of the work.** Prefer boring, well-known tools and few moving parts.

Priority when goals conflict: **1. protect data and privacy, 2. reliability, 3. maintainability, 4. speed, 5. cost.**
Build for about 10x today's load. Don't build for 1,000x until the numbers show we're heading there.

## Shape of the system

```
Phone / website
   |-- files ------> CloudFront --> S3 (media)
   |-- uploads ----> S3 directly, with a short-lived link from the api
   '-- requests ---> Load balancer --> api (Fargate) --> Postgres (RDS)
                                         |
                                         '--> SQS --> worker (video jobs) --> S3, Postgres
EventBridge schedules --> SQS --> api (replaces Convex and pg_cron jobs)
```

- **One api, split into clear modules. No microservices.** Separate deployables only where the workload differs: `api`
  (quick requests), `worker` (long, heavy jobs), `voice` (hour-long connections, on Cloud Run until homie is back on).
- **Inside the api, one direction only:** route (checks the input and who's asking) -> service (rules) -> data access (SQL).
  Modules call each other's services, never each other's tables.
- **Requests stay quick.** Anything that may take more than a few seconds or calls a slow outside service goes on a queue.
- **Bytes never pass through the api.** Phones upload to and download from S3 and CloudFront directly.

## Moving data

- **Every outside call has a timeout, limited retries with backoff, and a plan for when it fails.** This covers Claude,
  Cartesia, Apple, Moss and Expo push. A failing outside service must not take down unrelated features.
- **Assume every queue message can arrive twice.** SQS delivers at least once, so jobs must be safe to repeat: use a unique
  job id, and check before doing work. Writes from a phone that may retry take an idempotency key.
  It can also arrive late: a message whose receive answer is lost stays hidden for the queue's visibility timeout (300 s on
  `scheduled`) before SQS hands it out again. The `scheduled` consumer logs each message's receipt and completion, and warns
  "scheduled message redelivered" with how late it is; 5 in 15 minutes alarms (`api/src/scheduled.ts`, `infra/modules/env/alerts.tf`).
- **Failed jobs go to a dead-letter queue, and that raises an alert.** Nothing fails silently.
- **Change contracts compatibly.** Old app versions stay in use for a long time, so add fields and don't rename or remove
  them while a version that calls them is still out there. Version the api.
- **Security on every path:** HTTPS outside, every route checks the session and the family it may touch, rate limits on
  public routes, and least-privilege roles. Secrets live in Secrets Manager only.

## Storing data

- **Postgres is the source of truth for records. S3 is the source of truth for files.** The database stores a file's key, not
  a full URL, so hosts can change.
- **Design tables from how they're read.** Each PR lists its queries and the index behind each one. Any query that can touch
  more than a page of rows needs an index and a limit. Always paginate lists.
- **Change the schema in safe steps:** add the new thing, write to both, backfill, switch reads, then remove the old one. All
  migrations are in version control, and each one must be safe while the previous release is still running.
- **Use transactions for anything that must be all-or-nothing, and retry on conflict.** Convex did this automatically, and
  Postgres won't.
- **Keep Convex's ids as text keys** during the migration, so links and references carry over.
- **Add a cache only when a measurement shows it's needed.** CloudFront covers media. No Redis until then.
- **Backups aren't real until a restore has worked.** Test a restore on a schedule and record how long it took.
- **Privacy rules are system requirements.** Account deletion must reach every store, including S3 and backups, within what
  `/privacy` promises. Every new store of family data updates `/privacy` first.

## Transforming data

The video pipeline turns raw footage into recipes.

- **Keep the raw input, and make each step repeatable.** A better model should be able to re-run a recipe from its source.
- **Check model output against a schema before saving it.** Bad output fails the job visibly and never reaches a family.
- **Record which model and prompt made each result,** along with its cost.
- **Show job progress to the user,** and allow cancelling. A cap on spend applies per job and per day.

## Consistency and availability (CAP)

Network failures happen, so "partition tolerance" isn't really optional. The real choice is what each kind of data does
during a failure: **refuse (consistent) or answer with possibly old data (available).** Decide this per feature:

| Data | During a failure | Why |
|---|---|---|
| Sign-in, account deletion, permissions | Consistent: refuse | A wrong answer is a privacy or security problem |
| Messages, answers, recipe edits | Consistent: fail visibly, phone retries | Never lose or duplicate what someone wrote |
| Job progress, activity lines | Available: may be slightly old | A delay is harmless |
| Published videos and recipe files | Available: served from the CDN | A kid mid-recipe must keep cooking |

We run one primary database with a standby, so normal reads and writes are consistent. Read replicas and multiple regions
stay out until there's a measured need.

## Resilience

Run in at least two availability zones. No single task, zone or outside service should stop the whole product.

| What fails | What happens | Who notices |
|---|---|---|
| One api task | Load balancer stops sending it traffic, ECS replaces it | Alarm only if none are healthy |
| A zone | RDS moves to its standby; tasks run in the other zone | Alarm |
| A bad release | Circuit breaker rolls back automatically | Deploy fails visibly |
| Worker crashes mid-job | Message returns to the queue, job re-runs safely | Dead-letter alarm after 3 tries |
| Claude or Cartesia down | Jobs wait and retry; the rest of the app works | Alert on error rate |
| Data deleted by mistake | Restore database to any point; S3 keeps old versions | A person, using the runbook |

Recovery targets are in the table below.

## Speed and service targets

An SLO is our internal target; an SLA is a promise to customers with consequences. We have no SLAs. Availability budgets:
99.9% is about 43 minutes down a month, and 99.99% about 4. 99.999% (about 5 minutes a year) isn't a sensible goal for a
team this size, because each extra nine costs far more.

Caleb confirmed these on Oct 31, 2026.

| Measure | Target |
|---|---|
| Availability | API 99.9% a month |
| API speed | p95 under 300 ms and p99 under 1 s, measured at the load balancer. Excludes video and AI work, which runs on queues |
| Media first byte | p95 under 200 ms for files already in the CDN, measured at the CDN. Cache-miss time and hit rate are tracked with no target until measured |
| Video job | 95% finish within 30 minutes, from upload complete to recipe ready, for videos up to a length set after measuring real jobs. Failed jobs count as misses, and the success rate is tracked with no target yet |
| Load test before launch | 50 RPS sustained for 15 minutes on a realistic mix of requests, meeting the API speed targets with under 0.1% errors |
| Load test, first measured (staging, Nov 2) | Met: 50 RPS for 15 minutes at p95 81 ms and p99 285 ms at the load balancer, no 5xx, 0.002% errors, on one 0.25 vCPU api task with the smallest database. Not met yet: overload failing fast (AWS-MIGRATION.md, "Load test on staging") |
| Recovery, database | At most 5 minutes of data lost (RPO), and back up within 1 hour (RTO), for a failed zone, a bad release or accidental deletion. Losing a whole region isn't covered until the second-region backup exists |
| Recovery, stored videos | Nothing already stored in S3 is lost in those same events. Video not yet uploaded stays on the phone. Region loss isn't covered yet |

**Partly proven:** a database restore on staging (Oct 31): about 200 s of data at risk and 12 minutes to restore, on a nearly empty database with no api pointed at the copy.

**Partly proven:** the load test, on staging (Nov 2): 50 a second for 15 minutes met the speed and error targets on one small api task. It hasn't run on production's size, and overload doesn't yet fail fast (AWS-MIGRATION.md, "Load test on staging").

**Still unproven:** a timed restore with real data size and of S3, measured video jobs at several lengths on AWS, media
timing from India and the US with cache hit rate, and Sentry and request-level monitoring.

**The new schema must record upload-finished and job-finished times.** Convex's `jobs` table has neither, so the video job
target can't be measured without them.

Use percentiles, never averages. Track RPS, database QPS and slow queries, and bytes through CloudFront and NAT. To speed
something up, measure first: fix queries, then indexes, then add capacity. Scale tasks out; the api keeps no state in memory.

## Logging, monitoring and alerts

- **Logs:** structured JSON, with a request id that follows the work across api, queue and worker. Never log secrets, tokens,
  or family content. CloudWatch Logs holds them.
- **Errors:** Sentry on the app, website, api and worker, with release tags. PM2 isn't used: ECS already restarts containers
  and captures their logs.
- **Metrics and alarms:** CloudWatch, covering 5xx rate, latency, healthy tasks, database CPU and storage, queue age, dead
  letters, spend.
- **Alerts must be actionable.** Each one says what broke and links to a runbook. If nobody needs to act on an alert, fix or
  delete it. Pages go to one place (email today, Slack when set up, Caleb's call).

**When something breaks:** alert -> read logs by request id -> reproduce on staging, never on real families' data -> ship the
smallest fix or roll back -> write a short note on the cause, and add the test or alarm that would have caught it.
Prefer rolling back to patching forward under pressure.

## Delivery (CI/CD)

- **Every PR runs tests automatically** (type checks, unit tests, Terraform validate, secret scan). A failing check blocks merge.
- **Merging to the main line deploys to staging automatically** and runs smoke tests. It also applies staging's Terraform, when a safety
  check on the plan passes; anything it refuses goes to Caleb (`infra/README.md`, "Merges apply staging").
- **Production uses the same image, after one human approval,** through GitHub environment reviewers. It rolls out gradually
  and rolls back on failure. Deploy logins use OIDC, with no stored keys.
- **Infrastructure changes only through Terraform.** Staging and production differ in size, not shape.
- **Risky changes go behind a flag,** so turning one off doesn't need a release.
- **Hot fixes use the same pipeline,** just faster.

## Tests

Business rules get unit tests. Each api route gets an integration test against real Postgres, including the case where the
wrong user is refused: a row in `api/test/routeCoverage.test.ts`, which fails on any route that isn't there. Each area moved from Convex passes the same behavior tests before and after. Before launch: a load
test, a restore drill, and a deliberately killed task.

## Definition of done

A backend PR is done when it can answer yes, or explain why not:

1. Is the data safe if this runs twice, fails halfway, or is rolled back?
2. Does it work with app versions already on phones?
3. Are its queries indexed and limited?
4. Are its outside calls bounded by timeouts and retries?
5. Will we find out if it breaks, and can we trace why?
6. Does it check who's asking and which family they may touch?
7. Is deletion covered for any new personal data, and is `/privacy` still true?
8. Did tests run, and are results stated plainly, including what wasn't tested?
9. Is this the simplest thing that meets these rules?

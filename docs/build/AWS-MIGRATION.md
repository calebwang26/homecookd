# Moving homecookd to AWS

Written Oct 31, 2026 (AWS backend chat). Why: long-term reliability, and $10,100 in unused AWS credits ($10,000 expires
Oct 31, 2028; $100 expires Oct 17, 2027). Claude stays billed by Anthropic, and credits don't pay for it.

**Staying outside AWS:** Cartesia, Apple, Expo/EAS, Moss for now, and Claude. Vercel goes too (phase 7, Caleb, Oct 31).

**The switch-over plan is `docs/build/CUTOVER.md`:** one switch, Caleb's decision on Nov 2. 1.0 stays unreleased after Apple approves it, and 1.1, on the AWS api only, is the first public version.

## Rules for every phase

- **Caleb's OK in chat, each time, for:** switching live traffic, touching production data, changing DNS, changing Cloud
  Run, Convex, Supabase or GCS, anything likely to add over $300 a month, and deleting anything this work didn't create.
- **While Apple reviews 1.0 (build 6):** no EAS production updates, no Supabase `api` deploy, and nothing that changes
  what build 6 calls.
- **Old addresses stay up until no phone uses them.** Build 6 has them compiled in, but 1.0 is never released (Nov 2),
  so only TestFlight builds and Apple's reviewer call them. They go when those are done with (CUTOVER.md, "After 1.1 is
  out"). Supabase's `api` can count which builds still call it, read from each request's user agent. It's built and
  switched off, and optional now (`LOG_APP_BUILDS`, CUTOVER.md, "Counting app builds").
- Each step has a way back that takes minutes, until 1.1 is released. After that real families are on AWS only, and a
  problem is fixed forward (CUTOVER.md, step 10).

## How the rewrite ships (Caleb, Oct 31)

One long-lived branch, `aws-migration`, with one reviewable PR per area merged into it. **Nothing from it reaches `main` or production until
Apple approves 1.0.** Merges into it do auto-deploy to staging, and once Caleb creates its role they apply staging's Terraform too, through a
safety check. That makes a merge here a real gate, held only by the Master Agent's review (`infra/README.md`, "Merges apply staging"). After approval (one switch, Caleb, Nov 2): 1.0 stays unreleased, production is built and proven, and
1.1, which talks only to the AWS api, is proven on TestFlight and released as the first public version (`docs/build/CUTOVER.md`).
The old services stay up for TestFlight builds until they're done with. `main` keeps changing `convex/` meanwhile, so the
branch merges `main` often and ports each change.

**The goal is a backend built to `docs/build/SYSTEM-DESIGN.md`, not only a move of hosting.**

### Caleb's two conditions on merging

In his words: "1. we're building the migration so that RIGHT when our app gets approved, one merge of a branch into main will finish the migration. 2. everything that effects the app store application isn't getting deployed/merged into main."

The second is a hard rule. The first can't be literal, because a merge can't move data, DNS, phones or production. So the merge changes nothing live, every behavior sits behind a switch that defaults to today's, and `docs/build/CUTOVER.md` lists the steps after it. `scripts/check-merge-safe.mjs` checks the merge on every PR.

**Before the rewrite starts:** staging fully tested, a real video job measured, and Caleb's OK on creating production,
lifting the Supabase freeze, and any copy of real data into a test database. **Before 1.1 is submitted** (since Nov 2, in
place of "before any area switches over"): production built and proven ("Before production launch", CUTOVER.md step 6).
Whether Convex's scheduled backups (phase 0) still run is open (CUTOVER.md, open question 3).

### The Supabase freeze (Caleb, Oct 31)

The freeze stays for live Supabase. Its features may be rebuilt on `aws-migration` and tested on staging with fake data. Caleb's words:
"i give the ok" (to that wording), and "im giving approval to u that u can touch teh supabase code for the purpose of migrating to AWS".
**This doesn't cover** deploying the live `api`, running live Supabase migrations, touching its data or switching traffic. Each of those,
and anything changing what build 6 calls, needs his separate OK.

### Build order (Caleb, Oct 31)

1. Automatic PR checks, and auto-deploy to staging.
2. Sentry, traceable logs, alerts.
3. **One Postgres schema, designed for Convex and Supabase together** around how the app reads data, even though areas still
   move one at a time.
4. The api skeleton: auth checks, permissions, rate limits, errors, tests.
5. The kid's web flow first, as the template for the rest.
6. The worker on queues, with jobs safe to repeat.
7. The remaining areas one at a time, with the live-updates replacement before the areas that need it.
8. A backup copy in a separate AWS account or region. Written, off, and never applied: `docs/build/REGION-COPY.md`.

### What 1.1 must pass before it's submitted

Since Nov 2 no area switches on its own, so this replaces "what each area must pass before it switches".

- The same behavior tests pass on old and new, where the api copies a Convex or Supabase behavior.
- 1.1 works end to end on TestFlight, against staging and then production (CUTOVER.md, steps 2 and 8).
- Speed targets hold under load, at production's size (step 6).
- Each step's way back has been tested, where it has one.

Dropped on Nov 2: old app versions working against the new api, and old and new answers compared on real requests. No
public phone runs 1.0.

### Before production launch

The production gate. CUTOVER.md's step 6 checks each one before 1.1 is submitted. As of Nov 2:

| Gate | State |
|---|---|
| A restore drill | Not run. RDS's backup restored to a new instance, on production |
| A deliberately killed service | Not run |
| A load test | Passed on staging's one small task, Nov 2 (below). Still to run at production's task size and count, over HTTPS |
| 2+ api tasks, autoscaling | Built, Nov 2 (#295, below): production's api is 2 to 4 tasks, at 0 until it starts. On staging, the load test at 120 a second grew it late and its health check killed a busy task; tuned in #304. The rerun grew it in a minute and found a scale-in flap, fixed in #332. Applied on staging Nov 2 and proven: the run at 120 a second took nothing away mid-load and came back to 2 about 23 minutes after it, with 0.07% errors at 3 to 4 tasks (below, "The run after the slow scale-in") |
| HTTPS on `api.homecookd.app` | Waits on Caleb's DNS step (CUTOVER.md, step 6). Staging has HTTPS through CloudFront since Nov 2 (#285) |
| A limited database login | Done on staging, Nov 2 (#273, applied in #280; `infra/README.md`, "Database logins"). On in `envs/production` from the start |
| Alarms reach a person | The budget alert's test email reached Caleb, Nov 2 (#260). Production's alerts topic needs its email confirmed and one alarm fired |
| Overload fails fast | Shedding built, Nov 2 (`OVERLOAD_SHED`, #271). The bounded wait also has to count event-loop lag (below) |
| The GitHub `Production` environment has required reviewers | Not done (`infra/README.md`, "Before production") |
| Every area's switch on, with the schedules and secrets | Written in `envs/production` (#335, Nov 2), not applied. Caleb's steps: `infra/README.md`, "Production before launch" |

**Built, Nov 2: two api tasks, and autoscaling on CPU** (`infra/modules/env/autoscaling.tf`; Caleb approved the shape). Production's
api is two tasks of 0.5 vCPU and 1 GB in place of one of 1 vCPU and 2 GB: the same $36 a month, and a task or a zone can fail
without an outage. When busy it grows to four ($72 a month). Staging runs the same 2 to 4 on its 0.25 vCPU tasks. AWS keeps the
tasks' average CPU near 50% (60% until the load test with autoscaling, below), on CPU rather than request count because CPU is what ran out in the load test
below, and adds a task each minute the api is shedding. Production stays at
0 tasks until launch, and launch is one change: its api's `desired_count` from 0 to 2. Nothing in `api/src` keeps state in one
task's memory that two tasks would get wrong: the outbox sender takes rows with `SKIP LOCKED`, scheduled work comes through SQS,
rate limits, the dish budget and idempotency live in Postgres, and what's cached in memory (Apple's and Google's keys, derived sealing
keys, the public library for 10 minutes) is the same on every task. The live polls' brake already counts per task (LIVE-UPDATES.md).
One thing did change with it: a task taken away now finishes its requests for 90 s, not 30, because the autoscaler takes tasks
away every day and making a card can wait 60 s on the guess. **Not proven yet:** the steps are in `infra/README.md`,
"Autoscaling the api". The first load test at 120 a second grew to 3 tasks only after 10 minutes, and lost one to its health check ("Load test with
autoscaling, Nov 2", below). The proof is the rerun after #304, growing to 3 or 4 tasks and coming back.

**A budget alert reaches a person (Nov 1).** The real-models window showed the budget's alert reaching only the logs, because `REPORT_ALERT_URL` isn't set on AWS. A log alarm to the alerts topic now emails it. Fired on staging on Nov 2, and the email reached Caleb. On production: the same, once.

**A Community report reaches a person (Nov 2, #323).** Report and block had the same gap: `community.report_alert` and `community.remind_open` only called the webhook, so on AWS a report reached nobody, and Apple reviews report and block. Now each logs a line (`ALERT community report needs review`, and `ALERT community reports still open` from the daily reminder), counted by a log filter, with an alarm on each to the alerts topic, built the budget's way: a new report emails within about 5 minutes, open ones once a day. The email says to run `api/src/reports.ts` (COMMUNITY-MIGRATION.md, "The team's reports"). The lines carry a kind, an id and counts only. Not applied: staging's two log filters are Caleb's hand apply (`plan_check.py` holds log filters), and production's email is confirmed at CUTOVER.md step 6.

**A production gate: overload (Master Agent, Nov 1).** Today, with all connections busy, a request waits 5 s then answers a 500. Before
production: a bounded wait queue that fails fast with a 503 and `retry-after`; the load balancer's health check stays as it is (it moved to its own thread
after the load test with autoscaling, Nov 2, below); an alarm on
pool waits; autoscaling on request load (built on CPU instead, Nov 2: the load test showed CPU runs out first). **The proof is a load test that exercises pool exhaustion.**

**Measured, Nov 1 (made-up data, local Postgres, one process with a pool of 10):** a request waiting on a row lock keeps its connection. 200 requests at once on one card finish in 408 ms
with no error, because each holds the row for about 2 ms. If something else holds that row, the queue takes the whole pool: with a row held 7 s and 10 waiting, one of the 10 got a 500, and `/ready`
answered 503 after 5 s for anyone, on any family's behalf. With 40 waiting, 31 got a 500. At 3 s nothing failed, but everything else waited the 3 s. So one stuck row can stop a task for every family.
**Built, Nov 2: turning work away when overloaded** (`api/src/overload.ts`, `OVERLOAD_SHED=on`, off by default and on in staging). Before any work, a request is turned away with the busy 503 and `retry-after`, and the "too busy to answer" line the alarm counts, when the event loop was busy for more than 98% of the last second, runs more than 500 ms late, or 50 requests already wait for a connection (`OVERLOAD_MAX_BUSY`, `OVERLOAD_MAX_LAG_MS`, `OVERLOAD_MAX_POOL_WAITING`). `/health` and `/ready` are never turned away. **Measured locally** on the api's image held to 0.25 vCPU and 512 MB, as staging's task is, with 1,500 requests at once: off, all answered 200 and the slowest took 9.5 s. On, a third to most of the card reads got the 503 (467 and 640 of 750 in two runs, nearly all on the busy share), and the slowest took 4.9 to 9.8 s on a machine busy with other work. **So it sheds work, but on this task size it can't answer fast:** the wait is before Node reads a request, and only more CPU shortens that. The real fix is a bigger task or a second one, with autoscaling: a production-sizing call for Caleb (made Nov 2: two tasks of 0.5 vCPU, growing to four, above). The staging rerun waits for auto-apply to set the switch there.

**Built after that measurement:** `lock_timeout` is 3 s, and a request that gives up on a lock or on the pool answers a 503 with `retry-after`, in every error handler. Nothing was written, so the phone may try again.
**It isn't a cure.** Requests take connections in the order they came, so with 40 waiting on a stuck row, others still wait behind them. With 15, `/ready` answered 200. The bounded wait above is still the gate. A test (`api/test/busy.test.ts`) holds it to this.

**What the 5 s test failures were, Nov 1.** Not a full pool and not a lock, in the one that was caught: a request failed at 5,003 ms with 3 connections open and 2 of them idle, while one new connection
took 5,022 ms and was cut off. On this Mac, looking up `localhost` sometimes takes 5 s: 8 of 6,000 connections to `localhost`, 7 of 6,000 lookups alone, 0 of 6,000 to `127.0.0.1` (slowest 30 ms). The pool's
connection timeout is also 5 s. Local tests now use `127.0.0.1`. The three earlier failures have the same shape but ran without the probe, so that they had this cause is likely, not shown.
**It does tell us something for production.** A request that starts a new connection stays tied to it: idle connections don't rescue it, so one slow lookup or handshake is a 500 with the pool half empty. `DB_HOST` is a
name, and has to stay one because a failover moves the address. We haven't measured lookups on Fargate. **Recommendation:** in the same load test, count `timeout exceeded` errors with idle connections open, and try a `tx` again once on `isPoolWait` (nothing was written). Not built.

**Load test on staging, Nov 2** (`infra/scripts/load-test.mjs`; fake models, made-up cards, one api task of 0.25 vCPU and 512 MB, the smallest database). 50 a second for 15 minutes: 45% the kid's page
polling its card, 25% Mom's page, 15% `/ready`, 10% `/health`, 5% edits. **It meets the targets:** at the load balancer, p50 7 ms, p95 81 ms and p99 285 ms over the whole window (worst minute p99 475 ms), 41,997
requests, no 5xx. From the laptop running it, 45,000 requests with 1 network error (0.002%), and a slower p99 that's the laptop's Wi-Fi. No "too busy", no pool timeout, no failed request in the api's log.
**The limit is the api's CPU, not the database:** the task averaged 80% CPU (peak 90%) while the database peaked at 10% with its 10 connections busy. **Overload doesn't fail fast yet:** 300 requests at once all
answered 200, slowest 2.2 s; 1,500 at once all answered 200, slowest 13 s. Requests wait for the CPU before they ever wait for the pool, so the pool's 503 never comes. The bounded wait above has to count
requests waiting on the event loop too, not only on the pool. Before production: repeat it on production's task size and count, and over HTTPS.

**Load test with autoscaling, Nov 2** (`infra/scripts/load-test.mjs --rps 120`; staging's two 0.25 vCPU api tasks, autoscaling 2 to 4 on CPU at 60%, `OVERLOAD_SHED` on).
120 a second for 12 minutes, about twice what two tasks carry: 86,401 requests, 11.8% not 2xx. About 9,860 of those were the shedder's 503 with `retry-after`
(`api/src/overload.ts`), 195 client timeouts and 178 load balancer 504s, mostly in the first 2 minutes. p50 about 60 ms, p99 about 22 s. A burst of 1,500 at once
after it: 726 turned away with the 503 and `retry-after`, no other 5xx, and `/ready` answered 200 all 750 times. **Two things went wrong:**
- **A busy task was killed.** At 15:41:53 ECS "replaced 1 tasks due to an unhealthy status". The load balancer checked `/health` on the api's own port every
  15 s, with 5 s to answer and 3 misses allowed (`infra/modules/env/load_balancer.tf`). `/health` waits in the event loop behind the CPU-bound work, so a
  saturated task that was still answering was taken for a dead one, and capacity went down just when it was short.
- **It grew late.** The api's average CPU by minute, 15:39 to 15:52: 1, 3, 79, 70, 55, 50, 75, 77, 80, 77, 74, 50, 67, 61%. Target tracking adds a task after
  3 minutes in a row over its target. The replaced task's low CPU pulled the average under 60% for two minutes, which started that count again. It went from
  2 to 3 tasks only at 15:50:29, about 10 minutes in, and never reached 4.

**Built for each, Nov 2 (#304):**
- **The load balancer's check has its own thread** (`api/src/health.ts`), so a saturated task isn't killed. A worker thread (`node:worker_threads`) answers
  `/health` on port 8081 from its own event loop. Liveness comes from a heartbeat: the main thread writes the time into shared memory every second, and the
  answer is 200 while that's under 30 s old, 503 after (and once the api's server stops listening). A saturated loop still reaches its timer every few seconds; a
  stuck one never does, so a hung task is still replaced. The target group checks 8081 (the api's `health_port`), only the load balancer may reach it, and every
  target group now allows 10 s to answer and 5 misses (75 s) in place of 5 s and 3. `/health` and `/ready` stay on the main port as they were, for the deploy's
  smoke test and for people, and the shedder still never turns them away. **Why a thread rather than only longer tolerances:** the check would still wait
  behind the work, and no timeout fits a loop that's behind by the 22 s this test's p99 reached; a longer one also slows replacing a task that really is dead.
  The tests block the main loop for 2 s: the thread answers 200 during the block, while the main port's `/health` answers only after it, and with the beat
  stale the thread answers 503 (`api/test/health.test.ts`). **Measured locally** on the api's image (Node 22) held to 0.25 vCPU and 512 MB, with 600
  connections posting 200 KB bodies and shedding off: the main port's `/health` took 6.9 s at the median and 7.8 s at worst, past the old 5 s timeout, while
  the thread answered in 7 ms (325 ms at worst), every one a 200. With shedding on and 300 connections, 490 ms against 4 ms. The thread's cost: the task
  used 126 MB of its 512 under that load.
- **It grows sooner.** CPU target tracking at 50% in place of 60%: the minutes above were 3 in a row over 50% by 15:43. And a step policy for shedding, since
  shedding started in the first minute while CPU took 10 to act: a minute with 10 or more "too busy to answer" lines (the `api_busy` count) adds one task, and
  AWS runs it again each minute the shedding goes on, after a 60 s cooldown, never past the max (`infra/modules/env/autoscaling.tf`). 10 is more than a held
  row or a blip turns away; this test turned away about 800 a minute. The max stays at 4, so the most it can cost doesn't change.

**The rerun, Nov 2 (18:04 to 18:17 PT, #310 applied; the same 120 a second for 12 minutes, then 1,500 at once).**
- **No working task was killed:** no "unhealthy" replacement. The health thread on 8081 kept answering.
- **Scale-out in a minute:** the shedding step policy added a task at 18:05:44, about 1 minute in. 4 tasks by 18:11, about 6 minutes in. The first run had a third only after 10 minutes and never a fourth.
- **Errors: 9.1% not 2xx over the window** (first run 11.8%), p99 about 10 s (about 22 s). By minute, the load balancer's target 5xx out of about 7,200 requests:
  - the first 3 minutes 668, 3,926, 1,563 (2 tasks, catching up)
  - 218, 330, 296 at 3 tasks
  - **36, 68, 25, 0, 56, 26 at 4 tasks, about 0.5%**
- **The burst:** 0 bad 5xx. 559 were turned away with 503 and retry-after, and /ready answered 200 to all 750.
- **Found: a scale-in flap.** At 18:07:10, target tracking's low alarm scaled 3 to 2 in the middle of the load. It had been in alarm through the idle minutes before the test, so it undid the step policy's first task 1.5 minutes later, and shedding added it back at 18:07:44. **Built, Nov 2 (#332):** target tracking only adds api tasks now (`disable_scale_in`), and a separate step policy takes one away after 15 minutes in a row under 25% average CPU with nothing turned away, then waits 5 minutes before the next, never below the min (`infra/modules/env/autoscaling.tf`, `scale_in`). Its alarm watches CPU plus 100 for each "too busy to answer" line, so a minute with shedding is never quiet, even before that minute's CPU reaches CloudWatch. Applied by hand on staging Nov 2, and proven by the next run (below).
- **Still short of the target:** 0.1% isn't met at four 0.25 vCPU tasks at 120 a second. Production's tasks are 0.5 vCPU, about twice the capacity each. The test should run again at production's size before launch.
- #311's deploy rolled out during the burst only, after the steady window ended at 18:16:46.

**The run after the slow scale-in, Nov 2 (22:48 to 23:24 PT, #332 applied by hand at 22:46; the same 120 a second for 12 minutes, then 1,500 at once, through staging's CloudFront address).**
- **No task taken away during the load.** Shedding added a third task at 22:49:44 (about 1 minute in) and a fourth at 22:52:44. Nothing scaled in until the load was over.
- **Back to 2 after it, slowly, as built.** The load ended at 23:00:44. The scale-in alarm took one task away at 23:18:01, about 17 minutes later (15 quiet minutes plus CloudWatch's delay), and the next at 23:24:01 (its 5-minute cooldown, then a minute's check).
- **Errors: 2.8% not 2xx over the window** (rerun 9.1%, first run 11.8%), every one a 503 with retry-after (shedding), and no load balancer 5xx. The load balancer's p95 was 0.22 s and p99 0.87 s (rerun about 10 s). By minute, target 5xx out of about 7,200 requests:
  - 1,754 in the first part-minute and 569 in the next (2 tasks, catching up), then 70
  - **then 0, 0, 21, 21, 0, 0, 0, 0, 0 at 3 to 4 tasks: 42 of 64,744, about 0.07%, under the 0.1% target**
- **The burst:** 0 bad 5xx. 653 were turned away with 503 and retry-after, and /ready answered 200 to all 750.
- **One window to watch:** the new scale-in alarm went to ALARM at 22:48:00, its first check after the apply, on the idle minutes before the run, as target tracking's low alarm was in the flap, and it stayed there until 22:51:00, 1¼ minutes after the first scale-out. It took nothing away in that window, and from 22:51 it stayed OK until the load was over. The protection there is its 15-minute rule plus the cooldowns, not the busy count, which reaches CloudWatch about 2 minutes late. Worth looking at again if a run from idle ever shows a task taken away in its first minutes.
- This machine also ran the api's test suite during the first minutes, so the client-side times above may read a little slow. The load balancer's numbers are its own.

**Production's size, in plain numbers (Nov 2).** Production's api is 2 to 4 tasks of 0.5 vCPU each (#295). It hasn't been measured at that size yet. These are staging's measurements, scaled.
- **Measured on staging:**
  - One 0.25 vCPU task carried 50 a second for 15 minutes with no 5xx (p99 285 ms at the load balancer).
  - Four of them at 120 a second, 30 each, still gave about 0.5% errors, nearly all fast 503s from the shedder. The likely cause is event-loop spikes on very small tasks, which is why the line below is an estimate, not a promise.
- **Estimate for production:** a 0.5 vCPU task has twice the CPU, so about 100 a second each at the same headroom. Two tasks would carry about **200 a second**, and four about **400 a second**, within 0.1%.
- **What launch needs:** a few hundred families is single-digit requests a second, far below two tasks.
- **The step past that,** in order:
  1. Raise the max from 4 to 6. That costs only while load is there: about $18 a month for each extra 0.5 vCPU task that's running.
  2. Then 1 vCPU tasks.
  3. Past that, the next limits are the database: 10 connections per task, and the `db.t4g.medium`'s CPU, which peaked at 10% in the staging test on a smaller instance.
- **The gate before launch:** rerun this test on production's size. That's 200 a second for 15 minutes on two tasks (the 0.1% target), then 400 a second, to see it scale to four.

### Not building

Microservices, Kubernetes, Redis, read replicas and multi-region, until measurements call for them.

Android: Caleb wants it eventually (Nov 2), so Google sign-in stays; not scheduled.

### Time

No week estimates: Claude builds this, so the ones here were too human. Real numbers come after the first area is done. Real
time is set by Caleb's approvals, reviews, Apple, phones updating, and proof under real traffic.

## Waiting on Apple's approval of 1.0

Decided by Caleb on Oct 31. **To build, and blocked until the App Store approves the app.** Since Nov 2 these come before
1.1, not before 1.0's release, which never happens. In CUTOVER.md they're steps 4 and 5.

1. **Add AWS to `/privacy`** ("Where it's kept"), as one of the companies that stores data. It stays unchanged during review.
   Owner: App Store, web & builds, under the App Review guard.
2. **Turn on the Convex backups** once that's live. Backups copy family data to AWS, so `/privacy` has to come first. The job
   is on `main` but not applied. Steps: `infra/README.md`, "Starting the backups". Until then, **there is no scheduled
   backup of Convex**, which still runs on a preview deployment. **Open since Nov 2:** with no real family on Convex, whether
   the job still runs (CUTOVER.md, open question 3).
3. **Restore test,** after the first export, if item 2 runs.
4. **Change `/privacy`'s "your one-to-one chats".** Caleb decided the other person's half stays when someone deletes their account
   (SCHEMA.md, C1), so the page must say that. Have a lawyer read the new wording. Until then the page promises more than Convex
   does today.
5. **Add Sentry to `/privacy` and the App Store privacy answers,** before Sentry goes on anything with real people's data. Until
   then it sees staging only, and the app and website don't use it.
6. **Change `/privacy`'s "This website runs on Vercel"** when the site moves (phase 7, `docs/build/WEB-MIGRATION.md`).
7. Everything else that merges or deploys from the migration branch.

**Not waiting on Apple:** remove the Oct 25 export in `~/Documents/homecookd-backups/` by about **Dec 24, 2026**, Caleb's call.
Files on a laptop don't expire. `/privacy` says data is deleted within 30 days and "it leaves our backups within 30 more", so
someone who deleted their account right after that export is covered until about then. A lawyer should confirm how that
sentence reads. It's also the only full copy until the new backups run, so the date may force a choice if Apple is still
reviewing.

## Next proof: step 5 on real services

**Passed Oct 31:** `web/scripts/qa/dish-api-e2e.mjs`, 18 of 18, in real Chrome from a local site to staging's api, with real S3 uploads and
reads, S3's CORS, and SQS, on fake models.

**Still to prove:** real Claude and Ink in a test window (`infra/README.md`, waiting on Caleb); the deployed site with an HTTPS api; Safari and a real iPhone
recording. **A real video through the AWS pipeline waits until `/privacy` names AWS (Caleb, Nov 1).**

## Raw footage goes after 14 days (Caleb, Nov 1; confirmed Nov 2: keep it as built)

The same rule as live GCS `uploads`, as a lifecycle rule on S3 `uploads`. A job re-run after that fails visibly at the upload listing, and past recipes can't be rebuilt from source. S3 keeps
a deleted version for its 28-day undo window, so the bytes are fully gone about 42 days after upload. `/privacy` needs no change for the rule itself; it needs AWS named first.

## Before real data

Before any backfill copies real rows into Postgres. Since Nov 2 that's only if CUTOVER.md's step 7 copies the demo and test
families once. Starting fresh, every row is written by the api itself.

- Seal `craving_links.token`, `dinners.invite_token` and `shares.token` (SCHEMA.md, M6). Done on the branch (Nov 2, `077`): each keeps a hash for lookup and the
  token sealed with `EDIBLE_CODE_KEY`. Still open: the backfill must write them that way too (SCHEMA.md, section 5, item 14), and the api needs `EDIBLE_CODE_KEY` before
  these links work anywhere, staging included.
- How long raw footage is kept: decided by Caleb on Nov 2, 14 days as built (above). `/privacy` must say it accurately when it names AWS.
- Count violations of every new uniqueness rule, CHECK and domain (SCHEMA.md, section 7).
- The sweep reaches every bucket and row the purge can mark. Done on the branch (Nov 2): `jobs.sweep` reaches all three buckets, and the outside purge deletes the folders and
  files `account_deletions` lists (ACCOUNTS-MIGRATION.md). GCS: dropped on Nov 2, so AWS won't reach it. A backfilled deletion with GCS links still
  stays open on the api, with its reason, and a demo family's GCS files are deleted by hand within `/privacy`'s 30 days (CUTOVER.md, "After 1.1 is out").
- Count doubled reactions and Convex messages sent to oneself, which the new schema refuses (MESSAGES-MIGRATION.md, "Before real data").

## Cutover list

The steps, in order, with who runs each and the way back: `docs/build/CUTOVER.md`, one switch since Nov 2. The sync still goes to `main` switched off with
the merge, and it never runs on real data now. The laptop's worker no longer needs `sentry-sdk`.

Before production (CUTOVER.md, step 6):

- Give the worker and api a limited database login in place of the master one. **Done on staging (Nov 2):** each has its own user
  (`api/migrations/078_app_logins.sql`), logs in with an IAM token, and can't change the schema. Only the migrate task keeps the master
  login. Applied on staging in #280 (`infra/README.md`, "Database logins"). Production starts with it on.
- Pin the workflows' actions to commit SHAs, and add a checksum for the downloaded gitleaks. Done on the branch (Nov 2): every `uses:`
  names a commit, and gitleaks is checked against its sha256 before it runs (`infra/README.md`, "Pinned actions and tools").
- Every area's switch on in production, with staging's schedules and the secrets 1.1 needs (CUTOVER.md, "What production has on at launch").

For 1.1 on production (CUTOVER.md, steps 1 and 6). **Community's gates (`COMMUNITY-MIGRATION.md`):** Apple reviews report and block, so each of these
exists and is tested before 1.1 is submitted:
  - The team can act on a report: `api/src/reports.ts` lists and reviews them as a one-off task (COMMUNITY-MIGRATION.md, "The team's reports"), and it ran on staging on Nov 2. Left: a way for the team to see what a reported item is once Convex is gone (the listing prints ids only).
  - A report reaches a person: built in #323, a log alarm emails the alerts topic ("A Community report reaches a person", above). Staging's hand apply is done and a test report's alarm fired 82 seconds after it (Nov 2). Left: production's email confirmed.
  - `community.remind_open` has its daily schedule. Staging's is in Terraform (#247), and production's since #335 (not applied).
  - 1.1's own calls to these routes (App screens). They don't exist yet, and nothing has called these routes.

**History since Nov 2,** because no old build reads a new-host link and AWS doesn't reach GCS: `supabase/functions/api/index.ts:931` accepting the new
media host, and `pipeline/account_purge.py`'s `media_objects` skipping a host that isn't GCS. Both were "before any new-host link exists" (the old CUTOVER.md
step 10).

The temporary one-way sync of `families`, `people` and `recipes` (SCHEMA.md, M1) never runs on real data now. Its code can come out later
(SYNC-MIGRATION.md, "How it's removed"), Caleb's call.

## Priorities

**Priorities (Caleb, Oct 31):** phase 0, phase 1, the worker from phase 3, then phases 4-7. **Voice is out of the near-term
work:** homie is switched off, so voice stays on Cloud Run until homie is back on. Not confirmed: whether anything live,
such as build 6, still calls the voice service. Check before anyone proposes turning it off (changing Cloud Run needs
Caleb's OK anyway).

## Phases

Since Nov 2 phases 1 and 3 to 6 land together, at 1.1's release (CUTOVER.md). The sections below each phase are the Oct 31 plan, with a note where it changed.

| # | Phase | Since Nov 2 | Way back |
|---|---|---|---|
| 0 | Safety | Convex's scheduled exports to S3: open (CUTOVER.md, open question 3). Production's own RDS and S3 backups cover 1.1, with a restore drill in step 6 | Nothing to undo |
| 1 | Our own addresses | `api.homecookd.app` and `media.homecookd.app` point straight at production, with no forwarding (step 6). 1.1 calls only them | Before release, remove the records |
| 2 | Foundation and staging | Done: staging up since Oct 31, with HTTPS, test sign-in and accounts on since Nov 2 | `terraform destroy` on staging |
| 3 | Worker off the laptop (voice waits for homie) | The queue worker runs in production from the start, sized by a real video job (step 6). The laptop worker stays for the old builds | Before release, nothing public uses it |
| 4 | Media | 1.1 uploads to and reads from S3. GCS is copied once, or not at all (step 7) | Before release, delete the copies |
| 5 | Supabase to RDS | 1.1 never calls Supabase. Its data is copied once, or not at all (step 7) | The same |
| 6 | Convex to Postgres | Every area at once, each switch on in production from the start | The same. After release, fix forward |
| 7 | Website off Vercel | The site's pages call the api from 1.1's release (step 10). When its hosting moves is open (CUTOVER.md, open question 5) | Point DNS back to Vercel, kept running for a while |

### 0. Safety
**Since Nov 2:** no real family lands on Convex, so whether this job still runs is open (CUTOVER.md, open question 3).

Convex runs on `grand-dragon-649`, a **preview** deployment. Its expiry was cleared on Oct 25, but it is still a preview,
and moving to a Convex production deployment would change the URL that build 6 calls. So: a scheduled
`npx convex export --include-file-storage` to a private, versioned S3 bucket, and one test restore into a throwaway
deployment to prove it works.

This job is only a bridge. After the migration Convex shuts down, and RDS and S3 backups take over. Not verified: whether
Convex's free plan handles a daily export, so check on the first run.

Decided and built in `infra/backups` (Caleb, Oct 31: the key lives in Secrets Manager). Today's preview key can't export, so
the job uses its own key that reaches only `grand-dragon-649`. That key can still write to the deployment, so only this
job's start-up role can read it. The job can add backups but not read or delete them. It can overwrite one by name, so a
stolen role could replace recent backups; the originals then stay recoverable for 7 days. Backups expire after 21 days, plus
those 7, which is stricter than `/privacy` needs (deleted within 30 days, out of backups within 30 more). Restore test: into a local
Convex backend on Caleb's Mac, so no cloud deployment changes.

**Blocker before the first real export:** `/privacy` names who stores family data (Convex, Supabase, Google Cloud, Vercel), and
AWS isn't listed. It gets added after Apple approves 1.0 (see "Waiting on Apple's approval of 1.0").

**How the deletion promise is kept:** S3's lifecycle rule deletes old backups by age, with no code. AWS can't tell what an
account is, so deleting an account's data stays in our code (`convex/account.ts`, `pipeline/account_purge.py`). In phase 6
its schedule moves to EventBridge. The same rules in code; AWS only runs them on time.

### 1. Our own addresses
**Replaced on Nov 2:** no forwarding. `api.homecookd.app` and `media.homecookd.app` point straight at production (CUTOVER.md, step 6), and 1.1
calls only them. With homie off, 1.1 calls no voice address. The rest of this section is history.

Ship `api.homecookd.app`, `media.homecookd.app` and a voice address in app 1.1, alongside the edible-to-homecookd rename.
At first they only forward to today's Supabase, Convex, Cloud Run and GCS, so nothing moves. Every later phase then becomes
a server-side switch with no app release.

Not proven yet: Convex's client keeps a WebSocket open to its own host, and forwarding that through our address has to be
tested on staging before 1.1 depends on it. If it fails, Convex keeps its own URL until phase 6 replaces the client.

Written, off, and never applied: `docs/build/ADDRESSES-MIGRATION.md` has the steps, the test, and what must change first. **Through CloudFront, Convex's and
Supabase's per-IP limits see CloudFront's address, not the caller's**, so `api.` can't carry live traffic until that's solved.

### 2. Foundation and staging
`infra/` (see `infra/README.md`). Staging has no real keys or data: voice runs with `VOICE_STUB=1` and
`VOICE_FAKE_SPEECH=1`, so a stranger who finds the address can't spend credits or see a family.
The load balancer is plain HTTP and accepts any token, which is acceptable only while voice is fake and has no real data.
`voice_count` stays 0 unless someone is testing.

### 3. Worker off the laptop
**Voice (waits until homie is back on).** Calls last up to an hour, but **Fargate kills a task at most 120 seconds after asking it to stop**. The load
balancer's one-hour drain doesn't change that. So the voice code must hold ECS task protection while it has a live call
and release it after. The role and setting are in `infra/`; **the code in `voice/` is not written yet** and belongs to the
Voice & homie chat. Without it, every release cuts calls. The PR gets the live Marathi and English run AGENTS.md requires.

**Worker.** Today it runs on the laptop, polling Convex. Run one real video job in the container and measure CPU, memory,
disk and minutes, then choose Fargate or EC2. A cloud worker is a clear reliability win on its own.

**Glasses.** The VM has been stopped since Oct 25, so this waits until Caleb wants it. It needs a Dockerfile or EC2 setup,
and an address its firmware can reach.

### 4. Media
**Since Nov 2:** one pass or none (CUTOVER.md, step 7). Keeping two stores in step, old builds keeping the signer, and the purge
reaching both stores (items 1, 3 and 4 below) are history. A demo family's GCS files are deleted by hand.

1. Copy `edible-media-*` to S3 and keep copying new files. Read `pipeline/publish.py` first: it stores full
   `storage.googleapis.com` links in `recipe.json` and Convex, and `account_purge.py` only accepts that host. Stored links
   need rewriting or both hosts must work.
2. Point `media.homecookd.app` at CloudFront.
3. Move uploads: the `api` hands out S3 upload links in place of `cloud/signer`. Old builds keep the old signer.
4. **Deleted accounts must be purged from both stores** while both exist. It's a privacy promise, so test this first.

The copy tool, the order of steps and the way back: `docs/build/MEDIA-MIGRATION.md`.

### 5. Supabase to RDS
Supabase and Convex share one schema (`api/migrations/`), so this phase moves Supabase's data and routes into tables designed
with Convex's, not a copy of Supabase's tables.

**Size:** 7,727 lines in `supabase/functions/api/` (Deno), 15 migrations, 21 tables, and 6 references to pg_cron, as of
Oct 31. The app-build log added one table and one daily job on Nov 2. It doesn't move: it goes when Supabase does. It's
already Postgres, so `pg_dump` and restore is the easy part. The work is moving the Deno code to Node on Fargate, replacing
pg_cron with EventBridge, and re-running `two_sided_live`, `api-smoke` and `retention_live` against the new host. The
Supabase freeze has to be lifted for this, which is Caleb's call.

Before real data arrives: create a limited app user for `api` and `worker`, and take the RDS master login
(`DB_CREDENTIALS` in `infra/modules/env/services.tf`) out of their tasks. Built Nov 2: `homecookd_api` and `homecookd_worker`, with
IAM tokens, and the master login only in the migrate task. Staging moves over with `db_iam_login` after Caleb's apply. The deploy
workflow's actions are pinned to commit SHAs (Nov 2).

### 6. Convex to Postgres
Same shared schema as phase 5.

**Size:** about 11,400 lines, 28 tables, 8 crons, 184 functions (28 queries, 34 mutations, 5 actions, 117 internal), 33
scheduler calls, 47 file-storage calls, and 7,240 lines of tests to carry over.

What makes it hard:
- **Live updates.** Screens subscribe through one helper (`app/src/lib/live/convex.ts:238`), so it's one place to change,
  but the server needs a replacement: job progress, messages and recording state need a WebSocket or polling.
- **Transactions.** Every Convex mutation retries automatically on conflict. Postgres code has to handle this itself.
- **IDs.** Keep Convex's ids as text keys, so links and references carry over.
- **Build 6 and 1.0 phones** call Convex by function name, so Convex stays up until they're gone. Since Nov 2 those are
  only TestFlight builds and Apple's reviewer. Convex's functions never see a request's headers, so they can't tell which
  build calls. Every signed-in phone also calls Supabase when it opens, so Supabase's count stands in (CUTOVER.md,
  "Counting app builds").

**Replaced on Nov 2:** every area at once, each switch on in production from the start (CUTOVER.md, "What production has on
at launch"). The order and the per-area freeze below are history.

**Order, least-connected first:**
1. The shared schema and api skeleton from the build order, session checks (read from Convex at first), test harness.
2. The kid's web flow (`dishAsks`, `dishAskModel`, `lib/dishAskRoutes`; about 2,800 lines). Plain HTTP, no subscriptions.
3. Community, dinners, cravings, share requests.
4. Messages, questions, story cards, push.
5. Jobs, worker routes, live recording and glasses: the most subscriptions, and the voice service and worker depend on them.
6. Sessions, accounts, Apple sign-in, the purge: last, because everything depends on them.

Each area: copy its data, freeze writes for a short planned window, switch its routes, watch, and keep Convex as the way
back until the area is proven. Tables that cross areas are the risk, so each area's PR lists them first.

### 7. Website off Vercel
What's built, the path table and the switch: `docs/build/WEB-MIGRATION.md`. **Since Nov 2:** the site's pages call the AWS api from 1.1's
release (CUTOVER.md, step 10), wherever the site is hosted. Moving the hosting with the release or after it is open (open question 5).

Added by Caleb on Oct 31, under the same rule: built on the migration branch, merged only after Apple approves. **This is
the easiest piece.** `web/` is already a static export (`output: "export"` in `web/next.config.ts`), with no server code,
so it's files on S3 behind CloudFront. The only Vercel setting in use is the cache and content-type headers in
`web/vercel.json`, which become CloudFront response headers.

Check while building:
- Page links such as `/r`, `/i`, `/d`, `/miss` and `/a`: Vercel serves clean URLs, and CloudFront needs a small function to
  do the same, including any path after them that the pages read themselves. `/.well-known/apple-app-site-association` must stay exact, or universal links break for every
  installed app. That's an App Review guard path.
- Vercel builds production from this repo's `main` today, so the new workflow replaces that trigger.
- Vercel gives every PR a preview link. A preview on S3 is more work, so decide whether to rebuild that or use staging.
- `/privacy` says "This website runs on Vercel", and `web/src/app/layout.tsx` falls back on Vercel's env variables for the
  site's address (set `NEXT_PUBLIC_SITE_URL`).
- The domain's DNS: needs Caleb's OK, and has to be coordinated with phase 1's `api.` and `media.` addresses.

Cost: a few dollars a month at today's traffic.

## Cost

| | Monthly | Status |
|---|---|---|
| Staging | about $90-100 | Estimate from list prices; the real figure gets logged in `docs/agents/STATE.md` |
| Production at 500 daily users | about $450-850, plus about $14 of storage growth | Rough estimate; not created |

That gives 11-18 months of credits at 500 daily users. Budget alerts email Caleb at $100, $500 and $1,000 of real spend,
with credits excluded so they actually fire.

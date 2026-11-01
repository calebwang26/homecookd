# Moving homecookd to AWS

Written Oct 31, 2026 (AWS backend chat). Why: long-term reliability, and $10,100 in unused AWS credits ($10,000 expires
Oct 31, 2028; $100 expires Oct 17, 2027). Claude stays billed by Anthropic, and credits don't pay for it.

**Staying outside AWS:** Cartesia, Apple, Expo/EAS, Moss for now, and Claude. Vercel goes too (phase 7, Caleb, Oct 31).

## Rules for every phase

- **Caleb's OK in chat, each time, for:** switching live traffic, touching production data, changing DNS, changing Cloud
  Run, Convex, Supabase or GCS, anything likely to add over $300 a month, and deleting anything this work didn't create.
- **While Apple reviews 1.0 (build 6):** no EAS production updates, no Supabase `api` deploy, and nothing that changes
  what build 6 calls.
- **Old addresses stay up until no phone uses them.** Build 6 has them compiled in, so the old services can't be
  turned off when a phase ends. They go only when the app versions that call them are gone.
- Each step has a way back that takes minutes, until the old system is switched off for good.

## How the rewrite ships (Caleb, Oct 31)

One long-lived branch, `aws-migration`, with one reviewable PR per area merged into it. **Nothing from it reaches `main` or production until
Apple approves 1.0.** Merges into it do auto-deploy to staging. After approval: app 1.1 with our own addresses first, then each area switches over on its own, with
Convex as its way back until it's proven. Build 6 keeps calling the old services, so they stay up until those phones have
updated. `main` keeps changing `convex/` meanwhile, so the branch merges `main` often and ports each change.

**The goal is a backend built to `docs/build/SYSTEM-DESIGN.md`, not only a move of hosting.**

**Before the rewrite starts:** staging fully tested, a real video job measured, and Caleb's OK on creating production,
lifting the Supabase freeze, and any copy of real data into a test database. **Before any area switches over:** Convex backups
running and a restore proven (phase 0).

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

### What each area must pass before it switches

- The same behavior tests pass on old and new.
- Old app versions keep working.
- Old and new answers are compared on real requests, where practical.
- Speed targets hold under load.
- The way back has been tested.

### Before production launch

A restore drill, a deliberately killed service, a load test, and these gaps closed: 2+ api tasks, autoscaling, HTTPS, and a
limited database login.

### Not building

Microservices, Kubernetes, Redis, read replicas and multi-region, until measurements call for them.

### Time

No week estimates: Claude builds this, so the ones here were too human. Real numbers come after the first area is done. Real
time is set by Caleb's approvals, reviews, Apple, phones updating, and proof under real traffic.

## Waiting on Apple's approval of 1.0

Decided by Caleb on Oct 31. **To build, and blocked until the App Store approves the app:**

1. **Add AWS to `/privacy`** ("Where it's kept"), as one of the companies that stores data. It stays unchanged during review.
   Owner: App Store, web & builds, under the App Review guard.
2. **Turn on the Convex backups** once that's live. Backups copy family data to AWS, so `/privacy` has to come first. The job
   is on `main` but not applied. Steps: `infra/README.md`, "Starting the backups". Until then, **there is no scheduled
   backup of Convex**, which still runs on a preview deployment.
3. **Restore test,** after the first export.
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

**Still to prove:** real Claude and Ink in a test window (`infra/README.md`); the deployed site with an HTTPS api; Safari and a real iPhone
recording.

## Open: how long raw footage is kept (`TODO(caleb)`)

**Live GCS `uploads` deletes after 14 days. S3 `uploads` has no such rule, and `SYSTEM-DESIGN.md` says "keep the raw input".** It's a
retention decision that also changes what `/privacy` covers, so it's Caleb's, and nothing has chosen it. **The queue worker assumes the raw
upload is still there for a re-run after a crash, or for a re-run with a better model:** after a 14-day rule, a job re-run later fails
visibly at the upload listing, and past recipes can't be rebuilt from source. Keeping it costs storage and holds more family footage.
Until he decides, staging has no rule, and no real footage is on it.

## Before real data

Before any backfill copies real rows into Postgres:

- Seal `craving_links.token`, `dinners.invite_token` and `shares.token` (SCHEMA.md, M6).
- Caleb decides how long raw footage is kept (above).
- Count violations of every new uniqueness rule, CHECK and domain (SCHEMA.md, section 7).
- The sweep reaches every bucket and row the purge can mark. Today it reaches only anonymous private uploads, so a backfilled file
  would stay marked and undeleted (DISH-MIGRATION.md, known limits).

## Cutover list

Before `aws-migration` reaches `main`:

- `supabase/functions/api/index.ts:931` must accept the new media host: it refuses an `audio_url` not on `BUCKET_URL`, so "Hear
  Dad" from a rewritten recipe fails with a 400. Needs a Supabase deploy, so Caleb's OK.
- `pipeline/account_purge.py`'s `media_objects` must not silently skip a host that isn't GCS, ideally failing loudly on an unknown one,
  before any new-host link exists. Otherwise a deleted account's file on S3 stays.
- Remove the temporary one-way sync of `families`, `people` and `recipes` (SCHEMA.md, M1).
- Install `sentry-sdk` on the laptop's worker, or `import observability` crashes it.
- Give the worker and api a limited database login in place of the master one.
- Pin the workflows' actions to commit SHAs, and add a checksum for the downloaded gitleaks.

## Priorities

**Priorities (Caleb, Oct 31):** phase 0, phase 1, the worker from phase 3, then phases 4-7. **Voice is out of the near-term
work:** homie is switched off, so voice stays on Cloud Run until homie is back on. Not confirmed: whether anything live,
such as build 6, still calls the voice service. Check before anyone proposes turning it off (changing Cloud Run needs
Caleb's OK anyway).

## Phases

| # | Phase | What it needs | Way back |
|---|---|---|---|
| 0 | Safety | Scheduled Convex exports to S3 | Nothing to undo |
| 1 | Our own addresses | DNS change, app 1.1 | Point the addresses back; old URLs still work |
| 2 | Foundation and staging | This PR merged, about $100 a month | `terraform destroy` on staging |
| 3 | Worker off the laptop (voice waits for homie) | Worker code changes | Keep the laptop worker ready; switch back |
| 4 | Media | Copy of the GCS buckets, signer replaced | Addresses point back to GCS |
| 5 | Supabase to RDS | Production database, the shared schema | Supabase stays the source until cutover, read-only after |
| 6 | Convex to Postgres | One area at a time, the shared schema | Per area: route back to Convex |
| 7 | Website off Vercel | S3 + CloudFront, a deploy workflow, a DNS change | Point DNS back to Vercel, kept running for a while |

### 0. Safety
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
Ship `api.homecookd.app`, `media.homecookd.app` and a voice address in app 1.1, alongside the edible-to-homecookd rename.
At first they only forward to today's Supabase, Convex, Cloud Run and GCS, so nothing moves. Every later phase then becomes
a server-side switch with no app release.

Not proven yet: Convex's client keeps a WebSocket open to its own host, and forwarding that through our address has to be
tested on staging before 1.1 depends on it. If it fails, Convex keeps its own URL until phase 6 replaces the client.

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

**Size:** 7,727 lines in `supabase/functions/api/` (Deno), 15 migrations, 21 tables, and 6 references to pg_cron. It's
already Postgres, so `pg_dump` and restore is the easy part. The work is moving the Deno code to Node on Fargate, replacing
pg_cron with EventBridge, and re-running `two_sided_live`, `api-smoke` and `retention_live` against the new host. The
Supabase freeze has to be lifted for this, which is Caleb's call.

Before real data arrives: create a limited app user for `api` and `worker`, and take the RDS master login
(`DB_CREDENTIALS` in `infra/modules/env/services.tf`) out of their tasks. When production deploys start, pin the deploy
workflow's actions to commit SHAs.

### 6. Convex to Postgres
Same shared schema as phase 5.

**Size:** about 11,400 lines, 28 tables, 8 crons, 184 functions (28 queries, 34 mutations, 5 actions, 117 internal), 33
scheduler calls, 47 file-storage calls, and 7,240 lines of tests to carry over.

What makes it hard:
- **Live updates.** Screens subscribe through one helper (`app/src/lib/live/convex.ts:238`), so it's one place to change,
  but the server needs a replacement: job progress, messages and recording state need a WebSocket or polling.
- **Transactions.** Every Convex mutation retries automatically on conflict. Postgres code has to handle this itself.
- **IDs.** Keep Convex's ids as text keys, so links and references carry over.
- **Build 6 and 1.0 phones** call Convex by function name, so Convex stays up until they're gone.

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
What's built, the path table and the switch: `docs/build/WEB-MIGRATION.md`.

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

# Moving homecookd to AWS

Written Oct 31, 2026 (AWS backend chat). Why: long-term reliability, and $10,100 in unused AWS credits ($10,000 expires
Oct 31, 2028; $100 expires Oct 17, 2027). Claude stays billed by Anthropic, and credits don't pay for it.

**Staying outside AWS:** Cartesia, Apple, Expo/EAS, Vercel, Moss for now, and Claude.

## Rules for every phase

- **Caleb's OK in chat, each time, for:** switching live traffic, touching production data, changing DNS, changing Cloud
  Run, Convex, Supabase or GCS, anything likely to add over $300 a month, and deleting anything this work didn't create.
- **While Apple reviews 1.0 (build 6):** no EAS production updates, no Supabase `api` deploy, and nothing that changes
  what build 6 calls.
- **Old addresses stay up until no phone uses them.** Build 6 has them compiled in, so the old services can't be
  turned off when a phase ends. They go only when the app versions that call them are gone.
- Each step has a way back that takes minutes, until the old system is switched off for good.

## How the rewrite ships (Caleb, Oct 31)

One long-lived branch, with one reviewable PR per area merged into it. **Nothing from it reaches `main` or deploys until
Apple approves 1.0.** After approval: app 1.1 with our own addresses first, then each area switches over on its own, with
Convex as its way back until it's proven. Build 6 keeps calling the old services, so they stay up until those phones have
updated. `main` keeps changing `convex/` meanwhile, so the branch merges `main` often and ports each change.

**Before the rewrite starts:** staging fully tested, Convex backups running (phase 0), a real video job measured, and
Caleb's OK on creating production, lifting the Supabase freeze, and any copy of real data into a test database.

**Priorities (Caleb, Oct 31):** phase 0, phase 1, the worker from phase 3, then phases 4-6. **Voice is out of the near-term
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
| 5 | Supabase to RDS | Production database, about 2-4 weeks of work | Supabase stays the source until cutover, read-only after |
| 6 | Convex to Postgres | About 6-10 weeks of work, one area at a time | Per area: route back to Convex |

### 0. Safety
Convex runs on `grand-dragon-649`, a **preview** deployment. Its expiry was cleared on Oct 25, but it is still a preview,
and moving to a Convex production deployment would change the URL that build 6 calls. So: a scheduled
`npx convex export --include-file-storage` to a private, versioned S3 bucket, and one test restore into a throwaway
deployment to prove it works. Exports only read, but Caleb decides where the deploy key may live for this.

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

### 5. Supabase to RDS
**Size:** 7,727 lines in `supabase/functions/api/` (Deno), 15 migrations, 21 tables, and 6 references to pg_cron. It's
already Postgres, so `pg_dump` and restore is the easy part. The work is moving the Deno code to Node on Fargate, replacing
pg_cron with EventBridge, and re-running `two_sided_live`, `api-smoke` and `retention_live` against the new host. The
Supabase freeze has to be lifted for this, which is Caleb's call. **Roughly 2-4 weeks.**

Before real data arrives: create a limited app user for `api` and `worker`, and take the RDS master login
(`DB_CREDENTIALS` in `infra/modules/env/services.tf`) out of their tasks. When production deploys start, pin the deploy
workflow's actions to commit SHAs.

### 6. Convex to Postgres
**Size:** about 11,400 lines, 29 tables, 8 crons, 184 functions (28 queries, 34 mutations, 5 actions, 117 internal), 33
scheduler calls, 47 file-storage calls, and 7,240 lines of tests to carry over. **Roughly 6-10 weeks.** Both estimates are
rough, for agents working with review, and were made without trying any of it.

What makes it hard:
- **Live updates.** Screens subscribe through one helper (`app/src/lib/live/convex.ts:238`), so it's one place to change,
  but the server needs a replacement: job progress, messages and recording state need a WebSocket or polling.
- **Transactions.** Every Convex mutation retries automatically on conflict. Postgres code has to handle this itself.
- **IDs.** Keep Convex's ids as text keys, so links and references carry over.
- **Build 6 and 1.0 phones** call Convex by function name, so Convex stays up until they're gone.

**Order, least-connected first:**
1. Shared Postgres schema, session checks (read from Convex at first), test harness.
2. The kid's web flow (`dishAsks`, `dishAskModel`, `lib/dishAskRoutes`; about 2,800 lines). Plain HTTP, no subscriptions.
3. Community, dinners, cravings, share requests.
4. Messages, questions, story cards, push.
5. Jobs, worker routes, live recording and glasses: the most subscriptions, and the voice service and worker depend on them.
6. Sessions, accounts, Apple sign-in, the purge: last, because everything depends on them.

Each area: copy its data, freeze writes for a short planned window, switch its routes, watch, and keep Convex as the way
back until the area is proven. Tables that cross areas are the risk, so each area's PR lists them first.

## Cost

| | Monthly | Status |
|---|---|---|
| Staging | about $90-100 | Estimate from list prices; the real figure gets logged in `docs/agents/STATE.md` |
| Production at 500 daily users | about $450-850, plus about $14 of storage growth | Rough estimate; not created |

That gives 11-18 months of credits at 500 daily users. Budget alerts email Caleb at $100, $500 and $1,000 of real spend,
with credits excluded so they actually fire.

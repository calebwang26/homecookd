# Finishing the move to AWS

Written Nov 1, 2026 (AWS backend chat). **A draft for review, and nothing here has been run.** The plan is `docs/build/AWS-MIGRATION.md`.

**One merge doesn't finish the migration.** Merging `aws-migration` into `main` puts the new code on `main` and changes nothing live. It can't do more than that, because:

- Families' data sits in Convex, Supabase and GCS. Copying it takes hours of running tools, and someone has to check the copies.
- Production on AWS doesn't exist yet. Creating it is a `terraform apply`, and nothing a merge starts may run one.
- `homecookd.app`, `api.` and `media.` are DNS records, and a merge can't change those.
- Build 6 has its addresses compiled in. Those phones keep calling the old services until people update, and no merge reaches them.

So the merge comes first and the steps below finish the job. Each switch stays off until its step, and each step can be taken back.

**Caleb's two conditions, in his words:** "1. we're building the migration so that RIGHT when our app gets approved, one merge of a branch into main will finish the migration. 2. everything that effects the app store application isn't getting deployed/merged into main."

The second is a hard rule: no merge before Apple approves 1.0. The first is built as closely as is safe: the merge is ready the moment approval comes, and it's safe the moment it lands.

## What the merge itself does

| What runs after a merge | What it does here | Why that's safe | Checked by |
|---|---|---|---|
| Vercel builds `main` for homecookd.app | The same site | Uploads and audio are behind `NEXT_PUBLIC_DISH_UPLOADS`, compiled out when unset. Built in one folder, 60 of main's 63 chunks are identical, and the other 3 differ only by a prop or argument nothing uses without the switch | `dish-e2e.mjs`, and the merge check reads the built bundle |
| Convex deploy, if someone runs it | Adds `POST /sync/page` and `/sync/deletions`, and four internal queries | With `SYNC_READ_SECRET` unset they answer 401 to everyone, before reading the body. No schema change | `convex/syncRead.test.ts`. Never deployed anywhere real |
| The laptop's worker, once restarted | The same Convex mode | `observability.py` does nothing without `sentry_sdk`. `publish.py`'s new branch needs a bucket with `public_base`, and only queue mode's has one | `pipeline/test_worker_no_sentry.py`, `test_publish.py` |
| GitHub Actions | PR checks only | `deploy-staging.yml` and `deploy-web.yml` start on a push to `aws-migration`, never `main`. `deploy-aws.yml` is manual. None runs `terraform apply` | The merge check reads every workflow |
| EAS, App Store, Supabase | Nothing | The branch changes no file under `app/` or `supabase/` | The merge check fails if that changes |
| `voice/`, `cloud/`, glasses | Nothing | The branch changes no file there | The same |
| `api/`, `infra/`, `tools/` | Nothing | Nothing live builds or calls them, and `infra/` only applies by hand | Read by hand. The check doesn't look inside them |

**Auto-ship doesn't apply to this merge** (`docs/agents/MERGE-PLAYBOOK.md`). The Convex deploy and the worker restart wait for Caleb's OK (step 3), under the AWS rule on changing Convex.

## Each area

**Keep this table true:** other drafts are still arriving. "Built" means it's on this branch, as of Nov 1. "Draft" means it isn't on this branch yet. When a draft merges into `aws-migration`, change its row and add its switch. Its files also go on `scripts/merge-safe-list.json` if they touch a watched path.

| Area | State | Its switch (off today) | Doc |
|---|---|---|---|
| Kid's web flow, anonymous routes | **Built.** Passed in Chrome against staging on fake models. `/dish/craving/peek` and craving cards wait for the sync | `NEXT_PUBLIC_DISH_UPLOADS=links` with `NEXT_PUBLIC_DISH_URL=<api>`, in one build | `DISH-MIGRATION.md` |
| One-way sync | **Built,** never run on anything real | `SYNC_READ_SECRET` in Convex env, `SYNC_MODE` on the api task | `SYNC-MIGRATION.md` |
| Worker on queues | **Built,** fakes and local Postgres only. No api route sends it a job yet | The container's entry point, and the worker's `desired_count` (0) | `WORKER-MIGRATION.md` |
| Media copy | **Built,** never run on a real bucket | Its `--real-*` flags | `MEDIA-MIGRATION.md` |
| Website on S3 and CloudFront | **Built,** on staging only | DNS | `WEB-MIGRATION.md` |
| Convex backups | **Built,** not running | `job_count_enabled` | `infra/README.md` |
| Community, dinners, cravings' signed-in side | **Built,** fakes and local Postgres only. No app or site calls it | None yet: the app adapter isn't built | `COMMUNITY-MIGRATION.md` |
| Live updates | **Built** for job progress, fakes and local Postgres only. No app calls it | None yet: the same | `LIVE-UPDATES.md` |
| Messages, questions, push, the table, the recap | **Built,** fakes and local Postgres only. No app calls it, and no Expo or Claude has run against it. Story cards aren't built | None yet: the same | `MESSAGES-MIGRATION.md` |
| Accounts, sessions, sign-in, the purge | **Built,** fakes and local Postgres only. No app calls it, and no real Apple or Google sign-in has run. One gate: the purge can't reach S3's other buckets | `ACCOUNTS_OWNS_PEOPLE` | `ACCOUNTS-MIGRATION.md` |
| Jobs, recipes, recordings: the routes that send the worker its work | **Built,** fakes and local Postgres only, with the real worker's code on the database. Nothing films through it, no app calls it, no real video has run. Writing recordings isn't built (homie is off) | `RECIPE_WRITES` with `moved_at` on `recipes`, and the worker's switch | `JOBS-MIGRATION.md` |

## The steps

In order, and each needs the one before it unless it says otherwise. **OK** marks a step that needs Caleb's OK in chat, each time.

### 1. Apple approves 1.0
- **Who:** Caleb or Salik sees it in App Store Connect. Caleb sets `gh variable set APPLE_APPROVED_1_0 --body yes`, which the check on the PR into `main` reads.
- **Check:** the app's status in App Store Connect.
- **Also starts, in other chats:** stopping the Moss sync (`docs/agents/memory/moss-sync-off-after-approval.md`), upload ownership (`docs/build/UPLOAD-OWNERSHIP.md`), the edible-to-homecookd rename. Tell the AWS backend and Convex & accounts chats.
- **Back:** nothing to undo.

### 2. The merge. OK
- **Who:** the Master Agent approves and merges.
- **Do:** first `git merge origin/main` into `aws-migration`, by PR, and answer anything the check reports. Then:
  ```bash
  gh pr create --base main --head aws-migration --title "The AWS migration, switches off"
  gh pr view --json mergeStateStatus   # CLEAN, with the job merge-safe green
  gh pr merge --merge
  ```
- **Check:** Vercel's production build is green, then `node infra/scripts/web-smoke.mjs https://homecookd.app`. Caleb makes one card with a photo on `/miss`, and his browser's network tab shows `POST /dish/files?kind=photo` to `grand-dragon-649.convex.site` and no `/dish/files/confirm`.
- **Back:** promote the previous deployment in Vercel, which takes seconds. Then `git revert -m 1 <merge commit>` by PR.

### 3. The Convex deploy and the worker restart. OK
Neither changes behavior, and either can wait. Do them when nothing else is going out, so a surprise has one cause.
- **Who:** Master Agent, from a clean copy of merged `main`.
- **Do:** `npx convex deploy --preview-name hackathon -y`, then AGENTS.md's `expiresAt` check. Run `npx convex codegen` and commit it by PR: `convex/_generated/api.d.ts` was edited by hand on the branch. Restart the laptop's worker.
- **Check:** `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://grand-dragon-649.convex.site/sync/page` says `401`. The worker claims and finishes a TEST job.
- **Back:** deploy the previous commit, and restart the worker on it. An old build never calls these routes.

### 4. `/privacy` and the App Store answers. OK
Everything after this copies family data to AWS or sends it to Sentry, so this comes first.
- **Who:** App Store, web & builds, under the App Review guard.
- **Do:** in one PR, the page changes in AWS-MIGRATION's "Waiting on Apple's approval": AWS as a company that stores data, Sentry, and "your one-to-one chats" (a lawyer reads the wording, and how S3's old versions count, `MEDIA-MIGRATION.md`, question 2). "This website runs on Vercel" changes later, at step 12. Caleb or Salik edits the App Store privacy answers, and the PR lists the exact fields.
- **Check:** `curl -s https://homecookd.app/privacy | grep -iE "aws|amazon"`, and App Store Connect shows the new answers.
- **Back:** revert the PR. Before any data has moved, that's all it takes. After, the page has to stay true.

### 5. Backups and the restore test. OK
No area may switch before this passes. Until it does, there's no scheduled backup of Convex.
- **Who:** Claude for Terraform. Caleb runs the key script.
- **Do:** "Starting the backups" in `infra/README.md`: `terraform apply` in `infra/backups`, push the image, `infra/scripts/create-backup-key.sh`, one run by hand, `terraform apply -var job_count_enabled=true`.
- **Check:** the zip is in S3. Restore it into a local Convex backend on Caleb's Mac and compare row counts per table. **Not known:** whether Convex's free plan handles a daily export. Find out on the first run.
- **Back:** `terraform apply -var job_count_enabled=false`.
- **Not tied to this:** the Oct 25 export in `~/Documents/homecookd-backups/` goes by about Dec 24, Caleb's call. It's the only full copy until this runs, so a late approval may force that choice.

### 6. Production. OK
Likely to pass $300 a month (about $450-850 at 500 daily users), so it's his OK twice over.
- **Who:** Claude writes it, Caleb OKs the plan, then Claude applies.
- **Do, first:** give the GitHub `Production` environment required reviewers. Then close the gaps the plan lists for launch: 2 or more api tasks, autoscaling, HTTPS, a limited database login for the worker and api in place of the master one, the workflows' actions pinned to commit SHAs, a checksum for the downloaded gitleaks.
  ```bash
  cd infra/envs/production && AWS_PROFILE=homecookd terraform plan   # Caleb reads this
  AWS_PROFILE=homecookd terraform apply
  ```
  Then Actions, "Deploy to AWS", `production`, `api`, which runs the migrations first.
- **Check:** `/health` and `/ready` over HTTPS. A restore drill, a deliberately killed service and a load test (AWS-MIGRATION, "Before production launch"). Run `dish-api-e2e.mjs` against production with its made-up dish. Production ignores `DISH_FAKE_AI`, so this uses real models at a small cost.
- **Back:** `terraform destroy`, since nothing depends on it yet.

### 7. Our own addresses, forwarding only. OK (DNS)
`api.homecookd.app`, `media.homecookd.app` and a voice address, each forwarding to today's Supabase, Convex, Cloud Run and GCS, so nothing moves.
- **Who:** Claude for the forwarding, Caleb for DNS. Check who hosts the DNS first.
- **Check:** `curl` each one, and compare the answer to the old address's. **Not proven:** forwarding Convex's WebSocket. Test it on staging first. If it fails, Convex keeps its own URL until the area that replaces its client ships.
- **Back:** remove the records. Nothing uses them yet.

### 8. App 1.1. OK
Comes before the areas, as the plan says, so that later switches need no app release. It goes through App Review, so the guard applies.
- **Who:** App Store, web & builds, and App screens & recording.
- **Do:** the app calls our addresses, with the rename. `cd app && npx eas-cli build -p ios --profile production --auto-submit`, then submit for review. **The app's own switch isn't built:** nothing in `app/` knows these addresses yet, because of condition 2.
- **Check:** on a TestFlight build, sign-in, a recording and a recipe all work through the addresses.
- **Back:** point the addresses back at the old services, which works for any phone on 1.1. A bad 1.1 needs an EAS Update or a 1.2.

### 9. The sync. OK (production data)
Copies names, emails, places and family stories into AWS. It needs step 4 live, and step 3's routes.
- **Who:** Claude, with Caleb's OK on the read-only Supabase role.
- **Do:** in this order, `SYNC-MIGRATION.md`, "What's needed before it can run". A staging run with made-up rows against a throwaway Convex deployment. The read-only Supabase key. `SYNC_READ_SECRET` in Convex env, set with the team token:
  ```bash
  CONVEX_OVERRIDE_ACCESS_TOKEN=… npx convex env set --deployment grand-dragon-649 SYNC_READ_SECRET <value>
  ```
  The same value goes in the api's secrets, then `SYNC_MODE=on` on the api task, then the three schedules. Close AWS-MIGRATION's "Before real data" list first.
- **Check:** `sync.reconcile`'s last report: every deletion holding, under 5 rows behind per table, no extra rows. Read Convex's bill after the first day, since a pass reads every recipe.
- **Back:** `SYNC_MODE=deletions` to pause. To stop for good: `deletions`, empty the copies, `off`. Unset the secret and the routes refuse again.

### 10. Media copy. OK (each real run)
Can run alongside step 9. The steps and their ways back are in `MEDIA-MIGRATION.md`, "Order at the switch". In short:
- **Do:** `python media_copy.py sync` as a dry run, so Caleb sees the size and the cost. Pilot on the TEST family. Full copy and a catch-up every 15 minutes. `report --deep` clean. `rewrite`. Fix the three host gates. Then point `media.homecookd.app` at CloudFront.
- **Check:** `report --deep` exits 0, and a phone on 1.1 plays a recipe through `media.homecookd.app`.
- **Back:** point `media.` at GCS, in minutes. Old builds never noticed. The purge has to reach both stores while both exist.

### 11. Each area, one at a time. OK (each)
Least-connected first. Every area passes the five checks in AWS-MIGRATION ("What each area must pass") and has its own short freeze of writes. Convex stays the way back until the area is proven.

| Order | Area | Do | Back |
|---|---|---|---|
| 1 | Kid's web flow | **First build the craving routes and the claim.** The api answers 404 to `/dish/craving/peek` today, so `/miss?c=` would fall back to a plain card that doesn't reach the parent. Copy `dish_asks`. Then one Vercel build with `NEXT_PUBLIC_DISH_URL=https://api.homecookd.app` and `NEXT_PUBLIC_DISH_UPLOADS=links`, both at once: the new api refuses raw files with a 415, and Convex refuses the links | Unset both and rebuild, or promote the previous deployment. **Cards made in between stay on the new side,** so copy them back first, which isn't written |
| 2 | Community, dinners, cravings, share requests | Built, not switchable yet: it needs the adapter and the gates in `COMMUNITY-MIGRATION.md` (reports move once, a way to review them, the daily reminder's schedule). `shareRequests.*` go with Messages | Not written |
| 3 | Live updates, then messages, questions, story cards, push | Built except story cards, not switchable yet: it needs the adapter, `MEDIA_BASE_URL`, `EXPO_ACCESS_TOKEN` and the schedules. Live updates go before what needs them | Not written |
| 4 | Jobs, worker routes, recording, glasses | Built except the recording writes and a plan for videos over 5 GiB (`TODO(caleb)`, `JOBS-MIGRATION.md`). It needs `s3:ListBucket` on `uploads`, `MEDIA_BASE_URL` and the `jobs.sweep` schedule. A real video job first, measured, on Caleb's own footage (`WORKER-MIGRATION.md`). Set `moved_at` on `recipes` in the release that switches the worker | The laptop's worker stays ready, and goes back to polling Convex |
| 5 | Sessions, accounts, Apple sign-in, the purge | Built, not switchable yet. Last, because everything depends on it. A code phone must add itself before anything else: a phone with no person gets no session and can't write as anyone. The live side matches once #245's flag is on, after 1.1 is in the store. The app must warn before a family member's phone deletes a phone-less person, before a move that deletes the faces in `would_delete`, and say what the last signed-in person's going does (App Review guard, `/privacy`, reviewer notes). The TEST family must survive a reviewer's delete. The purge must cover both stores and S3's other buckets, and the sync must call `startDeletion(id, "sync")` | Not written |

**Check each:** the same behavior tests on old and new, old answers compared with new on real requests, and speed targets under load. `sync_copies.moved_at` is set for what moved.

### 12. The website. OK (DNS)
Can go any time after step 4. `WEB-MIGRATION.md`, "The switch and the way back".
- **Do:** list Vercel's env values and copy them, including whichever of the switches above are on by then. `module "web"` in production with `noindex = false`, and a production target in the workflow. A certificate in us-east-1. Test with `curl --resolve`. Lower the TTL a day ahead, then point both names at CloudFront. `/privacy` drops "This website runs on Vercel".
- **Check:** `node infra/scripts/web-smoke.mjs https://homecookd.app`, and tap a real `/i` link on an installed phone.
- **Back:** point DNS at Vercel, in the time the TTL allows. Keep Vercel running for at least a few weeks.

### 13. Phones updating
No command does this. Watch it, and wait.
- **Who:** Caleb decides what's enough.
- **Do:** the old services need to log each app version. **That isn't built, so this should be written before anyone needs the numbers.** A notice or a forced update in the app is a product call, and 1.0 has none.
- **Check:** requests from 1.0 at Convex, Supabase, the signer and GCS over a whole month, since families cook on their own schedule.
- **Back:** nothing moved.

### 14. Turning things off, last. OK (each)
Nothing here has a quick way back, so each waits until no phone calls it. Take a final export of each first.

| What | When | How |
|---|---|---|
| Sync | Every area moved | "How it's removed" in `SYNC-MIGRATION.md` |
| Laptop worker | Jobs proven on the queue | Stop it. Keep the code until Convex goes |
| Supabase | No version calls it, sign-in moved | Lift the freeze (Caleb's call). Export, pause the project, wait, then delete |
| Convex | No version calls it. The backups job goes with it | Export, keep that copy no longer than `/privacy` allows, then shut the deployment down |
| GCS and the signer | No build reads or writes it, and the purge covers S3 | `MEDIA-MIGRATION.md`, step 12 |
| Cloud Run voice | Homie is back on AWS, or stays off. **Not confirmed** whether anything live, such as build 6, still calls it | Check first |
| Vercel | The new site has been calm for weeks | Remove the project. PR previews end, so decide that first |

## What the merge check can't catch

- **What an `EXPO_PUBLIC_*` secret looks like in a local build.** CI can't see the gitignored `app/.env`, and a family code has no key-like shape. So every publish goes through `scripts/safe-eas-update.sh`, which refuses if the family code is set, checks the export, and publishes that same folder. It's only as strong as people using it: nothing stops a hand-run `eas-cli update`. EAS updates are on hold until this is settled (Master Agent, Nov 1).

`scripts/check-merge-safe.mjs`, run by CI as the job `merge-safe`. It fails on: a conflict with main (on the PR into main; a warning on PRs into `aws-migration`), a changed file in a watched path that isn't on `scripts/merge-safe-list.json`, a listed file that changed since its review, a workflow that would run on main or deploy something live, a build that lost today's upload path or holds the new one, a worker that needs Sentry, and sync routes that answer without their secret. Past that:

- **A PR with a conflict starts no checks at all,** because GitHub has no merge commit to run them on. GitHub shows the conflict itself. That's why PRs into `aws-migration` report conflicts with `main` early, as a warning.
- **It doesn't block anything.** With no GitHub Pro, a red check is advice and a person has to read it. Caleb's rule 2 depends on people too: `APPLE_APPROVED_1_0` is what someone set.
- **Vercel's settings aren't in the repo.** CI builds with no `NEXT_PUBLIC_*` set. If Vercel's project already holds one of these switches, the live site differs from what CI read. Check step 2 catches that afterwards, not before.
- **A fingerprint says a file changed, not that the change is safe.** Anyone can paste a new one. It's there so the change shows up in a PR for a person to read.
- **The bundle check reads text.** It looks for strings. A new call under another name, or a change in what a page does, passes. `dish-e2e.mjs` covers far more, but it isn't in CI, because it needs a real browser and a dev server.
- **Paths it doesn't read:** `api/`, `infra/`, `tools/`, `docs/`, tests, and `pipeline/queue_*`. They run nowhere live, but someone can start them by hand: `deploy-aws.yml` offers `production` once its role exists.
- **Real services.** Convex accepting the new routes on a real deploy, real Vercel, and the laptop's own `.venv` and `.env` are outside it. A failed Convex deploy leaves the old code running. **Check by hand on the laptop:** if the root `.env` ever holds both `SENTRY_DSN_WORKER` and `DEPLOY_ENV` and the package gets installed, Convex mode would start sending to Sentry.
- **Meaning.** A clean trial merge can still break something. Main changing a Convex rule the api copied isn't seen here, except where `dishCopies.test.ts` watches.
- **Anything outside this repo that watches `main`.** We found no Cloud Build trigger or other deploy hook in the repo, but one in a console wouldn't show up here.

## What isn't known yet

- How long App Review takes on 1.1, and how long phones take to leave 1.0 and 1.1 behind.
- Whether Convex's WebSocket forwards through our address, and whether Convex's plan handles the daily export.
- What a real video job costs and how long it takes on Fargate. This waits until `/privacy` names AWS (Caleb, Nov 1). Real Claude and Ink, Safari, and a real iPhone recording against the new api.
- Whether a read link's 1 to 2 hours holds on a task's role credentials.
- How to copy a kid's cards made on the new side back to Convex, if the first area has to go back. Today that way back loses them.
- Real sizes and costs: the media dry run, a full sync pass, production's bill.
- Each draft area's own switch and its way back. This file gets its rows as they arrive.

# Moving homecookd to AWS: one switch

Written Nov 1, 2026, rewritten Nov 2 (AWS backend chat). **A plan for review. Only what "Done" lists has run.** The wider plan is `docs/build/AWS-MIGRATION.md`.

**What changed, and why.** On Nov 2 Caleb replaced the area-by-area move with one switch, in his words: "sounds like a plan. we'll switch everything over at the same time". homecookd has no real users yet, and everything in Convex, Supabase and GCS is tests and demos, so moving one area at a time protected nobody. So 1.0 stays unreleased after Apple approves it, 1.1 talks only to the AWS api and is the first public version, and every real family is on AWS from its first day.

## The plan in short

1. **1.0 is held after Apple approves it:** approved, not released. App Store Connect's version release is already set to "Manually release this version" (Caleb confirmed, Nov 2). So no real family ever lands on Convex, Supabase or GCS.
2. **1.1 talks only to the AWS api, for everything:** `EXPO_PUBLIC_BACKEND=aws` and `EXPO_PUBLIC_AWS_URL` (App screens & recording). It's the first public version.
3. **1.1 is proven end to end on TestFlight,** against staging first, then against production.
4. **The demo and test families are copied once, or 1.1 starts fresh.** With so little data, a copy is minutes, not hours.
5. **1.1 is submitted, then released.** Every real user is on AWS from day one.

## Rules that still hold

- **Nothing that affects the App Store build merges to `main`, and nothing deploys live, before Apple approves 1.0.** Caleb's hard rule, in his words: "everything that effects the app store application isn't getting deployed/merged into main" (`docs/agents/memory/aws-migration.md`). The app's AWS code is already on `main` behind `EXPO_PUBLIC_BACKEND=aws`, which is off by default, so every build behaves as before. Nothing from `aws-migration` reaches `main` or production until approval (AWS-MIGRATION.md, "How the rewrite ships").
- **Caleb's OK in chat, each time,** for production, live services (Convex, Supabase, Cloud Run, GCS, Vercel), DNS, real data, real-models windows and new spending. **OK** marks those steps. Staging work inside auto-apply's check needs none (AGENTS.md, "Standing rules for the AWS migration").
- **The Moss sync goes off after approval** (`docs/agents/memory/moss-sync-off-after-approval.md`, Convex & accounts).
- **The Oct 25 export goes by about Dec 24, 2026,** Caleb's call, whatever Apple does (AWS-MIGRATION.md, "Not waiting on Apple").
- **Production is built and proven before 1.1 is submitted** (step 6).
- **The demo families are real people.** One of them, Shreya Pawar's, filmed real cooking. If one of them asks to be deleted after the switch, their GCS files are deleted by hand, within `/privacy`'s 30 days ("After 1.1 is out").

## Done

| Date | What | Where |
|---|---|---|
| Oct 31 | Staging is up: network, Postgres, load balancer, S3 and CloudFront, queues | `infra/envs/staging` |
| Nov 2 | Staging's api and worker log in to Postgres as their own limited users, by IAM token | #273, applied on staging in #280. `infra/README.md`, "Database logins" |
| Nov 2 | HTTPS on staging: `https://d2zh46br3dalyf.cloudfront.net`, CloudFront in front of the load balancer | #285 |
| Nov 2 | Staging's test sign-in for scripts, `POST /v1/test/sign-in` | #285 |
| Nov 2 | Accounts on for staging: `ACCOUNTS_OWNS_PEOPLE=1`, with staging's own link secrets | #285 |
| Nov 2 | CORS on staging for the app's web build, `localhost:8081` to `8083` | #289 |
| Nov 2 | One error shape on every route, and every code listed | #291. `contracts/ACCOUNTS.md`, `contracts/ERROR-CODES.md` |
| Nov 2 | The Accounts contract for 1.1 | #284, `contracts/ACCOUNTS.md` |
| Nov 2 | The app's AWS client and Accounts screens, on `main` behind the switch, proven from the web build against staging | #283, #286, #287, #288, #290, #293, on `main` |
| Nov 2 | 1.0's release set to "Manually release this version" | App Store Connect, confirmed by Caleb |
| Nov 2 | Load test on staging's one small task: 50 a second for 15 minutes met the targets | #270. AWS-MIGRATION.md, "Before production launch" |
| Nov 2 | Overload turns work away with a 503 and `retry-after` (`OVERLOAD_SHED`) | #271 |
| Nov 2 | The api as two tasks that grow to four on CPU, built (production's at 0 until step 6). Not applied: Caleb's staging apply first | #295 |
| Nov 2 | Every workflow's actions pinned to commits, and gitleaks checked by sha256 | #267 |
| Nov 2 | The budget alert's test email reached Caleb | #260 |
| Nov 2 | `envs/production` written for launch: every switch on, the schedules, the secret names, the worker's queue mode, HTTPS waiting on the certificates. Not applied | #335. `infra/README.md`, "Production before launch" |

## The steps

In order, and each needs the one before it unless it says otherwise. Who: **Caleb**; the **Master Agent**; **AWS backend**; **App screens** (App screens & recording); **App Store/web** (App Store, web & builds); **Convex & accounts**.

### 1. Build 1.1 and what it calls, on staging (now)
Before approval. Nothing here changes what build 6 calls.
- **Who:** App screens moves the app onto the api one area at a time, on `main` behind `EXPO_PUBLIC_BACKEND=aws`, working through `docs/build/APP-BACKEND-INVENTORY.md` (on `main`). AWS backend writes each area's contract, as `contracts/ACCOUNTS.md` does for Accounts, and builds what 1.1 calls that the api lacks. App Store/web points the site's pages at the api, on `aws-migration`, behind build-time values, as the kid's web flow already is.
- **Known gaps, Nov 2:**
  - No route sets a person's language, and nothing stores a phone's time zone (ACCOUNTS.md, open items 5 and 6).
  - `jobs` is the only live topic (ACCOUNTS.md, "Live updates"). Each screen 1.1 keeps live needs its topic, or reads on focus.
  - ~~**Recipe writes can't open in production as built.**~~ Fixed Nov 2: `api/src/modules/recipes/switch.ts` opens with `RECIPE_WRITES=on` alone, unless a sync is copying (#300), and `envs/production` sets it (#335).
  - Community's writes that waited for the sync (`setShare`, `setLocation`, the cook's own share tap: COMMUNITY-MIGRATION.md, "Blockers"), if 1.1 uses them. **Nov 2:** her tap and her switch's off are built, behind the recipes switch (`POST /v1/share-requests`, `POST /v1/recipes/:id/unshare`); `setLocation` isn't (contracts/COMMUNITY.md, open item 2). The kid's Community tab is hidden (`docs/agents/memory/community-tab-off.md`).
  - The site's `/r` page reads Supabase's `GET /shares/:token`, and the site posts `/web-events` (`web/src/lib/recipe-web/api.ts`, `audience-route.ts`). The api has `POST /v1/shares/open` and no `/web-events`.
- **Check:** each area's flows from the app's web build and from scripts against staging, as `app/scripts/aws-accounts-flows.mjs` does for Accounts. `cd api && npm test`. `node web/scripts/qa/dish-api-e2e.mjs` against staging. Made-up content only.
- **Back:** nothing live changes. With the switch off every app build behaves as before, and the site's values stay unset.

### 2. Prove 1.1 on TestFlight against staging
- **Who:** App screens makes an internal testers' build (`--profile staging`, which AGENTS.md allows while 1.0 is in review) with `EXPO_PUBLIC_BACKEND=aws` and `EXPO_PUBLIC_AWS_URL=https://d2zh46br3dalyf.cloudfront.net`. Caleb tests it on his iPhone.
- **Check, on a real phone:** Sign in with Apple, a family link, adding someone with no phone, sign-out and back in, a recording, messages and a push, delete account. Then the reviewer's path from the notes, step by step. Made-up content only: CloudFront to staging's load balancer is plain HTTP. A recording's whole job to a recipe needs a real-models window on staging (Caleb's OK each time, `infra/README.md`), or waits for step 8.
- **Back:** stop testing that build. Nothing public changed.

### 3. Apple approves 1.0, and it stays unreleased
- **Who:** Caleb or Salik sees it in App Store Connect. Caleb sets `gh variable set APPLE_APPROVED_1_0 --body yes`, which the check on the PR into `main` reads. The Master Agent tells the chats that wait on approval.
- **Don't press "Release This Version".** The release is manual, so 1.0 waits as Pending Developer Release.
- **Also starts, in other chats:** the Moss sync off (Convex & accounts), and the edible-to-homecookd rename. Upload ownership and #245 were also set to ship here (open question 6).
- **Check:** App Store Connect shows 1.0 as Pending Developer Release, not Ready for Sale.
- **Back:** nothing to undo.

### 4. The merge into `main`, switches off. OK
- **Who:** the Master Agent approves and merges.
- **Do:** first `git merge origin/main` into `aws-migration`, by PR, and answer anything the check reports. Then:
  ```bash
  gh pr create --base main --head aws-migration --title "The AWS migration, switches off"
  gh pr view --json mergeStateStatus   # CLEAN, with the job merge-safe green
  gh pr merge --merge
  ```
- **Check:** Vercel's production build is green, then `node infra/scripts/web-smoke.mjs https://homecookd.app`. Caleb makes one card with a photo on `/miss`, and his browser's network tab shows `POST /dish/files?kind=photo` to `grand-dragon-649.convex.site` and no `/dish/files/confirm`: the site is unchanged.
- **No Convex deploy or worker restart is needed for the switch.** They were for the sync's routes. A later Convex deploy from `main`, such as the Moss switch, carries `/sync/page` and `/sync/deletions`, which answer 401 while `SYNC_READ_SECRET` is unset. With it, run `npx convex codegen` and commit the result by PR (`convex/_generated/api.d.ts` was edited by hand on the branch), then AGENTS.md's `expiresAt` check.
- **Back:** promote the previous deployment in Vercel, which takes seconds. Then `git revert -m 1 <merge commit>` by PR.

### 5. `/privacy` and the App Store answers. OK
Before any real person's data reaches AWS or Sentry: the demo families' copy (step 7), a real video job (step 6) and 1.1's release.
- **Who:** App Store/web, under the App Review guard. Caleb or Salik edits the App Store privacy answers, and the PR lists the exact fields.
- **Do:** in one PR, the page changes in AWS-MIGRATION's "Waiting on Apple's approval": AWS as a company that stores data, Sentry, and "your one-to-one chats" (a lawyer reads the wording, and how S3's old versions count, `MEDIA-MIGRATION.md`, question 2). Raw footage going after 14 days, said accurately. Convex, Supabase, Google Cloud and Vercel stay on the page while they hold anyone's data.
- **Check:** `curl -s https://homecookd.app/privacy | grep -iE "aws|amazon"`, and App Store Connect shows the new answers.
- **Back:** revert the PR. Before any data has moved, that's all it takes. After, the page has to stay true.

### 6. Production, built and proven. OK
Likely to pass $300 a month (about $450-850 at 500 daily users), so it's Caleb's OK twice over. It can start right after step 3. Only its real video job waits for step 5.
- **Who:** AWS backend writes the Terraform and runs the checks. Caleb reads the plan, applies it, and makes the DNS changes.
- **Do, first:** give the GitHub `Production` environment required reviewers (`infra/README.md`, "Before production").
- **Then bring `envs/production` up to what 1.1 needs:** every area's switch on from the start ("What production has on at launch", below), and the gaps AWS-MIGRATION lists for launch. Two api tasks scaling to 4, built in #295 and proven on staging first (`infra/README.md`, "Autoscaling the api"). The bounded wait that also counts event-loop lag (AWS-MIGRATION.md, "A production gate: overload"). The limited database login, on in `envs/production` from the start (`db_iam_login`, proven on staging Nov 2). **Written in #335, not applied.** Caleb's steps, in order (the certificates, the first apply, the secrets, the DNS records, turning the api on, the TEST family): `infra/README.md`, "Production before launch".
  ```bash
  cd infra/envs/production && AWS_PROFILE=homecookd terraform plan   # Caleb reads this
  AWS_PROFILE=homecookd terraform apply
  ```
  Then Actions, "Deploy to AWS", `production`, `api`. Its migrate task runs first, with the master login, and makes the api's and worker's own logins. Then the worker.
  Production's api starts here, not at step 10: its `desired_count` goes from 0 to 2, its autoscaling minimum, because the proofs below and in step 8 need it running. Nothing public calls it until step 10.
- **HTTPS on `api.homecookd.app` and `media.homecookd.app`, Caleb's DNS step.** `homecookd.app`'s DNS is on Vercel (checked Nov 1, ADDRESSES-MIGRATION.md, "Steps for Caleb").
  1. Add `homecookd.app CAA 0 issue "amazon.com"` in Vercel, and keep the three CAA records already there. ACM can't issue a certificate until this exists.
  2. Two certificates: `api.homecookd.app` in us-west-2 for the load balancer (`certificate_arn`), and `media.homecookd.app` in us-east-1 for the media CloudFront (`media_domain`, `media_certificate_arn`). Add each validation CNAME in Vercel exactly as printed, and leave it there for renewals.
  3. After the apply: `CNAME api` to production's load balancer and `CNAME media` to its media CloudFront, with a low TTL first. No record for the apex or `www`: universal links depend on them.

  The certificate sits on the load balancer itself, so the api sees each caller's own address. Staging's CloudFront in front gives everyone one shared address for the per-address limits (ACCOUNTS.md), and production doesn't copy that.
- **Check, the production gate (AWS-MIGRATION.md, "Before production launch"):**
  - `/health` and `/ready` at `https://api.homecookd.app`. `/ready` answers `{"database":"ok"}` with the api on its own login.
  - A restore drill: RDS's backup restored to a new instance, row counts compared, then the copy deleted.
  - A deliberately killed api task: the other one answers, and a new one starts.
  - The load test at production's task size and count, over HTTPS, with a burst that runs out the pool: no 500s, and autoscaling goes from 2 to 4 and back. `infra/scripts/load-test.mjs` has a production mode (#368; the run line is in `infra/README.md`, "Production before launch", step 7): `--production` and `LOAD_TEST_PRODUCTION=yes`, HTTPS to `api.homecookd.app` only, 2 real Claude guesses (about $0.002) and no model call after them. **Still open:** its made-up cards can't be deleted yet, because nothing deletes an anonymous card; a one-off cleanup task by `kid_token_hash` is proposed there, `TODO(caleb)`. Staging's last run passed at 3 to 4 small tasks (AWS-MIGRATION.md, "The run after the slow scale-in").
  - The alarms reach a person: confirm the alerts topic's email subscription, fire one alarm, and see the email arrive. Apple reviews report and block, so one of them is `homecookd-production-community-report` (`aws cloudwatch set-alarm-state --alarm-name homecookd-production-community-report --state-value ALARM --state-reason "test"`), and its email says to run the reports script.
  - `node web/scripts/qa/dish-api-e2e.mjs` against production, with its made-up dish. Production ignores `DISH_FAKE_AI`, so this uses real models at a small cost.
  - Once step 5 is live: a real video job on Caleb's own footage, measured for CPU, memory, disk and minutes. It sets the worker's size, and Fargate or EC2 (WORKER-MIGRATION.md, "How to measure a real job").
- **Also before step 9 (AWS backend):**
  - **The sample library on production's media bucket** (contracts/JOBS.md, open item 15, built in #366). Starting fresh copies nothing, so the bucket has no `library.json`: the api then knows no library dish (a heart, send or share naming a sample is 404, and the recap is 503), and 1.1 falls back to its bundled copy, whose links are GCS's. Once `media.homecookd.app` answers (step 2's PR applied, and its CNAME):
  ```bash
  cd tools/media-copy && pip install -r requirements.txt
  ACCOUNT=$(aws sts get-caller-identity --profile homecookd --query Account --output text)
  python3 sample_library.py --to homecookd-production-media-$ACCOUNT --media-base https://media.homecookd.app   # dry run, from the repo alone: read what it lists
  AWS_PROFILE=homecookd AWS_REGION=us-west-2 python3 sample_library.py --to homecookd-production-media-$ACCOUNT --media-base https://media.homecookd.app --write --library-bucket-caleb-ok
  curl -s https://media.homecookd.app/library.json | head
  ```
  It needs from Caleb: his OK for the `--write`; his pick of samples (`TODO(caleb)`): by default the five made-up ones in `data/synthetic/`, read from the repo. The video samples on GCS (`chicken-biryani`, `gordon-stir-fry`, `gordon-gnocchi`, `gordon-cheesecake`) are YouTube creators' videos: each one is `--from-gcs <id>`, which also needs `--real-buckets-read-only-caleb-ok`, his gcloud login and `google-crc32c`. `weed-steak` isn't a sample, so it's refused. A second run writes only what changed (MEDIA-MIGRATION.md, "The sample library").
  - **The worker's disk** is Fargate's default 20 GB. The env module's `disk_gib` sets more, 21 to 200 GiB (#364); production's worker leaves it unset, with a `TODO(caleb)`. The measured job above (`disk_peak_mb`) says whether 20 is enough, and if not, sets `disk_gib` with the worker's size (WORKER-MIGRATION.md).
- **Back:** nothing depends on it yet. Remove the DNS records, turn off the database's deletion protection (`db_protected`), and `terraform destroy`.

### 7. The demo and test families: copy once, or start fresh. OK (real data)
Caleb picks one.
- **Who:** Caleb decides. AWS backend runs it. App Store/web updates the reviewer notes, under the App Review guard.
- **Either way:** the TEST family that Apple's reviewer uses exists on production, with its faces (Mom, Dad, Grandma, Leo, Maya, Reviewer) and its Chicken Biryani (`docs/agents/memory/app-review-guard.md`), and the reviewer's link that doesn't expire (ACCOUNTS-MIGRATION.md, "What's needed at the switch"). The notes say how 1.1 joins it.
- **The reviewer's link that doesn't expire (#365):** a family's own links last 7 days, so this one is an operator's, made by the one-off task `node dist/reviewerLink.js make <familyId>` on the TEST family once it exists, before step 9. `revoke` turns a leaked one off. The run command, where the link is printed and why: `infra/README.md`, "Production before launch", 8.3.
- **Starting fresh:** nothing is copied, and `EDIBLE_CODE_KEY` can be production's own. The demo families sign in on 1.1 and start over. What's on Convex, Supabase and GCS stays there until those shut down.
- **Copying once:**
  1. A fresh `npx convex export --include-file-storage` first, kept outside the repo, as the snapshot that's copied.
  2. AWS-MIGRATION's "Before real data" list: counts of rows the new schema refuses, link tokens written sealed, and `EDIBLE_CODE_KEY` set to Supabase's value, as on staging, so copied links open.
  3. The rows. **No one-time copy is built:** the sync covers only `families`, `people` and `recipes` (SCHEMA.md, M1), and nothing yet copies the rest of SCHEMA.md section 5 (open question 2).
  4. The media, in one pass of `tools/media-copy` (MEDIA-MIGRATION.md, "How it's run"): the dry run, so Caleb sees the size and the cost; the pilot on the TEST family; `sync --write`; `report --deep`; then `rewrite --media-base https://media.homecookd.app`. No catch-up.
  5. Tell the demo families that what they add on the old app after the copy stays behind.
- **Check:** row counts per table against the export, `report --deep` exits 0, and a demo family's recipe plays on 1.1 through `media.homecookd.app`.
- **Back:** delete the copies from production's database and S3. The originals in Convex, Supabase and GCS never changed.

### 8. Prove 1.1 on TestFlight against production
- **Who:** App screens builds 1.1 with `EXPO_PUBLIC_BACKEND=aws`, `EXPO_PUBLIC_AWS_URL=https://api.homecookd.app` and `EXPO_PUBLIC_BUCKET_URL=https://media.homecookd.app` (where the app reads `library.json`; unset, it's GCS), on the `production-aws` EAS profile (#346), never `production`, which still reaches build 6. This is the build step 9 submits. Caleb tests it. App Store/web builds the site locally with step 10's values: production's api allows `localhost` (DISH-MIGRATION.md).
- **Check:** step 2's list again on production, now with real models: a recording all the way to a recipe, a push, delete account. The reviewer's path from the notes, on the TEST family. A demo family's recipes, if step 7 copied them. The site's pages: a card made on `/miss` and answered on `/a`, a family link on `/i`, a share on `/r`, a dinner on `/d`. Production's alarms stay quiet.
- **Back:** fix it and build again. Nothing public changed. The test people it made are deleted through the app's own delete.

### 9. Submit 1.1. Done (Nov 7)
- **Done:** 1.0 (build 6) was released on Nov 7 at 14:35 PT, and **1.1.0 (build 18, `production-aws`, main `8d4430d0a`)** was submitted as an update at 15:55 PT. It shows **Waiting for Review**, with manual release. How and why: `docs/app-store/SUBMIT-1.1.md`. **Next is step 10**, when Apple approves.
- **Who:** App Store/web. Salik submits.
- **Do:** submit the build that passed step 8, not a new one. Under the App Review guard, in one PR: the per-guideline check (2.1 demo access, 4.8 sign-in, 5.1.1(v) delete account, 5.1.2 data sharing and AI consent), the reviewer notes for 1.1's sign-in (a family link, a name, then Sign in with Apple), the App Privacy answers from step 5, and screenshots of any screen that changed. Set 1.1's release to manual too, so it goes out only at step 10.
- **The plan until Nov 7 (replaced):** App Store Connect won't start a new version while 1.0 waits as Pending Developer Release (open question 1). So this step was going to be: cancel 1.0's pending release (remove it from review, which is allowed from that state), then resubmit **the same version, 1.0, with the AWS build** (a new build number), so no new version is needed. It goes through review again. **What happened instead (Caleb, Nov 7):** 1.0 was released, and the AWS build went in as version 1.1.0, an update, because a first-version review had taken a week. Real families can now join 1.0 on Convex, Supabase and GCS; they start over on 1.1, so there's no marketing until 1.1 is live, and the old stack stays up until then. **The api needs nothing different for this:** in these docs "1.1" means the build that talks only to AWS, whatever version number it ships as. The api never reads the version, and the build number is only counted by `LOG_APP_BUILDS`.
- **Check:** 1.1 shows Waiting for Review. Production stays up and watched while Apple reviews, because the reviewer uses it.
- **Back:** remove 1.1 from review, fix it, submit again.

### 10. Release 1.1, and point the site at the api. Done (Nov 8)
- **Done:** Apple approved 1.1.0, and Caleb released it: live on the App Store at **15:09 PT, Nov 8** (Apple's lookup:
  `currentVersionReleaseDate` 23:09:41Z). On his "Go", App Store/web set the five values in Vercel, Production only:
  `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` and `NEXT_PUBLIC_DISH_URL` at `https://api.homecookd.app`,
  `NEXT_PUBLIC_BUCKET_URL` at `https://media.homecookd.app`, and `NEXT_PUBLIC_DISH_UPLOADS=links`. One production build
  followed: `homecookd-l7rt4md0p` (a redeploy of `homecookd-glnrxk2qr`, which stays the site's way back).
- **Checked:**
  - `web-smoke.mjs`: 86 paths and the extra checks OK.
  - Every JS chunk of nine pages (40) names `api.homecookd.app` and `media.homecookd.app`, and none names Supabase,
    Convex or GCS.
  - CORS allows `homecookd.app` and `www`.
  - A made-up `/miss` card on production went: `POST /dish/files` 201 → PUT to the private S3 bucket 200 →
    `/dish/files/confirm` 201 → `/dish/cards` 201, then Ask Mom and the peeks. There was no failed request and no
    CORS error.
- **Open:** Mom's voice answer on `/a` isn't proven on production yet. The test's hold-to-talk timed out twice. That's
  because this Mac's headless Chrome can't open its fake mic on any site (example.com too), not because of the switch,
  which didn't touch the recorder. Caleb checks it on a phone: open a card's Ask Mom link, hold to talk, then Send.
- Two made-up "Testkid" cards from those runs are in production's dish tables.
- **Who:** Caleb presses "Release This Version" on 1.1. In the same hour, App Store/web sets the site's values in Vercel and builds production once: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` and `NEXT_PUBLIC_DISH_URL` at `https://api.homecookd.app`, `NEXT_PUBLIC_BUCKET_URL` at `https://media.homecookd.app`, and `NEXT_PUBLIC_DISH_UPLOADS=links`. The dish values go in one build: the api refuses raw files with a 415, and Convex refuses the links.
- **Check:** `node infra/scripts/web-smoke.mjs https://homecookd.app`. A card made on `/miss` goes to `api.homecookd.app`: the network tab shows the upload link, the PUT to S3, then `/dish/files/confirm`. A real `/i` link opens 1.1 on an installed phone. The store shows 1.1. The first real sign-ups land in production, and the alarms stay quiet.
- **Back, for the site:** promote the previous Vercel deployment, in seconds. Only for a broken site, and briefly: a kid's card then goes to Convex, where no parent on 1.1 sees it.
- **Back, for the app:** there's no going back to Convex after this, because real families are on AWS only. A problem is fixed forward: production's own rollbacks (the previous task definition, RDS's point-in-time restore), an EAS Update for a JS fix through `scripts/safe-eas-update.sh`, or a new version for a native one (1.1.1 or later:
  Apple closed the 1.1.0 train when it approved 1.1.0, so no new 1.1.0 binary is accepted, TestFlight included).
  - **The first production update (Nov 8, 16:38 PT):** #402 (New message → Add family froze Messages) went to every 1.1
    phone through `safe-eas-update.sh production-aws ... --caleb-ok`, on Caleb's yes. It was published from `690bf30c3`,
    a 1.1.0 commit, with no TestFlight check first, because build 20 couldn't be processed. Branch `production-aws`,
    runtime 1.1.0, update group `0d8055ef-adde-4877-adb7-fd0998801f6e`. Caleb confirmed it on his build-18 phone
    ("works now"). The production api showed no 5xx in the hour after. The second update, #410 (the Copy link freeze, group
    `d8ea50c8-4969-4c25-9d84-74f32a4430a1`, 17:18 PT), went out after Caleb passed it on TestFlight build 1.1.1 (21).
    Phones take it on a launch after they fetch it. Undo: `cd app && npx eas-cli
    update:roll-back-to-embedded --channel production-aws --runtime-version 1.1.0 --platform ios --message "…"
    --non-interactive`.

## What production has on at launch

Each area's switch is on in production from step 6 and stays on through step 8's proof. None of them is a launch step now.

| Area | On in production | Not built or not set yet |
|---|---|---|
| Accounts, sessions, the purge | `ACCOUNTS_OWNS_PEOPLE=1`, `LINK_JOIN_SECRET`, `LEFT_IDENTITY_SECRET` (set before the first sign-up and never changed, or someone who left can't be found when they come back), Apple's revocation keys, `EDIBLE_WEB_URL` at its default `https://homecookd.app`, the hourly `accounts.sweep` | `GOOGLE_CLIENT_IDS` waits for Caleb's Google clients (ACCOUNTS.md, item 8). Dropping Expo Go from `APPLE_AUDIENCES` is his `TODO(caleb)` (item 11) |
| Links: join, craving, dinner, share | `EDIBLE_CODE_KEY`, set once and never changed: a share link is found by a hash keyed from it | If step 7 copies, it must be Supabase's value |
| Recipes, jobs, recordings | `RECIPE_WRITES=on`, `MEDIA_BASE_URL` (the env module sets it from the media address), `s3:ListBucket` on `uploads`, `jobs.sweep` every 5 minutes (staging's is hourly), the worker's queue entry point and a count of 1 or more | The worker's count waits for the measured real job (`TODO(caleb)`). Since Nov 2, `RECIPE_WRITES=on` opens writes by itself (`switch.ts`) |
| Messages, questions, push, story cards | `EXPO_ACCESS_TOKEN`, `messages.hourly`, `messages.daily` | |
| Live updates | `LIVE_OFF` unset | Topics other than `jobs` (step 1) |
| Community | The daily `community.remind_open`, the reports runbook (COMMUNITY-MIGRATION.md, "The team's reports"), and the report alarms, built in the env module (#323): a new report or block emails the alerts topic within minutes, and reports open past 12 hours email once a day | Production's alerts email must be confirmed, and a report alarm's email seen to arrive (step 6, "The alarms reach a person"). The writes that waited for the sync (step 1) |
| Kid's web flow | The site's values (step 10), the dish budget, the hourly `dish.sweep` | |
| Everything | `OVERLOAD_SHED=on`, `platform.prune`, Sentry's DSNs from the first task: production holds only made-up data until step 5 names Sentry, and Sentry gets an error's type and place only | |
| Never in production | `SYNC_MODE` (the sync), `TEST_SIGNIN_KEY` (Terraform refuses it), `APP_WEB_ORIGINS` | |

Since #335 (Nov 2, not applied) `envs/production` sets every api and worker setting, secret name and schedule the middle column lists (the site's values are Vercel's, step 10). Its schedules start with the api, because only the api reads the scheduled queue. `DISH_IP_SALT`, `VOICE_SECRET`, `WORKER_SECRET` and `REPORT_ALERT_TOKEN` are gone from it, and so is the voice service: 1.1 calls none of it while homie is off.

## After 1.1 is out

Not part of the launch. Each needs Caleb's OK, and nothing here has a quick way back, so take a final export of each first.

| What | When | How |
|---|---|---|
| The laptop worker | No one films on 1.0 any more: public 1.0 (build 6) uses it, and it **still runs on the Mac** (Nov 8) | Stop it. Keep the code until Convex goes |
| Convex | Nobody opens an old build, and any copy from step 7 is checked | Export, keep that copy no longer than `/privacy` allows, then shut the deployment down |
| Supabase | The same | Lift the freeze (Caleb's call). Export, pause the project, wait, then delete |
| GCS and the signer | The same | `MEDIA-MIGRATION.md`, step 12 |
| Cloud Run voice | Homie is back on AWS, or stays off. Public 1.0 (build 6) still calls it: homie is on there | Check first. When it goes, drop /privacy's "If your app is still version 1.0" paragraph (added Nov 8) |
| The website's hosting | Not decided: with step 10, or after it (open question 5). It doesn't block 1.1: the site on Vercel calls the api | `WEB-MIGRATION.md`, "The switch and the way back". `/privacy` drops "This website runs on Vercel" then |
| Vercel | The site has moved and been calm for weeks | Remove the project. PR previews end, so decide that first |
| `/privacy` | Each store above, once it holds nobody's data | Drop it from "Where it's kept", under the App Review guard |

**Convex's final export** (Convex & accounts runs it when the Master Agent says, Caleb's OK, before the deployment is shut down). It reads live family data and copies it to this Mac, outside the repo and outside iCloud. Run it from that folder, so the CLI reads no project `.env` and the team token picks the deployment:

```bash
cd /Users/calebwang/GitHub/homecookd/homecookd-backups && \
CONVEX_OVERRIDE_ACCESS_TOKEN=$(grep '^CONVEX_OVERRIDE_ACCESS_TOKEN=' /Users/calebwang/GitHub/homecookd/homecookd/.env | cut -d= -f2-) \
npx convex@1.48.0 export --deployment grand-dragon-649 --include-file-storage \
  --path "grand-dragon-649-final-$(date -u +%Y-%m-%d).zip"
```

- **Where it goes:** `/Users/calebwang/GitHub/homecookd/homecookd-backups/grand-dragon-649-final-<date>.zip`, beside the Oct 25 export. Never into the repo, a session's scratch folder or `~/Documents`.
- **Check it:** `unzip -l` lists every table (28 on Nov 5, from `npx convex data --deployment grand-dragon-649` with the same token) and a `_storage/` folder; write `shasum -a 256` of the zip into a `README.txt` beside it with the date and the table count.
- **How long it's kept:** no longer than `/privacy` allows, then deleted, as the Oct 25 export is (by about Dec 24, 2026).
- **Checked Nov 5:** the team token with `--deployment grand-dragon-649` reads the deployment (`npx convex data`, read-only). The export itself hasn't been run.

**A demo family member who asks to be deleted after the switch:** their account on AWS goes through 1.1's own delete, whose purge reaches every S3 bucket. AWS never reaches GCS, so their GCS files are deleted by hand, within `/privacy`'s 30 days. Their rows still on Convex and Supabase are open question 4.

Every phone still on the old services runs a TestFlight or development build, or is Apple's reviewer. A TestFlight build stops opening 90 days after it's uploaded, and Caleb can ask the testers to move to 1.1. That's how "nobody opens an old build" is known. The count below is optional.

## Counting app builds (`LOG_APP_BUILDS`, the old step 13)

**Built Nov 2 (#275, #282), off.** Supabase's `api` can log which app builds call it. It was the gate for turning old services off while 1.0's phones updated. **With 1.0 never released, it's for one thing only:** seeing whether any tester still opens an old build before Supabase and Convex go. Turning it on is a Supabase `api` deploy, so it's Caleb's OK and optional.

- **What it keeps:** iOS puts the build number in every request's user agent, `homecookd/6 CFNetwork/… Darwin/…` (build 6 is 1.0), so the app needs no change. Each day it keeps one row per platform and build in `app_builds_seen`, for 120 days. Never the user agent, the IP or anything about the person. A browser counts as `web`, Android as `android`, both with no build, and anything else as `other`.
- **Why Supabase's count covers Convex too:** the app calls Convex's functions over its WebSocket, so they never see a request's headers. But every signed-in phone calls Supabase each time it opens (`GET /family`, then `GET /unread` every 15 s while someone is picked), and a phone nobody has signed in on calls neither until it signs in through Supabase.
- **To turn it on:**
  1. By PR on `main`, in `supabase/functions/api/appBuilds.ts`, change `export const LOG_APP_BUILDS: boolean = false;` to `true`. That's the only line.
  2. Apply `supabase/migrations/20261102120000_app_builds_seen.sql`, then deploy `api` from merged `main` with every file in `supabase/functions/api/`, following AGENTS.md's deploy rule.
- **To read it:** Supabase's SQL editor, read-only. Builds seen per day, the last 30 days:
  ```sql
  select day, string_agg(platform || ' ' || build, ', ' order by platform, build) as builds
    from public.app_builds_seen
   where day > (now() at time zone 'utc')::date - 30
   group by day
   order by day desc;
  ```
  The last day build 6 called: `select max(day) from public.app_builds_seen where platform = 'ios' and build = '6';`. Our builds are small numbers, 6, 7 and up. Anything else under `ios` is another app.

  The signer already logs each request's user agent. Cloud Run keeps 30 days of request logs. Read-only, and it prints only the day and the build:
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="edible-upload" AND httpRequest.userAgent:"CFNetwork"' \
    --project=project-11b9fc8a-1108-4ea8-a3b --freshness=30d --limit=100000 \
    --format='value(timestamp.date("%Y-%m-%d"),httpRequest.userAgent)' \
    | awk -F'\t' '{ split($2, ua, " "); split(ua[1], b, "/"); print $1, "build", b[2] }' | sort | uniq -c
  ```
- **Back:** set it to `false` and deploy again. The table can stay.
- **Not seen yet:** a real request's user agent. The parser follows iOS's and React Native's default shape. If a build shows up only as `other`, check one request in Supabase's logs and widen the parser.

## What the merge itself does

| What runs after a merge | What it does here | Why that's safe | Checked by |
|---|---|---|---|
| Vercel builds `main` for homecookd.app | The same site | Uploads and audio are behind `NEXT_PUBLIC_DISH_UPLOADS`, compiled out when unset. Built in one folder, 60 of main's 63 chunks are identical, and the other 3 differ only by a prop or argument nothing uses without the switch | `dish-e2e.mjs`, and the merge check reads the built bundle |
| Convex deploy, if someone runs it | Adds `POST /sync/page` and `/sync/deletions`, and four internal queries | With `SYNC_READ_SECRET` unset they answer 401 to everyone, before reading the body. No schema change | `convex/syncRead.test.ts`. Never deployed anywhere real |
| The laptop's worker, once restarted | The same Convex mode | `observability.py` does nothing without `sentry_sdk`. `publish.py`'s new branch needs a bucket with `public_base`, and only queue mode's has one | `pipeline/test_worker_no_sentry.py`, `test_publish.py` |
| GitHub Actions | PR checks only | `deploy-staging.yml` and `deploy-web.yml` start on a push to `aws-migration`, never `main`. `deploy-aws.yml` is manual. None runs `terraform apply` | The merge check reads every workflow |
| EAS, App Store | Nothing | The branch changes no file under `app/`. 1.1's code reaches `main` through the app chat's own PRs, behind `EXPO_PUBLIC_BACKEND` | The merge check fails if that changes |
| Supabase | Nothing: no merge deploys it | The `api` function's log of app builds is off (`LOG_APP_BUILDS = false`), and its migration only adds an empty table and a daily clean-up. The next `api` deploy carries both, still off | `supabase/tests/appBuilds_test.ts`. The merge check lists each file with its switch |
| `voice/`, `cloud/`, glasses | Nothing | The branch changes no file there | The same |
| `api/`, `infra/`, `tools/` | Nothing | Nothing live builds or calls them, and `infra/` only applies by hand | Read by hand. The check doesn't look inside them |

**Auto-ship doesn't apply to this merge** (`docs/agents/MERGE-PLAYBOOK.md`). Any Convex deploy or worker restart after it waits for Caleb's OK, under the AWS rule on changing Convex.

## What the merge check can't catch

- **What an `EXPO_PUBLIC_*` secret looks like in a local build.** CI can't see the gitignored `app/.env`, and a family code has no key-like shape. So every publish goes through `scripts/safe-eas-update.sh`, which refuses if the family code is set, checks the export, and publishes that same folder. It's only as strong as people using it: nothing stops a hand-run `eas-cli update`. EAS updates are on hold until this is settled (Master Agent, Nov 1).

`scripts/check-merge-safe.mjs`, run by CI as the job `merge-safe`. It fails on: a conflict with main (on the PR into main; a warning on PRs into `aws-migration`), a changed file in a watched path that isn't on `scripts/merge-safe-list.json`, a listed file that changed since its review, a workflow that would run on main or deploy something live, a build that lost today's upload path or holds the new one, a worker that needs Sentry, and sync routes that answer without their secret. Past that:

- **A PR with a conflict starts no checks at all,** because GitHub has no merge commit to run them on. GitHub shows the conflict itself. That's why PRs into `aws-migration` report conflicts with `main` early, as a warning.
- **It doesn't block anything.** With no GitHub Pro, a red check is advice and a person has to read it. Caleb's hard rule depends on people too: `APPLE_APPROVED_1_0` is what someone set.
- **Vercel's settings aren't in the repo.** CI builds with no `NEXT_PUBLIC_*` set. If Vercel's project already holds one of these switches, the live site differs from what CI read. Step 4's check catches that afterwards, not before.
- **A fingerprint says a file changed, not that the change is safe.** Anyone can paste a new one. It's there so the change shows up in a PR for a person to read.
- **The bundle check reads text.** It looks for strings. A new call under another name, or a change in what a page does, passes. `dish-e2e.mjs` covers far more, but it isn't in CI, because it needs a real browser and a dev server.
- **Paths it doesn't read:** `api/`, `infra/`, `tools/`, `docs/`, tests, and `pipeline/queue_*`. They run nowhere live, but someone can start them by hand: `deploy-aws.yml` offers `production` once its role exists.
- **Real services.** Convex accepting the new routes on a real deploy, real Vercel, and the laptop's own `.venv` and `.env` are outside it. A failed Convex deploy leaves the old code running. **Check by hand on the laptop:** if the root `.env` ever holds both `SENTRY_DSN_WORKER` and `DEPLOY_ENV` and the package gets installed, Convex mode would start sending to Sentry.
- **Meaning.** A clean trial merge can still break something. Main changing a Convex rule the api copied isn't seen here, except where `dishCopies.test.ts` watches.
- **Anything outside this repo that watches `main`.** We found no Cloud Build trigger or other deploy hook in the repo, but one in a console wouldn't show up here.

## Open questions

1. **Submitting 1.1 while 1.0 is held: settled (Nov 7).** Caleb released 1.0 and submitted 1.1.0 as an update (step 9). Before that, partly answered (Nov 2): A new version can't be created while 1.0 is Pending Developer Release. A developer who hit it could create the next version only after releasing the pending one. Apple's help lists Pending Developer Release among the states a version can be removed from review, after which a new build can be submitted, so this plan cancels 1.0's pending release and resubmits version 1.0 with the AWS build, which is reviewed again (step 9). No new version is created. Not confirmed: one developer reports that a removed, approved version stayed locked until App Store Connect Support reset it. Caleb or Salik: try it, or ask Support, before step 9. Apple emails a reminder after 30 days in Pending Developer Release. Sources: [App and submission statuses](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses), [Remove a submission from review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review), forum threads [132412](https://developer.apple.com/forums/thread/132412) and [821386](https://developer.apple.com/forums/thread/821386).
2. **Copy or start fresh: decided (Caleb, Nov 2: "All good").** Start fresh on production, and rebuild the App Review TEST family there (step 7). Copying a demo family stays possible by hand if Caleb asks; nothing builds a copy tool.
3. **Convex's scheduled backups: decided (Nov 2).** They keep running until the AWS build is released and Convex is turned off. Then keep one final export (the Oct 25 export deadline still holds) and stop them.
4. **A demo family's deletion: decided (Nov 2).** While Convex and Supabase run, it goes through the old delete path (`convex/account.ts` and `pipeline/account_purge.py`, which clear Convex, Supabase and GCS). After they're off, their GCS files are deleted by hand, within `/privacy`'s 30 days.
5. **The website's hosting: decided (Nov 2).** It stays on Vercel at release (step 10), pointed at the api. Moving hosting comes later, so there's no second DNS change on launch day.
6. **Upload ownership (#215), #245 and `SESSIONS_NEED_OWN_PERSON`: decided (Nov 2), closed.** They harden the old backend, which no real user touches, and the AWS api already enforces the same rules: a session needs the phone's own key and person, and upload links are per person.
7. **Moss on production: decided (Nov 2).** Production sends nothing to Moss at launch. The key names stay, the switch stays off, and it's decided again when homie returns.

## What isn't known yet

- How long App Review takes on 1.1.
- What a real video job costs and how long it takes on Fargate (step 6). Real Claude and Ink, Safari, and a real iPhone recording against the api.
- Whether a read link's 1 to 2 hours holds on a task's role credentials.
- Real sizes and costs: production's bill, and the media dry run if step 7 copies.

## Replaced on Nov 2

What went from the Nov 1 plan, and why. The code stays, and so do the other docs. Their sections listed here are history, not plan.

- **Areas switching one at a time** (the old "Each area" table and step 11), each with its own short freeze of writes and Convex as its way back until proven. With no real users, a staged switch protected nobody. Each area's switch is simply on in production from the start ("What production has on at launch").
- **The adapter that kept 1.0 working against AWS:** the mapping that let an old build's Convex and Supabase calls reach the new api once an area moved. 1.0 is never released, so no public phone runs it.
- **The one-way sync into Postgres** (old step 9). It let areas move before accounts did, while Convex and Supabase stayed the source. Its code stays, with `SYNC_MODE` unset, and it never runs on real data.
- **Media kept in step across two stores** (old step 10): catch-ups every 15 minutes, the purge reaching both stores, and the three host gates (`pipeline/account_purge.py`, Supabase's `index.ts:931`, the glasses' `VIDEO_URL`). At most one pass now, in step 7.
- **AWS reaching GCS for deletions.** A deletion holding GCS links stayed open until something could delete there. Demo families' GCS files are deleted by hand.
- **Forwarding addresses** (old step 7): `api.`, `media.` and a voice address forwarding to Supabase, Convex, Cloud Run and GCS, so later switches needed no app release. `api.` and `media.` now point straight at production (step 6), so the per-address finding and the Convex WebSocket test no longer apply.
- **The Convex deploy and worker restart after the merge** (old step 3). They were for the sync's routes.
- **Convex backups as the gate before any switch** (old step 5). No area switches on Convex's data now. Whether the job still runs is open question 3.
- **The app-build count as the gate for turning things off** (old step 13). Only TestFlight builds use the old services now. It stays built and off, as an option.
- **Old builds' phones setting the pace of shutdown** (old step 14's "no version calls it"). TestFlight's 90 days and the testers set it now ("After 1.1 is out").

**Where each old step went.** Other files still cite the old numbers: `.github/workflows/ci.yml` (step 1), `docs/agents/MERGE-PLAYBOOK.md` (steps 1 to 3), and `docs/build/API.md` and comments in `supabase/` (step 13).

| Old step | Now |
|---|---|
| 1. Apple approves 1.0 (`APPLE_APPROVED_1_0`) | Step 3 |
| 2. The merge | Step 4 |
| 3. The Convex deploy and the worker restart | Gone |
| 4. `/privacy` and the App Store answers | Step 5 |
| 5. Backups and the restore test | Open question 3. Production's restore drill is in step 6 |
| 6. Production | Step 6 |
| 7. Our own addresses, forwarding only | Gone. DNS for `api.` and `media.` is in step 6 |
| 8. App 1.1 | Steps 1, 2, 8 and 9 |
| 9. The sync | Gone |
| 10. Media copy | One pass, in step 7, or none |
| 11. Each area, one at a time | Gone: "What production has on at launch" |
| 12. The website | The site's values switch in step 10. Its hosting: "After 1.1 is out" |
| 13. Phones updating | "Counting app builds" |
| 14. Turning things off, last | "After 1.1 is out" |

**Sections of other docs that are now history:**
- `ADDRESSES-MIGRATION.md`: all of it as a plan, except steps 1 to 3 of "Steps for Caleb: DNS and the certificate" (the CAA record and the certificates), which step 6 uses for production's own addresses. `infra/addresses/` and `modules/front_door/`'s forwarding are never applied. The front door stays as staging's HTTPS.
- `SYNC-MIGRATION.md`: all of it, as a plan.
- `MEDIA-MIGRATION.md`: "Order at the switch" steps 5 and 9 to 11, the catch-up in "How it's run" and "Deletions", the build 6 and Convex rows in "Stored links", and its three host gates. The one pass in "How it's run" and "What it needs before it can run" still hold if step 7 copies.
- `ACCOUNTS-MIGRATION.md`: "From the sync". In "Outside the database", how AWS would reach GCS. In "What's needed at the switch", the GCS gate and "Nothing changes for build 6".
- `COMMUNITY-MIGRATION.md`: the adapter's mapping under "Routes", the recommendation in "Blockers" (an adapter keeps those writes on Convex until the sync), the two-step report review through Convex, and the app line in "What the app and site need at the switch".
- `JOBS-MIGRATION.md`: "What an adapter does with the reply" in "Mapping from each old function", and "The switch for `recipes`" relying on the sync's `moved_at` (step 1).
- `MESSAGES-MIGRATION.md`: the "For the adapter" columns, and blocker 4, an adapter-only path for old builds.
- `LIVE-UPDATES.md`: `live_off` sending a phone back to Convex (ACCOUNTS.md, open item 7), and open question 1, sessions in the sync.
- `DISH-MIGRATION.md` and `WEB-MIGRATION.md`: their pointers to the old steps 11 and 12. The site's switch is step 10.
- `AWS-MIGRATION.md`: updated with this plan.

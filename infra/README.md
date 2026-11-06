# infra/: homecookd on AWS (Terraform)

The plan and its rollbacks are in `docs/build/AWS-MIGRATION.md`. Region: Oregon (`us-west-2`). Login: the `homecookd`
AWS profile, which you refresh with `aws sso login --profile homecookd`.

```
bootstrap/        one-time, account-wide: Terraform's state bucket, the GitHub login, the budget alerts
modules/env/      everything one environment has: network, Postgres, load balancer, S3 + CloudFront, Fargate, SQS,
                  secret names, alarms, roles
modules/web/      the website on S3 + CloudFront, staging only so far (docs/build/WEB-MIGRATION.md)
envs/staging/     the cheap copy: no real keys, no real data
envs/production/  NOT created yet. Applying it needs Caleb's OK ("Production before launch" below)
backups/          daily Convex exports to S3, with their own small network and a key only for this
backup-copy/      a copy in a second region, off by default, never applied (docs/build/REGION-COPY.md; module: modules/bucket_copy/)
addresses/        phase 1's api., media. and voice addresses, off by default, never applied (docs/build/ADDRESSES-MIGRATION.md; module: modules/front_door/)
staging-apply-role/  the login that lets a merge apply staging. Caleb creates it, once ("Merges apply staging" below)
scripts/load-secrets.sh   copies keys from the root .env into Secrets Manager without printing them
scripts/clear-real-keys.sh   overwrites staging's real model keys with a dummy, at the end of a real-models window
scripts/create-backup-key.sh   makes the Convex key for backups and stores it, unseen. Caleb runs it
scripts/web-sync.sh, web-smoke.mjs   publish the website; check a running copy of it
scripts/plan_check.py, test_plan_check.py   the safety check on staging's plans, and its tests
scripts/simulate_apply_role.py   asks AWS's simulator what the apply role can and can't do; read-only
scripts/load-test.mjs   the api's load test: 50 a second for 15 minutes, then a burst; staging on fake models only
```

`.github/workflows/deploy-aws.yml` builds one service and rolls it out. It's manual and stores no keys.
`.github/workflows/deploy-web.yml` publishes the website to staging. It stores no keys either.
`.github/workflows/apply-staging.yml` applies `envs/staging` on a merge, through the safety check. It stores no keys either.

## Commands

```bash
# check the code (no login needed)
cd infra/envs/staging && terraform init -backend=false && terraform validate

# the off-by-default parts' rules, on Terraform's mock provider (no login, no AWS)
cd infra/backup-copy && terraform init -backend=false && terraform test   # also infra/modules/bucket_copy, infra/modules/front_door, infra/modules/env

# the website's CloudFront Function, against a real build
cd web && npm ci && npm run build && cd .. && node --test infra/modules/web/rewrite.test.mjs
node infra/scripts/web-smoke.mjs https://<address> [--noindex]   # reads only; the path table against a running site
node infra/scripts/load-test.mjs http://<staging api> [--rps 50] [--minutes 15] [--burst 300]   # makes 4 made-up cards; refuses production

# first time only
cd infra/bootstrap && AWS_PROFILE=homecookd terraform init && AWS_PROFILE=homecookd terraform apply

# an environment
cd infra/envs/staging
AWS_PROFILE=homecookd terraform init -backend-config="bucket=homecookd-tfstate-$(aws sts get-caller-identity --profile homecookd --query Account --output text)"
AWS_PROFILE=homecookd terraform plan
AWS_PROFILE=homecookd terraform apply
```

## Merges apply staging

**This widens what a merge can do.** Merging into `main` (into `aws-migration` until Nov 6) used to deploy code. Once this is switched on, a merge that
touches `envs/staging` or `modules/` also changes staging's infrastructure, with nobody at a terminal. **So a merge into
`main` is a real gate, and the only thing enforcing it is the Master Agent's review.** We have no GitHub Pro, so GitHub can't
require checks or block a direct push. Anyone with write access can push to the branch, including changes to the check itself.
The role below is what limits the damage when that gate fails. It's worth reading as the real boundary, with the check as the
friendly layer on top.

What happens: `apply-staging.yml` plans the tip of the branch, `scripts/plan_check.py` reads the saved plan, and Terraform applies
exactly that plan. A plan with no changes does nothing.

**What applies by itself** is short, and it's the `AUTO` table in `plan_check.py`: task definitions (settings and sizes), a service's
count, alarms, log groups, queues, schedules, a new secret's name, S3 CORS, lifecycle rules that don't delete sooner, and the website's CloudFront Function.
An autoscaled service's range (its target and policy) is held for Caleb, and its task size is priced at its most tasks.

**What stops and goes to Caleb** with the commands to apply it himself:
1. deleting or replacing a database or a bucket, or a new or shorter lifecycle rule that deletes files (the web bucket excepted)
2. anything outside staging
3. any IAM change: trust or permissions, wider or narrower
4. real models on, anything new open to the public (any change to the network, load balancer, CloudFront distribution or bucket
   policy counts), or a secret's value
5. $50 a month or more added, by list price, counting only fixed charges. Fargate is worked out from size and count; S3, SQS, logs
   and CloudFront depend on use, so they count as $0. Savings don't offset additions. Many small merges can add up, and only the
   budget alerts in `bootstrap/` see that.
6. anything it doesn't recognize: an unknown resource type, a value not known until apply, a Terraform feature it wasn't taught

**The role (`staging-apply-role/`) can't do most of that anyway.** It has no IAM write at all, so it can't change its own trust or
permissions, or give another role more and run code as it. It can't write security groups, routes, load balancers, CloudFront
distributions, bucket policies, or an existing secret's value, can't delete or change the database, and can't delete a bucket. It logs in only from
`apply-staging.yml`, on `main` (on `aws-migration` until Nov 6), in the GitHub environment `staging-infra`.

**If you add a type to `AUTO`**, also add what it needs to the role, list it in `scripts/simulate_apply_role.py`, and ask Caleb to apply
the role. A new type refused until then is working as intended.

**Creating the role, once. Caleb runs this,** after this is merged:

```bash
aws sso login --profile homecookd
cd infra/staging-apply-role
AWS_PROFILE=homecookd terraform init -backend-config="bucket=homecookd-tfstate-$(aws sts get-caller-identity --profile homecookd --query Account --output text)"
AWS_PROFILE=homecookd terraform plan -out=role.tfplan     # should say: 2 to add, 0 to change, 0 to destroy
AWS_PROFILE=homecookd terraform show -json role.tfplan > "$TMPDIR/role-plan.json" && AWS_PROFILE=homecookd python3 ../scripts/simulate_apply_role.py "$TMPDIR/role-plan.json"; rm "$TMPDIR/role-plan.json"   # should end: 0 wrong
AWS_PROFILE=homecookd terraform apply role.tfplan
gh variable set STAGING_INFRA_APPLY --body on --repo calebwang26/homecookd    # the switch; any other value turns it off
gh workflow run apply-staging.yml --ref main --repo calebwang26/homecookd   # a first run: proves the login and the reads, stops after the check, and changes nothing
```

**Things to know:**
- The workflow waits up to 10 minutes on Terraform's lock, then fails and tells Caleb. It never force-unlocks.
- The apply role must be able to read every resource type the plan refreshes, or every apply fails at the plan. `infra/scripts/role_reads.py` lists each type with its reads, and `test_plan_check.py` fails when a type has no row or the role doesn't grant a read. A new type's reads come from a debug plan (`TF_LOG=debug`, each `HTTP Request Sent` line's `tf_resource_type` and `rpc.method`). Granting one is an IAM change, so Caleb re-applies `infra/staging-apply-role`.
- The provider lock file must carry the provider's hashes for Linux, which GitHub's runners are, as well as Macs: the workflow's init can't add them (`-lockfile=readonly`), and its plan then refuses the provider. After changing a provider version, run `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64` in `infra/envs/staging`.
- A deploy from the same merge waits for the apply (`scripts/wait-for-apply.sh`). If the apply is refused the deploy stops, and it's
  re-run from Actions afterward.
- A change to a task definition reaches the service on the next deploy, as before.
- **During a real-models window** or with `voice_count=1` set by hand, a merge plans with the defaults and would undo it. Turning real
  models off needs an IAM change, and reopening the load balancer is a network change, so a real-models window comes back refused and
  emails Caleb. A hand-set `voice_count` just goes back to 0. That's why the switch goes `off` before every window.
- **Alerts:** a refusal or failure emails Caleb through the `homecookd-staging-alerts` topic, and the run goes red. GitHub's own email
  goes only to whoever triggered the run, if they turned it on, so it isn't enough by itself. If the login itself fails, the topic
  can't be reached, and the red run is the only sign.
- **Nov 6: moved to `main`.** `aws-migration` merged into `main` and retired, so the role's `branch` variable, this workflow's branch and staging's `deploy_branch` all say `main` now. The two trust changes are hand applies: `cd infra/staging-apply-role && terraform plan && terraform apply` (the apply role can't change itself), then `cd infra/envs/staging && terraform plan && terraform apply` (`plan_check.py` holds IAM). Each plan is 0 to add, 1 to change: only `refs/heads/aws-migration` becoming `refs/heads/main` in the trust policy. Until both are applied, staging's deploys and applies from `main` fail to log in, and change nothing.

## Starting staging's voice service

Voice is only a smoke test of the setup here (homie is off, and voice stays on Cloud Run for now).

1. `terraform apply` creates everything with `voice_count = 0`.
2. Push the first image, from Actions ("Deploy to AWS") or by hand. Actions needs the repo variable `AWS_ACCOUNT_ID` and
   a GitHub environment named `staging`.
3. `terraform apply -var voice_count=1`, then `curl <load_balancer_url>/health`. Then `terraform apply` again, back to 0.

## Autoscaling the api

The api runs 2 to 4 tasks, on staging now and on production at launch (`modules/env/autoscaling.tf`). AWS adds a task after 3 minutes
with their average CPU over 50%. CPU, not request count, because CPU is what ran out in the load test (`docs/build/AWS-MIGRATION.md`). It also
adds one each minute the api is shedding (10 or more "too busy to answer" lines in a minute), because shedding starts long before 3 minutes of
CPU do. It takes one away after 15 minutes in a row under 25% CPU with nothing turned away, then waits 5 minutes before the next: target
tracking only adds, since in the Nov 2 rerun its own scale-in undid a task shedding had just added (#332). The load balancer checks the api on
its own health thread's port (`health_port`, 8081; `api/src/health.ts`), so a busy task isn't replaced as dead.

**The count is a switch.** For an autoscaled service, `desired_count` (staging's `api_count`) is 0 for off or its `autoscale.min` for
on. Off, the range is 0 to 0; on, it's min to max. Terraform sets the count only when it creates the service. After that the count is
the autoscaler's, and a change to the range moves it into the range at once. Production's launch is its api's `desired_count` from 0
to 2. To stop staging's api: `terraform apply -var api_count=0` (a merge plans the default back, and that comes to Caleb as refused).

**Applying it on staging, once. Caleb, in this order:**
1. Re-apply `infra/staging-apply-role` (the commands under "Merges apply staging"). It adds three autoscaling reads. Do it before step 3:
   once a target exists, every auto-apply refreshes it, and without the reads each one fails at the plan.
2. The merge's auto-apply is refused: autoscaling types are held, the api's service moves to its new block, and its target group's
   drain time changes. Nothing is applied.
3. By hand, in `infra/envs/staging`. The move keeps the running service; without it, Terraform would delete the api and make it again:
   ```bash
   AWS_PROFILE=homecookd terraform state mv 'module.env.aws_ecs_service.service["api"]' 'module.env.aws_ecs_service.scaled["api"]'
   AWS_PROFILE=homecookd terraform plan    # 3 to add (target, policy, below-floor alarm), 1 to change (drain 30 s to 90 s), 0 to destroy
   AWS_PROFILE=homecookd terraform apply
   ```
   The account's first target makes AWS's own role, `AWSServiceRoleForApplicationAutoScaling_ECSService`, and the api goes to 2 tasks.
4. Check: `aws ecs describe-services --cluster homecookd-staging --services api --query 'services[0].[desiredCount,runningCount]'` and
   `aws application-autoscaling describe-scaling-activities --service-namespace ecs`.
5. Prove it: `node infra/scripts/load-test.mjs <staging api> --rps 120`. Two of staging's 0.25 vCPU tasks hold about 60 a second at 50%,
   so it should grow to 3 or 4 within minutes, and go back to 2 about 20 minutes after the test.

**Applying the Nov 2 tuning on staging, once (#304). Caleb, in this order.** It moves the check to the health thread's port, adds the shedding
step policy and its alarm, and sets the CPU target to 50%. No new types, so the apply role needs nothing.
1. The merge's auto-apply is refused: the target groups' checks and the rule letting the load balancer reach 8081 are network changes, and
   autoscaling policies are held. Its deploy stops with it.
2. **Deploy the api first**, from Actions: `gh workflow run deploy-aws.yml --ref main -f environment=staging -f service=api`. The image
   sets `HEALTH_PORT` itself (`api/Dockerfile`), so its tasks answer on 8081 before the check moves there. Applied first, the check would fail on
   every running task until a deploy landed, and ECS would keep replacing them.
3. By hand, in `infra/envs/staging`:
   ```bash
   AWS_PROFILE=homecookd terraform plan    # adds the health port's rule, the step policy and its alarm, and the api's task definition with the port; changes both target groups' checks and the CPU target
   AWS_PROFILE=homecookd terraform apply
   ```
   The rule is made before the check moves (`depends_on`). The new task definition reaches the tasks on the next deploy, and nothing waits on it.
4. Check: `aws elbv2 describe-target-health --target-group-arn "$(aws elbv2 describe-target-groups --names homecookd-staging-api --query 'TargetGroups[0].TargetGroupArn' --output text)"`
   says healthy for every task, and `aws application-autoscaling describe-scaling-policies --service-namespace ecs` lists `-cpu` at 50 and `-shedding`.
5. The rerun at 120 a second, as in step 5 above. `describe-scaling-activities` should show a task added within a few minutes and no task
   "replaced due to an unhealthy status" in `aws ecs describe-services --cluster homecookd-staging --services api --query 'services[0].events'`.

**Applying the slow scale-in on staging, once (#332). By hand, under Caleb's standing OK for staging.** It turns off target tracking's scale-in for the api and adds the
`-scale-in` step policy and its alarm. No new types, so the apply role needs nothing.
1. The merge's auto-apply is refused: autoscaling policies are held, and the new alarm's action is the new policy, not known until apply.
   Nothing is applied.
2. In `infra/envs/staging`:
   ```bash
   AWS_PROFILE=homecookd terraform plan    # 2 to add (the -scale-in policy and its alarm), 1 to change (-cpu's disable_scale_in to true), 0 to destroy
   AWS_PROFILE=homecookd terraform apply
   ```
3. Check: `aws application-autoscaling describe-scaling-policies --service-namespace ecs --query 'ScalingPolicies[].[PolicyName,TargetTrackingScalingPolicyConfiguration.DisableScaleIn]'`
   shows `-cpu` with `true`, and `-scale-in`. `aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking-service/homecookd-staging/api --query 'MetricAlarms[].AlarmName'`
   should list only the high alarm. `homecookd-staging-api-scale-in` sits in ALARM while staging idles at 2 tasks, where it can't take any away.
4. Prove it with the next run at 120 a second: `describe-scaling-activities` should show no task taken away during the load, and then
   one about 15 minutes after it ends and the next 5 minutes later, back to 2.

## Starting the backups

**Waiting on Apple's approval of 1.0:** `/privacy` must list AWS first, and it stays unchanged during review
(`docs/build/AWS-MIGRATION.md`).

1. `terraform apply` in `infra/backups` (schedule off).
2. Push the image from `infra/backups/job` to its ECR repository as `:latest`.
3. Caleb runs `infra/scripts/create-backup-key.sh`. This creates a key on Convex.
4. Run the task once by hand, and check the zip in S3.
5. `terraform apply -var job_count_enabled=true` turns on the daily schedule and the "missed" alarm.

## Pinned actions and tools

Every `uses:` in `.github/workflows/` names a commit, with its release in a comment:
`actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0`. A tag can be moved to other code, and a commit can't. Every
workflow uses the same commit for the same action. gitleaks, the one tool a workflow downloads, is checked against its sha256
before it runs (`ci.yml`, job `secrets`).

To bump an action, read its release notes first, then find the new release's commit:

```bash
gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.type + " " + .object.sha'
# "tag <sha>" is an annotated tag: run gh api repos/<owner>/<repo>/git/tags/<sha> the same way until it says "commit"
```

Put that commit and the release on every line that uses the action, in every workflow. To bump gitleaks, change the version in
its URL and the sha256 next to it, which is the `linux_x64` line of `gitleaks_<version>_checksums.txt` on that release:

```bash
D=$(mktemp -d) && gh release download v<version> --repo gitleaks/gitleaks --pattern '*_checksums.txt' --dir "$D" && grep linux_x64 "$D"/*
```

Not pinned: the `postgres:17` test database image in `ci.yml`, the runner images, and the Terraform version in `ci.yml`'s `infra`
job, which takes the newest.

## Before production

The deploy role trusts the GitHub environment's name, so anyone with write access could run the workflow against an
environment called `production`. **A GitHub environment named `Production` already exists, with no required reviewers**
(probably made by Vercel's deployments; GitHub ignores case in these names). It's harmless while the production deploy
role doesn't exist. ~~**Give it required reviewers (Caleb) before production is created.**~~

**Known gap (Nov 5): GitHub can't give it required reviewers on this plan.** The API answers 422, "the billing plan supports the required
reviewers protection rule": a private repository needs GitHub Team for environment protection rules, as it did for branch protection before Pro. So
nothing stops a run against `production` but the deploy role's own trust (the environment's name, and `main` as its `deploy_branch`). Until the plan
changes, the gate is people: the Master Agent reviews every PR that reaches `main`, and production's deploys and applies run only on Caleb's word in the
AWS backend chat. Add the reviewers if the plan ever allows it: `gh api -X PUT repos/calebwang26/homecookd/environments/Production` with
`reviewers[][type]=User` and Caleb's user id.

## Production before launch

`envs/production` has every area's switch on from the start (`docs/build/CUTOVER.md`, "What production has on at launch") and every task at
0. Each step here is Caleb's: production, DNS and new spending need his OK in chat (AGENTS.md). In order, as CUTOVER.md's step 6.

**1. First.** ~~Required reviewers on the GitHub `Production` environment~~: not available on this plan ("Before production", above, the known gap). Production's deploys log in only from
`main` (its `deploy_branch`), so they wait for CUTOVER.md's step 4, the merge.

**2. The two certificates, before the first apply if possible.** ACM issues them only after a DNS check, so start here. With them in place,
the first apply makes the load balancer's listener on 443 straight away.
1. In Vercel's DNS for `homecookd.app`, add `CAA 0 issue "amazon.com"` on the apex, and keep the three CAA records already there.
2. Ask for both, then read each one's validation record (it can take a few seconds to appear):
   ```bash
   aws acm request-certificate --profile homecookd --region us-west-2 --domain-name api.homecookd.app --validation-method DNS --query CertificateArn --output text
   aws acm request-certificate --profile homecookd --region us-east-1 --domain-name media.homecookd.app --validation-method DNS --query CertificateArn --output text
   aws acm describe-certificate --profile homecookd --region <its region> --certificate-arn <its arn> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   ```
   Add each CNAME in Vercel exactly as printed, and leave it there: ACM renews with it. Then wait for both:
   `aws acm wait certificate-validated --profile homecookd --region <its region> --certificate-arn <its arn>`.
3. By PR, in `envs/production/main.tf` (its `TODO(caleb)`): the us-west-2 ARN as `certificate_arn`'s default, the us-east-1 ARN as
   `media_certificate_arn`'s, and `"media.homecookd.app"` as `media_domain`'s. Defaults, not `-var`: an apply without the `-var` would take
   HTTPS off. A certificate from the wrong region, or a domain without its certificate, is refused at plan. `MEDIA_BASE_URL` follows
   `media_domain`, and `recipe.json` keeps full media links, so this lands before the first real recipe.

If they come after the first apply, the same PR moves the listener from 80 to 443 and adds the redirect on 80. If AWS answers that port 80
already has a listener, apply once more.

**3. The first apply.**
```bash
aws sso login --profile homecookd
cd infra/envs/production
AWS_PROFILE=homecookd terraform init -backend-config="bucket=homecookd-tfstate-$(aws sts get-caller-identity --profile homecookd --query Account --output text)"
AWS_PROFILE=homecookd terraform plan -out=production.tfplan
AWS_PROFILE=homecookd terraform apply production.tfplan
```
It makes the network with one NAT gateway; Postgres (`db.t4g.small` in one zone, lean at launch, Caleb Nov 5; 14 days of restore points, deletion protection, IAM logins
on); the load balancer; the three buckets and the media CloudFront; the queues; every alarm and the alerts topic; the cluster with the api
and the worker at 0 tasks, and their image repositories; the secret names, empty; the roles, including the deploy role GitHub's
`production` environment logs in to; and the migrate task. No schedules (they come with the api, step 7), no voice service, and nothing
runs. Roughly $95 a month at list prices before any task starts, most of it the NAT gateway, the database and the load balancer; about $36 more
with the api's two tasks. The full setup (two NAT gateways, a Multi-AZ `db.t4g.medium`, about $210) is three lines in `envs/production/main.tf`, by PR.

**4. The alarms' email.** AWS sends "AWS Notification - Subscription Confirmation" to caleb.wang26@gmail.com. Click its link: until then
no alarm reaches anyone. Check it no longer says `PendingConfirmation`:
`aws sns list-subscriptions --profile homecookd --region us-west-2 --query "Subscriptions[?contains(TopicArn, 'homecookd-production-alerts')].SubscriptionArn"`.
The api's two health alarms (`-api-no-healthy-tasks`, `-api-below-floor`) are made when it's turned on.

**5. The secrets,** after the apply and before any deploy: a task can't start while a secret it names is empty.
```bash
# Production's own random values, made once and never shown. The script won't replace one that's set.
infra/scripts/make-salt.sh production RATE_LIMIT_SALT EDIBLE_CODE_KEY LINK_JOIN_SECRET LEFT_IDENTITY_SECRET
# Caleb's keys from the root .env, by name. The script refuses production without names, because .env also holds Convex's and Supabase's EDIBLE_CODE_KEY and LINK_JOIN_SECRET.
infra/scripts/load-secrets.sh production ANTHROPIC_API_KEY CARTESIA_API_KEY CARTESIA_API_KEYS_BACKUP SENTRY_DSN_API SENTRY_DSN_WORKER
# Once their lines are in .env (below):
infra/scripts/load-secrets.sh production APPLE_TEAM_ID APPLE_SIGNIN_KEY_ID APPLE_SIGNIN_PRIVATE_KEY EXPO_ACCESS_TOKEN
```

| Name | Value from | Why |
|---|---|---|
| `RATE_LIMIT_SALT`, `EDIBLE_CODE_KEY`, `LINK_JOIN_SECRET`, `LEFT_IDENTITY_SECRET` | `make-salt.sh`, new | Production starts fresh (CUTOVER.md, open question 2), so no copied link or ticket has to open here. Its own values mean nothing from staging or the old services opens on production, and the live ones stay where they are. Each is set before the first sign-up and never changed: share links are found by a hash keyed from `EDIBLE_CODE_KEY`, and someone who left is found again only with the same `LEFT_IDENTITY_SECRET` |
| `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_API_KEYS_BACKUP` | `.env` | Caleb's real model keys. Production always uses real models: it ignores `DISH_FAKE_AI` |
| `SENTRY_DSN_API`, `SENTRY_DSN_WORKER` | `.env` | The same Sentry project as staging; `DEPLOY_ENV` keeps production's issues apart. Sentry gets an error's type and place only (`api/src/sentry.ts`, `pipeline/observability.py`), and production holds no real family before step 5 is live |
| `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY` | Not in `.env` yet: add the key Convex revokes with today (`convex/apple.ts`) | Revoking Sign in with Apple before a delete (App Review 5.1.1(v)). The `.p8` goes on one line, its line breaks written as `\n` (`appleRevoke.ts` reads either) |
| `EXPO_ACCESS_TOKEN` | Not in `.env` yet. `TODO(caleb)`: a token from expo.dev, or ask the AWS backend chat to drop the name | CUTOVER.md lists it for push. This project's pushes go without one today (contracts/MESSAGES.md, "Staging testing") |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | None, on purpose | CUTOVER.md, open question 7: the names stay, production sends nothing to Moss, and no task reads them |

Check which are set, without printing any value:
```bash
export AWS_PROFILE=homecookd AWS_REGION=us-west-2
for S in $(aws secretsmanager list-secrets --filters Key=name,Values=homecookd/production/ --query 'SecretList[].Name' --output text); do
  aws secretsmanager get-secret-value --secret-id "$S" --query VersionId --output text >/dev/null 2>&1 && echo "set:   $S" || echo "empty: $S"
done   # only the two MOSS names stay empty
```

**6. The two addresses.** Once step 2's PR is applied, `AWS_PROFILE=homecookd terraform output dns_targets` prints the two names. In
Vercel: `CNAME api` to its `api` name and `CNAME media` to its `media` name, with a TTL of 60 at first. No record for the apex or `www`:
universal links depend on them. Don't create these before the apply: there's nothing to point at.

**7. Deploy, then turn the api on.** After CUTOVER.md's step 4, with a reviewer approving each run:
```bash
gh workflow run deploy-aws.yml --ref main -f environment=production -f service=api      # its migrate task runs first, with the master login, and makes the api's and worker's own logins
gh workflow run deploy-aws.yml --ref main -f environment=production -f service=worker
```
Both still have 0 tasks. Then a one-line PR in `envs/production/main.tf`, `api_count = 0` to `2`, and Caleb's plan and apply. AWS sets the
api's range to 2 to 4 and starts two tasks on the deployed image, and the apply makes the seven schedules and the api's two health alarms.
```bash
curl -s https://api.homecookd.app/health
curl -s https://api.homecookd.app/ready    # {"database":"ok"}, on the api's own login
aws ecs describe-services --profile homecookd --region us-west-2 --cluster homecookd-production --services api --query 'services[0].[desiredCount,runningCount]'
```
The same line back to 0 stops the api and its schedules. Then the rest of CUTOVER.md's step 6 gate: the restore drill, a killed task, the
load test at production's size over HTTPS (`load-test.mjs` refuses production today, so it needs a change first), one alarm fired to the
email, and `dish-api-e2e.mjs`. Once step 5 is live, the measured real video job sets the worker's size, disk and count (its `TODO(caleb)`).

**8. The TEST family (CUTOVER.md, step 7).** Starting fresh, nothing is copied: Apple's reviewer family is made again on production.
1. Through 1.1 itself, on step 8's TestFlight build: a sign-in with Apple makes the family, and its phone-less faces are added in the app
   (Mom, Dad, Grandma, Leo, Maya, Reviewer, `docs/agents/memory/app-review-guard.md`).
2. Its Chicken Biryani is a real video job, so it waits for step 5. Production has no made-up recipe: `POST /v1/test/recipe` needs
   `TEST_SIGNIN_KEY`, which the env module refuses here.
3. **The reviewer's link that doesn't expire (#365).** A family's own links last 7 days (contracts/ACCOUNTS.md), so this one is an
   operator's, made by `api/src/reviewerLink.ts` as a one-off task with the api's image, as `dist/reports.js` is for reports
   (COMMUNITY-MIGRATION.md, "The team's reports"). No route makes one. `<familyId>` is the TEST family's id, `family.id` in `GET /family`.
   ```bash
   export AWS_PROFILE=homecookd AWS_REGION=us-west-2
   NAME=homecookd-production                                    # homecookd-staging to try it first
   RUN='["node","dist/reviewerLink.js","make","<familyId>"]'
   # RUN='["node","dist/reviewerLink.js","revoke","<familyId>"]'    # a leaked link: it stops at once
   TD=$(aws ecs describe-services --cluster "$NAME" --services api --query 'services[0].taskDefinition' --output text)
   NETWORK=$(aws ecs describe-services --cluster "$NAME" --services api --query 'services[0].networkConfiguration' --output json)
   TASK=$(aws ecs run-task --cluster "$NAME" --launch-type FARGATE --task-definition "$TD" \
     --network-configuration "$NETWORK" \
     --overrides "{\"containerOverrides\":[{\"name\":\"api\",\"command\":$RUN}]}" \
     --query 'tasks[0].taskArn' --output text)
   aws ecs wait tasks-stopped --cluster "$NAME" --tasks "$TASK"
   aws ecs describe-tasks --cluster "$NAME" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text
   aws logs tail "/$NAME/api" --log-stream-names "api/api/${TASK##*/}" --since 1h --format short
   ```
   - **`make`** prints the link once, on its own line (`https://homecookd.app/i?t=<22 characters>`, from `EDIBLE_WEB_URL`), and how many
     people the family has, as a check that the id is the TEST family's (its faces from 8.1, removed ones not counted). Run it again and it prints the same link: the
     token is kept sealed (`join_links.token_enc`), so it can always be shown again and needs no copy anywhere else.
   - **Where the link goes:** only the task's own log stream, which keeps it 30 days, and never in its JSON line. That log is read only by
     the team, who could run `make` again anyway, and the link goes into Apple's reviewer notes. Copy it into the notes, then delete the
     stream if you like: `aws logs delete-log-stream --log-group-name "/$NAME/api" --log-stream-name "api/api/${TASK##*/}"`.
   - **Refused (exit 1), nothing changed:** a family that isn't there or was deleted; another family already has a link with no expiry
     (only the TEST family gets one, so it's a wrong id); or the link can't be opened with this `EDIBLE_CODE_KEY` (`revoke`, then `make`,
     and put the new link in the notes). A wrong word is exit 2 and never reaches the database.
   - **`revoke`** turns it off at once. The family's own 7-day links keep working, and the next `make` is a new link, so the reviewer notes
     change with it.
4. App Store/web writes in the reviewer notes how 1.1 joins it, under the App Review guard.

**Still open for launch, outside this file:**
- ~~Community reports reach nobody on AWS.~~ Built in #323: a report or block logs a line, and a log alarm emails the alerts topic.
  Proven on staging Nov 2. Production gets it with this apply; confirm its alerts email (CUTOVER.md, step 6).
- `infra/scripts/load-test.mjs` refuses production's address, so step 6's load test needs a production mode first (CUTOVER.md, step 6).
- The sample library on production's media bucket (contracts/JOBS.md, open item 15, built in #366). Without it the api knows no library
  dish, and 1.1 shows its bundled copy's GCS links. After step 6, with Caleb's OK for the write and his pick of samples (CUTOVER.md, step 6):
  ```bash
  cd tools/media-copy && pip install -r requirements.txt
  ACCOUNT=$(aws sts get-caller-identity --profile homecookd --query Account --output text)
  python3 sample_library.py --to homecookd-production-media-$ACCOUNT --media-base https://media.homecookd.app   # dry run
  AWS_PROFILE=homecookd AWS_REGION=us-west-2 python3 sample_library.py --to homecookd-production-media-$ACCOUNT --media-base https://media.homecookd.app --write --library-bucket-caleb-ok
  ```
- The worker's disk is Fargate's default 20 GB. The env module's `disk_gib` sets more, 21 to 200 GiB (#364), and `plan_check.py` prices what's past 20.
  Production's worker leaves it unset until the measured real video job (CUTOVER.md, step 6) gives the number (WORKER-MIGRATION.md).

## The kid's web flow on staging

Order matters, because a task can't start while a secret it names has no value: `terraform apply`, then
`infra/scripts/make-salt.sh staging`, then a deploy. It runs with `DISH_FAKE_AI=1`: real S3 and SQS, no model calls, no spend.

**Real models are a test window, with Caleb's OK each time.** The load balancer is plain HTTP, so card tokens and test content cross
it in the clear. So: made-up dishes and voices only, never real family content, and the load balancer is locked to one address.
1. `gh variable set STAGING_INFRA_APPLY --body off`, so a merge during the window can't undo it. Every window, not only long ones.
2. Caleb runs `infra/scripts/load-secrets.sh staging`.
3. `terraform apply -var real_ai=true -var 'alb_allowed_cidrs=["<address>/32"]'`, then a deploy by hand (its smoke test can't reach
   the locked load balancer, so that step fails; check from the allowed address instead).
4. Right after: a plain `terraform apply` and a deploy turn it off and reopen it. Then `infra/scripts/clear-real-keys.sh staging` overwrites the two real keys with a
   dummy, because closing the path isn't removing them, and `STAGING_INFRA_APPLY` goes back on.

The cap is $1 a day on `dish_budget_usd`, plus Mom's overage and calls in flight.

## The app on staging

**The HTTPS address.** iOS won't call plain HTTP, so `module.front_door`'s `api` address is a CloudFront distribution in front of the load balancer, on its
own `cloudfront.net` name with no DNS change: `terraform output front_door_domains`. Nothing is cached. CloudFront to the load balancer is plain HTTP,
fine only because staging holds no real families. Behind CloudFront the api sees CloudFront's address as the caller's, so per-address limits are shared.

**Staging's test sign-in.** Scripts can't do Sign in with Apple, so `POST /v1/test/sign-in` takes `/auth/apple`'s body with a `test_id` in place of the
token, and the `x-test-signin-key` header (`api/src/modules/accounts/testSignIn.ts`, `docs/build/contracts/ACCOUNTS.md`). The route exists only while the
api has `TEST_SIGNIN_KEY`, and the env module refuses that name in production. Its value is Caleb's to make and load, once:
```bash
grep -q '^TEST_SIGNIN_KEY=' /Users/calebwang/GitHub/homecookd/homecookd/.env || echo "TEST_SIGNIN_KEY=$(openssl rand -hex 32)" >> /Users/calebwang/GitHub/homecookd/homecookd/.env
infra/scripts/load-secrets.sh staging TEST_SIGNIN_KEY   # this name only, so the real model keys aren't copied again
infra/scripts/make-salt.sh staging LINK_JOIN_SECRET LEFT_IDENTITY_SECRET   # staging's own random values, never production's
```
**Accounts is on for staging** (`ACCOUNTS_OWNS_PEOPLE=1`): staging runs no sync, so the api owns its people and families, and a sign-up, join or
leave works there. Join links point at staging's own web page (`EDIBLE_WEB_URL`). The two link secrets are staging's own, made by `make-salt.sh`,
so nobody needs to know them, and a link or ticket from staging never opens anywhere else.

Order: the merge that names them (its own deploy waits for an apply that refuses it, IAM), then a hand apply, then the lines above, then an api
deploy. A deploy before the values are loaded can't start a task, and the running ones carry on.

**The website's origins.** `SITE_ORIGINS` on the api (staging: `module.web.url`; production: `homecookd.app` and `www`) lets the site's pages call
`/v1/shares/open`, `/invite/*` and `/dish/*` from a browser (`api/src/cors.ts`). It's the site's exact origins only, never Vercel's previews.
**Test data for the app's screens.** `POST /v1/test/recipe` (the same key and a cook's session) makes a made-up ready recipe, or finishes one of her jobs as the worker would, with small files under `test-recipe-<id>/` in the media bucket (`api/src/modules/recipes/testRecipe.ts`), and `JOBS_SINGLE_PUT_MAX_BYTES` 20 MiB with `JOBS_PART_BYTES` 5 MiB send a 25 MiB video up as 5 parts; the env module refuses both settings in production.

## Database migrations

`api/migrations/*.sql`, run by `api/src/migrate.ts` as a one-off task before each api rollout. A failure stops the rollout.
The task is `homecookd-<env>-migrate`, with that release's image. It's the only one with the master login ("Database logins" below).

## Database logins

The api and the worker each log in to Postgres as their own user, `homecookd_api` and `homecookd_worker`, made by
`api/migrations/078_app_logins.sql`. They read and write rows, and that's all: no schema changes, no roles, no temporary tables, and
no other database the master login owns on the server (RDS's `postgres`). The worker reaches only the tables its jobs use, never
sign-in or messages. Each logs in with an IAM token its task role signs for its own user (`rds-db:connect`), new for each connection,
so no password exists anywhere. Only the migrate task gets the master login (`DB_CREDENTIALS`).

`db_iam_login` moves the api and worker over. Staging has had it on since Nov 2, after the steps below. Production starts with it on: its
first api deploy makes the two users before the api rolls out.

**On staging, in this order.** Database and IAM changes never apply by themselves, so each apply here is Caleb's.
1. This change's merge is refused by the auto-apply. Caleb applies it by hand. The plan turns on IAM logins at the database, adds the
   migrate task and its two roles, adds `rds-db:connect` to the api's and worker's roles, and lets the deploy role run the migrate task
   instead of the api's. The api's and worker's tasks don't change. Until then a deploy runs the migrations in the api's own task, as before,
   because there's no migrate task yet and the api still has the master login.
2. Turn IAM logins on now, not at the next maintenance window. No outage, and the master login keeps working:
   ```bash
   AWS_PROFILE=homecookd aws rds modify-db-instance --db-instance-identifier homecookd-staging --enable-iam-database-authentication --apply-immediately
   AWS_PROFILE=homecookd aws rds describe-db-instances --db-instance-identifier homecookd-staging --query 'DBInstances[0].IAMDatabaseAuthenticationEnabled'   # wait for true
   ```
3. Deploy the api (Actions, "Deploy to AWS", `staging`, `api`). Its migrate task makes the two users. The api still logs in as master.
4. A one-line PR sets `db_iam_login`'s default to `true` in `envs/staging`, so a later merge doesn't plan it back. Its apply is refused
   (IAM: the execution roles stop reading the master secret), and Caleb applies it by hand.
5. Deploy the api, then the worker, so each picks up its new task definition. The deploy's smoke test only reads `/health`, which
   doesn't touch the database, so check `/ready` answers `{"database":"ok"}`. The worker has 0 tasks, so its first run proves its login.

**The way back:** `terraform apply -var db_iam_login=false` (or revert step 4's PR), then deploy the api and the worker. Apply first: an
older task definition with the master login can't start until the execution roles may read its secret again. IAM logins at the
database and the two users can stay. They don't change the master login.

**A later table** is the api's automatically, because the migrate login makes it. The worker gets only what it's granted, so a table the
worker needs is granted to it in the migration that makes it. `pipeline/test_queue_worker.py` and `api/test/jobsWorker.test.ts` run
the real worker as `homecookd_worker`, so a missing grant fails there first.

IAM logins suit fewer than about 200 new connections a second. The api's pool opens far fewer.

## Rules

- Secret values never go in Terraform, because they would land in its state file. It holds the names only.
- A deploy registers its own task definition, so Terraform ignores that field on the service. An env or size change in
  Terraform reaches the service on the next deploy. On an autoscaled service it ignores the count too ("Autoscaling the api"); a
  deploy never sets the count either.
- Staging is plain HTTP on the AWS address until a domain and certificate exist, which needs a DNS change (phase 1). With
  `VOICE_STUB=1` it accepts any token. That's acceptable only while voice is fake and has no real data, and `voice_count`
  stays 0 unless someone is testing.
- Which services can run here today: `api`, `voice` and `worker` have Dockerfiles that build. The worker still needs Convex
  and GCS, so it stays at 0 tasks. The upload signer has no Dockerfile on purpose: the `api`
  takes over its job in phase 4. The glasses ingest has none either: the VM has been stopped since Oct 25, so it waits.

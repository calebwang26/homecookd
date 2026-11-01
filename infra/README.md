# infra/: homecookd on AWS (Terraform)

The plan and its rollbacks are in `docs/build/AWS-MIGRATION.md`. Region: Oregon (`us-west-2`). Login: the `homecookd`
AWS profile, which you refresh with `aws sso login --profile homecookd`.

```
bootstrap/        one-time, account-wide: Terraform's state bucket, the GitHub login, the budget alerts
modules/env/      everything one environment has: network, Postgres, load balancer, S3 + CloudFront, Fargate, SQS,
                  secret names, alarms, roles
modules/web/      the website on S3 + CloudFront, staging only so far (docs/build/WEB-MIGRATION.md)
envs/staging/     the cheap copy: no real keys, no real data
envs/production/  NOT created yet. Applying it needs Caleb's OK
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
```

`.github/workflows/deploy-aws.yml` builds one service and rolls it out. It's manual and stores no keys.
`.github/workflows/deploy-web.yml` publishes the website to staging. It stores no keys either.
`.github/workflows/apply-staging.yml` applies `envs/staging` on a merge, through the safety check. It stores no keys either.

## Commands

```bash
# check the code (no login needed)
cd infra/envs/staging && terraform init -backend=false && terraform validate

# the off-by-default parts' rules, on Terraform's mock provider (no login, no AWS)
cd infra/backup-copy && terraform init -backend=false && terraform test   # also infra/modules/bucket_copy, infra/modules/front_door

# the website's CloudFront Function, against a real build
cd web && npm ci && npm run build && cd .. && node --test infra/modules/web/rewrite.test.mjs
node infra/scripts/web-smoke.mjs https://<address> [--noindex]   # reads only; the path table against a running site

# first time only
cd infra/bootstrap && AWS_PROFILE=homecookd terraform init && AWS_PROFILE=homecookd terraform apply

# an environment
cd infra/envs/staging
AWS_PROFILE=homecookd terraform init -backend-config="bucket=homecookd-tfstate-$(aws sts get-caller-identity --profile homecookd --query Account --output text)"
AWS_PROFILE=homecookd terraform plan
AWS_PROFILE=homecookd terraform apply
```

## Merges apply staging

**This widens what a merge can do.** Merging into `aws-migration` used to deploy code. Once this is switched on, a merge that
touches `envs/staging` or `modules/` also changes staging's infrastructure, with nobody at a terminal. **So a merge into
`aws-migration` is a real gate, and the only thing enforcing it is the Master Agent's review.** We have no GitHub Pro, so GitHub can't
require checks or block a direct push. Anyone with write access can push to the branch, including changes to the check itself.
The role below is what limits the damage when that gate fails. It's worth reading as the real boundary, with the check as the
friendly layer on top.

What happens: `apply-staging.yml` plans the tip of the branch, `scripts/plan_check.py` reads the saved plan, and Terraform applies
exactly that plan. A plan with no changes does nothing.

**What applies by itself** is short, and it's the `AUTO` table in `plan_check.py`: task definitions (settings and sizes), a service's
count, alarms, log groups, queues, schedules, a new secret's name, S3 CORS, lifecycle rules that don't delete sooner, and the website's CloudFront Function.

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
`apply-staging.yml`, on `aws-migration`, in the GitHub environment `staging-infra`.

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
gh variable set STAGING_INFRA_APPLY --body on --repo calebwang26/hackathon-homecookd    # the switch; any other value turns it off
gh workflow run apply-staging.yml --ref aws-migration --repo calebwang26/hackathon-homecookd   # a first run: proves the login and the reads, stops after the check, and changes nothing
```

**Things to know:**
- The workflow waits up to 10 minutes on Terraform's lock, then fails and tells Caleb. It never force-unlocks.
- A deploy from the same merge waits for the apply (`scripts/wait-for-apply.sh`). If the apply is refused the deploy stops, and it's
  re-run from Actions afterward.
- A change to a task definition reaches the service on the next deploy, as before.
- **During a real-models window** or with `voice_count=1` set by hand, a merge plans with the defaults and would undo it. Turning real
  models off needs an IAM change, and reopening the load balancer is a network change, so a real-models window comes back refused and
  emails Caleb. A hand-set `voice_count` just goes back to 0. That's why the switch goes `off` before every window.
- **Alerts:** a refusal or failure emails Caleb through the `homecookd-staging-alerts` topic, and the run goes red. GitHub's own email
  goes only to whoever triggered the run, if they turned it on, so it isn't enough by itself. If the login itself fails, the topic
  can't be reached, and the red run is the only sign.
- When `aws-migration` merges to `main` and goes away, the role's `branch` variable and this workflow's branch change together.

## Starting staging's voice service

Voice is only a smoke test of the setup here (homie is off, and voice stays on Cloud Run for now).

1. `terraform apply` creates everything with `voice_count = 0`.
2. Push the first image, from Actions ("Deploy to AWS") or by hand. Actions needs the repo variable `AWS_ACCOUNT_ID` and
   a GitHub environment named `staging`.
3. `terraform apply -var voice_count=1`, then `curl <load_balancer_url>/health`. Then `terraform apply` again, back to 0.

## Starting the backups

**Waiting on Apple's approval of 1.0:** `/privacy` must list AWS first, and it stays unchanged during review
(`docs/build/AWS-MIGRATION.md`).

1. `terraform apply` in `infra/backups` (schedule off).
2. Push the image from `infra/backups/job` to its ECR repository as `:latest`.
3. Caleb runs `infra/scripts/create-backup-key.sh`. This creates a key on Convex.
4. Run the task once by hand, and check the zip in S3.
5. `terraform apply -var job_count_enabled=true` turns on the daily schedule and the "missed" alarm.

## Before production

The deploy role trusts the GitHub environment's name, so anyone with write access could run the workflow against an
environment called `production`. **A GitHub environment named `Production` already exists, with no required reviewers**
(probably made by Vercel's deployments; GitHub ignores case in these names). It's harmless while the production deploy
role doesn't exist. **Give it required reviewers (Caleb) before production is created.**

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

## Database migrations

`api/migrations/*.sql`, run by `api/src/migrate.ts` as a one-off task before each api rollout. A failure stops the rollout.

## Rules

- Secret values never go in Terraform, because they would land in its state file. It holds the names only.
- A deploy registers its own task definition, so Terraform ignores that field on the service. An env or size change in
  Terraform reaches the service on the next deploy.
- Staging is plain HTTP on the AWS address until a domain and certificate exist, which needs a DNS change (phase 1). With
  `VOICE_STUB=1` it accepts any token. That's acceptable only while voice is fake and has no real data, and `voice_count`
  stays 0 unless someone is testing.
- Which services can run here today: `api`, `voice` and `worker` have Dockerfiles that build. The worker still needs Convex
  and GCS, so it stays at 0 tasks. The upload signer has no Dockerfile on purpose: the `api`
  takes over its job in phase 4. The glasses ingest has none either: the VM has been stopped since Oct 25, so it waits.

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
scripts/load-secrets.sh   copies keys from the root .env into Secrets Manager without printing them
scripts/create-backup-key.sh   makes the Convex key for backups and stores it, unseen. Caleb runs it
scripts/web-sync.sh, web-smoke.mjs   publish the website; check a running copy of it
```

`.github/workflows/deploy-aws.yml` builds one service and rolls it out. It's manual and stores no keys.
`.github/workflows/deploy-web.yml` publishes the website to staging. It stores no keys either.

## Commands

```bash
# check the code (no login needed)
cd infra/envs/staging && terraform init -backend=false && terraform validate

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
1. Caleb runs `infra/scripts/load-secrets.sh staging`.
2. `terraform apply -var real_ai=true -var 'alb_allowed_cidrs=["<address>/32"]'`, then a deploy by hand (its smoke test can't reach
   the locked load balancer, so that step fails; check from the allowed address instead).
3. Right after: a plain `terraform apply` and a deploy turn it off and reopen it.

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

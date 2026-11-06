# A backup copy in a second AWS region

Step 8 of `docs/build/AWS-MIGRATION.md`. The code is `infra/backup-copy/` and `infra/modules/bucket_copy/`. **A draft: it has never been
applied.** Plans ran read-only, and its rules are tested with Terraform's mock provider (`terraform test`), never on real buckets.

## What it is

Off until a variable names something. With no variables it creates nothing.

| Variable | Turns on | Who decides |
|---|---|---|
| `source_environments = ["production"]` | `media`, `uploads`, `private`, and the database's backups | Caleb: production data |
| `source_environments = ["staging"]` | The same, for a short drill only (below) | Whoever runs the drill |
| `copy_convex_backups = true` | The Convex backups bucket | Caleb, after `/privacy` lists AWS |

The copy goes to `us-east-1` by default. RDS copies its snapshots and transaction logs there, in backups encrypted with a key in that
region. S3 replicates new files and delete markers to a versioned bucket there, in Standard-IA.

**It holds only what's already in AWS.** Today that's fake staging data. Real family data sits in GCS, Convex and Supabase, so this
protects none of it until the Convex backups or production are running. Convex's copy is the first with real data.

## How deletions reach the copy

`/privacy` says "we delete your data within 30 days, and it leaves our backups within 30 more". S3 replication doesn't simply mirror
deletes, so each case is listed here. Sources: AWS's "What does Amazon S3 replicate?" and "Replicating delete markers between buckets".

| On the source | Does it reach the copy? | What happens to the bytes in the copy |
|---|---|---|
| A delete by key: the purge, a cancel, the api, `tools/media-copy` | Yes. The rule turns on delete marker replication | Hidden at once, gone 21 days later by the copy's own rule |
| An overwrite | Yes, as a new version | The old one is gone 21 days later |
| A delete **with a version id** | **No.** AWS doesn't replicate it, on purpose | **Stay in the copy forever** |
| A lifecycle rule removing an old version | No | The copy's own rule removes it |
| A lifecycle rule expiring a live file (the Convex backups' 21 days) | **No.** Markers made by lifecycle aren't replicated | The copy has the same 21 + 7 days of its own |
| A delete while replication is off, or a marker that failed | **No**, and nothing retries it | **Stay in the copy forever** |

**The timeline.** A deleted account's files, at the latest:

| | Bytes gone by about |
|---|---|
| Purge runs, marker on the source and in the copy (minutes, no promised time) | Day 30 |
| The copy's old version expires (21 days) | Day 51-53 |
| The source's old version expires (28 days, already the case) | Day 58-60 |
| Database rows in the copy's backups (7 days after the purge) | Day 37-38 |
| Convex exports in the copy (the last one holding them, 21 + 7 days) | Day 58-60, same as the source |

The copy keeps old versions for 21 days, 7 fewer than the source. That leaves about a week for a late marker, which the source's 28 days
doesn't have. S3 runs lifecycle rules about daily and can be late. `db_copy_days` and `old_version_days` refuse anything over 28.

**What this asks of other code, and what would break the promise:**

1. **Nothing may delete from these buckets by version id alone.** Everything today deletes by key (`api/src/storage.ts`,
   `pipeline/queue_aws.py`, `tools/media-copy`). The purge for S3 isn't written yet (`WORKER-MIGRATION.md`, question 7). If question 2 in
   `MEDIA-MIGRATION.md` ever adds `DeleteObjectVersion` to a purge, that purge must delete by key first, or the copy keeps the file.
2. **The purge for S3 should also delete by key from the copy, once it exists.** A file with no age rule has nothing else to remove it if
   a marker is lost. A live file can't have an age rule here, because that would delete a family's videos from the copy. This is the
   strongest guard, and it isn't built, because the purge it belongs in isn't written.
3. **If `uploads` gets an age rule** (`AWS-MIGRATION.md`, how long raw footage is kept), set `uploads_expire_days` to the same number the same
   day. S3 won't carry it over.
4. **If replication is ever off while real data is being deleted,** the deletes during that gap never arrive. Empty the copy and fill it again
   with S3 Batch Replication, and don't just turn the rule back on.

Old versions count as backups here, the same reading as `MEDIA-MIGRATION.md` question 2, which a lawyer should confirm.

**`/privacy`:** the copy is still AWS, so it's no new company once AWS is listed. It doesn't name a region today, so no wording changes. Who stores
data is unchanged by this, and it can't start before AWS is listed anyway (`AWS-MIGRATION.md`, "Waiting on Apple's approval").

## What it protects against

The rows below extend the table in `SYSTEM-DESIGN.md`. That table says region loss "isn't covered until the second-region backup exists", and it stays
true until this is applied and a restore has worked.

| What fails | With the copy | Not covered |
|---|---|---|
| **Oregon is lost for good, or for days** | The database restores in `us-east-1` from the copied backups. Files are in the copy | Anything not replicated yet. **No RPO is promised:** check `RestoreWindow.LatestTime`, and S3's is usually minutes without a promise |
| Files or rows deleted by mistake | Already covered in Oregon. The markers replicate too, so the copy adds little | After 21 days in the copy and 28 on the source, they're gone |
| A bad release overwrites files | Old versions in both places, 21 and 28 days | Past that |
| **A stolen admin login, or the account closed** | **Nothing.** Both regions are one account. Only a separate account helps (below) | Everything |
| A live store other than AWS fails (Convex, GCS, Supabase) | Convex's backups, if turned on | GCS and Supabase's data |

**It's a backup and doesn't keep the service running.** Nothing serves from `us-east-1`. Bringing homecookd back there also needs: a new environment root for that
region, images rebuilt (ECR is only in Oregon), secrets reloaded from `.env` (`infra/scripts/load-secrets.sh`), and a Terraform state bucket (the current one
is in Oregon). The addresses in phase 1 are what let phones follow without an app release. **There's no recovery time target for region loss.** A
guess of a day, unproven until someone runs it. A failover isn't being built, in line with SYSTEM-DESIGN ("multiple regions stay out").

## The drill on staging

About an hour, on fake data, with nothing else touched:

```bash
cd infra/backup-copy
AWS_PROFILE=homecookd terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
AWS_PROFILE=homecookd terraform apply -var 'source_environments=["staging"]'
```

1. Put a test file in `homecookd-staging-media-<account>` and see it in the copy, timing it.
2. Delete it by key, and see a delete marker in the copy.
3. Restore the database: `aws rds restore-db-instance-to-point-in-time --region us-east-1 --source-db-instance-automated-backups-arn <arn> --target-db-instance-identifier copy-drill --use-latest-restorable-time`. The arn is in `aws rds describe-db-instance-automated-backups --region us-east-1`. Record the time it took and how far behind it was, then delete `copy-drill`.
4. Turn it off with a plain `terraform apply`. **It stops at a bucket with anything in it, which is on purpose** (no `force_destroy`): empty those by hand, including versions, and apply again.

## When an alarm fires

Each bucket has two: `<name>-failed` (a file or a delete marker didn't arrive) and `<name>-behind` (over 6 hours behind). Each topic sends one
confirmation email when it's created, so click both.

1. Look at the source's Metrics tab, and check that the replication role and the copy bucket still exist. A stopped rule is the usual cause.
2. For `-failed`, S3's metric doesn't name the files. List what's live in the copy and not on the source with `aws s3api list-objects-v2` on both, and delete those keys from
   the copy by key. A file on the source and not in the copy can go by S3 Batch Replication.
3. The database has no alarm here. Check `RestoreWindow.LatestTime` monthly until one is added. Its failures show as RDS events, which aren't wired up.

## Cost: estimates at list prices

Prices were read from the AWS Price List API on Nov 1, 2026, for `us-east-1`. Sizes are guesses, because nothing has measured them. AWS credits pay for all of it.

| Item | Price |
|---|---|
| Files in Standard-IA | $0.0125 per GB-month, 30-day minimum per file |
| New bytes moved from Oregon to Virginia | $0.02 per GB, once |
| Writes into Standard-IA | $0.01 per 1,000 |
| Database backups in the copy's region | $0.095 per GB-month. RDS's free allowance follows storage in that region, so assume none |
| Replication metrics | 4 per bucket, at $0.30 each |
| Alarms, the key | $0.10 per alarm, $1 |
| Reading back in a disaster | $0.01 per GB in Standard-IA |

| Scenario | Files stored | New files a month | Database | **Estimate a month** |
|---|---|---|---|---|
| Staging left on (it shouldn't be) | 1 GB | none | 1 GB | **about $5** |
| Staging drill, 1 hour | | | | **under $1** |
| Production, first month | 100 GB | 20 GB | 10 GB | **about $8** |
| Production, 500 daily users, early | 1 TB | 600 GB | 50 GB | **about $36** |
| The same, a year later | 7 TB | 600 GB | 100 GB | **about $115** |
| Convex backups, added on top | 140 GB (5 GB a day, 28 days; a guess) | | | **about $6** |

600 GB a month comes from the "about $14 of storage growth" in `AWS-MIGRATION.md`. It stays under the $300 line until roughly 20 TB. Turning it on before files are copied in
avoids a Batch Replication job, which only covers files that were there first (about $0.02 per GB plus a small per-file fee, from memory).
S3 Replication Time Control, a 15-minute promise for files, is off: it adds about $0.015 per GB (from memory) and doesn't cover delete markers.

## A separate account is stronger

One account means one stolen admin login, or one closed account, reaches both copies. A second account is the real protection against that, and **only Caleb can
create one.** What it would take:

1. Caleb creates a member account in AWS Organizations, with its own root email and SSO access only for him. Check first whether the
   $10,100 in credits covers a member account. Not verified.
2. `provider "aws" { alias = "copy" }` assumes a role in that account. S3 stays in `bucket_copy`, adding: `destination.account`, `access_control_translation { owner = "Destination" }`,
   `s3:ObjectOwnerOverrideToBucketOwner` on the role, and a bucket policy letting the role replicate. Delete markers need the same setting across accounts, or the deletion promise breaks.
3. **RDS can't do this.** Cross-Region automated backups stay in the same account. It would need AWS Backup copying to a vault in that account, with a retention under 28 days,
   or scheduled snapshots shared with a customer key.
4. The source account gets no delete rights in the new one, and the new account's expiry rules still run, so the promise holds.
5. Same costs, plus AWS Backup's for the database if used.

**Recommendation:** start in the same account, since a region is what SYSTEM-DESIGN asks about. Add the separate account before real families' files are the only copy, because that's
when the stolen-login case matters most.

## Not verified

- Nothing has been applied: S3 accepting this exact rule, RDS accepting the customer key on a Postgres 17 instance, the alarms firing, and real timing are all unproven.
- Whether a replica's 21 days count from the source's delete or from the marker's arrival. Either way it's within the margin above.
- RDS's cross-region transfer price: AWS's page says transfer charges apply, without a number. The estimate uses the $0.02 above.

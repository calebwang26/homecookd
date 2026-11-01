# Moving homecookd's media to S3

Written Oct 31, 2026 (AWS backend chat). This is phase 4 of `docs/build/AWS-MIGRATION.md`. The tool is `tools/media-copy/`. **It has
never run against a real bucket.** It has run against fakes, moto and a local fake-gcs-server only.

## What it does

It copies `edible-media-*` and `edible-uploads-*` to S3 under the same keys, and keeps them in step until the switch. It only reads
GCS. Every run is a full comparison of a GCS listing against its ledger, so it needs no change on Google's side.

Not covered: Convex's `_storage` files and Supabase's voice notes and photos (SCHEMA.md, section 5, items 6 and 9). They aren't in
these buckets, and they move with phases 5 and 6 under the same deletion rule.

From the media bucket it leaves out `jobs/`, `trash/`, `cancellations/` and `deletions/`. Nothing on S3 reads the status files or the
worker's markers, the status files hold a cook's name and dish, and `trash/` is recipes someone deleted. Everything in that bucket is
public through CloudFront, as it is on GCS today. Custom GCS object metadata isn't copied, because nothing reads it.

## How it's run

```bash
cd tools/media-copy && pip install -r requirements.txt
M="--state /path/outside/repo/media.sqlite --map edible-media-379797517579=homecookd-production-media-<account> --map edible-uploads-379797517579=homecookd-production-uploads-<account>"

python media_copy.py sync $M --real-buckets-read-only-caleb-ok                       # dry run: what changes, what it costs
python media_copy.py sync $M --write --only-prefix <test-recipe>/ --real-family-media-caleb-ok-privacy-lists-aws   # pilot
python media_copy.py sync $M --write --max-cost-usd <from the dry run> --real-family-media-caleb-ok-privacy-lists-aws
python media_copy.py report $M --deep --real-buckets-read-only-caleb-ok              # exits 1 if anything differs or it's gone stale
python media_copy.py rewrite $M --media-base https://media.homecookd.app --real-buckets-read-only-caleb-ok   # dry run
```

The catch-up is the same `sync --write`, from cron every 15 minutes, with `report` after it. Exit codes: 0 fine, 1 something failed
or differs, 2 refused, 3 permission denied. Logs are JSON lines with a salted id instead of a key, because a key can hold a slug of
what a cook typed (the signer's job folders). To map an id back: `select key from objects where key_id = '...'` in the ledger, which
is mode 0600.

Tests: `python test_media_copy.py` (no dependencies), `python test_stores.py` (real SDKs against moto; add fake-gcs-server for GCS).

## Deletions

**The rule:** a file gone from GCS leaves S3, and a later catch-up never brings it back.

- Each pass finishes owed deletes first, so a long copy can't hold them up. It stops starting files after 30 minutes for the same
  reason. It lists GCS again at the end.
- A copy records its intent first, reads pinned to the listed generation, and checks GCS again after the write. If the source went
  during the copy, the new copy is removed.
- A `copied` row whose key has left GCS is always deleted, whichever pass finds it. A failed delete stays owed and is retried.
- A tombstone refuses every generation up to the deleted one. A newer generation at the same key is a real new upload, and it's copied.
- A tombstone keeps only the salted id. The key is blanked and overwritten in the file.
- Files this tool never copied are left alone: after uploads move, the api and the worker write to S3 directly. A delete made in S3
  isn't undone either. `report` shows it as `missing_in_s3`, and only `--recopy-missing` restores it.

### Old versions

A delete on these versioned buckets adds a marker. The bytes stay as an old version, hidden from CloudFront and from listings, until
the lifecycle rule in `infra/modules/env/storage.tf` removes them 28 days later. S3 runs that rule about daily and can be late.

| When | What's true |
|---|---|
| Deleted from GCS | Day 0 |
| Marker in S3 | Within one catch-up: 15 minutes, up to about 45 if a pass is running long |
| CloudFront stops serving it | Up to 1 hour later (`max-age=3600`), 24 hours if the file had no Cache-Control |
| Bytes gone from S3 | About day 28 to 30 |

`/privacy` says deleted within 30 days, and out of backups within 30 more. That holds easily if old versions count as a backup. If
they're read as the data itself, it holds only while the catch-up runs, so `report` calls it stale after 6 hours. See question 2.

The same 28 days apply to an overwritten file's old version, and a copy that landed just after its delete is treated like any other
deleted file. `sync` refuses a bucket without versioning, or one that keeps old versions more than 28 days. The tool's role has no
`s3:DeleteObjectVersion`, so a bug in it can't destroy anything for 28 days, and the cost is that it can't remove bytes sooner either.

Not verified: whether the GCS buckets have soft delete on (Google's default on newer buckets keeps deleted objects 7 days). That's
GCS's own timeline, it's outside this tool, and it should be checked.

**Once anything writes to S3 directly,** the catch-up no longer covers everything. The new purge has to delete from both stores by key,
as SCHEMA.md section 4 says, using `media_urls_legacy`. GCS has to keep losing files too, for as long as it exists.

## Failures

| What happens | What the tool does | What you do |
|---|---|---|
| Crash at any point | The ledger says what was under way. The next pass checks S3 before re-reading anything. A big file restarts from its first part | Run again |
| Same pass run twice | Nothing moves and nothing is read | Nothing |
| Two runs at once | The second is refused | Wait |
| Timeout, throttle, 5xx | Up to 5 tries with backoff. The file is `failed`, its folder's recipe.json and library.json wait, and it's retried next pass | Read `report` |
| A file fails 5 times | Stops retrying so it stops costing egress, and keeps exiting 1 | Look, then `--retry-failed` |
| Bytes don't match GCS's CRC32C | Nothing is written. A big file's upload is aborted | As above |
| S3 stored something different | The copy is hidden with a marker, and tried again | As above |
| Permission denied | That bucket's pass stops and exits 3, naming the action and bucket. Owed deletes stay owed, and other buckets still run | Fix the role |
| A large share vanished from a listing (200+ files and over 25%) | Holds those deletes and exits 2 | Look, then `--allow-mass-delete` |
| Ledger lost | Refused, because deletes would silently stop | `rebuild-ledger`. It reads S3's tags and delete markers. A marker older than 28 days is forgotten |
| Estimated cost over the cap | Refused before anything moves. Deletes have already run | Check, raise `--max-cost-usd` |
| Upload abandoned by a crash | Aborted after 24 hours, if the ledger knows the key | Nothing. See question 5 |

## Stored links

`recipe.json` and `library.json` hold full links, and so do Convex, Supabase and the app's bundle. Build 6 reads the GCS host forever.
So **the GCS host stays up, and GCS's own files never change.** S3's copies are the only ones rewritten, which means the two stores
differ on purpose in these files.

| Where the link is | Who reads it | What happens |
|---|---|---|
| GCS `recipe.json`, `library.json` | Build 6, Convex's `recipeJsonUrl`, Supabase's `BUCKET_URL` | Never changed |
| S3 `recipe.json`, `library.json` | App 1.1, through `media.homecookd.app` | `rewrite`, after each catch-up. A new GCS generation comes over with old links and gets rewritten again |
| `app/assets/data/` | Any build's offline fallback | Rebuilt by `publish.py`, new builds only. Old ones need the GCS host |
| Convex `recipes`, `recordings`, `accountDeletions` | Old builds, the purge | Not rewritten. Phase 6 splits them to keys (`rewrite.split_gcs_url`, SCHEMA.md 5.7) and keeps `media_urls_legacy` |
| Supabase `messages.audio_url`, `recipe_notes.answer_audio_url` | Old builds | Same, in phase 5 |

Only `media.video_url`, `audio_url`, `poster_url`, `steps[].image_url`, and the library's `poster_url` and `recipe_url` change. A link
moves only if its file is already in S3, so a file mid-copy keeps its working GCS link and is picked up later. `?v=` stays.

**Code that gates on the host, to change before links with the new host reach it:**

- `pipeline/account_purge.py` `media_objects` skips any other host without saying so. A new link in `mediaUrls` would be silently left
  undeleted. This has to change before the worker publishes new-host links for real.
- `supabase/functions/api/index.ts:931` refuses an `audio_url` not on `BUCKET_URL`. "Hear Dad" from a rewritten recipe would fail with
  400. It needs a Supabase deploy, which is frozen and Caleb's call. Leave `EDIBLE_BUCKET_URL` itself alone: it also reads `jobs/`.
- `convex/lib/glassesRoutes.ts` `VIDEO_URL` accepts only GCS. The glasses are off, so this waits.

### The way back

The rewrite changes only the host inside a quoted link, byte for byte. Before each write it proves that swapping the host back gives
GCS's exact CRC32C, and a file that can't prove it isn't touched. `rewrite --undo` restores those exact bytes. If a copy can't prove
it, its row goes back to `failed`, and the next sync copies it fresh from GCS. S3's old version also lasts 28 days. Rewritten links
keep working if `media.homecookd.app` is pointed back at GCS.

## Order at the switch

Each step needs Caleb's OK in chat.

1. Apple approves 1.0, and `/privacy` lists AWS.
2. Production buckets exist. The media bucket gets its abort rule (question 5).
3. Dry run. Caleb sees the size and the cost.
4. Pilot with `--only-prefix` on the TEST family: copy, delete in GCS, see it leave S3.
5. Full copy. Start the catch-up and its alarm.
6. `report --deep` is clean. Then the `rewrite` dry run, then `--write`, and add it to the catch-up.
7. Change the three host gates above, or decide to wait on `index.ts`.
8. Point `media.homecookd.app` at CloudFront. Way back: point it at GCS, in minutes. Old builds never noticed.
9. The api hands out S3 upload links. Old builds keep the signer, so GCS keeps getting files and the catch-up keeps running.
10. The worker publishes to S3, and the new purge deletes from both stores.
11. When no build writes to GCS: a last catch-up and `report --deep`. Keep running the catch-up while GCS still has files that can be
    deleted, and turn it off only once the purge covers both stores itself.
12. GCS goes only when no build reads it, and that's Caleb's call. Then the `report` numbers stop mattering, and the ledger can be deleted.

## What it needs before it can run

- **Caleb's OK**, for each real run. The flag says so: `--real-family-media-caleb-ok-privacy-lists-aws`.
- **`/privacy` listing AWS**, live, after Apple approves. App Store, web & builds owns that, under the App Review guard.
- **A production account's buckets.** Only staging exists, and the tool refuses to put real media on staging with any flag.
- **Google:** `roles/storage.objectViewer` on both buckets for one new identity. It can list and read, and it can't delete. Changing GCS
  IAM needs Caleb's OK.
- **AWS role:** `s3:ListBucket`, `s3:ListBucketVersions`, `s3:ListBucketMultipartUploads`, `s3:GetObject`, `s3:GetObjectVersion`,
  `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:GetBucketVersioning`, `s3:GetLifecycleConfiguration`. Not
  `s3:DeleteObjectVersion`. It's in nobody's Terraform yet.
- **A first run on real services, on test buckets.** These are the assumptions no stand-in could check:
  - S3 accepts `ChecksumType=FULL_OBJECT` on a multipart upload and returns the whole file's CRC32C on HEAD. If it doesn't, big files
    fail their check and get hidden, so the failure is safe but the copy won't finish. moto's value there isn't a real CRC32C.
  - S3 rejects a wrong checksum with `BadDigest`. moto accepts it. The tool checks before writing anyway.
  - GCS answers 412 to a read of a replaced generation. fake-gcs-server ignores the pin. The CRC check stops the copy if GCS didn't.
  - A range read with `raw_download` on a real gzip-encoded object, if any exist.

## Cost

Prices are from memory, not checked against the live pages, and live in `costs.py`. The real size is unknown until the dry run, which
prints these with real numbers.

| Stored | Google egress, one time | S3 storage, a month |
|---|---|---|
| 100 GB | $12 | $2.30 |
| 500 GB | $60 | $11.50 |
| 1 TB | $120 | $23 |

AWS credits pay for S3. **They don't pay Google's egress.** Google announced free egress in 2024 for customers leaving entirely, by
request. That's from memory and worth asking about, though we can't leave while old builds read GCS. Requests come to under a dollar. The catch-up costs about
$0.30 a month in listings per 10,000 files, plus $0.12 per GB of new files. A small EC2 machine with a disk is about $15 a month. Behind
a NAT gateway add $0.045 per GB, so it should sit on a public subnet with an S3 endpoint. Nothing here nears the $300 line unless the
buckets are well over 2 TB.

## Open questions, with recommendations

1. **Where does it run?** A laptop sleeps, and a Fargate task's disk doesn't last. Recommendation: one small EC2 machine with EBS and an
   AWS role, reaching Google through workload identity federation rather than a key file. Caleb's call, since it's production.
2. **How should `/privacy` treat old versions?** Recommendation: count them with backups, keep 28 days and the undo, and have the lawyer
   already reading that sentence read this too. If they say otherwise, `DeleteObjectVersion` goes on the role and a purge removes
   versions directly, losing the undo.
3. **Copy `trash/`?** Today a deleted recipe stays in GCS's `trash/`, recoverable by hand. Recommendation: no. New company, public path,
   no reader. If an undo of a deleted recipe is wanted after GCS goes, it should be built on S3's versions.
4. **Copy raw uploads at all?** Most raw files expire in GCS within 14 days and cost $0.12 per GB to move. The copies matter only for
   jobs in flight at the switch. Recommendation: copy them as asked, since they can't be filmed again, and decide S3's own expiry: the
   S3 bucket has no 14-day rule, so anything left there at the end stays forever, while SYSTEM-DESIGN.md says to keep raw input. Caleb's
   call, and `/privacy` should say which.
5. **Abort rule on the media bucket.** `storage.tf` gives `uploads` and `private` one and not `media`. An abandoned multipart upload
   there holds family bytes no listing or purge sees, and nothing removes them. The tool's sweep covers what it knows. Recommendation:
   add `abort_incomplete_multipart_upload` to `media` in Terraform. Until then `sync` warns.
6. **The alert.** `report` exits 1, but nothing watches it. Recommendation: cron sends a failure to the same place as the other alarms,
   since a stale catch-up means deletes aren't arriving.

# The temporary sync into Postgres

**Oct 31, 2026. Off, and has never run against anything real.** This is SCHEMA.md's M1: a one-way copy of `families`, `people` and
`recipes` from Convex and Supabase into Postgres, so signed-in areas can move, with their foreign keys on, before accounts do. It reaches
`main` with `aws-migration`, switched off (with `SYNC_READ_SECRET` unset its routes refuse everyone), and comes off once every area has moved (`CUTOVER.md`, step 14).

All of it lives in `api/src/modules/sync/`, `api/migrations/012_sync.sql`, one line of `api/src/scheduled.ts`, and on Convex's side
`convex/syncRead.ts` and `convex/lib/syncRoutes.ts`.

## What it does

Three tasks on the `scheduled` queue, each safe to repeat. A lease in `sync_state` keeps two api tasks off the same run, without holding a
database connection through an outside call.

| Task | Schedule | What it does |
|---|---|---|
| `sync.deletions` | every minute | Reads `accountDeletions` after its place and applies each. Convex only, so Supabase being down can't delay it |
| `sync.pass` | every 5 minutes | Works through a whole pass in 60-second turns, saving its place after each page. A new pass starts 15 minutes after the last one finished |
| `sync.reconcile` | every 6 hours | Reads everything again and counts differences. Writes nothing to a copy |

**Reading Convex.** Convex has no change feed or updated-at time, so a pass reads every row and writes only what differs. Two new
read-only HTTP routes do it, behind their own secret: `POST /sync/page` (Convex's `paginate`, one table's page) and `POST /sync/deletions`
(ids and times only, never file URLs or the voice clone id). Convex hard-deletes recipes, so a recipe that a finished pass didn't read is
removed; if more than 10% (at least 20) look gone, that's held as a bad read and raises an alert. People and families are never removed.

**What leaves Convex is named field by field,** in `convex/syncRead.ts`; the routes don't return whole documents. A field added to a table later stays in
Convex until someone gives it a column and adds it to the list, and a test fails until they decide.

| Table | Copied (the Convex field) | Dropped at the source |
|---|---|---|
| `people` | `_id`, `_creationTime`, `familyId`, `supabaseProfileId`, `name`, `role`, `voiceClone`, `language`, `relation`, `approx`, `campus`, `deletedAt` | Nothing today: each has a column |
| `families` | `_id`, `_creationTime`, `name`, `supabaseFamilyId`, `publicName`, `mossSync` | Nothing today |
| `recipes` | `_id`, `_creationTime`, `familyId`, `cookId`, `title`, `status`, `libraryId`, `recipeJsonUrl`, `coverUrl`, `steps`, `memories`, `memoriesOptIn`, `mossIndexedAt`, `language`, `sharedAt`, `storyCard`, `hiddenAt`, `addedIngredients` | Nothing today |
| `accountDeletions` | `_id`, `_creationTime`, `personId`, `familyId`, `supabaseProfileId`, `requestedAt`, `recipeIds` | `jobIds`, `uploadPaths`, `mediaUrls`, `voiceCloneId` and the purge's progress |

Dropped later, at the merge: Convex's `name` and `role` where Supabase has its own, and the full URLs in `recipeJsonUrl` and `coverUrl`, which become keys.
Nothing in `api/` reads `people.cartesia_voice_id` while the outside purge stays with Convex, but it has a column, so it's copied.

**Reading Supabase.** PostgREST, for the rows on the page, with a fixed column list. Family codes aren't in the list, so they never leave
Supabase. A page where Supabase fails stops and retries, because a person with only Convex's half would be a wrong row.

**Merging (SCHEMA.md section 2).** A row keeps its Convex id, and its uuid stays in `supabase_id`. Name, role, email, tz and consent come from
Supabase; language, voice clone and place from Convex; `relation` from Convex, else Supabase. When the two name different families, Supabase
wins, if that family has a copy. Otherwise Convex's stays, and the reconcile counts it.

**Not copied:** rows only Supabase has. They're counted as `supabase_only`. Convex's areas can't see them today, and every session belongs to
a Convex person, so nothing that moves can point at one. This keeps personal data out of AWS until it's needed, and it means an id never has
to change under a row. The accounts backfill brings them in. SCHEMA.md's "else the uuid" rule is for that backfill.

**Read-only.** Once a real run has happened, a trigger refuses any write to a copy unless the transaction set `homecookd.sync_writer`, and
a test reads `api/src` for writes outside this module. This catches mistakes, not attackers, because everything logs in as one user. A limited
login is on the Cutover list and is the real boundary. When an area moves, a migration sets `sync_copies.moved_at` for its table: the sync
stops touching it and the api may write it.

## Account deletion

A deletion is on record in `sync_deleted` within about a minute of Convex reading it. In one transaction it:

- removes their recipes, or empties one that a question still points at, so a reference can't block a deletion. This comes before the record is
  written: after that, the trigger refuses any write to a deleted cook's recipes
- blanks the person (`people_tombstone_blank` checks it)
- deletes their sessions, identities and push tokens, and revokes their phones
- blanks the family if they were its last person (C2)
- queues `sync.purge_person`, which purges areas that have moved (only dish today; each area adds its own)

`findSession` already refuses a deleted person, so access stops at that commit.

**A stale row can't bring anyone back,** and that's enforced by triggers, not by the sync's care. A write of a live person or recipe takes
that person's lock, then checks `sync_deleted`. So a write already in progress commits first and gets blanked, and a later one is refused.
That holds if the deletion arrives before the person's first copy, if the old row arrives under a second id with the same `supabase_id`, and if the
row was read before the delete and written after it. The first pass waits for the deletions run, so everyone already deleted is on record
before their rows can be read.

Backstops: `_creationTime` is set when a mutation runs and not when it commits, so the run reads back over the last 10 minutes. A pass also
applies any person row with `deletedAt`. The reconcile checks every deletion from the beginning.

## The switch

`SYNC_MODE` on the api task. **Off by default: it must stay off until `/privacy` lists AWS,** because this copies names, emails, places and
family stories there. `api/src/modules/sync/switch.ts` says so.

| Value | Effect |
|---|---|
| unset, or anything not spelled exactly | Reads nothing, writes nothing. If copies already exist, it alerts: deletions have stopped reaching them |
| `on` | Copies, carries deletions, reconciles |
| `deletions` | **How to pause.** Copies nothing new, still carries deletions |

To stop for good: `deletions`, then empty the copies, then `off`.

## What each failure does

| Failure | What happens | Who hears |
|---|---|---|
| A row breaks a CHECK, a uniqueness rule or a type (or a URL we don't know) | That row is held out, by id and rule, in `sync_issues`. The batch goes on. It clears when the row lands. The old copy stays if there was one | Logs, the reconcile |
| A duplicate `supabase_id` | The row that landed first stays, the other is held, its recipes wait on it. Never merged | The reconcile's alert |
| Convex or Supabase down or slow | 10 s timeout, 3 tries with backoff, then the message fails. The place isn't lost | SQS retries, dead-letter alarm after 3 |
| Database down, statement timeout | The batch stops and the place isn't lost. Every statement touches one row or a small page, so none should come near the 10 s limit | The same |
| A crash anywhere | The rows in that page repeat and change nothing. The lease expires after 3 minutes | Nothing needed |
| A deletion can't apply | The others go on, its place doesn't pass it, and the message fails | Dead-letter alarm |
| Deletions not succeeding for 15 minutes | Alert. Access isn't refused yet (decision 3) | `SyncDeletionsLate` |
| Convex forgets a cursor | That table starts again, which is safe | Logs |

Logs and alerts hold counts, row ids and rule names, and never a name, an email, a place or a recipe's words. The reconcile keeps its last
report in `sync_state.last_report`, with up to 10 ids per kind. It alerts on a deletion that isn't holding, a row that can't land, an extra row, a
duplicate, a held row, a run out of time, or more than 5 rows behind in a table. `family_disagreement`, `no_supabase_row`, `seed`, `supabase_only` and
`family_unmapped` are counted without an alert.

## What's needed before it can run

None of this has been done.

1. **Caleb's OK.** This copies production data.
2. **`/privacy` lists AWS** (waits for Apple's approval of 1.0), and Sentry too, or no DSN on the task that runs this.
3. **Regenerate `convex/_generated/api.d.ts`.** It's edited by hand on this branch, accepted as an exception here only, because generating it needs a deployment.
4. **Deploy the Convex routes,** which also needs Caleb's OK, and set `SYNC_READ_SECRET` in Convex env.
5. **A read-only Supabase role** for `SUPABASE_SYNC_KEY` (decision 5). Never the service role.
6. **Infra, not in this PR.** Secrets `SYNC_READ_SECRET` and `SUPABASE_SYNC_KEY`; env `CONVEX_SITE_URL`, `SUPABASE_URL`, `SYNC_MODE`; the three schedules above.
7. **Run on staging with made-up rows first** against a throwaway Convex deployment, including real PostgREST and a real expired cursor.
8. **If the queue worker runs against the same database,** see decision 4.

## How it's removed

Set the schedules and `SYNC_MODE` off, delete `api/src/modules/sync/`, the import and spread in `scheduled.ts`, `api/test/sync*`, then
`convex/syncRead.ts`, `convex/lib/syncRoutes.ts`, its line in `convex/http.ts`, `syncReader` in `lib/http.ts` and their lines in `convex/_generated/api.d.ts`. Unset the secrets. A new migration
drops the triggers, the three functions and the `sync_*` tables. A copied table whose area never moved needs its backfill first.

## Queries and their indexes

| Read | Index |
|---|---|
| A write's check for a deletion | `sync_deleted` primary key, `sync_deleted_supabase` |
| Recipes no pass read | `sync_recipe_seen_pass` |
| Is a family empty? | `people_family_order` |
| Copied family by old id | `families.supabase_id` (unique) |
| A deletion's recipes | `recipes_cook`, primary key |
| A deletion's sessions, phones, links, tokens | `sessions_person`, `devices_person`, `identities_person`, `push_tokens_person` |

## Decided (the review, Oct 31)

None of these is built yet.

1. **Sessions.** M1 names three tables and `findSession` reads `sessions`, which nothing fills, so signed-in routes can't work yet. On a miss, check Convex and
   store the row. This goes in before the first signed-in area. Deletion already removes them.
2. **A new person** has no copy for up to a pass, about 15 minutes, because M1's just-in-time upsert would be a live read on a request. Each area decides
   what that request does, and a faster path comes only if real requests hit this.
3. **Late deletions refuse sign-in.** At about 15 minutes late, added to `findSession` with the first signed-in area (SYSTEM-DESIGN: account deletion is
   "consistent: refuse"). Until then it only alerts.
4. **The queue worker writes `recipes`** (`pipeline/queue_db.py`), and is refused once the copies are read-only. Set `moved_at` on `recipes` in the release
   that switches the worker. A recipe the sync never landed is never swept, so the two can't remove each other's rows.
5. **The Supabase key is a read-only role,** made at the OK to run, which is Caleb's call. Never the service role for this.
6. **Cost.** A full pass reads every recipe and Convex bills by bytes read. Measure it on the first day, then change the 15 minutes (`PASS_EVERY_MS`) and the
   reconcile's schedule.
7. **`convex/_generated/api.d.ts`.** The hand edit is accepted on this branch only, as an exception. It's regenerated before this can run, and it comes off with the sync.

## Open questions

1. **Duplicates need a person.** SCHEMA.md says to find and repoint them first. **Recommendation:** read the first report, then fix them at the source.

## Tested, and not tested

Tests use real Postgres 17 and made-up rows, with fakes for both stores: `api/test/sync.test.ts`, `syncDeletion.test.ts`, `syncReconcile.test.ts`;
`syncSources.test.ts` runs the real clients against a local server; `convex/syncRead.test.ts` runs the routes on `convex-test`.

Not tested: real Convex (a real refused cursor's message, and `paginate` at size), real PostgREST, SQS and the schedules, RDS, how long a pass takes,
or any real row. The reconcile uses the same merge code as the pass, so a mistake in the merge itself wouldn't show up as a difference.

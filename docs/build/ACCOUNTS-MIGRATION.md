# Sign-in, invites and account deletion on the new api

The last item in `docs/build/AWS-MIGRATION.md`'s area order, Nov 1, 2026. A draft on `claude/aws-accounts`, off `aws-migration`: nothing live points at it. Live Supabase, its data and what build 6 calls don't change, and nothing switches without Caleb's separate OK. The code is `api/src/modules/accounts/`, shaped like the dish module: routes check the input, the files beside them hold the rules, `data.ts` holds the SQL.

**The switch.** `ACCOUNTS_OWNS_PEOPLE=1` is off until this area moves. `families` and `people` belong to the temporary one-way sync until then (SCHEMA.md, M1; the `claude/aws-sync` draft), so with it off every write to those two tables answers 503 `accounts_not_moved` and changes nothing. A test reads the source and fails if another file starts writing them. **The one exception** is a deletion the sync passes on, `startDeletionIn(c, personId, "sync")`, in the transaction that writes the sync's own record: M1 says a deletion reaches the copy within minutes. "From the sync", below, says what it does. Reads, and writes to `devices` and `sessions`, aren't behind the switch, because no real rows or traffic reach them until the move.

## Routes, and the old route each replaces

**Same path, shapes, statuses and sentences as Supabase's `api`,** proven by a device key or a family code. The one change, since #290: a refusal's sentence is its `message`, and `error` is a code (contracts/ERROR-CODES.md).

| Route | Old code |
|---|---|
| `GET /family` | `index.ts` 1302 |
| `POST /profiles`, `/profiles/self`, `/profiles/:id/remove` | `index.ts` 1488, 1504, 1561, `removeProfile` 1578 |
| `POST /devices`, `/devices/revoke` | `index.ts` 1413, 1425 |
| `POST /invites`, `/invites/peek`, `/invites/accept` | `index.ts` 1679, 1793, 1836 |
| `POST /join-links`, `/join-links/revoke` | `index.ts` 1718, 1725, `joinLinks.ts` `familyJoinLink`, `revokeJoinLinks` |
| `POST /move-requests`, `GET /move-requests`, `/move-requests/mine`, `POST /move-requests/:id/approve`, `/decline` | `index.ts` 2036-2164 |
| `POST /auth/apple`, `/auth/google` | `index.ts` `signInWith` 2941, `joinLinks.ts` `signInByLink`, `link.ts` |
| Device, family code and `x-profile-id` checks | `index.ts` `authenticate` 654, now `proofs.ts` `prove` |

**What Convex held, as plain routes,** proven by a session token (`api/src/auth.ts`). Old builds keep calling Convex by function name until they're gone; these are for 1.1 on.

| Route | Old function |
|---|---|
| `POST /v1/sessions/start` `{deviceKey, profileId}` -> `{sessionToken, familyId, personId, role}` | `sessions.start`, `sessions.mirror` |
| `POST /v1/sessions/end` | `sessions.end` |
| `POST /v1/account/delete` -> `{deleted: true}` | `account.deleteMe` |
| `GET /v1/apple/revoke-ready` -> `{ready}`, `POST /v1/apple/revoke` `{authorizationCode}` -> `{revoked, reason?}` | `apple.revokeReady`, `apple.revoke` |
| `POST /v1/links/claim` `{token}`, `POST /v1/links/moved` `{receipt}` | `links.claim`, `links.moved` |
| `POST /link/open` (public) | `lib/linkRoutes.ts`, `links.forOpen` |
| Queue: `accounts.purge`, `accounts.outside`, `accounts.sweep` | `account.purge`, `account.restartPurges`, `sessions.purgeExpired`, `worker.nextDeletion`, `deletionDone`, `pipeline/account_purge.py` |

`lib/joinTicket.ts` and `link.ts` are now one file, `tickets.ts`, passing both systems' shared vectors. `lib/auth.ts` was already `api/src/auth.ts`.

**Not built:**
- `POST /auth/email`, `POST /signup`, `POST /profiles/:id/email`. Today's `app/src/lib/api.ts` doesn't call them, and `/auth/email` hands a family's code to anyone who types a known email (Supabase's own `TODO(security)`), so I didn't copy it. **`TODO(caleb)`: if a build still in use signs in this way, it has to be built before the switch.** I couldn't check build 6 itself.
- `apple.checkSetup`, the one-time operator check.
- `x-tz` syncing: the push area's.
- ~~The `joined` push on a claim.~~ Built in #311: `queueJoined` in `messages/pushEvents.ts`, in the claim's transaction.

## Two kinds of proof, kept apart

Per SCHEMA.md section 2, a device key lasts until revoked and mints sessions; a session lasts 30 days. Both hashes are SHA-256, so rows copied from Supabase and Convex keep working.

- **Revoking a phone ends its sessions at once.** New sessions carry `device_id`. Sessions copied from Convex have none, so revoking a phone also ends **that person's** sessions with no phone on them. The app gets a new one from its device key without noticing.
- **The session check is stricter than Convex's** (`auth.ts`): it also refuses a removed person and a revoked phone, so a race or a later bug can't leave a working session.
- **Sign-in refuses rather than guesses.** A database failure on any proof is a 500, never a pass (`accountsProofs.test.ts`).
- **Which id a phone sees.** A merged row keeps its Convex id, with the old uuid in `supabase_id`. The Supabase-shaped routes take and send `supabase_id ?? id`, because phones and tickets hold it. The `/v1` routes use the row's own id, as Convex's did.

## Sign in with Apple and Google

`identity.ts` holds one interface with one real implementation, `jose` (Supabase's own library, same major version): RS256 only, issuer, audience, expiry and a required `sub`. Tests give it fake keys, so forged, expired and wrong-audience tokens all go through the real check. The answers are Supabase's: a bad token is 401, keys that can't be fetched are 503, and a real token for an app id we don't list is 503 "not set up". Audiences: `APPLE_AUDIENCES`, default the bundle id and Expo Go; `GOOGLE_CLIENT_IDS`, default none.

**Each join is one transaction.** Supabase's code made a person, then put things back by hand if a later step failed. Here a failure leaves nothing, so a used-up invite or card side can't be lost. Another tap linking the same account first rolls the whole join back, and it signs in as that tap did.

## Account deletion

`deletion.ts` and `purgeSteps.ts`. **It refuses no one who can prove who they are:** a person with nothing, a memorial person, a family's last person. A family member's phone may delete a phone-less person, but only a phone that already has its own person in that family, and the app must warn first (Caleb, Nov 1). A phone with no person of its own, from an invite or a code, gets no session at all.

**At once, in one transaction:** the deletion row; a blank tombstone (the check constraint refuses one that keeps anything personal); sessions, phones, Apple and Google links, push tokens, invites naming them, asks to be them, and the sign-up log, by person and by their email, the one moment that's still known; jobs cancelled, recordings abandoned, dinners cancelled; recipes (500 here, the rest in the batches) with their questions, cooking rows and swaps; C2 if they were the last. The batches are queued in that same transaction.

**Then in batches of 500,** one transaction per batch, each step finding only what's left. A file's key is marked in the same transaction its row goes in. **It finishes only when a full pass finds nothing**, so a late row or a lost batch is caught before anyone says it's done. Out of time (60 s), it queues itself. If it stops, the hourly schedule starts it again after 30 minutes.

`coverage.ts` holds SCHEMA.md section 4 as data, and tests hold it to the real schema: every table must be listed, and after a real purge every column with an FK to `people` must be empty for that person, except `account_deletions.person_id`, `threads.a_person_id`/`b_person_id` (C1) and `files.owner_person_id` (until its row goes). Another test scans every column of every table as JSON for what the fixture marked as hers.

**Owners.** `purgeSteps.ts` calls each area's own purge, in this order: `purgeCommunityForPerson` (it finds dinners and swaps by the person's recipes, so before they go), `purgeMessagesForPerson`, `purgeJobsForPerson` and `purgeDishForPerson`. Its own steps are only this area's tables. `startDeletion` calls `dropPushTokens`, `cancelDinnersOfPerson` and `stopPersonsWork` in its one transaction.

Each area's purge takes a `PurgeRun` (`api/src/purge.ts`): its batch size, and the hooks that keep the deletion marked as running, stop it when it's out of time, and let a test crash it at any batch. They say how many rows they changed, so the purge knows when a full pass found nothing. A file is marked with `markPurged`, in the transaction that deletes its row, so it names the deletion and gets a ledger row if it had none. Keys that can name public library media use `markPurgedIfKnown`.

Left as it is: Messages and Jobs both clear pending sends and spare uploads, because each area's purge still works alone. The second finds nothing. The dish purge takes no `PurgeRun`, so the interruption test stops only after it, not inside it, and out of time can't stop it part way.

`neighbors.ts` holds borrowed SQL for sign-in: circle notes, read marks, "has acted", a share's family, re-homing recipes after a move.

**C2:** `name` becomes `'Deleted'` because the column can't be empty, the other three go null, and new `families.blanked_at` says so. **Beyond SCHEMA.md:** the family's phones, sessions, join links (the operator's too) and pending invites stop, so nobody can join a family that no longer exists. A removed person doesn't count as someone left. **A family doesn't outlive its last signed-in person (Caleb, Nov 1):** when they delete, leave or move, the phone-less people left are deleted through the same `deletePerson`, so their rows and files get purged too, and the family is blanked (`endFamilyIfLast`). A memorial person goes with them. Someone who never signed in going ends nothing, which keeps a family that only ever used its code as it is. The sync passes on one person's deletion and no more.

**C5:** cleared by the sweep 60 days after the outside purge; `lists_cleared_at` records it.

### From the sync

While Convex and Supabase are the source, a deletion there reaches Postgres through the sync (`sync/service.ts`, `passOnDeletion`): from Convex's `accountDeletions`, and from any person Convex shows deleted with no such row (a tombstone in its people walk). Areas switch one at a time, so Postgres can hold rows and files of theirs that only it has, and the same promises hold as for the route: one transaction does the sync's record and this purge's start (`applyDeletion` with `startDeletionIn`), then the batches and the outside purge follow as above.

- **In the one transaction, in this order:** the sync's locks (the person, then the family's lock and row, so it can't deadlock with this file's family-then-person order); the person blanked with Convex's deletion time; `startDeletionIn`, which writes `account_deletions`, ends every way in and queues the batches; then the sync drops their recipes, writes `sync_deleted` and does its own C2. The start comes before the recipes go so that it still finds a dinner around one. A failure anywhere rolls all of it back, and the sync's place doesn't pass it.
- **Their recipes are the sync's while the copy is read-only.** `stopPersonsWork` and the jobs purge leave them, and the purge doesn't finish while any are left. A recipe a question still points at is emptied, not deleted. The messages purge takes the question, and the next pass that sees the tombstone deletes the recipe; then the hourly restart finishes the purge. With the sync paused (`SYNC_MODE=deletions`) no pass runs, so such a purge waits.
- **C2 is the sync's while the switch is off.** It waits for its people walk and gives a name back if someone live lands, so `startDeletionIn` skips `endFamilyIfLast` and the purge's family step waits for the switch. Two writers would fight over the row, and `blanked_at` would stay on a family with live people.
- **Someone with no row in the copy** gets only the sync's record, which keeps them out. Every column naming a person is a foreign key, so nothing can point at them. Their purge starts if their tombstone lands.
- **The reconcile** counts a deletion as holding only if a person still in the copy also has an `account_deletions` row. The people walk passes every tombstone on again, so a missing one is started at the next pass.

### Outside the database: read this before calling deletion finished

`purgeOutside` deletes the Cartesia voice clone at once. Then it waits as long as the sweep does, 7 hours after the purge, because a link still in a phone's hands, the glasses' last upload or the worker finishing a job it was on could put a file back in a folder after it's emptied. Then it deletes from S3 what `account_deletions` lists and no `files` row names (`outside.ts`):

- `upload_keys` in `uploads`: each file, and each one-segment folder (`<upload id>/`) with everything in it;
- `media_prefixes` in `media`: her recipe folders, and the folder each of her jobs publishes to;
- `media_keys` in `media` with no row in the ledger. A key with a row is the sweep's, and `jobs.sweep` now reaches all three buckets.

It deletes nothing still in use: a folder or file that a job, recipe, recording or unmarked `files` row names, a folder that isn't one segment as the worker and the signer name them, the bucket's own folders (`library/`, `jobs/`, `trash/`, `glasses/` and the rest), the public library, or a folder holding more than 5,000 files. Each of those keeps `external_purged_at` null, with the reason in `external_error` ("Not reached yet: 1 media folders still in use"), and so do files marked by this deletion or owned by the person and not yet swept, and GCS links (`media_urls_legacy`). An S3 failure is named by bucket and error type only, because S3's text can hold the account and the bucket. Out of time (60 s), it carries on in a new message, which doesn't count as an attempt. `external_counts` adds up what each attempt deleted. One run at a time: a run claims the row (`external_claimed_until`, 10 minutes) and lets go when it stops, so the hourly schedule and a message carrying on can't both count the same files, and a crashed run's claim lapses. Whether an entry is a folder comes from the list it's on: every `media_prefixes` entry is a folder, so one written down without its slash is refused rather than taken for a missing file. `upload_keys` can hold either, and there only the slash says which.

After a delete, S3's versioning keeps the bytes 28 days, inside `/privacy`'s 30, and the CDN can serve a cached copy for up to a day (the media cache policy's default; the worker's files say an hour). **Nothing here reaches GCS:** while Convex is the source, `account_purge.py` deletes there. After the switch GCS's copies still have to go for as long as GCS exists (MEDIA-MIGRATION.md), and how AWS reaches Google is Caleb's call, so a deletion holding GCS links stays open until that's built.

It tries again with waits doubling from 10 minutes to a day, and after 10 tries stops, writes `external_gave_up_at` and raises `AccountOutsidePurgeGaveUp`. The invariant sweep's `deletion_stalled` names it every 5 minutes until someone restarts it (below). **This must be built before real data or the switch**, and `/privacy` promises depend on it.

### A deletion that stopped

A deletion's stage is read from its row (`stageOf` in `deletion.ts`; Caleb, Nov 8, decision 7; `docs/agents/STATE-MACHINES.md` row 8): **purging** (`purged_at` null), **outside** (purged inside, the outside purge trying), **gave_up** (`external_gave_up_at`) and **done** (`external_purged_at`). `084_deletion_stages.sql`'s CHECK refuses the ones that can't be: done outside before inside, given up and done, the lists cleared before done. The purge inside the database is never given up: the hourly `accounts.sweep` restarts one with no batch for 30 minutes, every time.

After fixing why it stopped (a Cartesia key, an S3 permission, a folder still in use), the team restarts it with a one-off task, as `reports.js` runs (COMMUNITY-MIGRATION.md, "Running it", with `RUN` below):

```bash
RUN='["node","dist/deletions.js","stalled"]'                 # purging with no batch for an hour, or given up outside: id, stage, attempts, the reason
# RUN='["node","dist/deletions.js","retry","<deletionId>"]'  # starts it again now
```

`retry` sends a purge still inside the database a new message now. An outside purge, given up or still waiting, starts again with a fresh count of attempts, now, and `accounts.sweep` carries on from there. One that's done is left alone. It's safe to run twice. Exit codes are as `reports.js`'s: 0 done, 1 refused or failed (the reason is the first line), 2 wrong arguments (nothing ran). The task's log holds ids, stages, counts, times and the purge's short reason, never a name.

**Also not reached, and on `account_purge.py` today:** Supabase's rows and buckets while they exist, GCS, `trash/` copies, the signer's `jobs/<id>.json`, the `library.json` rebuild, and copies on a worker's disk. **Moss:** `families.moss_sync_again` is set, and nothing reads it yet; Convex still tells Moss itself. **Dish's anonymous files** are swept whatever the deletion's status, so they aren't counted in it.

### Apple token revocation

Kept, in `appleRevoke.ts`: the same two calls in the same order, before the delete, and Apple trouble never stops a deletion. Added: a 10 s timeout, and one more try of the revoke when Apple answers 5xx or doesn't answer. The swap isn't retried, because an authorization code works once.

## Behavior differences

1. **Sessions** are refused for a removed person or a revoked phone. On Convex they lived on for up to 30 days.
2. **Revoking a phone** also ends that person's sessions with no phone on them.
3. **A join failing part-way** leaves nothing, rather than a put-back that could itself fail. A few "try again" 409s can no longer happen.
4. **A deleted account's next calls.** `POST /profiles/:id/remove` naming a tombstone from a lent phone answers `{ok: true}`, because the app calls it right after deleting. From their own phone it's the signed-out 401 the app already reads.
5. **`POST /v1/account/delete`** returns `{deleted: true}`. Convex returned null.
6. **A purge that keeps stopping** is restarted every hour for good, alerting after 5. Convex stopped after 5 and logged a line.
7. **The purge finishes only after an empty pass.** Convex finished after one pass over the steps.
8. **`links.moved`'s `faces`** counts only faces with work to bring, so a repeat says 0. The move already took the faces across in one transaction. The app doesn't read this count.
9. **`signups`** now gets `person_id`, and a deletion reaches it, by person and email. A join through a recipe link is logged as `share:<id>`, never the link's token (SCHEMA.md, M6).
10. **Deletion also revokes family invites they sent,** as today's follow-up call to `/profiles/:id/remove` does, and `inviter_id` goes null.
11. **`GET /family`'s `memorial`** is always present, since it can't be unreadable here.
12. **Responses add `requestId` and `x-request-id`;** a 429 adds `retry-after`.
13. **A malformed JSON body** gets `{error: "invalid", message: "The body must be JSON."}`, not "Body must be JSON". Nothing matches that sentence. Since #290 every refusal here is a code with the old sentence as `message` (contracts/ERROR-CODES.md).
14. **Rate limits** are fixed windows (SCHEMA.md's choice), with `RATE_LIMIT_SALT` and no fallback key.
15. **Sealed values need `EDIBLE_CODE_KEY`.** Supabase fell back on its service key. A join link that can't be opened is replaced with a new one; a family code is sealed again on its next use. Since Nov 2 the same key seals craving, dinner and share links (`api/src/sealed.ts`), and a share link is found by a hash keyed from it, so changing the key stops every share link opening.
16. **`/link/open` reads a family with no uuid as `no_family`,** rather than minting a ticket Supabase would refuse.
17. **Marking a key with no row in `files` adds a row,** so a purge can't lose it. Only a backfill bug could cause that.

## Where Convex and Supabase disagreed

| What | Convex | Supabase | Kept, and why |
|---|---|---|---|
| The other person's half of a 1:1 | Stays | Goes | Convex's: Caleb's C1 |
| After deleting | Tombstone | Row deleted | Tombstone: SCHEMA.md, and other rows point at it |
| A session after someone leaves | Keeps working | Device revoked (no sessions there) | Refused: it's the only safe answer, and Supabase's rule in spirit |
| The ticket's shape | Checks types only | Also checks `fam`, `card`, `jti` | Supabase's: it's the side that makes a person |
| `email` on a link signup | V2-LINKING.md says `""` | Code stores the account's email or null | Null: the code, and it's what deletion can clear |
| `thread_reads` on their pairs | n/a | Gone with the thread | SCHEMA.md's "any on those threads", though the pair now stays. The other person loses only a read mark on a thread holding only their own messages |
| Family invites they sent | Not touched | Revoked, then `inviter_id` null | Supabase's: an open invite lets anyone in |

## Against SYSTEM-DESIGN.md

- **"Requests stay quick."** `/auth/*` waits on the providers' keys when not cached (5 s at most), and `/v1/apple/revoke` on Apple (up to about 30 s), because the phone needs the answer. No database connection is held meanwhile.
- **"Version the api."** The Supabase-shaped routes stay unversioned, so old builds need only an address change. New ones are under `/v1`.
- **"Writes from a phone take an idempotency key."** Old builds send none. Sign-in is safe to repeat by account, and `/invites` isn't, as today. Its daily limit bounds a retry.
- **"Modules call each other's services, never each other's tables."** Broken on purpose by `neighbors.ts`, and listed above. `purgeSteps.ts` keeps to this now.

## Tests

`cd api && TEST_DATABASE_URL=… npm test`, on real Postgres with fake provider keys and stubs for Apple and Cartesia. Nothing reaches Apple, Google, Convex or Supabase.

| File | What |
|---|---|
| `accountsProofs.test.ts` | Device keys, family codes, sessions, sign-out, revocation, a database failure |
| `accountsSignIn.test.ts` | Forged, expired, wrong-audience, wrong-issuer, unsigned and HS256 tokens; no link, join links, an expired link, tickets and replays, old invites, claims, moves, a removed person trying every proof, recipe links, limits |
| `accountsInvites.test.ts` | Invites, codes, `/profiles/self`, leaving, join links, peek, limits |
| `accountsMoves.test.ts` | Moving to a new phone |
| `accountsLinks.test.ts` | The shared vectors, `/link/open`, claims, receipts, the switch |
| `accountsApple.test.ts` | Revocation, against a stub of Apple's two endpoints |
| `accountDeletion.test.ts` | Section 4, table by table; interrupted at every batch, both before and after its commit, and resumed through the schedule's path; a deleted person trying every proof; C2 and C5; the outside purge; the switch |
| `syncDeletion.test.ts` | A deletion from the sync: its purge reaches rows only Postgres has, a repeat changes nothing, a failure keeps the sync's place and leaves nothing half done, a recipe a question held, the last person's family, someone not in the copy yet |

**Carried over, with the same meaning:** all of `convex/joinTicket.test.ts`; 7 of 8 from `apple.test.ts`; 6 of 7 from `account.test.ts`; 9 of 11 from `links.test.ts`; 4 of 5 from `sessions.test.ts`, one of them changed as noted below; 5 of 7 from `accountPurge.test.ts`; the auth, invite, profile, join-link and move tests from `supabase/tests/api_test.ts`; `joinLinks_test.ts` and `link_test.ts`.

**Changed in how they run:** Supabase's fake database became real Postgres, and fake timers became moving stored times back. Convex's assertions through `recipes.list`, `community.feed` and `messages.list` read the tables, because those routes aren't here. "Sign-in mirrors the family" became "hands back a session", since nothing is mirrored now.

**Not carried, and why:**
- `sessions.test.ts`: the demo seed taken over by a first sign-in. No mirror here; seed families are a backfill question (C6).
- `apple.test.ts`: `checkSetup`, not built.
- `account.test.ts`: the Moss retry test. Moss hasn't moved.
- `links.test.ts`: `pushEvents` and the "Mom answered" end-to-end test, the push area's. The `joined` push assertions inside other tests were dropped.
- `accountPurge.test.ts`: the worker-secret check and bad-report refusals, because there's no `/worker/deletions` route. The scheduling and retry behavior is carried.
- `api_test.ts`: email sign-in and `/profiles/:id/email` (not built), and the two removed-person display tests (messages). "Two taps at once" covers the same person; two taps for different people is a narrower race, and the one-pending index still holds it.
- `joinLinks_test.ts`: "two of that name" on peek, because the unique index makes two live people of one name impossible here, and the earliest-row fallback for a join before Supabase's index existed. Put-back tests became "the transaction left nothing".
- `pipeline/test_account_purge.py`: GCS and Supabase, which stay with `account_purge.py`.
- `supabase/tests/two_sided_live.mjs`, `retention_live.mjs`, `app/scripts/api-smoke.mjs`: read as checklists, not run.

## Queries, and the index behind each

Everything in SCHEMA.md section 3, "Sessions and accounts", is used as written, with its purge steps. New in `060_accounts.sql`: `devices_family` (a blanked family's phones, including those with no person), `pending_sends_family` (off `recipient_ids`), `files_purge_deletion` (what's left outside), `account_deletions_lists_due` (C5). No migration edits an existing file. `EXPLAIN` wasn't run on the new queries with synthetic rows.

## Long work

| Task | Why a repeat is safe |
|---|---|
| `accounts.purge` | Each batch holds the deletion's row and finds only what's left |
| `accounts.outside` | Cartesia's 404 counts as gone, and the id is cleared once it's confirmed; a finished row is left alone |
| `accounts.sweep` | Deleting expired sessions, restarting what stopped, queueing what's due, clearing old lists: all take only what's still due |

## What's needed at the switch

**Secrets (names only):** `EDIBLE_CODE_KEY`, `LINK_JOIN_SECRET`, `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY`. Already there: `RATE_LIMIT_SALT`, `CARTESIA_API_KEY`.

**Settings:** `ACCOUNTS_OWNS_PEOPLE`, `APPLE_AUDIENCES`, `GOOGLE_CLIENT_IDS`, optional `APPLE_CLIENT_ID`, `EDIBLE_WEB_URL`.

**Infra (not touched):** an hourly EventBridge schedule into `scheduled`: `{"payload":{"task":"accounts.sweep"}}`. The api needs the secrets above on its task, and outbound HTTPS to Apple and Google, which it has through NAT.

**Dependency:** `jose` 5.10.0.

**App Review guard.** This is on the sign-in and delete-account paths, so **before this switches:** a per-guideline check in that PR, and the reviewer notes, App Store answers and legal pages updated with it. What I expect it to find:
- **5.1.1(v):** delete account behaves the same on the phone, and revocation is kept. `/privacy` promises deletion within 30 days: every S3 bucket is reached now, and **GCS isn't, so it can't switch while a deleted account can still have files there.** It also needs "your one-to-one chats" changed (C1) and AWS added, both already on AWS-MIGRATION's list.
- **4.8:** unchanged. **2.1:** the reviewer's TEST family link with no expiry is tested here; the TEST family's code and faces are data, and a backfill must keep them.
- **Nothing changes for build 6,** which keeps calling the old services.

## Someone who left the family

Leaving signs a person out and frees their Apple login in one transaction (`removePerson`), so normally they have no session to come back with. A session can still be alive for a row marked removed another way, such as the sync. Every route refuses that person (a 403), except these, which use `requireSessionEvenIfRemoved` so they can still delete their account (App Review 5.1.1(v)): `POST /v1/account/delete`, `GET /v1/apple/revoke-ready`, `POST /v1/apple/revoke`. `routeCoverage.test.ts` lists each with why.

**Someone who left or moved and came back (Caleb, Nov 1)** is a new person, tied to the old row by `people.previous_person_id`, so deleting them also deletes every removed row behind them, across families. A move sets it in the same transaction. Leaving keeps a keyed hash of provider and subject in `left_identities`, never the subject, and the same account's next sign-in sets the link and uses the hash up. The link gives no access: nothing reads it but the deletion. A row that's deleted loses its hash and its link. **A deleted person who returns stays a new person:** keeping a stable identifier after deletion is hard to square with `/privacy`'s "deleted" and 5.1.1(v), for almost nothing, because the purge left almost nothing to link to. The key is `LEFT_IDENTITY_SECRET`, held only by this api; with it unset, nothing is kept and no link is made, and the api logs a warning when it starts. A row deleted through the sync loses its hash and its link too, so a deleted person stays new, but the sync passes on one person, so **a row deleted that way leaves any rows behind it unreached.**

## Known limits

- **The outside purge doesn't reach GCS,** as above. It reaches every S3 bucket, with fakes only: no real folder has been listed or deleted on S3, and the api needs `s3:ListBucket` on `media` applied first.
- **A phone with no person of its own gets no session (`POST /v1/sessions/start`):** 403 "Add yourself first.", whether it came by invite or by code (Caleb, Nov 1). Convex's `sessions.start` answers a code phone today, so the adapter has to send one to add itself first. Build 1.1 has no codes, and the switch is off, so this has no App Review effect. It can't write as an existing phone-less person either, so nothing makes the phone theirs: it adds itself (`POST /profiles/self`). No 1.0 build ever calls this api, and the sync is one-way into Postgres, so old builds aren't affected. `device_needs_profile` is true for both kinds here, where Supabase's says only an opened invite.
- **A solo move deletes a face that can't come along** (the new family has that name, or is full). `needs_move` returns them as `would_delete`, and the app must warn before it sends `move: true`.
- **When the last signed-in person leaves, what they left stays stored with no way in.** Leaving isn't deleting: their recipes and messages stay under the old row, unless they moved with `solo`. It's the same gap as someone who left and came back, and it's Caleb's call.
- **The TEST family, at the switch.** If Apple's reviewer is its only signed-in person and deletes, its phone-less people go and it's blanked. Check how it's set up before the switch, so a reviewer always has a family to sign in to.
- **Once Mom has deleted, her old link still opens the card,** so whoever holds it could answer. The kid's card waits for that answer, and nothing else can reach her, so the link stays. Only the kid's link stops when the kid deletes.
- **A person's name stays in rows other people hold,** by decision: a "Zed left" note, and the removed person's own row, which keeps their name on what they sent (C1). Not changed here.
- **No nonce on Apple or Google tokens,** the same as Supabase's flow, which checks none. A stolen token works for its short life.
- **A family code can't be changed,** so removing someone can't keep out a person who holds it (Supabase's `TODO(caleb)`, kept).
- **A row a worker writes after the purge finishes** isn't caught. Other areas must refuse a deleted person when they arrive. `outbox` handlers skip them, per SCHEMA.md.
- **An anonymous kid's card, once Mom has deleted, stays** with its guess: the kid's link still works, and it waits for an answer. DISH-MIGRATION.md's open question 6.

## Open questions

`TODO(caleb)`, each with the documented default in place:

1. **A moved person's old row.** Decided by Caleb on Nov 1, and built: see "Someone who left the family".
2. **The Expo Go audience** in Apple's default list. Any Expo Go project can get tokens for it. **Recommendation:** drop it at the switch.
3. **Email sign-in,** as under "Not built".
4. **`JOIN_LINK_DAYS` (7), `JOIN_WINDOW_DAYS` (30), the solo rule, who a new phone may ask to be:** kept as they are, with their existing markers.

## Not verified

- **Real Apple and Google tokens and key sets.** The checks are real, and the keys are fake. Nothing was connected to either.
- **Real Apple revocation and Cartesia deletion.** Both ran against stubs, with the exact calls of the code they replace.
- **A real phone or a real build** against these routes. Shapes come from reading `supabase/` and `app/src/lib/api.ts`.
- **Whether `EDIBLE_CODE_KEY` is what Supabase sealed with.** If live used its fallback, the service key, old sealed values won't open: links get replaced and codes get re-sealed on next use, but nobody can recover a code until then.
- **Real SQS, RDS, load, Sentry alerts, EventBridge.** The queue path ran through `handleMessage` directly.
- **Real copied rows,** including the `signups` backfill and duplicate people from SCHEMA.md section 5.
- **`two_sided_live.mjs` and the other live checks:** read as checklists only.

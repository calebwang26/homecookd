# Upload ownership in Convex

Written Oct 31. **Built, and waiting for Apple:** Caleb's call is "Build, ship after approval", so nothing here is live
until 1.0 is approved. The code is `convex/lib/fileOwner.ts`.

## The gap

`files.uploadUrl` records no owner. The functions that take an uploaded file check less than they should:

| Function | What it checks about the file |
|---|---|
| `messages.send` | exists, size |
| `questions.answer` | exists, size |
| `messages.sharePhoto` (`photoContext`) | exists, image type, size; then sends the file to a model |
| `live.setCover` | **nothing**: confirmed, only that the id is a storage id |
| `cravings.sendVoiceRecipe` | fresh and not held by a card (the safe pattern; this plan builds on it) |

Storage ids show in file URLs, so anyone who has seen a file's URL has its id. With that id, a signed-in person can:

- **Read it:** attach it to their own message and get a fresh URL, or have a model read it through `sharePhoto`.
- **Delete it:** set it as their cover, then set another cover or delete their account. `setCover` and the account purge
  both delete the file a row points at, whoever uploaded it. This is the worst one.

**On the live data today (Oct 31):** 22 files are held across messages, answers, live frames and dish tables, none of them
by two rows, so there's no sign it has happened.

## The fix: the first person to use a fresh file owns it

Convex can't tie an upload URL to a file: the bytes go straight to storage, and only the phone learns the id. But nobody
else can know the id of a new file until it's attached, because that's when the first URL for it can appear. So:

1. **New table `fileClaims`** (`storageId`, `personId`, `familyId`, `at`), indexed by `storageId` and by `personId`.
2. **One helper, `claimFile(ctx, signed, id, { maxBytes, type })`,** in `convex/lib/fileOwner.ts`:
   - claimed by this person: fine (a retry, or the same photo sent again);
   - claimed by anyone else: refused;
   - not claimed and uploaded in the last day: this person claims it;
   - not claimed and older: refused.

   Refusals use each function's existing "Upload it first" wording, so a refusal says nothing about whose file it is.
3. **Use it everywhere a file comes in:** `messages.send`, `questions.answer`, `live.setCover` and
   `cravings.sendVoiceRecipe`. `setCover` also gets the size and image checks it lacks.
4. **`sharePhoto` claims too.** Its context is a query, which can't write, so the action calls a small claim mutation
   first. The kid can then take as long as they like over the note before sending.
5. **Files already on a card or a recording can't be attached,** even fresh. `claimFile` looks them up in `dishFiles`,
   `dishAnswers` and `liveFrames`. That covers what the server stores itself (`lib/dishAskRoutes.ts`,
   `lib/glassesRoutes.ts`) with no extra write per glasses frame, and it covers rows from before this change.
6. **Deleting checks the claim:** `setCover`'s old cover and the account purge delete a file only if the row's owner has
   the claim on it or no claim exists. The purge also removes the person's remaining claims and their files, such as a
   photo drafted and never sent.

**No backfill is needed.** Old files have no claim and are past the one-day window, so they can't be attached. Old rows
keep their files and URLs, since only new attachments are checked. One gap remains for the first day after the deploy: a
file attached in the day before it has no claim and is still fresh, so someone who has its URL could claim it. With this
little data, that isn't worth a backfill.

## Why build 6 keeps working

No client changes: the arguments, return values and error wording stay the same.

**Checked on build 6's code (`5ab9f6f69`, `app/src/lib/live/convex.ts`):** no phone holds an unclaimed upload for a day. All
three uploads go straight into their call: `setCover`, `answerQuestion`, and `sharePhoto`. The postcard then keeps the file
id in memory only (`PostcardStep`'s state) until `sendPhoto`, and `sharePhoto` has claimed it by then, so that can wait
any length of time. Nothing writes these ids to disk. Main has the same three, plus `sendVoiceRecipe`, which isn't in build 6.

## When it can ship

**After Apple approves 1.0 (Caleb).** The reviewer's account uses these functions, and a bug here could break sending a
voice note or photo during review. It's a Convex-only deploy: no Supabase `api` deploy, no EAS update, and no path on the
App Review guard's list.

**The PR stays unmerged until then.** Nothing deploys Convex on merge (the only workflow is `deploy-aws.yml`), but any later
`npx convex deploy` from main would ship whatever main holds, so merging early could send this out with someone else's work.

**At deploy time:**
1. Merge main into the PR, then run `npx vitest run` and `npx tsc -p convex --noEmit`. Merge the PR.
2. Deploy: `npx convex deploy --preview-name hackathon -y`, then check `expiresAt` is still null.
3. From the TEST family straight after: answer a question by voice, send a postcard photo with its note, and set a plate
   cover. Then check the logs for "Upload" refusals.
4. **To roll back:** redeploy the functions as they were and keep the two schema additions; they're unused then.

**For the move to AWS:** the new schema needs `fileClaims` too, or the purge and these checks lose their owner.

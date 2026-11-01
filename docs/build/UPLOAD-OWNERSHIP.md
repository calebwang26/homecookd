# Upload ownership in Convex: the plan (not built)

Written Oct 31 for the Master Agent. Nothing here is built or deployed.

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

**On the live data today (Oct 31):** 2 files are attached to messages, answers or covers, none of them twice, so there's
no sign it has happened. That check didn't cover the dish tables.

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
5. **Files the server stores itself get a claim when stored** (`lib/dishAskRoutes.ts`, `lib/glassesRoutes.ts`), with no
   person on it, so they can never be attached.
6. **Deleting checks the claim:** `setCover`'s old cover and the account purge's `dropFile` delete a file only if this
   person's claim is on it or no claim exists. The purge also deletes the person's claims.

**No backfill is needed.** Old files have no claim and are past the one-day window, so they can't be attached. Old rows
keep their files and URLs, since only new attachments are checked.

## Why build 6 keeps working

No client changes: the arguments, return values and error wording stay the same. From `app/src/lib/live/convex.ts`'s
notes, each app flow is upload, then use, by the same person. The one old-build risk is a phone holding an upload for more
than a day before attaching it. I haven't ruled that out, so the build PR must check it on build 6's code.

## When it can ship

It's a Convex-only deploy: no Supabase `api` deploy, no EAS update, and no path on the App Review guard's list. So it
doesn't have to wait for Apple. But the reviewer's account uses these functions, so a bug here could break sending a voice
note or photo during review.

**Recommendation:** build it now with tests, including another person's file refused for each function. Deploy once the
Master Agent is happy with those, then send a voice note and a photo from the TEST family straight after. If that risk
isn't worth taking during review, hold the deploy until Apple approves; the live check above shows nothing urgent.

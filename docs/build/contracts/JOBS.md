# Jobs: the api contract for the app (1.1)

Nov 2, 2026. Read from `aws-migration` at `a1816615b`, and checked against staging with calls that change nothing. For the App screens & recording chat. This covers filming and uploading a cook's videos, the job that turns them into a recipe, watching and stopping it, and reading recipes. Everything in [ACCOUNTS.md, "Conventions"](ACCOUNTS.md#conventions-all-areas) applies: the address, the session (`Authorization: Bearer <sessionToken>` on every route here), JSON bodies (`{}` when there's nothing to send), `Idempotency-Key`, paging, the one error shape ([ERROR-CODES.md](ERROR-CODES.md)), no stubs, and live polling. Every id is the one a session returns: kids picked for a recipe are their `personId`s. Fields are camelCase and times are epoch milliseconds, as Convex's were.

**A processing video is its cook's alone (Caleb, Nov 1).** Its upload, its job, its progress, its Stop and its "processing" or failed recipe card show only to the cook who filmed it, and anything that notifies about it goes only to her. The family sees the recipe once it's published. How the api holds to it:

| What | The rule in the code | Code |
|---|---|---|
| Jobs | Every read and stop filters on the session's family and person (`cook_id`). Another cook or a kid gets `[]` from the lists and 404 `not_found` from `/v1/jobs/:id`; another cook gets 404 from its cancel (a kid, 403 first) | `jobs/data.ts` `jobsOfCook`; `jobs/service.ts` `getJob`, `stop` |
| Progress | `/v1/live/jobs` reads the same list. There's no family-wide topic | `jobs/service.ts` `liveJobs` |
| Uploads | An upload belongs to the person who asked for its links (`files.owner_person_id`). Anyone else gets 404, and `POST /v1/jobs` refuses their `uploadId` | `jobs/uploads.ts` `ownUpload`; `service.ts` `createJob` |
| Recipes | A recipe that isn't `ready` shows only to its cook, in the list and by id | `recipes/reads.ts` `familyRecipes`, `readRecipe` |
| Recordings | Their cook's until the job's recipe is `ready` | `recordings/service.ts` `ownFamily` |
| Notifications | The api sends nothing about a job yet (`recipe_published` does nothing), so nothing reaches anyone else | `jobs/tasks.ts` |
| One gap | `POST /v1/jobs`'s retry finds the job by family and folder, so another cook sending the same `uploadId` would get its `jobId` and `recipeId` back. The id is a random uuid only the uploader holds (open item 7) | `jobs/service.ts` `createJob` |

## The flows

### 1. Film and upload one recording

1. Only a cook films: asking for links, making a job and both stops answer a kid 403 `forbidden`.
2. 1.1 makes no recording row: no route starts one (homie is off). So send the dish, the kids and the language on the job itself, and leave out `recordingId`.
3. Make an `Idempotency-Key` (a uuid) for this upload. Save it on the phone with each video's path, `contentType`, exact `size` and `durationS`, before the first call.
4. `POST /v1/video-uploads {videos: [{contentType, size, durationS}]}`. Save `uploadId`.
5. `POST /v1/jobs {uploadId, source: "phone", title, language, forKidIds, dishAskId?}` straight away (`dishAskId` only when she's filming for a request card), before the bytes land. Save `jobId`. The job waits as `uploading`. Making it early matters: if the phone never says it finished, the server's own check (`jobs.sweep`) queues it, and that check only looks at jobs that exist.
6. If she picked people to send it to: `POST /v1/pending-sends {uploadId, recipientIds, helloKey?, helloDurationS?}` with its own `Idempotency-Key` (Messages area). It's delivered by itself when the recipe is ready (MESSAGES.md, flow 10).
7. For each entry in `uploads`:
   - `method: "PUT"`: a background PUT of the whole file to `url`, with exactly `headers` (`Content-Type`) and the file's exact bytes. The link is signed for that type and that length, so a different size is refused by S3.
   - `method: "PARTS"`: flow 8.
8. A PUT that answers 403: the link ran out (at most 6 hours, maybe sooner). `POST /v1/video-uploads/:uploadId/links` for new ones and PUT again. 408, 429 and 5xx: retry as today. Today's loop treats 403 as final: that changes.
9. When every PUT has finished: `POST /v1/video-uploads/:uploadId/complete`. `complete: true` and `job.stage: "queued"` means it's on its way. A non-empty `missing` lists the `index` of each video S3 doesn't have yet: send those again.

### 2. Watching it process

Poll `GET /v1/live/jobs?since=<version>` while a screen shows jobs and the app is in the foreground. Wait `pollAfterMs` between polls: about 5 s while one of her jobs is moving, about 30 s otherwise. Details: "Live topic `jobs`" below.

| `stage` | Means | On screen |
|---|---|---|
| `uploading` | Waiting for its videos. The api doesn't see bytes | The phone's own upload progress ("still sending") |
| `queued` | Every video is in, waiting for a worker. With `error` set, it's **paused** by the daily spend cap until the next UTC day: "Recipe writing is paused for a little while. It will start on its own, nothing to do." | Waiting. Paused: it starts by itself |
| `preparing` | A worker took it: downloading and preparing. `progress` 0.02, then 0.1 | Working, with `progress` |
| `understanding` | Watching and listening: `progress` 0.2 to 0.7 | Working |
| `writing` | Writing the recipe: 0.7, 0.85, 0.9 | Working |
| `indexing` | In the type, but the AWS worker never sets it (it was Convex's search step) | Treat as `writing` |
| `done` | Published. `progress` 1, and `recipeId` is set | The recipe |
| `failed` | Over. `cancelledAt` set: she stopped it. Otherwise `error` says why | Stopped, or failed with "send it again" |

- `progress` is 0 to 1, three decimal places. It goes back to 0 when a worker retries (the job returns to `queued`).
- The worker checks for a stop every 30 s. A stage change shows on the next poll.

### 3. When it's done

1. The poll shows `stage: "done"` with `recipeId`.
2. `GET /v1/recipes/:id` answers the recipe with `status: "ready"`. Read `GET /v1/recipes` again too: it has no live topic.
3. The whole recipe (steps, video moments, clip and poster links) is the public file at `recipeJsonUrl`, the same `recipe.json` the app reads today, with full CDN links inside. The cover is `coverUrl`. Both are plain public GETs on the media CDN (`MEDIA_BASE_URL`: staging's own CloudFront; production's planned `media.homecookd.app`, MEDIA-MIGRATION.md).
4. From now on the family sees it. Before, only she did.
5. No push says it's ready (open item 3). She finds out by the poll, or on her next open.

### 4. Failure and retry

- **The worker retries by itself.** A failed attempt goes back to `queued`, 5 and then 10 minutes later. After the third it's `failed`.
- **`failed` is final.** `error` is one of the worker's English sentences. Don't match on them (open item 1); show the app's own words, and use `cancelledAt` to tell a stop.

  | `error` | When |
  |---|---|
  | "We couldn't finish this recipe. We'll take a look and try again." | Out of tries, bad model output, the job's spend cap, over 10 hours of work |
  | "One of the videos arrived empty. Please try adding it again." | A file of 0 bytes |
  | "That recording is over 4 hours. Try splitting it into shorter videos." | The worker measured more than 4 hours |
  | "We couldn't find any cooking in this video. Try filming the dish from the first ingredient to the plate." | No steps found |
  | "We couldn't find the video for this recipe. Please try adding it again." | The upload never finished: 7 days after the phone's last word (its start, a new link, a clip landing), or no files |
  | "Cancelled." | She stopped it (`cancelledAt` is set too) |

- **No route re-runs a failed job** (open item 5). `POST /v1/jobs` with the same `uploadId` answers the same failed job. To try again, upload the video from the phone again: a new `Idempotency-Key`, a new `uploadId`, a new job.
- **A call that fails** (500, 503, no answer): every write here is safe to repeat exactly as sent. See "Routes".

### 5. Cancel

1. With a `jobId`: `POST /v1/jobs/:id/cancel`. Before `POST /v1/jobs` has answered: `POST /v1/video-uploads/:uploadId/cancel`.
2. Also stop the phone's own upload tasks. The api can't stop a PUT under way, and a link works until it expires.
3. The stop shows at once: `stage: "failed"`, `progress: 0`, `error: "Cancelled."`, `cancelledAt` set. A "processing" card becomes `failed` (when recipe writes are on).
4. Within 30 s the worker stops and deletes the raw video and anything it published. The api's sweep deletes the upload's files again 7 hours or more later, once every link has expired.
5. After that, `/links`, `/parts` and `/parts/finish` answer 404 for this upload. `POST /v1/jobs` with it answers the stopped job, or 400 `invalid` if there was no job yet.
6. A `done` job can't be stopped: `{stopped: false}`. Deleting a finished recipe isn't built (open item 11).

### 6. A camera-roll upload

Flow 1, with these differences:
- Up to 20 videos in one upload, in the order she picked them. The worker reads them in that order (keys `01.mov`, `02.mp4`, …).
- `contentType` from the asset: `video/quicktime`, `video/mp4`, `video/x-m4v`, or any other `video/*` (kept as `.mov`).
- `size` is the file's exact byte count. The app's `fileSizeFor` fallback of 0 is refused now.
- `durationS` when the picker knows it. The api adds up only the ones sent (4 hours at most). The worker measures again and fails a job over 4 hours.
- `source: "phone"`, and `title` is the dish she typed, if any.
- Check before sending: 1 to 20 videos, each a `video/*`, each at most 20 GiB, 4 hours in all.
- Each video over 5 GiB comes back as `PARTS` (flow 8).

### 7. Resuming after the app dies mid-upload

Keep on disk, written before each call: the `Idempotency-Key`; then `uploadId`; then `jobId`; each video's path, type and size; for a `PARTS` video, each landed part's `partNumber` and `etag`. On the next launch, for each upload not yet `complete`:

1. No `uploadId`: `POST /v1/video-uploads` again with the same key and the same videos. It answers 200 with the same upload.
2. No `jobId`: `POST /v1/jobs` again with the same `uploadId`. It answers the job, or makes it.
3. `POST /v1/video-uploads/:uploadId/complete`. `missing` says which videos S3 still lacks: iOS may have finished a background upload while the app was gone. `job.stage` says where the job is. `cancelled: true`: stop.
4. Each missing `PUT` video: `POST /links` and PUT it again from the start. Each missing `PARTS` video: only the parts with no saved `etag` (`/parts` for their links), then `/parts/finish`.
5. `POST /complete` again once they land.

If the app never comes back, `jobs.sweep` asks S3 for every job still `uploading` (every hour on staging) and queues each whose videos all landed. With no word from the phone for 7 days, the job fails ("We couldn't find the video…"); what landed stays. An upload with no job and nothing landed is forgotten after 7 days. S3 deletes every raw video 14 days after it lands, whatever happens.

### 8. A video over 5 GiB: parts

S3 takes at most 5 GiB in one PUT. A bigger video (up to 20 GiB) comes back as `{index, method: "PARTS", partBytes, partCount}`. `partBytes` is 67,108,864 (64 MiB). `partCount` is `ceil(size / partBytes)`, so 81 to 320.

1. **Slice it.** Part `n` (from 1) is the bytes from `(n - 1) × partBytes` up to, not including, `min(n × partBytes, size)`. Every part is `partBytes` long except the last, which is `size − partBytes × (partCount − 1)`. Each link is signed for its part's exact length.
2. **One file per part.** An iOS background upload sends a whole file, so write each part to its own file, a few ahead of the uploads rather than all at once (a 20 GiB video would need 20 GiB more space). Delete each part's file once it lands.
3. **Links:** `POST /v1/video-uploads/:uploadId/parts {index, partNumbers}`, with at most 100 numbers a call, as they're needed. The first call starts the video's upload at S3. Each link lasts up to 6 hours. A 403 means it ran out: ask again for that number.
4. **PUT** each part's bytes raw to its `url`, with no headers beyond its `headers` (empty). Save the response's `ETag` header exactly as it came, quotes included. A part that fails goes again under the same number: S3 keeps the last one.
5. **Finish:** when every part has an `etag`, `POST /v1/video-uploads/:uploadId/parts/finish {index, parts: [{partNumber, etag}, …]}` with all of them. `finished: true`, then `/complete` as for any video. Don't call `/parts/finish` for a video `/complete` no longer lists in `missing` (open item 6).
6. An unfinished one is aborted by S3 7 days after it started. A cancel doesn't abort it sooner.

## Routes

Code: `api/src/modules/jobs/` (`routes.ts`, `uploads.ts`, `service.ts`, `data.ts`, `tasks.ts`), `api/src/storage.ts` (links), `api/src/modules/recipes/`, `api/src/modules/recordings/`, `api/src/modules/live/`.

**Shared codes.** Every route here can also answer: `signed_out` (401: start a session once, ACCOUNTS.md), `removed_from_family` (403: only account deletion still works), `invalid` (400 from the schema, a NUL byte, or a body that isn't JSON; 415 for a content type that isn't JSON: fix the call), `too_large` (413: a body over 1 MB), `unavailable` (503 with `retry-after`: nothing was written, retry), `server_error` (500). The route tables list only each route's own. **Every write here is safe to repeat exactly as sent,** so after a 500, a 503 or a lost answer, send the same call again. A `rate_limited` 429's `retry-after` runs to the end of the hour or day window.

| Route | Who | Idempotency | Limit, per person |
|---|---|---|---|
| `POST /v1/video-uploads` | A cook | `Idempotency-Key` required | 30 an hour and 100 a day |
| `POST /v1/video-uploads/:uploadId/links` | Its uploader | None needed | 120 an hour, shared with `/parts` |
| `POST /v1/video-uploads/:uploadId/parts` | Its uploader | None needed | 120 an hour, shared with `/links` |
| `POST /v1/video-uploads/:uploadId/parts/finish` | Its uploader | None needed | 240 an hour, shared with `/complete` |
| `POST /v1/video-uploads/:uploadId/complete` | Its uploader | None needed | 240 an hour, shared with `/parts/finish` |
| `POST /v1/video-uploads/:uploadId/cancel` | A cook | None needed | None |
| `POST /v1/jobs` | A cook | By `uploadId`, no header | 240 an hour |
| `GET /v1/jobs`, `GET /v1/jobs/:id` | Anyone; their own jobs | | None |
| `POST /v1/jobs/:id/cancel` | Its cook | None needed | None |
| `GET /v1/recipes`, `GET /v1/recipes/:id` | The family | | None |
| `POST /v1/recipes/:id/memories-opt-in` | Its cook | None needed: it sets a value | None |
| `GET /v1/recordings/…`, `GET /v1/cooking` | The family; a recording is its cook's until its recipe is `ready` | | None |
| `GET /v1/live/jobs` | Anyone; their own jobs | | 120 polls a minute, all topics together |

### `POST /v1/video-uploads`: links for one upload

**Header:** `Idempotency-Key`, required: 8 to 128 of `A-Z a-z 0-9 _ -`, the shared rule (ACCOUNTS.md, `idempotency.ts`). Use a uuid. One key per upload.

**Body:** `{videos: [{contentType, size, durationS?}]}`.

| Field | Rule |
|---|---|
| `videos` | 1 to 20, in the order the worker will read them. `index` in the answer is the place here, from 1 |
| `contentType` | `video/<type>`, at most 100 characters. Stored lowercase |
| `size` | The exact bytes, a whole number from 1 to 21,474,836,480 (20 GiB) |
| `durationS` | Optional. Seconds, 0 to 86,400 each; at most 14,400 (4 hours) for those sent |

**Answer:** 201 the first time; 200 for the same key with the same videos (same types and sizes, in order; `durationS` isn't compared).

```json
{ "uploadId": "3f0c…", "uploadPath": "3f0c…/",
  "uploads": [
    { "index": 1, "method": "PUT", "url": "https://…", "headers": { "Content-Type": "video/quicktime" }, "expiresInS": 21600 },
    { "index": 2, "method": "PARTS", "partBytes": 67108864, "partCount": 97 } ],
  "expiresInS": 21600 }
```

- `uploads` lists only videos the api hasn't marked as in. After `/complete` has seen some land, a retry lists fewer.
- `expiresInS`: the first PUT link's life in seconds (6 hours), or null when there's no PUT link.

| Code | When | The app does |
|---|---|---|
| `forbidden` (403) | A kid | Don't offer Record to kids |
| `invalid` (400), `field: "Idempotency-Key"` | Missing: "Send an Idempotency-Key with this write." Malformed: "An Idempotency-Key is 8 to 128 letters, digits, - or _.", as on every write | A bug |
| `invalid` (400), `field: "videos"` | "Pick 1 to 20 videos.", "Every file must be a video.", "A video's length doesn't look right.", "That's more than 4 hours of video. Please pick fewer videos." | Check before sending |
| `too_large` (413) | A video over 20 GiB | Check the size before sending |
| `idempotency_conflict` (409) | This key with other videos, or on another route | A bug: a new upload needs a new key |
| `not_found` (404) | The upload behind this key was cancelled | Start again with a new key |
| `rate_limited` (429) | 30 an hour, 100 a day | Wait `retry-after` |
| `provider_down` (502) | S3 couldn't sign | Retry the same call |

### `POST /v1/video-uploads/:uploadId/links`: new links

**Body:** `{}`. **Answer:** `{uploadId, uploads, expiresInS}`, as above, for the videos not in yet (no `uploadPath`). It also restarts the 7-day clock.

| Code | When | The app does |
|---|---|---|
| `not_found` (404) | Not her upload, or cancelled | Stop sending; drop it |
| `rate_limited` (429) | 120 an hour, with `/parts` | Wait `retry-after` |
| `provider_down` (502) | S3 couldn't sign | Retry |

### `POST /v1/video-uploads/:uploadId/parts`: links for some parts

**Body:** `{index, partNumbers}`. `index` is a `PARTS` video's `index`. `partNumbers`: 1 to 100 whole numbers, each from 1 to its `partCount`.

**Answer:** `{uploadId, index, parts: [{partNumber, method: "PUT", url, headers: {}, expiresInS}], expiresInS}`.

| Code | When | The app does |
|---|---|---|
| `not_found` (404) | Not her upload, or cancelled | Stop sending |
| `invalid` (400), `field: "index"` | "That isn't one of this upload's videos.", "That video goes up in one piece." | A bug |
| `invalid` (400), `field: "partNumbers"` | "Ask for 1 to 100 parts of this video, numbered from 1 to N." | A bug |
| `rate_limited` (429) | 120 an hour, with `/links` | Wait `retry-after` |
| `provider_down` (502) | S3 couldn't start or sign | Retry |

### `POST /v1/video-uploads/:uploadId/parts/finish`: join the parts

**Body:** `{index, parts: [{partNumber, etag}]}`: every part from 1 to `partCount` once, `etag` 1 to 200 characters.

**Answer:** `{finished: boolean}`. True once S3 holds the whole video at its size.

| Code | When | The app does |
|---|---|---|
| `not_found` (404) | Not her upload, or cancelled | Stop |
| `invalid` (400), `field: "parts"` | "That isn't every part of this video." | Send them all |
| `invalid` (400), `field: "index"` | As `/parts`, and "This video's upload hasn't started." | A bug |
| `rate_limited` (429) | 240 an hour, with `/complete` | Wait `retry-after` |
| `provider_down` (502) | S3 refused or failed to join them. A wrong `etag` lands here too (open item 6) | Retry. If it keeps failing, resend the parts |

### `POST /v1/video-uploads/:uploadId/complete`: is it all in?

**Body:** `{}`. The api asks S3 about each video not yet marked, marks what landed, and, once all are in, queues a job that waits on them, in one transaction.

**Answer:** `{complete: boolean, missing: [index, …], cancelled: boolean, job: {jobId, stage} | null}`. `job` is null until `POST /v1/jobs` has made one. A job made after `complete: true` is queued as it's made. A cancelled upload answers 200 with `cancelled: true`, not 404.

| Code | When | The app does |
|---|---|---|
| `not_found` (404) | Not her upload | Drop it |
| `rate_limited` (429) | 240 an hour, with `/parts/finish` | Wait `retry-after` |
| `provider_down` (502) | S3 couldn't say | Retry later; the sweep checks too |

### `POST /v1/video-uploads/:uploadId/cancel`: stop by upload

**Body:** `{}`. **Answer:** `{stopped: boolean}`. True when it stopped a job. False when there's no job yet (her files are still marked to delete, so a later `POST /v1/jobs` with this id is refused), when the job is already over, and when the folder isn't hers: never a 404.

| Code | When | The app does |
|---|---|---|
| `forbidden` (403) | A kid | Don't offer it |

### `POST /v1/jobs`: make the job

**Body:**

| Field | Rule |
|---|---|
| `uploadId` | Required. The `uploadId`, not `uploadPath` |
| `source` | Required: `"phone"` or `"glasses"`. 1.1 sends `"phone"` |
| `title` | Optional, up to 1000 accepted; trimmed and kept to 120. Without one, a "processing" card says "New recipe" until the worker writes the recipe's own title |
| `language` | Optional, two letters (`"mr"`). Otherwise the recording's, then the cook's (`/v1/me`), then `"en"` |
| `forKidIds` | Optional: up to 20 kids of this family, by `personId`. `forKidId` is the older single form |
| `recordingId` | Optional: her own recording. 1.1 has none: leave it out |
| `dishAskId` | Optional: the request card this recording answers, when she films from it (`/record?ask=<id>`). Once the recipe is ready, the card's kid gets the `filmed` push (MESSAGES.md, flow 9). Kept only for a card asked of her in her family; any other is left off, with no error, and the job is made all the same |

**Answer:** 201 `{jobId, recipeId}` for a new job; 200 with the same job for the same `uploadId` (the body isn't compared: the first call's title and kids stay). `recipeId` is the "processing" card's id while recipe writes are on, and null otherwise (staging today); the job carries it once it's `done`. The job starts `uploading`, or `queued` if every video is already marked in.

| Code | When | The app does |
|---|---|---|
| `forbidden` (403) | A kid | Don't offer it |
| `invalid` (400), `field: "uploadId"` | "Upload the video before sending it.": not her upload, cancelled, or malformed | Start the upload again |
| `invalid` (400), `field: "language"` | "Pick a language from the list." | Send two letters |
| `invalid` (400), `field: "forKidIds"` | "That person isn't in your family.": not a live kid here, or more than 20 | Reload `/family` and pick again |
| `not_found` (404) | "That recording isn't yours." (`recordingId`) | Leave `recordingId` out |
| `not_moved` (501) | **Staging only**, while `recipes` is a read-only copy. Not staging's state today | Say it isn't ready |
| `rate_limited` (429) | 240 an hour | Wait `retry-after` |

### `GET /v1/jobs?cursor=` and `GET /v1/jobs/:id`

`GET /v1/jobs` answers `{jobs: [Job], nextCursor}`, her newest 20 a page. A kid's list is empty. `GET /v1/jobs/:id` answers one Job, or 404 `not_found` when it isn't hers or is gone. A bad cursor is 400 `invalid`, `field: "cursor"`.

**A Job.** The first nine fields are also each entry of `/v1/live/jobs`'s `data` (the app's `LiveJob`, unchanged). A field with no value is left out.

| Field | Type | Meaning |
|---|---|---|
| `_id` | string | The `jobId` |
| `_creationTime` | ms | When it was made |
| `uploadPath` | string | `"<uploadId>/"`: match a job to its upload by this |
| `source` | `"phone"` \| `"glasses"` | |
| `stage` | see flow 2 | A stopped job reads `failed` from the moment she stops it |
| `progress` | 0 to 1 | |
| `error` | string | An English sentence (flow 4), or the paused one on a `queued` job |
| `recipeId` | string | The card's id while recipe writes are on; else set when `done` |
| `title` | string | What she typed, at most 120 |
| `familyId`, `cookId` | string | `cookId` is always the caller |
| `recordingId` | string | |
| `language` | string | Two letters |
| `forKidId` | string | Only when there's exactly one kid |
| `forKidIds` | string[] | |
| `claimedAt` | ms | When a worker last took it |
| `videoGaps` | array | Glasses only |
| `updatedAt` | ms | |
| `uploadFinishedAt` | ms | S3's time for the last video landing |
| `finishedAt` | ms | Done, failed or stopped |
| `cancelledAt` | ms | She stopped it |

### `POST /v1/jobs/:id/cancel`: stop by job

**Body:** `{}`. **Answer:** `{stopped: boolean}`: true when this call stopped it; false once it's `done` or `failed`.

| Code | When | The app does |
|---|---|---|
| `forbidden` (403) | A kid | Don't offer it |
| `not_found` (404) | Not hers, or gone (Convex said `false`) | Drop it from the screen |

### Recipes

Code: `api/src/modules/recipes/routes.ts`, `reads.ts`, `switch.ts`, `writes.ts`, `media.ts`.

| Route | Answer | Codes |
|---|---|---|
| `GET /v1/recipes?cursor=` | `{recipes: [Recipe], nextCursor}`, newest first, 100 a page: the family's `ready` recipes and her own of any status | `invalid` (`field: "cursor"`): a bug |
| `GET /v1/recipes/:id` | One Recipe | `not_found`: gone, another family's, or someone else's that isn't `ready`. Drop it |
| `POST /v1/recipes/:id/memories-opt-in` `{optIn: boolean}` | `{ok: true}`. The app doesn't call it today | `not_found` ("That recipe isn't here anymore."): drop it. `forbidden` ("Only the cook can share these."): don't offer it. `not_moved` (501, **staging only**, while recipe writes are off: today): say it isn't ready |

**A Recipe** (Convex's fields; empty ones left out):

| Field | Type | Meaning |
|---|---|---|
| `_id`, `_creationTime` | string, ms | |
| `familyId`, `cookId`, `cookName` | string | `cookName` reads "Deleted" for a deleted cook |
| `title` | string | |
| `status` | `"processing"` \| `"ready"` \| `"failed"` | Only `ready` shows to the family |
| `libraryId` | string | The id Messages' routes take as `libraryId` |
| `recipeJsonUrl` | string | The whole recipe, public on the media CDN. Missing until `ready` |
| `coverUrl` | string | A stock photo on `homecookd.app/media/…`, or the cover on the CDN with `?v=` |
| `steps` | `[{order, title, text, quote?, quoteOriginal?}]` | |
| `stepCount` | number | |
| `memories` | array | Her stories and tips: `[]` for everyone else until `memoriesOptIn` |
| `memoriesOptIn` | boolean | |
| `mossIndexedAt` | ms | |
| `language` | string | |
| `sharedAt` | ms | On the Community map since |
| `storyCard` | `{text, writtenAt?, usedStories?, culture?, quote?}` | |
| `hiddenAt` | ms | The team took it off the Community map after a report: `sharedAt` is cleared, and sharing it again is 409 `taken_down` until the team lifts it. Say so on her recipe page instead of the share switch |
| `addedIngredients` | array | |

**The recipes switch** (`switch.ts`): `open` needs `RECIPE_WRITES=on` (since the recipe-writes PR, `claude/aws-recipe-writes`; before it, also `sync_copies.moved_at`, which only the old sync set). Anything else is `closed` (no sync ever ran: no "processing" card, `recipeId: null`, opt-in 501) or `locked` (a read-only copy: `POST /v1/jobs` and opt-in 501). Staging sets no `RECIPE_WRITES` and runs no sync, so it's `closed` (read from `main.tf` and migration 012's defaults, not from the database).

### Recordings and who's cooking (reads only)

Code: `api/src/modules/recordings/`. Nothing on AWS makes a recording or a cooking row yet (homie is off), so in 1.1 these answer 404 or empty lists.

| Route | Answer | Codes |
|---|---|---|
| `GET /v1/recordings/:id` | `{_id, _creationTime, familyId, cookId, forKidId?, forKidIds?, dish?, language, source, status, startedAt?, endedAt?, videoStartedAt?, memoriesOptIn?, jobId?, videoUrl?, updatedAt}` | `not_found` |
| `GET /v1/recordings/:id/log` | `{events: [{at, kind, title, text, saidAs?}], windows: {analysed, missed}}` | `not_found` |
| `GET /v1/recordings/:id/frame` | `{frame: {url, at} \| null}` | `not_found` |
| `GET /v1/recordings/glasses-videos` | `{videos: [{recordingId, videoUrl?, dish?, at}]}`, at most 10 | |
| `GET /v1/cooking` | `{cooking: [{kidId, kidName, recipeId, recipeTitle, stepOrder, stepCount, updatedAt}]}`, at most 50 | |

## Live topic `jobs`

`GET /v1/live/jobs?since=<version>` with the session. The rules for every topic are in ACCOUNTS.md, "Live updates". Specific to `jobs`:

| | |
|---|---|
| `since` | The last `version`, or empty on the first call. At most 64 of `A-Z a-z 0-9 _ -`; anything else is 400 `invalid`, `field: "since"` |
| `version` | 22 characters: a hash of exactly what `data` would be. The same `since` back means `changed: false` |
| `pollAfterMs` | 4,500 to 5,500 while one of her jobs isn't `done` or `failed` and has changed in the last 2 hours; otherwise 27,000 to 33,000. The server can raise it for every phone (`LIVE_POLL_FLOOR_MS`). Wait at least this long |
| `data` | Only when `changed: true`: her newest 20 jobs, newest first, each the Job's first nine fields. A kid's is `[]` |
| Header | `cache-control: no-store` |

| Code | The app does |
|---|---|
| `signed_out` (401) | Stop polling. Start a session once (ACCOUNTS.md), then poll again |
| `removed_from_family` (403) | Stop polling |
| `live_off` (410) | Stop polling this topic, and read `GET /v1/jobs` on focus (ACCOUNTS.md, open item 7) |
| `rate_limited` (429) | 120 polls a minute per person across topics, or 30 refused polls a minute per address. Wait `retry-after` |
| `unavailable` (503) | Keep what's on screen; wait `retry-after` |

Code: `api/src/modules/live/routes.ts` (`topics`), `service.ts`; `api/src/modules/jobs/service.ts` (`liveJobs`, `toLiveJob`). A client sketch, `poll.ts`, is in LIVE-UPDATES.md, "The app change".

## What the app calls today, and what replaces it

From APP-BACKEND-INVENTORY.md on `main` (`0ed6ddeab`): its "Recording, upload and jobs", "Recipes and library" and the voice rows of "Kid cooking", checked against the app's code.

| Today | App wrapper | 1.1 |
|---|---|---|
| Upload signer `POST /` (new job) | `uploads.ts:startUpload` | `POST /v1/video-uploads` with an `Idempotency-Key`, then `POST /v1/jobs`. No `job_id` or `status_url` comes back |
| Signed GCS PUT links | `uploads.ts:startUpload` | S3 links: one PUT per video, or parts over 5 GiB. A 403 means "ask `/links`", not final. Exact sizes only |
| The job's public `status_url` | `uploads.ts:fetchJobStatus` | Gone: `/v1/live/jobs`, `GET /v1/jobs/:id`, or `/complete`'s `job` |
| Upload signer `action: cancel` | `deletes.ts:requestCancel` | Gone: the two cancel routes do all of it |
| Upload signer `action: delete` (a recipe) | `deletes.ts:requestDelete` | **Not built** (open item 11) |
| Convex `jobs:create` | `convex.ts:createJob` | `POST /v1/jobs`, with `uploadId` (no slash) |
| Convex `jobs:mine` | `convex.ts:useLiveJobs`, `recordingJob`, `uploadJob`; `useDoorsGate.ts` | `GET /v1/live/jobs`: the same `LiveJob`s, her newest 20. Older: `GET /v1/jobs?cursor=`. One upload's job: `/complete`'s `job`, then `GET /v1/jobs/:id` |
| Convex `jobs:cancel` | `convex.ts:cancelLiveJob` | `POST /v1/jobs/:id/cancel`. Not hers is 404 now, not `false` |
| Convex `jobs:cancelUpload` | `convex.ts:cancelLiveUpload` | `POST /v1/video-uploads/:uploadId/cancel` |
| Convex `live:startRecording` | `convex.ts:startRecording`, from `record.tsx` | **Not built** (deferred with homie). On iPhone the in-app camera calls it today even with homie off (open item 9) |
| Convex `live:startFilming`, `live:endRecording` | `convex.ts`; `recording.tsx`, `StoppedEarlyCard.tsx` | **Not built** (deferred with homie and the glasses) |
| Convex `live:setCover`, with `files:uploadUrl` | `convex.ts:setCover` | **Not built**: no route takes a plate photo for a job (open item 10) |
| Convex `files:uploadUrl` (its other uses) | `convex.ts:uploadFile` for answers, voice recipes, photo notes | Their own areas: `POST /v1/uploads` and `/v1/uploads/confirm` (Messages), `POST /v1/cravings/:id/voice-recipe/upload` (Cravings) |
| Convex `live:recording` | `convex.ts:useRecording`, `recordingJob` | `GET /v1/recordings/:id`, read on focus: there's no topic, and 1.1 makes no recordings |
| Convex `liveEvents:forRecording` | `convex.ts:useLiveLog` | `GET /v1/recordings/:id/log` |
| Convex `liveEvents:frame` | `convex.ts:useLiveFrame` | `GET /v1/recordings/:id/frame` |
| Convex `glasses:videos` | `convex.ts:useGlassesVideos` | `GET /v1/recordings/glasses-videos`: empty while the glasses are off |
| Convex `homie:news` | `news.ts:useHomieNews` | **Not built** (off with homie) |
| Supabase `POST /pending-sends` | `uploads.ts:ensurePendingSend` | `POST /v1/pending-sends {uploadId, recipientIds, helloKey?, helloDurationS?}`, `Idempotency-Key` required (Messages area). Delivered by itself when the recipe is ready (MESSAGES.md, flow 10) |
| Convex `recipes:list` | `data.ts:useFamilyRecipes`, `useDoorsGate.ts`, `convex.ts:recipeMap`, `recipes.ts:useFamilyLibrary` | `GET /v1/recipes?cursor=`, 100 a page. No topic: read on focus and when a job turns `done`. A recipe that isn't `ready` shows only to its cook |
| None today (`recipes.get`, `recipes.setMemoriesOptIn`) | | `GET /v1/recipes/:id`; `POST /v1/recipes/:id/memories-opt-in` |
| Convex `cooking:current` (as a read) | `convex.ts` | `GET /v1/cooking`. Empty: nothing on AWS writes those rows. Its name-matching use is gone (ACCOUNTS.md) |
| Public bucket `library.json`, `<id>/recipe.json`, covers, clips | `recipes.ts` (`EXPO_PUBLIC_BUCKET_URL`) | A family recipe: its `recipeJsonUrl` and `coverUrl`. The public library: `library.json` on the media host (MEDIA-MIGRATION.md), with no api route (open item 15) |
| Supabase `GET /dish-stats`, `GET /hearts/recent`, `GET` and `POST /favorites`, `GET /me/recipe-stats`, `GET /recipes/:id/activity`, `POST /events`, `POST /send-recipe`, `POST /shares` | `dishStatsApi.ts`, `favorites.ts`, `stats.ts`, `ShareSheet.tsx`, `messaging.ts`, `sendRecipe.ts`, `shareLink.ts` | Messages area, MESSAGES-MIGRATION.md: the same under `/v1`, except activity is `GET /v1/dishes/:libraryId/activity` |
| Supabase `POST /cooking`, `GET /cooking`, `POST /cooking/end`, `GET` and `POST /profile/share-cooking` | `cookingApi.ts` | **Not built** (open item 12) |
| Voice service socket `/cook` | `voice.ts:useVoiceCooking` | The voice service, behind the same host: **not moved** (below). `cook/[id].tsx` opens it only when `HOMIE_ON` |
| Voice service socket `/record` | `homie.ts:useHomieRecording` | Not moved. With homie off, `recording.tsx` uses `useQuietRecording` |
| Voice service `POST /speak` | `speak.ts:speak` | Not moved. `speak()` returns before any call while `HOMIE_ON` is false |
| Voice service `POST /homie/line` | `news.ts:askLine` | Not moved. Only `HomieOverlay` calls it, mounted only when `HOMIE_ON` |

**The voice service hasn't moved.** It checks a Convex session (`voice/src/convex.ts`, `/voice/session`), not the api's, and reads recipes from Convex. On staging it's set to `VOICE_STUB=1` (any token, a stub recipe) and `VOICE_FAKE_SPEECH=1`, with `voice_count = 0` tasks: `/cook`, `/record`, `/speak` and `/homie/line` answered the load balancer's 503 HTML page on Nov 2. With `HOMIE_ON = false`, 1.1 calls none of it (open item 13).

## Staging testing

`https://d2zh46br3dalyf.cloudfront.net`, signing in as in ACCOUNTS.md, "Staging testing". Checked Nov 2 with no session: `/health` answers `ok`, `/ready` `{"database":"ok"}`, every route in this doc answers 401 `signed_out` (so all are deployed), and an unknown path 404 `no_route`.

**What works:** everything up to `queued`. Upload links on the real staging S3 bucket, PUTs, parts, `/complete`, making a job, the live poll, the list, and both stops. The api has `s3:ListBucket` on `uploads` (`infra/modules/env/iam.tf`), so `/complete` answers mid-upload. JOBS-MIGRATION.md lists no real video PUT to S3 and no iPhone background upload against a signed length as run yet ("Not verified"): the first 1.1 upload is that test.

**What doesn't:** processing. Settings in `infra/envs/staging/main.tf` that change behavior:

| Setting | Effect |
|---|---|
| `worker` `desired_count = 0`, no model keys | Nothing takes a job: it reaches `queued` and stays there. No `done` and no recipe, except through `POST /v1/test/recipe` with `jobId` (below) |
| `RECIPE_WRITES=on` (#300) | The recipes switch is `open`: `POST /v1/jobs` makes the "processing" card and returns its `recipeId`, and edits and opt-in write |
| `jobs.sweep` at `rate(1 hour)` | A job whose phone never calls `/complete` waits up to an hour to become `queued` |
| `JOBS_SINGLE_PUT_MAX_BYTES=20971520`, `JOBS_PART_BYTES=5242880` | A video over 20 MiB comes back as `PARTS` with `partBytes` 5,242,880 (5 MiB), so a 25 MiB video is 5 parts; up to 20 MiB it's one `PUT`. Production sets neither, and Terraform refuses them there: 5 GiB and 64 MiB |
| `voice` `voice_count = 0`, `VOICE_STUB=1`, `VOICE_FAKE_SPEECH=1` | No voice service (503 HTML) |
| `OVERLOAD_SHED=on`, two small api tasks scaling to 4 | Some 503 `unavailable` under load |
| CloudFront in front | Every tester shares one address, so the live poll's 30 refused polls a minute is shared: a phone that keeps polling with a dead session gets everyone 429 for the rest of that minute |
| The `uploads` bucket has no CORS rule | Videos upload from the iPhone build only, not the app's web build |
| `uploads` expires raw videos after 14 days | As production |

**A finished recipe without a real job: `POST /v1/test/recipe` (staging only).**
- Headers: `Authorization: Bearer <a cook's sessionToken>` and `x-test-signin-key: <TEST_SIGNIN_KEY>`, the same key as `/v1/test/sign-in`. Without the key on the server the route doesn't exist (404 `no_route`), as in production.
- Body, every field optional: `{title?, steps?, jobId?, newestJob?}`. `title` is up to 120 characters (default "Masala chai (test recipe)", or the job's own title); `steps` is 1 to 12 strings, each one step's instruction (default: three made-up steps with substeps, step ingredients and a quote).
- **Without `jobId`:** a new ready recipe in her family, with her as its cook.
- **With `jobId`** (one of her own jobs, at any stage before `done`, not stopped): it finishes that job as the worker's publish does. The job's "processing" card becomes the ready recipe (a new one if it has none), the job goes to `done` with progress 1 and its `recipeId`, and `recipe_published` goes on the outbox, which delivers a pending send registered for its upload and queues `filmed` for its request card, as a real publish does. `/v1/live/jobs` shows the move on its next poll, and the recipe opens from the job's `recipeId`.
- **With `newestJob: true`** (not with `jobId`): the same, for the family's newest `queued` job, whoever filmed it, and the recipe is that cook's. It's for a phone test on a real account: the job is only its cook's to see, so the test cook beside them can't read its id. Sign the test cook into the same family, film on the phone, then call this as the test cook.
- **201** `{recipeId, recipeUrl}`; `recipeUrl` is the `recipeJsonUrl` `GET /v1/recipes/:id` returns. It lists and opens like a real recipe: `libraryId` `test-recipe-<12 hex>`, a `coverUrl`, steps with moments, one made-up story and one tip in `memories` (shown only to the cook until her opt-in), and a family `recipe.json` (`family: true`, no stories) whose media are a 24-second silent portrait video, a silent voice track, a cover and one still per step, at `test-recipe-<id>/<id>-a1/{play.mp4, voice.m4a, poster.jpg, steps/NN.jpg, recipe.json}`.
- Refusals: 401 `signed_out` (no session, or a wrong or missing key), 403 `forbidden` (a kid), 400 `invalid` (more than 12 steps, an empty step, a title over 120), 404 `not_found` (a `jobId` that isn't hers, or no queued job in the family for `newestJob`), 400 `invalid` `field: "newestJob"` (sent with `jobId`), 409 `conflict` (that job is already done, failed or stopped), 501 `not_moved` (recipe writes closed), 502 `provider_down` (S3), 429 `rate_limited` (60 an hour per person).
- Deleting her account removes it, files and all.

**Testing parts with a small file.** On staging, pick a video over 20 MiB, e.g. 25 MiB (26,214,400 bytes). `POST /v1/video-uploads` answers it `{index, method: "PARTS", partBytes: 5242880, partCount: 5}`. Slice it into five 5 MiB parts (flow 8), `POST /parts` for their links, PUT each, keep each `ETag`, then `POST /parts/finish` and `/complete`. A video of 25 MiB plus 1 byte is 6 parts, the last one 1 byte. Once the job is `queued`, `POST /v1/test/recipe {jobId}` finishes it. The 20 GiB cap, the 120 link requests an hour (`/links` and `/parts` together) and the 1 to 100 parts per call are as in production.

## Open items

Owners: **API** is the AWS backend chat, **App** is App screens & recording, **Caleb** is a decision only he makes.

1. A failed job carries only an English sentence in `error`, with no code, so the app can't say it in the cook's language without matching text: API adds a code beside it (`no_steps`, `too_long`, `empty_upload`, `no_upload`, `cancelled`, `paused`, `failed`). **API**
2. ~~Nothing delivered a pending send when a recipe was done on AWS.~~ **Fixed in #311:** `recipe_published` delivers it (MESSAGES.md, flow 10), and a register after the publish reads the job, not the signer's old status file. The app calls nothing more. **API**
3. No push tells a cook her recipe is ready; when one is added it goes to the job's `cook_id` only. **API**
4. ~~Staging can't produce a finished recipe.~~ Done: `POST /v1/test/recipe` (above). **API**
5. No route re-runs a failed job from its landed upload, so a retry sends the whole video again: say whether that's wanted. **Caleb**
6. `/parts/finish` reports S3 refusing to join the parts (a wrong or missing `etag`) as 502 `provider_down`, which reads as "try again", and on a video `/complete` has already marked it answers `finished: false` or 502 instead of `true`. **API**
7. `POST /v1/jobs`'s retry finds the job by family and folder, not by cook, so another cook with the same `uploadId` would get its `jobId` and `recipeId`: match on the cook too. **API**
8. ~~`/v1/video-uploads` checks its own `Idempotency-Key` rule (8 to 200 characters, no `message`).~~ **Fixed in #FOLLOWUPS:** it reads the key with `idempotency.ts`'s `idempotencyKey`, required: 8 to 128 characters, and the same 400 `invalid` with its message as every write. The app's key is a uuid (`app/src/lib/uploads.ts` `newKey` on `main`, 36 characters, or about 30 without `randomUUID`), so none it sends is refused now. The stored hash is the same as before, so a key from before the deploy still answers its upload.
9. On iPhone the in-app camera starts with `live:startRecording`, which 1.1 doesn't have: `record.tsx` needs its no-recording path there too, sending `title`, `forKidIds` and `language` on `POST /v1/jobs`. **App**
10. The plate photo (`live:setCover`) has no route, so a 1.1 recipe's cover comes from the video: say whether the plate photo should come back. **Caleb**
11. Deleting a recipe (the signer's `action: delete`) isn't built (JOBS-MIGRATION.md, "Deferred, for other reasons"). **API**
12. Supabase's `/cooking` routes have no owner on AWS: JOBS-MIGRATION.md hands library rows to Messages, and MESSAGES-MIGRATION.md leaves `/cooking` to its own area. Until one is built, `GET /v1/cooking` stays empty. **API**
13. The voice service still checks Convex sessions and runs no task on staging; 1.1 calls none of it while `HOMIE_ON = false`, so turning homie on needs it moved first. **Caleb**
14. Production 1.1 needs recipe writes open: `RECIPE_WRITES=on` (since the recipe-writes PR, no `moved_at` needed), or there's no "processing" card and opt-in answers 501. **API**, in production's settings at launch, with Caleb's OK for production
15. 1.1 has no address for the public library: no route serves `library.json`, and staging's media bucket gets no copy of the real one (MEDIA-MIGRATION.md). **API**
16. LIVE-UPDATES.md and JOBS-MIGRATION.md disagree with the code in places (kids reading jobs, `jobs:forFamily`, the 5 GiB refusal, the 5-minute sweep, missing permissions and sessions): bring them up to date. **API**

// Upload links in place of cloud/signer, the sweep that stands in for a phone that never comes back, and the real S3 adapter's signing, with no network.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { handleMessage } from "../src/scheduled.js";
import { s3Store, VIDEO_LINK_S } from "../src/storage.js";
import { MAX_VIDEO_BYTES, MIN_PART_BYTES, ONE_PUT_BYTES, PART_BYTES, partSettings, RATE } from "../src/modules/jobs/uploads.js";
import { SWEEP, sweepUploads } from "../src/modules/jobs/tasks.js";
import { addJob, askLinks, call, clearLimits, db, family, freshDatabase, hasDatabase, job, jobMessages, land, newJob, openRecipeWrites, closeRecipeWrites, recipe, setUp, trace, who } from "./jobsHelpers.js";

const DAY_S = 86_400;
const age = (uploadId: string, seconds: number) =>
  db().query(`update files set created_at = created_at - make_interval(secs => $2), delete_requested_at = delete_requested_at - make_interval(secs => $2) where upload_id = $1`, [uploadId, seconds]);
const ageJob = (id: string, seconds: number) => db().query(`update jobs set created_at = created_at - make_interval(secs => $2) where id = $1`, [id, seconds]);

test("uploads", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const { app, videos, privateFiles } = setUp();
  const home = await family();
  const dad = await who(home);
  const others = await family();
  const sam = await who(others);
  const ask = (videos_: object[], key = `key-${Math.random().toString(36).slice(2)}aaaa`, by = dad) => call(app, by, "POST", "/v1/video-uploads", { videos: videos_ }, { "idempotency-key": key });
  const video = { contentType: "video/quicktime", size: 5 };

  await t.test("the signer's checks and sentences, before anything is written", async () => {
    const before = (await db().query(`select count(*)::int as n from files`)).rows[0].n;
    assert.equal((await ask([])).status, 400);
    assert.equal((await ask(Array(21).fill(video))).status, 400);
    assert.equal((await ask([{ contentType: "image/png", size: 5 }])).data.message, "Every file must be a video.");
    assert.equal((await ask([{ contentType: "video/mp4", size: 0 }])).status, 400);
    assert.equal((await ask([{ ...video, durationS: 25 * 3600 }])).data.message, "A video's length doesn't look right.");
    assert.equal((await ask([{ ...video, durationS: 3 * 3600 }, { ...video, durationS: 3600 + 1 }])).data.message, "That's more than 4 hours of video. Please pick fewer videos.");
    const big = await ask([{ contentType: "video/mp4", size: MAX_VIDEO_BYTES + 1 }]);
    assert.equal(big.status, 413);
    assert.equal(big.data.error, "too_large");
    assert.equal((await ask([{ contentType: "video/mp4", size: MAX_VIDEO_BYTES }])).status, 201, "the signer's limit is allowed");
    assert.equal((await db().query(`select count(*)::int as n from files`)).rows[0].n, before + 1);
    const noKey = await call(app, dad, "POST", "/v1/video-uploads", { videos: [video] });
    assert.equal(noKey.status, 400, "a write a phone retries needs its key");
  });

  await t.test("a link per video, its ledger row, and a key that holds nothing she typed", async () => {
    const res = await ask([video, { contentType: "video/mp4", size: 7 }, { contentType: "video/x-m4v", size: 9 }, { contentType: "video/webm", size: 11 }]);
    assert.equal(res.status, 201);
    assert.match(res.data.uploadId, /^[0-9a-f-]{36}$/);
    assert.equal(res.data.uploadPath, `${res.data.uploadId}/`);
    assert.deepEqual(res.data.uploads.map((u: { index: number }) => u.index), [1, 2, 3, 4]);
    assert.deepEqual(res.data.uploads[0].headers, { "Content-Type": "video/quicktime" });
    assert.equal(res.data.uploads[0].method, "PUT");
    const { rows } = await db().query(`select key, bucket, kind, content_type, size_bytes, family_id, owner_person_id, uploaded_at, attached_at from files where upload_id = $1 order by key`, [res.data.uploadId]);
    assert.deepEqual(rows.map((r) => r.key), [".mov", ".mp4", ".m4v", ".mov"].map((ext, i) => `${res.data.uploadId}/0${i + 1}${ext}`));
    for (const row of rows) {
      assert.equal(row.bucket, "uploads");
      assert.equal(row.kind, "video");
      assert.equal(row.family_id, home);
      assert.equal(row.owner_person_id, dad.personId);
      assert.equal(row.uploaded_at, null);
      assert.ok(!row.key.includes("://"), "a key, never a URL");
    }
  });

  await t.test("a retry with the same key gets the same upload, and a different body under it is refused", async () => {
    const key = "retrytry1";
    const first = await ask([video, video], key);
    const again = await ask([video, video], key);
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.data.uploadId, first.data.uploadId);
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1`, [first.data.uploadId])).rows[0].n, 2);
    assert.equal((await ask([video], key)).status, 409);
    assert.equal((await ask([video, video], key, sam)).data.uploadId === first.data.uploadId, false, "a key belongs to its person");
  });

  await t.test("two at once with one key make one upload", async () => {
    const replies = await Promise.all([1, 2, 3, 4].map(() => ask([video], "racing-key-123456")));
    assert.equal(new Set(replies.map((r) => r.data.uploadId)).size, 1);
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 200, 200, 201]);
  });

  await t.test("new links for what isn't in yet; everyone else reads the same not-found", async () => {
    const { uploadId, keys } = await askLinks(app, dad, 3);
    land(videos, keys[1]);
    await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    const links = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/links`);
    assert.equal(links.status, 200);
    assert.deepEqual(links.data.uploads.map((u: { index: number }) => u.index), [1, 3]);
    const aunt = await who(home);
    const refusals = [
      await call(app, sam, "POST", `/v1/video-uploads/${uploadId}/links`),
      await call(app, aunt, "POST", `/v1/video-uploads/${uploadId}/links`),
      await call(app, sam, "POST", `/v1/video-uploads/${uploadId}/complete`),
      await call(app, aunt, "POST", `/v1/video-uploads/${uploadId}/complete`),
      await call(app, dad, "POST", `/v1/video-uploads/no-such-upload/links`),
      await call(app, dad, "POST", `/v1/video-uploads/no-such-upload/complete`),
    ];
    for (const res of refusals) {
      assert.equal(res.status, 404);
      assert.equal(res.data.error, "not_found");
    }
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and uploaded_at is not null`, [uploadId])).rows[0].n, 1, "nobody else's call marked anything");
  });

  await t.test("a file counts only when S3 has all of it, and S3's own time is kept", async () => {
    const { uploadId, keys } = await askLinks(app, dad, 2);
    videos.objects.set(keys[0], { bytes: new Uint8Array(3), contentType: "video/quicktime" }); // short: can't arrive on a signed link, and doesn't count if it does
    land(videos, keys[1]);
    assert.deepEqual((await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`)).data.missing, [1]);
    const at = new Date("2026-10-31T12:05:00Z");
    const realHead = videos.head;
    videos.head = async (key) => {
      const out = await realHead(key);
      return out && { ...out, modified: at };
    };
    land(videos, keys[0]);
    const { data } = await newJob(app, dad, uploadId);
    await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    videos.head = realHead;
    const row = await job(data.jobId);
    assert.equal(row.stage, "queued");
    // Newest of the file S3 just answered for (12:05) and the one before it, which took now(): the later, as the worker's own `max(modified)` would.
    assert.ok(row.upload_finished_at.getTime() >= at.getTime());
  });

  await t.test("S3 down: one clear answer, and nothing changes", async () => {
    const { uploadId, keys } = await askLinks(app, dad);
    land(videos, ...keys);
    videos.failHeads = true;
    const res = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    videos.failHeads = false;
    assert.equal(res.status, 502);
    assert.equal(res.data.error, "provider_down");
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and uploaded_at is not null`, [uploadId])).rows[0].n, 0);
  });

  await t.test("a person's limit on asking for links, with no effect on anyone else", async () => {
    await clearLimits();
    const busy = await who(home);
    let last = 0;
    for (let i = 0; i < RATE.uploads.max + 1; i += 1) last = (await ask([video], undefined, busy)).status;
    assert.equal(last, 429);
    const blocked = await ask([video], undefined, busy);
    assert.ok(blocked.headers["retry-after"]);
    assert.equal((await ask([video], undefined, sam)).status, 201);
    await clearLimits();
  });

  await t.test("the sweep: a phone that never said it finished still gets its recipe made", async () => {
    const { uploadId, keys } = await askLinks(app, dad);
    const { data } = await newJob(app, dad, uploadId);
    await sweepUploads(trace);
    assert.equal((await job(data.jobId)).stage, "uploading", "nothing is there yet");
    const moved = (await job(data.jobId)).updated_at.getTime();
    land(videos, ...keys);
    await handleMessage(JSON.stringify({ payload: { task: "jobs.sweep" } }), trace.log);
    const row = await job(data.jobId);
    assert.equal(row.stage, "queued");
    assert.ok(row.updated_at.getTime() >= moved);
    assert.equal((await jobMessages(data.jobId)).length, 1);
    await sweepUploads(trace);
    assert.equal((await jobMessages(data.jobId)).length, 1, "a repeat sends nothing");
  });

  await t.test("the sweep doesn't make a job look as if it moved, so a phone isn't held at the fast poll", async () => {
    const { uploadId } = await askLinks(app, dad);
    const { data } = await newJob(app, dad, uploadId);
    const before = (await job(data.jobId)).updated_at.getTime();
    await sweepUploads(trace);
    assert.equal((await job(data.jobId)).updated_at.getTime(), before);
  });

  await t.test("an upload that never comes fails visibly after 7 days, with the worker's words", async () => {
    await openRecipeWrites();
    const { uploadId } = await askLinks(app, dad);
    const { data } = await newJob(app, dad, uploadId);
    await ageJob(data.jobId, 6 * DAY_S);
    await sweepUploads(trace);
    assert.equal((await job(data.jobId)).stage, "uploading");
    await ageJob(data.jobId, 2 * DAY_S);
    await sweepUploads(trace);
    const row = await job(data.jobId);
    assert.equal(row.stage, "failed");
    assert.equal(row.error, "We couldn't find the video for this recipe. Please try adding it again.");
    assert.ok(row.finished_at);
    assert.equal(row.cancelled_at, null);
    assert.equal((await recipe(data.recipeId)).status, "failed");
    assert.deepEqual(await jobMessages(data.jobId), []);
    await closeRecipeWrites();
  });

  await t.test("an upload nothing landed in goes after 7 days, and one a job holds stays", async () => {
    const orphan = await askLinks(app, dad);
    const held = await askLinks(app, dad);
    await newJob(app, dad, held.uploadId);
    land(videos, ...held.keys);
    await age(orphan.uploadId, 8 * DAY_S);
    await age(held.uploadId, 8 * DAY_S);
    await sweepUploads(trace);
    const { rows } = await db().query(`select upload_id, count(*) filter (where delete_requested_at is not null)::int as marked from files where upload_id = any($1) group by 1`, [[orphan.uploadId, held.uploadId]]);
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.upload_id, r.marked])), { [orphan.uploadId]: 2, [held.uploadId]: 0 });
    await db().query(`update files set delete_requested_at = delete_requested_at - make_interval(secs => $2) where upload_id = $1`, [orphan.uploadId, VIDEO_LINK_S + 3700]);
    await sweepUploads(trace);
    assert.ok(videos.objects.has(held.keys[0]));
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and deleted_at is not null`, [orphan.uploadId])).rows[0].n, 2);
  });

  await t.test("landed footage is never swept away: not reported, part of a folder, or a month old, and someone is told", async () => {
    await db().query(`delete from files where upload_id is not null`);
    // The phone died before saying so: only S3 knows.
    const unreported = await askLinks(app, dad);
    land(videos, ...unreported.keys);
    // One of two arrived.
    const partly = await askLinks(app, dad);
    land(videos, partly.keys[0]);
    await age(unreported.uploadId, 30 * DAY_S);
    await age(partly.uploadId, 30 * DAY_S);
    const told: { count: number; message: string }[] = [];
    const log = { ...trace.log, error: (fields: object, message: string) => void told.push({ count: (fields as { count: number }).count, message }) };
    for (let i = 0; i < 2; i += 1) await sweepUploads({ ...trace, log });
    const marked = await db().query(`select count(*)::int as n from files where upload_id = any($1) and delete_requested_at is not null`, [[unreported.uploadId, partly.uploadId]]);
    assert.equal(marked.rows[0].n, 0, "not one of hers is marked");
    for (const key of [...unreported.keys, partly.keys[0]]) assert.ok(videos.objects.has(key), key);
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and uploaded_at is not null`, [unreported.uploadId])).rows[0].n, 2, "S3 was asked, and it's written down");
    assert.ok(told.some((t) => t.message === "Landed videos are waiting on a person"), JSON.stringify(told));
    // With S3 unable to answer, nothing is marked either: it isn't "nothing landed".
    const unknown = await askLinks(app, dad);
    await age(unknown.uploadId, 30 * DAY_S);
    const realHead = videos.head;
    videos.head = async () => {
      throw new Error("S3 is down");
    };
    await assert.rejects(sweepUploads(trace), /failed/);
    videos.head = realHead;
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and delete_requested_at is not null`, [unknown.uploadId])).rows[0].n, 0);
    await db().query(`delete from files where upload_id = any($1)`, [[unreported.uploadId, partly.uploadId, unknown.uploadId]]);
  });

  await t.test("the overdue clock runs from the phone's last word, and failing a job keeps what landed", async () => {
    await openRecipeWrites();
    const { uploadId, keys } = await askLinks(app, dad);
    const { data } = await newJob(app, dad, uploadId);
    await ageJob(data.jobId, 8 * DAY_S);
    await age(uploadId, 8 * DAY_S);
    // A phone still at it on day 8 asks for a link, so the job isn't overdue.
    await clearLimits();
    assert.equal((await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/links`)).status, 200);
    await sweepUploads(trace);
    assert.equal((await job(data.jobId)).stage, "uploading");

    // A clip lands, then nothing more for 8 days: the job fails, and the clip stays.
    land(videos, keys[0]);
    await sweepUploads(trace);
    assert.equal((await job(data.jobId)).stage, "uploading", "it just landed");
    await db().query(`update files set last_link_at = last_link_at - interval '8 days', uploaded_at = uploaded_at - interval '8 days' where upload_id = $1`, [uploadId]);
    await sweepUploads(trace);
    assert.equal((await job(data.jobId)).stage, "failed");
    const rows = await db().query(`select key, delete_requested_at is not null as marked from files where upload_id = $1 order by key`, [uploadId]);
    assert.deepEqual(rows.rows.map((r) => r.marked), [false, true], "the landed clip stays; the one that never came expires");
    assert.ok(videos.objects.has(keys[0]));
    await closeRecipeWrites();
  });

  await t.test("a stop while the job is being made still stops it", async () => {
    const { uploadId } = await askLinks(app, dad);
    // What createJob holds until it commits: the files' locks, and a job nobody else can see yet.
    const making = await db().connect();
    let jobId: string;
    let stopped: boolean;
    try {
      await making.query("begin");
      await making.query(`select 1 from files where upload_id = $1 order by key for update`, [uploadId]);
      const { rows } = await making.query(
        `insert into jobs (family_id, cook_id, upload_key, source, stage, progress, idempotency_key) values ($1, $2, $3::text, 'phone', 'queued', 0, $3::text) returning id`,
        [dad.familyId, dad.personId, `${uploadId}/`],
      );
      jobId = rows[0].id;
      const stopping = call(app, dad, "POST", `/v1/video-uploads/${uploadId}/cancel`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await making.query("commit");
      stopped = (await stopping).data.stopped;
    } finally {
      await making.query("rollback").catch(() => {});
      making.release();
    }
    assert.equal(stopped, true);
    assert.ok((await job(jobId)).cancelled_at, "the job she stopped doesn't run");
  });

  await t.test("her own stop deletes the footage, as Convex mode does", async () => {
    const hers = await askLinks(app, dad);
    const own = await newJob(app, dad, hers.uploadId);
    await call(app, dad, "POST", `/v1/jobs/${own.data.jobId}/cancel`);
    assert.equal((await job(own.data.jobId)).keep_upload, false);
    assert.ok((await db().query(`select count(*)::int as n from files where upload_id = $1 and delete_requested_at is not null`, [hers.uploadId])).rows[0].n > 0);
  });

  await t.test("a job stuck queued is noticed, and an ended job's card is fixed once writes are open again", async () => {
    await openRecipeWrites();
    const { jobId, recipeId } = await addJob(dad, "queued");
    await db().query(`update jobs set updated_at = now() - interval '27 hours' where id = $1`, [jobId]);
    const told: string[] = [];
    const log = { ...trace.log, error: (_f: object, message: string) => void told.push(message) };
    await sweepUploads({ ...trace, log });
    assert.ok(told.includes("Jobs are stuck queued with no message"), JSON.stringify(told));
    assert.equal((await job(jobId)).stage, "queued", "a person decides: it could spend her money");

    const { recipeId: card } = await addJob(dad, "failed");
    await closeRecipeWrites();
    told.length = 0;
    await sweepUploads({ ...trace, log });
    assert.ok(told.includes("Ended jobs have cards still saying processing, and recipe writes are off"), JSON.stringify(told));
    assert.equal((await recipe(card!)).status, "processing");
    await openRecipeWrites();
    await sweepUploads(trace);
    assert.equal((await recipe(card!)).status, "failed");
    await db().query(`update jobs set stage = 'failed' where id = $1`, [jobId]);
    await db().query(`update recipes set status = 'failed' where id = $1`, [recipeId]);
    await closeRecipeWrites();
  });

  await t.test("a video too big for one PUT goes up in parts, and lands like any other", async () => {
    const size = ONE_PUT_BYTES + PART_BYTES + 5;
    const asked = await call(app, dad, "POST", "/v1/video-uploads", { videos: [{ contentType: "video/mp4", size }, { contentType: "video/mp4", size: 5 }] }, { "idempotency-key": `parts-${Date.now()}` });
    assert.equal(asked.status, 201);
    const { uploadId, uploads } = asked.data;
    const count = Math.ceil(size / PART_BYTES);
    assert.deepEqual(uploads[0], { index: 1, method: "PARTS", partBytes: PART_BYTES, partCount: count });
    assert.equal(uploads[1].method, "PUT", "the small one is a plain PUT");
    assert.ok(asked.data.expiresInS > 0);
    const parts = (body: object) => call(app, dad, "POST", `/v1/video-uploads/${uploadId}/parts`, body);
    const finish = (body: object) => call(app, dad, "POST", `/v1/video-uploads/${uploadId}/parts/finish`, body);

    // Only what this video needs.
    assert.equal((await parts({ index: 2, partNumbers: [1] })).status, 400, "the small one has no parts");
    assert.equal((await parts({ index: 3, partNumbers: [1] })).status, 400);
    assert.equal((await parts({ index: 1, partNumbers: [] })).status, 400);
    assert.equal((await parts({ index: 1, partNumbers: [count + 1] })).status, 400);
    assert.equal((await parts({ index: 1, partNumbers: Array.from({ length: 101 }, (_, i) => i + 1) })).status, 400);
    assert.equal((await finish({ index: 1, parts: [{ partNumber: 1, etag: "a" }] })).status, 400, "not started, and not every part");
    const started = videos.partsStarted.length;

    // The size of each part is signed: the last one is what's left.
    const first = (await parts({ index: 1, partNumbers: [1, count] })).data;
    assert.equal(new URL(first.parts[0].url).searchParams.get("size"), String(PART_BYTES));
    assert.equal(new URL(first.parts[1].url).searchParams.get("size"), String(size - PART_BYTES * (count - 1)));
    assert.equal(videos.partsStarted.length, started + 1);
    await parts({ index: 1, partNumbers: [2] });
    assert.equal(videos.partsStarted.length, started + 1, "asking again uses the same upload");

    // Nobody else's.
    assert.equal((await call(app, sam, "POST", `/v1/video-uploads/${uploadId}/parts`, { index: 1, partNumbers: [1] })).status, 404);
    const other = await who(home);
    assert.equal((await call(app, other, "POST", `/v1/video-uploads/${uploadId}/parts/finish`, { index: 1, parts: [{ partNumber: 1, etag: "a" }] })).status, 404);

    // Every part, then it has landed, however the phone orders them. Asking again doesn't ask S3 again.
    const all = Array.from({ length: count }, (_, i) => ({ partNumber: count - i, etag: `e${count - i}` }));
    assert.equal((await finish({ index: 1, parts: all.slice(1) })).status, 400, "one missing");
    videos.landWhenFinished = size;
    assert.deepEqual((await finish({ index: 1, parts: all })).data, { finished: true });
    assert.deepEqual(videos.partsFinished.at(-1)!.parts.map((p) => p.partNumber), Array.from({ length: count }, (_, i) => i + 1), "S3 wants them in order");
    const finishes = videos.partsFinished.length;
    assert.deepEqual((await finish({ index: 1, parts: all })).data, { finished: true });
    assert.equal(videos.partsFinished.length, finishes);
    videos.landWhenFinished = undefined;

    land(videos, `${uploadId}/02.mp4`);
    const done = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    assert.equal(done.data.complete, true);
  });

  await t.test("staging's small parts: a 25 MiB video is 5 parts of 5 MiB, and every other limit still holds", async () => {
    const MiB = 1024 ** 2;
    process.env.JOBS_SINGLE_PUT_MAX_BYTES = String(20 * MiB);
    process.env.JOBS_PART_BYTES = String(5 * MiB);
    try {
      await clearLimits();
      const asked = await ask([{ contentType: "video/mp4", size: 25 * MiB }, { contentType: "video/mp4", size: 20 * MiB }, { contentType: "video/mp4", size: 25 * MiB + 1 }]);
      assert.equal(asked.status, 201);
      const { uploadId, uploads } = asked.data;
      assert.deepEqual(uploads[0], { index: 1, method: "PARTS", partBytes: 5 * MiB, partCount: 5 });
      assert.equal(uploads[1].method, "PUT", "at the threshold it's still one PUT");
      assert.deepEqual(uploads[2], { index: 3, method: "PARTS", partBytes: 5 * MiB, partCount: 6 });

      const parts = (body: object) => call(app, dad, "POST", `/v1/video-uploads/${uploadId}/parts`, body);
      const signed = (await parts({ index: 1, partNumbers: [1, 2, 3, 4, 5] })).data.parts.map((p: { url: string }) => Number(new URL(p.url).searchParams.get("size")));
      assert.deepEqual(signed, [5, 5, 5, 5, 5].map((n) => n * MiB));
      assert.deepEqual((await parts({ index: 3, partNumbers: [6] })).data.parts.map((p: { url: string }) => new URL(p.url).searchParams.get("size")), ["1"], "the last is what's left");
      assert.equal((await parts({ index: 1, partNumbers: [6] })).status, 400, "the parts count is the video's own");
      assert.equal((await parts({ index: 2, partNumbers: [1] })).status, 400, "a PUT video has no parts");
      videos.landWhenFinished = 25 * MiB;
      const all = [1, 2, 3, 4, 5].map((n) => ({ partNumber: n, etag: `e${n}` }));
      assert.equal((await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/parts/finish`, { index: 1, parts: all.slice(1) })).status, 400, "not every part");
      assert.deepEqual((await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/parts/finish`, { index: 1, parts: all })).data, { finished: true });
      videos.landWhenFinished = undefined;

      // The 20 GiB cap is the same, and so is 120 links an hour, however small the parts.
      assert.equal((await ask([{ contentType: "video/mp4", size: MAX_VIDEO_BYTES + 1 }])).status, 413);
      const capped = await ask([{ contentType: "video/mp4", size: MAX_VIDEO_BYTES }]);
      assert.deepEqual(capped.data.uploads[0], { index: 1, method: "PARTS", partBytes: 5 * MiB, partCount: 4096 });
      await clearLimits();
      const links = () => call(app, dad, "POST", `/v1/video-uploads/${capped.data.uploadId}/parts`, { index: 1, partNumbers: [4096] });
      for (let i = 0; i < RATE.links.max; i += 1) assert.equal((await links()).status, 200, `call ${i + 1}`);
      assert.equal((await links()).status, 429);
    } finally {
      delete process.env.JOBS_SINGLE_PUT_MAX_BYTES;
      delete process.env.JOBS_PART_BYTES;
      videos.landWhenFinished = undefined;
      await clearLimits();
    }
    const after = await ask([{ contentType: "video/mp4", size: 25 * MiB }]);
    assert.equal(after.data.uploads[0].method, "PUT", "unset again: production's 5 GiB");
  });

  await t.test("a video that joined up at the wrong size hasn't landed", async () => {
    const size = ONE_PUT_BYTES + 1;
    const { data } = await call(app, dad, "POST", "/v1/video-uploads", { videos: [{ contentType: "video/mp4", size }] }, { "idempotency-key": `wrong-${Date.now()}` });
    await call(app, dad, "POST", `/v1/video-uploads/${data.uploadId}/parts`, { index: 1, partNumbers: [1] });
    videos.landWhenFinished = size - 1;
    const count = Math.ceil(size / PART_BYTES);
    const all = Array.from({ length: count }, (_, i) => ({ partNumber: i + 1, etag: "e" }));
    assert.deepEqual((await call(app, dad, "POST", `/v1/video-uploads/${data.uploadId}/parts/finish`, { index: 1, parts: all })).data, { finished: false });
    videos.landWhenFinished = undefined;
    assert.equal((await call(app, dad, "POST", `/v1/video-uploads/${data.uploadId}/complete`)).data.complete, false);
  });

  await t.test("a stopped job's files leave S3 once the links are out of time, even one that landed after the stop", async () => {
    const { uploadId, keys } = await askLinks(app, dad);
    const { data } = await newJob(app, dad, uploadId);
    await call(app, dad, "POST", `/v1/jobs/${data.jobId}/cancel`);
    land(videos, ...keys); // a PUT that was already running
    await sweepUploads(trace);
    assert.ok(videos.objects.has(keys[0]));
    await db().query(`update files set delete_requested_at = delete_requested_at - make_interval(secs => $2) where upload_id = $1`, [uploadId, VIDEO_LINK_S + 3700]);
    await sweepUploads(trace);
    assert.ok(!videos.objects.has(keys[0]) && !videos.objects.has(keys[1]));
  });

  await t.test("the sweep reaches both buckets, each by its own store, and leaves the dish sweep's files alone", async () => {
    const mark = `now() - interval '1 day'`;
    await db().query(
      `insert into files (key, bucket, kind, family_id, owner_person_id, delete_requested_at) values ('private/plate-1', 'private', 'cover', $1, $2, ${mark})`,
      [home, dad.personId],
    );
    await db().query(
      `insert into files (key, bucket, kind, capability_hash, delete_requested_at) values ('private/dish/anon', 'private', 'photo', '${"a".repeat(64)}', ${mark})`,
    );
    privateFiles.objects.set("private/plate-1", { bytes: new Uint8Array(1), contentType: "image/jpeg" });
    privateFiles.objects.set("private/dish/anon", { bytes: new Uint8Array(1), contentType: "image/jpeg" });
    await sweepUploads(trace);
    assert.ok(!privateFiles.objects.has("private/plate-1"));
    assert.ok(privateFiles.objects.has("private/dish/anon"), "dish.sweep's");
  });

  await t.test("a failed S3 delete stays marked and fails the message, so someone hears", async () => {
    const { uploadId, keys } = await askLinks(app, dad);
    land(videos, ...keys);
    await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/cancel`);
    await db().query(`update files set delete_requested_at = delete_requested_at - make_interval(secs => $2) where upload_id = $1`, [uploadId, VIDEO_LINK_S + 3700]);
    videos.failRemoves = true;
    await assert.rejects(sweepUploads(trace), /S3 calls failed/);
    videos.failRemoves = false;
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and deleted_at is null and delete_requested_at is not null`, [uploadId])).rows[0].n, 2);
    await sweepUploads(trace);
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and deleted_at is not null`, [uploadId])).rows[0].n, 2);
  });

  await t.test("a full batch carries on from where it stopped, on its own message", async () => {
    await db().query(`delete from outbox`);
    const lone = await who(await family());
    const made: string[] = [];
    await db().query(`delete from jobs where stage = 'uploading'`);
    for (let i = 0; i < SWEEP.batch; i += 1) made.push((await addJob(lone, "uploading", `batch-${i}`, false)).jobId);
    const last = (await addJob(lone, "uploading", "batch-last", false)).jobId;
    await sweepUploads(trace);
    const { rows } = await db().query(`select payload from outbox where queue = 'scheduled'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.task, "jobs.sweep");
    assert.equal(rows[0].payload.afterId, made.at(-1));
    // The next message picks up the one job left, and has nothing to carry on with.
    await db().query(`delete from outbox`);
    await handleMessage(JSON.stringify({ payload: rows[0].payload }), trace.log);
    assert.equal((await db().query(`select count(*)::int as n from outbox where queue = 'scheduled'`)).rows[0].n, 0);
    assert.equal((await job(last)).stage, "uploading");
  });

  await t.test("each main query can use the index data.ts names for it", async () => {
    const plans: [string, string, unknown[], string[]][] = [
      ["a family's jobs", `select id from jobs where family_id = $1 order by created_at desc, id desc limit 20`, [home], ["jobs_family_recent"]],
      ["a phone's retry", `select id from jobs where family_id = $1 and idempotency_key = $2`, [home, "x/"], ["jobs_idempotency_unique"]],
      ["another family's folder", `select family_id from jobs where upload_key = $1 order by created_at desc limit 20`, ["x/"], ["jobs_upload_key"]],
      ["stop by folder", `select id from jobs where family_id = $1 and upload_id = $2 order by created_at desc limit 20`, [home, "x"], ["jobs_family_upload", "jobs_family_recent"]],
      ["waiting on an upload", `select id from jobs where stage = 'uploading' order by created_at, id limit 50`, [], ["jobs_unfinished"]],
      ["a person's jobs", `select id from jobs where cook_id = $1 limit 500`, [home], ["jobs_cook"]],
      ["an upload's files", `select key from files where upload_id = $1 order by key`, ["x"], ["files_upload"]],
      ["a person's files", `select key from files where owner_person_id = $1 and delete_requested_at is null and deleted_at is null limit 500`, [home], ["files_owner"]],
      ["orphans", `select key from files where upload_id is not null and attached_at is null and delete_requested_at is null and deleted_at is null and created_at < now() order by created_at limit 50`, [], ["files_orphans", "files_upload"]],
      ["to delete", `select key from files where bucket in ('uploads', 'private') and capability_hash is null and delete_requested_at is not null and deleted_at is null order by delete_requested_at limit 50`, [], ["files_to_delete"]],
      ["a family's recipes", `select id from recipes where family_id = $1 order by created_at desc, id desc limit 101`, [home], ["recipes_family_recent"]],
      ["a cook's recipes", `select id from recipes where cook_id = $1 order by created_at desc limit 500`, [home], ["recipes_cook"]],
      ["her glasses videos", `select id from recordings where family_id = $1 order by created_at desc limit 50`, [home], ["recordings_family_recent"]],
      ["a person's recordings", `select id from recordings where cook_id = $1 limit 500`, [home], ["recordings_cook_started"]],
      ["what the glasses saw", `select id from live_events where recording_id = $1 order by session_started_at, at_s limit 2000`, ["x"], ["live_events_recording"]],
      ["windows", `select count(*) from live_windows where recording_id = $1`, ["x"], ["live_windows_recording"]],
      ["who's cooking", `select id from cooking_sessions where family_id = $1 and ended_at is null order by updated_at desc limit 50`, [home], ["cooking_sessions_family_recent", "cooking_sessions_idle"]], // on an empty table the planner likes the partial index of open rows, which is small either way
      ["a kid's cooking rows", `select id from cooking_sessions where kid_id = $1 limit 500`, [home], ["cooking_sessions_kid_recent", "cooking_sessions_one_open"]],
      ["a cook's cooking rows", `select id from cooking_sessions where cook_id = $1 limit 500`, [home], ["cooking_sessions_cook_open"]],
    ];
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      for (const [name, sql, args, indexes] of plans) {
        const { rows } = await client.query(`explain ${sql}`, args);
        const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
        assert.ok(indexes.some((index) => plan.includes(index)), `${name}:\n${plan}`);
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  await app.close();
});

test("the parts settings: today's sizes when unset, staging's when set, and never past S3's limits", () => {
  const MiB = 1024 ** 2;
  assert.deepEqual(partSettings({}), { onePutBytes: 5 * 1024 ** 3, partBytes: 64 * MiB });
  assert.deepEqual(partSettings({}), { onePutBytes: ONE_PUT_BYTES, partBytes: PART_BYTES });
  assert.deepEqual(partSettings({ JOBS_SINGLE_PUT_MAX_BYTES: "20971520", JOBS_PART_BYTES: "5242880" }), { onePutBytes: 20 * MiB, partBytes: 5 * MiB });
  for (const junk of ["", " ", "abc", "-1", "0", "1.5", "NaN", "Infinity"]) {
    assert.deepEqual(partSettings({ JOBS_SINGLE_PUT_MAX_BYTES: junk, JOBS_PART_BYTES: junk }), partSettings({}), JSON.stringify(junk));
  }
  assert.equal(partSettings({ JOBS_PART_BYTES: String(MiB) }).partBytes, MIN_PART_BYTES, "S3 refuses parts under 5 MiB but the last");
  assert.equal(partSettings({ JOBS_PART_BYTES: String(6 * 1024 ** 3) }).partBytes, ONE_PUT_BYTES, "or over 5 GiB");
  assert.equal(partSettings({ JOBS_SINGLE_PUT_MAX_BYTES: String(6 * 1024 ** 3) }).onePutBytes, ONE_PUT_BYTES, "one PUT can't take more than 5 GiB");
  assert.ok(Math.ceil(MAX_VIDEO_BYTES / MIN_PART_BYTES) <= 10_000, "the cap in the smallest parts is within S3's 10,000");
});

test("the real S3 adapter signs a part for its upload, number, size and 6 hours, with no network", async () => {
  const client = new S3Client({ region: "us-west-2", credentials: { accessKeyId: "AKIAFAKEFAKEFAKE", secretAccessKey: "fake" } });
  const store = s3Store({ bucket: "test-uploads", client, uploadLinkS: VIDEO_LINK_S });
  const link = await store.presignPart("abc/01.mov", "multipart-1", 7, 1234);
  const url = new URL(link.url);
  assert.equal(url.searchParams.get("uploadId"), "multipart-1");
  assert.equal(url.searchParams.get("partNumber"), "7");
  assert.equal(url.searchParams.get("X-Amz-Expires"), String(6 * 3600));
  assert.match(url.searchParams.get("X-Amz-SignedHeaders") ?? "", /content-length/);
  assert.equal(link.expiresInS, 6 * 3600);
});

test("the real S3 adapter signs a video's link for its type, size and 6 hours, with no network", async () => {
  const client = new S3Client({ region: "us-west-2", credentials: { accessKeyId: "AKIAFAKEFAKEFAKE", secretAccessKey: "fake" }, requestChecksumCalculation: "WHEN_REQUIRED" });
  const store = s3Store({ bucket: "test-uploads", client, uploadLinkS: VIDEO_LINK_S });
  const link = await store.presignPut("abc/01.mov", "video/quicktime", 1234);
  const url = new URL(link.url);
  assert.equal(link.expiresInS, 6 * 3600);
  assert.equal(url.searchParams.get("X-Amz-Expires"), String(6 * 3600));
  assert.match(url.searchParams.get("X-Amz-SignedHeaders") ?? "", /content-length/);
  assert.match(url.searchParams.get("X-Amz-SignedHeaders") ?? "", /content-type/);
  assert.equal(url.pathname.endsWith("/abc/01.mov"), true);
  assert.deepEqual(link.headers, { "Content-Type": "video/quicktime" });
});

after(async () => {
  if (hasDatabase) await db().end();
});

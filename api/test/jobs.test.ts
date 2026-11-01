// Creating, stopping and listing jobs: convex/cancel.test.ts, convex/signer.test.ts, and the job parts of convex/forKids.test.ts and language.test.ts. Titles stay Convex's where the meaning does.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { db, family, freshDatabase, hasDatabase } from "./jobsHelpers.js";
import { addJob, askLinks, call, closeRecipeWrites, jobMessages, job, land, lockRecipeCopy, newJob, openRecipeWrites, recipe, setUp, who, type Who } from "./jobsHelpers.js";

const UNFINISHED = ["uploading", "queued", "preparing", "understanding", "writing", "indexing"];

test("jobs", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const { app, videos } = setUp();
  const dadsFamily = await family();
  const dad = await who(dadsFamily);
  const leo = await who(dadsFamily, "kid");
  const zoe = await who(dadsFamily, "kid");
  const others = await family();
  const sam = await who(others);
  const samsKid = await who(others, "kid");
  const cancel = (by: Who, id: string) => call(app, by, "POST", `/v1/jobs/${id}/cancel`);
  const stop = (by: Who, uploadId: string) => call(app, by, "POST", `/v1/video-uploads/${encodeURIComponent(uploadId)}/cancel`);

  await t.test("jobs.cancel stops a job at every unfinished stage, and a worker mid-way can't bring it back", async () => {
    await openRecipeWrites();
    for (const stage of UNFINISHED) {
      const ids = await addJob(dad, stage);
      const res = await cancel(dad, ids.jobId);
      assert.deepEqual([res.status, res.data], [200, { stopped: true }], stage);
      const row = await job(ids.jobId);
      assert.equal(row.stage, "failed", stage);
      assert.equal(row.error, "Cancelled.", stage);
      assert.equal(row.progress, 0, stage);
      assert.ok(row.cancelled_at && row.finished_at, stage);
      assert.equal(row.claimed_at, null, stage);
      assert.equal((await recipe(ids.recipeId!)).status, "failed", stage);
      // Stopping it again is a no-op. A worker's half of this title: jobsWorker.test.ts, on its own code.
      assert.deepEqual((await cancel(dad, ids.jobId)).data, { stopped: false }, stage);
    }
    await closeRecipeWrites();
  });

  await t.test("a finished job can't be cancelled, nor can a kid or another family stop one", async () => {
    for (const stage of ["done", "failed"]) {
      const ids = await addJob(dad, stage);
      assert.deepEqual((await cancel(dad, ids.jobId)).data, { stopped: false });
      assert.equal((await job(ids.jobId)).stage, stage);
      assert.equal((await job(ids.jobId)).cancelled_at, null);
    }
    const queued = await addJob(dad, "queued", "up-queued");
    assert.equal((await cancel(leo, queued.jobId)).status, 403);
    assert.equal((await stop(leo, "up-queued")).status, 403);
    const wrong = await cancel(sam, queued.jobId);
    const missing = await cancel(sam, "no-such-job");
    assert.equal(wrong.status, 404);
    assert.deepEqual({ ...wrong.data, requestId: 0 }, { ...missing.data, requestId: 0 }, "another family's job reads as one that isn't there");
    assert.deepEqual((await stop(sam, "up-queued")).data, { stopped: false });
    assert.equal((await job(queued.jobId)).stage, "queued");
  });

  await t.test("jobs.cancelUpload stops the job made from a phone's upload folder, at every unfinished stage", async () => {
    for (const stage of UNFINISHED) {
      const ids = await addJob(dad, stage, `phone-${stage}`);
      assert.deepEqual((await stop(dad, `phone-${stage}`)).data, { stopped: true }, stage);
      const row = await job(ids.jobId);
      assert.equal(row.stage, "failed", stage);
      assert.equal(row.error, "Cancelled.", stage);
      assert.deepEqual((await stop(dad, `phone-${stage}`)).data, { stopped: false }, stage); // already stopped
    }
    // An upload with no job yet: nothing to stop, and no error.
    assert.deepEqual((await stop(dad, "not-made-yet")).data, { stopped: false });
    // Only that exact folder: a folder that starts the same isn't it.
    const other = await addJob(dad, "queued", "phone-queued-2");
    assert.deepEqual((await stop(dad, "phone-queued")).data, { stopped: false });
    assert.equal((await job(other.jobId)).stage, "queued");
    for (const bad of ["a/b", " "]) assert.deepEqual((await stop(dad, bad)).data, { stopped: false }, bad);
    assert.equal((await stop(dad, "x".repeat(101))).status, 414, "Fastify's own limit on a path's id, where Convex said false: it stops nothing either way");
  });

  await t.test("a stop with no job yet marks her files, so a late job is refused and the sweep takes them", async () => {
    const { uploadId, keys } = await askLinks(app, dad);
    land(videos, ...keys);
    assert.deepEqual((await stop(sam, uploadId)).data, { stopped: false }, "another family's stop changes nothing");
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and delete_requested_at is not null`, [uploadId])).rows[0].n, 0);
    assert.deepEqual((await stop(dad, uploadId)).data, { stopped: false });
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and delete_requested_at is not null`, [uploadId])).rows[0].n, 2);
    const late = await newJob(app, dad, uploadId);
    assert.equal(late.status, 400);
    assert.equal(late.data.message, "Upload the video before sending it.");
  });

  await t.test("a job can't use another family's upload folder (a worker would read, and on a stop delete, its videos)", async () => {
    await addJob(dad, "queued", "dad-poha-ab12cd");
    const copied = await newJob(app, sam, "dad-poha-ab12cd");
    const { uploadId } = await askLinks(app, dad);
    const ledger = await newJob(app, sam, uploadId);
    const nothing = await newJob(app, sam, "never-asked-for");
    for (const res of [copied, ledger, nothing]) {
      assert.equal(res.status, 400);
      assert.equal(res.data.message, "Upload the video before sending it.");
    }
    assert.deepEqual({ ...ledger.data, requestId: 0 }, { ...nothing.data, requestId: 0 }, "her folder and no folder read the same");
    for (const bad of ["../up", "a/b", "UPPER", "x".repeat(101)]) assert.equal((await newJob(app, dad, bad)).status, 400, bad);
  });

  await t.test("another cook in the family can't take her upload, and a kid can't make a job", async () => {
    const aunt = await who(dadsFamily);
    const { uploadId } = await askLinks(app, dad);
    const res = await newJob(app, aunt, uploadId);
    assert.equal(res.status, 400);
    assert.equal((await newJob(app, leo, uploadId)).status, 403);
    const refused = await call(app, leo, "POST", "/v1/video-uploads", { videos: [{ contentType: "video/mp4", size: 5 }] }, { "idempotency-key": "kid-key-123456" });
    assert.equal(refused.status, 403);
  });

  await t.test("jobs.create is idempotent per upload folder: the phone's retries never make a second recipe", async () => {
    await openRecipeWrites();
    const { uploadId } = await askLinks(app, dad);
    const count = async () => (await db().query(`select count(*)::int as n from jobs where upload_key = $1`, [`${uploadId}/`])).rows[0].n;
    const recipes = async () => (await db().query(`select count(*)::int as n from recipes where family_id = $1`, [dadsFamily])).rows[0].n;
    const before = await recipes();
    const first = await newJob(app, dad, uploadId, { title: "Poha" });
    assert.equal(first.status, 201);
    const again = await newJob(app, dad, uploadId, { title: "Poha" });
    assert.equal(again.status, 200);
    assert.deepEqual(again.data, first.data);
    assert.equal(await count(), 1);
    assert.equal(await recipes(), before + 1);
    // Stopped meanwhile: a late retry gets the stopped job back, it doesn't start the recipe again.
    await cancel(dad, first.data.jobId);
    assert.deepEqual((await newJob(app, dad, uploadId)).data, first.data);
    assert.equal((await job(first.data.jobId)).error, "Cancelled.");
    assert.equal(await count(), 1);
    assert.equal(await recipes(), before + 1);
    // Another folder is another recipe.
    const other = await newJob(app, dad, (await askLinks(app, dad)).uploadId);
    assert.notEqual(other.data.jobId, first.data.jobId);
    await closeRecipeWrites();
  });

  await t.test("two retries at once make one job, one card and one message", async () => {
    await openRecipeWrites();
    for (let i = 0; i < 5; i += 1) {
      const { uploadId, keys } = await askLinks(app, dad);
      land(videos, ...keys);
      await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
      const replies = await Promise.all([newJob(app, dad, uploadId), newJob(app, dad, uploadId), newJob(app, dad, uploadId)]);
      assert.deepEqual(replies.map((r) => r.status).sort(), [200, 200, 201]);
      assert.equal(new Set(replies.map((r) => r.data.jobId)).size, 1);
      assert.equal(new Set(replies.map((r) => r.data.recipeId)).size, 1);
      assert.equal((await jobMessages(replies[0].data.jobId)).length, 1);
    }
    await closeRecipeWrites();
  });

  await t.test("queued and its message commit together, only once the upload is complete", async () => {
    const { uploadId, keys } = await askLinks(app, dad, 2);
    const { data: made } = await newJob(app, dad, uploadId);
    let row = await job(made.jobId);
    assert.equal(row.stage, "uploading");
    assert.equal(row.upload_key, `${uploadId}/`, "a key, never a URL");
    assert.equal(row.upload_finished_at, null);
    assert.deepEqual(await jobMessages(made.jobId), []);

    land(videos, keys[0]);
    const part = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    assert.deepEqual(part.data, { complete: false, missing: [2], cancelled: false, job: { jobId: made.jobId, stage: "uploading" } });
    assert.equal((await job(made.jobId)).stage, "uploading");
    assert.deepEqual(await jobMessages(made.jobId), []);

    // A failure half way undoes all of it: no stage without its message, no file marked in without the stage.
    land(videos, keys[1]);
    await db().query(`alter table outbox add constraint test_no_jobs check (queue <> 'jobs') not valid`);
    const failed = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    await db().query(`alter table outbox drop constraint test_no_jobs`);
    assert.equal(failed.status, 500);
    assert.equal((await job(made.jobId)).stage, "uploading");
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and uploaded_at is not null`, [uploadId])).rows[0].n, 1);

    const whole = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`, undefined, { "x-request-id": "trace-this-request" });
    assert.deepEqual(whole.data, { complete: true, missing: [], cancelled: false, job: { jobId: made.jobId, stage: "queued" } });
    row = await job(made.jobId);
    assert.equal(row.stage, "queued");
    assert.ok(row.upload_finished_at, "the 30-minute target starts here");
    assert.deepEqual(await jobMessages(made.jobId), [{ queue: "jobs", payload: { jobId: made.jobId } }]);
    assert.equal((await db().query(`select request_id from outbox where payload->>'jobId' = $1`, [made.jobId])).rows[0].request_id, "trace-this-request");

    // A repeat changes nothing and sends nothing.
    const started = row.upload_finished_at.getTime();
    const repeat = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    assert.deepEqual(repeat.data.job, { jobId: made.jobId, stage: "queued" });
    assert.equal((await jobMessages(made.jobId)).length, 1);
    assert.equal((await job(made.jobId)).upload_finished_at.getTime(), started);
  });

  await t.test("the upload finishing first: the job is queued as it's made", async () => {
    const { uploadId, keys } = await askLinks(app, dad);
    land(videos, ...keys);
    const done = await call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    assert.deepEqual(done.data, { complete: true, missing: [], cancelled: false, job: null });
    const { data } = await newJob(app, dad, uploadId);
    assert.equal((await job(data.jobId)).stage, "queued");
    assert.equal((await jobMessages(data.jobId)).length, 1);
  });

  await t.test("a job and the upload's end arriving together can't each miss the other", async () => {
    for (let i = 0; i < 8; i += 1) {
      const { uploadId, keys } = await askLinks(app, dad);
      land(videos, ...keys);
      const [made] = await Promise.all([newJob(app, dad, uploadId), call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`)]);
      assert.equal((await job(made.data.jobId)).stage, "queued", `try ${i}`);
      assert.equal((await jobMessages(made.data.jobId)).length, 1, `try ${i}`);
    }
  });

  await t.test("a stop and the upload's end arriving together: stopped stays stopped", async () => {
    for (let i = 0; i < 8; i += 1) {
      const { uploadId, keys } = await askLinks(app, dad);
      const { data } = await newJob(app, dad, uploadId);
      land(videos, ...keys);
      await Promise.all([cancel(dad, data.jobId), call(app, dad, "POST", `/v1/video-uploads/${uploadId}/complete`)]);
      const row = await job(data.jobId);
      assert.equal(row.stage, "failed", `try ${i}`);
      assert.ok(row.cancelled_at, `try ${i}`);
    }
  });

  await t.test("a stop while uploading sends the worker a message, because that's what deletes the files", async () => {
    const { uploadId } = await askLinks(app, dad);
    const { data } = await newJob(app, dad, uploadId);
    assert.deepEqual(await jobMessages(data.jobId), []);
    await cancel(dad, data.jobId);
    assert.equal((await jobMessages(data.jobId)).length, 1);
    await cancel(dad, data.jobId);
    assert.equal((await jobMessages(data.jobId)).length, 1, "a second stop sends nothing");
    assert.equal((await db().query(`select count(*)::int as n from files where upload_id = $1 and delete_requested_at is not null`, [uploadId])).rows[0].n, 2);
  });

  await t.test("a job takes the kids from Send, else from homie's recording", async () => {
    const recording = (await db().query(
      `insert into recordings (family_id, cook_id, for_kid_ids, dish, language, source, status) values ($1, $2, $3, '  Masale Bhaat ', 'mr', 'phone', 'ended') returning id`,
      [dadsFamily, dad.personId, [leo.personId, zoe.personId]],
    )).rows[0].id;
    const make = async (extra: object) => (await newJob(app, dad, (await askLinks(app, dad)).uploadId, extra));

    assert.equal((await make({ forKidIds: [leo.personId, dad.personId] })).data.message, "That person isn't in your family.");
    assert.equal((await make({ forKidIds: [samsKid.personId] })).data.message, "That person isn't in your family.");
    assert.equal((await make({ forKidIds: Array.from({ length: 21 }, (_, i) => `k${i}`) })).status, 400);

    const fromRecording = await make({ recordingId: recording });
    let row = await job(fromRecording.data.jobId);
    assert.deepEqual(row.for_kid_ids, [leo.personId, zoe.personId]);
    assert.equal(row.title, "Masale Bhaat");
    assert.equal(row.language, "mr");
    assert.equal(row.recording_id, recording);
    assert.equal((await db().query(`select job_id from recordings where id = $1`, [recording])).rows[0].job_id, fromRecording.data.jobId);

    // Send's pick beats the recording's, and the older single field still works, without repeats.
    row = await job((await make({ recordingId: recording, forKidIds: [zoe.personId, zoe.personId] })).data.jobId);
    assert.deepEqual(row.for_kid_ids, [zoe.personId]);
    row = await job((await make({ forKidId: leo.personId })).data.jobId);
    assert.deepEqual(row.for_kid_ids, [leo.personId]);
    row = await job((await make({})).data.jobId);
    assert.deepEqual(row.for_kid_ids, []);
  });

  await t.test("a recording attaches only for its own cook, and a language must be a code", async () => {
    const hers = (await db().query(
      `insert into recordings (family_id, cook_id, language, source, status) values ($1, $2, 'en', 'phone', 'ended') returning id`,
      [dadsFamily, dad.personId],
    )).rows[0].id;
    const aunt = await who(dadsFamily);
    const answers = [
      await newJob(app, sam, (await askLinks(app, sam)).uploadId, { recordingId: hers }),
      await newJob(app, aunt, (await askLinks(app, aunt)).uploadId, { recordingId: hers }),
      await newJob(app, dad, (await askLinks(app, dad)).uploadId, { recordingId: "no-such-recording" }),
    ];
    for (const res of answers) {
      assert.equal(res.status, 404);
      assert.equal(res.data.message, "That recording isn't yours.");
    }
    assert.equal((await newJob(app, dad, (await askLinks(app, dad)).uploadId, { language: "Marathi" })).data.message, "Pick a language from the list.");
    const { data } = await newJob(app, dad, (await askLinks(app, dad)).uploadId, { language: "MR" });
    assert.equal((await job(data.jobId)).language, "mr");
    // Unset falls back to the cook's own, then English.
    await db().query(`update people set language = 'hi' where id = $1`, [dad.personId]);
    assert.equal((await job((await newJob(app, dad, (await askLinks(app, dad)).uploadId)).data.jobId)).language, "hi");
    await db().query(`update people set language = null where id = $1`, [dad.personId]);
    assert.equal((await job((await newJob(app, dad, (await askLinks(app, dad)).uploadId)).data.jobId)).language, "en");
  });

  await t.test("the list: newest first, 20 at a time, in the shape the app reads, and only her family's", async () => {
    const lone = await family();
    const cook = await who(lone);
    const kid = await who(lone, "kid");
    const made: string[] = [];
    for (let i = 0; i < 23; i += 1) made.push((await addJob(cook, "queued", `list-${i}`, false)).jobId);
    const first = await call(app, kid, "GET", "/v1/jobs");
    assert.equal(first.status, 200);
    assert.equal(first.data.jobs.length, 20);
    const second = await call(app, cook, "GET", `/v1/jobs?cursor=${first.data.nextCursor}`);
    assert.equal(second.data.jobs.length, 3);
    assert.equal(second.data.nextCursor, null);
    const seen = [...first.data.jobs, ...second.data.jobs].map((j: { _id: string }) => j._id);
    assert.deepEqual([...seen].sort(), [...made].sort(), "no row skipped or repeated");
    assert.equal(new Set(seen).size, 23);
    const one = first.data.jobs[0];
    for (const field of ["_id", "_creationTime", "uploadPath", "source", "stage", "progress"]) assert.ok(field in one, field);
    assert.equal(typeof one._creationTime, "number");
    assert.ok(!("recipeId" in one), "unset fields stay unset");
    assert.deepEqual((await call(app, sam, "GET", "/v1/jobs")).data.jobs.filter((j: { _id: string }) => made.includes(j._id)), []);
    assert.equal((await call(app, cook, "GET", "/v1/jobs?cursor=not-a-cursor")).status, 400);
    // A forged cursor that decodes but names no real moment is ours to refuse, not Postgres's error.
    const forged = Buffer.from(JSON.stringify(["2026-13-45 99:00:00+00", "x"])).toString("base64url");
    assert.equal((await call(app, cook, "GET", `/v1/jobs?cursor=${forged}`)).status, 400);
    assert.equal((await call(app, cook, "GET", "/v1/jobs/a%00b")).status, 400);
    assert.equal((await newJob(app, cook, "a\0b")).status, 400);
  });

  await t.test("one job's progress, for its family only", async () => {
    const ids = await addJob(dad, "writing");
    const mine = await call(app, leo, "GET", `/v1/jobs/${ids.jobId}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.data.stage, "writing");
    assert.equal(mine.data.progress, 0.3);
    assert.equal((await call(app, sam, "GET", `/v1/jobs/${ids.jobId}`)).status, 404);
  });

  await t.test("a job can't be made while the sync still owns recipes, and a retry still gets its job", async () => {
    const { uploadId } = await askLinks(app, dad);
    const made = await newJob(app, dad, uploadId);
    await lockRecipeCopy();
    const fresh = await newJob(app, dad, (await askLinks(app, dad)).uploadId);
    assert.equal(fresh.status, 501);
    assert.equal(fresh.data.error, "not_moved");
    assert.deepEqual((await newJob(app, dad, uploadId)).data, made.data);
    await closeRecipeWrites();
  });

  await t.test("every route refuses without a session", async () => {
    const routes: ["GET" | "POST", string][] = [
      ["POST", "/v1/video-uploads"],
      ["POST", "/v1/video-uploads/x/links"],
      ["POST", "/v1/video-uploads/x/complete"],
      ["POST", "/v1/video-uploads/x/cancel"],
      ["POST", "/v1/jobs"],
      ["GET", "/v1/jobs"],
      ["GET", "/v1/jobs/x"],
      ["POST", "/v1/jobs/x/cancel"],
    ];
    for (const [method, url] of routes) assert.equal((await call(app, null, method, url)).status, 401, url);
  });

  await t.test("logs carry no family content, on success and on failure", async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, done) { lines.push(chunk.toString()); done(); } });
    const logged = buildApp({ logger: { stream } });
    const { uploadId, keys } = await askLinks(logged, dad);
    land(videos, ...keys);
    const { data } = await newJob(logged, dad, uploadId, { title: "Aaji's Secret Masala" });
    await call(logged, dad, "POST", `/v1/video-uploads/${uploadId}/complete`);
    await call(logged, dad, "GET", "/v1/jobs");
    await cancel(dad, data.jobId);
    await newJob(logged, dad, "bad folder", { title: "Aaji's Secret Masala" });
    await logged.close();
    assert.ok(lines.length > 0);
    assert.doesNotMatch(lines.join(""), /Secret Masala|Aaji/);
  });

  await app.close();
});

after(async () => {
  if (hasDatabase) await db().end();
});

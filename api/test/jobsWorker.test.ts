// Both sides of the contract with the worker, on real Postgres: the api's real routes and outbox here, and the real pipeline/queue_worker.py and queue_db.py in a child process, with only S3, SQS
// and the video child faked (queueWorkerDriver.py, using the worker test's own fakes). What flows between them is the database and the message body the outbox really sends.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { workerFolder } from "../src/modules/jobs/account.js";
import { addJob, askLinks, call, closeRecipeWrites, db, family, freshDatabase, hasDatabase, job, land, newJob, openRecipeWrites, recipe, setUp, trace, who, worker, workerMissing } from "./jobsHelpers.js";

const missing = workerMissing();
const STAGES = ["uploading", "queued", "preparing", "understanding", "writing", "indexing"];

/** Everything due, as the sender would put it on SQS. */
async function sent(): Promise<{ queue: string; body: string }[]> {
  const out: { queue: string; body: string }[] = [];
  await sendDue(db(), async (queue, body) => {
    out.push({ queue, body });
  });
  return out;
}

test("the worker's contract", { skip: missing ?? false }, async (t) => {
  await freshDatabase();
  const { app, videos } = setUp();
  const home = await family();
  const cook = await who(home);
  const kid = await who(home, "kid");

  await t.test("a job made by the route runs in the real worker, and the recipe reads back through the routes", async () => {
    await openRecipeWrites();
    const { uploadId, keys } = await askLinks(app, cook);
    const { data: made } = await newJob(app, cook, uploadId, { title: "Secret Masala", language: "mr" });
    assert.deepEqual(await sent(), [], "nothing for the worker until the upload is complete");

    // A worker that got here early, from a stray message, can't start it.
    const early = worker({ op: "claim", jobId: made.jobId });
    assert.equal(early.results[0], null);

    land(videos, ...keys);
    const done = await call(app, cook, "POST", `/v1/video-uploads/${uploadId}/complete`, undefined, { "x-request-id": "trace-the-whole-way" });
    assert.equal(done.data.job.stage, "queued");
    const messages = await sent();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].queue, "jobs");
    const body = JSON.parse(messages[0].body);
    assert.deepEqual(Object.keys(body).sort(), ["outboxId", "payload", "requestId"]);
    assert.deepEqual(body.payload, { jobId: made.jobId }, "ids only");
    assert.equal(body.requestId, "trace-the-whole-way");

    const run = worker({ op: "deliver", body: messages[0].body, objects: keys });
    const { started, spec, messagesLeft, reports } = run.results[0];
    assert.equal(started, 1, "the worker took it from the message alone");
    assert.deepEqual(spec.objects.map((o: { key: string }) => o.key), keys);
    assert.equal(spec.title, "Secret Masala");
    assert.equal(spec.language, "mr");
    assert.equal(messagesLeft, 0);
    assert.deepEqual(reports, []);
    assert.match(run.log, /trace-the-whole-way/, "the request id follows the work");
    assert.doesNotMatch(run.log, /Secret Masala/);

    const row = await job(made.jobId);
    assert.equal(row.stage, "done");
    assert.equal(row.progress, 1);
    assert.equal(row.attempts, 1);
    assert.ok(row.upload_finished_at && row.finished_at, "both ends of the 30-minute target");
    assert.equal(row.recipe_id, made.recipeId, "it filled in the card the route made");
    assert.equal(row.result_model, "claude-sonnet-5-5");
    assert.ok(Number(row.cost_usd) > 0);

    const asCook = await call(app, cook, "GET", `/v1/recipes/${made.recipeId}`);
    assert.equal(asCook.status, 200);
    assert.equal(asCook.data.status, "ready");
    assert.equal(asCook.data.title, "Secret Masala");
    assert.ok(asCook.data.steps.length > 0);
    assert.ok(asCook.data.memories.length > 0, "the cook sees her stories");
    assert.match(asCook.data.recipeJsonUrl, /^https:\/\/media\.test\/.*recipe\.json$/);
    const asKid = await call(app, kid, "GET", `/v1/recipes/${made.recipeId}`);
    assert.deepEqual(asKid.data.memories, [], "the kid doesn't, before her yes");
    const list = await call(app, cook, "GET", "/v1/jobs");
    assert.equal(list.data.jobs.find((j: { _id: string }) => j._id === made.jobId).stage, "done");

    // A repeat of the message is dropped, and starts nothing.
    const repeat = worker({ op: "deliver", body: messages[0].body, objects: keys });
    assert.equal(repeat.results[0].started, 0);
    assert.equal(repeat.results[0].messagesLeft, 0);
    assert.equal((await job(made.jobId)).attempts, 1);

    // The worker's own follow-on message is understood here, not a dead letter, and a repeat is fine.
    const followOn = (await sent()).filter((m) => m.queue === "scheduled");
    assert.equal(followOn.length, 1);
    assert.equal(JSON.parse(followOn[0].body).payload.kind, "recipe_published");
    await handleMessage(followOn[0].body, trace.log);
    await handleMessage(followOn[0].body, trace.log);
    await closeRecipeWrites();
  });

  await t.test("with the recipes switch off there's no card, and the worker makes the recipe when it publishes", async () => {
    const { uploadId, keys } = await askLinks(app, cook);
    land(videos, ...keys);
    await call(app, cook, "POST", `/v1/video-uploads/${uploadId}/complete`);
    const { data: made } = await newJob(app, cook, uploadId);
    assert.equal(made.recipeId, null);
    const messages = (await sent()).filter((m) => m.queue === "jobs");
    assert.equal(messages.length, 1);
    worker({ op: "deliver", body: messages[0].body, objects: keys });
    const row = await job(made.jobId);
    assert.equal(row.stage, "done");
    assert.ok(row.recipe_id);
    assert.equal((await recipe(row.recipe_id)).status, "ready");
    assert.equal((await recipe(row.recipe_id)).family_id, home);
  });

  await t.test("jobs.cancel stops a job at every unfinished stage, and a worker mid-way can't bring it back", async () => {
    await openRecipeWrites();
    for (const stage of STAGES) {
      const ids = await addJob(cook, stage);
      // A worker holding it, for the stages one can hold.
      const claim = { id: ids.jobId, attempts: 0 };
      assert.equal((await call(app, cook, "POST", `/v1/jobs/${ids.jobId}/cancel`)).data.stopped, true, stage);
      const out = worker(
        { op: "heartbeat", claim },
        { op: "progress", claim, stage: "writing", progress: 0.8 },
        { op: "release", claim },
        { op: "fail", claim, message: "worker's words" },
        { op: "finish", claim },
        { op: "claim", jobId: ids.jobId, leaseS: 0 },
        { op: "sweep", leaseS: 0 },
      ).results;
      assert.equal(out[0], "cancelled", stage);
      assert.equal(out[2], false, `${stage}: its release changes nothing`);
      assert.equal(out[3], false, `${stage}: its failure changes nothing`);
      assert.equal(out[4], false, `${stage}: its publish changes nothing`);
      assert.equal(out[5], null, `${stage}: nothing left to take`);
      assert.ok(!out[6].includes(ids.jobId), stage);
      const row = await job(ids.jobId);
      assert.equal(row.stage, "failed", stage);
      assert.equal(row.error, "Cancelled.", stage);
      const card = await recipe(ids.recipeId!);
      assert.equal(card.status, "failed", stage);
      assert.deepEqual(card.steps, [], stage);
    }
    await closeRecipeWrites();
  });

  await t.test("a worker that's really running: the stop beats its publish, and a publish that won beats the stop", async () => {
    const claimed = async () => {
      const { uploadId, keys } = await askLinks(app, cook);
      land(videos, ...keys);
      await call(app, cook, "POST", `/v1/video-uploads/${uploadId}/complete`);
      const { data } = await newJob(app, cook, uploadId);
      const claim = worker({ op: "claim", jobId: data.jobId }).results[0];
      assert.equal(claim.attempts, 1);
      assert.equal(claim.upload_key, `${uploadId}/`);
      assert.equal((await job(data.jobId)).stage, "preparing");
      return { jobId: data.jobId, claim: { id: claim.id, attempts: claim.attempts } };
    };
    const a = await claimed();
    assert.equal((await call(app, cook, "POST", `/v1/jobs/${a.jobId}/cancel`)).data.stopped, true);
    assert.equal(worker({ op: "finish", claim: a.claim }).results[0], false);
    assert.equal((await job(a.jobId)).stage, "failed");

    const b = await claimed();
    assert.equal(worker({ op: "finish", claim: b.claim }).results[0], true);
    assert.equal((await call(app, cook, "POST", `/v1/jobs/${b.jobId}/cancel`)).data.stopped, false, "it's over");
    assert.equal((await job(b.jobId)).stage, "done");
    assert.equal((await job(b.jobId)).cancelled_at, null);
  });

  await t.test("a stop while uploading: the message reaches the worker, which deletes what's there and lets go", async () => {
    await sent();
    const { uploadId, keys } = await askLinks(app, cook);
    land(videos, keys[0]);
    const { data } = await newJob(app, cook, uploadId);
    await call(app, cook, "POST", `/v1/jobs/${data.jobId}/cancel`);
    const messages = (await sent()).filter((m) => m.queue === "jobs");
    assert.equal(messages.length, 1);
    assert.deepEqual(JSON.parse(messages[0].body).payload, { jobId: data.jobId });
    const out = worker({ op: "deliver", body: messages[0].body, objects: keys.slice(0, 1) }).results[0];
    assert.equal(out.started, 0, "it never runs");
    assert.deepEqual(out.uploads, [], "her raw video went");
    assert.equal(out.messagesLeft, 0);
    const row = await job(data.jobId);
    assert.equal(row.stage, "failed");
    assert.equal(row.error, "Cancelled.");
    assert.ok(row.finished_at);
  });

  await t.test("a queued job stopped before the worker saw it never starts", async () => {
    await sent();
    const { uploadId, keys } = await askLinks(app, cook);
    land(videos, ...keys);
    await call(app, cook, "POST", `/v1/video-uploads/${uploadId}/complete`);
    const { data } = await newJob(app, cook, uploadId);
    await call(app, cook, "POST", `/v1/jobs/${data.jobId}/cancel`);
    const messages = (await sent()).filter((m) => m.queue === "jobs");
    assert.equal(messages.length, 1, "the one from when it was queued");
    const out = worker({ op: "deliver", body: messages[0].body, objects: keys }).results[0];
    assert.equal(out.started, 0);
    assert.deepEqual(out.uploads, []);
  });

  await t.test("the message for a job still uploading waits, and doesn't start it", async () => {
    const { uploadId, keys } = await askLinks(app, cook);
    const { data } = await newJob(app, cook, uploadId);
    const body = JSON.stringify({ outboxId: "1", requestId: null, payload: { jobId: data.jobId } });
    const out = worker({ op: "deliver", body, objects: keys.slice(0, 1) }).results[0];
    assert.equal(out.started, 0);
    assert.equal(out.messagesLeft, 1, "held, not dropped");
    assert.equal((await job(data.jobId)).stage, "uploading");
  });

  await t.test("the purge names the folder a job with no recipe yet publishes to, by the worker's own rule", () => {
    for (const id of ["0b7f6a1c-1234-4abc-9def-000000000000", "jh7abc123XYZ"]) {
      const folder = worker({ op: "recipeFolder", jobId: id }).results[0];
      assert.equal(workerFolder(id), `${folder}/`);
    }
  });

  await app.close();
});

test("the worker's side of the contract can run", { skip: !missing ? "it ran above" : false }, () => {
  // Says plainly in the results when the suite above was skipped, and why.
  console.log(`SKIPPED the worker's contract: ${missing}`);
});

after(async () => {
  if (hasDatabase) await db().end();
});

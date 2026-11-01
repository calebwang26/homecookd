// What deleting an account does to these tables (SCHEMA.md section 4, the "cook deleting" part of convex/account.test.ts). Nothing calls the purge yet, so the test blanks the person itself.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { purgeJobsForPerson, stopPersonsWork, workerFolder } from "../src/modules/jobs/account.js";
import { addJob, askLinks, call, closeRecipeWrites, db, family, freshDatabase, hasDatabase, job, land, lockRecipeCopy, newJob, openRecipeWrites, recipe, setUp, who, type Who } from "./jobsHelpers.js";
import { tx } from "../src/db.js";

const blank = (p: Who) => db().query(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [p.personId]);
const count = async (table: string, where: string, args: unknown[]) => (await db().query(`select count(*)::int as n from ${table} where ${where}`, args)).rows[0].n;
const deleting = async (p: Who) => {
  await blank(p);
  await tx((c) => stopPersonsWork(c, p.personId));
};

test("account deletion: jobs, recipes, recordings", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const { app, videos } = setUp();

  await t.test("the purge won't run on someone who hasn't deleted their account", async () => {
    const home = await family();
    const cook = await who(home);
    const { jobId } = await addJob(cook, "queued");
    await assert.rejects(purgeJobsForPerson(cook.personId), /hasn't deleted/);
    await assert.rejects(tx((c) => stopPersonsWork(c, cook.personId)), /hasn't deleted/);
    assert.equal((await job(jobId)).stage, "queued");
  });

  await t.test("at once: a cook's unfinished jobs stop, recordings are abandoned, and her recipes are gone for the family", async () => {
    await closeRecipeWrites();
    const home = await family();
    const cook = await who(home);
    const kid = await who(home, "kid");
    const sibling = await who(home);
    const running = await addJob(cook, "writing");
    const finished = await addJob(cook, "done");
    const theirs = await addJob(sibling, "queued");
    const recording = (await db().query(`insert into recordings (family_id, cook_id, language, source, status) values ($1, $2, 'en', 'phone', 'recording') returning id`, [home, cook.personId])).rows[0].id;
    await deleting(cook);

    const stopped = await job(running.jobId);
    assert.equal(stopped.stage, "failed");
    assert.equal(stopped.error, "Cancelled.");
    assert.ok(stopped.cancelled_at && stopped.finished_at);
    assert.equal((await job(finished.jobId)).cancelled_at, null, "a finished job isn't stopped");
    assert.equal((await job(theirs.jobId)).stage, "queued", "nobody else's");
    assert.equal((await db().query(`select status from recordings where id = $1`, [recording])).rows[0].status, "abandoned");
    assert.equal(await recipe(running.recipeId!), undefined);
    assert.ok(await recipe(theirs.recipeId!), "another cook's stays");
    assert.deepEqual((await call(app, kid, "GET", "/v1/recipes")).data.recipes.map((r: { _id: string }) => r._id), [theirs.recipeId]);
    const { rows } = await db().query(`select recipe_ids from account_deletions where person_id = $1`, [cook.personId]);
    assert.deepEqual(rows[0].recipe_ids.sort(), [running.recipeId, finished.recipeId].sort());
  });

  await t.test("a cook deleting takes her recipes from the family, and everything made with them", async () => {
    await closeRecipeWrites();
    const home = await family();
    const cook = await who(home);
    const kid = await who(home, "kid");
    const elsewhere = await family();
    const neighbor = await who(elsewhere);

    // A recipe the pipeline made, with every kind of row around it.
    const made = (await db().query(
      `insert into recipes (family_id, cook_id, title, status, library_id, media_prefix, recipe_json_key, cover_key) values ($1, $2, 'Poha', 'ready', 'poha', 'recipe-a/', 'recipe-a/a1/recipe.json', 'recipe-a/a1/poster.jpg') returning id`,
      [home, cook.personId],
    )).rows[0].id;
    const seeded = (await db().query(`insert into recipes (family_id, cook_id, title, status, cover_stock_path) values ($1, $2, 'Demo', 'ready', 'stock/x.jpg') returning id`, [home, cook.personId])).rows[0].id;
    const { uploadId, keys } = await askLinks(app, cook);
    land(videos, ...keys);
    const { data: upload } = await newJob(app, cook, uploadId);
    await db().query(`update jobs set recipe_id = $1 where id = $2`, [made, upload.jobId]);
    const orphan = await askLinks(app, cook);

    await db().query(`insert into files (key, bucket, kind, family_id, owner_person_id) values ('private/answer-1', 'private', 'voice', $1, $2), ('private/plate-1', 'private', 'cover', $1, $2), ('private/frame-1', 'private', 'frame', $1, $2), ('private/hello-1', 'private', 'voice', $1, $2)`, [home, cook.personId]);
    await db().query(`insert into questions (family_id, recipe_id, asked_by, text, status, answer_by, answer_audio_key) values ($1, $2, $3, 'how much?', 'answered', $4, 'private/answer-1')`, [home, made, kid.personId, cook.personId]);
    const cookingOnHers = await db().query(`insert into cooking_sessions (family_id, kid_id, recipe_id, step_order) values ($1, $2, $3, 1) returning id`, [home, kid.personId, made]);
    const swap = await db().query(`insert into swap_requests (requester_family_id, requester_id, their_family_id, their_recipe_id) values ($1, $2, $3, $4) returning id`, [elsewhere, neighbor.personId, home, made]).catch((e) => e);
    await db().query(`insert into model_calls (job_id, recipe_id, purpose, provider, model, ok) values ($1, $2, 'merge', 'anthropic', 'claude-sonnet-5-5', true)`, [upload.jobId, made]);

    const recording = (await db().query(
      `insert into recordings (family_id, cook_id, language, source, status, cover_key, video_key) values ($1, $2, 'en', 'glasses', 'ended', 'private/plate-1', 'glasses-z/full.mp4') returning id`,
      [home, cook.personId],
    )).rows[0].id;
    await db().query(`insert into homie_prompts (recording_id, kind, text, text_en, at_s, status) values ($1, 'intro', 'hi', 'hi', 0, 'spoken')`, [recording]);
    await db().query(`insert into live_events (recording_id, session_id, session_started_at, kind, at_s, title, text, confidence) values ($1, 's', now(), 'step', 0, 't', 'words', 1)`, [recording]);
    await db().query(`insert into live_windows (recording_id, session_id, session_started_at, start_s, end_s, ok) values ($1, 's', now(), 0, 30, true)`, [recording]);
    await db().query(`insert into live_frames (recording_id, frame_key, at) values ($1, 'private/frame-1', now())`, [recording]);

    // She's cooking someone else's dish as a kid would, and her name is on a library dish's row.
    const hersAsKid = await who(home, "kid");
    await db().query(`insert into cooking_sessions (family_id, kid_id, library_id, cook_id, step_order) values ($1, $2, 'sample', $3, 1)`, [home, hersAsKid.personId, cook.personId]);

    const sent = await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, hello_key) values ('sent-by-her', $1, $2, $3, 'private/hello-1') returning upload_id`, [home, cook.personId, [kid.personId]]);
    const other = await who(home);
    await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids) values ('sent-to-her', $1, $2, $3)`, [home, other.personId, [cook.personId, kid.personId]]);
    assert.ok(sent.rows[0]);

    await deleting(cook);
    await purgeJobsForPerson(cook.personId);

    // Gone.
    assert.equal(await recipe(made), undefined);
    assert.equal(await recipe(seeded), undefined);
    assert.equal(await count("questions", "recipe_id = $1", [made]), 0);
    assert.equal(await count("cooking_sessions", "id = $1", [cookingOnHers.rows[0].id]), 0);
    if (!(swap instanceof Error)) assert.equal(await count("swap_requests", "id = $1", [swap.rows[0].id]), 0);
    assert.equal(await count("jobs", "cook_id = $1", [cook.personId]), 0);
    assert.equal(await count("recordings", "cook_id = $1", [cook.personId]), 0);
    for (const table of ["homie_prompts", "live_events", "live_windows", "live_frames"]) assert.equal(await count(table, "recording_id = $1", [recording]), 0, table);
    assert.equal(await count("pending_sends", "upload_id = 'sent-by-her'", []), 0);

    // Kept, without her.
    const { rows: library } = await db().query(`select cook_id from cooking_sessions where kid_id = $1`, [hersAsKid.personId]);
    assert.deepEqual(library, [{ cook_id: null }]);
    const { rows: toHer } = await db().query(`select recipient_ids from pending_sends where upload_id = 'sent-to-her'`);
    assert.deepEqual(toHer[0].recipient_ids, [kid.personId]);
    const { rows: costs } = await db().query(`select job_id, recipe_id, cost_usd from model_calls where model = 'claude-sonnet-5-5' and job_id is null`);
    assert.equal(costs.length, 1, "cost history stays, with its ids nulled");

    // Every file marked, for the sweep, before its row went: raw videos by the upload, and everything else in the ledger.
    for (const key of ["private/answer-1", "private/plate-1", "private/frame-1", "private/hello-1", ...keys, ...orphan.keys]) {
      const { rows } = await db().query(`select delete_requested_at from files where key = $1`, [key]);
      assert.ok(rows[0]?.delete_requested_at, key);
    }

    // And what only an outside purge can reach is written down: folders, and the files in them.
    const { rows } = await db().query(`select *, upload_keys::text[] as upload_keys, media_keys::text[] as media_keys, media_prefixes::text[] as media_prefixes from account_deletions where person_id = $1`, [cook.personId]);
    assert.equal(rows.length, 1);
    const d = rows[0];
    assert.deepEqual(d.recipe_ids.sort(), [made, seeded].sort());
    assert.deepEqual(d.job_ids, [upload.jobId]);
    assert.deepEqual(d.upload_keys, [`${uploadId}/`]);
    assert.deepEqual(d.media_prefixes.sort(), ["recipe-a/", workerFolder(upload.jobId)].sort(), "a seeded recipe's files are the public library's, so it has no folder here");
    assert.deepEqual(d.media_keys.sort(), ["glasses-z/full.mp4", "recipe-a/a1/poster.jpg", "recipe-a/a1/recipe.json"]);
  });

  await t.test("a kid deleting: her cooking rows go, and nothing of anyone else's", async () => {
    const home = await family();
    const cook = await who(home);
    const kid = await who(home, "kid");
    const other = await who(home, "kid");
    const keep = await addJob(cook, "done");
    await db().query(`insert into cooking_sessions (family_id, kid_id, recipe_id, step_order) values ($1, $2, $3, 1), ($1, $4, $3, 1)`, [home, kid.personId, keep.recipeId, other.personId]);
    await deleting(kid);
    await purgeJobsForPerson(kid.personId);
    assert.equal(await count("cooking_sessions", "kid_id = $1", [kid.personId]), 0);
    assert.equal(await count("cooking_sessions", "kid_id = $1", [other.personId]), 1);
    assert.ok(await recipe(keep.recipeId!));
    assert.ok(await job(keep.jobId));
  });

  await t.test("safe to run again, and it catches a recipe the worker published a moment after", async () => {
    const home = await family();
    const cook = await who(home);
    await addJob(cook, "done");
    await deleting(cook);
    await purgeJobsForPerson(cook.personId);
    const before = (await db().query(`select recipe_ids, job_ids from account_deletions where person_id = $1`, [cook.personId])).rows[0];
    await purgeJobsForPerson(cook.personId);
    assert.deepEqual((await db().query(`select recipe_ids, job_ids from account_deletions where person_id = $1`, [cook.personId])).rows[0], before);

    const late = (await db().query(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Late', 'ready') returning id`, [home, cook.personId])).rows[0].id;
    await purgeJobsForPerson(cook.personId);
    assert.equal(await recipe(late), undefined);
    const after_ = (await db().query(`select recipe_ids from account_deletions where person_id = $1`, [cook.personId])).rows[0];
    assert.ok(after_.recipe_ids.includes(late));
    assert.equal(after_.recipe_ids.length, before.recipe_ids.length + 1, "the list only grows, without repeats");
  });

  await t.test("its work carries on past a batch", async () => {
    const home = await family();
    const cook = await who(home);
    const values = Array.from({ length: 520 }, (_, i) => `('${home}', '${cook.personId}', 'many-${i}/', 'phone', 'done', now())`).join(",");
    await db().query(`insert into jobs (family_id, cook_id, upload_key, source, stage, finished_at) values ${values}`);
    await blank(cook);
    await purgeJobsForPerson(cook.personId);
    assert.equal(await count("jobs", "cook_id = $1", [cook.personId]), 0);
    const { rows } = await db().query(`select cardinality(job_ids) as n from account_deletions where person_id = $1`, [cook.personId]);
    assert.equal(rows[0].n, 520);
  });

  await t.test("with the copy still read-only, the sync owns her recipes: the purge leaves them and does the rest", async () => {
    await closeRecipeWrites();
    const home = await family();
    const cook = await who(home);
    const ids = await addJob(cook, "queued");
    await lockRecipeCopy();
    await deleting(cook);
    await purgeJobsForPerson(cook.personId);
    await closeRecipeWrites();
    assert.ok(await recipe(ids.recipeId!), "the sync's deletion removes it, not this");
    assert.equal(await count("jobs", "cook_id = $1", [cook.personId]), 0);
  });

  await t.test("it doesn't wait for the recipes flag, once the copy has moved", async () => {
    await openRecipeWrites();
    delete process.env.RECIPE_WRITES;
    const home = await family();
    const cook = await who(home);
    const ids = await addJob(cook, "done");
    await deleting(cook);
    assert.equal(await recipe(ids.recipeId!), undefined);
    await closeRecipeWrites();
  });

  await app.close();
});

after(async () => {
  if (hasDatabase) await db().end();
});

// Staging's test recipe (src/modules/recipes/testRecipe.ts): no route without the key, and a wrong key or no session makes nothing. With both, a cook gets a ready recipe the
// app lists, opens and cooks from, in the worker's layout, that only her family sees and that goes with her account. Given one of her jobs, it finishes the job as the
// worker's publish does. Made-up data only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { purgeOutside, runPurge, useVoiceClones } from "../src/modules/accounts/deletion.js";
import { S3_GRACE_MS } from "../src/modules/accounts/outside.js";
import { DURATION_S } from "../src/modules/recipes/testMedia.js";
import { DEFAULT_TITLE, MAX_STEPS } from "../src/modules/recipes/testRecipe.js";
import { useMediaStore, useObjectStore, useUploadStore } from "../src/storage.js";
import { Api, freshDatabase, hasDatabase, setup } from "./accountsHelpers.js";
import { fakeStore, type FakeStore } from "./dishHelpers.js";
import { bearer, person, session } from "./helpers.js";

const skip = !hasDatabase;
const KEY = "made-up-test-signin-key";
const MEDIA = "https://media.test";
const ROUTE = "/v1/test/recipe";
let withKey: Api;
let withoutKey: Api;
let media: FakeStore;
let videos: FakeStore;
let seq = 0;

type Who = { token: string; personId: string; familyId: string };

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
  process.env.MEDIA_BASE_URL = MEDIA;
  process.env.RECIPE_WRITES = "on"; // as on staging
  useVoiceClones({ remove: async () => {} });
  media = fakeStore();
  videos = fakeStore();
  useMediaStore(media);
  useUploadStore(videos);
  useObjectStore(fakeStore());
  // Routes are added when an app starts, so each one starts while the environment is as it says.
  delete process.env.TEST_SIGNIN_KEY;
  withoutKey = new Api();
  await withoutKey.app.ready();
  process.env.TEST_SIGNIN_KEY = KEY;
  withKey = new Api();
  await withKey.app.ready();
});

after(async () => {
  delete process.env.TEST_SIGNIN_KEY;
  delete process.env.RECIPE_WRITES;
  if (!skip) await db().end();
});

/** A cook, signed in as staging's scripts sign in: the test sign-in, then a session. */
async function cook(): Promise<Who> {
  seq += 1;
  const signedIn = await withKey.post("/v1/test/sign-in", { test_id: `cook-${seq}`, name: `Test cook ${seq}`, role: "cook" }, { "x-test-signin-key": KEY });
  assert.equal(signedIn.status, 200);
  const s = await withKey.post("/v1/sessions/start", { deviceKey: signedIn.data.device_key, profileId: signedIn.data.profile_id });
  assert.equal(s.status, 200);
  return { token: s.data.sessionToken, personId: s.data.personId, familyId: s.data.familyId };
}

async function memberOf(familyId: string, role: "cook" | "kid"): Promise<Who> {
  const personId = await person(familyId, role);
  return { token: await session(familyId, personId), personId, familyId };
}

const make = (by: Who | null, body?: object, key: string | null = KEY, api = withKey) =>
  api.post(ROUTE, body, { ...(by ? bearer(by.token) : {}), ...(key === null ? {} : { "x-test-signin-key": key }) });
const recipes = async (by: Who) => (await withKey.get("/v1/recipes", bearer(by.token))).data.recipes as { _id: string; [k: string]: unknown }[];
const recipeRow = async (id: string) => (await db().query(`select * from recipes where id = $1`, [id])).rows[0];
const jobRow = async (id: string) => (await db().query(`select * from jobs where id = $1`, [id])).rows[0];
const count = async (table: string) => (await db().query(`select count(*)::int as n from ${table}`)).rows[0].n as number;
const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));
const recipeJson = (url: string) => JSON.parse(new TextDecoder().decode(media.objects.get(keyOf(url))!.bytes));

/** pipeline/schema.py's own check of a recipe.json, when this machine's Python has pydantic. */
function schemaSays(json: object): string | null | "no python" {
  const pipeline = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pipeline");
  const code = "import sys; sys.path.insert(0, sys.argv[1]); from schema import Recipe; Recipe.model_validate_json(sys.stdin.read())";
  const python = process.env.PIPELINE_PYTHON ?? "python3";
  if (spawnSync(python, ["-c", "import pydantic"]).status !== 0) return "no python";
  const out = spawnSync(python, ["-c", code, pipeline], { input: JSON.stringify(json), encoding: "utf8" });
  return out.status === 0 ? null : out.stderr;
}

test("without TEST_SIGNIN_KEY the route isn't there, as in production", { skip }, async () => {
  const mom = await cook();
  const res = await make(mom, {}, KEY, withoutKey);
  assert.equal(res.status, 404);
  assert.equal(res.data.error, "no_route");
});

test("a wrong or missing key, or no session, is refused and makes nothing", { skip }, async () => {
  const mom = await cook();
  const before = { recipes: await count("recipes"), files: media.objects.size };
  for (const key of [null, "not-the-key", `${KEY}x`]) {
    const res = await make(mom, {}, key);
    assert.deepEqual([res.status, res.data.error, res.data.message], [401, "signed_out", "That test key isn't right."], String(key));
  }
  const noSession = await make(null, {});
  assert.deepEqual([noSession.status, noSession.data.error], [401, "signed_out"]);
  assert.equal((await make({ ...mom, token: "x".repeat(43) }, {})).status, 401);
  const kid = await memberOf(mom.familyId, "kid");
  assert.equal((await make(kid, {})).status, 403, "a finished job's cook is a cook");
  assert.deepEqual({ recipes: await count("recipes"), files: media.objects.size }, before);
});

test("a cook gets a ready recipe the list and get routes return, in the worker's layout", { skip }, async () => {
  const mom = await cook();
  const kid = await memberOf(mom.familyId, "kid");
  // No body at all: every field is optional.
  const sent = await withKey.app.inject({ method: "POST", url: ROUTE, headers: { ...bearer(mom.token), "x-test-signin-key": KEY } });
  const res = { status: sent.statusCode, data: sent.json() };
  assert.equal(res.status, 201);
  const { recipeId, recipeUrl } = res.data;
  assert.deepEqual(Object.keys(res.data).sort(), ["recipeId", "recipeUrl"]);

  // What the app reads.
  const got = await withKey.get(`/v1/recipes/${recipeId}`, bearer(mom.token));
  assert.equal(got.status, 200);
  const r = got.data;
  assert.equal(r.recipeJsonUrl, recipeUrl, "the answer is what the app later reads");
  assert.equal(r.status, "ready");
  assert.equal(r.title, DEFAULT_TITLE);
  assert.equal(r.cookId, mom.personId);
  assert.equal(r.familyId, mom.familyId);
  assert.match(r.cookName, /^Test cook/);
  assert.match(r.libraryId, /^test-recipe-[0-9a-f]{12}$/);
  assert.match(r.coverUrl, new RegExp(`^${MEDIA}/${r.libraryId}/[0-9a-f]{12}-a1/poster\\.jpg\\?v=v\\d+$`));
  assert.equal(r.stepCount, 3);
  assert.deepEqual(r.steps[0], { order: 1, title: "Boil the water", text: "Bring the water to a boil with the ginger and cardamom.", quote: "Let the ginger boil properly, don't rush it.", moment: { startS: 0, endS: 8 } });
  assert.deepEqual(r.memories.map((m: { kind: string }) => m.kind), ["story", "tip"], "the cook sees her stories");
  assert.equal(r.memoriesOptIn, false);
  assert.equal(r.language, "en");
  for (const who of [mom, kid]) assert.ok((await recipes(who)).some((x) => x._id === recipeId), "listed to the family, as the app's library reads it");
  assert.deepEqual((await recipes(kid)).find((x) => x._id === recipeId)!.memories, [], "her stories wait for her yes, as a real recipe's");

  // The row the worker's final transaction leaves (pipeline/queue_db.py _save_recipe).
  const row = await recipeRow(recipeId);
  assert.equal(row.media_prefix, `${r.libraryId}/`);
  assert.ok(row.recipe_json_key.startsWith(row.media_prefix) && row.cover_key.startsWith(row.media_prefix));
  assert.equal(row.moss_indexed_at, null);

  // The files: all in her recipe's folder, as publish.py lays them out.
  const keys = [...media.objects.keys()].filter((k) => k.startsWith(row.media_prefix)).map((k) => k.slice(row.recipe_json_key.length - "recipe.json".length)).sort();
  assert.deepEqual(keys, ["play.mp4", "poster.jpg", "recipe.json", "steps/01.jpg", "steps/02.jpg", "steps/03.jpg", "voice.m4a"]);
  assert.equal(media.objects.get(row.recipe_json_key)!.contentType, "application/json");
  assert.equal(media.objects.get(row.recipe_json_key)!.cacheControl, "no-cache, max-age=0");
  assert.equal(media.objects.get(row.cover_key)!.cacheControl, "public, max-age=3600");

  // recipe.json: a family's, as publish.without_memories leaves it, with links the CDN serves.
  const json = recipeJson(recipeUrl);
  assert.equal(json.id, r.libraryId);
  assert.equal(json.family, true);
  assert.equal(json.sample, false);
  assert.deepEqual([json.intro, json.stories, json.special], ["", [], []], "her stories are only in the row");
  assert.equal(json.title, DEFAULT_TITLE);
  assert.match(json.cook.name, /^Test cook/);
  assert.equal(json.media.duration_s, DURATION_S);
  for (const url of [json.media.video_url, json.media.audio_url, json.media.poster_url, ...json.steps.map((s: { image_url: string }) => s.image_url)]) {
    assert.match(url, new RegExp(`^${MEDIA}/${row.media_prefix}[0-9a-f]{12}-a1/.+\\?v=v\\d+$`));
    assert.ok(media.objects.has(keyOf(url)), url);
  }
  assert.equal(json.media.poster_url, r.coverUrl);
  assert.deepEqual(json.steps.map((s: { start_s: number; end_s: number }) => [s.start_s, s.end_s]), [[0, 8], [8, 16], [16, 24]]);
  assert.deepEqual(json.steps[0].substeps.map((s: { start_s: number }) => s.start_s), [0, 2, 5]);
  const said = schemaSays(json);
  if (said === "no python") console.log("# pipeline/schema.py not checked: set PIPELINE_PYTHON to a Python with pydantic");
  else assert.equal(said, null, "pipeline/schema.py takes it");

  // The bytes are real media, not placeholders.
  assert.equal(new TextDecoder().decode(media.objects.get(keyOf(json.media.video_url))!.bytes.slice(4, 8)), "ftyp");
  assert.deepEqual([...media.objects.get(row.cover_key)!.bytes.slice(0, 2)], [0xff, 0xd8]);
});

test("its own title and steps, within the video's length", { skip }, async () => {
  const mom = await cook();
  const steps = Array.from({ length: MAX_STEPS }, (_, i) => ` Step words ${i + 1} `);
  const res = await make(mom, { title: "  Aai's poha  ", steps });
  assert.equal(res.status, 201);
  const r = (await withKey.get(`/v1/recipes/${res.data.recipeId}`, bearer(mom.token))).data;
  assert.equal(r.title, "Aai's poha");
  assert.equal(r.stepCount, MAX_STEPS);
  assert.deepEqual(r.steps[11], { order: 12, title: "Step 12", text: "Step words 12", moment: { startS: 22, endS: 24 } });
  const json = recipeJson(res.data.recipeUrl);
  assert.equal(json.steps.length, MAX_STEPS);
  assert.equal(json.steps[0].substeps, null);
  const said = schemaSays(json);
  if (said !== "no python") assert.equal(said, null, "pipeline/schema.py takes it");

  assert.equal((await make(mom, { steps: Array(MAX_STEPS + 1).fill("x") })).status, 400);
  assert.equal((await make(mom, { steps: [] })).status, 400);
  assert.equal((await make(mom, { steps: ["   "] })).status, 400);
  assert.equal((await make(mom, { title: "x".repeat(121) })).status, 400);
});

test("another family can't see it", { skip }, async () => {
  const mom = await cook();
  const stranger = await cook();
  const { recipeId } = (await make(mom)).data;
  assert.ok(!(await recipes(stranger)).some((x) => x._id === recipeId));
  const theirs = await withKey.get(`/v1/recipes/${recipeId}`, bearer(stranger.token));
  const missing = await withKey.get("/v1/recipes/no-such-recipe", bearer(stranger.token));
  assert.equal(theirs.status, 404);
  assert.deepEqual({ ...theirs.data, requestId: 0 }, { ...missing.data, requestId: 0 });
});

test("with recipe writes closed it answers 501 not_moved, and nothing reaches the bucket", { skip }, async () => {
  const mom = await cook();
  const files = media.objects.size;
  delete process.env.RECIPE_WRITES;
  try {
    const res = await make(mom);
    assert.deepEqual([res.status, res.data.error], [501, "not_moved"]);
  } finally {
    process.env.RECIPE_WRITES = "on";
  }
  assert.equal(media.objects.size, files);
});

test("deleting the account removes it, its folder too", { skip }, async () => {
  const mom = await cook();
  const kid = await memberOf(mom.familyId, "kid");
  // Signed in with Apple, so the family carries on without her (deletion.ts endFamilyIfLast).
  await db().query(`insert into identities (provider, subject, person_id) values ('apple', $1, $2)`, [`test:kid-${kid.personId}`, kid.personId]);
  const { recipeId } = (await make(mom)).data;
  const prefix = (await recipeRow(recipeId)).media_prefix as string;
  assert.ok([...media.objects.keys()].some((k) => k.startsWith(prefix)));

  assert.equal((await withKey.post("/v1/account/delete", {}, bearer(mom.token))).status, 200);
  assert.equal(await recipeRow(recipeId), undefined, "gone for the family at once");
  assert.ok(!(await recipes(kid)).some((x) => x._id === recipeId));

  const deletion = (await db().query(`select id, media_prefixes::text[] as media_prefixes from account_deletions where person_id = $1`, [mom.personId])).rows[0];
  assert.ok(deletion.media_prefixes.includes(prefix), "its folder is written down for the outside purge");
  assert.equal(await runPurge(deletion.id, {}), "done");
  await db().query(`update account_deletions set purged_at = purged_at - make_interval(secs => $2) where id = $1`, [deletion.id, S3_GRACE_MS / 1000 + 1]);
  assert.equal(await purgeOutside(deletion.id), "done");
  assert.deepEqual([...media.objects.keys()].filter((k) => k.startsWith(prefix)), []);
});

// ---- given a job

/** A video job through the real routes, up to `queued`: links, the PUT, the job (with its "processing" card), and /complete. */
async function queuedJob(by: Who): Promise<{ jobId: string; cardId: string }> {
  seq += 1;
  const asked = await withKey.post("/v1/video-uploads", { videos: [{ contentType: "video/quicktime", size: 5, durationS: 60 }] }, { ...bearer(by.token), "idempotency-key": `test-recipe-job-${seq}` });
  assert.equal(asked.status, 201);
  const { uploadId } = asked.data;
  videos.objects.set(`${uploadId}/01.mov`, { bytes: new Uint8Array(5), contentType: "video/quicktime" });
  const made = await withKey.post("/v1/jobs", { uploadId, source: "phone", title: "Thalipeeth" }, bearer(by.token));
  assert.equal(made.status, 201);
  assert.equal((await withKey.post(`/v1/video-uploads/${uploadId}/complete`, {}, bearer(by.token))).data.job.stage, "queued");
  return { jobId: made.data.jobId, cardId: made.data.recipeId };
}

const live = (by: Who, since?: string) => withKey.get(`/v1/live/jobs${since ? `?since=${encodeURIComponent(since)}` : ""}`, bearer(by.token));

test("given her queued job, it publishes as the worker does: the live topic moves to done with the recipe", { skip }, async () => {
  const mom = await cook();
  const kid = await memberOf(mom.familyId, "kid");
  const { jobId, cardId } = await queuedJob(mom);
  assert.ok(cardId, "writes are open, so the job has its card");
  const before = (await live(mom)).data;
  const queued = before.data.find((j: { _id: string }) => j._id === jobId);
  assert.deepEqual([queued.stage, queued.recipeId], ["queued", cardId]);
  assert.ok(!(await recipes(kid)).some((x) => x._id === cardId), "a card being made is only the cook's");

  const res = await make(mom, { jobId });
  assert.equal(res.status, 201);
  assert.equal(res.data.recipeId, cardId, "the card becomes the recipe, as the worker fills it in");

  const after = (await live(mom, before.version)).data;
  assert.equal(after.changed, true);
  const done = after.data.find((j: { _id: string }) => j._id === jobId);
  assert.deepEqual([done.stage, done.progress, done.recipeId, done.error], ["done", 1, cardId, undefined]);

  // pipeline/queue_db.py finish: the job's end, the recipe, and the follow-on message, together.
  const job = await jobRow(jobId);
  assert.ok(job.finished_at);
  assert.equal(job.attempts, 1, "one claim's worth");
  assert.ok(job.claimed_at);
  assert.equal(job.result_model, "test-recipe");
  const { rows: followOn } = await db().query(`select payload, request_id from outbox where queue = 'scheduled' and payload->>'jobId' = $1`, [jobId]);
  assert.deepEqual(followOn.map((m) => m.payload), [{ kind: "recipe_published", jobId, recipeId: cardId }]);

  const r = (await withKey.get(`/v1/recipes/${cardId}`, bearer(kid.token))).data;
  assert.equal(r.status, "ready");
  assert.equal(r.title, "Thalipeeth", "the job's own title, as the worker's prep keeps it");
  assert.equal(r.recipeJsonUrl, res.data.recipeUrl);
  assert.equal(recipeJson(res.data.recipeUrl).title, "Thalipeeth");
  assert.ok((await recipes(kid)).some((x) => x._id === cardId), "published: the family sees it now");
});

test("another cook's job, or another family's, is not found, and nothing moves", { skip }, async () => {
  const mom = await cook();
  const { jobId } = await queuedJob(mom);
  const aunt = await memberOf(mom.familyId, "cook");
  const stranger = await cook();
  const files = media.objects.size;
  for (const who of [aunt, stranger]) {
    const res = await make(who, { jobId });
    assert.deepEqual([res.status, res.data.error], [404, "not_found"]);
  }
  assert.equal((await make(mom, { jobId: "no-such-job" })).status, 404);
  assert.equal((await jobRow(jobId)).stage, "queued");
  assert.equal(media.objects.size, files);
});

test("a finished job can't be finished again: 409 conflict, and a stopped one is finished too", { skip }, async () => {
  const mom = await cook();
  const { jobId } = await queuedJob(mom);
  assert.equal((await make(mom, { jobId })).status, 201);
  const files = media.objects.size;
  const again = await make(mom, { jobId });
  assert.deepEqual([again.status, again.data.error], [409, "conflict"]);
  assert.equal(media.objects.size, files, "refused before a file is written");
  assert.equal((await db().query(`select count(*)::int as n from outbox where payload->>'jobId' = $1 and payload->>'kind' = 'recipe_published'`, [jobId])).rows[0].n, 1);

  const stopped = await queuedJob(mom);
  assert.equal((await withKey.post(`/v1/jobs/${stopped.jobId}/cancel`, {}, bearer(mom.token))).status, 200);
  assert.equal((await make(mom, { jobId: stopped.jobId })).status, 409);
});

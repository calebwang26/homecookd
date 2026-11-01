// The reads of recordings, what the glasses saw, and who's cooking: the read halves of convex/live.test.ts, glasses.test.ts and flow.test.ts. Rows go in with SQL, because the writers are deferred with
// homie (docs/build/JOBS-MIGRATION.md).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { MEDIA, call, db, family, freshDatabase, hasDatabase, setUp, who, type Who } from "./jobsHelpers.js";

async function addRecording(cook: Who, extra: Record<string, unknown> = {}): Promise<string> {
  const row = { language: "mr", source: "glasses", status: "recording", ...extra };
  const names = Object.keys(row);
  const { rows } = await db().query(
    `insert into recordings (family_id, cook_id, ${names.join(", ")}) values ($1, $2, ${names.map((_, i) => `$${i + 3}`).join(", ")}) returning id`,
    [cook.familyId, cook.personId, ...Object.values(row)],
  );
  return rows[0].id;
}

test("recordings", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const { app, privateFiles } = setUp();
  const home = await family();
  const dad = await who(home);
  const leo = await who(home, "kid");
  const others = await family();
  const sam = await who(others);

  await t.test("the recording screen's view, for its cook", async () => {
    const id = await addRecording(dad, { dish: "Masale Bhaat", for_kid_ids: [leo.personId], video_key: `glasses-${"abc"}/full.mp4`, started_at: new Date("2026-10-31T12:00:00Z") });
    const { status, data } = await call(app, dad, "GET", `/v1/recordings/${id}`);
    assert.equal(status, 200);
    assert.equal(data._id, id);
    assert.equal(data.status, "recording");
    assert.equal(data.language, "mr");
    assert.equal(data.dish, "Masale Bhaat");
    assert.equal(data.forKidId, leo.personId);
    assert.deepEqual(data.forKidIds, [leo.personId]);
    assert.equal(data.startedAt, Date.parse("2026-10-31T12:00:00Z"));
    assert.equal(data.videoUrl, `${MEDIA}/glasses-abc/full.mp4`);
    assert.ok(!("video_key" in data) && !("cover_key" in data));
    for (const path of ["", "/log", "/frame"]) {
      const wrong = await call(app, sam, "GET", `/v1/recordings/${id}${path}`);
      const missing = await call(app, sam, "GET", `/v1/recordings/no-such${path}`);
      assert.equal(wrong.status, 404, path);
      assert.deepEqual({ ...wrong.data, requestId: 0 }, { ...missing.data, requestId: 0 }, path);
      assert.equal((await call(app, null, "GET", `/v1/recordings/${id}${path}`)).status, 401, path);
    }
  });

  await t.test("live events reach the app oldest first on the wall clock, with windows counted", async () => {
    const id = await addRecording(dad);
    const started = "2026-10-31T12:00:00Z";
    const event = (kind: string, atS: number, title: string, saidAs: string | null, session = started) =>
      db().query(
        `insert into live_events (recording_id, session_id, session_started_at, kind, at_s, title, text, said_as, confidence) values ($1, 's', $2, $3, $4, $5, 'words', $6, 0.9)`,
        [id, session, kind, atS, title, saidAs],
      );
    await event("step", 90, "Second", null);
    await event("cue", 30, "First", "as she said it");
    await event("story", 5, "Third", null, "2026-10-31T13:00:00Z");
    for (const ok of [true, true, false]) {
      await db().query(`insert into live_windows (recording_id, session_id, session_started_at, start_s, end_s, ok) values ($1, 's', $2, 0, 30, $3)`, [id, started, ok]);
    }
    const { data } = await call(app, dad, "GET", `/v1/recordings/${id}/log`);
    assert.deepEqual(data.events.map((e: { title: string }) => e.title), ["First", "Second", "Third"]);
    assert.equal(data.events[0].at, Date.parse(started) + 30_000);
    assert.equal(data.events[0].saidAs, "as she said it");
    assert.deepEqual(data.windows, { analysed: 2, missed: 1 });
    const none = await call(app, dad, "GET", `/v1/recordings/${await addRecording(dad)}/log`);
    assert.deepEqual(none.data, { events: [], windows: { analysed: 0, missed: 0 } });
  });

  await t.test("nobody else sees a recording until its recipe is out, then the family reads it", async () => {
    const other = await who(home);
    const recipe = (await db().query(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'KEEP-a dish', 'processing') returning id`, [dad.familyId, dad.personId])).rows[0].id as string;
    const jobId = (await db().query(`insert into jobs (family_id, cook_id, recipe_id, upload_key, source, stage) values ($1, $2, $3, $4, 'glasses', 'writing') returning id`, [dad.familyId, dad.personId, recipe, `own-${Date.now()}/`])).rows[0].id as string;
    const id = await addRecording(dad, { status: "ended", job_id: jobId, video_key: "glasses-own/full.mp4" });
    const listed = async (by: Who) => (await call(app, by, "GET", "/v1/recordings/glasses-videos")).data.videos.some((v: { recordingId: string }) => v.recordingId === id);
    for (const by of [other, leo]) {
      for (const path of ["", "/log", "/frame"]) assert.equal((await call(app, by, "GET", `/v1/recordings/${id}${path}`)).status, 404, path);
      assert.equal(await listed(by), false);
    }
    assert.equal((await call(app, dad, "GET", `/v1/recordings/${id}`)).status, 200);
    assert.equal(await listed(dad), true);
    await db().query(`update recipes set status = 'ready' where id = $1`, [recipe]);
    for (const by of [other, leo]) {
      for (const path of ["", "/log", "/frame"]) assert.equal((await call(app, by, "GET", `/v1/recordings/${id}${path}`)).status, 200, path);
      assert.equal(await listed(by), true);
    }
  });

  await t.test("the newest frame, by a link; none yet, and a link that can't be made, read as no frame", async () => {
    const id = await addRecording(dad);
    assert.deepEqual((await call(app, dad, "GET", `/v1/recordings/${id}/frame`)).data, { frame: null });
    await db().query(`insert into live_frames (recording_id, frame_key, at) values ($1, 'private/frames/one.jpg', '2026-10-31T12:00:00Z')`, [id]);
    const { data } = await call(app, dad, "GET", `/v1/recordings/${id}/frame`);
    assert.deepEqual(data, { frame: { url: "https://fake-s3.test/get/private/frames/one.jpg", at: Date.parse("2026-10-31T12:00:00Z") } });
    privateFiles.failGets = true;
    assert.deepEqual((await call(app, dad, "GET", `/v1/recordings/${id}/frame`)).data, { frame: null });
    privateFiles.failGets = false;
  });

  await t.test("her family's glasses videos: the saved ones, and ones ended in the last 2 hours still being built", async () => {
    const lone = await who(await family());
    const saved = await addRecording(lone, { dish: "Saved", status: "ended", video_key: "glasses-1/full.mp4", ended_at: new Date("2026-10-31T12:00:00Z") });
    const building = await addRecording(lone, { dish: "Building", status: "ended" });
    await addRecording(lone, { dish: "Too old", status: "ended", updated_at: new Date(Date.now() - 3 * 3600_000) });
    await addRecording(lone, { dish: "Phone", source: "phone", status: "ended" });
    await addRecording(lone, { dish: "Filming", status: "recording" });
    const { status, data } = await call(app, lone, "GET", "/v1/recordings/glasses-videos");
    assert.equal(status, 200);
    assert.deepEqual(data.videos.map((v: { recordingId: string }) => v.recordingId).sort(), [saved, building].sort());
    const one = data.videos.find((v: { recordingId: string }) => v.recordingId === saved);
    assert.deepEqual(one, { recordingId: saved, videoUrl: `${MEDIA}/glasses-1/full.mp4`, dish: "Saved", at: Date.parse("2026-10-31T12:00:00Z") });
    assert.deepEqual((await call(app, sam, "GET", "/v1/recordings/glasses-videos")).data.videos, []);
    assert.equal((await call(app, null, "GET", "/v1/recordings/glasses-videos")).status, 401);
  });

  await t.test("who's cooking: open rows for her family, by name, step and dish", async () => {
    const recipeId = (await db().query(
      `insert into recipes (family_id, cook_id, title, status, steps) values ($1, $2, 'Sunday Chili', 'ready', $3) returning id`,
      [home, dad.personId, JSON.stringify([{ order: 1 }, { order: 2 }])],
    )).rows[0].id;
    const open = await db().query(
      `insert into cooking_sessions (family_id, kid_id, recipe_id, cook_id, step_order) values ($1, $2, $3, $4, 2) returning id`,
      [home, leo.personId, recipeId, dad.personId],
    );
    const { data } = await call(app, dad, "GET", "/v1/cooking");
    assert.equal(data.cooking.length, 1);
    assert.equal(data.cooking[0].kidId, leo.personId);
    assert.match(data.cooking[0].kidName, /^Person/);
    assert.equal(data.cooking[0].recipeId, recipeId);
    assert.equal(data.cooking[0].recipeTitle, "Sunday Chili");
    assert.equal(data.cooking[0].stepOrder, 2);
    assert.equal(data.cooking[0].stepCount, 2);
    assert.equal(typeof data.cooking[0].updatedAt, "number");
    assert.deepEqual((await call(app, sam, "GET", "/v1/cooking")).data.cooking, []);
    assert.equal((await call(app, null, "GET", "/v1/cooking")).status, 401);
    await db().query(`update cooking_sessions set ended_at = now() where id = $1`, [open.rows[0].id]);
    assert.deepEqual((await call(app, dad, "GET", "/v1/cooking")).data.cooking, []);
  });

  await t.test("nothing here writes: the deferred routes aren't routes", async () => {
    for (const url of ["/v1/recordings", "/v1/recordings/x/end", "/v1/recordings/x/cover", "/v1/cooking/finish", "/v1/live/status", "/glasses/finished"]) {
      assert.equal((await call(app, dad, "POST", url, {})).status, 404, url);
    }
  });

  await app.close();
});

after(async () => {
  if (hasDatabase) await db().end();
});

// The temporary sync's passes on real Postgres, with fakes for Convex and Supabase. Every row is made up.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { handleMessage } from "../src/scheduled.js";
import { runDeletions, runPass } from "../src/modules/sync/service.js";
import { useSyncSources } from "../src/modules/sync/sources.js";
import { syncMode } from "../src/modules/sync/switch.js";
import { freshDatabase, hasDatabase } from "./helpers.js";
import { assertNoContent, CAMPUS, count, EMAIL, familyRow, issues, NAME, person, recipe, stateOf, STORY, versions, World } from "./syncHelpers.js";

test("the sync's passes", { skip: !hasDatabase }, async (t) => {
  t.beforeEach(freshDatabase);

  await t.test("first sync: merged rows, with Convex's ids and Supabase's half", async () => {
    const w = new World();
    const f = w.family("The Madeups", { publicName: "the Madeup family" });
    const cook = w.person(f, {
      language: "mr",
      relation: "Aaji",
      approx: { lat: 19.0761, lng: 72.8777 },
      campus: CAMPUS,
      voiceClone: { consentedAt: Date.UTC(2026, 8, 1), cartesiaVoiceId: "voice-1" } as { consentedAt: number }, // an id reaching here still isn't copied
      supabase: { name: NAME, email: EMAIL, tz: "Asia/Kolkata", share_cooking: true, relation: "ignored", avatar_key: "egg", sort: 2, memorial: false },
    });
    const kid = w.person(f, { role: "kid", supabase: { relation: "Beta", removed_at: "2026-09-02T00:00:00Z" } });
    const r = w.recipe(cook, {
      coverUrl: "https://storage.googleapis.com/edible-media-prod/fam/rec/poster.jpg?v=123",
      recipeJsonUrl: "https://storage.googleapis.com/edible-media-prod/fam/rec/recipe.json?v=456",
      memories: [{ kind: "story", text: STORY, moment: { startS: 0, endS: 1 } }],
      memoriesOptIn: true,
      storyCard: { text: "A card", writtenAt: Date.UTC(2026, 8, 3), culture: "Maharashtrian" },
      sharedAt: Date.UTC(2026, 8, 4),
      language: "mr",
    });
    const stock = w.recipe(cook, { coverUrl: "https://homecookd.app/media/stock/dal.jpg", libraryId: "dal-1" });

    const result = await w.syncAll();
    assert.deepEqual(result.stats, { inserted: 5, updated: 0, unchanged: 0, held: 0, refused: 0, deleted: 0 });
    assert.equal(await count("families"), 1);
    assert.equal(await count("people"), 2);
    assert.equal(await count("recipes"), 2);

    const family = await familyRow(f._id);
    assert.equal(family.supabase_id, f.supabaseFamilyId);
    assert.equal(family.name, "The Madeups", "Supabase's name wins over Convex's stale copy");
    assert.equal(family.public_name, "the Madeup family");
    assert.equal(family.code_hash, null, "codes wait for the accounts backfill");
    assert.equal(family.code_enc, null);
    assert.equal(family.created_at.getTime(), Math.trunc(f._creationTime));

    const p = await person(cook._id);
    assert.equal(p.family_id, f._id);
    assert.equal(p.supabase_id, cook.supabaseProfileId, "the old uuid stays, because phones still send it");
    assert.equal(p.name, NAME);
    assert.equal(p.email, EMAIL);
    assert.equal(p.tz, "Asia/Kolkata");
    assert.equal(p.share_cooking, true);
    assert.equal(p.avatar_key, "egg");
    assert.equal(p.sort, 2);
    assert.equal(p.language, "mr");
    assert.equal(p.relation, "Aaji", "Convex's relation first");
    assert.equal(p.voice_clone_consented_at.getTime(), Date.UTC(2026, 8, 1), "her yes is copied");
    assert.equal(p.cartesia_voice_id, null, "the voice's id isn't");
    assert.equal(p.approx_lat, "19.08", "rounded to the 1 km grid by the column");
    assert.equal(p.approx_lng, "72.88");
    assert.equal(p.campus, CAMPUS);
    assert.equal(p.deleted_at, null);

    const k = await person(kid._id);
    assert.equal(k.role, "kid", "learner becomes kid");
    assert.equal(k.relation, "Beta", "Supabase's relation when Convex has none");
    assert.ok(k.removed_at, "left the family is its own fact");

    const row = await recipe(r._id);
    assert.equal(row.family_id, f._id);
    assert.equal(row.cook_id, cook._id);
    assert.equal(row.cover_key, "fam/rec/poster.jpg");
    assert.equal(row.cover_version, "123");
    assert.equal(row.recipe_json_key, "fam/rec/recipe.json");
    assert.equal(row.cover_stock_path, null);
    assert.equal(row.media_prefix, null);
    assert.equal(row.step_count, 1);
    assert.equal(row.memories[0].text, STORY);
    assert.equal(row.story_card_text, "A card");
    assert.equal(row.story_card_culture, "Maharashtrian");
    assert.ok(row.shared_at);
    const stockRow = await recipe(stock._id);
    assert.equal(stockRow.cover_stock_path, "stock/dal.jpg");
    assert.equal(stockRow.cover_key, null);
    assert.equal(stockRow.library_id, "dal-1");

    assertNoContent(w.report.text());
    const { rows } = await db().query("select table_name, read_only from sync_copies order by 1");
    assert.deepEqual(rows.map((row2) => row2.read_only), [true, true, true], "a real run makes the copies read-only");
  });

  await t.test("a pass waits until the deletions run has worked, so nobody deleted is ever copied first", async () => {
    const w = new World();
    const f = w.family();
    const p = w.person(f, { supabase: { name: NAME } });
    assert.equal((await runPass(w.run())).state, "waiting_for_deletions");
    assert.equal(await count("people"), 0);
    await runDeletions(w.run());
    await w.passAll();
    assert.equal((await person(p._id)).name, NAME);
  });

  await t.test("running again changes nothing, down to each row's version", async () => {
    const w = new World();
    const f = w.family("A family", { publicName: "the family" });
    const cook = w.person(f, { approx: { lat: 42.3601, lng: -71.0942 }, language: "en", supabase: { email: EMAIL } });
    w.person(f, { role: "kid" });
    w.recipe(cook, { coverUrl: "https://storage.googleapis.com/edible-media-prod/a%20b/poster.jpg?v=9", storyCard: { text: "x", writtenAt: 1 } });
    await w.syncAll();
    const before = [await versions("families"), await versions("people"), await versions("recipes")];
    const second = await w.syncAll();
    assert.deepEqual(second.stats, { inserted: 0, updated: 0, unchanged: 4, held: 0, refused: 0, deleted: 0 });
    assert.deepEqual([await versions("families"), await versions("people"), await versions("recipes")], before);
  });

  await t.test("resumes where it stopped after a crash, reading nothing twice", async () => {
    const w = new World();
    const f = w.family();
    for (let i = 0; i < 7; i += 1) w.person(f, { role: "kid" });
    w.convex.pageSize = 2;
    await runDeletions(w.run());

    w.convex.failOnCall = 4; // families, then people's pages at offset 0, 2, and this one fails
    await assert.rejects(runPass(w.run()), { name: "ConvexReadFailed" });
    const state = await stateOf("pass");
    assert.equal(state.at_table, "people");
    assert.equal(state.page_cursor, "4");
    assert.equal(state.lease_id, null, "a run that failed lets go");
    assert.equal(await count("people"), 4);

    w.convex.pageCalls = [];
    const result = await w.passAll();
    assert.deepEqual(w.convex.pageCalls[0], { table: "people", cursor: "4" }, "it carries on, it doesn't start over");
    assert.equal(result.stats.inserted, 3);
    assert.equal(await count("people"), 7);
    assert.equal((await stateOf("pass")).pass_no, "1", "still the same pass");
  });

  await t.test("dying halfway through a page repeats that page and changes nothing that landed", async () => {
    const w = new World();
    const f = w.family();
    const landed = w.person(f, { role: "kid" });
    const stops = w.person(f, { role: "kid" });
    w.person(f, { role: "kid" });
    await runDeletions(w.run());
    await db().query(`create function sync_test_die() returns trigger language plpgsql as $$
      begin
        if new.id = '${stops._id}' then raise exception 'the task died' using errcode = '57P01'; end if;
        return new;
      end $$`);
    await db().query(`create trigger sync_test_die before insert on people for each row execute function sync_test_die()`);
    await assert.rejects(runPass(w.run()), { code: "57P01" });
    assert.ok(await person(landed._id));
    assert.equal(await count("people"), 1);
    const state = await stateOf("pass");
    assert.equal(state.at_table, "people");
    assert.equal(state.page_cursor, null, "the place is still the start of that page");
    const version = (await versions("people"))[0];

    await db().query(`drop trigger sync_test_die on people`);
    const result = await w.passAll();
    assert.deepEqual(result.stats, { inserted: 2, updated: 0, unchanged: 1, held: 0, refused: 0, deleted: 0 });
    assert.ok((await versions("people")).includes(version), "the row that landed wasn't written again");
  });

  await t.test("a task that dies leaves a lease that expires; a live one keeps others out", async () => {
    const w = new World();
    w.family();
    await runDeletions(w.run());
    await db().query("update sync_state set lease_id = 'someone-else', lease_until = now() + interval '1 minute' where name = 'pass'");
    assert.equal((await runPass(w.run())).state, "busy");
    await db().query("update sync_state set lease_until = now() - interval '1 second' where name = 'pass'");
    assert.equal((await runPass(w.run())).state, "finished");
  });

  await t.test("a page stops at the budget, and the next message goes on from there", async () => {
    const w = new World();
    const f = w.family();
    for (let i = 0; i < 4; i += 1) w.person(f, { role: "kid" });
    w.convex.pageSize = 1;
    await runDeletions(w.run());
    assert.equal((await runPass(w.run({ budgetMs: 0 }))).state, "running");
    assert.equal(await count("families"), 1);
    assert.equal(await count("people"), 0);
    await w.passAll();
    assert.equal(await count("people"), 4);
  });

  await t.test("a pass doesn't start again until it's due", async () => {
    const w = new World();
    w.family();
    await w.syncAll();
    assert.equal((await runPass(w.run({ passEveryMs: 60_000 }))).state, "idle");
    assert.equal((await stateOf("pass")).pass_no, "1");
  });

  await t.test("a cursor Convex no longer knows starts that table again, safely", async () => {
    const w = new World();
    const f = w.family();
    for (let i = 0; i < 3; i += 1) w.person(f, { role: "kid" });
    await runDeletions(w.run());
    w.convex.pageSize = 2;
    await runPass(w.run({ budgetMs: 0 })); // families' page: now at people
    await runPass(w.run({ budgetMs: 0 })); // people's first page: a saved cursor
    assert.equal((await stateOf("pass")).page_cursor, "2");
    const real = w.convex.page.bind(w.convex);
    let refused = false;
    w.convex.page = (async (table: never, cursor: string | null, limit: number) => {
      if (cursor === "2" && !refused) {
        refused = true;
        const { CursorExpired } = await import("../src/modules/sync/sources.js");
        throw new CursorExpired("bad cursor");
      }
      return real(table, cursor, limit);
    }) as typeof w.convex.page;
    await w.passAll();
    assert.ok(refused);
    assert.equal(await count("people"), 3);
  });

  await t.test("an edit in either store lands, and only that row is written", async () => {
    const w = new World();
    const f = w.family("Before");
    const cook = w.person(f, { language: "en", supabase: { name: "Old name" } });
    const other = w.person(f, { role: "kid" });
    const r = w.recipe(cook, { title: "Old title" });
    await w.syncAll();
    const otherVersion = (await db().query("select xmin::text as v from people where id = $1", [other._id])).rows[0].v;

    w.supabase.profileRows.get(cook.supabaseProfileId)!.name = "New name";
    w.supabase.familyRows.get(f.supabaseFamilyId)!.name = "After";
    w.convex.people.find((p) => p._id === cook._id)!.language = "hi";
    w.convex.recipes.find((x) => x._id === r._id)!.title = "New title";
    const result = await w.syncAll();

    assert.deepEqual(result.stats, { inserted: 0, updated: 3, unchanged: 1, held: 0, refused: 0, deleted: 0 });
    assert.equal((await person(cook._id)).name, "New name");
    assert.equal((await person(cook._id)).language, "hi");
    assert.equal((await familyRow(f._id)).name, "After");
    assert.equal((await recipe(r._id)).title, "New title");
    assert.equal((await db().query("select xmin::text as v from people where id = $1", [other._id])).rows[0].v, otherVersion);
  });

  await t.test("a Supabase outage stops the page rather than copying half a person", async () => {
    const w = new World();
    const f = w.family();
    const p = w.person(f, { supabase: { name: NAME, email: EMAIL } });
    await runDeletions(w.run());
    await runPass(w.run({ budgetMs: 0 })); // families landed
    w.supabase.down = true;
    await assert.rejects(runPass(w.run()), { name: "SupabaseReadFailed" });
    assert.equal(await person(p._id), undefined, "no row with Convex's half only");
    w.supabase.down = false;
    await w.passAll();
    assert.equal((await person(p._id)).name, NAME);
  });

  await t.test("a person moved between families moves, with their recipes, and their old session stops working", async () => {
    const w = new World();
    const a = w.family("Family A");
    const b = w.family("Family B");
    const face = w.person(a, { role: "kid" });
    const stays = w.person(a);
    const r = w.recipe(face);
    await w.syncAll();
    const { session, bearer } = await import("./helpers.js");
    const token = await session(a._id, face._id);
    const app = buildApp({ logger: false });
    assert.equal((await app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode, 200);

    w.convex.people.find((p) => p._id === face._id)!.familyId = b._id;
    w.supabase.profileRows.get(face.supabaseProfileId)!.family_id = b.supabaseFamilyId;
    const moved = w.convex.recipes.find((x) => x._id === r._id)!;
    moved.familyId = b._id;
    await w.syncAll();

    assert.equal((await person(face._id)).family_id, b._id);
    assert.equal((await person(stays._id)).family_id, a._id);
    assert.equal((await recipe(r._id)).family_id, b._id);
    assert.equal((await app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode, 401, "a session for the old family is refused");
    await app.close();
  });

  await t.test("when the two stores disagree about a person's family, Supabase wins; with no copy of its answer, Convex's stays", async () => {
    const w = new World();
    const a = w.family("Family A");
    const b = w.family("Family B");
    const p = w.person(a, { supabase: { family_id: b.supabaseFamilyId } });
    const unknown = w.person(a, { supabase: { family_id: "99999999-aaaa-4bbb-8ccc-999999999999" } });
    await w.syncAll();
    assert.equal((await person(p._id)).family_id, b._id);
    assert.equal((await person(unknown._id)).family_id, a._id);
  });

  await t.test("duplicates: the second row is held by id, never merged, and the rest of the batch lands", async () => {
    const w = new World();
    const f = w.family();
    const first = w.person(f, { supabase: { name: NAME } });
    const second = w.person(f, { supabaseProfileId: first.supabaseProfileId, supabase: false });
    const after = w.person(f, { role: "kid" });
    const r = w.recipe(second);
    const fine = w.recipe(first);
    const result = await w.syncAll();

    assert.equal(result.stats.held, 2);
    assert.ok(await person(first._id));
    assert.equal(await person(second._id), undefined);
    assert.ok(await person(after._id), "the batch went on");
    assert.equal(await recipe(r._id), undefined, "its recipe has no cook here, so it waits too");
    assert.ok(await recipe(fine._id));
    assert.deepEqual(await issues(), [
      { table_name: "people", row_id: second._id, rule: "people_supabase_id_key" },
      { table_name: "recipes", row_id: r._id, rule: "recipes_cook_id_fkey" },
    ]);
    assertNoContent(w.report.text());
  });

  await t.test("a row breaking a rule fails by id, in the open, and lands once it's fixed", async () => {
    const w = new World();
    const f = w.family();
    const clean = w.person(f, { role: "kid" });
    const badLanguage = w.person(f, { language: "NOT A CODE", campus: CAMPUS, supabase: { name: NAME, email: EMAIL } });
    const sameName = w.person(f, { supabase: { name: (w.supabase.profileRows.get(clean.supabaseProfileId) as { name: string }).name.toUpperCase() } });
    const after = w.person(f, { role: "kid" });
    const badUrl = w.recipe(clean, { coverUrl: "https://example.test/madeup/poster.jpg" });
    const badKey = w.recipe(clean, { coverUrl: "https://storage.googleapis.com/edible-media/..%2Fescape.jpg" });
    const badStatus = w.recipe(clean, { status: "madeup-status", title: STORY });
    const fine = w.recipe(clean);
    const result = await w.syncAll();

    assert.equal(result.stats.held, 5);
    assert.ok(await person(after._id), "later rows still land");
    assert.ok(await recipe(fine._id));
    const found = await issues();
    assert.deepEqual(found, [
      { table_name: "people", row_id: badLanguage._id, rule: "lang_code_check" },
      { table_name: "people", row_id: sameName._id, rule: "people_family_name_unique" },
      { table_name: "recipes", row_id: badKey._id, rule: "s3_key_check" },
      { table_name: "recipes", row_id: badStatus._id, rule: "recipes_status_check" },
      { table_name: "recipes", row_id: badUrl._id, rule: "recipe_url_unknown" },
    ].sort((x, y) => (x.table_name + x.row_id + x.rule).localeCompare(y.table_name + y.row_id + y.rule)));
    const text = w.report.text();
    assert.ok(text.includes(badLanguage._id), "the row is named by id");
    assert.ok(text.includes("lang_code_check"), "with the rule it broke");
    assertNoContent(text);

    w.convex.people.find((p) => p._id === badLanguage._id)!.language = "mr";
    await w.syncAll();
    assert.equal((await person(badLanguage._id)).language, "mr");
    assert.equal((await issues()).some((i) => i.row_id === badLanguage._id), false, "a row that lands clears its issue");
    const seen = (await db().query("select times from sync_issues where row_id = $1", [badUrl._id])).rows[0];
    assert.equal(seen.times, 2, "a repeat counts, it doesn't pile up");
  });

  await t.test("a failure that isn't the row's stops the batch and loses no place", async () => {
    const w = new World();
    const f = w.family();
    w.person(f);
    await runDeletions(w.run());
    await runPass(w.run({ budgetMs: 0 }));
    await db().query(`create function sync_test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = '57014'; end $$`);
    await db().query(`create trigger sync_test_boom before insert on people for each row execute function sync_test_boom()`);
    await assert.rejects(runPass(w.run()), { code: "57014" });
    assert.equal((await stateOf("pass")).at_table, "people");
    assert.deepEqual(await issues(), [], "not blamed on the row");
    await db().query(`drop trigger sync_test_boom on people`);
    await w.passAll();
    assert.equal(await count("people"), 1);
  });

  await t.test("a recipe gone from Convex goes after a whole pass, and only then", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    const gone = w.recipe(cook);
    const stays = w.recipe(cook);
    await w.syncAll();

    w.convex.recipes = w.convex.recipes.filter((r) => r._id !== gone._id);
    w.convex.pageSize = 1;
    w.convex.failOnCall = 3; // families, people, then recipes
    await assert.rejects(runPass(w.run()), { name: "ConvexReadFailed" });
    assert.ok(await recipe(gone._id), "a walk that didn't finish removes nothing");
    w.convex.pageSize = 100;

    const result = await w.passAll();
    assert.equal(result.stats.deleted, 1);
    assert.equal(await recipe(gone._id), undefined);
    assert.ok(await recipe(stays._id));
  });

  await t.test("a recipe the sync never landed is never swept", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    w.recipe(cook);
    await w.syncAll();
    await db().query("update sync_copies set read_only = false");
    const { rows } = await db().query("insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'From the queue worker', 'ready') returning id", [f._id, cook._id]);
    await db().query("update sync_copies set read_only = true");
    await w.passAll();
    assert.ok(await recipe(rows[0].id));
  });

  await t.test("if most recipes look gone it's a bad read: nothing is swept, and someone hears", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    for (let i = 0; i < 30; i += 1) w.recipe(cook);
    await w.syncAll();
    w.convex.recipes = [];
    await w.passAll();
    assert.equal(await count("recipes"), 30);
    assert.deepEqual(w.report.alerts.map((a) => a.name), ["SyncSweepTooLarge"]);
  });

  await t.test("a recipe gone at the source but still referenced keeps its row and loses its contents", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    const r = w.recipe(cook, { memories: [{ kind: "story", text: STORY }], title: STORY, sharedAt: 1 });
    await w.syncAll();
    await db().query("insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'a question', 'asked_cook')", [f._id, r._id, cook._id]);
    w.convex.recipes = [];
    await w.passAll();
    const row = await recipe(r._id);
    assert.equal(row.title, "Deleted");
    assert.deepEqual(row.memories, []);
    assert.equal(row.shared_at, null);
    assert.deepEqual(await issues(), [{ table_name: "recipes", row_id: r._id, rule: "recipe_blanked_still_referenced" }]);
  });

  await t.test("a table whose area moved is left alone, and the api may write it", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    const r = w.recipe(cook, { title: "Copied" });
    await w.syncAll();
    await db().query("update sync_copies set moved_at = now() where table_name = 'recipes'");
    await db().query("update recipes set title = 'Written by the new area' where id = $1", [r._id]);
    w.convex.recipes.find((x) => x._id === r._id)!.title = "Convex's later edit";
    w.convex.pageCalls = [];
    await w.passAll();
    assert.equal((await recipe(r._id)).title, "Written by the new area");
    assert.ok(!w.convex.pageCalls.some((call) => call.table === "recipes"));
  });

  await t.test("the Supabase-only row is not copied", async () => {
    const w = new World();
    const f = w.family();
    w.person(f);
    w.supabase.profileRows.set("77777777-aaaa-4bbb-8ccc-777777777777", {
      id: "77777777-aaaa-4bbb-8ccc-777777777777",
      family_id: f.supabaseFamilyId,
      name: NAME,
      role: "cook",
      relation: null,
      avatar_key: null,
      sort: 0,
      email: EMAIL,
      tz: null,
      share_cooking: null,
      memorial: false,
      removed_at: null,
    });
    await w.syncAll();
    assert.equal(await count("people"), 1);
  });

  await t.test("a seed row, Convex-only, is copied as it is", async () => {
    const w = new World();
    const f = w.family("A seed family", { supabase: false });
    const p = w.person(f, { supabaseProfileId: "seed:abc", supabase: false });
    await w.syncAll();
    assert.equal((await person(p._id)).supabase_id, "seed:abc");
    assert.equal((await person(p._id)).name, p.name);
    assert.equal((await familyRow(f._id)).name, f.name);
  });
});

test("the switch", async (t) => {
  await t.test("off unless it's spelled exactly", () => {
    assert.equal(syncMode({}), "off");
    for (const value of ["", "true", "1", "ON", "On", "yes", "off", "on "]) assert.equal(syncMode({ SYNC_MODE: value }), "off", value);
    assert.equal(syncMode({ SYNC_MODE: "on" }), "on");
    assert.equal(syncMode({ SYNC_MODE: "deletions" }), "deletions");
  });

  await t.test("the code at the switch says why it stays off", () => {
    const source = readFileSync(new URL("../src/modules/sync/switch.ts", import.meta.url), "utf8");
    assert.match(source, /KEEP THIS OFF until \/privacy lists AWS/);
  });

  await t.test("off: reads nothing, writes nothing, needs no secret", { skip: !hasDatabase }, async () => {
    await freshDatabase();
    assert.equal(process.env.SYNC_MODE, undefined);
    assert.equal(process.env.CONVEX_SITE_URL, undefined);
    const lines: string[] = [];
    const log = { info: (_: object, m: string) => void lines.push(m), warn: () => {}, error: (_: object, m: string) => void lines.push(m) };
    for (const task of ["sync.deletions", "sync.pass", "sync.reconcile"]) {
      await handleMessage(JSON.stringify({ payload: { task } }), log);
    }
    assert.equal(await count("sync_deleted"), 0);
    assert.equal(await count("families"), 0);
    const { rows } = await db().query("select bool_or(read_only) as any from sync_copies");
    assert.equal(rows[0].any, false, "the copies aren't locked either, until a real run");
    assert.deepEqual(lines, []);
  });

  await t.test("a pause keeps deletions flowing and copies nothing new", { skip: !hasDatabase }, async () => {
    await freshDatabase();
    const w = new World();
    const f = w.family();
    const p = w.person(f);
    useSyncSources({ convex: w.convex, supabase: w.supabase });
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    process.env.SYNC_MODE = "deletions";
    try {
      w.deleteAtSource(p);
      await handleMessage(JSON.stringify({ payload: { task: "sync.pass" } }), log);
      await handleMessage(JSON.stringify({ payload: { task: "sync.reconcile" } }), log);
      assert.equal(w.convex.pageCalls.length, 0);
      await handleMessage(JSON.stringify({ payload: { task: "sync.deletions" } }), log);
      assert.equal(w.convex.deletionCalls, 1);
      assert.equal(await count("sync_deleted"), 1);
      assert.equal(await count("families"), 0);
    } finally {
      delete process.env.SYNC_MODE;
      useSyncSources(undefined);
    }
  });

  await t.test("on with no secrets fails by the setting's name, with no value", { skip: !hasDatabase }, async () => {
    process.env.SYNC_MODE = "on";
    try {
      const log = { info: () => {}, warn: () => {}, error: () => {} };
      await assert.rejects(handleMessage(JSON.stringify({ payload: { task: "sync.deletions" } }), log), /The sync needs CONVEX_SITE_URL/);
    } finally {
      delete process.env.SYNC_MODE;
    }
  });

  await t.test("off after real copies exist is an alarm: deletions have stopped reaching them", { skip: !hasDatabase }, async () => {
    await freshDatabase();
    await db().query("update sync_state set last_success_at = now() where name = 'deletions'");
    const lines: string[] = [];
    const log = { info: () => {}, warn: () => {}, error: (_: object, m: string) => void lines.push(m) };
    await handleMessage(JSON.stringify({ payload: { task: "sync.deletions" } }), log);
    assert.deepEqual(lines, ["the sync is off but copies exist, so deletions aren't reaching them"]);
    await handleMessage(JSON.stringify({ payload: { task: "sync.deletions" } }), log);
    assert.equal(lines.length, 1, "at most once an hour");
  });
});

test("a copied table is read-only to everything but the sync", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const w = new World();
  const f = w.family();
  const cook = w.person(f, { supabase: { name: NAME } });
  const r = w.recipe(cook);
  await w.syncAll();

  const app = buildApp({
    logger: false,
    routes: (a) => {
      a.post("/test-write", { schema: { body: { type: "object", properties: { sql: { type: "string" } } } } }, async (req) => {
        await db().query((req.body as { sql: string }).sql);
        return { ok: true };
      });
    },
  });

  await t.test("a route that tries gets a 500, and the row doesn't change", async () => {
    for (const sql of [
      `update people set name = 'Changed' where id = '${cook._id}'`,
      `update families set name = 'Changed' where id = '${f._id}'`,
      `update recipes set title = 'Changed' where id = '${r._id}'`,
      `delete from people where id = '${cook._id}'`,
      `delete from recipes where id = '${r._id}'`,
      `delete from families where id = '${f._id}'`,
      `insert into families (name) values ('New')`,
      `insert into people (family_id, name, role) values ('${f._id}', 'New', 'kid')`,
      `insert into recipes (family_id, cook_id, title, status) values ('${f._id}', '${cook._id}', 'New', 'ready')`,
      `truncate recipes cascade`,
      `truncate people cascade`,
    ]) {
      const res = await app.inject({ method: "POST", url: "/test-write", payload: { sql } });
      assert.equal(res.statusCode, 500, sql);
    }
    assert.equal((await person(cook._id)).name, NAME);
    assert.equal(await count("families"), 1);
    assert.equal(await count("people"), 1);
    assert.equal(await count("recipes"), 1);
  });

  await t.test("the refusal has its own code, so it's easy to find", async () => {
    await assert.rejects(db().query(`update people set name = 'Changed' where id = '${cook._id}'`), { code: "HC001" });
  });

  await t.test("nothing in api/src but the sync writes one, or says it's the sync", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
      });
    const sync = join(root, "modules", "sync");
    const writes = /\b(insert\s+into|update|delete\s+from|truncate)\s+(families|people|recipes)\b/i;
    const others = files(root).filter((path) => !path.startsWith(sync));
    assert.ok(others.length > 10);
    for (const path of others) {
      const source = readFileSync(path, "utf8");
      assert.ok(!writes.test(source), `${path} writes a copied table`);
      assert.ok(!source.includes("homecookd.sync_writer"), `${path} says it's the sync`);
    }
  });

  await t.test("the sync still can", async () => {
    w.supabase.profileRows.get(cook.supabaseProfileId)!.name = "New name";
    await w.syncAll();
    assert.equal((await person(cook._id)).name, "New name");
  });

  await app.close();
});

test("the cover pattern is Convex's", { skip: !existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex", "community.ts")) }, () => {
  const community = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex", "community.ts"), "utf8");
  const merge = readFileSync(new URL("../src/modules/sync/merge.ts", import.meta.url), "utf8");
  assert.ok(community.includes(String.raw`/^https:\/\/homecookd\.app\/media\/(stock|app-covers)\/[\w.-]+\.(jpg|jpeg|png|webp)$/`));
  assert.ok(merge.includes(String.raw`/^https:\/\/homecookd\.app\/media\/((?:stock|app-covers)\/[\w.-]+\.(?:jpg|jpeg|png|webp))$/`));
});

after(async () => {
  if (hasDatabase) await db().end();
});

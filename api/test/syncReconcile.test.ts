// The reconcile finds each kind of difference, reports it without family content, and writes nothing to a copy. Real Postgres, fakes, made-up rows.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { runReconcile } from "../src/modules/sync/reconcile.js";
import { runDeletions } from "../src/modules/sync/service.js";
import { freshDatabase, hasDatabase } from "./helpers.js";
import { assertNoContent, CAMPUS, EMAIL, NAME, stateOf, STORY, versions, World } from "./syncHelpers.js";

const writeCopy = async (sql: string, params: unknown[]) => {
  const c = await db().connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('homecookd.sync_writer', 'on', true)`);
    await c.query(sql, params);
    await c.query("commit");
  } finally {
    c.release();
  }
};

test("the reconcile", { skip: !hasDatabase }, async (t) => {
  t.beforeEach(freshDatabase);

  await t.test("in step: nothing to report and no alert", async () => {
    const w = new World();
    const f = w.family("A family", { publicName: "the family" });
    const cook = w.person(f, { language: "mr", approx: { lat: 19.0761, lng: 72.8777 }, supabase: { name: NAME, email: EMAIL } });
    w.person(f, { role: "kid", voiceClone: { consentedAt: 1000.5 } });
    w.recipe(cook, { storyCard: { text: STORY, writtenAt: 2000 }, memories: [{ kind: "story", text: STORY }], coverUrl: "https://storage.googleapis.com/edible-media-prod/a/b.jpg?v=3" });
    await w.syncAll();
    const report = await runReconcile(w.run());
    assert.deepEqual(report?.counts, {}, "the rounded place and times compare equal");
    assert.deepEqual(w.report.alerts, []);
    assert.equal(report?.incomplete, false);
  });

  await t.test("finds each kind of difference, by count and id, and writes nothing to a copy", async () => {
    const w = new World();
    const f = w.family("Family one");
    const f2 = w.family("Family two");
    const editedFamily = w.family("Before");
    const a = w.person(f, { supabase: { name: NAME, email: EMAIL } });
    const edited = w.person(f, { role: "kid" });
    const toDelete = w.person(f, { role: "kid", campus: CAMPUS });
    const tombstoned = w.person(f, { role: "kid" });
    const recipeEdited = w.recipe(a, { title: "Before" });
    const recipeHeld = w.recipe(a, { coverUrl: "https://example.test/nope.jpg", title: STORY });
    w.deleteAtSource(tombstoned);
    await w.syncAll();
    assert.deepEqual((await db().query("select row_id from sync_issues")).rows, [{ row_id: recipeHeld._id }]);

    // After the sync, the sources move on.
    w.convex.people.find((p) => p._id === edited._id)!.campus = CAMPUS; // differs
    w.supabase.familyRows.get(editedFamily.supabaseFamilyId)!.name = "After"; // differs
    w.convex.recipes.find((r) => r._id === recipeEdited._id)!.title = "After"; // differs
    const newPerson = w.person(f, { role: "kid" }); // missing_in_copy
    const newFamily = w.family("New family"); // missing_in_copy
    const newRecipe = w.recipe(a); // missing_in_copy
    const badLanguage = w.person(f, { language: "NOT A CODE", role: "kid" }); // not_copyable
    const refused = w.person(f, { role: "kid" }); // refused_deleted
    await db().query(`insert into sync_deleted (kind, id, deleted_at) values ('person', $1, now())`, [refused._id]);
    const dupe = w.person(f, { role: "kid", supabaseProfileId: a.supabaseProfileId, supabase: false }); // duplicate_supabase_id
    const disagrees = w.person(f, { role: "kid", supabase: { family_id: f2.supabaseFamilyId } }); // family_disagreement
    const unmapped = w.person(f, { role: "kid", supabase: { family_id: "99999999-aaaa-4bbb-8ccc-999999999999" } }); // family_unmapped
    const noProfile = w.person(f, { role: "kid", supabase: false }); // no_supabase_row
    const seed = w.person(f, { role: "kid", supabaseProfileId: "seed:madeup-slug", supabase: false }); // seed
    const onlyProfile = "77777777-aaaa-4bbb-8ccc-777777777777"; // supabase_only
    w.supabase.profileRows.set(onlyProfile, { ...w.supabase.profileRows.get(a.supabaseProfileId)!, id: onlyProfile, name: NAME, email: EMAIL });
    const onlyFamily = "88888888-aaaa-4bbb-8ccc-888888888888";
    w.supabase.familyRows.set(onlyFamily, { id: onlyFamily, name: NAME });
    await writeCopy(`insert into people (id, family_id, name, role) values ('ghost_person', $1, 'A ghost', 'kid')`, [f._id]); // extra_in_copy
    await writeCopy(`insert into recipes (id, family_id, cook_id, title, status) values ('ghost_recipe', $1, $2, 'A ghost', 'ready')`, [f._id, a._id]);
    await writeCopy(`insert into families (id, name) values ('ghost_family', 'A ghost')`, []);
    w.deleteAtSource(toDelete); // deletion_not_applied: the source says deleted, and nothing has run yet

    const before = [await versions("families"), await versions("people"), await versions("recipes")];
    const report = await runReconcile(w.run());
    assert.ok(report);
    assert.deepEqual([await versions("families"), await versions("people"), await versions("recipes")], before, "it writes nothing to a copy");

    const { families, people, recipes } = report.counts;
    assert.deepEqual(report.samples.families?.missing_in_copy, [newFamily._id]);
    assert.equal(families?.differs, 1);
    assert.deepEqual(report.samples.families?.extra_in_copy, ["ghost_family"]);
    assert.deepEqual(report.samples.families?.supabase_only, [onlyFamily]);

    assert.ok(report.samples.people?.missing_in_copy?.includes(newPerson._id));
    assert.deepEqual(report.samples.people?.differs?.includes(edited._id), true);
    assert.deepEqual(report.samples.people?.extra_in_copy, ["ghost_person"]);
    assert.deepEqual(report.samples.people?.not_copyable, [badLanguage._id]);
    assert.deepEqual(report.samples.people?.refused_deleted, [refused._id]);
    assert.deepEqual(report.samples.people?.duplicate_supabase_id?.sort(), [a._id, dupe._id].sort());
    assert.deepEqual(report.samples.people?.family_disagreement, [disagrees._id]);
    assert.deepEqual(report.samples.people?.family_unmapped, [unmapped._id]);
    assert.ok(report.samples.people?.no_supabase_row?.includes(noProfile._id));
    assert.deepEqual(report.samples.people?.seed, [seed._id]);
    assert.deepEqual(report.samples.people?.supabase_only, [onlyProfile]);
    assert.deepEqual(report.samples.people?.tombstone, [tombstoned._id]);
    assert.deepEqual(report.samples.people?.deletion_not_applied, [toDelete._id], "counted once, by both its row and the deletion");
    assert.equal(people?.deletion_not_applied, 1);

    assert.deepEqual(report.samples.recipes?.missing_in_copy, [newRecipe._id]);
    assert.equal(recipes?.differs, 1);
    assert.deepEqual(report.samples.recipes?.extra_in_copy, ["ghost_recipe"]);
    assert.deepEqual(report.samples.recipes?.not_copyable, [recipeHeld._id]);
    assert.deepEqual(report.held, [{ table_name: "recipes", rule: "recipe_url_unknown", n: 1 }]);

    assert.equal(w.report.alerts.length, 1);
    const alert = w.report.alerts[0];
    assert.equal(alert.name, "SyncReconcileFoundDifferences");
    assert.equal(alert.tags?.people_deletion_not_applied, "1");
    assert.equal(alert.tags?.held, "1");
    assert.equal(alert.tags?.people_family_disagreement, undefined, "known and decided: counted, not paged");

    const stored = JSON.stringify((await stateOf("reconcile")).last_report);
    assertNoContent(stored);
    assertNoContent(JSON.stringify(report));
    assertNoContent(w.report.text());
    assert.deepEqual(JSON.parse(stored).counts, JSON.parse(JSON.stringify(report.counts)));

    // Once the deletion runs, that kind clears.
    await runDeletions(w.run());
    const again = await runReconcile(w.run());
    assert.equal(again?.counts.people?.deletion_not_applied, undefined);
  });

  await t.test("a deletion that stopped holding is found, even long after the feed passed it", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    const r = w.recipe(cook);
    const gone = w.deleteAtSource(cook);
    await w.syncAll();
    assert.deepEqual((await runReconcile(w.run()))?.counts.people, { tombstone: 1 });

    await db().query("delete from sync_deleted where id = $1", [gone.personId]);
    let report = await runReconcile(w.run());
    assert.deepEqual(report?.samples.people?.deletion_not_applied, [cook._id]);
    await db().query(`insert into sync_deleted (kind, id, deleted_at) values ('person', $1, now())`, [gone.personId]);

    // Only by switching the database's own guard off can a deleted cook's recipe come back. The reconcile still sees it.
    await writeCopy(`alter table recipes disable trigger sync_2_stays_deleted`, []);
    await writeCopy(`insert into recipes (id, family_id, cook_id, title, status) values ($1, $2, $3, 'Came back', 'ready')`, [r._id, f._id, cook._id]);
    await writeCopy(`alter table recipes enable trigger sync_2_stays_deleted`, []);
    report = await runReconcile(w.run());
    assert.deepEqual(report?.samples.people?.deletion_not_applied, [cook._id]);
  });

  await t.test("out of time: says so, and doesn't call anything extra on half a walk", async () => {
    const w = new World();
    const f = w.family();
    w.person(f);
    await w.syncAll();
    const report = await runReconcile(w.run({ budgetMs: 0 }));
    assert.equal(report?.incomplete, true);
    assert.deepEqual(report?.counts, {});
    assert.equal(w.report.alerts[0].tags?.incomplete, "true");
  });

  await t.test("a small lag isn't an alert; a big one is", async () => {
    const w = new World();
    const f = w.family();
    await w.syncAll();
    for (let i = 0; i < 5; i += 1) w.person(f, { role: "kid" });
    await runReconcile(w.run());
    assert.equal(w.report.alerts.length, 0);
    w.person(f, { role: "kid" });
    await runReconcile(w.run());
    assert.equal(w.report.alerts[0].tags?.people_missing_in_copy, "6");
  });

  await t.test("another reconcile running means this one leaves, and a failed source fails the message", async () => {
    const w = new World();
    w.family();
    await w.syncAll();
    await db().query(`update sync_state set lease_id = 'other', lease_until = now() + interval '1 minute' where name = 'reconcile'`);
    assert.equal(await runReconcile(w.run()), null);
    await db().query(`update sync_state set lease_id = null, lease_until = null where name = 'reconcile'`);
    w.supabase.down = true;
    await assert.rejects(runReconcile(w.run()), { name: "SupabaseReadFailed" });
    assert.equal((await stateOf("reconcile")).lease_id, null);
  });

  await t.test("a table whose area moved isn't compared", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f);
    const r = w.recipe(cook, { title: "Copied" });
    await w.syncAll();
    await db().query("update sync_copies set moved_at = now() where table_name = 'recipes'");
    await db().query("update recipes set title = 'New owner' where id = $1", [r._id]);
    const report = await runReconcile(w.run());
    assert.equal(report?.counts.recipes, undefined);
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

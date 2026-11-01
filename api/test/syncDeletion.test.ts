// M1's hardest condition: an account deletion reaches the copy within minutes, ends access at once, and no stale row can ever bring the person back,
// in either order, or at the same moment. Real Postgres, fakes for Convex and Supabase, made-up rows.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { findSession } from "../src/auth.js";
import { db } from "../src/db.js";
import { handleMessage } from "../src/scheduled.js";
import { applyDeletion, upsertRow } from "../src/modules/sync/data.js";
import { mergePerson } from "../src/modules/sync/merge.js";
import { runDeletions, runPass } from "../src/modules/sync/service.js";
import { bearer, freshDatabase, hasDatabase, session } from "./helpers.js";
import { assertNoContent, CAMPUS, count, EMAIL, familyRow, issues, NAME, person, recipe, stateOf, STORY, World } from "./syncHelpers.js";

function assertBlank(row: Record<string, unknown>) {
  assert.ok(row.deleted_at, "a deletion time");
  assert.equal(row.name, "Deleted");
  for (const column of ["relation", "avatar_key", "email", "tz", "share_cooking", "language", "voice_clone_consented_at", "cartesia_voice_id", "approx_lat", "approx_lng", "campus"]) {
    assert.equal(row[column], null, column);
  }
}

const full = { language: "mr", relation: "Aaji", approx: { lat: 19.07, lng: 72.87 }, campus: CAMPUS, voiceClone: { consentedAt: 1000, cartesiaVoiceId: "voice-1" }, supabase: { name: NAME, email: EMAIL, tz: "Asia/Kolkata" } };

test("deletions reaching the copy", { skip: !hasDatabase }, async (t) => {
  t.beforeEach(freshDatabase);

  await t.test("stale row first, deletion after: the row goes blank, sessions end, and access stops at once", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    const stays = w.person(f, { role: "kid" });
    const r = w.recipe(cook, { title: STORY, memories: [{ kind: "story", text: STORY }] });
    await w.syncAll();
    const token = await session(f._id, cook._id);
    const app = buildApp({ logger: false });
    assert.equal((await app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode, 200);
    await db().query(`insert into devices (id, family_id, person_id, key_hash, via, label) values ('d1', $1, $2, $3, 'apple', 'Her phone')`, [f._id, cook._id, "a".repeat(64)]);
    await db().query(`insert into identities (provider, subject, person_id, email) values ('apple', 'subject-1', $1, $2)`, [cook._id, EMAIL]);
    await db().query(`insert into push_tokens (token, family_id, person_id, platform) values ('ExpoPushToken[x]', $1, $2, 'ios')`, [f._id, cook._id]);

    w.deleteAtSource(cook);
    assert.deepEqual(await runDeletions(w.run()), { ran: true, applied: 1, failed: 0 });

    assertBlank(await person(cook._id));
    assert.equal(await recipe(r._id), undefined, "their recipes go with them");
    assert.equal(await count("sessions"), 0);
    assert.equal(await findSession(token), null);
    assert.equal((await app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode, 401);
    assert.equal(await count("identities"), 0);
    assert.equal(await count("push_tokens"), 0);
    const device = (await db().query("select * from devices where id = 'd1'")).rows[0];
    assert.equal(device.person_id, null);
    assert.equal(device.label, null);
    assert.ok(device.revoked_at);
    assert.ok(await person(stays._id), "nobody else is touched");
    assert.equal((await person(stays._id)).deleted_at, null);
    assertNoContent(w.report.text());
    await app.close();
  });

  await t.test("deletion first, stale row after: the person never appears, from a whole stale page", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    const staleCook = structuredClone(cook);
    const staleRecipe = w.recipe(cook, { title: STORY });
    const staleRecipeCopy = structuredClone(staleRecipe);
    w.deleteAtSource(cook);
    await runDeletions(w.run());
    assert.equal(await person(cook._id), undefined, "nothing to blank yet");
    assert.equal(await count("sync_deleted"), 2, "but it's on record, with their recipe");

    // Convex answers with rows read before the delete.
    w.convex.people = [staleCook];
    w.convex.recipes = [staleRecipeCopy];
    const result = await w.passAll();
    assert.equal(result.stats.refused, 2);
    assert.equal(await person(cook._id), undefined);
    assert.equal(await recipe(staleRecipe._id), undefined);
    assert.deepEqual(await issues(), []);
    assertNoContent(w.report.text());
  });

  await t.test("a copied person, deleted, then a stale row: it stays blank", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    const staleCook = structuredClone(cook);
    w.recipe(cook);
    const staleRecipe = structuredClone(w.convex.recipes[0]);
    await w.syncAll();
    w.deleteAtSource(cook);
    await runDeletions(w.run());
    w.convex.people = [staleCook];
    w.convex.recipes = [staleRecipe];
    const result = await w.passAll();
    assert.equal(result.stats.refused, 2);
    assertBlank(await person(cook._id));
    assert.equal(await recipe(staleRecipe._id), undefined);
  });

  await t.test("the deletion lands while a page is in flight: that page's stale row is refused", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await runDeletions(w.run());
    await runPass(w.run({ budgetMs: 0 })); // families
    w.convex.afterRead = async (table) => {
      if (table === "people") {
        w.convex.afterRead = null;
        await applyDeletion({ personId: cook._id, familyId: f._id, supabaseId: cook.supabaseProfileId, at: new Date(), recipeIds: [] });
      }
    };
    const result = await w.passAll();
    assert.equal(result.stats.refused, 1);
    assert.equal(await person(cook._id), undefined);
  });

  await t.test("at the same moment, write first: the deletion waits, then blanks what the write committed", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await w.syncAll();
    const writer = await db().connect();
    try {
      await writer.query("begin");
      await writer.query(`select set_config('homecookd.sync_writer', 'on', true)`);
      await writer.query(`update people set campus = 'A newer stale place' where id = $1`, [cook._id]);
      let done = false;
      const deletion = applyDeletion({ personId: cook._id, familyId: f._id, supabaseId: cook.supabaseProfileId, at: new Date(), recipeIds: [] }).then((out) => {
        done = true;
        return out;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(done, false, "it waits for the write's transaction");
      await writer.query("commit");
      assert.equal(await deletion, "applied");
    } finally {
      writer.release();
    }
    assertBlank(await person(cook._id));
  });

  await t.test("at the same moment, deletion first: the write waits, then is refused", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await w.syncAll();
    const deleter = await db().connect();
    try {
      await deleter.query("begin");
      await deleter.query(`select pg_advisory_xact_lock(hashtextextended('sync-person:' || $1, 0))`, [cook._id]);
      await deleter.query(`insert into sync_deleted (kind, id, supabase_id, deleted_at) values ('person', $1, $2, now())`, [cook._id, cook.supabaseProfileId]);
      let done = false;
      const write = upsertRow("people", mergePerson(cook, null, f._id)).finally(() => {
        done = true;
      });
      const refused = assert.rejects(write, { code: "HC002" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(done, false, "it waits for the deletion's transaction");
      await deleter.query("commit");
      await refused;
    } finally {
      deleter.release();
    }
    assert.equal((await person(cook._id)).name, NAME, "the blanking itself is the deletion's job, tested above");
  });

  await t.test("the database refuses a return, whoever writes it", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await w.syncAll();
    w.deleteAtSource(cook);
    await runDeletions(w.run());
    await db().query("update sync_copies set read_only = false"); // so this reaches the second lock
    await assert.rejects(db().query("update people set deleted_at = null, name = 'Back' where id = $1", [cook._id]), { code: "HC002" });
    await assert.rejects(
      db().query("insert into people (id, family_id, supabase_id, name, role) values ('another-row', $1, $2, 'Back', 'cook')", [f._id, cook.supabaseProfileId]),
      { code: "HC002" },
    );
    await assert.rejects(
      db().query("insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Back', 'ready')", [f._id, cook._id]),
      { code: "HC002" },
    );
    await assert.rejects(db().query("update people set email = $2 where id = $1", [cook._id, EMAIL]), { code: "23514" }, "and a tombstone holds nothing");
  });

  await t.test("a tombstone in the people walk alone is enough, and Supabase isn't asked about them", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    const other = w.person(f, { role: "kid" });
    const r = w.recipe(cook, { title: STORY });
    await w.syncAll();
    const deletion = w.deleteAtSource(cook);
    w.convex.deletionRows = w.convex.deletionRows.filter((row) => row !== deletion); // the feed missed it
    w.supabase.askedProfiles = [];
    const result = await w.passAll();
    assert.equal(result.stats.deleted, 1);
    assertBlank(await person(cook._id));
    assert.equal(await recipe(r._id), undefined);
    assert.equal(w.supabase.askedProfiles.includes(cook.supabaseProfileId), false);
    assert.ok(w.supabase.profileRows.has(cook.supabaseProfileId), "Supabase still lists them, and it doesn't matter");
    assert.ok(w.supabase.askedProfiles.includes(other.supabaseProfileId));
  });

  await t.test("a tombstone never seen before lands blank; the same tombstone again changes nothing", async () => {
    const w = new World();
    const f = w.family();
    const live = w.person(f, { role: "kid" });
    const cook = w.person(f, full);
    w.deleteAtSource(cook);
    await w.syncAll();
    assertBlank(await person(cook._id));
    assert.ok(await person(live._id));
    const version = (await db().query("select xmin::text as v from people where id = $1", [cook._id])).rows[0].v;
    const second = await w.syncAll();
    assert.equal(second.stats.deleted, 0);
    assert.equal((await db().query("select xmin::text as v from people where id = $1", [cook._id])).rows[0].v, version);
    assert.equal(await count("sync_deleted"), 1);
  });

  await t.test("a deletion arriving twice applies once, and queues one purge", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await w.syncAll();
    w.deleteAtSource(cook);
    assert.equal((await runDeletions(w.run())).applied, 1);
    assert.equal((await runDeletions(w.run())).applied, 0, "read again within the overlap");
    const { rows } = await db().query(`select payload from outbox where payload->>'task' = 'sync.purge_person'`);
    assert.deepEqual(rows.map((row) => row.payload), [{ task: "sync.purge_person", personId: cook._id }], "ids only");
  });

  await t.test("the purge reaches an area that has moved, and it's safe to repeat", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await w.syncAll();
    await db().query(`insert into craving_links (family_id, person_id, token, message) values ($1, $2, 'madeup-token', 'her line')`, [f._id, cook._id]);
    w.deleteAtSource(cook);
    await runDeletions(w.run());
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const message = JSON.stringify({ payload: { task: "sync.purge_person", personId: cook._id } });
    await handleMessage(message, log);
    assert.equal(await count("craving_links"), 0);
    await handleMessage(message, log);
    await assert.rejects(handleMessage(JSON.stringify({ payload: { task: "sync.purge_person" } }), log), /missing personId/);
  });

  await t.test("a recipe named by the deletion goes even with another cook, and can't come back", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    const other = w.person(f);
    const hers = w.recipe(cook);
    const moved = w.recipe(other);
    const stale = structuredClone(moved);
    await w.syncAll();
    w.deleteAtSource(cook, [hers._id, moved._id]);
    w.convex.recipes = [stale];
    await runDeletions(w.run());
    assert.equal(await recipe(hers._id), undefined);
    assert.equal(await recipe(moved._id), undefined);
    const result = await w.passAll();
    assert.equal(result.stats.refused, 1);
    assert.equal(await recipe(moved._id), undefined);
  });

  await t.test("a recipe still referenced keeps its row with nothing in it, so a deletion can't be blocked", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    const kid = w.person(f, { role: "kid" });
    const r = w.recipe(cook, { title: STORY, memories: [{ kind: "story", text: STORY }], coverUrl: "https://storage.googleapis.com/edible-media-prod/a/b.jpg" });
    await w.syncAll();
    await db().query("insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'a question', 'asked_cook')", [f._id, r._id, kid._id]);
    w.deleteAtSource(cook);
    await runDeletions(w.run());
    assertBlank(await person(cook._id));
    const row = await recipe(r._id);
    assert.equal(row.title, "Deleted");
    assert.deepEqual(row.memories, []);
    assert.equal(row.cover_key, null);
    assert.ok((await issues()).some((issue) => issue.rule === "recipe_blanked_still_referenced"));
    assert.equal((await runDeletions(w.run())).applied, 0, "a repeat changes nothing");
  });

  await t.test("the last person deleting blanks the family, and a stale family row can't restore it (C2)", async () => {
    const w = new World();
    const f = w.family("The Madeups", { publicName: "the Madeup family" });
    const a = w.person(f, full);
    const b = w.person(f, { role: "kid" });
    await w.syncAll();
    await db().query(`update sync_copies set read_only = false`);
    await db().query(`update families set code_hash = $2, code_enc = 'sealed' where id = $1`, [f._id, "b".repeat(64)]);
    await db().query(`update sync_copies set read_only = true`);

    w.deleteAtSource(a);
    await runDeletions(w.run());
    assert.equal((await familyRow(f._id)).name, "The Madeups", "someone's still here");

    w.deleteAtSource(b);
    await runDeletions(w.run());
    let family = await familyRow(f._id);
    assert.equal(family.name, "Deleted");
    assert.equal(family.public_name, null);
    assert.equal(family.code_hash, null);
    assert.equal(family.code_enc, null);

    // Convex's own row still has the name. Checked after the families walk alone: the people walk's end would hide a slip here.
    await runPass(w.run({ budgetMs: 0 }));
    assert.equal((await stateOf("pass")).at_table, "people");
    family = await familyRow(f._id);
    assert.equal(family.name, "Deleted");
    assert.equal(family.public_name, null);
    await w.passAll();
    assert.equal((await familyRow(f._id)).name, "Deleted");

    // Someone new joins this family: its name comes back from the source, once a pass sees them.
    w.person(f, { role: "kid" });
    await w.passAll();
    await w.passAll();
    assert.equal((await familyRow(f._id)).name, "The Madeups");
  });

  await t.test("the last person's deletion landing while a family's page is in flight: the stale name stays out", async () => {
    const w = new World();
    const f = w.family("The Madeups", { publicName: "the Madeup family" });
    const only = w.person(f, full);
    await w.syncAll();
    w.convex.afterRead = async (table) => {
      if (table === "families") {
        w.convex.afterRead = null;
        await applyDeletion({ personId: only._id, familyId: f._id, supabaseId: only.supabaseProfileId, at: new Date(), recipeIds: [] });
      }
    };
    await runPass(w.run({ budgetMs: 0 })); // the families walk alone
    const family = await familyRow(f._id);
    assert.equal(family.name, "Deleted");
    assert.equal(family.public_name, null);
  });

  await t.test("an empty family on the first pass waits for its other people to land before it's blanked", async () => {
    const w = new World();
    const f = w.family("The Madeups");
    const gone = w.person(f, full);
    const here = w.person(f, { role: "kid" });
    w.deleteAtSource(gone);
    await w.syncAll();
    assert.equal((await familyRow(f._id)).name, "The Madeups");
    assert.ok(await person(here._id));
  });

  await t.test("a family with only tombstones on the first pass ends it blank", async () => {
    const w = new World();
    const f = w.family("The Madeups");
    w.deleteAtSource(w.person(f, full));
    await w.syncAll();
    assert.equal((await familyRow(f._id)).name, "Deleted");
  });

  await t.test("a deletion that can't apply keeps its place, tells someone, and doesn't stop the others", async () => {
    const w = new World();
    const f = w.family();
    const first = w.person(f, { supabase: { name: "First" } });
    const second = w.person(f, { supabase: { name: "Second" } });
    await w.syncAll();
    const blocked = w.deleteAtSource(first);
    // Far enough on that the read-back overlap alone wouldn't find the failed one again.
    w.deleteAtSource(second).creationTime = blocked.creationTime + 3_600_000;
    await db().query(`create function sync_test_refuse() returns trigger language plpgsql as $$
      begin
        if new.id = '${first._id}' then raise exception 'no' using errcode = '23514', constraint = 'test_rule'; end if;
        return new;
      end $$`);
    await db().query(`create trigger sync_test_refuse before insert on sync_deleted for each row execute function sync_test_refuse()`);

    await assert.rejects(runDeletions(w.run()), { name: "SyncDeletionFailed" });
    assertBlank(await person(second._id));
    assert.equal((await person(first._id)).deleted_at, null);
    assert.deepEqual(await issues(), [{ table_name: "people", row_id: first._id, rule: "test_rule" }]);
    const state = await stateOf("deletions");
    assert.ok(state.after_ms < blocked.creationTime, "the place doesn't pass it");

    await db().query(`drop trigger sync_test_refuse on sync_deleted`);
    assert.equal((await runDeletions(w.run())).applied, 1);
    assertBlank(await person(first._id));
    assert.deepEqual(await issues(), []);
  });

  await t.test("a deletion committed late, with an older time, is still found by the overlap", async () => {
    const w = new World();
    const f = w.family();
    const early = w.person(f);
    const late = w.person(f);
    await w.syncAll();
    const seen = w.deleteAtSource(late);
    await runDeletions(w.run());
    assert.equal((await stateOf("deletions")).after_ms, Math.max(0, seen.creationTime - 600_000));
    const committedLate = w.deleteAtSource(early);
    committedLate.creationTime = seen.creationTime - 5000;
    await runDeletions(w.run());
    assertBlank(await person(early._id));
  });

  await t.test("Convex being down fails the run so the queue retries; late past 15 minutes, someone hears, once", async () => {
    const w = new World();
    w.family();
    await w.syncAll();
    w.convex.deletions = async () => {
      throw Object.assign(new Error("down"), { name: "ConvexReadFailed" });
    };
    await assert.rejects(runDeletions(w.run()), { name: "ConvexReadFailed" });
    assert.equal((await stateOf("deletions")).lease_id, null);
    assert.equal(w.report.alerts.length, 0, "a blip isn't an alert");
    await db().query(`update sync_state set last_success_at = now() - interval '16 minutes' where name = 'deletions'`);
    await assert.rejects(runDeletions(w.run()));
    await assert.rejects(runDeletions(w.run()));
    assert.deepEqual(w.report.alerts.map((a) => a.name), ["SyncDeletionsLate"]);
  });

  await t.test("a stuck pass can't hold deletions up", async () => {
    const w = new World();
    const f = w.family();
    const cook = w.person(f, full);
    await w.syncAll();
    await db().query(`update sync_state set lease_id = 'stuck', lease_until = now() + interval '1 hour' where name = 'pass'`);
    w.deleteAtSource(cook);
    assert.equal((await runDeletions(w.run())).applied, 1);
    assertBlank(await person(cook._id));
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

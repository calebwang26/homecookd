// A family's recipes: convex/memories.test.ts and flow.test.ts's reads, and the switch that keeps every write off until recipes moves (recipes/switch.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { recipesVersion } from "../src/modules/recipes/reads.js";
import { recipeWrites, recipeWritesFlag } from "../src/modules/recipes/switch.js";
import { deleteRecipeUnlessLocked, failRecipeIfOpen, insertProcessingRecipe, saveMemoriesOptIn, saveStoryCardIfOpen, saveTestRecipe, shareRecipeIfOpen } from "../src/modules/recipes/writes.js";
import { call, closeRecipeWrites, db, family, freshDatabase, hasDatabase, lockRecipeCopy, MEDIA, openRecipeWrites, recipe, setUp, who, type Who } from "./jobsHelpers.js";

const STEP = { order: 1, title: "Rinse", text: "Rinse it twice.", moment: { startS: 10, endS: 40 } };
const STORY = { kind: "story", text: "My mother made this.", moment: { startS: 130, endS: 230 }, step: 1, id: "s1", title: "The first pot" };

async function addRecipe(cook: Who, extra: Record<string, unknown> = {}): Promise<string> {
  const row = { title: "Kanda Poha", status: "ready", steps: JSON.stringify([STEP]), memories: JSON.stringify([STORY]), ...extra };
  const names = Object.keys(row);
  const { rows } = await db().query(
    `insert into recipes (family_id, cook_id, ${names.join(", ")}) values ($1, $2, ${names.map((_, i) => `$${i + 3}`).join(", ")}) returning id`,
    [cook.familyId, cook.personId, ...Object.values(row)],
  );
  return rows[0].id;
}

test("recipes", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const { app } = setUp();
  const home = await family();
  const dad = await who(home);
  const leo = await who(home, "kid");
  const others = await family();
  const sam = await who(others);
  const optIn = (by: Who, id: string, value: boolean) => call(app, by, "POST", `/v1/recipes/${id}/memories-opt-in`, { optIn: value });
  const get = (by: Who, id: string) => call(app, by, "GET", `/v1/recipes/${id}`);

  await t.test("the kid gets the stories, titles and all, only after the cook's yes", async () => {
    const id = await addRecipe(dad);
    assert.deepEqual((await get(leo, id)).data.memories, []);
    const cookView = (await get(dad, id)).data;
    assert.deepEqual(cookView.memories.find((m: { id: string }) => m.id === "s1"), STORY);
    assert.deepEqual((await call(app, leo, "GET", "/v1/recipes")).data.recipes.find((r: { _id: string }) => r._id === id).memories, []);

    await openRecipeWrites();
    assert.deepEqual((await optIn(dad, id, true)).data, { ok: true });
    assert.deepEqual((await get(leo, id)).data.memories, cookView.memories);
    assert.equal((await call(app, leo, "GET", "/v1/recipes")).data.recipes.find((r: { _id: string }) => r._id === id).memories.length, 1);
    // The cook takes them back.
    await optIn(dad, id, false);
    assert.deepEqual((await get(leo, id)).data.memories, []);
    assert.equal((await recipe(id)).moss_indexed_at, null, "whatever re-syncs search finds it");
    await closeRecipeWrites();
  });

  await t.test("reads keep Convex's fields and milliseconds, and build links from keys", async () => {
    const id = await addRecipe(dad, {
      library_id: "kanda-poha",
      media_prefix: "recipe-a/",
      recipe_json_key: "recipe-a/a1/recipe.json",
      cover_key: "recipe-a/a1/poster one.jpg",
      cover_version: "17",
      language: "mr",
      shared_at: new Date("2026-10-31T12:00:00Z"),
      story_card_text: "A dish from home.",
      story_card_written_at: new Date("2026-10-31T12:00:01Z"),
      story_card_culture: "Maharashtrian",
      added_ingredients: JSON.stringify([{ name: "peanuts", questionId: "q1" }]),
    });
    const { data } = await get(leo, id);
    assert.equal(data._id, id);
    assert.equal(typeof data._creationTime, "number");
    assert.equal(data.familyId, home);
    assert.equal(data.cookId, dad.personId);
    assert.match(data.cookName, /^Person/);
    assert.equal(data.libraryId, "kanda-poha");
    assert.equal(data.recipeJsonUrl, `${MEDIA}/recipe-a/a1/recipe.json`);
    assert.equal(data.coverUrl, `${MEDIA}/recipe-a/a1/poster%20one.jpg?v=17`);
    assert.equal(data.sharedAt, Date.parse("2026-10-31T12:00:00Z"));
    assert.deepEqual(data.storyCard, { text: "A dish from home.", writtenAt: Date.parse("2026-10-31T12:00:01Z"), culture: "Maharashtrian" });
    assert.deepEqual(data.steps, [STEP]);
    assert.equal(data.stepCount, 1);
    assert.deepEqual(data.addedIngredients, [{ name: "peanuts", questionId: "q1" }]);
    assert.ok(!("media_prefix" in data) && !("cover_key" in data), "keys stay in the database");

    const stock = (await get(dad, await addRecipe(dad, { cover_stock_path: "stock/poha.jpg" }))).data;
    assert.equal(stock.coverUrl, "https://homecookd.app/media/stock/poha.jpg");
    const plain = (await get(dad, await addRecipe(dad))).data;
    for (const unset of ["coverUrl", "recipeJsonUrl", "libraryId", "sharedAt", "storyCard", "hiddenAt", "addedIngredients"]) assert.ok(!(unset in plain), unset);
  });

  await t.test("without its setting, a key fails loudly rather than a recipe with no picture", async () => {
    const id = await addRecipe(dad, { recipe_json_key: "recipe-b/recipe.json" });
    delete process.env.MEDIA_BASE_URL;
    assert.equal((await get(dad, id)).status, 500);
    process.env.MEDIA_BASE_URL = MEDIA;
  });

  await t.test("the list pages newest first, 100 at a time, and only her family's", async () => {
    const lone = await who(await family());
    const ids: string[] = [];
    for (let i = 0; i < 103; i += 1) ids.push(await addRecipe(lone));
    const first = await call(app, lone, "GET", "/v1/recipes");
    assert.equal(first.data.recipes.length, 100);
    const second = await call(app, lone, "GET", `/v1/recipes?cursor=${first.data.nextCursor}`);
    assert.equal(second.data.recipes.length, 3);
    assert.equal(second.data.nextCursor, null);
    const seen = [...first.data.recipes, ...second.data.recipes].map((r: { _id: string }) => r._id);
    assert.deepEqual([...seen].sort(), [...ids].sort());
    assert.deepEqual((await call(app, sam, "GET", "/v1/recipes")).data.recipes, []);
  });

  await t.test("another family's recipe reads as one that isn't there, and every route needs a session", async () => {
    const id = await addRecipe(dad);
    const wrong = await get(sam, id);
    const missing = await get(sam, "no-such-recipe");
    assert.equal(wrong.status, 404);
    assert.deepEqual({ ...wrong.data, requestId: 0 }, { ...missing.data, requestId: 0 });
    assert.equal((await call(app, null, "GET", "/v1/recipes")).status, 401);
    assert.equal((await call(app, null, "GET", `/v1/recipes/${id}`)).status, 401);
    assert.equal((await call(app, null, "POST", `/v1/recipes/${id}/memories-opt-in`, { optIn: true })).status, 401);
  });

  await t.test("the switch: off by default, the flag opens it, and a sync mid-copy always locks it", async () => {
    assert.equal(recipeWritesFlag({}), false);
    for (const wrong of ["true", "1", "ON", " on", "yes"]) assert.equal(recipeWritesFlag({ RECIPE_WRITES: wrong }), false, wrong);
    assert.equal(recipeWritesFlag({ RECIPE_WRITES: "on" }), true);

    const on = { RECIPE_WRITES: "on" };
    assert.equal(await recipeWrites(db(), {}), "closed");
    assert.equal(await recipeWrites(db(), on), "open", "one switch: no sync has run, so the flag alone opens it (production at launch)");
    await db().query(`update sync_copies set moved_at = null, read_only = true where table_name = 'recipes'`);
    assert.equal(await recipeWrites(db(), on), "locked", "a sync copying the table owns it, whatever the flag says");
    assert.equal(await recipeWrites(db(), {}), "locked");
    await db().query(`update sync_copies set moved_at = now() where table_name = 'recipes'`);
    assert.equal(await recipeWrites(db(), {}), "closed", "moved, with the flag off");
    assert.equal(await recipeWrites(db(), on), "open");
    // No sync row at all (a database the sync never touched) is the same as a sync that never ran. Rolled back, because other tests move this row.
    const c = await db().connect();
    try {
      await c.query("begin");
      await c.query(`delete from sync_copies where table_name = 'recipes'`);
      assert.equal(await recipeWrites(c, on), "open");
      assert.equal(await recipeWrites(c, {}), "closed");
    } finally {
      await c.query("rollback");
      c.release();
    }
    await closeRecipeWrites();
  });

  await t.test("with it off, an edit answers 501 and writes nothing, and who's asking is refused first", async () => {
    const id = await addRecipe(dad);
    const before = await recipe(id);
    for (const state of ["closed", "locked"]) {
      if (state === "locked") await lockRecipeCopy();
      const res = await optIn(dad, id, true);
      assert.equal(res.status, 501, state);
      assert.equal(res.data.error, "not_moved", state);
      assert.deepEqual(await recipe(id), before, state);
      assert.equal((await optIn(leo, id, true)).data.message, "Only the cook can share these.", state);
      assert.equal((await optIn(sam, id, true)).status, 404, state);
      assert.equal((await optIn(dad, "no-such-recipe", true)).data.message, "That recipe isn't here anymore.", state);
    }
    await closeRecipeWrites();
    await openRecipeWrites();
    assert.equal((await optIn(leo, id, true)).status, 403);
    assert.equal((await optIn(sam, id, true)).status, 404);
    assert.equal((await recipe(id)).memories_opt_in, false);
    await closeRecipeWrites();
  });

  await t.test("every write in writes.ts asks the switch, and the trigger is still there behind it", async () => {
    const source = readFileSync(new URL("../src/modules/recipes/writes.ts", import.meta.url), "utf8");
    const functions = source.split(/^export async function /m).slice(1);
    assert.equal(functions.length, 7);
    for (const body of functions) {
      assert.match(body, /await recipeWrites\(c\)/, body.slice(0, 40));
      const asked = body.indexOf("recipeWrites(c)");
      const wrote = body.search(/c\.query\(/);
      assert.ok(asked >= 0 && asked < wrote, `${body.slice(0, 40)} writes before it asks`);
    }

    const id = await addRecipe(dad);
    const row = { familyId: home, cookId: dad.personId, title: "x", language: null };
    await assert.rejects(insertProcessingRecipe(db(), row), { code: "not_moved" });
    await assert.rejects(saveMemoriesOptIn(db(), id, true), { code: "not_moved" });
    const made = { familyId: home, cookId: dad.personId, title: "x", libraryId: "test-recipe-x", mediaPrefix: "test-recipe-x/", recipeJsonKey: "test-recipe-x/a1/recipe.json", coverKey: "test-recipe-x/a1/poster.jpg", coverVersion: "0", steps: [], memories: [], language: null };
    await assert.rejects(saveTestRecipe(db(), made, null), { code: "not_moved" });
    await assert.rejects(saveTestRecipe(db(), made, id), { code: "not_moved" });
    assert.equal(await failRecipeIfOpen(db(), id), false);
    assert.equal(await shareRecipeIfOpen(db(), id), false);
    assert.equal(await saveStoryCardIfOpen(db(), id, { text: "x", usedStories: false, culture: null, quote: null }), false);
    assert.equal((await recipe(id)).shared_at, null);
    await lockRecipeCopy();
    assert.equal(await deleteRecipeUnlessLocked(db(), id), false);
    assert.ok(await recipe(id), "locked: the sync's");
    await assert.rejects(db().query(`update recipes set title = 'x' where id = $1`, [id]), { code: "HC001" });
    await closeRecipeWrites();
    assert.equal(await deleteRecipeUnlessLocked(db(), id), true, "a deletion doesn't wait for the flag");
    assert.equal(await recipe(id), undefined);
  });

  await t.test("the poll's cheap check moves for every writer and for a row that went, and not otherwise", async () => {
    const lone = await who(await family());
    const empty = await recipesVersion(lone.familyId);
    const id = await addRecipe(lone);
    const one = await recipesVersion(lone.familyId);
    assert.notEqual(one, empty);
    assert.equal(await recipesVersion(lone.familyId), one, "nothing changed");
    // As the worker's own UPDATE does: it doesn't name updated_at.
    await db().query(`update recipes set status = 'failed' where id = $1`, [id]);
    const two = await recipesVersion(lone.familyId);
    assert.notEqual(two, one);
    const older = await addRecipe(lone);
    await db().query(`update recipes set created_at = created_at - interval '1 day' where id = $1`, [older]);
    const three = await recipesVersion(lone.familyId);
    await db().query(`delete from recipes where id = $1`, [older]);
    assert.notEqual(await recipesVersion(lone.familyId), three);
    assert.equal(await recipesVersion(sam.familyId + "-not-a-family"), empty);
  });

  await app.close();
});

after(async () => {
  if (hasDatabase) await db().end();
});

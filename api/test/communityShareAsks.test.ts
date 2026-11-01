// convex/shareRequests.test.ts on the new api, the kid's side: an ask becomes one of the cook's open questions, and nobody outside the family can ask. Her yes, and homie reading it,
// write `recipes.shared_at`, so they aren't here (COMMUNITY-MIGRATION.md). A test stands in for homie's reading by setting what it read.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db.js";
import { ASK_AGAIN_MS, shareQuestion } from "../src/modules/community/shareAsks.js";
import { call, MISSING, ok, person, recipe, refusedWith, sameAsMissing, type Who, world } from "./communityHelpers.js";
import { hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;
const ask = (t: FastifyInstance, who: Who, recipeId: string) => call(t, who, "POST", "/v1/share-requests", { recipeId });
const familyDishes = async (t: FastifyInstance, who: Who) => (await ok(call(t, who, "GET", "/v1/share-requests/dishes"))).dishes;
const shareAsks = async () => (await db().query("select * from questions where kind = 'share' order by created_at")).rows;
const sharedAt = async (recipeId: string) => (await db().query("select shared_at from recipes where id = $1", [recipeId])).rows[0].shared_at;
/** What homie read in her answer. */
const heard = (recipeId: string, said: string, msAgo = 0) =>
  db().query(`update questions set share_said = $2, share_decided_at = now() - make_interval(secs => $3) where recipe_id = $1 and kind = 'share' and share_said is null`, [recipeId, said, msAgo / 1000]);

test("a kid's ask becomes one of the cook's open questions, and asking again doesn't ask her twice", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const poha = await recipe(rajani);
  assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "asked" });
  assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "asked" });

  const asks = await shareAsks();
  assert.equal(asks.length, 1);
  like(asks[0], { recipe_id: poha, asked_by: shreya.personId, status: "asked_cook", text_for_cook: null });
  assert.equal(asks[0].text, "Shreya wants to put your Kanda Poha on the map for neighbors. They'd see the recipe, one line you said and homie's guess at where the dish is from, never your video. Is that okay?");
  assert.equal(asks[0].text, shareQuestion("Shreya", "Kanda Poha"));
  assert.deepEqual(await familyDishes(t, shreya), [{ recipeId: poha, dish: "Kanda Poha", cookName: "Rajani", mine: false, shared: false, asked: true, notNowAt: null }]);
  assert.equal(await sharedAt(poha), null);
});

test("two asks at the same moment stay one question", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const brother = await person(rajani.familyId, "Vikram", "kid");
  const poha = await recipe(rajani);
  await Promise.all([shreya, brother, shreya, brother].map((who) => ok(ask(t, who, poha))));
  assert.equal((await shareAsks()).length, 1);
});

test("after a no she isn't asked again for a day; until homie reads her answer it's still waiting", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const poha = await recipe(rajani);
  await ok(ask(t, shreya, poha));
  // She answered, and homie hasn't read it yet.
  await db().query("update questions set status = 'answered', answer_by = $1, answer_text = 'Not now, beta.', answered_at = now() where recipe_id = $2", [rajani.personId, poha]);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
  assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "asked" }); // and no second question while it's read

  await heard(poha, "no");
  const [said] = await familyDishes(t, shreya);
  like(said, { shared: false, asked: false, notNowAt: (v: unknown) => typeof v === "number" });
  await refusedWith(ask(t, shreya, poha), 409, "Rajani said not now. Ask again tomorrow.");
  await db().query("update questions set share_decided_at = now() - make_interval(secs => $1)", [(ASK_AGAIN_MS - 60_000) / 1000]);
  await refusedWith(ask(t, shreya, poha), 409, /said not now/);
  assert.equal((await shareAsks()).length, 1);

  // A day later the family may ask again: a new question, and the old "not now" is gone.
  await db().query("update questions set share_decided_at = now() - make_interval(secs => $1)", [(ASK_AGAIN_MS + 1000) / 1000]);
  assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "asked" });
  assert.equal((await shareAsks()).length, 2);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
});

test("an unclear answer waits a day too; a yes shows as nothing waiting", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const varan = await recipe(rajani, { title: "Varan" });
  const sheera = await recipe(rajani, { title: "Sheera" });
  for (const id of [varan, sheera]) await ok(ask(t, shreya, id));
  await heard(varan, "unclear");
  await heard(sheera, "yes");
  const dishes = Object.fromEntries((await familyDishes(t, shreya)).map((d: any) => [d.dish, [d.shared, d.asked, typeof d.notNowAt]]));
  assert.deepEqual(dishes, { Varan: [false, false, "number"], Sheera: [false, false, "object"] });
});

test("nobody outside the family can ask, and it never shares anything", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom } = await world();
  const dal = await recipe(rajani, { title: "Varan" });
  sameAsMissing(await ask(t, serene, dal), await ask(t, serene, MISSING), "another family's recipe");
  sameAsMissing(await ask(t, serenesMom, dal), await ask(t, serenesMom, MISSING), "another family's recipe, as a cook");
  await refusedWith(ask(t, serene, dal), 404, "Pick one of your family's recipes.");
  assert.deepEqual(await shareAsks(), []);
  assert.deepEqual(await familyDishes(t, serenesMom), []); // the Zhangs have no dishes
  const cooking = await recipe(rajani, { title: "Still Cooking", status: "processing" });
  await refusedWith(ask(t, shreya, cooking), 404, "Pick one of your family's recipes.");
  assert.deepEqual((await familyDishes(t, shreya)).map((d: any) => d.dish), ["Varan"]); // ready dishes only
});

test("a dish already on the map says so; her own tap can't share it from here and says that, with nothing changed", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const shared = await recipe(rajani, { sharedAt: 1 });
  assert.deepEqual(await ok(ask(t, shreya, shared)), { result: "shared" });
  assert.deepEqual(await ok(ask(t, rajani, shared)), { result: "shared" });
  like((await familyDishes(t, shreya))[0], { shared: true, asked: false, notNowAt: null });

  const dal = await recipe(rajani, { title: "Varan" });
  const before = await db().query("select * from recipes where id = $1", [dal]);
  const r = await refusedWith(ask(t, rajani, dal), 501, "This can't be done here yet.");
  assert.equal(r.data.error, "not_moved");
  assert.deepEqual(await shareAsks(), []);
  assert.deepEqual((await db().query("select * from recipes where id = $1", [dal])).rows, before.rows);
});

test("setShare and setLocation aren't here: they write rows the sync owns", { skip }, async () => {
  const { t, rajani } = await world();
  const dal = await recipe(rajani);
  for (const url of ["/v1/community/recipes/x/share", `/v1/community/recipes/${dal}/share`, "/v1/community/share", "/v1/community/location", "/v1/me/location"]) {
    assert.equal((await call(t, rajani, "POST", url, {})).status, 404, url);
  }
});

after(async () => {
  if (hasDatabase) await db().end();
});

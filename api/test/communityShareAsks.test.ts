// "Put it on the map" on the new api. Asking stays on Convex until Messages moves, so this answers `not_moved` and writes nothing: a question written here would reach no cook.
// What's left of convex/shareRequests.test.ts is the chooser's reading of asks and who may ask at all. A test writes the `questions` rows, standing in for Messages.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db.js";
import { call, MISSING, ok, person, recipe, refusedWith, sameAsMissing, type Who, world } from "./communityHelpers.js";
import { hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;
const ask = (t: FastifyInstance, who: Who, recipeId: string) => call(t, who, "POST", "/v1/share-requests", { recipeId });
const familyDishes = async (t: FastifyInstance, who: Who) => (await ok(call(t, who, "GET", "/v1/share-requests/dishes"))).dishes;
const questionRows = async () => (await db().query("select * from questions")).rows;
const NOT_MOVED = "This can't be done here yet.";

/** A share ask, as Messages will write it. `said`: what homie read in her answer, that long ago. */
async function shareAsk(who: Who, recipeId: string, said: string | null = null, msAgo = 0) {
  await db().query(
    `insert into questions (family_id, recipe_id, asked_by, text, status, kind, share_said, share_decided_at)
     values ($1, $2, $3, 'Is that okay?', 'asked_cook', 'share', $4, case when $4::text is null then null else now() - make_interval(secs => $5) end)`,
    [who.familyId, recipeId, who.personId, said, msAgo / 1000],
  );
}

test("a kid's ask answers not_moved and writes nothing: she isn't told it was asked when the cook would never hear", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const brother = await person(rajani.familyId, "Vikram", "kid");
  const poha = await recipe(rajani);
  const r = await refusedWith(ask(t, shreya, poha), 501, NOT_MOVED);
  assert.equal(r.data.error, "not_moved");
  // Again, and two at once.
  const replies = await Promise.all([shreya, brother, shreya, brother].map((who) => ask(t, who, poha)));
  assert.deepEqual(replies.map((x) => x.status), [501, 501, 501, 501]);
  assert.deepEqual(await questionRows(), []);
  assert.deepEqual(await familyDishes(t, shreya), [{ recipeId: poha, dish: "Kanda Poha", cookName: "Rajani", mine: false, shared: false, asked: false, notNowAt: null }]);
  assert.equal((await db().query("select shared_at from recipes where id = $1", [poha])).rows[0].shared_at, null);
  const { rows } = await db().query("select count(*)::int as n from outbox");
  assert.equal(rows[0].n, 0);
});

test("the chooser: an ask is waiting until homie reads her answer; a no shows when she said it; a newer ask replaces it", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const poha = await recipe(rajani);
  await shareAsk(shreya, poha);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
  // She answered, and homie hasn't read it yet.
  await db().query("update questions set status = 'answered', answer_by = $1, answer_text = 'Not now, beta.', answered_at = now() where recipe_id = $2", [rajani.personId, poha]);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });

  await db().query("update questions set share_said = 'no', share_decided_at = now() where recipe_id = $1", [poha]);
  const [said] = await familyDishes(t, shreya);
  like(said, { shared: false, asked: false, notNowAt: (v: unknown) => typeof v === "number" });
  // Even with a "not now" on it, asking here still only says it can't.
  await refusedWith(ask(t, shreya, poha), 501, NOT_MOVED);

  await shareAsk(shreya, poha);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
});

test("an unclear answer shows as not now too; a yes shows as nothing waiting", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const varan = await recipe(rajani, { title: "Varan" });
  const sheera = await recipe(rajani, { title: "Sheera" });
  await shareAsk(shreya, varan, "unclear");
  await shareAsk(shreya, sheera, "yes");
  const dishes = Object.fromEntries((await familyDishes(t, shreya)).map((d: any) => [d.dish, [d.shared, d.asked, typeof d.notNowAt]]));
  assert.deepEqual(dishes, { Varan: [false, false, "number"], Sheera: [false, false, "object"] });
});

test("nobody outside the family can ask, the same as a recipe that isn't there", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom } = await world();
  const dal = await recipe(rajani, { title: "Varan" });
  sameAsMissing(await ask(t, serene, dal), await ask(t, serene, MISSING), "another family's recipe");
  sameAsMissing(await ask(t, serenesMom, dal), await ask(t, serenesMom, MISSING), "another family's recipe, as a cook");
  await refusedWith(ask(t, serene, dal), 404, "Pick one of your family's recipes.");
  assert.deepEqual(await questionRows(), []);
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
  const r = await refusedWith(ask(t, rajani, dal), 501, NOT_MOVED);
  assert.equal(r.data.error, "not_moved");
  assert.deepEqual(await questionRows(), []);
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

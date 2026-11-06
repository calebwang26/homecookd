// convex/swaps.test.ts on the new api: only shared recipes, only the family that was asked answers, and nothing beyond what the cards already show.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { cookTogether, dinner, family, feed, host, mySwaps, ok, person, recipe, refusedWith, requestSwap, respondSwap, setShared, tryHost, type Who, world } from "./communityHelpers.js";
import { hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;

async function swapWorld() {
  const w = await world();
  const poha = await recipe(w.rajani, { sharedAt: 1 });
  const dumplings = await recipe(w.serenesMom, { title: "Dumplings", sharedAt: 2 });
  const privateDal = await recipe(w.rajani, { title: "Private Dal" });
  const swaps = (who: Who) => mySwaps(w.t, who);
  const request = (who: Who, recipeId: string, myRecipeId?: string) => requestSwap(w.t, who, recipeId, myRecipeId);
  const respond = (who: Who, swapId: string, accept: boolean) => respondSwap(w.t, who, swapId, accept);
  return { ...w, poha, dumplings, privateDal, swaps, request, respond };
}

test("a swap: one family asks, offering one of theirs; the other says yes; both see it", { skip }, async () => {
  const { shreya, serene, rajani, serenesMom, poha, dumplings, swaps, request, respond } = await swapWorld();
  const { swapId } = await ok(request(shreya, dumplings, poha));
  assert.equal((await ok(request(rajani, dumplings, poha))).swapId, swapId); // the family already asked: the same ask

  assert.deepEqual(await swaps(shreya), [
    { swapId, kind: "swap", status: "pending", incoming: false, ourDish: { recipeId: poha, dish: "Kanda Poha" }, theirDish: { recipeId: dumplings, dish: "Dumplings" }, familyName: "Mei's family" },
  ]);
  assert.deepEqual(await swaps(serene), [
    { swapId, kind: "swap", status: "pending", incoming: true, ourDish: { recipeId: dumplings, dish: "Dumplings" }, theirDish: { recipeId: poha, dish: "Kanda Poha" }, familyName: "The Pawar family" },
  ]);

  await ok(respond(serene, swapId, true)); // anyone in the family that was asked, not only the cook
  assert.equal((await swaps(rajani))[0].status, "accepted");
  assert.equal((await swaps(serenesMom))[0].status, "accepted");
  await refusedWith(respond(serenesMom, swapId, false), 409, /already answered/);

  // Nothing but the dishes, the status and the family's card name.
  const all = JSON.stringify([...(await swaps(shreya)), ...(await swaps(serene))]);
  for (const word of ["personId", "requesterId", "cookId", "familyId", "Shreya", "Serene", "libraryId", "recipeJsonUrl", "Not too long", "Pune", "Zhang home", "Pawar home"]) {
    assert.ok(!all.includes(word), word);
  }
});

test("only shared recipes swap, never your own family's, and only the family that was asked answers", { skip }, async () => {
  const { shreya, serene, caleb, rajani, poha, dumplings, privateDal, swaps, request, respond } = await swapWorld();
  await refusedWith(request(shreya, poha), 409, /your family's recipe/);
  await refusedWith(request(serene, privateDal), 404, /isn't shared/);
  await refusedWith(request(shreya, dumplings, privateDal), 409, "Share that recipe first.");
  const theirs = await recipe(caleb, { title: "Tomato Egg", sharedAt: 3 });
  await refusedWith(request(shreya, dumplings, theirs), 409, "Share that recipe first."); // not hers to offer
  await refusedWith(request(shreya, dumplings, "no-such-recipe"), 409, "Share that recipe first."); // the same as one that isn't there

  const { swapId } = await ok(request(caleb, poha)); // no dish to offer yet
  await refusedWith(respond(caleb, swapId, true), 404, /Only the family that was asked/);
  await refusedWith(respond(serene, swapId, true), 404, /Only the family that was asked/);
  assert.deepEqual(await swaps(serene), []); // a third family sees nothing

  await ok(respond(shreya, swapId, false));
  assert.deepEqual((await swaps(caleb)).filter((s: any) => s.swapId === swapId), [
    { swapId, kind: "swap", status: "declined", incoming: false, ourDish: null, theirDish: { recipeId: poha, dish: "Kanda Poha" }, familyName: "The Pawar family" },
  ]);
  await refusedWith(request(caleb, poha), 409, /not this time/);

  // A dish that stops being shared stops showing in the other family's swap.
  const okafor = await person(await family("Okafor home", "Okafor"), "Ngozi", "cook");
  const jollof = await recipe(okafor, { title: "Jollof Rice", sharedAt: 4 });
  const { swapId: ask } = await ok(request(rajani, jollof));
  await setShared(jollof, false);
  like((await swaps(rajani)).find((s: any) => s.swapId === ask), { theirDish: null, familyName: "The Okafor family" });
  like((await swaps(okafor)).find((s: any) => s.swapId === ask), { ourDish: { recipeId: jollof, dish: "Jollof Rice" } });
});

test("cook together: a family asks another to make its dish with them; after a yes they may host a dinner of it", { skip }, async () => {
  const { t, shreya, serene, caleb, rajani, serenesMom, poha, dumplings, privateDal, swaps, request, respond } = await swapWorld();
  const cook = (who: Who, recipeId: string) => cookTogether(t, who, recipeId);
  const { swapId } = await ok(request(shreya, dumplings));
  const { swapId: cookId } = await ok(cook(shreya, dumplings));
  assert.notEqual(cookId, swapId); // a swap and a "cook together" for one dish are two asks
  assert.equal((await ok(cook(rajani, dumplings))).swapId, cookId); // the family already asked: the same ask
  await refusedWith(cook(shreya, poha), 409, /your family's recipe/);
  await refusedWith(cook(serene, privateDal), 404, /isn't shared/);

  const ofCook = async (who: Who) => (await swaps(who)).find((s: any) => s.swapId === cookId);
  assert.deepEqual(await ofCook(shreya), { swapId: cookId, kind: "cook", status: "pending", incoming: false, ourDish: null, theirDish: { recipeId: dumplings, dish: "Dumplings" }, familyName: "Mei's family" });
  assert.deepEqual(await ofCook(serene), { swapId: cookId, kind: "cook", status: "pending", incoming: true, ourDish: { recipeId: dumplings, dish: "Dumplings" }, theirDish: null, familyName: "The Pawar family" });

  // Until the Zhangs say yes, the Pawars can't host a dinner of the Zhangs' dish.
  const tryIt = (who: Who) => tryHost(t, who, dumplings);
  await refusedWith(tryIt(shreya), 404, "Pick one of your family's recipes.");
  await refusedWith(respond(shreya, cookId, true), 404, /Only the family that was asked/);
  await ok(respond(serenesMom, cookId, true));
  assert.equal((await ofCook(rajani)).status, "accepted");
  assert.equal((await swaps(shreya)).find((s: any) => s.swapId === swapId).status, "pending"); // the swap is still its own

  const dinnerId = await host(t, shreya, dumplings);
  like((await dinner(t, shreya, dinnerId)).data, { dish: "Dumplings", isHost: true, recipeId: dumplings });
  // Neighbors find it on the dish ("Join Shreya's dinner").
  like((await feed(t, caleb)).recipes.find((r: any) => r.recipeId === dumplings).dinner, { dinnerId, hostName: "Shreya" });
  await refusedWith(tryIt(caleb), 404, "Pick one of your family's recipes."); // his family never asked

  // A no is final for that family, and a dish that stops being shared can't be hosted.
  const { swapId: calebsAsk } = await ok(cook(caleb, dumplings));
  await ok(respond(serene, calebsAsk, false));
  await refusedWith(cook(caleb, dumplings), 409, /not this time/);
  await setShared(dumplings, false);
  await refusedWith(tryIt(shreya), 404, "Pick one of your family's recipes.");
});

test("past 50 asks, a family still finds its own: Convex read only the first 50", { skip }, async () => {
  const { t, shreya, rajani, serenesMom, dumplings } = await swapWorld();
  const { swapId: cookId } = await ok(cookTogether(t, shreya, dumplings));
  await ok(respondSwap(t, serenesMom, cookId, true));
  await db().query(
    `insert into recipes (family_id, cook_id, title, status, shared_at)
     select $1, $2, 'Filler ' || n, 'ready', now() from generate_series(1, 60) n`,
    [serenesMom.familyId, serenesMom.personId],
  );
  await db().query(
    `insert into swap_requests (requester_id, requester_family_id, their_recipe_id, other_family_id, status)
     select $1, $2, id, $3, 'pending' from recipes where title like 'Filler %'`,
    [shreya.personId, shreya.familyId, serenesMom.familyId],
  );
  assert.ok(await host(t, rajani, dumplings)); // the yes is still found
  assert.equal((await ok(cookTogether(t, shreya, dumplings))).swapId, cookId); // asking again is still the same ask
});

after(async () => {
  if (hasDatabase) await db().end();
});

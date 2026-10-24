// Recipe swaps between families (community.requestSwap, respondSwap, mySwaps): only shared recipes, only
// the family that was asked answers, and nothing beyond what the cards already show.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { family, person, recipe, type Who, world } from "./community.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function swapWorld() {
  const w = await world();
  const poha = await recipe(w.t, w.rajani, { sharedAt: 1 });
  const dumplings = await recipe(w.t, w.serenesMom, { title: "Dumplings", sharedAt: 2 });
  const privateDal = await recipe(w.t, w.rajani, { title: "Private Dal" });
  const swaps = (who: Who) => w.t.query(api.community.mySwaps, { sessionToken: who.sessionToken });
  const request = (who: Who, recipeId: Id<"recipes">, myRecipeId?: Id<"recipes">) =>
    w.t.mutation(api.community.requestSwap, { sessionToken: who.sessionToken, recipeId, myRecipeId });
  const respond = (who: Who, swapId: Id<"swapRequests">, accept: boolean) =>
    w.t.mutation(api.community.respondSwap, { sessionToken: who.sessionToken, swapId, accept });
  return { ...w, poha, dumplings, privateDal, swaps, request, respond };
}

test("a swap: one family asks, offering one of theirs; the other says yes; both see it", async () => {
  const { shreya, serene, rajani, serenesMom, poha, dumplings, swaps, request, respond } = await swapWorld();
  const swapId = await request(shreya, dumplings, poha);
  expect(await request(rajani, dumplings, poha)).toBe(swapId); // the family already asked: the same ask

  expect(await swaps(shreya)).toEqual([
    { swapId, kind: "swap", status: "pending", incoming: false, ourDish: { recipeId: poha, dish: "Kanda Poha" }, theirDish: { recipeId: dumplings, dish: "Dumplings" }, familyName: "Mei's family" },
  ]);
  expect(await swaps(serene)).toEqual([
    { swapId, kind: "swap", status: "pending", incoming: true, ourDish: { recipeId: dumplings, dish: "Dumplings" }, theirDish: { recipeId: poha, dish: "Kanda Poha" }, familyName: "The Pawar family" },
  ]);

  await respond(serene, swapId, true); // anyone in the family that was asked, not only the cook
  expect((await swaps(rajani))[0].status).toBe("accepted");
  expect((await swaps(serenesMom))[0].status).toBe("accepted");
  await expect(respond(serenesMom, swapId, false)).rejects.toThrow("already answered");

  // Nothing but the dishes, the status and the family's card name.
  const all = JSON.stringify([...(await swaps(shreya)), ...(await swaps(serene))]);
  for (const word of ["personId", "requesterId", "cookId", "familyId", "Shreya", "Serene", "libraryId", "recipeJsonUrl", "Not too long", "Pune"]) {
    expect(all).not.toContain(word);
  }
});

test("only shared recipes swap, never your own family's, and only the family that was asked answers", async () => {
  const { t, shreya, serene, caleb, rajani, poha, dumplings, privateDal, swaps, request, respond } = await swapWorld();
  await expect(request(shreya, poha)).rejects.toThrow("your family's recipe");
  await expect(request(serene, privateDal)).rejects.toThrow("isn't shared");
  await expect(request(shreya, dumplings, privateDal)).rejects.toThrow("Share that recipe first.");
  const theirs = await recipe(t, caleb, { title: "Tomato Egg", sharedAt: 3 });
  await expect(request(shreya, dumplings, theirs)).rejects.toThrow("Share that recipe first."); // not hers to offer

  const swapId = await request(caleb, poha); // no dish to offer yet
  await expect(respond(caleb, swapId, true)).rejects.toThrow("Only the family that was asked");
  await expect(respond(serene, swapId, true)).rejects.toThrow("Only the family that was asked");
  expect(await swaps(serene)).toEqual([]); // a third family sees nothing

  await respond(shreya, swapId, false);
  expect(await swaps(caleb)).toEqual([
    { swapId, kind: "swap", status: "declined", incoming: false, ourDish: null, theirDish: { recipeId: poha, dish: "Kanda Poha" }, familyName: "The Pawar family" },
  ]);
  await expect(request(caleb, poha)).rejects.toThrow("not this time");

  // A dish that stops being shared stops showing in the other family's swap.
  const okafor = await person(t, await family(t, "Okafor home", "Okafor"), "Ngozi", "cook");
  const jollof = await recipe(t, okafor, { title: "Jollof Rice", sharedAt: 4 });
  const ask = await request(rajani, jollof);
  await t.run((ctx) => ctx.db.patch("recipes", jollof, { sharedAt: undefined }));
  expect((await swaps(rajani)).find((s) => s.swapId === ask)).toMatchObject({ theirDish: null, familyName: "The Okafor family" });
  expect((await swaps(okafor)).find((s) => s.swapId === ask)).toMatchObject({ ourDish: { recipeId: jollof, dish: "Jollof Rice" } });
});

test("cook together: a family asks another to make its dish with them; after a yes they may host a dinner of it", async () => {
  const { t, shreya, serene, caleb, rajani, serenesMom, poha, dumplings, privateDal, swaps, request, respond } = await swapWorld();
  const cook = (who: Who, recipeId: Id<"recipes">) => t.mutation(api.community.cookTogether, { sessionToken: who.sessionToken, recipeId });
  const swapId = await request(shreya, dumplings);
  const cookId = await cook(shreya, dumplings);
  expect(cookId).not.toBe(swapId); // a swap and a "cook together" for one dish are two asks
  expect(await cook(rajani, dumplings)).toBe(cookId); // the family already asked: the same ask
  await expect(cook(shreya, poha)).rejects.toThrow("your family's recipe");
  await expect(cook(serene, privateDal)).rejects.toThrow("isn't shared");

  const ofCook = async (who: Who) => (await swaps(who)).find((s) => s.swapId === cookId);
  expect(await ofCook(shreya)).toEqual({ swapId: cookId, kind: "cook", status: "pending", incoming: false, ourDish: null, theirDish: { recipeId: dumplings, dish: "Dumplings" }, familyName: "Mei's family" });
  expect(await ofCook(serene)).toEqual({ swapId: cookId, kind: "cook", status: "pending", incoming: true, ourDish: { recipeId: dumplings, dish: "Dumplings" }, theirDish: null, familyName: "The Pawar family" });

  // Until the Zhangs say yes, the Pawars can't host a dinner of the Zhangs' dish.
  const dinner = { recipeId: dumplings, startsAt: Date.now() + 3_600_000, placeName: "Baker House kitchen", address: "362 Memorial Dr", seats: 4 };
  const host = (who: Who) => t.mutation(api.dinners.create, { sessionToken: who.sessionToken, ...dinner });
  await expect(host(shreya)).rejects.toThrow("Pick one of your family's recipes.");
  await expect(respond(shreya, cookId, true)).rejects.toThrow("Only the family that was asked");
  await respond(serenesMom, cookId, true);
  expect((await ofCook(rajani))?.status).toBe("accepted");
  expect((await swaps(shreya)).find((s) => s.swapId === swapId)?.status).toBe("pending"); // the swap is still its own

  const dinnerId = await host(shreya);
  expect(await t.query(api.dinners.get, { sessionToken: shreya.sessionToken, dinnerId })).toMatchObject({ dish: "Dumplings", isHost: true, recipeId: dumplings });
  // Neighbors find it on the dish ("Join Shreya's dinner").
  const feed = await t.query(api.community.feed, { sessionToken: caleb.sessionToken, now: Date.now() });
  expect(feed.recipes.find((r) => r.recipeId === dumplings)?.dinner).toMatchObject({ dinnerId, hostName: "Shreya" });
  await expect(host(caleb)).rejects.toThrow("Pick one of your family's recipes."); // his family never asked

  // A no is final for that family, and a dish that stops being shared can't be hosted.
  const calebsAsk = await cook(caleb, dumplings);
  await respond(serene, calebsAsk, false);
  await expect(cook(caleb, dumplings)).rejects.toThrow("not this time");
  await t.run((ctx) => ctx.db.patch("recipes", dumplings, { sharedAt: undefined }));
  await expect(host(shreya)).rejects.toThrow("Pick one of your family's recipes.");
});

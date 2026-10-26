// "Report or block" and the word filter (lib/safety.ts, lib/moderation.ts, community.report / block,
// reports.ts): a report hides a dish or dinner from the reporter's family at once and from everyone once
// two families reported it; a block works both ways and refuses asks; the filter keeps bad words off
// the map and lets dish names in any language through.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { family, person, recipe, type Who, world } from "./community.helpers";
import { flagged, NOT_POSTABLE, NOT_SHAREABLE } from "./lib/moderation";
import { quoteChoices } from "./lib/storyCard";
import type { Backend } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.MUSE_API_KEY;
});

const feed = (t: Backend, who: Who) => t.query(api.community.feed, { sessionToken: who.sessionToken, now: Date.now() });
const dishes = async (t: Backend, who: Who) => (await feed(t, who)).recipes.map((r) => r.dish).sort();
const view = (t: Backend, who: Who, recipeId: Id<"recipes">) => t.query(api.community.recipe, { sessionToken: who.sessionToken, recipeId });
const dinner = (t: Backend, who: Who, dinnerId: Id<"dinners">) => t.query(api.dinners.get, { sessionToken: who.sessionToken, dinnerId });
const report = (t: Backend, who: Who, kind: "recipe" | "dinner", targetId: string, reason?: "not_food" | "rude" | "other") =>
  t.mutation(api.community.report, { sessionToken: who.sessionToken, kind, targetId, reason });
const host = (t: Backend, who: Who, recipeId: Id<"recipes">, placeName = "Baker House kitchen") =>
  t.mutation(api.dinners.create, { sessionToken: who.sessionToken, recipeId, startsAt: Date.now() + 3_600_000, placeName, address: "Baker House, 362 Memorial Dr", seats: 4 });
const join = (t: Backend, who: Who, dinnerId: Id<"dinners">) => t.mutation(api.dinners.requestJoin, { sessionToken: who.sessionToken, dinnerId });
const reports = (t: Backend) => t.run((ctx) => ctx.db.query("reports").take(100));

test("a report hides the dish and its dinner from the reporter's family only, at once", async () => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const pohaNight = await host(t, rajani, poha);
  await expect(report(t, shreya, "recipe", poha)).rejects.toThrow("your family's recipe");
  await expect(report(t, serene, "recipe", "not-an-id")).rejects.toThrow("isn't shared anymore");

  await report(t, serene, "recipe", poha, "rude");
  await report(t, serenesMom, "recipe", poha, "other"); // the same family again: nothing new
  expect(await dishes(t, serene)).toEqual([]);
  expect(await dishes(t, serenesMom)).toEqual([]);
  expect(await view(t, serene, poha)).toBeNull();
  expect((await feed(t, serene)).dinners).toEqual([]); // the dinner around it goes too
  expect(await dinner(t, serene, pohaNight)).toBeNull();
  await expect(join(t, serene, pohaNight)).rejects.toThrow("isn't happening");
  await expect(t.mutation(api.community.requestSwap, { sessionToken: serene.sessionToken, recipeId: poha })).rejects.toThrow("isn't shared");

  // Everyone else still sees it, the cook's family as its own.
  expect(await dishes(t, caleb)).toEqual(["Kanda Poha"]);
  expect((await feed(t, caleb)).dinners.map((d) => d.dinnerId)).toEqual([pohaNight]);
  expect((await feed(t, rajani)).recipes[0]).toMatchObject({ dish: "Kanda Poha", ours: true });
  expect(await view(t, shreya, poha)).toMatchObject({ ours: true });
  expect(await view(t, caleb, poha)).toMatchObject({ ours: false, familyName: "The Pawar family" });

  const rows = await reports(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: "recipe", targetId: poha, targetFamilyId: rajani.familyId, reporterFamilyId: serene.familyId, reporterPersonId: serene.personId, reason: "rude", status: "open",
  });
  expect((await t.run((ctx) => ctx.db.get("recipes", poha)))?.hiddenAt).toBeUndefined();
});

test("reports from two families hide a dish and a dinner from everyone else until the team reviews them", async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const salik = await person(t, await family(t, "Mian home"), "Salik", "kid");
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const pohaNight = await host(t, rajani, poha);

  await report(t, serene, "recipe", poha, "not_food");
  expect(await dishes(t, salik)).toEqual(["Kanda Poha"]); // one family isn't enough
  await report(t, caleb, "recipe", poha, "rude");
  expect((await t.run((ctx) => ctx.db.get("recipes", poha)))?.hiddenAt).toBeTypeOf("number");
  expect(await dishes(t, salik)).toEqual([]);
  expect(await view(t, salik, poha)).toBeNull();
  await expect(t.mutation(api.community.cookTogether, { sessionToken: salik.sessionToken, recipeId: poha })).rejects.toThrow("isn't shared");
  expect((await feed(t, shreya)).recipes.map((r) => [r.dish, r.ours])).toEqual([["Kanda Poha", true]]); // still hers

  expect(await t.query(internal.reports.open, {})).toEqual([
    { kind: "recipe", targetId: poha, what: "Kanda Poha", families: 2, reasons: ["not_food", "rude"], firstAt: expect.any(Number), hidden: true },
  ]);
  // The team says it's fine: back for everyone but the families that reported it.
  expect(await t.mutation(internal.reports.review, { kind: "recipe", targetId: poha, keep: true })).toBe(2);
  expect(await dishes(t, salik)).toEqual(["Kanda Poha"]);
  expect(await dishes(t, serene)).toEqual([]);
  expect(await t.query(internal.reports.open, {})).toEqual([]);

  // The dinner, by two families that can still see it (the two that reported its dish can't).
  const ngozi = await person(t, await family(t, "Okafor home", "Okafor"), "Ngozi", "cook");
  const rey = await person(t, await family(t, "Santos home", "Santos"), "Rey", "cook");
  for (const who of [salik, ngozi]) await report(t, who, "dinner", pohaNight, "other");
  expect((await feed(t, rey)).dinners).toEqual([]);
  expect(await dinner(t, rey, pohaNight)).toBeNull();
  await expect(join(t, rey, pohaNight)).rejects.toThrow("isn't happening");
  expect(await dinner(t, shreya, pohaNight)).toMatchObject({ ours: true, familyName: "The Pawar family" });
  // The team takes it down: called off, and it stays hidden.
  await t.mutation(internal.reports.review, { kind: "dinner", targetId: pohaNight, keep: false });
  expect(await t.run((ctx) => ctx.db.get("dinners", pohaNight))).toMatchObject({ status: "cancelled", hiddenAt: expect.any(Number) });
});

/** Caleb's family cooks the Pawars' poha together with them and hosts a dinner of it. */
async function cookTogetherNight(t: Backend, cook: Who, asker: Who, answerer: Who) {
  const poha = await recipe(t, cook, { sharedAt: 1 });
  const swapId = await t.mutation(api.community.cookTogether, { sessionToken: asker.sessionToken, recipeId: poha });
  await t.mutation(api.community.respondSwap, { sessionToken: answerer.sessionToken, swapId, accept: true });
  return { poha, night: await host(t, asker, poha) };
}

test("a dinner goes with its dish: blocked dish family, hidden by reports, taken down", async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const salik = await person(t, await family(t, "Mian home"), "Salik", "kid");
  const ngozi = await person(t, await family(t, "Okafor home", "Okafor"), "Ngozi", "cook");
  const { poha, night } = await cookTogetherNight(t, rajani, caleb, shreya);
  const pohaNight = await host(t, rajani, poha);
  const feedDinners = async (who: Who) => (await feed(t, who)).dinners.map((d) => d.dinnerId).sort();
  expect(await feedDinners(serene)).toEqual([night, pohaNight].sort());

  // Serene's family blocks the Pawars: Caleb's dinner of their dish goes too, though Caleb isn't blocked.
  await t.mutation(api.community.block, { sessionToken: serene.sessionToken, kind: "recipe", targetId: poha });
  expect(await feedDinners(serene)).toEqual([]);
  expect(await dinner(t, serene, night)).toBeNull();
  await expect(join(t, serene, night)).rejects.toThrow("isn't happening");
  await expect(report(t, serene, "dinner", night)).rejects.toThrow("isn't happening"); // can't see it, can't report it

  // Two families' reports hide the dish: every dinner of it goes, for everyone but its host's family.
  for (const who of [salik, ngozi]) expect(await feedDinners(who)).toEqual([night, pohaNight].sort());
  await report(t, salik, "recipe", poha);
  await report(t, ngozi, "recipe", poha);
  expect(await feedDinners(ngozi)).toEqual([]);
  const third = await person(t, await family(t, "Santos home", "Santos"), "Rey", "cook");
  expect(await feedDinners(third)).toEqual([]);
  expect(await dinner(t, third, night)).toBeNull();
  await expect(join(t, third, night)).rejects.toThrow("isn't happening");
  expect(await dinner(t, caleb, night)).toMatchObject({ ours: true });

  // Kept after review it's back; taken down it's gone again, and so are its dinners.
  await t.mutation(internal.reports.review, { kind: "recipe", targetId: poha, keep: true });
  expect(await feedDinners(third)).toEqual([night, pohaNight].sort());
  await t.mutation(internal.reports.review, { kind: "recipe", targetId: poha, keep: false });
  expect(await feedDinners(third)).toEqual([]);
  await expect(join(t, third, night)).rejects.toThrow("isn't happening");
});

test("an invite link is only for those who can still see the dinner, and stops once its dish is hidden", async () => {
  const { t, rajani, serene, serenesMom, caleb } = await world();
  const salik = await person(t, await family(t, "Mian home"), "Salik", "kid");
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const dumplings = await recipe(t, serenesMom, { title: "Dumplings", sharedAt: 2 });
  const pohaNight = await host(t, rajani, poha);
  for (const guest of [serene, caleb]) {
    const requestId = await join(t, guest, pohaNight);
    await t.mutation(api.dinners.respond, { sessionToken: rajani.sessionToken, requestId, accept: true });
  }
  const token = (who: Who) => t.mutation(internal.dinners.inviteToken, { sessionToken: who.sessionToken, dinnerId: pohaNight, fresh: "f".repeat(43) });
  const link = await token(rajani);
  expect(await token(serene)).toBe(link);

  // The Pawars block Serene's family: her link stops; Caleb's still works.
  await t.mutation(api.community.block, { sessionToken: rajani.sessionToken, kind: "recipe", targetId: dumplings });
  await expect(token(serene)).rejects.toThrow("isn't happening");
  expect(await token(caleb)).toBe(link);

  // Two families' reports hide the dish: the guest's link stops, and the public page no longer opens.
  const open = () => t.mutation(internal.dinners.openInvite, { token: link, deviceId: "device-0123456789abcdef" });
  expect(await open()).toMatchObject({ dish: "Kanda Poha" });
  await report(t, salik, "recipe", poha);
  await report(t, await person(t, await family(t, "Okafor home", "Okafor"), "Ngozi", "cook"), "recipe", poha);
  await expect(token(caleb)).rejects.toThrow("isn't happening");
  expect(await token(rajani)).toBe(link); // the host's own family still can
  expect(await open()).toBeNull();
});

test("only what you can see now can be reported or blocked", async () => {
  const { t, rajani, serene, serenesMom } = await world();
  const privateDal = await recipe(t, rajani, { title: "Private Dal" });
  await expect(report(t, serene, "recipe", privateDal)).rejects.toThrow("isn't shared anymore");
  await expect(t.mutation(api.community.block, { sessionToken: serene.sessionToken, kind: "recipe", targetId: privateDal })).rejects.toThrow("isn't shared anymore");
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const pohaNight = await host(t, rajani, poha);
  await t.run((ctx) => ctx.db.patch("dinners", pohaNight, { status: "cancelled" }));
  await expect(report(t, serene, "dinner", pohaNight)).rejects.toThrow("isn't happening anymore");
  // A family that already reported it may say so again (nothing new), though it no longer sees it.
  await report(t, serene, "recipe", poha);
  await report(t, serenesMom, "recipe", poha);
  expect(await reports(t)).toHaveLength(1);
});

test("a block works both ways: no dishes, dinners or asks between the two families", async () => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const dumplings = await recipe(t, serenesMom, { title: "Dumplings", sharedAt: 2 });
  const pohaNight = await host(t, rajani, poha);
  const dumplingNight = await host(t, serenesMom, dumplings);
  const swapId = await t.mutation(api.community.requestSwap, { sessionToken: shreya.sessionToken, recipeId: dumplings, myRecipeId: poha });
  const askId = await join(t, shreya, dumplingNight);

  await expect(t.mutation(api.community.block, { sessionToken: serene.sessionToken, kind: "recipe", targetId: dumplings })).rejects.toThrow("your family's");
  await t.mutation(api.community.block, { sessionToken: serene.sessionToken, kind: "recipe", targetId: poha });
  await t.mutation(api.community.block, { sessionToken: serenesMom.sessionToken, kind: "dinner", targetId: pohaNight }); // again: nothing new

  expect(await dishes(t, serene)).toEqual(["Dumplings"]);
  expect(await dishes(t, shreya)).toEqual(["Kanda Poha"]);
  expect((await feed(t, serene)).dinners).toEqual([]);
  expect((await feed(t, shreya)).dinners).toEqual([]);
  expect(await view(t, serene, poha)).toBeNull();
  expect(await view(t, rajani, dumplings)).toBeNull();
  expect(await dinner(t, serene, pohaNight)).toBeNull();
  expect(await dinner(t, shreya, dumplingNight)).toBeNull();
  expect(await t.query(api.dinners.mine, { sessionToken: shreya.sessionToken })).toEqual([]);
  // Caleb's family still sees both.
  expect(await dishes(t, caleb)).toEqual(["Dumplings", "Kanda Poha"]);

  // New asks either way are refused; the open ones are gone from both lists and can't be answered.
  await expect(t.mutation(api.community.requestSwap, { sessionToken: rajani.sessionToken, recipeId: dumplings })).rejects.toThrow("isn't shared");
  await expect(t.mutation(api.community.cookTogether, { sessionToken: serene.sessionToken, recipeId: poha })).rejects.toThrow("isn't shared");
  await expect(join(t, serene, pohaNight)).rejects.toThrow("isn't happening");
  await expect(join(t, rajani, dumplingNight)).rejects.toThrow("isn't happening");
  await expect(t.mutation(api.community.respondSwap, { sessionToken: serene.sessionToken, swapId, accept: true })).rejects.toThrow("isn't open");
  expect(await t.query(api.community.mySwaps, { sessionToken: shreya.sessionToken })).toEqual([]);
  expect(await t.query(api.community.mySwaps, { sessionToken: serene.sessionToken })).toEqual([]);
  expect((await dinner(t, serenesMom, dumplingNight))?.requests).toEqual([]);
  await expect(t.mutation(api.dinners.respond, { sessionToken: serenesMom.sessionToken, requestId: askId, accept: true })).rejects.toThrow("isn't open");

  // Only the family that blocked sees it; the team hears about it once.
  const list = await t.query(api.community.blocked, { sessionToken: serenesMom.sessionToken });
  expect(list).toEqual([{ blockId: expect.any(String), familyName: "The Pawar family" }]);
  expect(await t.query(api.community.blocked, { sessionToken: rajani.sessionToken })).toEqual([]);
  expect((await reports(t)).map((r) => [r.kind, r.targetId, r.reporterFamilyId])).toEqual([["family", rajani.familyId, serene.familyId]]);

  // Their side can't lift it; ours can, and everything comes back.
  await t.mutation(api.community.unblock, { sessionToken: rajani.sessionToken, blockId: list[0].blockId });
  expect(await dishes(t, shreya)).toEqual(["Kanda Poha"]);
  await t.mutation(api.community.unblock, { sessionToken: serene.sessionToken, blockId: list[0].blockId });
  expect(await dishes(t, shreya)).toEqual(["Dumplings", "Kanda Poha"]);
  expect((await t.query(api.community.mySwaps, { sessionToken: serene.sessionToken })).map((s) => s.swapId)).toEqual([swapId]);
});

test("the word filter catches slurs, explicit words and threats, and lets dish words in any language through", () => {
  for (const bad of ["You FUCKING idiot", "nïgger", "I'll kill you", "go kill yourself", "heil hitler", "a whore", "kys"]) {
    expect([bad, flagged(bad)]).toEqual([bad, true]);
  }
  const fine = [
    "Kanda Poha", "कांदा पोहे", "番茄炒蛋", "Phở bò", "Bánh xèo", "Thịt kho tộ", "Tteok-gook", "Miyeok gook", "Pav bhaji",
    "Fesenjān", "Pastel de nata", "Paki-hugas ang bigas", "Tío Kike's paella", "Kaffir lime leaves", "Chinkiang vinegar",
    "Rapeseed oil", "Spotted Dick", "Cock-a-leekie", "Shiitake", "Retard the dough overnight", "Scunthorpe sausages",
    "Kill the heat once it boils", "This chili will kill you, it's that good", "Chicken breast and thighs",
  ];
  for (const ok of fine) expect([ok, flagged(ok)]).toEqual([ok, false]);
  // A step quote it catches is never on the card; the clean ones still can be.
  expect(quoteChoices([{ order: 1, quote: "Don't fucking burn it." }, { order: 2, quote: "Wait till the seeds dance." }])).toEqual(["Wait till the seeds dance."]);
});

test("a recipe or dinner the filter catches stays with the family; the feed leaves one out as a backstop", async () => {
  const { t, rajani, shreya, serene } = await world();
  const bad = await recipe(t, rajani, { title: "Fucking Good Poha" });
  await expect(t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId: bad, on: true })).rejects.toThrow(NOT_SHAREABLE);
  await expect(t.mutation(api.shareRequests.ask, { sessionToken: rajani.sessionToken, recipeId: bad })).rejects.toThrow(NOT_SHAREABLE);
  expect((await t.run((ctx) => ctx.db.get("recipes", bad)))?.sharedAt).toBeUndefined();

  // Shared before the filter (an older card): only its own family sees it.
  const steps = [{ order: 1, title: "Stir", text: "Stir it, motherfucker.", moment: { startS: 0, endS: 5 } }];
  const old = await recipe(t, rajani, { title: "Old Poha", steps, sharedAt: 1 });
  expect(await dishes(t, serene)).toEqual([]);
  expect(await view(t, serene, old)).toBeNull();
  expect(await dishes(t, shreya)).toEqual(["Old Poha"]);

  // Normal text in her own words shares as before.
  const good = await recipe(t, rajani, { title: "Kanda Poha (कांदा पोहे)" });
  await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId: good, on: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await dishes(t, serene)).toEqual(["Kanda Poha (कांदा पोहे)"]);

  await expect(host(t, rajani, good, "Fuck you kitchen")).rejects.toThrow(NOT_POSTABLE);
  expect(await host(t, rajani, good)).toBeTruthy();
});

test("a Muse card the filter catches goes plain", async () => {
  const { t, rajani } = await world();
  process.env.MUSE_API_KEY = "muse-test";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: '"Rajani\'s fucking great poha."' } }] })));
  const recipeId = await recipe(t, rajani);
  await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.run((ctx) => ctx.db.get("recipes", recipeId)))?.storyCard).toMatchObject({ text: "Rajani's Kanda Poha, from the Pawar family.", usedStories: false });
});

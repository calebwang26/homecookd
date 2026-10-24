import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashToken } from "./lib/auth";
import { DEMO_LOCATION, distanceLabel, milesBetween, roundToGrid } from "./lib/geo";
import { type Backend, newBackend } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.MUSE_API_KEY;
});

type Who = { sessionToken: string; personId: Id<"people">; familyId: Id<"families"> };

async function family(t: Backend, name: string, publicName?: string) {
  return await t.run((ctx) => ctx.db.insert("families", { name, supabaseFamilyId: `test:${name}`, publicName }));
}

async function person(t: Backend, familyId: Id<"families">, name: string, role: "cook" | "kid", approx?: { lat: number; lng: number }): Promise<Who> {
  const sessionToken = `token-${name}-${"x".repeat(24)}`;
  const tokenHash = await hashToken(sessionToken);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", { familyId, supabaseProfileId: `test:${name}`, name, role, approx });
    await ctx.db.insert("sessions", { tokenHash, familyId, personId: id, expiresAt: Date.now() + 86_400_000 });
    return id;
  });
  return { sessionToken, personId, familyId };
}

async function recipe(t: Backend, who: Who, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("recipes", {
      familyId: who.familyId,
      cookId: who.personId,
      title: "Kanda Poha",
      status: "ready",
      libraryId: "lib-poha-secret",
      recipeJsonUrl: "https://storage.googleapis.com/edible-recipes/poha/recipe.json",
      coverUrl: "https://storage.googleapis.com/edible-recipes/poha/poster.jpg",
      steps: [
        { order: 1, title: "Rinse the poha", text: "Rinse it twice.", quote: "Not too long, beta.", quoteOriginal: "जास्त वेळ नको", moment: { startS: 10, endS: 40 } },
        { order: 2, title: "Temper", text: "Mustard seeds in hot oil.", moment: { startS: 50, endS: 90 } },
      ],
      memories: [{ kind: "story", text: "Her mother made this every Sunday in Pune.", moment: { startS: 60, endS: 80 } }],
      memoriesOptIn: false,
      ...extra,
    }),
  );
}

/** Two families: the Pawars (Grandma Rajani + Shreya) and a neighbor, plus Caleb in his own family. */
async function world() {
  const t = newBackend();
  const pawar = await family(t, "Pawar home", "Pawar");
  const rajani = await person(t, pawar, "Rajani", "cook");
  const shreya = await person(t, pawar, "Shreya", "kid");
  const zhang = await family(t, "Zhang home");
  const serene = await person(t, zhang, "Serene", "kid");
  const serenesMom = await person(t, zhang, "Mei", "cook", { lat: DEMO_LOCATION.lat + 0.02, lng: DEMO_LOCATION.lng });
  const wang = await family(t, "Wang home");
  const caleb = await person(t, wang, "Caleb", "kid");
  return { t, rajani, shreya, serene, serenesMom, caleb };
}

test("geo rounds to the grid and labels distances", () => {
  expect(roundToGrid({ lat: 42.36789, lng: -71.09432 })).toEqual({ lat: 42.37, lng: -71.09 });
  expect(milesBetween(DEMO_LOCATION, { lat: DEMO_LOCATION.lat + 0.01, lng: DEMO_LOCATION.lng })).toBeCloseTo(0.69, 1);
  expect(distanceLabel(0)).toBe("In your building");
  expect(distanceLabel(0.6)).toBe("Under a mile");
  expect(distanceLabel(2.4)).toBe("About 2 mi");
});

test("setLocation stores only the rounded location", async () => {
  const { t, caleb } = await world();
  await t.mutation(api.community.setLocation, { sessionToken: caleb.sessionToken, lat: 42.361234, lng: -71.087654, campus: " MIT " });
  const me = await t.run((ctx) => ctx.db.get("people", caleb.personId));
  expect(me?.approx).toEqual({ lat: 42.36, lng: -71.09 });
  expect(me?.campus).toBe("MIT");
});

test("only the recipe's own cook can share it; the story card falls back without Muse", async () => {
  const { t, rajani, shreya, serenesMom } = await world();
  const recipeId = await recipe(t, rajani);
  await expect(t.mutation(api.community.setShare, { sessionToken: shreya.sessionToken, recipeId, on: true })).rejects.toThrow("Only the cook");
  await expect(t.mutation(api.community.setShare, { sessionToken: serenesMom.sessionToken, recipeId, on: true })).rejects.toThrow("isn't here");

  await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  let r = await t.run((ctx) => ctx.db.get("recipes", recipeId));
  expect(r?.sharedAt).toBeTypeOf("number");
  expect(r?.storyCard?.text).toBe("Rajani's Kanda Poha, from the Pawar family.");

  await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: false });
  r = await t.run((ctx) => ctx.db.get("recipes", recipeId));
  expect(r?.sharedAt).toBeUndefined();
  expect(r?.storyCard?.text).toBeTruthy();
});

test("Muse gets the stories only when the cook opted in", async () => {
  const { t, rajani } = await world();
  process.env.MUSE_API_KEY = "muse-test";
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return Response.json({ choices: [{ message: { content: '"Rajani\'s poha, rinsed quick and tempered with mustard seeds."' } }] });
  }));
  const closed = await recipe(t, rajani);
  const open = await recipe(t, rajani, { memoriesOptIn: true });
  for (const recipeId of [closed, open]) await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(bodies).toHaveLength(2);
  expect(bodies.filter((b) => b.includes("every Sunday in Pune"))).toHaveLength(1);
  const card = await t.run(async (ctx) => (await ctx.db.get("recipes", closed))?.storyCard?.text);
  expect(card).toBe("Rajani's poha, rinsed quick and tempered with mustard seeds.");
});

const FORBIDDEN = ["libraryId", "recipeJsonUrl", "moment", "quote", "memories", "personId", "cookId", "hostId", "familyId", "address", "approx", "storage.googleapis.com", "lib-poha-secret", "Not too long", "every Sunday in Pune", "Baker House, 362"];

test("the feed and the recipe view return only whitelisted fields", async () => {
  const { t, rajani, serene, serenesMom } = await world();
  const poha = await recipe(t, rajani, { memoriesOptIn: true, sharedAt: 1, storyCard: { text: "Rajani's poha.", writtenAt: 1 } });
  const stock = await recipe(t, serenesMom, { title: "Dumplings", coverUrl: "https://homecookd.app/media/stock/dish-dumplings.jpg", sharedAt: 2 });
  await recipe(t, rajani, { title: "Private Dal" }); // not shared
  await t.mutation(api.dinners.create, {
    sessionToken: rajani.sessionToken, recipeId: poha, startsAt: Date.now() + 86_400_000, placeName: "Baker House kitchen", address: "Baker House, 362 Memorial Dr", seats: 4,
  });

  const feed = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(feed.recipes.map((r) => r.dish)).toEqual(["Kanda Poha"]); // Serene's own family's dumplings stay out
  expect(Object.keys(feed.recipes[0]).sort()).toEqual(["cookName", "coverUrl", "dish", "distanceLabel", "familyName", "recipeId", "stepCount", "story"]);
  expect(feed.recipes[0]).toMatchObject({ familyName: "The Pawar family", cookName: "Rajani", distanceLabel: "In your building", coverUrl: null, stepCount: 2 });
  expect(feed.dinners).toHaveLength(1);
  expect(Object.keys(feed.dinners[0]).sort()).toEqual(["dinnerId", "dish", "distanceLabel", "hostName", "placeName", "seatsLeft", "startsAt"]);
  for (const word of FORBIDDEN) expect(JSON.stringify(feed)).not.toContain(word);

  const fromRajani = await t.query(api.community.feed, { sessionToken: rajani.sessionToken, maxMiles: 5 });
  expect(fromRajani.recipes[0]).toMatchObject({ dish: "Dumplings", familyName: "Mei's family", distanceLabel: "About 1 mi", coverUrl: "https://homecookd.app/media/stock/dish-dumplings.jpg" });
  expect((await t.query(api.community.feed, { sessionToken: rajani.sessionToken, maxMiles: 1 })).recipes).toEqual([]);
  expect(stock).toBeTruthy();

  const view = await t.query(api.community.recipe, { sessionToken: serene.sessionToken, recipeId: poha });
  expect(view?.steps).toEqual([
    { order: 1, title: "Rinse the poha", text: "Rinse it twice." },
    { order: 2, title: "Temper", text: "Mustard seeds in hot oil." },
  ]);
  for (const word of FORBIDDEN) expect(JSON.stringify(view)).not.toContain(word);
  const unshared = await recipe(t, rajani, { title: "Secret" });
  expect(await t.query(api.community.recipe, { sessionToken: serene.sessionToken, recipeId: unshared })).toBeNull();
  expect(await t.query(api.community.recipe, { sessionToken: rajani.sessionToken, recipeId: unshared })).not.toBeNull();
});

test("a dinner's address reaches only the host and accepted guests", async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const poha = await recipe(t, rajani);
  const dinnerId = await t.mutation(api.dinners.create, {
    sessionToken: shreya.sessionToken, recipeId: poha, startsAt: Date.now() + 3_600_000, placeName: "Baker House kitchen", address: "Baker House, 362 Memorial Dr", seats: 1,
  });
  const get = (who: Who) => t.query(api.dinners.get, { sessionToken: who.sessionToken, dinnerId });

  let stranger = await get(serene);
  expect(stranger).toMatchObject({ address: null, requests: null, myRequest: null, isHost: false, recipeId: null, placeKind: "campus_kitchen" });

  await expect(t.mutation(api.dinners.requestJoin, { sessionToken: rajani.sessionToken, dinnerId })).rejects.toThrow("your family");
  const requestId = await t.mutation(api.dinners.requestJoin, { sessionToken: serene.sessionToken, dinnerId });
  await expect(t.mutation(api.dinners.requestJoin, { sessionToken: serene.sessionToken, dinnerId })).rejects.toThrow("already");
  stranger = await get(serene);
  expect(stranger).toMatchObject({ address: null, myRequest: { requestId, status: "pending" } });

  const host = await get(shreya);
  expect(host).toMatchObject({ isHost: true, address: "Baker House, 362 Memorial Dr", requests: [{ requestId, guestName: "Serene", status: "pending" }] });
  expect((await get(caleb))?.address).toBeNull();

  await expect(t.mutation(api.dinners.respond, { sessionToken: serene.sessionToken, requestId, accept: true })).rejects.toThrow("Only the host");
  await t.mutation(api.dinners.respond, { sessionToken: shreya.sessionToken, requestId, accept: true });
  expect(await get(serene)).toMatchObject({ address: "Baker House, 362 Memorial Dr", myRequest: { status: "accepted" }, status: "full", seatsLeft: 0 });
  await expect(t.mutation(api.dinners.requestJoin, { sessionToken: caleb.sessionToken, dinnerId })).rejects.toThrow("full");

  const mine = await t.query(api.dinners.mine, { sessionToken: serene.sessionToken });
  expect(mine.map((d) => d.dinnerId)).toEqual([dinnerId]);
});

test("the community seed is idempotent and puts neighbors 0.3–3 mi away", async () => {
  const { t, caleb } = await world();
  expect((await t.mutation(internal.seedCommunity.neighbors, {})).familiesAdded).toBe(8);
  expect((await t.mutation(internal.seedCommunity.neighbors, {})).familiesAdded).toBe(0);
  await t.mutation(internal.seedCommunity.place, { personId: caleb.personId });
  const feed = await t.query(api.community.feed, { sessionToken: caleb.sessionToken });
  expect(feed.recipes).toHaveLength(8);
  expect(feed.recipes.every((r) => r.story && r.coverUrl?.startsWith("https://homecookd.app/media/stock/dish-"))).toBe(true);
  expect(new Set(feed.recipes.map((r) => r.distanceLabel))).toEqual(new Set(["Under a mile", "About 1 mi", "About 2 mi", "About 3 mi"]));
});

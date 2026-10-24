import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashToken } from "./lib/auth";
import { DEMO_LOCATION, distanceLabel, milesBetween, roundToGrid } from "./lib/geo";
import { cleanCulture, parseMuseCard, quoteChoices } from "./lib/storyCard";
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
  expect(r?.storyCard).toMatchObject({ text: "Rajani's Kanda Poha, from the Pawar family.", usedStories: false });

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
  const card = (recipeId: Id<"recipes">) => t.run(async (ctx) => (await ctx.db.get("recipes", recipeId))?.storyCard);
  expect(await card(closed)).toMatchObject({ text: "Rajani's poha, rinsed quick and tempered with mustard seeds.", usedStories: false });
  expect(await card(open)).toMatchObject({ usedStories: true });
});

test("a card written from her stories goes plain once she says no, and sharing again rewrites it", async () => {
  const { t, rajani, serene } = await world();
  delete process.env.MOSS_PROJECT_ID; // setMemoriesOptIn starts a Moss sync; keep it offline
  delete process.env.MOSS_PROJECT_KEY;
  process.env.MUSE_API_KEY = "muse-test";
  const withStory = "Rajani's poha, the one her mother made every Sunday in Pune.";
  const withoutStory = "Rajani's poha, rinsed quick and tempered with mustard seeds.";
  const plain = "Rajani's Kanda Poha, from the Pawar family.";
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    bodies.push(body);
    return Response.json({ choices: [{ message: { content: body.includes("every Sunday in Pune") ? withStory : withoutStory } }] });
  }));
  const recipeId = await recipe(t, rajani, { memoriesOptIn: true });
  const share = async () => {
    await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const seen = async () => ({
    feed: (await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() })).recipes[0]?.story,
    view: (await t.query(api.community.recipe, { sessionToken: serene.sessionToken, recipeId }))?.story,
  });
  const card = () => t.run(async (ctx) => (await ctx.db.get("recipes", recipeId))?.storyCard);

  await share();
  expect(await card()).toMatchObject({ text: withStory, usedStories: true });
  expect(await seen()).toEqual({ feed: withStory, view: withStory });

  await t.mutation(api.recipes.setMemoriesOptIn, { sessionToken: rajani.sessionToken, recipeId, optIn: false });
  expect(await seen()).toEqual({ feed: plain, view: plain });

  await share();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).not.toContain("every Sunday in Pune");
  expect(await card()).toMatchObject({ text: withoutStory, usedStories: false });
  expect(await seen()).toEqual({ feed: withoutStory, view: withoutStory });

  await share(); // the card matches her answer now: Muse isn't asked again
  expect(bodies).toHaveLength(2);
});

// Never in a Community answer. The feed's own `approx` (the grid cell) and `quote` (one step quote on
// the card) are checked by value in the tests below; the recipe view has neither.
const FORBIDDEN = ["libraryId", "recipeJsonUrl", "moment", "quoteOriginal", "जास्त", "memories", "personId", "cookId", "hostId", "familyId", "address", "storage.googleapis.com", "lib-poha-secret", "Not too long", "every Sunday in Pune", "Baker House, 362"];

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
  expect(Object.keys(feed).sort()).toEqual(["dinners", "here", "recipes"]);
  expect(Object.keys(feed.recipes[0]).sort()).toEqual([
    "approx", "cookName", "coverUrl", "culture", "dinner", "dish", "distanceLabel", "familyName", "quote", "recipeId", "stepCount", "story",
  ]);
  expect(feed.recipes[0]).toMatchObject({ familyName: "The Pawar family", cookName: "Rajani", distanceLabel: "In your building", coverUrl: null, stepCount: 2, culture: null, quote: null });
  expect(feed.dinners).toHaveLength(1);
  expect(Object.keys(feed.dinners[0]).sort()).toEqual(["dinnerId", "dish", "distanceLabel", "hostName", "placeName", "seatsLeft", "startsAt"]);
  expect(Object.keys(feed.recipes[0].dinner ?? {}).sort()).toEqual(["dinnerId", "seatsLeft", "startsAt"]);
  for (const word of FORBIDDEN) expect(JSON.stringify(feed)).not.toContain(word);

  const fromRajani = await t.query(api.community.feed, { sessionToken: rajani.sessionToken, maxMiles: 5, now: Date.now() });
  expect(fromRajani.recipes[0]).toMatchObject({ dish: "Dumplings", familyName: "Mei's family", distanceLabel: "About 1 mi", coverUrl: "https://homecookd.app/media/stock/dish-dumplings.jpg" });
  expect((await t.query(api.community.feed, { sessionToken: rajani.sessionToken, maxMiles: 1, now: Date.now() })).recipes).toEqual([]);
  expect(stock).toBeTruthy();

  const view = await t.query(api.community.recipe, { sessionToken: serene.sessionToken, recipeId: poha });
  expect(view?.steps).toEqual([
    { order: 1, title: "Rinse the poha", text: "Rinse it twice." },
    { order: 2, title: "Temper", text: "Mustard seeds in hot oil." },
  ]);
  for (const word of [...FORBIDDEN, "quote", "approx"]) expect(JSON.stringify(view)).not.toContain(word);
  const unshared = await recipe(t, rajani, { title: "Secret" });
  expect(await t.query(api.community.recipe, { sessionToken: serene.sessionToken, recipeId: unshared })).toBeNull();
  expect(await t.query(api.community.recipe, { sessionToken: rajani.sessionToken, recipeId: unshared })).not.toBeNull();
});

test("the feed shows only our own stock and cover photos", async () => {
  const { t, rajani, serene } = await world();
  const covers = {
    Stock: "https://homecookd.app/media/stock/dish-dal.jpg",
    Cover: "https://homecookd.app/media/app-covers/poha.webp",
    Upload: "https://homecookd.app/media/uploads/x.jpg",
    Poster: "https://storage.googleapis.com/edible-recipes/poha/poster.jpg",
    Lookalike: "https://homecookd.app.example.com/media/stock/dish-dal.jpg",
  };
  for (const [title, coverUrl] of Object.entries(covers)) await recipe(t, rajani, { title, coverUrl, sharedAt: 1 });
  const feed = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(Object.fromEntries(feed.recipes.map((r) => [r.dish, r.coverUrl]))).toEqual({
    Stock: covers.Stock,
    Cover: covers.Cover,
    Upload: null,
    Poster: null,
    Lookalike: null,
  });
});

test("the feed leaves out past and full dinners", async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const soon = Date.now() + 3_600_000;
  const host = (startsAt: number, seats: number) =>
    t.mutation(api.dinners.create, { sessionToken: rajani.sessionToken, recipeId: poha, startsAt, placeName: "Baker House kitchen", address: "Baker House, 362 Memorial Dr", seats });
  const first = await host(soon, 1);
  const later = await host(soon + 3_600_000, 2);
  const open = async (now: number) => (await t.query(api.community.feed, { sessionToken: serene.sessionToken, now })).dinners.map((d) => d.dinnerId);

  expect(await open(Date.now())).toEqual([first, later]);
  expect(await open(soon)).toEqual([later]); // starting right now counts as past

  const requestId = await t.mutation(api.dinners.requestJoin, { sessionToken: serene.sessionToken, dinnerId: first });
  await t.mutation(api.dinners.respond, { sessionToken: rajani.sessionToken, requestId, accept: true });
  expect(await open(Date.now())).toEqual([later]); // every seat taken
});

test("a dinner's address reaches only the host and accepted guests", async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const poha = await recipe(t, rajani);
  const dinner = { recipeId: poha, startsAt: Date.now() + 3_600_000, placeName: "Baker House kitchen", address: "Baker House, 362 Memorial Dr", seats: 1 };
  // The dish name goes to every neighbor's feed, so the cook has to share the recipe first.
  await expect(t.mutation(api.dinners.create, { sessionToken: shreya.sessionToken, ...dinner })).rejects.toThrow("Share this recipe first.");
  await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId: poha, on: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const dinnerId = await t.mutation(api.dinners.create, { sessionToken: shreya.sessionToken, ...dinner });
  const get = (who: Who) => t.query(api.dinners.get, { sessionToken: who.sessionToken, dinnerId });

  let stranger = await get(serene);
  expect(stranger).toMatchObject({ address: null, requests: null, myRequest: null, isHost: false, recipeId: poha, placeKind: "campus_kitchen" });

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

  // Unsharing later keeps the dinner, but the recipe's text no longer opens for guests.
  await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId: poha, on: false });
  expect((await get(serene))?.recipeId).toBeNull();
});

test("the community seed is idempotent and puts neighbors 0.3–3 mi away", async () => {
  const { t, caleb } = await world();
  expect((await t.mutation(internal.seedCommunity.neighbors, {})).familiesAdded).toBe(8);
  expect((await t.mutation(internal.seedCommunity.neighbors, {})).familiesAdded).toBe(0);
  await t.mutation(internal.seedCommunity.place, { personId: caleb.personId });
  const feed = await t.query(api.community.feed, { sessionToken: caleb.sessionToken, now: Date.now() });
  expect(feed.recipes).toHaveLength(8);
  expect(feed.recipes.every((r) => r.story && r.coverUrl?.startsWith("https://homecookd.app/media/stock/dish-"))).toBe(true);
  expect(new Set(feed.recipes.map((r) => r.distanceLabel))).toEqual(new Set(["Under a mile", "About 1 mi", "About 2 mi", "About 3 mi"]));
  // Every seeded card has a culture and her line (web/src/content/recipes.ts feelQuote), which is also a step quote.
  const jollof = feed.recipes.find((r) => r.dish === "Jollof Rice");
  expect(jollof).toMatchObject({ culture: "Nigerian", quote: "let the bottom catch a little, that's the best part" });
  expect(feed.recipes.every((r) => r.culture && r.quote)).toBe(true);
  const onGrid = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
  expect(feed.recipes.every((r) => onGrid(r.approx.lat) && onGrid(r.approx.lng))).toBe(true);
});

test("the feed places each dish on its cook's grid cell, never finer, and the viewer at their own", async () => {
  const { t, rajani, serene, serenesMom } = await world();
  // A finer position than the grid (written around setLocation) still comes back as the grid cell.
  await t.run((ctx) => ctx.db.patch("people", serenesMom.personId, { approx: { lat: 42.36789, lng: -71.09432 } }));
  await recipe(t, serenesMom, { title: "Dumplings", sharedAt: 2 });
  await recipe(t, rajani, { sharedAt: 1 }); // Rajani never set a location: the venue
  const salik = await world2(t);
  const fromSalik = await t.query(api.community.feed, { sessionToken: salik.sessionToken, now: Date.now() });
  expect(fromSalik.here).toEqual(roundToGrid(DEMO_LOCATION));
  expect(Object.fromEntries(fromSalik.recipes.map((r) => [r.dish, r.approx]))).toEqual({
    "Kanda Poha": roundToGrid(DEMO_LOCATION),
    Dumplings: { lat: 42.37, lng: -71.09 },
  });
  expect(JSON.stringify(fromSalik)).not.toContain("42.367");
  const fromSerene = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(fromSerene.here).toEqual(DEMO_LOCATION);
});

/** One more viewer, in a family of their own (Salik). */
async function world2(t: Backend) {
  const mian = await family(t, "Mian home");
  return await person(t, mian, "Salik", "kid");
}

test("Muse picks one of her step quotes by number, never a story, and names the culture", async () => {
  const { t, rajani } = await world();
  process.env.MUSE_API_KEY = "muse-test";
  const replies = [
    { story: "Rajani's poha, rinsed quick and tempered with mustard seeds.", culture: "Maharashtrian", quote: 2 },
    // A reply that tries to quote her story, or picks a number that isn't on the list, gets her first quote.
    { story: "Rajani's poha for a slow Sunday.", culture: "Indian", quote: "Her mother made this every Sunday in Pune." },
    { story: "Rajani's poha, the Pawar way.", culture: "a dish from many places, honestly", quote: 9 },
  ];
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(replies[bodies.length - 1]) } }] });
  }));
  const steps = [
    { order: 1, title: "Rinse the poha", text: "Rinse it twice.", quote: "Not too long, beta.", moment: { startS: 10, endS: 40 } },
    { order: 2, title: "Temper", text: "Mustard seeds in hot oil.", quote: "Wait till the seeds start to dance.", moment: { startS: 50, endS: 90 } },
  ];
  const card = async () => {
    const recipeId = await recipe(t, rajani, { steps });
    await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return await t.run(async (ctx) => (await ctx.db.get("recipes", recipeId))?.storyCard);
  };
  expect(await card()).toMatchObject({ culture: "Maharashtrian", quote: "Wait till the seeds start to dance." });
  expect(await card()).toMatchObject({ culture: "Indian", quote: "Not too long, beta." });
  const third = await card();
  expect(third).toMatchObject({ text: "Rajani's poha, the Pawar way.", quote: "Not too long, beta." });
  expect(third?.culture).toBeUndefined();
  // memoriesOptIn is false: her story never reached Muse, and no card holds it.
  expect(bodies.some((b) => b.includes("every Sunday in Pune"))).toBe(false);
  expect(bodies[0]).toContain("1. Not too long, beta.");
  expect(bodies[0]).toContain("json_schema");
});

test("without Muse the card has no culture and her first step quote, or none", async () => {
  const { t, rajani, serene } = await world();
  const withQuote = await recipe(t, rajani);
  const noQuote = await recipe(t, rajani, { title: "Plain Rice", steps: [{ order: 1, title: "Boil", text: "Boil it.", moment: { startS: 0, endS: 5 } }] });
  for (const recipeId of [withQuote, noQuote]) await t.mutation(api.community.setShare, { sessionToken: rajani.sessionToken, recipeId, on: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const feed = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(Object.fromEntries(feed.recipes.map((r) => [r.dish, [r.culture, r.quote]]))).toEqual({
    "Kanda Poha": [null, "Not too long, beta."],
    "Plain Rice": [null, null],
  });
  // A card quote that's no longer one of her step quotes (the recipe was redone) stops showing.
  await t.run((ctx) => ctx.db.patch("recipes", withQuote, { steps: [{ order: 1, title: "Rinse", text: "Rinse it.", moment: { startS: 0, endS: 5 } }] }));
  const again = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(again.recipes.find((r) => r.dish === "Kanda Poha")?.quote).toBeNull();
});

test("a culture read from her stories goes with them once she says no", async () => {
  const { t, rajani, serene } = await world();
  const recipeId = await recipe(t, rajani, {
    memoriesOptIn: false,
    sharedAt: 1,
    storyCard: { text: "Rajani's poha, the one her mother made in Pune.", writtenAt: 1, usedStories: true, culture: "Maharashtrian", quote: "Not too long, beta." },
  });
  const row = (await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() })).recipes[0];
  expect(row).toMatchObject({ recipeId, story: "Rajani's Kanda Poha, from the Pawar family.", culture: null, quote: "Not too long, beta." });
});

test("a dish's open dinner rides on its feed row", async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  const soon = Date.now() + 3_600_000;
  const host = (startsAt: number) =>
    t.mutation(api.dinners.create, { sessionToken: rajani.sessionToken, recipeId: poha, startsAt, placeName: "Baker House kitchen", address: "Baker House, 362 Memorial Dr", seats: 3 });
  await host(soon + 3_600_000);
  const first = await host(soon);
  const row = async (now: number) => (await t.query(api.community.feed, { sessionToken: serene.sessionToken, now })).recipes[0];
  expect((await row(Date.now())).dinner).toEqual({ dinnerId: first, startsAt: soon, seatsLeft: 3 });
  expect((await row(soon)).dinner?.startsAt).toBe(soon + 3_600_000); // the first one has started
  expect((await row(soon + 3_600_000)).dinner).toBeNull();
});

test("floormates' families get one pre-written dish each and cluster in your building", async () => {
  const { t, shreya, serene, serenesMom, caleb } = await world();
  const salik = await world2(t);
  await t.mutation(internal.seedCommunity.neighbors, {});
  const dish = (familyId: Id<"families">, name: string, quote: string) =>
    t.mutation(internal.seedCommunity.floormateDish, {
      familyId,
      dish: name,
      culture: "Chinese",
      quote,
      coverUrl: "https://homecookd.app/media/stock/dish-dumplings.jpg",
      steps: [
        { title: "Fold", text: "Fold each one in half.", quote },
        { title: "Steam", text: "Steam for ten minutes." },
      ],
    });
  const zhang = await dish(serene.familyId, "Pork Dumplings", "pleat it like a little purse");
  expect(zhang.cookName).toBe("Mei"); // the family's cook, not the kid who signed in first
  expect((await dish(serene.familyId, "Pork Dumplings", "pleat it like a little purse")).recipeId).toBe(zhang.recipeId); // again: the same dish
  await dish(caleb.familyId, "Tomato Egg", "softer than you think, then off the heat");
  await dish(salik.familyId, "Chicken Karahi", "let the tomatoes melt all the way");
  for (const who of [serene, caleb, salik]) await t.mutation(internal.seedCommunity.place, { familyId: who.familyId });
  expect((await t.run((ctx) => ctx.db.get("people", serenesMom.personId)))?.approx).toEqual(DEMO_LOCATION);

  const feed = await t.query(api.community.feed, { sessionToken: shreya.sessionToken, now: Date.now() });
  const building = feed.recipes.filter((r) => r.distanceLabel === "In your building");
  expect(building.map((r) => r.dish).sort()).toEqual(["Chicken Karahi", "Pork Dumplings", "Tomato Egg"]);
  expect(new Set(building.map((r) => JSON.stringify(r.approx)))).toEqual(new Set([JSON.stringify(feed.here)]));
  expect(feed.recipes.filter((r) => JSON.stringify(r.approx) === JSON.stringify(feed.here))).toHaveLength(3); // no neighbor shares the cell
  expect(building.find((r) => r.dish === "Pork Dumplings")).toMatchObject({
    cookName: "Mei", culture: "Chinese", quote: "pleat it like a little purse", story: "Mei's Pork Dumplings.", coverUrl: "https://homecookd.app/media/stock/dish-dumplings.jpg",
  });
  // It's the family's own text-only row (no recipe.json, so the app's library leaves it out).
  const list = await t.query(api.recipes.list, { sessionToken: serene.sessionToken });
  expect(list.filter((r) => r.title === "Pork Dumplings").map((r) => [r.libraryId, r.recipeJsonUrl, r.sharedAt !== undefined])).toEqual([
    ["seed:floormate", undefined, true],
  ]);

  const steps = [{ title: "Cook", text: "Cook it.", quote: "softer than you think" }];
  await expect(
    t.mutation(internal.seedCommunity.floormateDish, { familyId: caleb.familyId, dish: "Tomato Egg", quote: "a quote she never said", steps }),
  ).rejects.toThrow("one of the steps' quotes");
  await expect(
    t.mutation(internal.seedCommunity.floormateDish, { familyId: caleb.familyId, dish: "Tomato Egg", coverUrl: "https://example.com/x.jpg", steps }),
  ).rejects.toThrow("coverUrl");
});

test("story card rules: her quotes, the culture label, Muse's reply", () => {
  const steps = [
    { order: 2, quote: "“Wait till the seeds start to dance.”" },
    { order: 1, quote: "Not too long, beta." },
    { order: 3, quote: "Okay." },
    // Over 20 words: only its short sentence can be quoted.
    { order: 4, quote: "Stir it slowly and keep on stirring the whole time until all of the onions turn soft and golden brown at the edges. Then the poha goes in." },
  ];
  expect(quoteChoices(steps)).toEqual(["Not too long, beta.", "Wait till the seeds start to dance.", "Then the poha goes in."]);
  expect(cleanCulture(" Polish  American ")).toBe("Polish American");
  expect(["", "Unknown", "family", "Indo-Chinese fusion food, mostly", "<b>Thai</b>", 3].map(cleanCulture)).toEqual([null, null, null, null, null, null]);
  expect(parseMuseCard('{"story": "A sentence.", "culture": "Thai", "quote": 1}', ["Mine."])).toEqual({ text: "A sentence.", culture: "Thai", quote: "Mine." });
  expect(parseMuseCard('"Just a sentence."', [])).toEqual({ text: "Just a sentence.", culture: null, quote: null });
  expect(parseMuseCard("```json\n{\"story\": \"Fenced.\", \"culture\": \"\", \"quote\": 0}\n```", ["First one."])).toEqual({ text: "Fenced.", culture: null, quote: "First one." });
  expect(parseMuseCard('{"story": "' + "word ".repeat(26) + '"}', [])).toBeNull();
  expect(parseMuseCard('{"culture": "Thai"}', [])).toBeNull();
});

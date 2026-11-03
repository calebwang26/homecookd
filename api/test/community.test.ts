// convex/community.test.ts on the new api: the feed, the recipe view and the dinner page. Titles are Convex's where the meaning is the same.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { DEMO_LOCATION, distanceLabel, milesBetween, roundToGrid } from "../src/modules/community/geo.js";
import { quoteChoices, quoteTranslated } from "../src/modules/community/storyCard.js";
import { ADDRESS, call, family, feed, host, join, ok, person, recipe, refusedWith, respond, setShared, startIt, tryHost, view, type Who, world, dinner } from "./communityHelpers.js";
import { close, hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;

test("geo rounds to the grid and labels distances", () => {
  assert.deepEqual(roundToGrid({ lat: 42.36789, lng: -71.09432 }), { lat: 42.37, lng: -71.09 });
  close(milesBetween(DEMO_LOCATION, { lat: DEMO_LOCATION.lat + 0.01, lng: DEMO_LOCATION.lng }), 0.69, 1);
  assert.equal(distanceLabel(0), "In your building");
  assert.equal(distanceLabel(0.6), "Under a mile");
  assert.equal(distanceLabel(2.4), "About 2 mi");
});

// Never in a Community answer. The feed's own `approx` (the grid cell) and `quote` (one step quote on the card) are checked by value in the tests below; the recipe view has neither.
const FORBIDDEN = ["libraryId", "library_id", "recipeJsonUrl", "recipe_json", "moment", "quoteOriginal", "जास्त", "memories", "personId", "cookId", "hostId", "familyId", "address", "lib-poha-secret", "Not too long", "every Sunday in Pune", "Baker House, 362", "Pawar home", "Zhang home", "Wang home"];

test("the feed and the recipe view return only whitelisted fields", { skip }, async () => {
  const { t, rajani, serene, serenesMom } = await world();
  const poha = await recipe(rajani, { memoriesOptIn: true, sharedAt: 1, card: { text: "Rajani's poha." } });
  await recipe(serenesMom, { title: "Dumplings", coverStock: "stock/dish-dumplings.jpg", sharedAt: 2 });
  await recipe(rajani, { title: "Private Dal" }); // not shared
  await host(t, rajani, poha, { startsAt: Date.now() + 86_400_000 });

  const seen = await feed(t, serene);
  // Serene's own family's shared dumplings show too, marked as hers.
  assert.deepEqual(seen.recipes.map((r: any) => [r.dish, r.ours]), [["Kanda Poha", false], ["Dumplings", true]]);
  assert.deepEqual(Object.keys(seen).sort(), ["dinners", "dinnersCursor", "here", "nextCursor", "recipes"]);
  assert.deepEqual(Object.keys(seen.recipes[0]).sort(), [
    "approx", "cookName", "coverUrl", "culture", "dinner", "dish", "distanceLabel", "familyName", "ours", "quote", "quoteTranslated", "recipeId", "stepCount", "story",
  ]);
  like(seen.recipes[0], { familyName: "The Pawar family", cookName: "Rajani", distanceLabel: "In your building", coverUrl: null, stepCount: 2, culture: null, quote: null, quoteTranslated: false });
  assert.equal(seen.dinners.length, 1);
  assert.deepEqual(Object.keys(seen.dinners[0]).sort(), ["dinnerId", "dish", "distanceLabel", "hostName", "placeName", "seatsLeft", "startsAt"]);
  assert.deepEqual(Object.keys(seen.recipes[0].dinner ?? {}).sort(), ["dinnerId", "distanceLabel", "hostName", "seatsLeft", "startsAt"]);
  for (const word of FORBIDDEN) assert.ok(!JSON.stringify(seen).includes(word), word);

  const fromRajani = await feed(t, rajani, "?maxMiles=5");
  const dish = (name: string) => fromRajani.recipes.find((r: any) => r.dish === name);
  like(dish("Dumplings"), { ours: false, familyName: "Mei's family", distanceLabel: "About 1 mi", coverUrl: "https://homecookd.app/media/stock/dish-dumplings.jpg" });
  like(dish("Kanda Poha"), { ours: true, dinner: null }); // her own dinner is under "You", not on the dish
  const close1 = await feed(t, rajani, "?maxMiles=1");
  assert.deepEqual(close1.recipes.map((r: any) => r.dish), ["Kanda Poha"]);

  const opened = (await ok(view(t, serene, poha)));
  assert.deepEqual(opened.steps, [
    { order: 1, title: "Rinse the poha", text: "Rinse it twice." },
    { order: 2, title: "Temper", text: "Mustard seeds in hot oil." },
  ]);
  for (const word of [...FORBIDDEN, "quote", "approx"]) assert.ok(!JSON.stringify(opened).includes(word), word);
  const unshared = await recipe(rajani, { title: "Secret" });
  assert.equal((await view(t, serene, unshared)).status, 404);
  assert.equal((await view(t, rajani, unshared)).status, 200);
});

test("the feed shows only our own stock and cover photos", { skip }, async () => {
  const { rajani, serene, t } = await world();
  await recipe(rajani, { title: "Stock", coverStock: "stock/dish-dal.jpg", sharedAt: 1 });
  await recipe(rajani, { title: "Cover", coverStock: "app-covers/poha.webp", sharedAt: 2 });
  await recipe(rajani, { title: "Poster", coverKey: "edible-recipes/poha/poster.jpg", sharedAt: 3 });
  const seen = await feed(t, serene);
  assert.deepEqual(Object.fromEntries(seen.recipes.map((r: any) => [r.dish, r.coverUrl])), {
    Stock: "https://homecookd.app/media/stock/dish-dal.jpg",
    Cover: "https://homecookd.app/media/app-covers/poha.webp",
    Poster: null,
  });
  // Convex's other two cases, an upload and a lookalike host, can't be stored: the check is now on the column.
  for (const path of ["uploads/x.jpg", "https://homecookd.app.example.com/media/stock/dish-dal.jpg"]) {
    await assert.rejects(recipe(rajani, { title: "Bad", coverStock: path, sharedAt: 4 }), /cover_stock_path/);
  }
});

test("the feed leaves out past and full dinners", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const soon = Date.now() + 3_600_000;
  const first = await host(t, rajani, poha, { startsAt: soon, seats: 1 });
  const later = await host(t, rajani, poha, { startsAt: soon + 3_600_000, seats: 2 });
  const third = await host(t, rajani, poha, { startsAt: soon + 7_200_000, seats: 2 });
  const open = async () => (await feed(t, serene)).dinners.map((d: any) => d.dinnerId);

  assert.deepEqual(await open(), [first, later, third]);
  const { requestId } = await ok(join(t, serene, first));
  await ok(respond(t, rajani, requestId, true));
  assert.deepEqual(await open(), [later, third]); // every seat taken
  await startIt(later);
  assert.deepEqual(await open(), [third]); // starting counts as past
});

test("dinners that have passed don't crowd out new ones", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  // Convex's feed reads the oldest 100 open dinners, so these would be all it ever saw.
  await db().query(
    `insert into dinners (host_id, host_family_id, recipe_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status)
     select $1, $2, $3, 'Old', now() - make_interval(hours => n), 'home', 'Old kitchen', 'x', 42.36, -71.09, 2, 'open' from generate_series(1, 150) n`,
    [rajani.personId, rajani.familyId, poha],
  );
  const coming = await host(t, rajani, poha);
  const seen = await feed(t, serene);
  assert.deepEqual(seen.dinners.map((d: any) => d.dinnerId), [coming]);
  assert.equal(seen.recipes[0].dinner.dinnerId, coming);
});

test("a dinner's address reaches only the host and accepted guests", { skip }, async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const poha = await recipe(rajani);
  // The dish name goes to every neighbor's feed, so the cook has to share the recipe first.
  await refusedWith(tryHost(t, shreya, poha, { seats: 1 }), 409, "Share this recipe first.");
  await setShared(poha, true);
  const dinnerId = await host(t, shreya, poha, { seats: 1 });
  const get = async (who: typeof rajani) => (await dinner(t, who, dinnerId)).data;

  like(await get(serene), { address: null, requests: null, myRequest: null, isHost: false, recipeId: poha, placeKind: "campus_kitchen" });

  await refusedWith(join(t, rajani, dinnerId), 409, /your family/);
  const { requestId } = await ok(join(t, serene, dinnerId));
  await refusedWith(join(t, serene, dinnerId), 409, /already/);
  like(await get(serene), { address: null, myRequest: { requestId, status: "pending" } });

  like(await get(shreya), { isHost: true, address: ADDRESS, requests: [{ requestId, guestName: "Serene", status: "pending" }] });
  assert.equal((await get(caleb)).address, null);
  assert.equal((await get(rajani)).address, null); // the host's family isn't the host

  await refusedWith(respond(t, serene, requestId, true), 404, /Only the host/);
  await ok(respond(t, shreya, requestId, true));
  like(await get(serene), { address: ADDRESS, myRequest: { status: "accepted" }, status: "full", seatsLeft: 0 });
  await refusedWith(join(t, caleb, dinnerId), 409, /full/);

  const mine = await ok(call(t, serene, "GET", "/v1/dinners/mine"));
  assert.deepEqual(mine.dinners.map((d: any) => d.dinnerId), [dinnerId]);

  // Unsharing later keeps the dinner, but the recipe's text no longer opens for guests.
  await setShared(poha, false);
  assert.equal((await get(serene)).recipeId, null);
});

test("a host's yes on a dinner that's called off or has started is refused, so the guest never reads its address; a no still answers", { skip }, async () => {
  const { t, rajani, serene, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const off = await host(t, rajani, poha);
  const started = await host(t, rajani, poha);
  const asks = async (dinnerId: string) => [(await ok(join(t, serene, dinnerId))).requestId, (await ok(join(t, caleb, dinnerId))).requestId];
  const onOff = await asks(off);
  const onStarted = await asks(started);
  await db().query("update dinners set status = 'cancelled' where id = $1", [off]);
  await startIt(started);

  for (const [dinnerId, [yes, no]] of [[off, onOff], [started, onStarted]] as const) {
    await refusedWith(respond(t, rajani, yes, true), 404, "That dinner isn't happening anymore.");
    like((await dinner(t, serene, dinnerId)).data, { address: null, myRequest: { requestId: yes, status: "pending" }, seatsLeft: 4 });
    const mine = await ok(call(t, serene, "GET", "/v1/dinners/mine"));
    assert.equal(mine.dinners.find((d: { dinnerId: string }) => d.dinnerId === dinnerId).address, null);
    // A no gives nothing away, so it answers an old ask as on any dinner.
    await ok(respond(t, rajani, no, false));
    like((await dinner(t, caleb, dinnerId)).data, { address: null, myRequest: { requestId: no, status: "declined" } });
    await refusedWith(respond(t, rajani, no, false), 409, "You already answered.");
  }
  assert.equal((await db().query("select count(*)::int as n from dinner_requests where status = 'accepted'")).rows[0].n, 0);
});

test("once a dinner is called off, a guest the host let in no longer reads its address; the host still does", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const night = await host(t, rajani, poha);
  await ok(respond(t, rajani, (await ok(join(t, serene, night))).requestId, true));
  const fromMine = async (who: Who) => (await ok(call(t, who, "GET", "/v1/dinners/mine"))).dinners.find((d: { dinnerId: string }) => d.dinnerId === night);
  like((await dinner(t, serene, night)).data, { address: ADDRESS });
  like(await fromMine(serene), { address: ADDRESS });

  await db().query("update dinners set status = 'cancelled' where id = $1", [night]);
  like((await dinner(t, serene, night)).data, { status: "cancelled", address: null, myRequest: { status: "accepted" } });
  like(await fromMine(serene), { status: "cancelled", address: null });
  like((await dinner(t, rajani, night)).data, { status: "cancelled", address: ADDRESS, isHost: true });
  like(await fromMine(rajani), { address: ADDRESS });
});

test("a host's yes to a guest who has since gone from their family is refused, and their pending ask leaves the host's list; a no still answers", { skip }, async () => {
  const { t, rajani, serene, serenesMom, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const night = await host(t, rajani, poha);
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const ngozi = await person(await family("Okafor home"), "Ngozi", "cook");
  const ask = async (who: Who) => (await ok(join(t, who, night))).requestId as string;
  const [left, deleted, moved, stays] = [await ask(serene), await ask(caleb), await ask(salik), await ask(ngozi)];
  const letIn = await ask(serenesMom);
  await ok(respond(t, rajani, letIn, true));

  // Serene leaves her family, Caleb deletes his account, Salik moves to another family; Mei leaves after the host let her in.
  await db().query("update people set removed_at = now() where id = any($1::text[])", [[serene.personId, serenesMom.personId]]);
  await db().query("update people set name = 'Deleted', approx_lat = null, approx_lng = null, deleted_at = now() where id = $1", [caleb.personId]);
  await db().query("update people set family_id = $2 where id = $1", [salik.personId, await family("Somewhere else")]);

  const requests = async () => (await dinner(t, rajani, night)).data.requests.map((r: { requestId: string; status: string }) => [r.requestId, r.status]);
  assert.deepEqual(await requests(), [[stays, "pending"], [letIn, "accepted"]], "an answered ask stays: it's what happened");
  assert.equal((await ok(call(t, rajani, "GET", "/v1/dinners/mine"))).dinners[0].requests.length, 2, "the same list in her own dinners");
  for (const gone of [left, deleted, moved]) await refusedWith(respond(t, rajani, gone, true), 404, "Only the host can answer.");
  assert.equal((await db().query("select count(*)::int as n from dinner_requests where status = 'accepted'")).rows[0].n, 1);
  // A no still answers, and someone who stayed is let in as ever.
  await ok(respond(t, rajani, left, false));
  assert.equal((await db().query("select status from dinner_requests where id = $1", [left])).rows[0].status, "declined");
  await ok(respond(t, rajani, stays, true));
});

test("the feed places each dish on its cook's grid cell, never finer, and the viewer at their own", { skip }, async () => {
  const { t, rajani, serene, serenesMom } = await world();
  // A finer position than the grid can't be stored: the column's type rounds it.
  await db().query("update people set approx_lat = 42.36789, approx_lng = -71.09432 where id = $1", [serenesMom.personId]);
  await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  await recipe(rajani, { sharedAt: 1 }); // Rajani never set a location: the venue
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const fromSalik = await feed(t, salik);
  assert.deepEqual(fromSalik.here, roundToGrid(DEMO_LOCATION));
  assert.deepEqual(Object.fromEntries(fromSalik.recipes.map((r: any) => [r.dish, r.approx])), {
    "Kanda Poha": roundToGrid(DEMO_LOCATION),
    Dumplings: { lat: 42.37, lng: -71.09 },
  });
  assert.ok(!JSON.stringify(fromSalik).includes("42.367"));
  assert.deepEqual((await feed(t, serene)).here, DEMO_LOCATION);
});

test("a dinner is placed on its host's grid cell, and no finer", { skip }, async () => {
  const { t, rajani } = await world();
  await db().query("update people set approx_lat = 42.36789, approx_lng = -71.09432 where id = $1", [rajani.personId]);
  const dinnerId = await host(t, rajani, await recipe(rajani, { sharedAt: 1 }));
  const { rows } = await db().query("select approx_lat, approx_lng from dinners where id = $1", [dinnerId]);
  assert.deepEqual(rows[0], { approx_lat: "42.37", approx_lng: "-71.09" });
});

test("a family's private name never reaches a neighbor: the card uses the public name, or the cook's first name", { skip }, async () => {
  const { t, serene, serenesMom } = await world();
  const seen = async () => JSON.stringify(await feed(t, serene));
  await recipe(await person(await family("The Secret Household"), "Asha Rao", "cook"), { title: "Dal", sharedAt: 1, card: { text: "Asha's dal.", usedStories: false } });
  await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  assert.ok(!(await seen()).includes("Secret Household"));
  const row = (await feed(t, serene)).recipes.find((r: any) => r.dish === "Dal");
  assert.equal(row.familyName, "Asha's family");
  assert.ok(!(await ok(view(t, serene, row.recipeId))).familyName.includes("Secret"));
});

test("without a written card there's no story; a card's quote must still be one of her step quotes", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const withQuote = await recipe(rajani, { sharedAt: 1, card: { text: "Rajani's poha.", usedStories: false, quote: "Not too long, beta." } });
  await recipe(rajani, { title: "Plain Rice", sharedAt: 2, steps: [{ order: 1, title: "Boil", text: "Boil it." }] });
  const row = async (dish: string) => (await feed(t, serene)).recipes.find((r: any) => r.dish === dish);
  like(await row("Plain Rice"), { culture: null, quote: null, story: null, quoteTranslated: false });
  // She said that line in Marathi (the step keeps her words), so the card's English is a translation.
  like(await row("Kanda Poha"), { culture: null, quote: "Not too long, beta.", quoteTranslated: true });
  // A card quote that's no longer one of her step quotes (the recipe was redone) stops showing.
  await db().query("update recipes set steps = $2 where id = $1", [withQuote, JSON.stringify([{ order: 1, title: "Rinse", text: "Rinse it." }])]);
  assert.equal((await row("Kanda Poha")).quote, null);
});

test("a card written from her stories goes plain once she says no", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const withStory = "Rajani's poha, the one her mother made every Sunday in Pune.";
  const recipeId = await recipe(rajani, { memoriesOptIn: true, sharedAt: 1, card: { text: withStory, usedStories: true } });
  const seen = async () => ({ feed: (await feed(t, serene)).recipes[0].story, view: (await view(t, serene, recipeId)).data.story });
  assert.deepEqual(await seen(), { feed: withStory, view: withStory });
  await db().query("update recipes set memories_opt_in = false where id = $1", [recipeId]);
  const plain = "Rajani's Kanda Poha, from the Pawar family.";
  assert.deepEqual(await seen(), { feed: plain, view: plain });
  // A card that doesn't say whether stories went in counts as written from them.
  const unsaid = await recipe(rajani, { title: "Old Card", sharedAt: 0, card: { text: "From before we kept track." } });
  assert.equal((await view(t, serene, unsaid)).data.story, "Rajani's Old Card, from the Pawar family.");
});

test("a culture read from her stories goes with them once she says no", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const recipeId = await recipe(rajani, {
    memoriesOptIn: false,
    sharedAt: 1,
    card: { text: "Rajani's poha, the one her mother made in Pune.", usedStories: true, culture: "Maharashtrian", quote: "Not too long, beta." },
  });
  like((await feed(t, serene)).recipes[0], { recipeId, story: "Rajani's Kanda Poha, from the Pawar family.", culture: null, quote: "Not too long, beta." });
});

test("a dish's open dinner rides on its feed row", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const soon = Date.now() + 3_600_000;
  const later = await host(t, rajani, poha, { startsAt: soon + 3_600_000, seats: 3 });
  const first = await host(t, rajani, poha, { startsAt: soon, seats: 3 });
  const row = async () => (await feed(t, serene)).recipes[0];
  assert.deepEqual((await row()).dinner, { dinnerId: first, startsAt: soon, seatsLeft: 3, hostName: "Rajani", distanceLabel: "In your building" });
  await startIt(first);
  assert.equal((await row()).dinner.dinnerId, later); // the first one has started
  await startIt(later);
  assert.equal((await row()).dinner, null);
});

test("a dinner says how far it is itself: it sits where its host is, not where the cook is", { skip }, async () => {
  const { t, rajani, shreya, serene } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  await db().query("update people set approx_lat = $2, approx_lng = $3 where id = $1", [shreya.personId, DEMO_LOCATION.lat + 0.03, DEMO_LOCATION.lng]);
  const dinnerId = await host(t, shreya, poha, { seats: 2 });
  like((await feed(t, serene)).recipes[0], { distanceLabel: "In your building", dinner: { dinnerId, hostName: "Shreya", distanceLabel: "About 2 mi" } });
});

test("story card rules: her quotes", () => {
  const steps = [
    { order: 2, quote: "“Wait till the seeds start to dance.”" },
    { order: 1, quote: "Not too long, beta." },
    { order: 3, quote: "Okay." },
    // Over 20 words: only its short sentence can be quoted.
    { order: 4, quote: "Stir it slowly and keep on stirring the whole time until all of the onions turn soft and golden brown at the edges. Then the poha goes in." },
  ];
  assert.deepEqual(quoteChoices(steps), ["Not too long, beta.", "Wait till the seeds start to dance.", "Then the poha goes in."]);
  const said = [
    { order: 1, quote: "Not too long, beta.", quoteOriginal: "जास्त वेळ नको" },
    { order: 2, quote: "Wait till the seeds start to dance." },
    { order: 3, quote: "Keep stirring. Then the poha goes in.", quoteOriginal: "ढवळत राहा. मग पोहे घाला." },
  ];
  assert.deepEqual(["Not too long, beta.", "Wait till the seeds start to dance.", "Then the poha goes in.", "Not hers.", null].map((q) => quoteTranslated(said, q)), [true, false, true, false, false]);
});

after(async () => {
  if (hasDatabase) await db().end();
});

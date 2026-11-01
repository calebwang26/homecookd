// convex/safety.test.ts on the new api: a report hides a dish or dinner from the reporter's family at once and from everyone once two families reported it; a block works both ways
// and refuses asks; the filter keeps bad words off the map and lets dish names in any language through. Titles are Convex's where the meaning is the same.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db.js";
import { flagged } from "../src/modules/dish/moderation.js";
import { WORDS_POSTABLE, WORDS_SHAREABLE } from "../src/modules/community/words.js";
import { openReports, reviewReport } from "../src/modules/community/reports.js";
import { quoteChoices } from "../src/modules/community/storyCard.js";
import {
  block, call, cookTogether, dinner, dishes, family, feed, host, join, MISSING, ok, person, recipe, refusedWith, report, reportRows, requestSwap, respond, respondSwap, mySwaps, sameAsMissing, setShared, sorted, tryHost, view, type Who, world,
} from "./communityHelpers.js";
import { hasDatabase, like, settle } from "./dishHelpers.js";

const skip = !hasDatabase;
const inviteToken = (t: FastifyInstance, who: Who, dinnerId: string) => call(t, who, "POST", `/v1/dinners/${dinnerId}/invite-link`);
const NOT_HAPPENING = "That dinner isn't happening anymore.";
const NOT_SHARED = "That recipe isn't shared anymore.";

test("a report hides the dish and its dinner from the reporter's family only, at once", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const pohaNight = await host(t, rajani, poha);
  await refusedWith(report(t, shreya, "recipe", poha), 409, "This is your family's recipe.");
  await refusedWith(report(t, serene, "recipe", "not-an-id"), 404, NOT_SHARED);

  await ok(report(t, serene, "recipe", poha, "rude"));
  await ok(report(t, serenesMom, "recipe", poha, "other")); // the same family again: nothing new
  assert.deepEqual(await dishes(t, serene), []);
  assert.deepEqual(await dishes(t, serenesMom), []);
  assert.equal((await view(t, serene, poha)).status, 404);
  assert.deepEqual((await feed(t, serene)).dinners, []); // the dinner around it goes too
  assert.equal((await dinner(t, serene, pohaNight)).status, 404);
  await refusedWith(join(t, serene, pohaNight), 404, NOT_HAPPENING);
  await refusedWith(requestSwap(t, serene, poha), 404, NOT_SHARED);

  // Everyone else still sees it, the cook's family as its own.
  assert.deepEqual(await dishes(t, caleb), ["Kanda Poha"]);
  assert.deepEqual((await feed(t, caleb)).dinners.map((d: any) => d.dinnerId), [pohaNight]);
  like((await feed(t, rajani)).recipes[0], { dish: "Kanda Poha", ours: true });
  like((await view(t, shreya, poha)).data, { ours: true });
  like((await view(t, caleb, poha)).data, { ours: false, familyName: "The Pawar family" });

  const rows = await reportRows();
  assert.equal(rows.length, 1);
  like(rows[0], { kind: "recipe", target_id: poha, target_family_id: rajani.familyId, reporter_family_id: serene.familyId, reporter_person_id: serene.personId, reason: "rude", status: "open" });
  // The team hears, with no family content, through the outbox.
  const { rows: sent } = await db().query("select payload from outbox");
  assert.deepEqual(sent.map((r) => r.payload), [{ task: "community.report_alert", kind: "recipe", reason: "rude" }]);
});

test("reports from two families hide a dish and a dinner from everyone else until the team reviews them", { skip }, async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const poha = await recipe(rajani, { sharedAt: 1 });
  const pohaNight = await host(t, rajani, poha);

  await ok(report(t, serene, "recipe", poha, "not_food"));
  assert.deepEqual(await dishes(t, salik), ["Kanda Poha"]); // one family isn't enough
  await ok(report(t, caleb, "recipe", poha, "rude"));
  assert.deepEqual(await dishes(t, salik), []);
  assert.equal((await view(t, salik, poha)).status, 404);
  await refusedWith(cookTogether(t, salik, poha), 404, NOT_SHARED);
  assert.deepEqual((await feed(t, shreya)).recipes.map((r: any) => [r.dish, r.ours]), [["Kanda Poha", true]]); // still hers

  const open = await openReports();
  assert.equal(open.length, 1);
  like(open[0], { kind: "recipe", targetId: poha, what: "Kanda Poha", families: 2, firstAt: (v: unknown) => typeof v === "number", hidden: true });
  assert.deepEqual(sorted(open[0].reasons), ["not_food", "rude"]);
  // The team says it's fine: back for everyone but the families that reported it.
  assert.equal(await reviewReport("recipe", poha, true), 2);
  assert.deepEqual(await dishes(t, salik), ["Kanda Poha"]);
  assert.deepEqual(await dishes(t, serene), []);
  assert.deepEqual(await openReports(), []);

  // The dinner, by two families that can still see it (the two that reported its dish can't).
  const ngozi = await person(await family("Okafor home", "Okafor"), "Ngozi", "cook");
  const rey = await person(await family("Santos home", "Santos"), "Rey", "cook");
  for (const who of [salik, ngozi]) await ok(report(t, who, "dinner", pohaNight, "other"));
  assert.deepEqual((await feed(t, rey)).dinners, []);
  assert.equal((await dinner(t, rey, pohaNight)).status, 404);
  await refusedWith(join(t, rey, pohaNight), 404, NOT_HAPPENING);
  like((await dinner(t, shreya, pohaNight)).data, { ours: true, familyName: "The Pawar family" });
  // The team takes it down: called off, and it stays hidden.
  await reviewReport("dinner", pohaNight, false);
  const { rows } = await db().query("select status, hidden_at from dinners where id = $1", [pohaNight]);
  assert.equal(rows[0].status, "cancelled");
  assert.ok(rows[0].hidden_at);
});

/** Caleb's family cooks the Pawars' poha together with them and hosts a dinner of it. */
async function cookTogetherNight(t: FastifyInstance, cook: Who, asker: Who, answerer: Who) {
  const poha = await recipe(cook, { sharedAt: 1 });
  const { swapId } = await ok(cookTogether(t, asker, poha));
  await ok(respondSwap(t, answerer, swapId, true));
  return { poha, night: await host(t, asker, poha) };
}

test("a dinner goes with its dish: blocked dish family, hidden by reports, taken down", { skip }, async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const ngozi = await person(await family("Okafor home", "Okafor"), "Ngozi", "cook");
  const { poha, night } = await cookTogetherNight(t, rajani, caleb, shreya);
  const pohaNight = await host(t, rajani, poha);
  const feedDinners = async (who: Who) => sorted((await feed(t, who)).dinners.map((d: any) => d.dinnerId));
  assert.deepEqual(await feedDinners(serene), sorted([night, pohaNight]));

  // Serene's family blocks the Pawars: Caleb's dinner of their dish goes too, though Caleb isn't blocked.
  await ok(block(t, serene, "recipe", poha));
  assert.deepEqual(await feedDinners(serene), []);
  assert.equal((await dinner(t, serene, night)).status, 404);
  await refusedWith(join(t, serene, night), 404, NOT_HAPPENING);
  await refusedWith(report(t, serene, "dinner", night), 404, NOT_HAPPENING); // can't see it, can't report it

  // Two families' reports hide the dish: every dinner of it goes, for everyone but its host's family.
  for (const who of [salik, ngozi]) assert.deepEqual(await feedDinners(who), sorted([night, pohaNight]));
  await ok(report(t, salik, "recipe", poha));
  await ok(report(t, ngozi, "recipe", poha));
  assert.deepEqual(await feedDinners(ngozi), []);
  const third = await person(await family("Santos home", "Santos"), "Rey", "cook");
  assert.deepEqual(await feedDinners(third), []);
  assert.equal((await dinner(t, third, night)).status, 404);
  await refusedWith(join(t, third, night), 404, NOT_HAPPENING);
  like((await dinner(t, caleb, night)).data, { ours: true });

  // Kept after review it's back; taken down it's gone again, and so are its dinners.
  await reviewReport("recipe", poha, true);
  assert.deepEqual(await feedDinners(third), sorted([night, pohaNight]));
  // A take-down writes `recipes`, so Convex's review does that part and the sync brings it here (COMMUNITY-MIGRATION.md).
  await db().query("update recipes set shared_at = null, hidden_at = now() where id = $1", [poha]);
  await reviewReport("recipe", poha, false);
  assert.deepEqual(await feedDinners(third), []);
  await refusedWith(join(t, third, night), 404, NOT_HAPPENING);
});

test("a recipe's review waits for the copy to say what the team decided, and changes nothing until then", { skip }, async () => {
  const { t, rajani, serene, caleb } = await world();
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const poha = await recipe(rajani, { sharedAt: 1 });
  await ok(report(t, serene, "recipe", poha));
  await ok(report(t, caleb, "recipe", poha));

  // A take-down: refused while the recipe is still shared here. Nothing is resolved, so it stays hidden.
  await assert.rejects(reviewReport("recipe", poha, false), /recipes_read_only/);
  assert.deepEqual(await dishes(t, salik), []);
  assert.equal((await openReports()).length, 1);

  // Hidden on Convex before the move: keep can't lift recipes.hidden_at from here either.
  await db().query("update recipes set hidden_at = now() where id = $1", [poha]);
  await assert.rejects(reviewReport("recipe", poha, true), /recipes_read_only/);
  assert.equal((await openReports()).length, 1);
  await db().query("update recipes set hidden_at = null where id = $1", [poha]);
  assert.equal(await reviewReport("recipe", poha, true), 2);
  // Nothing in this api ever wrote the recipe.
  const { rows } = await db().query("select hidden_at, shared_at from recipes where id = $1", [poha]);
  assert.equal(rows[0].hidden_at, null);
  assert.ok(rows[0].shared_at);
});

test("an invite link is only for those who can still see the dinner, and stops once its dish is hidden", { skip }, async () => {
  const { t, rajani, serene, serenesMom, caleb } = await world();
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const poha = await recipe(rajani, { sharedAt: 1 });
  const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  const pohaNight = await host(t, rajani, poha);
  for (const guest of [serene, caleb]) {
    const { requestId } = await ok(join(t, guest, pohaNight));
    await ok(respond(t, rajani, requestId, true));
  }
  const token = (who: Who) => inviteToken(t, who, pohaNight);
  const link = (await ok(token(rajani))).token;
  assert.equal((await ok(token(serene))).token, link);

  // The Pawars block Serene's family: her link stops; Caleb's still works.
  await ok(block(t, rajani, "recipe", dumplings));
  await refusedWith(token(serene), 404, NOT_HAPPENING);
  assert.equal((await ok(token(caleb))).token, link);

  // Two families' reports hide the dish: the guest's link stops, and the public page no longer opens.
  const open = () => t.inject({ method: "POST", url: "/invite/open", payload: { token: link, deviceId: "device-0123456789abcdef" } });
  assert.equal((await open()).json().dish, "Kanda Poha");
  await ok(report(t, salik, "recipe", poha));
  await ok(report(t, await person(await family("Okafor home", "Okafor"), "Ngozi", "cook"), "recipe", poha));
  await refusedWith(token(caleb), 404, NOT_HAPPENING);
  assert.equal((await ok(token(rajani))).token, link); // the host's own family still can
  assert.equal((await open()).statusCode, 404);
});

test("only what you can see now can be reported or blocked", { skip }, async () => {
  const { t, rajani, serene, serenesMom } = await world();
  const privateDal = await recipe(rajani, { title: "Private Dal" });
  await refusedWith(report(t, serene, "recipe", privateDal), 404, NOT_SHARED);
  await refusedWith(block(t, serene, "recipe", privateDal), 404, NOT_SHARED);
  const poha = await recipe(rajani, { sharedAt: 1 });
  const pohaNight = await host(t, rajani, poha);
  await db().query("update dinners set status = 'cancelled' where id = $1", [pohaNight]);
  await refusedWith(report(t, serene, "dinner", pohaNight), 404, NOT_HAPPENING);
  // A family that already reported it may say so again (nothing new), though it no longer sees it.
  await ok(report(t, serene, "recipe", poha));
  await ok(report(t, serenesMom, "recipe", poha));
  assert.equal((await reportRows()).length, 1);
});

test("a block works both ways: no dishes, dinners or asks between the two families", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  const pohaNight = await host(t, rajani, poha);
  const dumplingNight = await host(t, serenesMom, dumplings);
  const { swapId } = await ok(requestSwap(t, shreya, dumplings, poha));
  const { requestId: askId } = await ok(join(t, shreya, dumplingNight));

  await refusedWith(block(t, serene, "recipe", dumplings), 409, /your family's/);
  await ok(block(t, serene, "recipe", poha));
  await ok(block(t, serenesMom, "dinner", pohaNight)); // again: nothing new

  assert.deepEqual(await dishes(t, serene), ["Dumplings"]);
  assert.deepEqual(await dishes(t, shreya), ["Kanda Poha"]);
  assert.deepEqual((await feed(t, serene)).dinners, []);
  assert.deepEqual((await feed(t, shreya)).dinners, []);
  assert.equal((await view(t, serene, poha)).status, 404);
  assert.equal((await view(t, rajani, dumplings)).status, 404);
  assert.equal((await dinner(t, serene, pohaNight)).status, 404);
  assert.equal((await dinner(t, shreya, dumplingNight)).status, 404);
  assert.deepEqual((await ok(call(t, shreya, "GET", "/v1/dinners/mine"))).dinners, []);
  // Caleb's family still sees both.
  assert.deepEqual(await dishes(t, caleb), ["Dumplings", "Kanda Poha"]);

  // New asks either way are refused, each the same as if there were nothing there; the open ones are gone from both lists and can't be answered.
  sameAsMissing(await requestSwap(t, rajani, dumplings), await requestSwap(t, rajani, MISSING), "swap");
  sameAsMissing(await cookTogether(t, serene, poha), await cookTogether(t, serene, MISSING), "cook together");
  sameAsMissing(await join(t, serene, pohaNight), await join(t, serene, MISSING), "join");
  sameAsMissing(await join(t, rajani, dumplingNight), await join(t, rajani, MISSING), "join, the other way");
  sameAsMissing(await respondSwap(t, serene, swapId, true), await respondSwap(t, serene, MISSING, true), "a swap's answer");
  assert.deepEqual(await mySwaps(t, shreya), []);
  assert.deepEqual(await mySwaps(t, serene), []);
  assert.deepEqual((await dinner(t, serenesMom, dumplingNight)).data.requests, []);
  sameAsMissing(await respond(t, serenesMom, askId, true), await respond(t, serenesMom, MISSING, true), "a host's yes");
  sameAsMissing(await respond(t, serenesMom, askId, false), await respond(t, serenesMom, MISSING, false), "a host's no");

  // Only the family that blocked sees it; the team hears about it once.
  const list = (await ok(call(t, serenesMom, "GET", "/v1/community/blocks"))).blocked;
  assert.equal(list.length, 1);
  assert.equal(list[0].familyName, "The Pawar family");
  assert.deepEqual((await ok(call(t, rajani, "GET", "/v1/community/blocks"))).blocked, []);
  assert.deepEqual((await reportRows()).map((r) => [r.kind, r.target_id, r.reporter_family_id]), [["family", rajani.familyId, serene.familyId]]);

  // Their side can't lift it; ours can, and everything comes back.
  sameAsMissing(await call(t, rajani, "DELETE", `/v1/community/blocks/${list[0].blockId}`), await call(t, rajani, "DELETE", `/v1/community/blocks/${MISSING}`), "unblock");
  assert.deepEqual(await dishes(t, shreya), ["Kanda Poha"]);
  await ok(call(t, serene, "DELETE", `/v1/community/blocks/${list[0].blockId}`));
  assert.deepEqual(await dishes(t, shreya), ["Dumplings", "Kanda Poha"]);
  assert.deepEqual((await mySwaps(t, serene)).map((s: any) => s.swapId), [swapId]);
});

test("the word filter catches slurs, explicit words and threats, and lets dish words in any language through", () => {
  for (const bad of ["You FUCKING idiot", "nïgger", "I'll kill you", "go kill yourself", "heil hitler", "a whore", "kys"]) {
    assert.deepEqual([bad, flagged(bad)], [bad, true]);
  }
  const fine = [
    "Kanda Poha", "कांदा पोहे", "番茄炒蛋", "Phở bò", "Bánh xèo", "Thịt kho tộ", "Tteok-gook", "Miyeok gook", "Pav bhaji",
    "Fesenjān", "Pastel de nata", "Paki-hugas ang bigas", "Tío Kike's paella", "Kaffir lime leaves", "Chinkiang vinegar",
    "Rapeseed oil", "Spotted Dick", "Cock-a-leekie", "Shiitake", "Retard the dough overnight", "Scunthorpe sausages",
    "Kill the heat once it boils", "This chili will kill you, it's that good", "Chicken breast and thighs",
  ];
  for (const ok_ of fine) assert.deepEqual([ok_, flagged(ok_)], [ok_, false]);
  // A step quote it catches is never on the card; the clean ones still can be.
  assert.deepEqual(quoteChoices([{ order: 1, quote: "Don't fucking burn it." }, { order: 2, quote: "Wait till the seeds dance." }]), ["Wait till the seeds dance."]);
});

test("a recipe or dinner the filter catches stays with the family; the feed leaves one out as a backstop", { skip }, async () => {
  const { t, rajani, shreya, serene } = await world();
  const bad = await recipe(rajani, { title: "Fucking Good Poha" });
  await refusedWith(call(t, rajani, "POST", "/v1/share-requests", { recipeId: bad }), 422, WORDS_SHAREABLE);
  assert.equal((await db().query("select shared_at from recipes where id = $1", [bad])).rows[0].shared_at, null);

  // Shared before the filter (an older card): only its own family sees it.
  const old = await recipe(rajani, { title: "Old Poha", steps: [{ order: 1, title: "Stir", text: "Stir it, motherfucker." }], sharedAt: 1 });
  assert.deepEqual(await dishes(t, serene), []);
  assert.equal((await view(t, serene, old)).status, 404);
  assert.deepEqual(await dishes(t, shreya), ["Old Poha"]);

  const good = await recipe(rajani, { title: "Kanda Poha (कांदा पोहे)", sharedAt: 2 });
  assert.deepEqual(await dishes(t, serene), ["Kanda Poha (कांदा पोहे)"]);
  await refusedWith(tryHost(t, rajani, good, { placeName: "Fuck you kitchen" }), 422, WORDS_POSTABLE);
  assert.ok(await host(t, rajani, good));
});

test("the team hears of a report with no family content, and a daily reminder while one stays open", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const sent: { title: string | null; body: string }[] = [];
  const real = globalThis.fetch;
  process.env.REPORT_ALERT_URL = "https://ntfy.test/topic";
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push({ title: new Headers(init.headers).get("Title"), body: String(init.body) });
    return new Response("ok");
  }) as typeof fetch;
  try {
    const poha = await recipe(rajani, { sharedAt: 1 });
    await ok(report(t, serene, "recipe", poha, "rude"));
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, "homecookd: new Community report");
    assert.match(sent[0].body, /^Someone reported a recipe \(rude or hurtful\)\. 1 open\./);
    for (const word of ["Kanda", "Poha", "Rajani", "Serene", "Pawar", poha]) assert.ok(!sent[0].body.includes(word), word);

    const { handleMessage } = await import("../src/scheduled.js");
    const silent = { info: () => {}, warn: () => {}, error: () => {} };
    await handleMessage(JSON.stringify({ payload: { task: "community.remind_open" } }), silent);
    assert.equal(sent.length, 1); // filed just now: nothing is stale yet
    await db().query("update reports set created_at = now() - interval '13 hours'");
    await handleMessage(JSON.stringify({ payload: { task: "community.remind_open" } }), silent);
    assert.equal(sent[1].title, "homecookd: reports waiting");
    assert.match(sent[1].body, /^1 Community report is open for over 12 hours\./);
  } finally {
    globalThis.fetch = real;
    delete process.env.REPORT_ALERT_URL;
  }
});

after(async () => {
  if (hasDatabase) await db().end();
});

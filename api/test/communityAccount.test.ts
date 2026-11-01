// SCHEMA.md section 4 for Community's tables, called by hand: the account purge that will call it moves last. convex/account.test.ts's Community assertions, with what's marked new there.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { cancelDinnersOfPerson, purgeCommunityForPerson } from "../src/modules/community/account.js";
import { block, call, cookTogether, family, feed, host, join, ok, person, recipe, report, requestSwap, respond, respondSwap, tryHost, world } from "./communityHelpers.js";
import { hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;
const count = async (table: string, where = "true", args: unknown[] = []) => (await db().query(`select count(*)::int as n from ${table} where ${where}`, args)).rows[0].n;
const dinnerRow = async (id: string) => (await db().query("select * from dinners where id = $1", [id])).rows[0];

async function deleted() {
  const w = await world();
  const { t, rajani, serene, serenesMom, caleb, shreya } = w;
  const poha = await recipe(rajani, { sharedAt: 1 });
  const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  // Hers, with a guest and an invite open.
  const hers = await host(t, rajani, poha, { seats: 2 });
  const { requestId } = await ok(join(t, serene, hers));
  await ok(respond(t, rajani, requestId, true));
  const { token } = await ok(call(t, rajani, "POST", `/v1/dinners/${hers}/invite-link`));
  await t.inject({ method: "POST", url: "/invite/open", payload: { token, deviceId: "device-0123456789abcdef" } });
  // Another family's dinner around her recipe: Caleb cooks it with her.
  const { swapId: cookAsk } = await ok(cookTogether(t, caleb, poha));
  await ok(respondSwap(t, shreya, cookAsk, true));
  const calebsNight = await host(t, caleb, poha);
  // Her own ask to join someone else's dinner, and a neighbor's dinner she has nothing to do with.
  const meisNight = await host(t, serenesMom, dumplings);
  await ok(join(t, rajani, meisNight));
  await ok(join(t, caleb, meisNight));
  // Swaps: she asked, one offers her dish, one asks for it; and one that's nothing to do with her.
  const { swapId: asked } = await ok(requestSwap(t, rajani, dumplings));
  const jollof = await recipe(caleb, { title: "Jollof", sharedAt: 3 });
  const { swapId: offered } = await ok(requestSwap(t, shreya, jollof, poha));
  const { swapId: forHers } = await ok(requestSwap(t, serene, poha));
  const { swapId: others } = await ok(requestSwap(t, caleb, dumplings));
  // Her report and block, a report on her dish, and a family that blocked hers under a label with her first name.
  await ok(report(t, rajani, "recipe", dumplings, "rude"));
  await ok(report(t, caleb, "recipe", dumplings, "other"));
  const ngozi = await person(await family("Okafor home"), "Ngozi", "cook");
  await ok(block(t, ngozi, "recipe", poha));
  return { ...w, poha, dumplings, hers, calebsNight, meisNight, asked, offered, forHers, others, ngozi };
}

test("at once: the dinners she hosts and any around her recipes are off the map", { skip }, async () => {
  const { t, rajani, hers, calebsNight, meisNight, serene } = await deleted();
  await cancelDinnersOfPerson(db(), rajani.personId);
  assert.equal((await dinnerRow(hers)).status, "cancelled");
  assert.equal((await dinnerRow(calebsNight)).status, "cancelled");
  assert.equal((await dinnerRow(meisNight)).status, "open");
  // Off the map: the feed leaves them out, and joining is refused.
  assert.deepEqual((await feed(t, serene)).dinners, []);
  assert.equal((await join(t, serene, calebsNight)).status, 404);
  // Safe to run again.
  await cancelDinnersOfPerson(db(), rajani.personId);
});

test("deleting someone reaches every Community table as SCHEMA.md says", { skip }, async () => {
  const { rajani, hers, calebsNight, meisNight, asked, offered, forHers, others, ngozi, caleb } = await deleted();
  await purgeCommunityForPerson(rajani.personId, rajani.familyId);

  // dinners: hers deleted, with its asks and opens; another family's around her recipe cancelled, no recipe, its dish's name kept.
  assert.equal(await dinnerRow(hers), undefined);
  assert.equal(await count("dinner_requests", "dinner_id = $1", [hers]), 0);
  assert.equal(await count("dinner_invite_opens", "dinner_id = $1", [hers]), 0);
  like(await dinnerRow(calebsNight), { status: "cancelled", recipe_id: null, dish: "Kanda Poha" });
  assert.equal((await dinnerRow(meisNight)).status, "open");

  // dinner_requests: her own asks go; others' stay.
  assert.equal(await count("dinner_requests", "guest_id = $1", [rajani.personId]), 0);
  assert.equal(await count("dinner_requests", "dinner_id = $1 and guest_id = $2", [meisNight, caleb.personId]), 1);

  // swap_requests: she asked, or either recipe is hers; not others'.
  const swaps = (await db().query("select id from swap_requests")).rows.map((r) => r.id);
  for (const gone of [asked, offered, forHers]) assert.ok(!swaps.includes(gone), gone);
  assert.ok(swaps.includes(others));

  // reports: who filed it goes, the family's hide stays. blocks: a label that could hold her first name goes.
  const reports = (await db().query("select reporter_person_id, reporter_family_id from reports where reporter_family_id = $1", [rajani.familyId])).rows;
  assert.deepEqual(reports, [{ reporter_person_id: null, reporter_family_id: rajani.familyId }]);
  assert.equal(await count("reports", "reporter_person_id = $1", [rajani.personId]), 0);
  assert.equal(await count("reports", "reporter_person_id = $1", [caleb.personId]), 1);
  const blocks = (await db().query("select label from blocks where family_id = $1", [ngozi.familyId])).rows;
  assert.deepEqual(blocks, [{ label: "A family" }]);

  // Run again, nothing changes and nothing fails.
  const before = await count("dinners");
  await purgeCommunityForPerson(rajani.personId, rajani.familyId);
  assert.equal(await count("dinners"), before);
});

test("the purge doesn't touch the rows the sync owns", { skip }, async () => {
  const { rajani, poha } = await deleted();
  const read = async () => ({
    recipe: (await db().query("select * from recipes where id = $1", [poha])).rows,
    person: (await db().query("select * from people where id = $1", [rajani.personId])).rows,
    family: (await db().query("select * from families where id = $1", [rajani.familyId])).rows,
  });
  const before = await read();
  await cancelDinnersOfPerson(db(), rajani.personId);
  await purgeCommunityForPerson(rajani.personId, rajani.familyId);
  assert.deepEqual(await read(), before);
});

test("a new dinner's retry key goes with the person", { skip }, async () => {
  const { t, rajani, poha } = await deleted();
  await ok(tryHost(t, rajani, poha, {}, { "idempotency-key": "retry-key-0001" }));
  assert.equal(await count("idempotency_keys", "scope = $1", [rajani.personId]), 1);
  await purgeCommunityForPerson(rajani.personId, rajani.familyId);
  assert.equal(await count("idempotency_keys", "scope = $1", [rajani.personId]), 0);
});

test("once her recipe's row goes, a report on it stays for the record, and a dinner's FK doesn't hold it up", { skip }, async () => {
  const { t, rajani, poha, calebsNight, serene } = await deleted();
  await ok(report(t, serene, "recipe", poha, "other"));
  await purgeCommunityForPerson(rajani.personId, rajani.familyId);
  // What's left for the recipes area's purge: this delete has nothing of Community's in its way.
  await db().query("delete from recipes where id = $1", [poha]);
  like(await dinnerRow(calebsNight), { status: "cancelled", recipe_id: null });
  assert.equal(await count("reports", "kind = 'recipe' and target_id = $1", [poha]), 1);
});

after(async () => {
  if (hasDatabase) await db().end();
});

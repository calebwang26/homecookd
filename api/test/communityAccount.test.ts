// SCHEMA.md section 4 for Community's tables, called by hand: the account purge that will call it moves last. convex/account.test.ts's Community assertions, with what's marked new there.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { cancelDinnersOfPerson, purgeCommunityForPerson } from "../src/modules/community/account.js";
import {
  block, call, cookTogether, dinner, family, feed, host, join, ok, person, recipe, refusedWith, report, requestSwap, respond, respondSwap, startIt, tryHost, type Who, world,
} from "./communityHelpers.js";
import { hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;
const count = async (table: string, where = "true", args: unknown[] = []) => (await db().query(`select count(*)::int as n from ${table} where ${where}`, args)).rows[0].n;
const dinnerRow = async (id: string) => (await db().query("select * from dinners where id = $1", [id])).rows[0];

/** A phone of their own: its key. */
async function phoneOf(who: Who): Promise<string> {
  const key = randomBytes(32).toString("base64url");
  await db().query(`insert into devices (family_id, person_id, key_hash, via, label) values ($1, $2, $3, 'apple', 'Test phone')`, [who.familyId, who.personId, hashToken(key)]);
  return key;
}

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

test("a host who leaves the family: the dinners they host that haven't started are called off, and nothing else", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  // Hers: one ahead with an ask nobody else could answer, one ahead and full, one that has started, one called off already.
  const ahead = await host(t, rajani, poha);
  await ok(join(t, serene, ahead));
  const full = await host(t, rajani, poha, { seats: 1 });
  await ok(respond(t, rajani, (await ok(join(t, serene, full))).requestId, true));
  const started = await host(t, rajani, poha);
  await startIt(started);
  const off = await host(t, rajani, poha);
  await db().query("update dinners set status = 'cancelled' where id = $1", [off]);
  // Someone else's in her family, of her dish, and another family's.
  const shreyas = await host(t, shreya, poha);
  const meis = await host(t, serenesMom, dumplings);
  const kept = { started: await dinnerRow(started), off: await dinnerRow(off) };

  // "Leave the family", from her own phone. Shreya stays signed in on hers, so the family goes on.
  const key = await phoneOf(rajani);
  await phoneOf(shreya);
  const owns = process.env.ACCOUNTS_OWNS_PEOPLE;
  process.env.ACCOUNTS_OWNS_PEOPLE = "1";
  try {
    const left = await t.inject({ method: "POST", url: `/profiles/${rajani.personId}/remove`, headers: { "x-device-key": key, "x-profile-id": rajani.personId }, payload: {} });
    assert.equal(left.statusCode, 200, left.body);
  } finally {
    if (owns === undefined) delete process.env.ACCOUNTS_OWNS_PEOPLE;
    else process.env.ACCOUNTS_OWNS_PEOPLE = owns;
  }

  assert.equal((await dinnerRow(ahead)).status, "cancelled");
  assert.equal((await dinnerRow(full)).status, "cancelled");
  assert.deepEqual(await dinnerRow(started), kept.started, "one that has started keeps what it was");
  assert.deepEqual(await dinnerRow(off), kept.off);
  assert.equal((await dinnerRow(shreyas)).status, "open", "her dish's dinner, hosted by someone who stays");
  assert.equal((await dinnerRow(meis)).status, "open");
  // Off the map: the feed leaves hers out, and asking to join is refused.
  assert.deepEqual((await feed(t, caleb)).dinners.map((d: { dinnerId: string }) => d.dinnerId).sort(), [shreyas, meis].sort());
  await refusedWith(join(t, caleb, ahead), 404, "That dinner isn't happening anymore.");
  like((await call(t, serene, "GET", `/v1/dinners/${ahead}`)).data, { status: "cancelled" });
});

test("deleting someone calls off every dinner they host, started or not, but another host's dinner of their dish that has started keeps what it was", { skip }, async () => {
  const { t, rajani, shreya, serene, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const { swapId } = await ok(cookTogether(t, caleb, poha));
  await ok(respondSwap(t, shreya, swapId, true));
  const calebsLast = await host(t, caleb, poha);
  const calebsNext = await host(t, caleb, poha);
  const hersLast = await host(t, rajani, poha);
  await ok(respond(t, rajani, (await ok(join(t, serene, hersLast))).requestId, true));
  await startIt(calebsLast);
  await startIt(hersLast);
  const kept = await dinnerRow(calebsLast);

  await cancelDinnersOfPerson(db(), rajani.personId);
  assert.deepEqual(await dinnerRow(calebsLast), kept, "it happened: it isn't rewritten as called off");
  assert.equal((await dinnerRow(calebsNext)).status, "cancelled", "her dish leaves the map at once");
  // Hers goes in the batches. Until then it's called off, so her guest reads no address and its link opens nothing.
  assert.equal((await dinnerRow(hersLast)).status, "cancelled");
  like((await dinner(t, serene, hersLast)).data, { status: "cancelled", address: null });

  await purgeCommunityForPerson(rajani.personId, rajani.familyId);
  like(await dinnerRow(calebsLast), { status: "open", recipe_id: null, dish: "Kanda Poha" });
  like(await dinnerRow(calebsNext), { status: "cancelled", recipe_id: null, dish: "Kanda Poha" });
  assert.equal(await dinnerRow(hersLast), undefined);
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

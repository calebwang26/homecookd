// A card from a parent's craving link, the kid's side (convex/cravings.test.ts's peek, "a craving card is tied to her", its name and words, and the link's caps): the peek,
// the card asked of her in her family, the caps, and the `craving` push queued with the card. The parent's side is cravings.test.ts. The models run in fake mode.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { CRAVING_PER_DAY, CRAVING_TOTAL, LINK_BUSY } from "../src/modules/dish/cravingLinks.js";
import { DEFAULT_CRAVING_MESSAGE } from "../src/modules/dish/cravings.js";
import { handleMessage } from "../src/scheduled.js";
import { call, family, ok, person, world } from "./communityHelpers.js";
import { cravingCard, cravingLink } from "./cravingHelpers.js";
import { advance, fileId, getCard, hasDatabase, like, makeCard, model, post, silent } from "./dishHelpers.js";
import { drainTwice, dueNow, fakeExpo, pushes } from "./messagesHelpers.js";

const skip = !hasDatabase;
const DAY = 24 * 60 * 60_000 + 60_000; // past the 24 hours a link's daily cap counts

let ipCount = 0;
/** A new address per card, so the per-address card limits stay out of the way. */
const nextIp = () => `198.51.100.${(++ipCount % 250) + 1}`;

async function wangs() {
  const w = await world();
  const f = await family("Wang family");
  const dad = await person(f, "Dad", "cook");
  const leo = await person(f, "Leo", "kid");
  return { ...w, dad, leo };
}

const peek = (t: any, cravingToken: unknown, ip = nextIp()) => post(t, "/dish/craving/peek", { cravingToken }, { ip });
const craving = (t: any, cravingToken: string, body: Record<string, unknown> = { dish: "braised pork", kidName: "Caleb" }) =>
  post(t, "/dish/cards", { ...body, cravingToken }, { ip: nextIp() });
const links = async () => (await db().query("select * from craving_links order by created_at")).rows;
const cards = async () => (await db().query("select count(*)::int as n from dish_asks")).rows[0].n;
const pushTasks = async () => (await db().query(`select payload from outbox where payload->>'task' = 'push.dish_requested' order by id`)).rows.map((r) => r.payload);

test("peek: her first name, what the family calls her and her line; 404 when unknown, stopped or her maker gone, counted as a bad token", { skip }, async () => {
  const { t, dad, leo } = await wangs();
  const { token } = await cravingLink(t, dad);
  like(await peek(t, token), { status: 200, data: { parentName: "Dad", relation: null, message: DEFAULT_CRAVING_MESSAGE } });
  await db().query("update people set name = 'Ravi Wang', relation = ' Appa ' where id = $1", [dad.personId]);
  assert.deepEqual((await peek(t, token)).data, { parentName: "Ravi", relation: "Appa", message: DEFAULT_CRAVING_MESSAGE });

  like(await peek(t, "A".repeat(22)), { status: 404, data: { error: "not_found", message: "This link doesn't work anymore." } });
  like(await peek(t, "short"), { status: 404, data: { error: "not_found" } });
  like(await peek(t, undefined), { status: 400, data: { error: "invalid", field: "cravingToken" } });
  like(await peek(t, 7), { status: 400, data: { error: "invalid", field: "cravingToken" } });
  // 20 unknown tokens from one address in 10 minutes, then 429.
  for (let i = 0; i < 20; i += 1) assert.equal((await peek(t, "B".repeat(22), "192.0.2.9")).status, 404);
  like(await peek(t, "B".repeat(22), "192.0.2.9"), { status: 429, data: { error: "rate_limited" } });

  // Its maker left the family, is in another family now, or deleted her account: the link is dead.
  const deadWhile = async (change: () => Promise<unknown>, undo: () => Promise<unknown>) => {
    await change();
    like(await peek(t, token), { status: 404, data: { error: "not_found" } });
    like(await craving(t, token), { status: 404, data: { error: "not_found" } });
    await undo();
    assert.equal((await peek(t, token)).status, 200);
  };
  const set = (column: string, value: string | null) => () => db().query(`update people set ${column} = $2 where id = $1`, [dad.personId, value]);
  await deadWhile(set("removed_at", new Date().toISOString()), set("removed_at", null));
  await deadWhile(set("family_id", await family("Elsewhere")), set("family_id", dad.familyId));
  assert.equal(await cards(), 0);

  // Stopped: no new cards, and the cards it made stay. Her next link opens.
  const made = await cravingCard(t, dad);
  await ok(call(t, dad, "POST", "/v1/cravings/link/revoke"));
  like(await peek(t, token), { status: 404, data: { error: "not_found" } });
  like(await craving(t, token), { status: 404, data: { error: "not_found" } });
  assert.equal((await getCard(t, made.kidToken)).kidName, "Caleb");
  const fresh = await cravingLink(t, dad);
  assert.notEqual(fresh.token, token);
  assert.equal((await peek(t, fresh.token)).status, 200);
  // Someone else's link names them, until they delete their account.
  const leos = (await cravingLink(t, leo)).token;
  assert.equal((await peek(t, leos)).data.parentName, "Leo");
  await db().query("update people set name = 'Deleted', relation = null, deleted_at = now() where id = $1", [leo.personId]);
  like(await peek(t, leos), { status: 404, data: { error: "not_found" } });
  like(await craving(t, leos), { status: 404, data: { error: "not_found" } });
});

test("a craving card is tied to her: family_id, requested_of, craving_id, cook_claimed_at; nobody joins her family", { skip }, async () => {
  const { t, dad } = await wangs();
  const people = async () => (await db().query("select id, family_id, name, relation from people order by id")).rows;
  const families = async () => (await db().query("select * from families order by id")).rows;
  const before = { people: await people(), families: await families() };

  const photo = await fileId(t, "photo");
  const { card, row } = await cravingCard(t, dad, { dish: "braised pork", kidName: "Caleb", photos: [photo] });
  like(card, { kidName: "Caleb", relation: "mom", status: "draft", filmingDay: null, dish: "braised pork" });
  const [link] = await links();
  like(row, { family_id: dad.familyId, requested_of: dad.personId, person_id: null, kid_claimed_at: null });
  assert.equal((await db().query("select craving_id from dish_asks where id = $1", [row.id])).rows[0].craving_id, link.id);
  assert.equal(row.cook_claimed_at?.getTime(), row.created_at.getTime());
  assert.equal(link.uses, 1);
  // Its files are her family's, as a claim makes them.
  assert.deepEqual((await db().query("select family_id, owner_person_id from files where ask_id = $1", [row.id])).rows, [{ family_id: dad.familyId, owner_person_id: null }]);
  assert.deepEqual(await people(), before.people);
  assert.deepEqual(await families(), before.families);

  // Hers in the app at once: her list, and the card itself.
  assert.deepEqual((await ok(call(t, dad, "GET", "/v1/cravings"))).asks.map((a: any) => a.id), [row.id]);
  like(await ok(call(t, dad, "GET", `/v1/dish-asks/${row.id}`)), { id: row.id, side: "cook", kidName: "Caleb" });

  // Who the kid asks: from what the family calls her when it's one of the six, else mom; the kid's pick wins.
  await db().query("update people set relation = 'Dad' where id = $1", [dad.personId]);
  assert.equal((await cravingCard(t, dad)).card.relation, "dad");
  assert.equal((await cravingCard(t, dad, { dish: "dal", kidName: "Amy", relation: "grandpa" })).card.relation, "grandpa");
  await db().query("update people set relation = 'Aaji' where id = $1", [dad.personId]);
  assert.equal((await cravingCard(t, dad)).card.relation, "mom");
});

test("a craving card needs the kid's name (400) and clean words (422); nothing is made, counted or pushed", { skip }, async () => {
  const { t, dad } = await wangs();
  const { token } = await cravingLink(t, dad);
  like(await craving(t, token, { dish: "braised pork" }), { status: 400, data: { error: "invalid", field: "kidName", message: "kidName is required" } });
  like(await craving(t, token, { dish: "braised pork", kidName: "   " }), { status: 400, data: { field: "kidName" } });
  like(await craving(t, token, { dish: "braised pork", kidName: "slut" }), { status: 422, data: { error: "words" } });
  like(await craving(t, "C".repeat(22)), { status: 404, data: { error: "not_found" } });
  like(await post(t, "/dish/cards", { dish: "dal", kidName: "Amy", cravingToken: 7 }, { ip: nextIp() }), { status: 400, data: { error: "invalid", field: "cravingToken" } });
  assert.equal(await cards(), 0);
  assert.equal(model.calls.guess, 0);
  assert.equal((await links())[0].uses, 0);
  assert.deepEqual(await pushTasks(), []);
});

test(`a link makes at most ${CRAVING_PER_DAY} cards a day and ${CRAVING_TOTAL} in all (429 link_full); then createLink makes a new one`, { skip }, async () => {
  const { t, dad } = await wangs();
  const { token, url } = await cravingLink(t, dad);
  const made = async () => (await makeCard(t, { dish: "braised pork", kidName: "Caleb", cravingToken: token }, nextIp())).card;
  for (let i = 0; i < CRAVING_PER_DAY; i += 1) await made();
  const busy = await craving(t, token);
  like(busy, { status: 429, data: { error: "link_full", message: LINK_BUSY } });
  const wait = Number(busy.headers["retry-after"]);
  assert.ok(wait > 23 * 3600 && wait <= 24 * 3600, `retry-after ${wait}: when the first of today's cards is a day old`);
  assert.equal(model.calls.guess, CRAVING_PER_DAY); // refused before any model ran
  // The peek still shows who sent it: the site goes plain only when the card is refused.
  assert.equal((await peek(t, token)).status, 200);
  // A kid's own web card isn't the link's.
  assert.equal((await post(t, "/dish/cards", { dish: "dal" }, { ip: nextIp() })).status, 201);
  await advance(DAY);
  await made();
  assert.equal((await links())[0].uses, CRAVING_PER_DAY + 1);

  // Its total: the last one it may make, then 429 whatever the day.
  await db().query("update craving_links set uses = $1", [CRAVING_TOTAL - 1]);
  await advance(DAY);
  await made();
  like(await craving(t, token), { status: 429, data: { error: "link_full" } });
  await advance(DAY);
  const full = await craving(t, token);
  like(full, { status: 429, data: { error: "link_full", message: LINK_BUSY } });
  assert.equal(full.headers["retry-after"], "86400");
  assert.equal((await links())[0].uses, CRAVING_TOTAL);
  assert.equal((await peek(t, token)).status, 200);
  // Used up, so she gets a new one.
  const next = await cravingLink(t, dad);
  assert.notEqual(next.url, url);
  assert.equal((await craving(t, next.token)).status, 201);
});

test("cards racing for a link's last card: one is made, the others refused, and one push is queued", { skip }, async () => {
  const { t, dad } = await wangs();
  const { token } = await cravingLink(t, dad);
  await db().query("update craving_links set uses = $1", [CRAVING_TOTAL - 1]);
  const replies = await Promise.all(Array.from({ length: 4 }, () => craving(t, token)));
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 429, 429, 429]);
  for (const r of replies.filter((x) => x.status === 429)) assert.equal(r.data.error, "link_full");
  assert.equal((await links())[0].uses, CRAVING_TOTAL);
  assert.equal(await cards(), 1);
  assert.equal((await pushTasks()).length, 1);
});

test("a card from her link queues the craving push to her with the card, and it goes once however often it runs", { skip }, async () => {
  const { t, dad } = await wangs();
  const expo = fakeExpo();
  await ok(call(t, dad, "POST", "/v1/push-tokens", { token: "ExponentPushToken[dad]", platform: "ios", tz: "UTC" }));
  const { row } = await cravingCard(t, dad);
  assert.deepEqual(await pushTasks(), [{ task: "push.dish_requested", askId: row.id }]);
  // A plain web card queues none.
  await makeCard(t, { dish: "dal", kidName: "Amy" }, nextIp());
  assert.equal((await pushTasks()).length, 1);

  // Each message twice, as SQS may; a craving waits out her quiet hours, so it's moved to now.
  await drainTwice();
  await dueNow();
  await drainTwice();
  assert.deepEqual(pushes(expo), [["ExponentPushToken[dad]", "Caleb wants your braised pork", "Show Caleb how you make it.", `/request/${row.id}`]]);
  // The task again, as a lost message sent a second time: still once.
  await handleMessage(JSON.stringify({ payload: { task: "push.dish_requested", askId: row.id } }), silent);
  await dueNow();
  await drainTwice();
  assert.equal(pushes(expo).length, 1);
  assert.deepEqual((await db().query("select kind, status from push_log where person_id = $1", [dad.personId])).rows, [{ kind: "craving", status: "sent" }]);
});

after(async () => {
  if (hasDatabase) await db().end();
});

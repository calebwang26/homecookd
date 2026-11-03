// A card read in the app (GET /v1/dish-asks/:id, convex/dishAsks.ts get): its kid or its cook gets the web's Card plus id and side, anyone else the one not-found, and the
// kid sees none of her clips before she sends. convex/cravings.test.ts's "forMe and get", for get; forMe isn't built (DISH.md, open item 2).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { FAKE_WORDS } from "../src/modules/dish/model.js";
import { call, family, MISSING, ok, person, sameAsMissing, type Who, world } from "./communityHelpers.js";
import { cravingCard, voiceUpload } from "./cravingHelpers.js";
import { advance, answer, anyNumber, anyString, askedCard, finish, getCard, hasDatabase, like, MIN, rowOf, runNow, settle } from "./dishHelpers.js";

const skip = !hasDatabase;
process.env.ACCOUNTS_OWNS_PEOPLE = "1"; // a cook's claim sets her relation, as on staging

async function wangs() {
  const w = await world();
  const f = await family("Wang family");
  const dad = await person(f, "Dad", "cook");
  const leo = await person(f, "Leo", "kid");
  return { ...w, dad, leo };
}

const read = (t: any, who: Who | null, id: string) => call(t, who, "GET", `/v1/dish-asks/${id}`);
const claim = (t: any, who: Who, token: string) => ok(call(t, who, "POST", "/v1/links/claim", { token }));

test("get: only the kid or the cook of a card reads it, as the web's Card plus id and side; anyone else gets the one not-found", { skip }, async () => {
  const { t, dad, leo, caleb } = await wangs();
  const { kidToken, row } = await cravingCard(t, dad);

  const dads = await ok(read(t, dad, row.id));
  like(dads, { id: row.id, side: "cook", askUrl: null });
  const web = await getCard(t, kidToken);
  const { id: _id, side: _side, askUrl: _askUrl, ...rest } = dads;
  const { askUrl: webAskUrl, ...webRest } = web;
  assert.deepEqual(rest, webRest);
  assert.ok(webAskUrl, "the web's card has its link; the app's never does");
  assert.deepEqual(Object.keys(dads), [...Object.keys(web), "id", "side"]);

  // Leo is in the family but hasn't claimed the kid side: the same answer as a card that isn't there.
  sameAsMissing(await read(t, leo, row.id), await read(t, leo, MISSING), "in the family, not on the card");
  like(await claim(t, leo, kidToken), { dishAskId: row.id, side: "kid", taken: false });
  like(await ok(read(t, leo, row.id)), { id: row.id, side: "kid", askUrl: null, kidName: "Caleb" });

  // Another family, an id that isn't a card, and no session.
  sameAsMissing(await read(t, caleb, row.id), await read(t, caleb, MISSING), "another family");
  like(await read(t, dad, "not-an-id"), { status: 404, data: { error: "not_found", message: "Not found." } });
  assert.equal((await read(t, null, row.id)).status, 401);

  // Her version shows on both sides once it's written.
  await ok(call(t, dad, "POST", `/v1/cravings/${row.id}/voice-recipe`, { audioKey: await voiceUpload(t, dad, row.id), durationS: 30 }));
  like(await ok(read(t, leo, row.id)), { status: "asked", merging: true, version: null, answers: [] });
  await settle();
  for (const who of [dad, leo]) {
    const card = await ok(read(t, who, row.id));
    like(card, { status: "answered", merging: false, answers: [{ id: "q4", words: FAKE_WORDS, audioUrl: anyString }] });
    assert.notEqual(card.version, null);
  }
});

test("the kid sees none of her clips until she sends, or leaves them 20 minutes; her own look changes nothing", { skip }, async () => {
  const { t, dad, leo } = await wangs();
  const sides = async () => {
    const c = await askedCard(t);
    await claim(t, leo, c.kidToken);
    await claim(t, dad, c.askToken);
    return { ...c, id: (await rowOf(c.kidToken)).id };
  };

  // Send: nothing before it, her clip with her version after.
  const sent = await sides();
  assert.equal((await answer(t, sent.askToken, "q1")).status, 200);
  await runNow(); // her clip is heard
  for (const who of [leo, dad]) like(await ok(read(t, who, sent.id)), { status: "asked", answers: [], merging: false, version: null, finishedAt: null });
  assert.equal((await finish(t, sent.askToken)).status, 200);
  like(await ok(read(t, leo, sent.id)), { answers: [], merging: true, finishedAt: anyNumber });
  await settle();
  like(await ok(read(t, leo, sent.id)), { status: "answered", answers: [{ id: "q1", words: FAKE_WORDS }] });

  // Left 20 minutes: her own look changes nothing, and the kid's counts them as sent.
  const left = await sides();
  assert.equal((await answer(t, left.askToken, "q1", { ip: "192.0.2.44" })).status, 200);
  await advance(21 * MIN);
  like(await ok(read(t, dad, left.id)), { answers: [], finishedAt: null, merging: false });
  assert.equal((await rowOf(left.kidToken)).finished_at, null);
  like(await ok(read(t, leo, left.id)), { answers: [], finishedAt: anyNumber, merging: true });
  await settle();
  const done = await ok(read(t, leo, left.id));
  like(done, { status: "answered", merging: false, answers: [{ id: "q1", words: FAKE_WORDS }] });
  assert.notEqual(done.version, null);
  like(await ok(read(t, dad, left.id)), { status: "answered", answers: [{ id: "q1" }] });
  // No recipe on either side: a card never names one.
  assert.ok(!JSON.stringify(done).includes("recipeId"));
  assert.equal((await db().query("select count(*)::int as n from dish_asks where person_id = $1", [leo.personId])).rows[0].n, 2);
});

after(async () => {
  if (hasDatabase) await db().end();
});

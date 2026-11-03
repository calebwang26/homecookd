// "Put it on the map" on the new api (convex/shareRequests.test.ts): a kid's ask becomes the cook's question, in her language; her answer is read; only a clear yes
// shares it and queues its story card; after a no the family waits a day; her own tap shares it at once. Real Postgres, with the queue run by hand and stand-in models.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db.js";
import { models } from "../src/modules/messages/models.js";
import { ASK_AGAIN_MS, shareQuestion } from "../src/modules/messages/shareAsks.js";
import { STORY_CARD_TASK } from "../src/modules/messages/storyCards.js";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { call, MISSING, ok, person, recipe, refusedWith, sameAsMissing, type Who, world } from "./communityHelpers.js";
import { hasDatabase, like, silent } from "./dishHelpers.js";

const skip = !hasDatabase;
const ask = (t: FastifyInstance, who: Who, recipeId: string) => call(t, who, "POST", "/v1/share-requests", { recipeId });
const familyDishes = async (t: FastifyInstance, who: Who) => (await ok(call(t, who, "GET", "/v1/share-requests/dishes"))).dishes;
const questionRows = async () => (await db().query("select * from questions order by created_at")).rows;
const answer = (t: FastifyInstance, who: Who, questionId: string, text: string) =>
  call(t, who, "POST", `/v1/questions/${questionId}/answer`, { text }, { "idempotency-key": randomBytes(12).toString("hex") });
const openFor = async (t: FastifyInstance, who: Who) => (await ok(call(t, who, "GET", "/v1/questions/open"))).questions;
const NOT_MOVED = "This can't be done here yet.";
const realModels = { ...models };

let said: "yes" | "no" | "unclear" = "unclear";
const read: [string, string][] = [];

beforeEach(() => {
  said = "unclear";
  read.length = 0;
  models.translateForCook = async (text, language) => `(${language}) ${text}`;
  models.yesNo = async (question, words) => {
    read.push([question, words]);
    return said;
  };
  models.storyCard = async () => JSON.stringify({ story: "A family dish, shared with the neighbors.", culture: "", quote: 0 });
});

/** Runs what's due through the real consumer until nothing is left. */
async function drain(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const bodies: string[] = [];
    const sent = await sendDue(db(), async (_queue, body) => void bodies.push(body), undefined, 200);
    for (const body of bodies) await handleMessage(body, silent);
    if (sent === 0) return;
  }
  throw new Error("The queue never emptied");
}

/** What recipes/switch.ts reads: open is staging's RECIPE_WRITES=on. */
const writes = (on: boolean) => {
  if (on) process.env.RECIPE_WRITES = "on";
  else delete process.env.RECIPE_WRITES;
};
const sharedAt = async (recipeId: string) => (await db().query("select shared_at from recipes where id = $1", [recipeId])).rows[0].shared_at;
const queued = async (task: string) => (await db().query("select payload from outbox where payload->>'task' = $1", [task])).rows.map((r) => r.payload);

test("a kid's ask becomes the cook's open question, in Convex's words and her language; asking again while it waits makes no second one", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  await db().query("update people set language = 'mr' where id = $1", [rajani.personId]);
  const brother = await person(rajani.familyId, "Vikram", "kid");
  const poha = await recipe(rajani);
  assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "asked" });

  const [q] = await questionRows();
  like(q, { kind: "share", status: "asked_cook", asked_by: shreya.personId, recipe_id: poha, step_order: null, share_said: null, text: shareQuestion("Shreya", "Kanda Poha") });
  assert.equal(q.text, "Shreya wants to put your Kanda Poha on the map for neighbors. They'd see the recipe, one line you said and homie's guess at where the dish is from, never your video. Is that okay?");
  assert.deepEqual(await queued("questions.translate"), [{ task: "questions.translate", questionId: q.id, language: "mr" }]);
  await drain();

  const [mine] = await openFor(t, rajani);
  like(mine, { id: q.id, kind: "share", askedByName: "Shreya", recipeTitle: "Kanda Poha", textForCook: `(mr) ${q.text}`, shareDecision: null });
  // Cook mode never plays a share ask, and the kid's own list never shows one.
  assert.deepEqual((await ok(call(t, shreya, "GET", `/v1/recipes/${poha}/questions`))).questions, []);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });

  // Again, by her brother, and four at once: still the one question, asked once.
  assert.deepEqual(await ok(ask(t, brother, poha)), { result: "asked" });
  const replies = await Promise.all([shreya, brother, shreya, brother].map((who) => ask(t, who, poha)));
  assert.deepEqual(replies.map((r) => [r.status, r.data.result]), Array(4).fill([200, "asked"]));
  assert.equal((await questionRows()).length, 1);
  // A cook-mode question sends no push, as on Convex.
  assert.equal((await db().query("select count(*)::int as n from push_log")).rows[0].n, 0);
});

test("two kids asking at the same moment write one question", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const kids = [shreya, ...(await Promise.all(["Vikram", "Asha", "Neel"].map((n) => person(rajani.familyId, n, "kid"))))];
  for (let round = 0; round < 5; round += 1) {
    const dish = await recipe(rajani, { title: `Dish ${round}` });
    const replies = await Promise.all(kids.map((who) => ask(t, who, dish)));
    assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal((await db().query("select count(*)::int as n from questions where recipe_id = $1", [dish])).rows[0].n, 1, `round ${round}`);
  }
});

test("her yes, read from her answer, puts it on the map and queues its card once; asking after says it's shared", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  writes(true);
  try {
    const poha = await recipe(rajani);
    await ok(ask(t, shreya, poha));
    const [q] = await questionRows();
    said = "yes";
    await ok(answer(t, rajani, q.id, "Haan, chalel."));
    await drain();
    // homie reads her words against the fixed question, never the family's.
    assert.deepEqual(read, [["May homie put your recipe on the neighborhood map?", "Haan, chalel."]]);
    assert.ok(await sharedAt(poha));
    assert.deepEqual(await queued(STORY_CARD_TASK), [{ task: STORY_CARD_TASK, recipeId: poha }]);
    like((await questionRows())[0], { status: "answered", share_said: "yes" });
    like((await familyDishes(t, shreya))[0], { shared: true, asked: false, notNowAt: null });
    assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "shared" });
    assert.deepEqual(await openFor(t, rajani), []);
  } finally {
    writes(false);
  }
});

test("a no or an unclear answer: nobody in the family can ask again for a day, then they can", { skip }, async () => {
  for (const no of ["no", "unclear"] as const) {
    const { t, rajani, shreya } = await world();
    writes(true);
    try {
      const brother = await person(rajani.familyId, "Vikram", "kid");
      const poha = await recipe(rajani);
      await ok(ask(t, shreya, poha));
      said = no;
      await ok(answer(t, rajani, (await questionRows())[0].id, "Not now, beta."));
      await drain();
      assert.equal(await sharedAt(poha), null, no);
      like((await familyDishes(t, shreya))[0], { shared: false, asked: false, notNowAt: (v: unknown) => typeof v === "number" });

      for (const who of [shreya, brother]) {
        const r = await refusedWith(ask(t, who, poha), 409, "Rajani said not now. Ask again tomorrow.");
        assert.equal(r.data.error, "declined");
      }
      assert.equal((await questionRows()).length, 1);

      // A day later.
      await db().query("update questions set share_decided_at = share_decided_at - make_interval(secs => $1)", [ASK_AGAIN_MS / 1000 + 1]);
      assert.deepEqual(await ok(ask(t, brother, poha)), { result: "asked" }, no);
      const rows = await questionRows();
      assert.equal(rows.length, 2);
      like(rows[1], { asked_by: brother.personId, share_said: null, status: "asked_cook" });
    } finally {
      writes(false);
    }
  }
});

test("only the recipe's cook may answer its share ask: another cook and the kid are refused, and nothing is read", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const aai = await person(rajani.familyId, "Aai", "cook");
  const poha = await recipe(rajani);
  await ok(ask(t, shreya, poha));
  const [q] = await questionRows();
  await refusedWith(answer(t, aai, q.id, "Yes"), 403, "Only the recipe's cook can answer this.");
  assert.equal((await refusedWith(answer(t, shreya, q.id, "Yes"), 403)).data.error, "forbidden");
  // Another cook's open list doesn't show it either: it's about Rajani's recipe.
  assert.deepEqual(await openFor(t, aai), []);
  await drain();
  assert.deepEqual(read, []);
  like((await questionRows())[0], { status: "asked_cook", answer_by: null });
});

test("her own tap shares it at once while recipe writes are open; with them off it's not_moved, with nothing changed", { skip }, async () => {
  const { t, rajani } = await world();
  const dal = await recipe(rajani, { title: "Varan" });
  const before = await db().query("select * from recipes where id = $1", [dal]);
  const r = await refusedWith(ask(t, rajani, dal), 501, NOT_MOVED);
  assert.equal(r.data.error, "not_moved");
  assert.deepEqual((await db().query("select * from recipes where id = $1", [dal])).rows, before.rows);
  assert.deepEqual(await queued(STORY_CARD_TASK), []);

  writes(true);
  try {
    assert.deepEqual(await ok(ask(t, rajani, dal)), { result: "shared" });
    assert.ok(await sharedAt(dal));
    assert.deepEqual(await queued(STORY_CARD_TASK), [{ task: STORY_CARD_TASK, recipeId: dal }]);
    assert.deepEqual(await questionRows(), []); // she isn't asked her own question
    assert.deepEqual(await ok(ask(t, rajani, dal)), { result: "shared" });
    assert.equal((await queued(STORY_CARD_TASK)).length, 1);
  } finally {
    writes(false);
  }
});

test("the chooser: an ask is waiting until homie reads her answer; a no shows when she said it; a newer ask replaces it", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const poha = await recipe(rajani);
  await ok(ask(t, shreya, poha));
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
  // She answered, and homie hasn't read it yet.
  await db().query("update questions set status = 'answered', answer_by = $1, answer_text = 'Not now, beta.', answered_at = now() where recipe_id = $2", [rajani.personId, poha]);
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
  assert.deepEqual(await ok(ask(t, shreya, poha)), { result: "asked" });

  await db().query("update questions set share_said = 'no', share_decided_at = now() - interval '25 hours' where recipe_id = $1", [poha]);
  const [notNow] = await familyDishes(t, shreya);
  like(notNow, { shared: false, asked: false, notNowAt: (v: unknown) => typeof v === "number" });

  await ok(ask(t, shreya, poha));
  like((await familyDishes(t, shreya))[0], { asked: true, notNowAt: null });
});

test("an unclear answer shows as not now too; a yes shows as nothing waiting", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const varan = await recipe(rajani, { title: "Varan" });
  const sheera = await recipe(rajani, { title: "Sheera" });
  for (const [dish, word] of [[varan, "unclear"], [sheera, "yes"]]) {
    await ok(ask(t, shreya, dish));
    await db().query("update questions set share_said = $2, share_decided_at = now() where recipe_id = $1", [dish, word]);
  }
  const dishes = Object.fromEntries((await familyDishes(t, shreya)).map((d: any) => [d.dish, [d.shared, d.asked, typeof d.notNowAt]]));
  assert.deepEqual(dishes, { Varan: [false, false, "number"], Sheera: [false, false, "object"] });
});

test("nobody outside the family can ask, the same as a recipe that isn't there; one that isn't ready is no recipe", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom } = await world();
  const dal = await recipe(rajani, { title: "Varan" });
  sameAsMissing(await ask(t, serene, dal), await ask(t, serene, MISSING), "another family's recipe");
  sameAsMissing(await ask(t, serenesMom, dal), await ask(t, serenesMom, MISSING), "another family's recipe, as a cook");
  await refusedWith(ask(t, serene, dal), 404, "Pick one of your family's recipes.");
  assert.deepEqual(await familyDishes(t, serenesMom), []); // the Zhangs have no dishes
  const cooking = await recipe(rajani, { title: "Still Cooking", status: "processing" });
  sameAsMissing(await ask(t, shreya, cooking), await ask(t, shreya, MISSING), "a recipe still processing");
  await refusedWith(ask(t, rajani, cooking), 404, "Pick one of your family's recipes."); // to its cook too: only a ready one can go on the map
  assert.deepEqual(await questionRows(), []);
  assert.deepEqual((await familyDishes(t, shreya)).map((d: any) => d.dish), ["Varan"]); // ready dishes only
});

test("a dish already on the map says so, to the kid and to her, and asks nothing", { skip }, async () => {
  const { t, rajani, shreya } = await world();
  const shared = await recipe(rajani, { sharedAt: 1 });
  assert.deepEqual(await ok(ask(t, shreya, shared)), { result: "shared" });
  assert.deepEqual(await ok(ask(t, rajani, shared)), { result: "shared" });
  like((await familyDishes(t, shreya))[0], { shared: true, asked: false, notNowAt: null });
  assert.deepEqual(await questionRows(), []);
});

test("setShare and setLocation aren't here: they write rows the sync owns", { skip }, async () => {
  const { t, rajani } = await world();
  const dal = await recipe(rajani);
  for (const url of ["/v1/community/recipes/x/share", `/v1/community/recipes/${dal}/share`, "/v1/community/share", "/v1/community/location", "/v1/me/location"]) {
    assert.equal((await call(t, rajani, "POST", url, {})).status, 404, url);
  }
});

after(async () => {
  Object.assign(models, realModels);
  if (hasDatabase) await db().end();
});

// A recipe that isn't ready yet, or failed, is its cook's alone (Caleb, Nov 1): every Messages route that takes a recipe id reads it, for anyone else, the same as
// an id that isn't there, so nothing says it exists. Cook mode, the photo note and a message naming a recipe need a finished one, so they refuse it to its cook too.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { closeAll, fakeModels, get, ok, post, recipe, type Reply, skip, uploaded, type Who, type World, world } from "./messagesHelpers.js";

const MISSING = randomUUID();

/** The same answer, byte for byte, but the request id. */
function sameAs(got: Reply, missing: Reply, what: string): void {
  const { requestId: _a, ...a } = got.data ?? {};
  const { requestId: _b, ...b } = missing.data ?? {};
  assert.deepEqual([got.status, a], [missing.status, b], what);
}

const ready = (id: string) => db().query(`update recipes set status = 'ready' where id = $1`, [id]);
const count = async (table: string) => (await db().query(`select count(*)::int as n from ${table}`)).rows[0].n;

/** A question already on the recipe, as the sync or an older build could have left it. */
async function questionOn(w: World, recipeId: string, asker: Who, words = "Salt?"): Promise<string> {
  const { rows } = await db().query(`insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, $4, 'asked_cook') returning id`, [
    w.family,
    recipeId,
    asker.id,
    words,
  ]);
  return rows[0].id;
}

test("asking in cook mode: a recipe that isn't ready reads as missing, to its cook too; once it's ready anyone can ask", { skip }, async () => {
  const w = await world();
  const cooking = await recipe(w.family, w.dad.id, { status: "processing" });
  const failed = await recipe(w.family, w.dad.id, { status: "failed" });
  const ask = (who: Who, recipeId: string) => post(w.app, who, "/v1/questions", { recipeId, text: "Canned beans ok?" });

  const missing = await ask(w.leo, MISSING);
  assert.equal(missing.status, 404);
  sameAs(await ask(w.leo, cooking), missing, "a kid, on Dad's processing recipe");
  sameAs(await ask(w.mom, cooking), missing, "another cook, on Dad's processing recipe");
  sameAs(await ask(w.leo, failed), missing, "a kid, on Dad's failed recipe");
  sameAs(await ask(w.dad, cooking), missing, "Dad, on his own: nothing to cook from yet");
  assert.equal(await count("questions"), 0);

  await ready(cooking);
  assert.equal(ok(await ask(w.leo, cooking), 201).status, "asked_cook");
  assert.equal(ok(await ask(w.mom, cooking), 201).status, "asked_cook");
});

test("a recipe's questions: one that isn't ready lists nothing, as a missing one, but to its cook; once ready the family reads them", { skip }, async () => {
  const w = await world();
  const cooking = await recipe(w.family, w.dad.id, { status: "processing" });
  const id = await questionOn(w, cooking, w.dad, "Did I say the salt?");
  const list = (who: Who, recipeId: string) => get(w.app, who, `/v1/recipes/${recipeId}/questions`);

  const missing = await list(w.leo, MISSING);
  assert.deepEqual(missing.data, { questions: [], nextCursor: null });
  sameAs(await list(w.leo, cooking), missing, "a kid");
  sameAs(await list(w.mom, cooking), missing, "another cook");
  assert.deepEqual(ok(await list(w.dad, cooking)).questions.map((q: any) => q.id), [id]);

  await ready(cooking);
  assert.deepEqual(ok(await list(w.leo, cooking)).questions.map((q: any) => q.id), [id]);
});

test("answering: a question on a recipe that isn't ready is no question to another cook; its own cook answers it; once ready any cook can", { skip }, async () => {
  const w = await world();
  const cooking = await recipe(w.family, w.dad.id, { status: "processing" });
  const first = await questionOn(w, cooking, w.leo);
  const second = await questionOn(w, cooking, w.leo, "Lid on?");
  const answer = (who: Who, id: string) => post(w.app, who, `/v1/questions/${id}/answer`, { text: "Yes" });

  const missing = await answer(w.mom, MISSING);
  assert.equal(missing.status, 404);
  sameAs(await answer(w.mom, first), missing, "another cook");
  assert.equal((await db().query(`select status from questions where id = $1`, [first])).rows[0].status, "asked_cook");
  ok(await answer(w.dad, first));

  await ready(cooking);
  ok(await answer(w.mom, second));
});

test("the photo note: a recipe that isn't ready reads as missing, to its cook too, with no model call; once ready it drafts", { skip }, async () => {
  const w = await world();
  const cooking = await recipe(w.family, w.dad.id, { status: "processing" });
  const note = async (who: Who, recipeId: string) => post(w.app, who, "/v1/messages/photo-note", { recipeId, photoKey: await uploaded(w, who, "photo") }, { key: null });

  const missing = await note(w.leo, MISSING);
  assert.equal(missing.status, 404);
  sameAs(await note(w.leo, cooking), missing, "a kid");
  sameAs(await note(w.mom, cooking), missing, "another cook");
  sameAs(await note(w.dad, cooking), missing, "Dad, on his own");
  assert.deepEqual(fakeModels.calls.note, []);

  await ready(cooking);
  assert.equal(ok(await note(w.leo, cooking)).aiDrafted, true);
});

test("a message naming a recipe: one that isn't ready reads as missing, from its cook too, and nothing is sent; once ready it goes", { skip }, async () => {
  const w = await world();
  const cooking = await recipe(w.family, w.dad.id, { status: "processing" });
  const send = (who: Who, to: Who, recipeId: string, kind = "text") =>
    kind === "photo"
      ? uploaded(w, who, "photo").then((photoKey) => post(w.app, who, "/v1/messages", { kind, photoKey, recipeId, to: to.id, text: "Made it!" }))
      : post(w.app, who, "/v1/messages", { kind, recipeId, to: to.id, text: "About this one" });

  const missing = await send(w.leo, w.dad, MISSING);
  assert.equal(missing.status, 404);
  sameAs(await send(w.leo, w.dad, cooking), missing, "a kid's text");
  sameAs(await send(w.leo, w.dad, cooking, "photo"), missing, "a kid's photo");
  sameAs(await send(w.mom, w.leo, cooking), missing, "another cook");
  sameAs(await send(w.dad, w.leo, cooking), missing, "Dad, to Leo: his push would name it");
  assert.deepEqual([await count("messages"), await count("outbox")], [0, 0]);

  await ready(cooking);
  const sent = ok(await send(w.leo, w.dad, cooking, "photo"));
  assert.equal(sent.recipeId, cooking);
  assert.equal(ok(await get(w.app, w.dad, "/v1/messages/made-my-dish")).messageId, sent.id);
});

after(closeAll);

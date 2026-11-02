// Questions while cooking: convex/flow.test.ts, language.test.ts, followUps.test.ts, and the answering half of shareRequests.test.ts, on real Postgres with fake models.
// What Convex wrote to `recipes` on a yes goes through recipeEffects here, so "the ingredient is added" reads "the effect ran once with these words" (a blocker in
// MESSAGES-MIGRATION.md). recipe.json parsing stays with the worker's area.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, tx } from "../src/db.js";
import { models, parseYesNo, yesNoPrompt } from "../src/modules/messages/models.js";
import { askFollowUps, YES_NO_QUESTION } from "../src/modules/messages/questions.js";
import { closeAll, drain, drainTwice, effects, fakeModels, get, ok, person, post, recipe, refused, skip, uploaded, useRealModels, type Who, type World, world } from "./messagesHelpers.js";

const rowOf = async (id: string) => (await db().query(`select * from questions where id = $1`, [id])).rows[0];
const ask = (w: World, who: Who, recipeId: string, words: string, extra: Record<string, unknown> = {}) =>
  post(w.app, who, "/v1/questions", { recipeId, text: words, ...extra }).then((r) => ok(r, 201));
const answer = (w: World, who: Who, id: string, body: Record<string, unknown>) => post(w.app, who, `/v1/questions/${id}/answer`, body);
const open = async (w: World, who: Who) => ok(await get(w.app, who, "/v1/questions/open")).questions;
const forRecipe = async (w: World, who: Who, id: string) => ok(await get(w.app, who, `/v1/recipes/${id}/questions`)).questions;
const voiceFor = (w: World, who: Who) => uploaded(w, who, "voice");

test("cooking: the video answers one, the cook answers the other; only the cook can", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const found = await ask(w, w.leo, chili, "How brown?", { stepOrder: 1, found: { startS: 60, endS: 90, quote: "Let it argue with you." } });
  assert.equal(found.status, "found_in_video");
  const asked = await ask(w, w.leo, chili, "Canned beans ok?", { stepOrder: 2 });
  assert.equal(asked.status, "asked_cook");

  const list = await open(w, w.dad);
  assert.deepEqual(list.map((q: any) => [q.id, q.text, q.askedByName, q.recipeTitle]), [[asked.questionId, "Canned beans ok?", "Leo", "Sunday Chili"]]);
  assert.deepEqual(await open(w, w.leo), []);

  refused(await answer(w, w.leo, asked.questionId, { text: "sure" }), 403, "forbidden");
  ok(await answer(w, w.dad, asked.questionId, { text: "Yes, rinse them." }));
  const all = await forRecipe(w, w.leo, chili);
  const mine = all.find((q: any) => q.id === asked.questionId);
  assert.deepEqual([mine.status, mine.answer.text], ["answered", "Yes, rinse them."]);
  assert.deepEqual(await open(w, w.dad), []);
  const seen = all.find((q: any) => q.id === found.questionId);
  assert.deepEqual(seen.found, { startS: 60, endS: 90, quote: "Let it argue with you." });
});

test("an answer needs words or a voice note, and at most 2000 characters; a question already answered is refused", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const { questionId } = await ask(w, w.leo, chili, "Beans?");
  refused(await answer(w, w.dad, questionId, {}), 400, "invalid", { field: undefined, message: "Say or type an answer first." });
  refused(await answer(w, w.dad, questionId, { text: "   " }), 400, "invalid", { field: undefined, message: "Say or type an answer first." });
  refused(await answer(w, w.dad, questionId, { text: "x".repeat(2001) }), 400, "invalid", { field: "text", message: "That message is too long." });
  ok(await answer(w, w.dad, questionId, { text: "Yes" }));
  refused(await answer(w, w.dad, questionId, { text: "No" }), 409, "answered", { message: "That question already has an answer." });
  refused(await answer(w, w.dad, "no-such-question", { text: "No" }), 404);
  refused(await post(w.app, w.leo, "/v1/questions", { recipeId: "nope", text: "?" }), 404, "not_found", { message: "That recipe isn't here anymore." });
  refused(await post(w.app, w.leo, "/v1/questions", { recipeId: chili }), 400, "invalid", { field: "text", message: "Write something first." });
  refused(await post(w.app, w.leo, "/v1/questions", { recipeId: chili, text: "?", found: { startS: "1" } }), 400, "invalid", "found");
});

test("any cook in the family can answer a cooking question; it isn't one of the recipe's own", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const { questionId } = await ask(w, w.leo, chili, "Beans?");
  ok(await answer(w, w.mom, questionId, { text: "Dad says yes" }));
});

test("a voice-note answer is transcribed by Cartesia Ink", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const { questionId } = await ask(w, w.leo, chili, "Canned beans ok?");
  ok(await answer(w, w.dad, questionId, { audioKey: await voiceFor(w, w.dad) }));
  await drain();
  assert.deepEqual(fakeModels.calls.transcribe, ["en"]);
  assert.deepEqual(fakeModels.calls.english, []); // English: nothing to translate
  const [q] = await forRecipe(w, w.leo, chili);
  assert.equal(q.answer.transcript, "Yes, rinse them first.");
  assert.equal(typeof q.answerAudioUrl, "string");
});

test("a Marathi voice-note answer keeps the cook's words and adds English", { skip }, async () => {
  const w = await world();
  const aai = await person(w.family, "Aai", "cook", { language: "mr" });
  const chili = await recipe(w.family, aai.id);
  const marathi = "हो आधी तांदूळ तीन वेळा धुवून घे.";
  fakeModels.transcript = () => Promise.resolve(marathi);
  fakeModels.english = () => Promise.resolve("Yes, first wash the rice three times.");
  const { questionId } = await ask(w, w.leo, chili, "Wash the rice?");
  ok(await answer(w, aai, questionId, { audioKey: await voiceFor(w, aai) }));
  await drain();
  assert.deepEqual(fakeModels.calls.transcribe, ["mr"]);
  const [q] = await forRecipe(w, w.leo, chili);
  assert.deepEqual([q.answer.transcript, q.answer.translation], [marathi, "Yes, first wash the rice three times."]);
  assert.equal(typeof q.answerAudioUrl, "string"); // the kid still hears the cook's own voice
});

test("a failed translation still saves the cook's words", { skip }, async () => {
  const w = await world();
  const aai = await person(w.family, "Aai", "cook", { language: "mr" });
  const chili = await recipe(w.family, aai.id);
  fakeModels.transcript = () => Promise.resolve("हो.");
  fakeModels.english = () => Promise.resolve(null);
  const { questionId } = await ask(w, w.leo, chili, "Wash the rice?");
  ok(await answer(w, aai, questionId, { audioKey: await voiceFor(w, aai) }));
  await drain();
  const [q] = await forRecipe(w, w.leo, chili);
  assert.deepEqual([q.answer.transcript, q.answer.translation], ["हो.", null]);
});

test("Ink failing leaves the voice note with no words, and the answer stays", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  fakeModels.transcript = () => Promise.reject(new Error("Ink is down"));
  const { questionId } = await ask(w, w.leo, chili, "Beans?");
  ok(await answer(w, w.dad, questionId, { audioKey: await voiceFor(w, w.dad) }));
  await drain();
  const row = await rowOf(questionId);
  assert.deepEqual([row.status, row.answer_transcript], ["answered", null]);
});

test("the transcribe task arriving twice calls Ink once", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const { questionId } = await ask(w, w.leo, chili, "Beans?");
  ok(await answer(w, w.dad, questionId, { audioKey: await voiceFor(w, w.dad) }));
  await drainTwice();
  assert.equal(fakeModels.calls.transcribe.length, 1);
  assert.equal((await rowOf(questionId)).answer_transcript, "Yes, rinse them first.");
});

test("the kid's question reaches a Marathi cook in Marathi; English needs no call; a failure stays English", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const first = await ask(w, w.leo, chili, "Canned beans ok?");
  await drain();
  assert.equal((await rowOf(first.questionId)).text_for_cook, null);
  assert.equal(fakeModels.calls.translate.length, 0);

  const aai = await person(w.family, "Aai", "cook", { language: "mr" });
  const hers = await recipe(w.family, aai.id);
  fakeModels.translate = () => Promise.resolve(" कॅन मधले बीन्स चालतील का? ".trim());
  const second = await ask(w, w.leo, hers, "Canned beans ok?");
  await drainTwice();
  assert.deepEqual(fakeModels.calls.translate, [["Canned beans ok?", "mr"]]);
  assert.equal((await rowOf(second.questionId)).text_for_cook, "कॅन मधले बीन्स चालतील का?");
  const [seen] = await open(w, aai);
  assert.equal(seen.textForCook, "कॅन मधले बीन्स चालतील का?");

  fakeModels.translate = () => Promise.reject(new Error("busy"));
  const third = await ask(w, w.leo, hers, "How long?");
  await drain();
  assert.equal((await rowOf(third.questionId)).text_for_cook, null);
});

test("a question found in the video is never translated: nobody's waiting on it", { skip }, async () => {
  const w = await world();
  const aai = await person(w.family, "Aai", "cook", { language: "mr" });
  const hers = await recipe(w.family, aai.id);
  await ask(w, w.leo, hers, "How brown?", { found: { startS: 1, endS: 2, quote: "Brown." } });
  await drain();
  assert.equal(fakeModels.calls.translate.length, 0);
});

// --- follow-ups

const SEEN = { id: "seen1", step: 2, question: "Step 2: we saw curry leaves but didn't hear it named. Does that go in, and how much?", ingredient: "curry leaves" };
const GAP = { id: "q1", step: 1, question: "How long do you soak the poha?" };

const publish = (w: World, cook: Who, recipeId: string, list: (typeof SEEN | typeof GAP)[], language: string | null = null) =>
  tx((c) => askFollowUps(c, { recipeId, familyId: w.family, cookId: cook.id, cookLanguage: language }, list));
const followUps = async () => (await db().query(`select * from questions where kind = 'follow_up' order by created_at`)).rows;

test("a published recipe's follow-ups become the cook's open questions, once, from homie, in her language", { skip }, async () => {
  const w = await world();
  const rajani = await person(w.family, "Rajani", "cook", { language: "mr" });
  const poha = await recipe(w.family, rajani.id, { title: "Kanda Poha" });
  fakeModels.translate = () => Promise.resolve("तुम्ही कढीपत्ता घातला का?");
  await publish(w, rajani, poha, [SEEN, GAP], "mr");
  await publish(w, rajani, poha, [SEEN, GAP], "mr"); // re-published: not asked twice
  await drain();
  const asked = await followUps();
  assert.equal(asked.length, 2);
  const seen = asked.find((q) => q.follow_up_id === "seen1");
  assert.deepEqual(
    [seen.asked_by, seen.status, seen.step_order, seen.text, seen.text_for_cook, seen.follow_up_ingredient],
    [rajani.id, "asked_cook", 2, SEEN.question, "तुम्ही कढीपत्ता घातला का?", "curry leaves"],
  );
  const list = await open(w, rajani);
  assert.deepEqual(list.map((q: any) => q.askedByName), ["homie", "homie"]);
  assert.deepEqual(list.map((q: any) => q.kind), ["followUp", "followUp"]);
});

test("her typed yes adds the ingredient with her words; a no adds nothing", { skip }, async () => {
  const w = await world();
  const poha = await recipe(w.family, w.mom.id, { title: "Kanda Poha" });
  fakeModels.yesNo = () => Promise.resolve("yes");
  await publish(w, w.mom, poha, [SEEN]);
  const [q] = await followUps();
  ok(await answer(w, w.mom, q.id, { text: "Yes, a handful, at the start" }));
  await drainTwice();
  assert.deepEqual(fakeModels.calls.yesNo, [["Did you add curry leaves to this dish?", "Yes, a handful, at the start"]]);
  assert.deepEqual(effects.ingredients, [{ recipeId: poha, name: "curry leaves", said: "Yes, a handful, at the start", step: 2, questionId: q.id }]);
  assert.equal((await rowOf(q.id)).follow_up_said, "yes");

  const upma = await recipe(w.family, w.mom.id, { title: "Upma" });
  fakeModels.yesNo = () => Promise.resolve("no");
  await publish(w, w.mom, upma, [SEEN]);
  const q2 = (await followUps()).find((x) => x.recipe_id === upma);
  ok(await answer(w, w.mom, q2.id, { text: "No, not in this one" }));
  await drain();
  assert.equal(effects.ingredients.length, 1);
  assert.equal((await rowOf(q2.id)).follow_up_said, "no");
});

test("an open-gap follow-up is answered like any question, with no yes/no read", { skip }, async () => {
  const w = await world();
  const poha = await recipe(w.family, w.mom.id);
  await publish(w, w.mom, poha, [GAP]);
  const [q] = await followUps();
  ok(await answer(w, w.mom, q.id, { text: "Two minutes in water" }));
  await drain();
  assert.equal(fakeModels.calls.yesNo.length, 0);
  assert.equal(effects.ingredients.length, 0);
});

test("only the recipe's own cook can answer a follow-up", { skip }, async () => {
  const w = await world();
  const poha = await recipe(w.family, w.mom.id);
  await publish(w, w.mom, poha, [SEEN]);
  const [q] = await followUps();
  refused(await answer(w, w.dad, q.id, { text: "Yes" }), 403, "forbidden", { message: "Only the recipe's cook can answer this." });
});

test("a voice-note yes is read from its transcript", { skip }, async () => {
  const w = await world();
  const poha = await recipe(w.family, w.mom.id);
  fakeModels.transcript = () => Promise.resolve("Yes, eight or ten leaves");
  fakeModels.yesNo = () => Promise.resolve("yes");
  await publish(w, w.mom, poha, [SEEN]);
  const [q] = await followUps();
  ok(await answer(w, w.mom, q.id, { audioKey: await voiceFor(w, w.mom) }));
  await drain();
  assert.deepEqual(effects.ingredients, [{ recipeId: poha, name: "curry leaves", said: "Yes, eight or ten leaves", step: 2, questionId: q.id }]);
});

test("a failed read, or a note nobody could write out, is unclear and adds nothing", { skip }, async () => {
  const w = await world();
  const poha = await recipe(w.family, w.mom.id);
  fakeModels.yesNo = () => Promise.reject(new Error("busy"));
  await publish(w, w.mom, poha, [SEEN]);
  const [q] = await followUps();
  ok(await answer(w, w.mom, q.id, { text: "Yes" }));
  await drain();
  assert.equal((await rowOf(q.id)).follow_up_said, "unclear");

  const upma = await recipe(w.family, w.mom.id);
  fakeModels.transcript = () => Promise.reject(new Error("Ink is down"));
  await publish(w, w.mom, upma, [SEEN]);
  const q2 = (await followUps()).find((x) => x.recipe_id === upma);
  ok(await answer(w, w.mom, q2.id, { audioKey: await voiceFor(w, w.mom) }));
  await drain();
  assert.equal((await rowOf(q2.id)).follow_up_said, "unclear");
  assert.equal(effects.ingredients.length, 0);
});

// --- share asks: the part that's questions. Asking and the map are Community's.

async function shareAsk(w: World, recipeId: string, asker: Who) {
  const { rows } = await db().query(
    `insert into questions (family_id, recipe_id, asked_by, text, kind, status) values ($1, $2, $3, 'May it go on the map?', 'share', 'asked_cook') returning id`,
    [w.family, recipeId, asker.id],
  );
  return rows[0].id as string;
}

test("her typed yes on a share ask is read against our fixed question; a no, unclear or a failure shares nothing", { skip }, async () => {
  const w = await world();
  const cases: [string, "yes" | "no" | "unclear" | "fail"][] = [["Yes, of course.", "yes"], ["No, keep it ours.", "no"], ["Maybe after Diwali.", "unclear"], ["Haan.", "fail"]];
  fakeModels.yesNo = (_q, a) => {
    const said = cases.find(([words]) => words === a)![1];
    return said === "fail" ? Promise.reject(new Error("busy")) : Promise.resolve(said);
  };
  const recipes: string[] = [];
  for (const [words] of cases) {
    const r = await recipe(w.family, w.mom.id);
    recipes.push(r);
    const id = await shareAsk(w, r, w.leo);
    ok(await answer(w, w.mom, id, { text: words }));
  }
  await drain();
  // The reader gets our fixed question, never the stored one, which has the asker's name and the dish.
  assert.deepEqual(fakeModels.calls.yesNo.map(([q]) => q), cases.map(() => YES_NO_QUESTION));
  assert.deepEqual(effects.shares, [{ recipeId: recipes[0], familyId: w.family }]);
  const said = (await db().query(`select share_said from questions where kind = 'share' order by created_at`)).rows.map((r) => r.share_said);
  assert.deepEqual(said, ["yes", "no", "unclear", "unclear"]);
});

test("a share ask: only the recipe's cook answers; a voice note is read once Ink writes it out; a note nobody can write out is unclear", { skip }, async () => {
  const w = await world();
  await db().query(`update people set language = 'mr' where id = $1`, [w.mom.id]);
  const poha = await recipe(w.family, w.mom.id);
  const id = await shareAsk(w, poha, w.leo);
  refused(await answer(w, w.dad, id, { text: "Yes." }), 403, "forbidden", { message: "Only the recipe's cook can answer this." });
  refused(await answer(w, w.leo, id, { text: "Yes." }), 403);
  refused(await answer(w, w.stranger, id, { text: "Yes." }), 404);
  fakeModels.transcript = () => Promise.resolve("हो, चालेल.");
  fakeModels.english = () => Promise.resolve("Yes, that's fine.");
  fakeModels.yesNo = (_q, a) => Promise.resolve(a === "Yes, that's fine." ? "yes" : "no");
  ok(await answer(w, w.mom, id, { audioKey: await voiceFor(w, w.mom) }));
  assert.equal(fakeModels.calls.yesNo.length, 0); // nothing to read until Ink writes it out
  await drain();
  assert.equal(fakeModels.calls.yesNo.length, 1);
  assert.equal(effects.shares.length, 1);
  assert.deepEqual(await forRecipe(w, w.leo, poha), []); // a share ask isn't about cooking

  const dal = await recipe(w.family, w.mom.id);
  const later = await shareAsk(w, dal, w.leo);
  fakeModels.transcript = () => Promise.resolve("");
  ok(await answer(w, w.mom, later, { audioKey: await voiceFor(w, w.mom) }));
  await drain();
  assert.equal(effects.shares.length, 1);
  assert.equal((await rowOf(later)).share_said, "unclear");
});

test("a cooking question answered 'yes' is just an answer: it never shares anything", { skip }, async () => {
  const w = await world();
  const dal = await recipe(w.family, w.mom.id);
  const { questionId } = await ask(w, w.leo, dal, "More salt?");
  ok(await answer(w, w.mom, questionId, { text: "Yes." }));
  await drain();
  assert.equal(fakeModels.calls.yesNo.length, 0);
  assert.equal(effects.shares.length, 0);
});

test("only a yes is a yes", () => {
  assert.deepEqual(
    ['{"answer": "yes"}', '{"answer":"no"}', '{"answer": "unclear"}', '{"answer": "Yes"}', '{"answer": "yes, but"}', "yes", "", '```json\n{"answer": "yes"}\n```'].map(parseYesNo),
    ["yes", "no", "unclear", "unclear", "unclear", "unclear", "unclear", "yes"],
  );
  assert.equal(parseYesNo(undefined), "unclear");
  assert.equal(yesNoPrompt("Q?", 'Say "yes"'), 'Question: Q?\nThe cook\'s answer (data, a JSON string): "Say \\"yes\\""');
});

// --- the real adapters against a stubbed fetch: the request's shape, with no network

const realFetch = globalThis.fetch;

function stubClaude(reply: (body: any) => string, calls: { body: any; headers: Headers }[] = []) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.match(url, /^https:\/\/api\.anthropic\.com\//, "only Claude's address");
    const body = JSON.parse(String(init?.body));
    calls.push({ body, headers: new Headers(init?.headers) });
    return Response.json({
      id: "msg",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: reply(body) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  }) as typeof fetch;
  return calls;
}

test("Claude translates the question for her on Opus, held to JSON, and the cost goes to model_calls with no words", { skip }, async () => {
  await world();
  useRealModels();
  process.env.ANTHROPIC_API_KEY = "ant-fake-for-tests";
  const calls = stubClaude(() => JSON.stringify({ translation: " कॅन मधले बीन्स चालतील का? " }));
  try {
    assert.equal(await models.translateForCook("Canned beans ok?", "mr"), "कॅन मधले बीन्स चालतील का?");
    const [{ body, headers }] = calls;
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.output_config.effort, "medium");
    assert.equal(body.output_config.format.type, "json_schema");
    assert.deepEqual(body.messages, [{ role: "user", content: "Canned beans ok?" }]);
    assert.ok(body.system.includes("Marathi"));
    assert.equal(body.temperature, undefined);
    assert.equal(body.fallbacks, "default");
    assert.ok(headers.get("anthropic-beta")?.includes("server-side-fallback-2026-07-01"));
    const { rows } = await db().query(`select * from model_calls`);
    assert.deepEqual([rows[0].purpose, rows[0].provider, rows[0].model, rows[0].ok], ["question_translate", "anthropic", "claude-opus-5-5", true]);
    assert.ok(!JSON.stringify(rows).includes("Canned beans"));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("with Claude, Sonnet drafts the photo note, seeing the photo by its URL", { skip }, async () => {
  const w = await world();
  useRealModels();
  process.env.ANTHROPIC_API_KEY = "ant-fake-for-tests";
  const calls = stubClaude(() => '"Made your chili, Dad. Not as good as yours yet!"');
  try {
    const chili = await recipe(w.family, w.dad.id);
    const photo = await uploaded(w, w.leo, "photo");
    const out = ok(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: photo }, { key: null }));
    assert.deepEqual(out, { draft: "Made your chili, Dad. Not as good as yours yet!", aiDrafted: true });
    const { body } = calls[0];
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.messages[0].content[0].text, 'Leo just cooked "Sunday Chili", the recipe Dad taught them, and is sending Dad this photo.');
    assert.equal(body.messages[0].content[1].type, "image");
    assert.equal(body.messages[0].content[1].source.type, "url");
    delete process.env.ANTHROPIC_API_KEY;
    refused(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: photo }, { key: null }), 503, "not_set_up");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("the yes/no read on Haiku gets the fixed question and her words as data", { skip }, async () => {
  await world();
  useRealModels();
  process.env.ANTHROPIC_API_KEY = "ant-fake-for-tests";
  const calls = stubClaude(() => JSON.stringify({ answer: "yes" }));
  try {
    assert.equal(await models.yesNo(YES_NO_QUESTION, "Yes."), "yes");
    assert.equal(await models.yesNo(YES_NO_QUESTION, "   "), "unclear");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.model, "claude-haiku-5-5");
    assert.equal(calls[0].body.messages[0].content, yesNoPrompt(YES_NO_QUESTION, "Yes."));
    assert.equal(calls[0].body.fallbacks, undefined);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

after(closeAll);

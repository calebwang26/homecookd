// Story cards (convex/storyCards.ts, community.shareOn, the writer's half of lib/storyCard.ts): her yes to a share ask puts the recipe on the map and queues its card, and a
// task writes it, behind the recipes switch. Real Postgres with a stand-in model; one test checks the real Claude request against a stubbed fetch. Carried from Convex:
// community.test.ts's writer half (the plain line without a model, stories only with her yes, Claude's request, a card going plain and written again, the quote by number,
// the culture), safety.test.ts's "a Muse card the filter catches goes plain", and lib/storyCard's rules. Made-up data only.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { db, tx } from "../src/db.js";
import { enqueue } from "../src/outbox.js";
import { hit, subjectKey } from "../src/rateLimit.js";
import { cleanCulture, parseCard, STORY_WORDS } from "../src/modules/community/storyCard.js";
import { CARD_SCHEMA, CARD_SYSTEM, WRITER_MODEL } from "../src/modules/messages/models.js";
import { recipeEffects } from "../src/modules/messages/questions.js";
import { CARD_LIMIT, shareOn, STORY_CARD_TASK, writeStoryCard } from "../src/modules/messages/storyCards.js";
import { storyCardSource } from "../src/modules/recipes/read.js";
import { deleteRecipeUnlessLocked } from "../src/modules/recipes/writes.js";
import { closeAll, drain, drainTwice, fakeModels, get, ok, person, post, refused, skip, useRealModels, type Who, world, type World } from "./messagesHelpers.js";

// The real one, before world() puts a recorder in its place.
const realShareYes = recipeEffects.shareYes;

const PLAIN = "Rajani's Kanda Poha, from the Pawar family.";
const CARD = "Rajani rinses the poha quick and tempers it with mustard seeds.";
const STORY = "Her mother made this every Sunday in Pune.";
const POHA_STEPS = [
  { order: 1, title: "Rinse the poha", text: "Rinse it twice.", quote: "Not too long, beta.", quoteOriginal: "जास्त वेळ नको", moment: { startS: 10, endS: 40 } },
  { order: 2, title: "Temper", text: "Mustard seeds in hot oil.", moment: { startS: 50, endS: 90 } },
];

type Pawars = { w: World; family: string; rajani: Who; aai: Who; shreya: Who };

/** The Pawars: Grandma Rajani and Aai cook, Shreya asks. The messages world's other family (Mei, Serene) are the neighbors. */
async function pawars(): Promise<Pawars> {
  const w = await world();
  recipeEffects.shareYes = realShareYes;
  const { rows } = await db().query(`insert into families (name, public_name) values ('Pawar home private name', 'Pawar') returning id`);
  const family: string = rows[0].id;
  return { w, family, rajani: await person(family, "Rajani", "cook"), aai: await person(family, "Aai", "cook"), shreya: await person(family, "Shreya", "kid") };
}

/** What recipes/switch.ts reads. Open is what the release that moves `recipes` sets; locked is the sync's first real run; closed is before it has ever run. */
async function writes(state: "open" | "closed" | "locked"): Promise<void> {
  if (state === "open") process.env.RECIPE_WRITES = "on";
  else delete process.env.RECIPE_WRITES;
  const [readOnly, moved] = state === "open" ? [false, true] : state === "locked" ? [true, false] : [false, false];
  await db().query(`update sync_copies set read_only = $1, moved_at = case when $2 then now() end where table_name = 'recipes'`, [readOnly, moved]);
}

type Card = { text: string; usedStories?: boolean; culture?: string; quote?: string };

async function poha(cook: Who, o: { title?: string; steps?: unknown[]; optIn?: boolean; shared?: boolean; card?: Card } = {}): Promise<string> {
  const { rows } = await db().query(
    `insert into recipes (family_id, cook_id, title, status, steps, memories, memories_opt_in, shared_at,
                          story_card_text, story_card_written_at, story_card_used_stories, story_card_culture, story_card_quote)
     values ($1, $2, $3, 'ready', $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [
      cook.familyId,
      cook.id,
      o.title ?? "Kanda Poha",
      JSON.stringify(o.steps ?? POHA_STEPS),
      JSON.stringify([{ kind: "story", text: STORY, moment: { startS: 60, endS: 80 } }]),
      o.optIn ?? false,
      o.shared ? new Date() : null,
      o.card?.text ?? null,
      o.card ? new Date(Date.now() - 86_400_000) : null,
      o.card?.usedStories ?? null,
      o.card?.culture ?? null,
      o.card?.quote ?? null,
    ],
  );
  return rows[0].id;
}

/** The card's columns, by Convex's names. */
async function cardOf(recipeId: string) {
  const { rows } = await db().query(
    `select shared_at, story_card_text as text, story_card_written_at as written_at, story_card_used_stories as used_stories, story_card_culture as culture,
            story_card_quote as quote from recipes where id = $1`,
    [recipeId],
  );
  return rows[0];
}

const words = async (recipeId: string) => {
  const { text, used_stories, culture, quote } = await cardOf(recipeId);
  return { text, used_stories, culture, quote };
};

async function shareAsk(p: Pawars, recipeId: string): Promise<string> {
  const { rows } = await db().query(
    `insert into questions (family_id, recipe_id, asked_by, text, kind, status) values ($1, $2, $3, 'May it go on the map?', 'share', 'asked_cook') returning id`,
    [p.family, recipeId, p.shreya.id],
  );
  return rows[0].id;
}

const answer = (p: Pawars, who: Who, questionId: string, words: string) => post(p.w.app, who, `/v1/questions/${questionId}/answer`, { text: words });

/** The cook's switch or her own tap, once Community calls shareOn (it doesn't yet): straight to the service, then the queue. */
async function shareAgain(recipeId: string) {
  const shared = await tx(async (c) => shareOn(c, (await storyCardSource(c, recipeId))!, "req-share"));
  await drain();
  return shared;
}

const logged: unknown[] = [];
const trace = { requestId: "req-test", log: { info: (o: object) => void logged.push(o), warn: (o: object) => void logged.push(o), error: (o: object) => void logged.push(o) } };

const queuedCards = async () => (await db().query(`select payload, request_id from outbox where payload->>'task' = $1 order by id`, [STORY_CARD_TASK])).rows;

const yes = () => {
  fakeModels.yesNo = () => Promise.resolve("yes");
};
const reply = (o: { story: string; culture?: string; quote?: unknown }) => JSON.stringify({ culture: "", quote: 0, ...o });

test("her yes puts it on the map, and the card is written once, in Convex's fields, from Convex's facts", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  try {
    yes();
    fakeModels.card = () => Promise.resolve(reply({ story: CARD, culture: "Maharashtrian", quote: 1 }));
    const r = await poha(p.rajani);
    ok(await answer(p, p.rajani, await shareAsk(p, r), "Haan, chalel."));
    await drainTwice(); // SQS may hand over each message twice

    const row = await cardOf(r);
    assert.ok(row.shared_at && row.written_at);
    assert.deepEqual(await words(r), { text: CARD, used_stories: false, culture: "Maharashtrian", quote: "Not too long, beta." });
    // Her name, the dish, its first steps and her quotes by number. Not her story (no yes to that yet), and never the family's private name.
    assert.deepEqual(fakeModels.calls.card, [
      "Cook: Rajani\n\nDish: Kanda Poha\n\nFirst steps:\nRinse the poha: Rinse it twice.\nTemper: Mustard seeds in hot oil.\n\nThe cook's own words, by number:\n1. Not too long, beta.",
    ]);

    // What the app reads: recipes.get's storyCard, as Convex's document had it, and the neighbors' feed and view.
    const mine = ok(await get(p.w.app, p.shreya, `/v1/recipes/${r}`));
    assert.deepEqual(mine.storyCard, { text: CARD, writtenAt: row.written_at.getTime(), usedStories: false, culture: "Maharashtrian", quote: "Not too long, beta." });
    assert.equal(mine.sharedAt, row.shared_at.getTime());
    const feed = ok(await get(p.w.app, p.w.stranger, "/v1/community/feed"));
    const { recipeId, familyName, story, culture, quote, quoteTranslated } = feed.recipes[0];
    assert.deepEqual({ recipeId, familyName, story, culture, quote, quoteTranslated }, { recipeId: r, familyName: "The Pawar family", story: CARD, culture: "Maharashtrian", quote: "Not too long, beta.", quoteTranslated: true });
    assert.equal(ok(await get(p.w.app, p.w.stranger, `/v1/community/recipes/${r}`)).story, CARD);

    // The queued work holds ids only, and carries the answer's request id.
    const queued = await queuedCards();
    assert.deepEqual(queued.map((q) => q.payload), [{ task: STORY_CARD_TASK, recipeId: r }]);
    const read = (await db().query(`select request_id from outbox where payload->>'task' = 'questions.read_share'`)).rows[0];
    assert.ok(read.request_id && queued[0].request_id === read.request_id);
  } finally {
    await writes("closed");
  }
});

test("her stories reach the model only after her yes; once she takes them back the card goes plain, and the next share writes it again", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  try {
    const withStory = "Rajani's poha, the one her mother made every Sunday in Pune.";
    const withoutStory = "Rajani's poha, rinsed quick and tempered with mustard seeds.";
    fakeModels.card = (facts) => Promise.resolve(reply({ story: facts.includes("every Sunday in Pune") ? withStory : withoutStory, culture: "Maharashtrian", quote: 1 }));
    const r = await poha(p.rajani, { optIn: true });
    const seen = async () => ({
      feed: ok(await get(p.w.app, p.w.stranger, "/v1/community/feed")).recipes[0]?.story,
      view: ok(await get(p.w.app, p.w.stranger, `/v1/community/recipes/${r}`)).story,
    });

    assert.equal(await shareAgain(r), "shared");
    assert.ok(fakeModels.calls.card[0].includes(`What the cook said while cooking:\n${STORY}`));
    assert.deepEqual(await words(r), { text: withStory, used_stories: true, culture: "Maharashtrian", quote: "Not too long, beta." });
    assert.deepEqual(await seen(), { feed: withStory, view: withStory });

    ok(await post(p.w.app, p.rajani, `/v1/recipes/${r}/memories-opt-in`, { optIn: false }));
    assert.deepEqual(await seen(), { feed: PLAIN, view: PLAIN });

    assert.equal(await shareAgain(r), "shared");
    assert.equal(fakeModels.calls.card.length, 2);
    assert.ok(!fakeModels.calls.card[1].includes("every Sunday in Pune"));
    assert.deepEqual(await words(r), { text: withoutStory, used_stories: false, culture: "Maharashtrian", quote: "Not too long, beta." });
    assert.deepEqual(await seen(), { feed: withoutStory, view: withoutStory });

    await shareAgain(r); // the card matches her answer now: the model isn't asked again
    assert.equal(fakeModels.calls.card.length, 2);
  } finally {
    await writes("closed");
  }
});

test("only her own answer shares it: another family can't trigger it, and reads none of the card's record", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  try {
    yes();
    const r = await poha(p.rajani);
    const q = await shareAsk(p, r);
    refused(await answer(p, p.w.stranger, q, "Yes"), 404, "not_found");
    refused(await answer(p, p.aai, q, "Yes"), 403, "only_the_recipes_cook");
    refused(await answer(p, p.shreya, q, "Yes"), 403, "forbidden");
    await drain();
    assert.deepEqual(await cardOf(r), { shared_at: null, text: null, written_at: null, used_stories: null, culture: null, quote: null });
    // A stray task for a recipe that isn't shared does nothing.
    await writeStoryCard(r, trace);
    assert.equal(fakeModels.calls.card.length, 0);
    assert.equal((await cardOf(r)).text, null);

    ok(await answer(p, p.rajani, q, "Yes"));
    await drain();
    assert.ok((await cardOf(r)).text);
    // Her recipe, card and all, reads as one that isn't there to another family. Neighbors get the card's words and nothing else of it.
    const theirs = await get(p.w.app, p.w.stranger, `/v1/recipes/${r}`);
    const missing = await get(p.w.app, p.w.stranger, "/v1/recipes/no-such-recipe");
    assert.equal(theirs.status, 404);
    assert.deepEqual({ ...theirs.data, requestId: 0 }, { ...missing.data, requestId: 0 });
    for (const body of [JSON.stringify(ok(await get(p.w.app, p.w.stranger, "/v1/community/feed"))), JSON.stringify(ok(await get(p.w.app, p.w.stranger, `/v1/community/recipes/${r}`)))]) {
      for (const field of ["storyCard", "usedStories", "writtenAt", "memories", "Pawar home private name"]) assert.ok(!body.includes(field), field);
    }
  } finally {
    await writes("closed");
  }
});

test("a failed model, an unusable answer, the word filter, no key or the limit: the whole plain line, never part of a card, and no words in the logs", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  // Written from her stories, which she has since taken back, so a new card is due. Its culture must not survive into the new one.
  const OLD = { text: "Rajani's poha, the one her mother made in Pune.", usedStories: true, culture: "Maharashtrian", quote: "Not too long, beta." };
  const plain = { text: PLAIN, used_stories: false, culture: null, quote: "Not too long, beta." };
  try {
    const cases: [string, () => Promise<string>, object][] = [
      ["the call fails", () => Promise.reject(new Error("overloaded")), plain],
      ["too long", () => Promise.resolve(reply({ story: "word ".repeat(STORY_WORDS + 1) })), plain],
      ["no sentence", () => Promise.resolve('{"culture": "Thai"}'), plain],
      ["the filter catches the sentence", () => Promise.resolve(reply({ story: "Rajani's fucking great poha.", culture: "Maharashtrian", quote: 1 })), plain],
      ["the filter catches the culture", () => Promise.resolve(reply({ story: CARD, culture: "Fuck", quote: 1 })), plain],
      ["a quote that isn't hers, and a culture too vague", () => Promise.resolve(reply({ story: CARD, culture: "a dish from many places, honestly", quote: STORY })), { text: CARD, used_stories: false, culture: null, quote: "Not too long, beta." }],
    ];
    for (const [what, answerWith, expected] of cases) {
      const r = await poha(p.rajani, { shared: true, card: OLD });
      fakeModels.card = answerWith;
      logged.length = 0;
      await writeStoryCard(r, trace);
      assert.deepEqual(await words(r), expected, what);
      assert.ok(!JSON.stringify(logged).match(/Rajani|poha|Pune|overloaded/i), what);
    }

    // The model picks her quote by its number, never writes one.
    const steps = [POHA_STEPS[0], { ...POHA_STEPS[1], quote: "Wait till the seeds start to dance." }];
    const second = await poha(p.rajani, { shared: true, steps });
    fakeModels.card = () => Promise.resolve(reply({ story: CARD, culture: "Maharashtrian", quote: 2 }));
    await writeStoryCard(second, trace);
    assert.equal((await words(second)).quote, "Wait till the seeds start to dance.");
    // No quotes at all: none on the card.
    const rice = await poha(p.rajani, { shared: true, title: "Plain Rice", steps: [{ order: 1, title: "Boil", text: "Boil it.", moment: { startS: 0, endS: 5 } }] });
    fakeModels.card = () => Promise.reject(new Error("down"));
    await writeStoryCard(rice, trace);
    assert.deepEqual(await words(rice), { text: "Rajani's Plain Rice, from the Pawar family.", used_stories: false, culture: null, quote: null });

    // Past her limit, no call: the plain line. A long window, so the hour can't turn mid-test.
    const limit = { ...CARD_LIMIT };
    Object.assign(CARD_LIMIT, { max: 1, windowS: 10 * 365 * 86_400 });
    try {
      await hit(subjectKey(p.rajani.id), [CARD_LIMIT]);
      const calls = fakeModels.calls.card.length;
      const r = await poha(p.rajani, { shared: true });
      fakeModels.card = () => Promise.resolve(reply({ story: CARD }));
      await writeStoryCard(r, trace);
      assert.equal(fakeModels.calls.card.length, calls);
      assert.deepEqual(await words(r), plain);
      // Another cook's limit is her own.
      const aais = await poha(p.aai, { shared: true });
      await writeStoryCard(aais, trace);
      assert.equal(fakeModels.calls.card.length, calls + 1);
    } finally {
      Object.assign(CARD_LIMIT, limit);
    }

    // A save that fails leaves the old card as it was, and the task fails, so the queue tries again.
    const kept = await poha(p.rajani, { shared: true, card: OLD });
    fakeModels.card = () => Promise.resolve(reply({ story: CARD, culture: "Indian", quote: 1 }));
    await db().query(`create function story_card_fail() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
    await db().query(`create trigger story_card_fail before update on recipes for each statement execute function story_card_fail()`);
    try {
      await assert.rejects(writeStoryCard(kept, trace));
    } finally {
      await db().query(`drop trigger story_card_fail on recipes`);
      await db().query(`drop function story_card_fail`);
    }
    assert.deepEqual(await words(kept), { text: OLD.text, used_stories: true, culture: "Maharashtrian", quote: OLD.quote });
  } finally {
    await writes("closed");
  }
});

test("with no model key: the plain line, no culture and her first step quote, and no call recorded", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  useRealModels();
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await poha(p.rajani, { shared: true });
    await writeStoryCard(r, trace);
    assert.deepEqual(await words(r), { text: PLAIN, used_stories: false, culture: null, quote: "Not too long, beta." });
    assert.equal((await db().query(`select count(*)::int as n from model_calls`)).rows[0].n, 0);
  } finally {
    await writes("closed");
  }
});

test("while the sync owns recipes, or before it has run: her yes is kept, and nothing is shared, written or paid for", { skip }, async () => {
  for (const state of ["locked", "closed"] as const) {
    const p = await pawars();
    yes();
    const r = await poha(p.rajani);
    const sharedNoCard = await poha(p.rajani, { shared: true, title: "Varan" });
    const q = await shareAsk(p, r);
    await writes(state);
    try {
      ok(await answer(p, p.rajani, q, "Yes"));
      await drain();
      assert.equal((await db().query(`select share_said from questions where id = $1`, [q])).rows[0].share_said, "yes", state);
      assert.equal((await cardOf(r)).shared_at, null, state);
      assert.deepEqual(await queuedCards(), [], state);
      // A card task queued while writes were open, for a shared recipe with no card, does nothing now.
      await enqueue(db(), { queue: "scheduled", payload: { task: STORY_CARD_TASK, recipeId: sharedNoCard } });
      await drain();
      assert.equal((await cardOf(sharedNoCard)).text, null, state);
      assert.equal(fakeModels.calls.card.length, 0, state);
      assert.equal((await db().query(`select count(*)::int as n from model_calls`)).rows[0].n, 0, state);
    } finally {
      await writes("closed");
    }
  }
});

test("her card goes with her recipe when she deletes her account: a task left behind, or one mid-call as she goes, writes nothing", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  try {
    const r = await poha(p.rajani, { shared: true });
    await enqueue(db(), { queue: "scheduled", payload: { task: STORY_CARD_TASK, recipeId: r } });
    assert.equal(await deleteRecipeUnlessLocked(db(), r), true); // the purge's own write
    await drain();
    assert.equal(fakeModels.calls.card.length, 0);

    const mid = await poha(p.rajani, { shared: true });
    fakeModels.card = async () => {
      await deleteRecipeUnlessLocked(db(), mid);
      return reply({ story: CARD });
    };
    await writeStoryCard(mid, trace);
    assert.equal(await cardOf(mid), undefined);
  } finally {
    await writes("closed");
  }
});

const realFetch = globalThis.fetch;

test("on Claude: Sonnet with Convex's request, the facts as the message, held to JSON, and the cost in model_calls with no words", { skip }, async () => {
  const p = await pawars();
  await writes("open");
  useRealModels();
  process.env.ANTHROPIC_API_KEY = "ant-fake-for-tests";
  const calls: { body: any; headers: Headers }[] = [];
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
      content: [{ type: "text", text: reply({ story: CARD, culture: "Maharashtrian", quote: 0 }) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  }) as typeof fetch;
  try {
    const closed = await poha(p.rajani, { shared: true });
    const open = await poha(p.rajani, { shared: true, optIn: true });
    for (const r of [closed, open]) await writeStoryCard(r, trace);
    assert.equal(calls.length, 2);
    assert.equal(calls.filter((c) => c.body.messages[0].content.includes("every Sunday in Pune")).length, 1);
    const { body, headers } = calls[0];
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.fallbacks, "default");
    assert.ok(headers.get("anthropic-beta")?.includes("server-side-fallback-2026-07-01"));
    assert.equal(body.system, CARD_SYSTEM);
    assert.ok(body.system.includes("never he, she, his or her") && body.system.includes("at most 20 words"));
    assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: CARD_SCHEMA } });
    assert.deepEqual(await words(closed), { text: CARD, used_stories: false, culture: "Maharashtrian", quote: "Not too long, beta." });
    assert.equal((await words(open)).used_stories, true);
    // Which model and prompt wrote each card, and what it cost, by recipe.
    const { rows } = await db().query(`select purpose, provider, model, prompt_version, ok, recipe_id from model_calls order by id`);
    assert.deepEqual(rows.map((row) => row.recipe_id), [closed, open]);
    assert.deepEqual([rows[0].purpose, rows[0].provider, rows[0].model, rows[0].ok], ["story_card", "anthropic", "claude-sonnet-5-5", true]);
    assert.match(rows[0].prompt_version, /^story_card:[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(rows).match(/Rajani|poha|Pune/i));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
    await writes("closed");
  }
});

test("story card rules: the culture label and the model's reply (convex/community.test.ts)", () => {
  assert.equal(cleanCulture(" Polish  American "), "Polish American");
  assert.deepEqual(["", "Unknown", "family", "Indo-Chinese fusion food, mostly", "<b>Thai</b>", 3].map(cleanCulture), [null, null, null, null, null, null]);
  assert.deepEqual(parseCard('{"story": "A sentence.", "culture": "Thai", "quote": 1}', ["Mine."]), { text: "A sentence.", culture: "Thai", quote: "Mine." });
  assert.deepEqual(parseCard('"Just a sentence."', []), { text: "Just a sentence.", culture: null, quote: null });
  assert.deepEqual(parseCard('```json\n{"story": "Fenced.", "culture": "", "quote": 0}\n```', ["First one."]), { text: "Fenced.", culture: null, quote: "First one." });
  assert.equal(parseCard('{"story": "' + "word ".repeat(26) + '"}', []), null);
  assert.equal(parseCard('{"culture": "Thai"}', []), null);
});

// While Convex is live, these are copies of its rules (AWS-MIGRATION requires the same behavior on old and new). When Convex's change, this fails, so the fix reaches
// both. It comes off with Convex. Skipped where convex/ isn't there, such as in the api's image.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const noConvex = !existsSync(join(root, "convex", "storyCards.ts"));
const source = (path: string) => readFileSync(join(root, path), "utf8");

/** A function's body: from its first line's end to its closing brace. Signatures differ only in their types. */
function body(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const open = text.indexOf("{\n", start);
  return text.slice(open, text.indexOf("\n}\n", open));
}

/** A constant's expression, as written. */
function expression(text: string, name: string): string {
  const start = text.indexOf(`const ${name} =`);
  assert.ok(start >= 0, name);
  return text.slice(start + `const ${name} =`.length, text.indexOf(";\n", start));
}

test("the writer's rules, its facts and its prompt are Convex's", { skip: noConvex }, () => {
  const lib = source("convex/lib/storyCard.ts");
  const rules = source("api/src/modules/community/storyCard.ts");
  for (const name of ["cleanCulture", "cleanStory", "fallbackCard", "plainStory", "storiesFor"]) assert.equal(body(rules, name), body(lib, name), name);
  assert.equal(body(rules, "parseCard"), body(lib, "parseMuseCard"));
  assert.ok(lib.includes(`STORY_WORDS = ${STORY_WORDS};`));

  const convexCards = source("convex/storyCards.ts");
  assert.equal(body(source("api/src/modules/messages/storyCards.ts"), "factLines"), body(convexCards, "factLines"));
  assert.equal(new Function("STORY_WORDS", `return (${expression(convexCards, "CARD_SYSTEM")});`)(STORY_WORDS), CARD_SYSTEM);
  assert.deepEqual(new Function(`return (${expression(convexCards, "CARD_SCHEMA")});`)(), CARD_SCHEMA);
  assert.ok(source("convex/lib/textModel.ts").includes(`WRITER_MODEL = "${WRITER_MODEL}"`));
  assert.ok(convexCards.includes(`claudeJson(apiKey, WRITER_MODEL, "low", CARD_SYSTEM, factLines(f), CARD_SCHEMA)`));
});

after(closeAll);

// The dish ask's model layer: convex/dishAskModel.test.ts carried over. Fake mode, and the real Claude, Ink and translation calls against a stubbed
// fetch, so the real SDK client, validators, retries, honesty rules and the spend count all run. No network, and no database.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  CLAUDE_PRICES,
  claudeCost,
  DishModelError,
  FAKE_COST,
  FAKE_WORDS,
  fakeGuessAnswer,
  INK_USD_PER_S,
  models,
  newSpend,
  type Spend,
  TRANSLATE_INSTRUCTIONS,
  TRANSLATE_MODEL,
} from "../src/modules/dish/model.js";
import type { MissRecipe } from "../src/modules/dish/recipe/types.js";
import { checkDraft, cleanShort } from "../src/modules/dish/recipe/validate.js";
import { close, like } from "./dishHelpers.js";

const { toEnglish, transcribe, translateForMom, writeGuess, writeVersion } = models;

const ENV = ["DISH_FAKE_AI", "DISH_MODEL", "ANTHROPIC_API_KEY", "CLAUDE_TRANSLATE_MODEL", "CARTESIA_API_KEY", "CARTESIA_API_KEYS_BACKUP", "DEPLOY_ENV"];
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DISH = "mom's tomato egg, kinda sweet, I think she used ketchup?";
const guessInput = (o: Partial<Parameters<typeof writeGuess>[0]> = {}) => ({
  dish: DISH,
  relation: "mom" as const,
  kidName: "Caleb",
  photos: [],
  voiceWords: null,
  ...o,
});
const spent = (): Spend => newSpend();
const USAGE = { input_tokens: 2000, output_tokens: 900 };
const HAIKU_CALL = claudeCost("claude-haiku-5-5", USAGE);

/** A Messages API reply as the SDK reads it (a thinking block first, as Haiku 5.5 sends). */
function claudeReply(text: string, stop = "end_turn", usage = USAGE): Response {
  return Response.json({
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "thinking", thinking: "", signature: "fake" }, ...(text ? [{ type: "text", text }] : [])],
    stop_reason: stop,
    stop_details: stop === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    stop_sequence: null,
    usage,
  });
}
const urlOf = (input: string | URL | Request) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** A fetch that plays Claude: `answer(n, body)` gives the n-th reply. Every request body is kept. */
function stubClaude(answer: (n: number, body: Record<string, unknown>) => Response) {
  const bodies: Record<string, any>[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (urlOf(input) !== "https://api.anthropic.com/v1/messages") throw new Error(`unexpected fetch ${urlOf(input)}`);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return answer(bodies.length, body);
  }) as typeof fetch;
  return { bodies };
}
function noFetch() {
  const counter = { calls: 0 };
  globalThis.fetch = (async () => {
    counter.calls += 1;
    throw new Error("no network in this test");
  }) as typeof fetch;
  return counter;
}

/** The canned guess with one change, as Claude would send it. */
function guessWith(change: (recipe: any, raw: any) => void): string {
  const raw = fakeGuessAnswer() as any;
  change(raw.recipe, raw);
  return JSON.stringify(raw);
}
const draft = (): MissRecipe => {
  const r = checkDraft(fakeGuessAnswer(), DISH);
  if (!r.ok || r.notADish) throw new Error("the canned guess should pass");
  return r.recipe;
};
const rejected = async (p: Promise<unknown>, kind: string) => {
  const e = (await p.then(() => assert.fail("should have thrown"), (x) => x)) as DishModelError;
  assert.ok(e instanceof DishModelError);
  assert.equal(e.kind, kind);
};

// ---------------------------------------------------------------------------------------------
// Fake mode

test("fake: the tomato egg card passes checkDraft again as it is, with no network and a fixed cost", async () => {
  process.env.DISH_FAKE_AI = "1";
  const fetch = noFetch();
  const spend = spent();
  const r = await writeGuess(guessInput({ voiceWords: FAKE_WORDS }), spend);
  if (r.notADish) throw new Error("a dish");
  const recipe = r.recipe;
  assert.deepEqual([recipe.dish, recipe.servings, recipe.time, recipe.cost], ["tomato egg", "1", "~15 min", "~$3"]);
  assert.deepEqual(recipe.questions.map((q) => q.id), ["q1", "q2", "q3"]);
  // The card back in Claude's shape (uses from 1) is unchanged by the real validator.
  const again = checkDraft(
    { heard: [], not_a_dish: false, recipe: { ...recipe, steps: recipe.steps.map((s) => ({ ...s, uses: s.uses.map((i) => i + 1) })) } },
    DISH,
  );
  assert.deepEqual(again, { ok: true, notADish: false, recipe });
  close(spend.usd, FAKE_COST.guess, 10);
  assert.deepEqual(await writeGuess(guessInput({ dish: " ASDF qwerty " }), spend), { notADish: true });
  close(spend.usd, 2 * FAKE_COST.guess, 10);
  assert.equal(fetch.calls, 0);
});

test("fake: her version keeps only what her words back; transcribe and toEnglish are canned", async () => {
  process.env.DISH_FAKE_AI = "1";
  const fetch = noFetch();
  const spend = spent();
  const before = draft();
  const v = await writeVersion(
    {
      draft: before,
      relation: "mom",
      asked: before.questions,
      answers: [
        { id: "q1", words: FAKE_WORDS, english: null },
        { id: "q2", words: "", english: null },
      ],
    },
    spend,
  );
  assert.deepEqual(v.ingredients[2], {
    name: "ketchup", amount: "two big spoons", status: "mom", ask: null, clip: "q1",
    was: before.ingredients[2].amount, quote: { words: "Two big spoons", english: null },
  });
  assert.deepEqual(v.ingredients[3], before.ingredients[3], "the sugar isn't in her words");
  assert.deepEqual(v.steps[0].lines[2], before.steps[0].lines[2], "q2 had no words");
  like(v.steps[1].lines[1], { text: "Stir in **two big spoons** of ketchup", status: "mom", clip: "q1" });
  assert.deepEqual([v.servings, v.cost, v.questions], ["1", "~$3", before.questions]);
  close(spend.usd, FAKE_COST.version, 10);

  const big = new Blob([new Uint8Array(100)], { type: "audio/webm" });
  const tiny = new Blob([new Uint8Array(99)], { type: "audio/webm" });
  assert.equal(await transcribe(big, "mr", 3, spend), "Two big spoons of ketchup.");
  assert.equal(await transcribe(tiny, "en", undefined, spend), "");
  assert.equal(await toEnglish("दोन मोठे चमचे", spend), "(English) दोन मोठे चमचे");
  assert.equal(await toEnglish("  ", spend), null);
  close(spend.usd, FAKE_COST.version + 2 * FAKE_COST.transcribe + FAKE_COST.toEnglish, 10);
  assert.equal(fetch.calls, 0);
});

test("fake mode is ignored on production: real recipes or none, never canned ones", async () => {
  process.env.DISH_FAKE_AI = "1";
  process.env.DEPLOY_ENV = "production";
  const fetch = noFetch();
  await rejected(writeGuess(guessInput(), spent()), "not_set_up");
  assert.equal(fetch.calls, 0);
});

// ---------------------------------------------------------------------------------------------
// The guess

test("guess: a rejected answer is retried once with the validator's errors, and both tries are counted", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const twoQuestions = guessWith((r) => r.questions.pop());
  const { bodies } = stubClaude((n) => claudeReply(n === 1 ? twoQuestions : JSON.stringify(fakeGuessAnswer())));
  const spend = spent();
  const r = await writeGuess(guessInput(), spend);
  assert.equal(r.notADish, false);
  assert.equal(bodies.length, 2);
  like(bodies[0], { model: "claude-haiku-5-5", thinking: { type: "disabled" }, output_config: { effort: "low", format: { type: "json_schema" } } });
  const retry = bodies[1].messages as { role: string; content: any }[];
  assert.deepEqual(retry.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(retry[1].content.map((b: { type: string }) => b.type), ["thinking", "text"], "sent back as it came");
  assert.ok(String(retry[2].content).includes("questions: need exactly 3"));
  close(spend.usd, 2 * HAIKU_CALL, 12);
  like(spend.calls.map((c) => ({ attempt: c.attempt, ok: c.ok, error: c.error })), [
    { attempt: 1, ok: false, error: "rejected by the checks" },
    { attempt: 2, ok: true, error: null },
  ]);

  // Two rejections: a model error, both tries counted.
  stubClaude(() => claudeReply(twoQuestions));
  const bad = spent();
  await rejected(writeGuess(guessInput(), bad), "model");
  close(bad.usd, 2 * HAIKU_CALL, 12);
});

test("guess: a refusal fails at once (no retry); a cut-off answer, a 429 or a 5xx is tried once more", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.DISH_MODEL = "claude-sonnet-5-5";
  const refused = stubClaude(() => claudeReply("", "refusal"));
  const spend = spent();
  await rejected(writeGuess(guessInput(), spend), "model");
  assert.equal(refused.bodies.length, 1);
  assert.equal(refused.bodies[0].model, "claude-sonnet-5-5");
  close(spend.usd, claudeCost("claude-sonnet-5-5", USAGE), 12); // a refusal is still paid for, at Sonnet's price

  const good = JSON.stringify(fakeGuessAnswer());
  const cut = stubClaude((n) => (n === 1 ? claudeReply('{"heard": [', "max_tokens") : claudeReply(good)));
  assert.equal((await writeGuess(guessInput(), spent())).notADish, false);
  assert.equal(cut.bodies.length, 2);

  const busy = stubClaude((n) => (n === 1 ? new Response("{}", { status: 429 }) : claudeReply(good)));
  const busySpend = spent();
  assert.equal((await writeGuess(guessInput(), busySpend)).notADish, false);
  assert.equal(busy.bodies.length, 2);
  close(busySpend.usd, claudeCost("claude-sonnet-5-5", USAGE), 12); // a 429 has no tokens

  const down = stubClaude(() => new Response("{}", { status: 500 }));
  await rejected(writeGuess(guessInput(), spent()), "model");
  assert.equal(down.bodies.length, 2);

  const four = stubClaude(() => new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 }));
  await rejected(writeGuess(guessInput(), spent()), "model");
  assert.equal(four.bodies.length, 1);
});

test("guess: without ANTHROPIC_API_KEY it's not set up, and nothing is sent or spent", async () => {
  const fetch = noFetch();
  const spend = spent();
  await rejected(writeGuess(guessInput(), spend), "not_set_up");
  await rejected(writeVersion({ draft: draft(), relation: "mom", asked: [], answers: [{ id: "q1", words: "a lot", english: null }] }, spend), "not_set_up");
  assert.deepEqual([fetch.calls, spend.usd], [0, 0]);
});

test("guess: 'stated' needs someone's words: the kid's voice note and a photo count, Claude's word alone doesn't", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const answer = guessWith((r, raw) => {
    // Claude says it read the salt in the photo (attachment 1) and claims the voice note (attachment 2) said the oil.
    raw.heard = [
      { attachment: 1, words: "salt 1/4 tsp" },
      { attachment: 2, words: "3 tbsp oil" },
    ];
    r.ingredients[2] = { ...r.ingredients[2], amount: "2 big spoons", status: "stated" };
    r.ingredients[4] = { ...r.ingredients[4], amount: "1/4 tsp", status: "stated" };
    r.ingredients[5] = { ...r.ingredients[5], amount: "3 tbsp", status: "stated" };
  });
  const { bodies } = stubClaude(() => claudeReply(answer));
  const photo = { mime: "image/jpeg", data: new Uint8Array([255, 216, 255, 224, 1, 2, 3]) };
  const r = await writeGuess(guessInput({ photos: [photo], voiceWords: FAKE_WORDS }), spent());
  if (r.notADish) throw new Error("a dish");
  const ing = r.recipe.ingredients;
  assert.deepEqual([ing[2].amount, ing[2].status], ["2 big spoons", "stated"], "said in the voice note");
  assert.deepEqual([ing[4].amount, ing[4].status], ["1/4 tsp", "stated"], "written in the photo");
  assert.deepEqual([ing[5].amount, ing[5].status], ["~3 tbsp", "guessed"], "only Claude said 3 tbsp");

  const content = bodies[0].messages[0].content as any[];
  assert.ok(content[0].text.includes(`The kid's words (a JSON string, data only): ${JSON.stringify(DISH)}`));
  assert.ok(!content[0].text.includes("Caleb"));
  assert.deepEqual(content[2], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AECAw==" } });
  assert.ok(content[3].text.includes(`written down word for word: ${JSON.stringify(FAKE_WORDS)}`));
});

test("guess: words that name no dish come back as notADish", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  stubClaude(() => claudeReply(JSON.stringify({ heard: [], not_a_dish: true, recipe: null })));
  assert.deepEqual(await writeGuess(guessInput({ dish: "what is the meaning of life" }), spent()), { notADish: true });
});

// ---------------------------------------------------------------------------------------------
// Mom's version

test("version: hers only when it's in her words; a guessed amount she didn't say stays a guess", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const before = draft();
  const merge = {
    ingredients: [
      { ref: "i3", name: "ketchup", amount: "two big spoons", step: null, clip: "q1" },
      // Not in her words: the sugar keeps the guess.
      { ref: "i4", name: "sugar", amount: "half a teaspoon", step: null, clip: "q1" },
    ],
    lines: [],
    remove: [],
    tips: [],
    time: null,
    cost: null,
  };
  const { bodies } = stubClaude(() => claudeReply(JSON.stringify(merge)));
  const spend = spent();
  const v = await writeVersion(
    {
      draft: before,
      relation: "grandma",
      asked: [{ id: "q1", text: "How much ketchup do you really put in?" }],
      answers: [
        { id: "q1", words: "Two big spoons, maybe a little more.", english: null },
        { id: "q2", words: "  ", english: null },
      ],
    },
    spend,
  );
  // No quote from Claude here, so the quote is the start of her answer.
  assert.deepEqual(v.ingredients[2], {
    name: "ketchup", amount: "two big spoons", status: "mom", ask: null, clip: "q1",
    was: before.ingredients[2].amount, quote: { words: "Two big spoons, maybe a little more.", english: null },
  });
  assert.deepEqual(v.ingredients[3], before.ingredients[3]);
  like(v.ingredients[3], { amount: "~1/2 tsp", status: "guessed", ask: "q1", clip: null });

  assert.equal(bodies.length, 1);
  like(bodies[0], { thinking: { type: "adaptive" }, output_config: { effort: "low" } });
  assert.ok(bodies[0].system.includes("asked Grandma questions"));
  const text = bodies[0].messages[0].content[0].text as string;
  assert.ok(text.includes('The kid asked: "How much ketchup do you really put in?"'));
  assert.ok(text.includes('What Grandma said: "Two big spoons, maybe a little more."'));
  assert.ok(!text.includes("Answer to q2"), "an answer with no words is left out");
  close(spend.usd, HAIKU_CALL, 12);
});

test("version: her Hindi and its English both reach Claude; a tip stays her Hindi, verbatim, with the English", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const before = draft();
  const words = "आख़िर में थोड़ा हरा प्याज़ डालती हूँ, बस एक मुट्ठी।";
  const english = "At the end I add a little green onion, just a handful.";
  const merge = {
    // Her amount and line in the English of her words (the kid cooks from them).
    ingredients: [{ ref: "i7", name: "green onion", amount: "just a handful", step: null, clip: "q3", quote: "थोड़ा हरा प्याज़", quote_english: "a little green onion" }],
    // A quote in English isn't her own words: it falls back to her answer, Hindi and English.
    lines: [{ ref: "s3.2", text: "Top with **a handful** of green onion", detail: null, clip: "q3", quote: "a little green onion", quote_english: null }],
    remove: [],
    tips: [
      { step: 3, words: "आख़िर में थोड़ा हरा प्याज़ डालती हूँ", english: "At the end I add a little green onion", clip: "q3" },
      // Not her own words (it's the English): dropped.
      { step: 1, words: "At the end I add a little green onion", english: null, clip: "q3" },
    ],
    time: null,
    cost: null,
  };
  const { bodies } = stubClaude(() => claudeReply(JSON.stringify(merge)));
  const v = await writeVersion({ draft: before, relation: "mom", asked: before.questions, answers: [{ id: "q3", words, english }] }, spent());
  const text = bodies[0].messages[0].content[0].text as string;
  assert.ok(text.includes(`What Mom said: ${JSON.stringify(words)}\nIn English: ${JSON.stringify(english)}`));
  assert.deepEqual(v.steps[2].tip, { words: "आख़िर में थोड़ा हरा प्याज़ डालती हूँ", english: "At the end I add a little green onion", clip: "q3" });
  assert.equal(v.steps[0].tip, null);
  assert.deepEqual(v.ingredients[6], {
    name: "green onion", amount: "just a handful", status: "mom", ask: null, clip: "q3",
    was: before.ingredients[6].amount, quote: { words: "थोड़ा हरा प्याज़", english: "a little green onion" },
  });
  like(v.steps[2].lines[1], { text: "Top with **a handful** of green onion", status: "mom", clip: "q3", was: before.steps[2].lines[1].text, quote: { words, english } });
});

test("version: with no words in any answer there is nothing to write, and nothing is sent", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const fetch = noFetch();
  await rejected(writeVersion({ draft: draft(), relation: "mom", asked: [], answers: [{ id: "q1", words: "", english: null }] }, spent()), "model");
  assert.equal(fetch.calls, 0);
});

// ---------------------------------------------------------------------------------------------
// Ink

function stubInk(answer: () => Response) {
  const inits: RequestInit[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (urlOf(input) !== "https://api.cartesia.ai/stt") throw new Error(`unexpected fetch ${urlOf(input)}`);
    inits.push(init!);
    return answer();
  }) as typeof fetch;
  return inits;
}

test("transcribe: Ink with the Cartesia key and her language; priced by Ink's reported length", async () => {
  process.env.CARTESIA_API_KEY = "cartesia-test";
  const inits = stubInk(() => Response.json({ type: "transcript", text: " Do motha chamcha ketchup. ", duration: 12.5 }));
  const spend = spent();
  const audio = new Blob([new Uint8Array(8000)], { type: "audio/webm;codecs=opus" });
  assert.equal(await transcribe(audio, "mr", 30, spend), "Do motha chamcha ketchup.");
  const headers = inits[0].headers as Record<string, string>;
  assert.deepEqual([headers.Authorization, headers["Cartesia-Version"]], ["Bearer cartesia-test", "2026-08-14"]);
  const form = inits[0].body as FormData;
  assert.deepEqual([form.get("language"), form.get("model"), (form.get("file") as File).name], ["mr", "ink-whisper", "answer.webm"]);
  close(spend.usd, 12.5 * INK_USD_PER_S, 12);
});

test("transcribe: without a reported length, durationS, else bytes / 4000; a failure is counted and thrown", async () => {
  process.env.CARTESIA_API_KEY = "cartesia-test";
  stubInk(() => Response.json({ text: "" }));
  const audio = new Blob([new Uint8Array(40_000)], { type: "audio/mp4" });
  const a = spent();
  assert.equal(await transcribe(audio, "en", 20, a), "");
  close(a.usd, 20 * INK_USD_PER_S, 12);
  const b = spent();
  await transcribe(audio, "en", undefined, b);
  close(b.usd, 10 * INK_USD_PER_S, 12);

  stubInk(() => new Response("down", { status: 500 }));
  const c = spent();
  await rejected(transcribe(audio, "en", 20, c), "model");
  close(c.usd, 20 * INK_USD_PER_S, 12);
  assert.equal(c.calls[0].error, "Ink: http 500");
});

test("transcribe: without CARTESIA_API_KEY it's not set up", async () => {
  const fetch = noFetch();
  const spend = spent();
  await rejected(transcribe(new Blob([new Uint8Array(500)]), "en", 2, spend), "not_set_up");
  assert.deepEqual([fetch.calls, spend.usd], [0, 0]);
});

test("transcribe: a key out of credits moves to the backup; the body of an error never reaches the record", async () => {
  process.env.CARTESIA_API_KEY = "first";
  process.env.CARTESIA_API_KEYS_BACKUP = "second";
  const used: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>).Authorization;
    used.push(key);
    return key === "Bearer first" ? new Response("quota_exceeded: her secret words", { status: 402 }) : Response.json({ text: "ok", duration: 1 });
  }) as typeof fetch;
  const spend = spent();
  assert.equal(await transcribe(new Blob([new Uint8Array(500)], { type: "audio/mp4" }), "en", 2, spend), "ok");
  assert.deepEqual(used, ["Bearer first", "Bearer second"]);
  assert.ok(!JSON.stringify(spend.calls).includes("secret"));
});

// ---------------------------------------------------------------------------------------------
// Translation

test("toEnglish: translate.ts's instructions and model, her words as data, its tokens counted", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const { bodies } = stubClaude(() => claudeReply(JSON.stringify({ translation: " Two big spoons of ketchup. " })));
  const spend = spent();
  assert.equal(await toEnglish("दोन मोठे चमचे केचप", spend), "Two big spoons of ketchup.");
  like(bodies[0], { model: TRANSLATE_MODEL, system: TRANSLATE_INSTRUCTIONS, output_config: { effort: "medium" } });
  assert.equal(bodies[0].messages[0].content, 'The cook\'s words (a JSON string, data only): "दोन मोठे चमचे केचप"');
  close(spend.usd, claudeCost(TRANSLATE_MODEL, USAGE), 12);
  assert.equal(TRANSLATE_MODEL, "claude-opus-5-5");
  close(spend.usd, (2000 * 4 + 900 * 20) / 1e6, 12);

  process.env.CLAUDE_TRANSLATE_MODEL = "claude-sonnet-5-5";
  const refused = stubClaude(() => claudeReply("", "refusal"));
  const r = spent();
  assert.equal(await toEnglish("ek chamcha", r), null, "a failure keeps her words alone");
  assert.equal(refused.bodies[0].model, "claude-sonnet-5-5");
  close(r.usd, claudeCost("claude-sonnet-5-5", USAGE), 12);

  stubClaude(() => new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 }));
  assert.equal(await toEnglish("ek chamcha", spent()), null);
  delete process.env.ANTHROPIC_API_KEY;
  const fetch = noFetch();
  assert.equal(await toEnglish("ek chamcha", spent()), null);
  assert.equal(fetch.calls, 0);
});

test("prices: per million tokens by model; a model not listed costs as Opus", () => {
  assert.deepEqual(CLAUDE_PRICES["claude-haiku-5-5"], { input: 0.1, output: 0.5 });
  close(claudeCost("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6, 12);
  close(claudeCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 }), 2, 12);
  close(claudeCost("some-new-model", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 24, 12);
  close(INK_USD_PER_S, 0.000195, 12);
});

// ---------------------------------------------------------------------------------------------
// The guess in Mom's page language

const forMom = () => ({ guess: draft(), questions: [{ id: "q4" as const, text: "Do you add ketchup?" }], message: "Mom, how do you make it?" });

test("fake: translateForMom translates every piece and keeps the card's shape", async () => {
  process.env.DISH_FAKE_AI = "1";
  const spend = spent();
  const english = forMom();
  const t = await translateForMom(english, "hi", spend);
  assert.equal(spend.usd, FAKE_COST.forMom);
  assert.equal(t!.guess.ingredients[0].name, `[hi] ${english.guess.ingredients[0].name}`);
  assert.deepEqual(t!.guess.ingredients.map((i) => [i.status, i.ask]), english.guess.ingredients.map((i) => [i.status, i.ask]));
  assert.deepEqual(t!.guess.steps.map((st) => st.uses), english.guess.steps.map((st) => st.uses));
  assert.deepEqual(t!.questions, [{ id: "q4", text: "[hi] Do you add ketchup?" }]);
  assert.equal(t!.message, "[hi] Mom, how do you make it?");
});

test("translateForMom: a piece that loses its ** marks or goes missing keeps its English; the call is counted", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const english = forMom();
  const line = english.guess.steps[0].lines[0];
  stubClaude(() =>
    claudeReply(
      JSON.stringify({
        items: [
          { id: "i0.name", text: "अंडे" },
          { id: "s0.0.text", text: line.text.replaceAll("**", "") }, // ** dropped: kept in English
          { id: "message", text: "माँ, आप इसे कैसे बनाती हैं?" },
        ],
      }),
    ),
  );
  const spend = spent();
  const t = await translateForMom(english, "hi", spend);
  assert.ok(spend.usd > 0);
  assert.equal(t!.guess.ingredients[0].name, "अंडे");
  assert.equal(t!.guess.ingredients[1].name, english.guess.ingredients[1].name);
  assert.equal(t!.guess.steps[0].lines[0].text, line.text);
  assert.equal(t!.message, "माँ, आप इसे कैसे बनाती हैं?");
});

test("translateForMom: no key or a failed call gives null (her page shows English)", async () => {
  assert.equal(await translateForMom(forMom(), "hi", spent()), null);
  process.env.ANTHROPIC_API_KEY = "sk-test";
  stubClaude(() => new Response("{}", { status: 400 }));
  assert.equal(await translateForMom(forMom(), "hi", spent()), null);
});

// ---------------------------------------------------------------------------------------------
// The card's short lines (DISH-ASK-SPEC.md §10)

test("cleanShort: about 6 words, bold and numbers only from the line itself, else null", () => {
  const line = "Stir-fry **2** tomatoes with **1 tsp** sugar on **medium-high**";
  assert.equal(cleanShort("Fry **2** tomatoes, **1 tsp** sugar", line), "Fry **2** tomatoes, **1 tsp** sugar");
  assert.equal(cleanShort("Fry **3** tomatoes", line), null, "a number the line doesn't have");
  assert.equal(cleanShort("Fry on **low**", line), null, "bold the line doesn't have");
  assert.equal(cleanShort("Fry the tomatoes with the sugar until it all turns saucy", line), null, "too long");
  assert.equal(cleanShort("", line), null);
  assert.equal(cleanShort(undefined, line), null);
});

test("the guess keeps a short line that checks out, and drops one that doesn't", () => {
  const raw = fakeGuessAnswer() as any;
  const first = raw.recipe.steps[0].lines[0];
  first.short = "Quick version";
  raw.recipe.steps[0].lines[1].short = "Add **999** eggs";
  const r = checkDraft(raw, DISH);
  if (!r.ok || r.notADish) throw new Error("the canned guess should pass");
  assert.equal(r.recipe.steps[0].lines[0].short, "Quick version");
  assert.equal(r.recipe.steps[0].lines[1].short, null);
});

// ---------------------------------------------------------------------------------------------
// New here: what's written down

test("each Claude call is written down with its tokens, model and prompt, and never its words", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  stubClaude(() => claudeReply(JSON.stringify(fakeGuessAnswer())));
  const spend = spent();
  await writeGuess(guessInput({ dish: "her secret tomato egg" }), spend);
  assert.equal(spend.calls.length, 1);
  const [call] = spend.calls;
  like(call, { purpose: "dish_guess", provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 2000, outputTokens: 900, ok: true, error: null, priceKnown: true });
  assert.match(call.promptVersion!, /^dish_guess:[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(call).includes("secret"));
});

test("what a failed check says about the model's answer isn't logged", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  stubClaude(() => claudeReply(guessWith((r) => { r.questions.pop(); r.dish = "her secret dal"; })));
  const lines: string[] = [];
  const log = { warn: (o: object, m: string) => void lines.push(JSON.stringify(o) + m), info: (o: object, m: string) => void lines.push(JSON.stringify(o) + m) };
  await rejected(writeGuess(guessInput(), newSpend(log)), "model");
  assert.ok(lines.length > 0);
  assert.ok(!lines.join("").includes("secret"));
});

// The dish ask's model layer (dishAskModel.ts, DISH-ASK-SPEC.md §6): fake mode, and the real Claude, Ink and
// translation calls against a stubbed fetch, so the real SDK client, validators, retries, honesty rules and the
// spend count all run. No network.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  CLAUDE_PRICES,
  claudeCost,
  DishModelError,
  FAKE_COST,
  FAKE_WORDS,
  fakeGuessAnswer,
  INK_USD_PER_S,
  type Spend,
  toEnglish,
  transcribe,
  writeGuess,
  writeVersion,
} from "./dishAskModel";
import type { MissRecipe } from "./lib/dishAsk/types";
import { checkDraft } from "./lib/dishAsk/validate";
import { TRANSLATE_MODEL } from "./lib/textModel";
import { INSTRUCTIONS } from "./lib/translate";

const ENV = [
  "DISH_FAKE_AI",
  "DISH_MODEL",
  "ANTHROPIC_API_KEY",
  "CLAUDE_TRANSLATE_MODEL",
  "CARTESIA_API_KEY",
  "CARTESIA_API_KEYS_BACKUP",
];

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV) delete process.env[k];
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
const spent = (): Spend => ({ usd: 0 });
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
const urlOf = (input: string | URL | Request) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** A fetch that plays Claude: `answer(n, body)` gives the n-th reply. Every request body is kept. */
function stubClaude(answer: (n: number, body: Record<string, unknown>) => Response) {
  const bodies: Record<string, any>[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (urlOf(input) !== "https://api.anthropic.com/v1/messages") throw new Error(`unexpected fetch ${urlOf(input)}`);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return answer(bodies.length, body);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, bodies };
}
const noFetch = () => {
  const fn = vi.fn(async () => {
    throw new Error("no network in this test");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};

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

// ---------------------------------------------------------------------------------------------
// Fake mode

test("fake: the tomato egg card passes checkDraft again as it is, with no network and a fixed cost", async () => {
  process.env.DISH_FAKE_AI = "1";
  const fetch = noFetch();
  const spend = spent();
  const r = await writeGuess(guessInput({ voiceWords: FAKE_WORDS }), spend);
  if (r.notADish) throw new Error("a dish");
  const recipe = r.recipe;
  expect([recipe.dish, recipe.servings, recipe.time, recipe.cost]).toEqual(["tomato egg", "1", "~15 min", "~$3"]);
  expect(recipe.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
  // The card back in Claude's shape (uses from 1) is unchanged by the real validator.
  const again = checkDraft(
    { heard: [], not_a_dish: false, recipe: { ...recipe, steps: recipe.steps.map((s) => ({ ...s, uses: s.uses.map((i) => i + 1) })) } },
    DISH,
  );
  expect(again).toEqual({ ok: true, notADish: false, recipe });
  expect(spend.usd).toBeCloseTo(FAKE_COST.guess, 10);
  expect(await writeGuess(guessInput({ dish: " ASDF qwerty " }), spend)).toEqual({ notADish: true });
  expect(spend.usd).toBeCloseTo(2 * FAKE_COST.guess, 10);
  expect(fetch).not.toHaveBeenCalled();
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
  expect(v.ingredients[2]).toEqual({
    name: "ketchup", amount: "two big spoons", status: "mom", ask: null, clip: "q1",
    was: before.ingredients[2].amount, quote: { words: "Two big spoons", english: null },
  });
  expect(v.ingredients[3], "the sugar isn't in her words").toEqual(before.ingredients[3]);
  expect(v.steps[0].lines[2], "q2 had no words").toEqual(before.steps[0].lines[2]);
  expect(v.steps[1].lines[1]).toMatchObject({ text: "Stir in **two big spoons** of ketchup", status: "mom", clip: "q1" });
  expect([v.servings, v.cost, v.questions]).toEqual(["1", "~$3", before.questions]);
  expect(spend.usd).toBeCloseTo(FAKE_COST.version, 10);

  const big = new Blob([new Uint8Array(100)], { type: "audio/webm" });
  const tiny = new Blob([new Uint8Array(99)], { type: "audio/webm" });
  expect(await transcribe(big, "mr", 3, spend)).toBe("Two big spoons of ketchup.");
  expect(await transcribe(tiny, "en", undefined, spend)).toBe("");
  expect(await toEnglish("दोन मोठे चमचे", spend)).toBe("(English) दोन मोठे चमचे");
  expect(await toEnglish("  ", spend)).toBeNull();
  expect(spend.usd).toBeCloseTo(FAKE_COST.version + 2 * FAKE_COST.transcribe + FAKE_COST.toEnglish, 10);
  expect(fetch).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------------------------
// The guess

test("guess: a rejected answer is retried once with the validator's errors, and both tries are counted", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const twoQuestions = guessWith((r) => r.questions.pop());
  const { bodies } = stubClaude((n) => claudeReply(n === 1 ? twoQuestions : JSON.stringify(fakeGuessAnswer())));
  const spend = spent();
  const r = await writeGuess(guessInput(), spend);
  expect(r.notADish).toBe(false);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({
    model: "claude-haiku-5-5",
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema" } },
  });
  const retry = bodies[1].messages as { role: string; content: any }[];
  expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(retry[1].content.map((b: { type: string }) => b.type), "sent back as it came").toEqual(["thinking", "text"]);
  expect(String(retry[2].content)).toContain("questions: need exactly 3");
  expect(spend.usd).toBeCloseTo(2 * HAIKU_CALL, 12);

  // Two rejections: a model error, both tries counted.
  stubClaude(() => claudeReply(twoQuestions));
  const bad = spent();
  await expect(writeGuess(guessInput(), bad)).rejects.toMatchObject({ kind: "model" });
  expect(bad.usd).toBeCloseTo(2 * HAIKU_CALL, 12);
});

test("guess: a refusal fails at once (no retry); a cut-off answer, a 429 or a 5xx is tried once more", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.DISH_MODEL = "claude-sonnet-5-5";
  const refused = stubClaude(() => claudeReply("", "refusal"));
  const spend = spent();
  const e = await writeGuess(guessInput(), spend).catch((x) => x);
  expect(e).toBeInstanceOf(DishModelError);
  expect([e.kind, refused.fn.mock.calls.length]).toEqual(["model", 1]);
  expect(refused.bodies[0].model).toBe("claude-sonnet-5-5");
  expect(spend.usd, "a refusal is still paid for, at Sonnet's price").toBeCloseTo(claudeCost("claude-sonnet-5-5", USAGE), 12);

  const good = JSON.stringify(fakeGuessAnswer());
  const cut = stubClaude((n) => (n === 1 ? claudeReply('{"heard": [', "max_tokens") : claudeReply(good)));
  expect((await writeGuess(guessInput(), spent())).notADish).toBe(false);
  expect(cut.fn).toHaveBeenCalledTimes(2);

  const busy = stubClaude((n) => (n === 1 ? new Response("{}", { status: 429 }) : claudeReply(good)));
  const busySpend = spent();
  expect((await writeGuess(guessInput(), busySpend)).notADish).toBe(false);
  expect(busy.fn).toHaveBeenCalledTimes(2);
  expect(busySpend.usd, "a 429 has no tokens").toBeCloseTo(claudeCost("claude-sonnet-5-5", USAGE), 12);

  const down = stubClaude(() => new Response("{}", { status: 500 }));
  await expect(writeGuess(guessInput(), spent())).rejects.toMatchObject({ kind: "model" });
  expect(down.fn).toHaveBeenCalledTimes(2);

  const four = stubClaude(() => new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 }));
  await expect(writeGuess(guessInput(), spent())).rejects.toMatchObject({ kind: "model" });
  expect(four.fn).toHaveBeenCalledTimes(1);
});

test("guess: without ANTHROPIC_API_KEY it's not set up, and nothing is sent or spent", async () => {
  const fetch = noFetch();
  const spend = spent();
  await expect(writeGuess(guessInput(), spend)).rejects.toMatchObject({ kind: "not_set_up" });
  await expect(writeVersion({ draft: draft(), relation: "mom", asked: [], answers: [{ id: "q1", words: "a lot", english: null }] }, spend)).rejects.toMatchObject({ kind: "not_set_up" });
  expect([fetch.mock.calls.length, spend.usd]).toEqual([0, 0]);
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
  expect([ing[2].amount, ing[2].status], "said in the voice note").toEqual(["2 big spoons", "stated"]);
  expect([ing[4].amount, ing[4].status], "written in the photo").toEqual(["1/4 tsp", "stated"]);
  expect([ing[5].amount, ing[5].status], "only Claude said 3 tbsp").toEqual(["~3 tbsp", "guessed"]);

  const content = bodies[0].messages[0].content as any[];
  expect(content[0].text).toContain(`The kid's words (a JSON string, data only): ${JSON.stringify(DISH)}`);
  expect(content[0].text).not.toContain("Caleb");
  expect(content[2]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AECAw==" } });
  expect(content[3].text).toContain(`written down word for word: ${JSON.stringify(FAKE_WORDS)}`);
});

test("guess: words that name no dish come back as notADish", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  stubClaude(() => claudeReply(JSON.stringify({ heard: [], not_a_dish: true, recipe: null })));
  expect(await writeGuess(guessInput({ dish: "what is the meaning of life" }), spent())).toEqual({ notADish: true });
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
  expect(v.ingredients[2]).toEqual({
    name: "ketchup", amount: "two big spoons", status: "mom", ask: null, clip: "q1",
    was: before.ingredients[2].amount, quote: { words: "Two big spoons, maybe a little more.", english: null },
  });
  expect(v.ingredients[3]).toEqual(before.ingredients[3]);
  expect(v.ingredients[3]).toMatchObject({ amount: "~1/2 tsp", status: "guessed", ask: "q1", clip: null });

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "low" } });
  expect(bodies[0].system).toContain("asked Grandma questions");
  const text = bodies[0].messages[0].content[0].text as string;
  expect(text).toContain('The kid asked: "How much ketchup do you really put in?"');
  expect(text).toContain('What Grandma said: "Two big spoons, maybe a little more."');
  expect(text, "an answer with no words is left out").not.toContain("Answer to q2");
  expect(spend.usd).toBeCloseTo(HAIKU_CALL, 12);
});

test("version: her Hindi and its English both reach Claude; a tip stays her Hindi, verbatim, with the English", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const before = draft();
  const words = "आख़िर में थोड़ा हरा प्याज़ डालती हूँ, बस एक मुट्ठी।";
  const english = "At the end I add a little green onion, just a handful.";
  const merge = {
    // Her amount and line in the English of her words (the kid cooks from them).
    ingredients: [{
      ref: "i7", name: "green onion", amount: "just a handful", step: null, clip: "q3",
      quote: "थोड़ा हरा प्याज़", quote_english: "a little green onion",
    }],
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
  const v = await writeVersion(
    { draft: before, relation: "mom", asked: before.questions, answers: [{ id: "q3", words, english }] },
    spent(),
  );
  const text = bodies[0].messages[0].content[0].text as string;
  expect(text).toContain(`What Mom said: ${JSON.stringify(words)}\nIn English: ${JSON.stringify(english)}`);
  expect(v.steps[2].tip).toEqual({ words: "आख़िर में थोड़ा हरा प्याज़ डालती हूँ", english: "At the end I add a little green onion", clip: "q3" });
  expect(v.steps[0].tip).toBeNull();
  expect(v.ingredients[6]).toEqual({
    name: "green onion", amount: "just a handful", status: "mom", ask: null, clip: "q3",
    was: before.ingredients[6].amount, quote: { words: "थोड़ा हरा प्याज़", english: "a little green onion" },
  });
  expect(v.steps[2].lines[1]).toMatchObject({
    text: "Top with **a handful** of green onion", status: "mom", clip: "q3",
    was: before.steps[2].lines[1].text, quote: { words, english },
  });
});

test("version: with no words in any answer there is nothing to write, and nothing is sent", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const fetch = noFetch();
  await expect(
    writeVersion({ draft: draft(), relation: "mom", asked: [], answers: [{ id: "q1", words: "", english: null }] }, spent()),
  ).rejects.toMatchObject({ kind: "model" });
  expect(fetch).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------------------------
// Ink

function stubInk(answer: () => Response) {
  const fn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    if (urlOf(input) !== "https://api.cartesia.ai/stt") throw new Error(`unexpected fetch ${urlOf(input)}`);
    return answer();
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

test("transcribe: Ink with the Cartesia key and her language; priced by Ink's reported length", async () => {
  process.env.CARTESIA_API_KEY = "cartesia-test";
  const fetch = stubInk(() => Response.json({ type: "transcript", text: " Do motha chamcha ketchup. ", duration: 12.5 }));
  const spend = spent();
  const audio = new Blob([new Uint8Array(8000)], { type: "audio/webm;codecs=opus" });
  expect(await transcribe(audio, "mr", 30, spend)).toBe("Do motha chamcha ketchup.");
  const init = fetch.mock.calls[0][1]!;
  const headers = init.headers as Record<string, string>;
  expect([headers.Authorization, headers["Cartesia-Version"]]).toEqual(["Bearer cartesia-test", "2026-08-14"]);
  const form = init.body as FormData;
  expect([form.get("language"), form.get("model"), (form.get("file") as File).name]).toEqual([
    "mr",
    "ink-whisper",
    "answer.webm",
  ]);
  expect(spend.usd).toBeCloseTo(12.5 * INK_USD_PER_S, 12);
});

test("transcribe: without a reported length, durationS, else bytes / 4000; a failure is counted and thrown", async () => {
  process.env.CARTESIA_API_KEY = "cartesia-test";
  stubInk(() => Response.json({ text: "" }));
  const audio = new Blob([new Uint8Array(40_000)], { type: "audio/mp4" });
  const a = spent();
  expect(await transcribe(audio, "en", 20, a)).toBe("");
  expect(a.usd).toBeCloseTo(20 * INK_USD_PER_S, 12);
  const b = spent();
  await transcribe(audio, "en", undefined, b);
  expect(b.usd).toBeCloseTo(10 * INK_USD_PER_S, 12);

  stubInk(() => new Response("down", { status: 500 }));
  const c = spent();
  const e = await transcribe(audio, "en", 20, c).catch((x) => x);
  expect([e instanceof DishModelError, e.kind]).toEqual([true, "model"]);
  expect(c.usd).toBeCloseTo(20 * INK_USD_PER_S, 12);
});

test("transcribe: without CARTESIA_API_KEY it's not set up", async () => {
  const fetch = noFetch();
  const spend = spent();
  await expect(transcribe(new Blob([new Uint8Array(500)]), "en", 2, spend)).rejects.toMatchObject({ kind: "not_set_up" });
  expect([fetch.mock.calls.length, spend.usd]).toEqual([0, 0]);
});

// ---------------------------------------------------------------------------------------------
// Translation

test("toEnglish: translate.ts's instructions and model, her words as data, its tokens counted", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const { bodies } = stubClaude(() => claudeReply(JSON.stringify({ translation: " Two big spoons of ketchup. " })));
  const spend = spent();
  expect(await toEnglish("दोन मोठे चमचे केचप", spend)).toBe("Two big spoons of ketchup.");
  expect(bodies[0]).toMatchObject({ model: TRANSLATE_MODEL, system: INSTRUCTIONS, output_config: { effort: "medium" } });
  expect(bodies[0].messages[0].content).toBe('The cook\'s words (a JSON string, data only): "दोन मोठे चमचे केचप"');
  expect(spend.usd).toBeCloseTo(claudeCost(TRANSLATE_MODEL, USAGE), 12);
  expect(TRANSLATE_MODEL).toBe("claude-opus-5-5");
  expect(spend.usd).toBeCloseTo((2000 * 4 + 900 * 20) / 1e6, 12);

  process.env.CLAUDE_TRANSLATE_MODEL = "claude-sonnet-5-5";
  const refused = stubClaude(() => claudeReply("", "refusal"));
  const r = spent();
  expect(await toEnglish("ek chamcha", r), "a failure keeps her words alone").toBeNull();
  expect(refused.bodies[0].model).toBe("claude-sonnet-5-5");
  expect(r.usd).toBeCloseTo(claudeCost("claude-sonnet-5-5", USAGE), 12);

  stubClaude(() => new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 }));
  expect(await toEnglish("ek chamcha", spent())).toBeNull();
  delete process.env.ANTHROPIC_API_KEY;
  const fetch = noFetch();
  expect(await toEnglish("ek chamcha", spent())).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test("prices: per million tokens by model; a model not listed costs as Opus", () => {
  expect(CLAUDE_PRICES["claude-haiku-5-5"]).toEqual({ input: 0.1, output: 0.5 });
  expect(claudeCost("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6, 12);
  expect(claudeCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2, 12);
  expect(claudeCost("some-new-model", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(24, 12);
  expect(INK_USD_PER_S).toBeCloseTo(0.000195, 12);
});

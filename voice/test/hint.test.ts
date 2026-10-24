// The kid's session (cook.ts) around a hint, on a fake clock: the hint and the ask to the cook are one step, a
// question write that fails mid-hint can't go unhandled, junk from the app never throws, and a phone that hangs up
// mid-turn hears (and costs) nothing more.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { Actions } from "../src/agent.js";
import type { CookSession } from "../src/convex.js";
import type { CookingDeps } from "../src/cook.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, fakeSpeak, settle, waitFor } from "./helpers.js";

// env.ts wants these at import. Nothing here calls a real service.
process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
process.env.VOICE_READ_OFFER = "1"; // these tests walk through the read-aloud offer (off by default)
const { Cooking } = await import("../src/cook.js");

const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => void unhandled.push(reason));

beforeEach(() => {
  unhandled.length = 0;
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") });
});
afterEach(() => mock.timers.reset());

let kids = 0;
const session = (kidId: string): CookSession => ({
  familyId: "fam-1",
  mossIndex: "",
  kid: { id: kidId, name: "Shreya" },
  cook: { name: "Grandma", language: "mr" },
  recipe: {
    id: "recipe-1",
    title: "Varan Bhaat",
    steps: [
      { order: 1, title: "Wash the rice", text: "Wash the rice three times.", moment: { startS: 0, endS: 30 } },
      { order: 2, title: "Temper", text: "Heat the ghee and add the cumin.", moment: { startS: 30, endS: 90 } },
    ],
    memories: [],
  },
  stepOrder: 1,
});

/** One kid's phone, past the greeting and the offer. `claude`: what the fake Claude does with each turn. */
async function phone(claude: (actions: Actions, text: string) => Promise<void>, logQuestion?: CookingDeps["convex"]["logQuestion"]) {
  const spoken: string[] = [];
  const turns: string[] = [];
  const questions: string[] = [];
  let stt: SttEvents | undefined;
  const deps: CookingDeps = {
    convex: {
      startSession: async () => session(`hint-kid-${++kids}`),
      setStep: async () => {},
      logQuestion:
        logQuestion ??
        (async (_token, _recipe, _step, text) => (questions.push(text), { status: "asked_cook", questionId: `q-${questions.length}` })),
    },
    listen: (events) => ((stt = events), { send: () => {}, close: () => {} }),
    speak: fakeSpeak(spoken),
    agent: (_session, actions) => ({ turn: async (text) => (turns.push(text), claude(actions, text)) }),
    findMoments: async () => [],
    warm: async () => false,
    translateQuote: async (quote) => quote,
  };
  const ws = new FakeSocket();
  const cooking = new Cooking(ws as unknown as WebSocket, "token", "recipe-1", "pcm", deps);
  void cooking.start();
  await waitFor("the offer", () => ws.of("say").some((s) => s.kind === "offer"));
  await waitFor("the offer's end", () => ws.of("say_end").length === 2);
  await advance(AUDIO_S * 1000 + 500);
  return {
    ws,
    spoken,
    turns,
    questions,
    cooking,
    says: (text: string) => stt!.onTurnEnd(text),
    raw: (data: string) => cooking.onMessage(Buffer.from(data), false),
  };
}

const HINT = { hint: "Most recipes use plain sugar.", question: "Can I use maple syrup?" };

test("a hint and the ask to the cook are one step: hint, asked_cook, then the ask line right as the hint ends", async () => {
  const p = await phone((a) => a.giveHint(HINT.hint, HINT.question));
  const from = p.ws.events.length;
  p.says("Can I use maple syrup instead of the rock sugar?");
  await waitFor("the ask line", () => p.ws.of("say").some((s) => s.text === "I'll ask Grandma too."));
  const evs = p.ws.events.slice(from).filter((e) => e.type !== "transcript");
  assert.deepEqual(
    evs.map((e) => (e.type === "say" ? `say ${e.kind}: ${e.text}` : e.type === "asked_cook" ? `asked_cook ${e.questionId}: ${e.text}` : e.type)),
    [
      "say hint: Grandma didn't say. Most recipes use plain sugar.",
      "say_end",
      "asked_cook q-1: Can I use maple syrup?",
      "say reply: I'll ask Grandma too.",
    ],
  );
  assert.deepEqual(p.turns, ["Can I use maple syrup instead of the rock sugar?"], "one turn: no second Claude call");
  assert.deepEqual(p.questions, ["Can I use maple syrup?"], "the question went to Convex once");
  await advance(AUDIO_S * 1000 + 2000);
  assert.equal(p.ws.of("say").filter((s) => s.text === "I'll ask Grandma too.").length, 1);
  p.cooking.close();
});

test("the ask line starts within half a second of the hint finishing on the phone", async () => {
  const p = await phone((a) => a.giveHint(HINT.hint, HINT.question));
  const t0 = Date.now();
  p.says("Can I use maple syrup?");
  await waitFor("the hint's audio", () => p.ws.of("say_end").length === 3);
  const hintEnds = t0 + 100 + AUDIO_S * 1000; // first audio 100 ms after the call, then AUDIO_S of it
  await waitFor("the ask line", () => p.ws.of("say").some((s) => s.text === "I'll ask Grandma too."));
  const gap = Date.now() - hintEnds;
  assert.ok(gap >= 0 && gap <= 500, `ask line ${gap} ms after the hint ended`);
  p.cooking.close();
});

test("a question write that fails during the hint is caught: nothing unhandled, the turn fails like ask_cook's, the next turn works", async () => {
  let fail = true;
  const p = await phone(
    (a, text) => (text === "Next step." ? a.goToStep(2) : a.giveHint(HINT.hint, HINT.question)),
    async () => {
      if (fail) throw new Error("convex /voice/question 500");
      return { status: "asked_cook", questionId: "q" };
    },
  );
  p.says("Can I use maple syrup?");
  await advance(AUDIO_S * 1000 * 3);
  assert.deepEqual(unhandled, [], "no unhandled rejection (it used to end the process)");
  assert.deepEqual(p.ws.of("error"), [{ type: "error", message: "turn failed" }]);
  assert.equal(p.ws.of("asked_cook").length, 0, "no asked_cook for a question that didn't reach the cook");
  assert.equal(p.ws.of("say").filter((s) => s.text === "I'll ask Grandma too.").length, 0);

  fail = false;
  p.says("Next step.");
  await advance(1000);
  assert.equal(p.ws.of("go_to_step").at(-1)?.stepOrder, 2);
  p.cooking.close();
});

test("junk from the app never throws, and only a string is a text turn", async () => {
  const p = await phone(async () => {});
  for (const junk of ["null", "5", '"text"', "[]", "{", '{"type":"text","text":5}', '{"type":"text","text":null}', '{"type":"text"}', '{"type":"moment","open":"yes"}']) {
    assert.doesNotThrow(() => p.raw(junk), junk);
  }
  await settle();
  assert.deepEqual(p.turns, []);
  p.raw('{"type":"text","text":"How much salt?"}');
  await advance(500);
  assert.deepEqual(p.turns, ["How much salt?"]);
  p.cooking.close();
});

test("a phone that hangs up mid-turn: the hint is never spoken, so no Sonic call", async () => {
  let release: () => void = () => {};
  const thinking = new Promise<void>((r) => (release = r));
  const p = await phone(async (a) => {
    await thinking; // Claude still thinking when the phone hangs up
    await a.giveHint(HINT.hint, HINT.question);
  });
  const spokenBefore = p.spoken.length;
  p.says("Can I use maple syrup?");
  await settle();
  p.cooking.close();
  release();
  await advance(AUDIO_S * 1000 * 2);
  assert.deepEqual(p.spoken.slice(spokenBefore), []);
  assert.deepEqual(unhandled, []);
});

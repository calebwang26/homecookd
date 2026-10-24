// The Claude turn agent (agent.ts) with a fake Claude: a question the video doesn't answer takes one call (the hint
// and the ask to the cook are one tool), and an action that fails still leaves a valid history for the next turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { Actions } from "../src/agent.js";
import type { CookSession } from "../src/convex.js";
import type { Hit } from "../src/moss.js";

// env.ts wants these at import. Nothing here calls a real service.
process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
const { TurnAgent } = await import("../src/agent.js");

const session: CookSession = {
  familyId: "fam-1",
  mossIndex: "family-fam-1",
  kid: { id: "kid-1", name: "Shreya" },
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
};

type Request = { messages: { role: string; content: { type: string; id?: string; tool_use_id?: string; text?: string; is_error?: boolean }[] }[] };
type ToolCall = { name: string; input: Record<string, unknown> };

/**
 * Claude, faked: answers each call with the next tool from `script` (null = no tool), and refuses a history the real
 * API refuses (400): a tool_use whose tool_result isn't in the next message.
 */
function fakeClaude(script: (ToolCall | null)[]) {
  const requests: Request[] = [];
  let n = 0;
  const create = async (params: Request) => {
    const msgs = structuredClone(params.messages);
    requests.push({ messages: msgs });
    msgs.forEach((m, i) => {
      for (const b of m.content) {
        if (m.role !== "assistant" || b.type !== "tool_use") continue;
        const answered = msgs[i + 1]?.content.some((r) => r.type === "tool_result" && r.tool_use_id === b.id);
        if (!answered) throw new Error(`400: tool_use ${b.id} has no tool_result after it`);
      }
    });
    const call = script[n++];
    const content = call ? [{ type: "tool_use", id: `toolu_${n}`, name: call.name, input: call.input }] : [{ type: "text", text: "" }];
    return { content, stop_reason: call ? "tool_use" : "end_turn" };
  };
  return { requests, client: { beta: { messages: { create } } } as unknown as Anthropic };
}

/** The session's side, recorded. `found`: what the Moss search returns. */
function fakeActions(found: Hit[] = [], fail: Partial<Record<keyof Actions, Error>> = {}) {
  const calls: [string, ...unknown[]][] = [];
  const act = (name: keyof Actions) => async (...args: unknown[]) => {
    calls.push([name, ...args]);
    if (fail[name]) throw fail[name];
  };
  const actions: Actions = {
    currentStep: () => 1,
    goToStep: act("goToStep"),
    findMoment: async (query) => (calls.push(["findMoment", query]), found),
    playClip: act("playClip"),
    askCook: act("askCook"),
    giveHint: act("giveHint"),
    setTimer: act("setTimer"),
    say: act("say"),
  };
  return { calls, actions };
}

const lastUserText = (r: Request) => r.messages.at(-1)!.content.find((b) => b.type === "text")!.text!;

test("a question no moment answers takes one Claude call: give_hint carries the question for the cook", async () => {
  const claude = fakeClaude([{ name: "give_hint", input: { hint: "Most cooks use plain sugar.", question: "Can I use maple syrup?" } }]);
  const { calls, actions } = fakeActions([]);
  const agent = new TurnAgent(session, actions, claude.client);
  await agent.turn("Can I use maple syrup instead of the rock sugar?");

  assert.equal(claude.requests.length, 1, "one model round trip");
  // The search ran before Claude, and Claude is told it found nothing, so it doesn't search again first.
  assert.deepEqual(calls[0], ["findMoment", "Can I use maple syrup instead of the rock sugar?"]);
  assert.match(lastUserText(claude.requests[0]), /Searching Grandma's video found nothing for this\./);
  assert.deepEqual(calls.slice(1), [["giveHint", "Most cooks use plain sugar.", "Can I use maple syrup?"]]);

  // The next turn opens with the hint's result: the question already went to the cook, with no ask_cook call.
  await agent.turn("Thanks!");
  const next = claude.requests[1].messages.at(-1)!.content;
  assert.equal(next[0].type, "tool_result");
  assert.equal(calls.filter(([name]) => name === "askCook").length, 0);
});

test("moments found up front are in the first message, so a clip that answers is one call too", async () => {
  const hit: Hit = { text: "Watch the color", quote: "Tea color, honey color, stop.", kind: "said", startS: 40, endS: 52, stepOrder: 2, score: 0.8 };
  const claude = fakeClaude([{ name: "play_clip", input: { start_s: 40, end_s: 52 } }]);
  const { calls, actions } = fakeActions([hit]);
  await new TurnAgent(session, actions, claude.client).turn("How dark should the sugar get?");
  assert.equal(claude.requests.length, 1);
  assert.match(lastUserText(claude.requests[0]), /Moments from Grandma's video that may match: .*"start_s":40/);
  assert.deepEqual(calls.at(-1), ["playClip", 40, 52, { question: { text: "How dark should the sugar get?", quote: hit.quote }, stepOrder: 2 }]);
});

test("an action that fails still gets its tool_result, so the next turn isn't refused", async () => {
  // Convex down while sending the question: ask_cook throws. Before, the history kept a tool_use with no result, and
  // Claude refused every later call of the session (homie answered "sorry" to everything until a reconnect).
  const claude = fakeClaude([{ name: "ask_cook", input: { question: "Can I skip the cumin?" } }, { name: "next_step", input: {} }]);
  const { calls, actions } = fakeActions([], { askCook: new Error("convex /voice/question 500") });
  const agent = new TurnAgent(session, actions, claude.client);
  await assert.rejects(agent.turn("Can I skip the cumin?"), /convex \/voice\/question 500/);

  await agent.turn("Next step.");
  assert.equal(claude.requests.length, 2);
  const opener = claude.requests[1].messages.at(-1)!.content[0];
  assert.equal(opener.type, "tool_result");
  assert.equal(opener.is_error, true);
  assert.deepEqual(calls.at(-1), ["goToStep", 2]);
});

test("a search still loading isn't 'nothing found': Claude may search, so the cook's own clip isn't lost", { timeout: 10_000 }, async () => {
  const clip: Hit = { text: "Always hot water, never cold.", quote: "Always hot water, never cold.", kind: "tip", startS: 40, endS: 55, stepOrder: 2, score: 0.9 };
  const claude = fakeClaude([{ name: "find_moment", input: { query: "hot or cold water" } }, { name: "play_clip", input: { start_s: 40, end_s: 55 } }]);
  const { calls, actions } = fakeActions();
  let searches = 0;
  // The up-front search runs out its whole wait empty (the index is still loading); find_moment then finds the clip.
  actions.findMoment = async (query, waitMs) => {
    calls.push(["findMoment", query]);
    if (searches++ === 0) return new Promise<Hit[]>((r) => setTimeout(() => r([]), waitMs));
    return [clip];
  };
  const agent = new TurnAgent(session, actions, claude.client);
  await agent.turn("Can I use cold water for the braise?");

  assert.match(lastUserText(claude.requests[0]), /didn't finish in time\. If this is about the dish, use find_moment/);
  assert.doesNotMatch(lastUserText(claude.requests[0]), /found nothing/);
  assert.ok(calls.some(([name]) => name === "playClip"), "her clip plays");
});

test('"homie" however Ink spells it counts as the kid talking to homie; look-alike words don\'t', async () => {
  const { saysHomie } = await import("../src/agent.js");
  for (const t of ["Homie, next step.", "hey homey how long?", "Holmy, set a timer", "ok homi", "Hommie what now", "Holmie?", "homie's right"]) {
    assert.equal(saysHomie(t), true, t);
  }
  for (const t of ["I'm going home.", "Did you do the homework?", "Sherlock Holmes", "Can you pass me the plate?", "hum"]) {
    assert.equal(saysHomie(t), false, t);
  }
});

test("every turn tells Claude whether the kid said homie's name; speech not for homie gets no tool and no words", async () => {
  const claude = fakeClaude([null, { name: "next_step", input: {} }]);
  const { calls, actions } = fakeActions([]);
  const agent = new TurnAgent(session, actions, claude.client);
  await agent.turn("Maya, can you grab me a plate from the cupboard?");
  assert.match(lastUserText(claude.requests[0]), /\[They didn't say your name: answer only if it's plainly for you\.\]/);
  assert.deepEqual(calls.filter(([name]) => name !== "findMoment"), [], "nothing said or done");
  await agent.turn("Homey, what's next?");
  assert.match(lastUserText(claude.requests[1]), /\[They said your name: this is for you\.\]/);
  assert.deepEqual(calls.at(-1), ["goToStep", 2]);
});

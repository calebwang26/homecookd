// homie's Claude-written lines with a fake Claude: when one guesses a family role or a gender (family.ts
// guessesFamily), the hello falls back to the written one, a question to the written question of its kind
// (lines.ts scriptedOf), and a tap line to Convex's plain line. An end question that opens by counting ("One more
// thing:") goes the same way as a guess. Nothing here calls a real service.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { Heard, Who } from "../src/homie.js";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
const { HomieAgent, countsItself } = await import("../src/homie.js");
const { scriptedOf } = await import("../src/lines.js");
const { tapLine } = await import("../src/tapLine.js");

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  mock.method(console, "log", () => {});
  mock.method(console, "warn", (...args: unknown[]) => void warnings.push(args.join(" ")));
});
afterEach(() => mock.restoreAll());

type Sent = { system: string; text: string };

/** Claude, faked: each call answers with the next reply as JSON, and keeps what it was sent. */
function fakeClaude(replies: object[]) {
  const sent: Sent[] = [];
  const create = async (params: { system: string; messages: { content: string | { type: string; text?: string }[] }[] }) => {
    const c = params.messages[0].content;
    sent.push({ system: params.system, text: typeof c === "string" ? c : c.map((b) => b.text ?? "").join("") });
    const reply = replies.shift();
    if (!reply) throw new Error("no more replies");
    return { content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
  };
  return { sent, client: { beta: { messages: { create } } } as unknown as Anthropic };
}

const dad: Who = { language: "en", call: "Dad", dish: "Dal Tadka" };
const ask = (kind: string, en: string) => ({ action: "ask", kind, text: en, text_en: en, story_in_progress: false });
const moment = (heard: Heard[], nowS: number, asked: string[] = []) => ({ heard, asked, nowS, mayAsk: true, mayReact: true });

test("a hello that guesses a family role is dropped, so the written one plays", async () => {
  const { client } = fakeClaude([{ text: "Hi, Dad. Your son Shreya can't wait.", text_en: "Hi, Dad. Your son Shreya can't wait." }]);
  assert.equal(await new HomieAgent({ ...dad, kid: "Shreya" }, { client }).intro(), null);
  assert.match(warnings.join("\n"), /dropped a hello/);
});

test("a hello that names the dish passes, even when the dish holds a family word", async () => {
  const hello = "Hi, Vijay. You're making Dad's Sunday Chili for your family today.";
  const { client } = fakeClaude([{ text: hello, text_en: hello }]);
  const line = await new HomieAgent({ language: "en", call: "Vijay", dish: "Dad's Sunday Chili" }, { client }).intro();
  assert.equal(line?.textEn, hello);
});

test("after setWho (names in the cook's script), the check still knows the Latin names", async () => {
  const latin: Who = { language: "mr", call: "Rajani Aaji", kid: "Shreya", dish: "Grandma's Red-Braised Pork Belly" };
  const native: Who = { ...latin, call: "रजनी आजी", kid: "श्रेया" };
  const en = "Hi, Rajani Aaji. Grandma's Red-Braised Pork Belly for Shreya today. How lovely.";
  const { client, sent } = fakeClaude([{ text: "नमस्कार, रजनी आजी!", text_en: en }]);
  const agent = new HomieAgent(latin, { client });
  agent.setWho(native);
  assert.deepEqual(await agent.intro(), { text: "नमस्कार, रजनी आजी!", textEn: en });
  assert.match(sent[0].system, /address the cook as "रजनी आजी"/, "the prompt speaks the cook's script");
});

test("a question that guesses a family role becomes the written question of its kind, then the next one", async () => {
  const { client, sent } = fakeClaude([ask("amount", "Dad, how much salt will your son need?"), ask("amount", "Dad, how much for your daughter?")]);
  const agent = new HomieAgent(dad, { client, fallback: scriptedOf });
  const heard = [{ atS: 30, text: "Just a little salt." }];
  const first = await agent.decide(moment(heard, 60));
  assert.deepEqual(first, { action: "ask", kind: "amount", line: { text: "Dad, what did you just add, and about how much?", textEn: "Dad, what did you just add, and about how much?" } });
  // record.ts adds what was asked; the dropped line is in "Already asked" too, so Claude doesn't offer it again.
  const second = await agent.decide(moment(heard, 90, ["Dad, what did you just add, and about how much?"]));
  assert.equal(second.action === "ask" && second.line.textEn, "Dad, in that last step, how much did you use?");
  assert.match(sent[1].text, /- Dad, how much salt will your son need\?/);
});

test("a dropped show question (no written one) goes quiet and isn't offered again", async () => {
  const { client, sent } = fakeClaude([ask("show", "Hold it up so your grandson can see?"), { action: "quiet", kind: "none", text: "", text_en: "", story_in_progress: false }]);
  const agent = new HomieAgent(dad, { client, fallback: scriptedOf });
  const input = { ...moment([], 60), frame: Buffer.from("jpeg") };
  assert.deepEqual(await agent.decide(input), { action: "quiet", storyInProgress: false });
  await agent.decide(input);
  assert.match(sent[1].text, /Already asked:\n- Hold it up so your grandson can see\?/);
});

test("mid-filming, a pronoun alone doesn't drop a question", async () => {
  const { client } = fakeClaude([ask("story", "Dad, did she teach you this one?")]);
  const d = await new HomieAgent(dad, { client, fallback: scriptedOf }).decide(moment([{ atS: 50, text: "My mother made this." }], 60));
  assert.equal(d.action === "ask" && d.line.textEn, "Dad, did she teach you this one?");
});

test("a role the cook said counts only for a few minutes", async () => {
  const q = ask("story", "Dad, does your son like it spicy?");
  const said = (atS: number) => [{ atS, text: "My son loves this one." }];
  const recent = await new HomieAgent(dad, { client: fakeClaude([q]).client, fallback: scriptedOf }).decide(moment(said(380), 400));
  assert.equal(recent.action === "ask" && recent.line.textEn, "Dad, does your son like it spicy?");
  const old = await new HomieAgent(dad, { client: fakeClaude([q]).client, fallback: scriptedOf }).decide(moment(said(10), 400));
  assert.equal(old.action === "ask" && old.line.textEn, "Dad, is there a story behind this dish? Who taught you?");
});

test("a reaction is dropped only for a guess about the kid", async () => {
  const react = (en: string) => ({ action: "react", kind: "none", text: en, text_en: en, story_in_progress: false });
  const guess = await new HomieAgent(dad, { client: fakeClaude([react("Your grandson will love that.")]).client }).decide(moment([], 60));
  assert.deepEqual(guess, { action: "quiet", storyInProgress: false });
  const story = await new HomieAgent(dad, { client: fakeClaude([react("Oh, your grandmother taught you?")]).client }).decide(moment([], 60));
  assert.equal(story.action, "react");
});

test("end questions that all guess a role become the written ones of their kinds", async () => {
  const { client } = fakeClaude([
    {
      questions: [
        { kind: "cue", text: "Dad, how will your son know it's done?", text_en: "Dad, how will your son know it's done?" },
        { kind: "story", text: "Dad, did your mom teach you? Was she a good cook?", text_en: "Dad, did your mom teach you? Was she a good cook?" },
      ],
    },
  ]);
  const qs = await new HomieAgent(dad, { client, fallback: scriptedOf }).endQuestions([{ atS: 300, text: "And that's it." }], [], 2);
  assert.deepEqual(
    qs.map((q) => [q.kind, q.line.textEn]),
    [
      ["cue", "Dad, how do you know this part is ready?"],
      ["story", "Dad, is there a story behind this dish? Who taught you?"],
    ],
  );
});

test("an end question that opens by counting ('One more thing:') becomes the written one of its kind", async () => {
  for (const opening of ["One more thing: ", "Dad, one last question: ", "Another quick one, ", "And finally, ", "Last one: ", "Just one more: "]) {
    assert.ok(countsItself(`${opening}how much ghee was that?`), opening);
  }
  for (const fine of ["Dad, how much ghee went in last?", "Last time you made this, what changed?", "In the last step, how much salt was that?", "Dad, is there another way to know it's done?"]) {
    assert.ok(!countsItself(fine), fine);
  }
  const en = "Dad, one more thing: how do you know the tadka is ready?";
  const { client } = fakeClaude([{ questions: [{ kind: "cue", text: en, text_en: en }] }]);
  const qs = await new HomieAgent(dad, { client, fallback: scriptedOf }).endQuestions([], [], 2);
  assert.deepEqual(qs.map((q) => [q.kind, q.line.textEn]), [["cue", "Dad, how do you know this part is ready?"]]);
  assert.match(warnings.join("\n"), /says where it falls/);
});

test("an end question that's fine stays as Claude wrote it", async () => {
  const en = "Dad, how much ghee was that?";
  const { client } = fakeClaude([{ questions: [{ kind: "amount", text: en, text_en: en }] }]);
  const qs = await new HomieAgent(dad, { client, fallback: scriptedOf }).endQuestions([], [], 2);
  assert.deepEqual(qs, [{ kind: "amount", line: { text: en, textEn: en } }]);
});

/** Claude for tapLine (messages.create, plain text), faked. */
const tapClaude = (text: string) => ({ messages: { create: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn" }) } }) as unknown as Pick<Anthropic, "messages">;

test("a tap line that adds a role or a he/she falls back to Convex's plain line", async () => {
  const fact = { id: "cooking:test-1", kind: "cooking" as const, line: "Shreya is cooking your Varan Bhaat right now.", at: 0 };
  const who = { name: "Ramesh", role: "cook" as const };
  assert.deepEqual(await tapLine(who, fact, "home", tapClaude("Shreya is cooking your Varan Bhaat! She must miss home.")), { text: fact.line, written: false });
  assert.deepEqual(await tapLine(who, { ...fact, id: "cooking:test-2" }, "home", tapClaude("Your grandson is cooking your Varan Bhaat!")), { text: fact.line, written: false });
  const fine = "Ramesh, Shreya is cooking your Varan Bhaat right now!";
  assert.deepEqual(await tapLine(who, { ...fact, id: "cooking:test-3" }, "home", tapClaude(fine)), { text: fine, written: true });
});

// While a video plays on the kid's phone, homie stays quiet (Caleb, Oct 24): cook.ts holds every line it would
// say on its own (the greeting, a nudge, a timer) until the app says the video stopped, and still answers what
// the kid just said. Also: the read-aloud offer is off by default (no VOICE_READ_OFFER here).
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { Actions } from "../src/agent.js";
import type { CookSession } from "../src/convex.js";
import type { CookingDeps } from "../src/cook.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, fakeSpeak, waitFor } from "./helpers.js";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
delete process.env.VOICE_READ_OFFER;
const { Cooking } = await import("../src/cook.js");

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") }));
afterEach(() => mock.timers.reset());

let kids = 0;
const session = (kidId: string): CookSession => ({
  familyId: "fam-1",
  mossIndex: "family-fam-1",
  kid: { id: kidId, name: "Shreya" },
  cook: { name: "Grandma", language: "mr", relation: "Aaji" },
  recipe: {
    id: "recipe-1",
    title: "Varan Bhaat",
    steps: [
      { order: 1, title: "Wash the rice", text: "Wash the rice three times.", moment: { startS: 0, endS: 30 } },
      { order: 2, title: "Temper", text: "Heat the ghee and add the cumin.", moment: { startS: 30, endS: 90 } },
    ],
    memories: [{ kind: "story", text: "My mother made this every Sunday.", moment: { startS: 40, endS: 70 }, stepOrder: 2 }],
  },
  stepOrder: 1,
});

function phone(claude?: (a: Actions) => Promise<void>) {
  const spoken: string[] = [];
  const addressed: boolean[] = []; // each Claude turn: said in the app's "ask" moment?
  let stt: SttEvents | undefined;
  const deps: CookingDeps = {
    convex: {
      startSession: async () => session(`video-kid-${++kids}`),
      setStep: async () => {},
      logQuestion: async () => ({ status: "asked_cook", questionId: "q-1" }),
    },
    listen: (events) => ((stt = events), { send: () => {}, close: () => {} }),
    speak: fakeSpeak(spoken),
    agent: (_session, actions) => ({ turn: async (_text, _note, tapped = false) => void (addressed.push(tapped), await claude?.(actions)) }),
    findMoments: async () => [],
    warm: async () => false,
    translateQuote: async (quote) => quote,
  };
  const ws = new FakeSocket();
  const cooking = new Cooking(ws as unknown as WebSocket, "token", "recipe-1", "pcm", deps);
  void cooking.start();
  const send = (msg: object) => cooking.onMessage(Buffer.from(JSON.stringify(msg)), false);
  return {
    ws,
    spoken,
    addressed,
    says: (text: string) => stt!.onTurnEnd(text),
    video: (playing: boolean) => send({ type: "video", playing }),
    send,
    kinds: () => ws.of("say").map((s) => s.kind),
    close: () => cooking.close(),
  };
}

test("no read-aloud offer by default: the hello only, and steps change silently", async () => {
  const p = phone();
  await waitFor("the greeting", () => p.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 5000);
  assert.deepEqual(p.kinds(), ["greeting"]);
  p.says("Next step.");
  await waitFor("step 2", () => p.ws.of("go_to_step").some((s) => s.stepOrder === 2));
  await advance(1000);
  assert.deepEqual(p.kinds(), ["greeting"], "not read aloud");
  // Asking for it reads it, and every step after.
  p.says("Say that again.");
  await waitFor("the step read", () => p.kinds().includes("step"));
  p.close();
});

test("a video playing at the start: the hello waits for it to stop", async () => {
  const p = phone();
  p.video(true);
  await advance(20_000);
  assert.equal(p.ws.of("say").length, 0, "nothing said over the video");
  p.video(false);
  await waitFor("the greeting", () => p.ws.of("say").length === 1);
  assert.deepEqual(p.kinds(), ["greeting"]);
  p.close();
});

test("a timer that ends mid-video: timer_done at once, its line once the video stops; an answer is spoken meanwhile", async () => {
  const p = phone((a) => a.say("You're doing great."));
  await waitFor("the greeting's end", () => p.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 500);
  p.says("Set a timer for 10 seconds.");
  await waitFor("the timer", () => p.ws.of("timer").length === 1);
  await advance(AUDIO_S * 1000 + 500);
  p.video(true);
  await advance(12_000);
  assert.equal(p.ws.of("timer_done").length, 1, "the phone still buzzes");
  assert.ok(!p.kinds().includes("timer"), "homie doesn't say it over the video");
  // The kid talks to homie mid-video (typed): that's an answer, said now.
  p.send({ type: "text", text: "How am I doing?" });
  await waitFor("the answer", () => p.ws.of("say").some((s) => s.text === "You're doing great."));
  assert.ok(!p.kinds().includes("timer"));
  await advance(30_000);
  assert.ok(!p.kinds().includes("timer"), "still waiting for the video");
  p.video(false);
  await waitFor("the timer line", () => p.kinds().includes("timer"));
  assert.equal(p.ws.of("say").at(-1)?.text, "Hey, your timer is done.");
  p.close();
});

test("two lines held by a video come one after the other, each whole", async () => {
  const p = phone();
  await waitFor("the greeting's end", () => p.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 500);
  p.says("Set a timer for 5 seconds.");
  p.says("Set a timer for 6 seconds for the rice.");
  await waitFor("both timers", () => p.ws.of("timer").length === 2);
  p.video(true);
  await advance(20_000);
  const before = p.ws.of("say").length;
  p.video(false);
  await waitFor("both timer lines", () => p.kinds().filter((k) => k === "timer").length === 2, 30_000);
  const ends = p.ws.of("say_end").slice(-2);
  assert.deepEqual(ends.map((e) => e.interrupted), [false, false], "neither cut the other off");
  assert.equal(p.ws.of("say").length, before + 2);
  p.close();
});

test("the story nudge after a read step waits for the kid's video", async () => {
  const p = phone();
  await waitFor("the greeting's end", () => p.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 500);
  p.says("Say that again."); // reading on
  await waitFor("step 1 read", () => p.kinds().includes("step"));
  await advance(AUDIO_S * 1000 + 500);
  p.says("Next step.");
  await waitFor("step 2 read", () => p.kinds().filter((k) => k === "step").length === 2);
  p.video(true); // the kid taps play while step 2 is being read
  await advance(AUDIO_S * 1000 + 30_000);
  assert.ok(!p.kinds().includes("nudge"), "no story offer over the video");
  p.video(false);
  await waitFor("the story offer", () => p.kinds().includes("nudge"));
  assert.equal(p.ws.of("say").at(-1)?.text, "Grandma has a story about this one. Want to hear it?");
  p.close();
});

test("a turn Claude leaves alone (not for homie) sends quiet, so the phone stops thinking; a turn that answers doesn't", async () => {
  let answer = false;
  const p = phone(async (a) => {
    if (answer) await a.say("Two more minutes.");
  });
  await waitFor("the greeting's end", () => p.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 500);
  p.says("Maya, can you grab me a plate from the cupboard?");
  await waitFor("quiet", () => p.ws.of("quiet").length === 1);
  assert.deepEqual(p.kinds(), ["greeting"], "nothing said");
  answer = true;
  p.says("Homie, how long does it simmer?");
  await waitFor("the answer", () => p.kinds().includes("reply"));
  await advance(1000);
  assert.equal(p.ws.of("quiet").length, 1);
  p.close();
});

test("words said after the kid tapped homie to ask (the app's ask moment) are for homie, whatever they are", async () => {
  const p = phone();
  await waitFor("the greeting's end", () => p.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 500);
  p.says("How much salt goes in?");
  p.send({ type: "moment", open: true, kind: "ask" });
  p.says("Is it okay if it browns a bit?");
  p.send({ type: "moment", open: false });
  p.says("Is it okay if it smokes?");
  await waitFor("three turns", () => p.addressed.length === 3);
  assert.deepEqual(p.addressed, [false, true, false]);
  p.close();
});

test("no quiet nudge while a video plays", async () => {
  const p = phone();
  await waitFor("the greeting's end", () => p.ws.of("say_end").length === 1);
  p.says("Say that again."); // reading on: the quiet nudge can come
  await waitFor("step 1 read", () => p.kinds().includes("step"));
  await advance(AUDIO_S * 1000 + 500);
  p.video(true);
  await advance(7 * 60_000, 1000);
  assert.ok(!p.kinds().includes("nudge"), "watching isn't quiet");
  p.close();
});

// The kid's cooking session (cook.ts) with a fake socket, speech-to-text, voice, Claude and Convex, on a fake
// clock: the read-aloud offer and its yes or no (offer_closed), and the app's own homie moments, which keep
// the kid's yes or no for themselves.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { CookSession } from "../src/convex.js";
import type { CookingDeps } from "../src/cook.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, fakeSpeak, settle, waitFor, type Ev } from "./helpers.js";

// env.ts wants these at import. Nothing here calls a real service.
process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
const { Cooking } = await import("../src/cook.js");

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") }));
afterEach(() => mock.timers.reset());

const OFFER = "Want me to read Grandma's recipe out loud? Say yes or no.";
let kids = 0;

/** Grandma's three-step recipe, with a story on step 2, for one kid. */
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
      { order: 3, title: "Simmer", text: "Simmer it for ten minutes.", moment: { startS: 90, endS: 200 } },
    ],
    memories: [{ kind: "story", text: "My mother made this every Sunday.", moment: { startS: 40, endS: 70 }, stepOrder: 2 }],
  },
  stepOrder: 1,
});

/** One kid's phone and backend. Every connect is the same kid (a reconnect), unless a new world is made. */
function world() {
  const kidId = `kid-${++kids}`;
  const spoken: string[] = [];
  const turns: string[] = []; // what reached Claude
  let stt: SttEvents | undefined;
  const deps: CookingDeps = {
    convex: {
      startSession: async () => session(kidId),
      setStep: async () => {},
      logQuestion: async (_token, _recipe, _step, text, found) => ({ status: found ? "found_in_video" : "asked_cook", questionId: `q-${text}` }),
    },
    listen: (events) => {
      stt = events;
      return { send: () => {}, close: () => {} };
    },
    speak: fakeSpeak(spoken),
    agent: () => ({ turn: async (text) => void turns.push(text) }),
    findMoments: async () => [],
    warm: async () => false,
    translateQuote: async (quote) => quote,
  };

  function connect() {
    const ws = new FakeSocket();
    const cooking = new Cooking(ws as unknown as WebSocket, "token", "recipe-1", "pcm", deps);
    void cooking.start();
    return {
      ws,
      send: (msg: object) => cooking.onMessage(Buffer.from(JSON.stringify(msg)), false),
      close: () => cooking.close(),
      /** Everything sent from here on. */
      mark: () => {
        const from = ws.events.length;
        return () => ws.events.slice(from);
      },
    };
  }
  /** The kid says something (Ink's turn ends with it). */
  const says = (text: string) => stt!.onTurnEnd(text);
  return { spoken, turns, connect, says };
}

type Phone = ReturnType<ReturnType<typeof world>["connect"]>;
const types = (evs: Ev[]) => evs.map((e) => e.type);

/** Waits for the greeting and the offer, and for the phone to finish playing the offer. */
async function offered(c: Phone) {
  await waitFor("the offer", () => c.ws.of("say").some((s) => s.kind === "offer"));
  await waitFor("the offer's end", () => c.ws.of("say_end").length === 2);
  await advance(AUDIO_S * 1000 + 500);
  assert.deepEqual(c.ws.of("say").map((s) => [s.kind, s.text]), [
    ["greeting", "चला, स्वयंपाक करूया!"],
    ["offer", OFFER],
  ]);
}

test("a spoken no declines the offer: steps change silently, plain commands still work", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  let since = c.mark();
  w.says("No thanks.");
  await settle();
  assert.deepEqual(since(), [
    { type: "transcript", text: "No thanks.", final: true },
    { type: "offer_closed", accepted: false },
  ]);

  // Next: shown, not read (step 2 has a story, and no nudge comes either).
  since = c.mark();
  w.says("Next step.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.deepEqual(since().filter((e) => e.type !== "transcript"), [{ type: "go_to_step", stepOrder: 2 }]);

  // "Say that again" still reads the step they're on, once; reading stays off.
  since = c.mark();
  w.says("Say that again.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.deepEqual(since().filter((e) => e.type === "say").map((s) => [s.kind, s.text]), [["step", "Step 2. Heat the ghee and add the cumin."]]);
  since = c.mark();
  w.says("Next.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.deepEqual(types(since()), ["transcript", "go_to_step"]);

  // A timer still works, and none of it needed Claude.
  w.says("Set a timer for 5 minutes for the rice.");
  await waitFor("the timer", () => c.ws.of("timer").length === 1);
  assert.equal(c.ws.of("timer")[0].label, "rice");
  assert.deepEqual(w.turns, []);
  assert.equal(c.ws.of("offer_closed").length, 1);
  c.close();
});

test("the app's own text no declines it too, and a reconnect doesn't greet or offer again", async () => {
  const w = world();
  const a = w.connect();
  await offered(a);
  a.send({ type: "text", text: "no" });
  await settle();
  assert.deepEqual(a.ws.of("offer_closed"), [{ type: "offer_closed", accepted: false }]);
  a.close();

  const b = w.connect();
  await advance(30_000);
  assert.deepEqual(types(b.ws.events), ["ready", "go_to_step"]);
  w.says("Next step.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.equal(b.ws.of("say").length, 0, "still silent");
  assert.equal(b.ws.of("go_to_step").at(-1)?.stepOrder, 2);
  b.close();
});

test("yes: offer_closed, then the step they're on is read; a no to a story closes it quietly", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  const since = c.mark();
  w.says("Yes please.");
  await waitFor("the step", () => c.ws.of("say").length === 3);
  assert.deepEqual(since().slice(0, 4), [
    { type: "transcript", text: "Yes please.", final: true },
    { type: "offer_closed", accepted: true },
    { type: "go_to_step", stepOrder: 1 },
    { type: "say", text: "Step 1. Wash the rice three times.", kind: "step", ai: true, audio: { format: "pcm", encoding: "pcm_s16le", sampleRate: 24000 } },
  ]);

  // Reading is on: the next step is read, then the story nudge. "Not now" closes it without a word or Claude.
  w.says("Next.");
  await waitFor("the story nudge", () => c.ws.of("say").some((s) => s.kind === "nudge"));
  assert.equal(c.ws.of("say").at(-1)?.text, "Grandma has a story about this one. Want to hear it?");
  await advance(AUDIO_S * 1000 + 500);
  const says = c.ws.of("say").length;
  w.says("Not now.");
  await advance(5000);
  assert.equal(c.ws.of("say").length, says);
  assert.equal(c.ws.of("play_clip").length, 0);
  assert.deepEqual(w.turns, []);
  assert.equal(c.ws.of("offer_closed").length, 1, "offer_closed is only for the read-aloud offer");
  c.close();
});

test("say that again before answering turns reading on, and closes the offer as accepted", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  w.says("Say that again.");
  await waitFor("the step", () => c.ws.of("say").length === 3);
  assert.deepEqual(c.ws.of("offer_closed"), [{ type: "offer_closed", accepted: true }]);
  assert.equal(c.ws.of("say").at(-1)?.kind, "step");
  c.close();
});

test("while an app moment is up, a yes or no is the moment's: transcripts still come, the offer stays open", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  c.send({ type: "moment", open: true, kind: "answer" });
  let since = c.mark();
  w.says("Yes.");
  w.says("No thanks.");
  w.says("Okay sure.");
  await advance(5000);
  assert.deepEqual(since(), [
    { type: "transcript", text: "Yes.", final: true },
    { type: "transcript", text: "No thanks.", final: true },
    { type: "transcript", text: "Okay sure.", final: true },
  ]);

  // A question while it's up still goes the usual way, and isn't taken as a yes to our offer.
  w.says("Okay, how much salt do I add?");
  await advance(1000);
  assert.deepEqual(w.turns, ["Okay, how much salt do I add?"]);
  assert.equal(c.ws.of("offer_closed").length, 0);

  // Once it closes, the kid's yes is ours again.
  c.send({ type: "moment", open: false });
  since = c.mark();
  w.says("Yes.");
  await waitFor("the step", () => c.ws.of("say").some((s) => s.kind === "step"));
  assert.deepEqual(types(since()).slice(0, 4), ["transcript", "offer_closed", "go_to_step", "say"]);
  assert.equal(c.ws.of("offer_closed")[0].accepted, true);
  c.close();
});

test("with a moment up, the app's own text answer still counts", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  c.send({ type: "moment", open: true, kind: "help" });
  c.send({ type: "text", text: "yes" });
  await waitFor("the step", () => c.ws.of("say").some((s) => s.kind === "step"));
  assert.deepEqual(c.ws.of("offer_closed"), [{ type: "offer_closed", accepted: true }]);
  c.close();
});

test("homie never offers over an app moment: the offer and the story nudge wait for it to close", async () => {
  const w = world();
  const c = w.connect();
  await waitFor("the greeting", () => c.ws.of("say").length === 1);
  c.send({ type: "moment", open: true, kind: "answer" });
  await advance(60_000, 500);
  assert.deepEqual(c.ws.of("say").map((s) => s.kind), ["greeting"]);
  c.send({ type: "moment", open: false });
  await offered(c);

  w.says("Yes.");
  await waitFor("step 1", () => c.ws.of("say").length === 3);
  await advance(AUDIO_S * 1000 + 500);
  c.send({ type: "moment", open: true, kind: "ask" });
  w.says("Next."); // a plain command still works with a moment up
  await waitFor("step 2", () => c.ws.of("say").length === 4);
  await advance(60_000, 500);
  assert.deepEqual(c.ws.of("say").map((s) => s.kind), ["greeting", "offer", "step", "step"]);
  c.send({ type: "moment", open: false });
  await waitFor("the story nudge", () => c.ws.of("say").length === 5);
  assert.equal(c.ws.of("say").at(-1)?.kind, "nudge");
  c.close();
});

test("the long-quiet nudge waits while an app moment is up", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  w.says("Yes.");
  await waitFor("step 1", () => c.ws.of("say").length === 3);
  c.send({ type: "moment", open: true, kind: "answer" });
  await advance(8 * 60_000, 1000);
  assert.deepEqual(c.ws.of("say").map((s) => s.kind), ["greeting", "offer", "step"]);
  c.send({ type: "moment", open: false });
  await waitFor("the quiet nudge", () => c.ws.of("say").length === 4);
  assert.equal(c.ws.of("say").at(-1)?.text, 'Still on step 1? Say "next" when you\'re ready.');
  c.close();
});

test("every everyday no declines the offer with offer_closed, and a later okay doesn't turn reading on", async () => {
  const nos = ["No, not right now.", "Nah, I'm good.", "No, I don't want that.", "Don't.", "Not now, thanks.", "Oh, no thanks.", "Oh no, not now.", "Yeah, no."];
  for (const no of nos) {
    const w = world();
    const c = w.connect();
    await offered(c);
    const since = c.mark();
    w.says(no);
    await settle();
    assert.deepEqual(since(), [
      { type: "transcript", text: no, final: true },
      { type: "offer_closed", accepted: false },
    ], no);
    assert.deepEqual(w.turns, [], no);

    w.says("Okay.");
    w.says("Next step.");
    await advance(AUDIO_S * 1000 + 2000);
    assert.deepEqual(c.ws.of("offer_closed"), [{ type: "offer_closed", accepted: false }], no);
    assert.equal(c.ws.of("say").filter((s) => s.kind === "step").length, 0, `${no}: steps stay silent`);
    c.close();
  }
});

test("with a moment up, everyday yes and no answers are the moment's, and never reach Claude", async () => {
  const w = world();
  const c = w.connect();
  await offered(c);
  c.send({ type: "moment", open: true, kind: "answer" });
  const replies = [
    "Sure, read it.", "Yeah, go ahead.", "Yes, play it.", "Yes, I want to hear it.", "Please do.", "Okay, let's do it.", "Okay cool.",
    "Don't.", "No, not right now.", "Nah, I'm good.", "Oh, no thanks.",
  ];
  const since = c.mark();
  for (const reply of replies) w.says(reply);
  await advance(5000);
  assert.deepEqual(since(), replies.map((text) => ({ type: "transcript", text, final: true })));
  assert.deepEqual(w.turns, []);

  // A command or question isn't an answer: it still goes the usual way with the moment up.
  w.says("Okay, what's the next step?");
  w.says("Not really sure how much salt.");
  await advance(1000);
  assert.deepEqual(w.turns, ["Okay, what's the next step?", "Not really sure how much salt."]);

  // A command after a no still runs, without Claude.
  w.says("No, next step.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.equal(c.ws.of("go_to_step").at(-1)?.stepOrder, 2);
  assert.equal(w.turns.length, 2);

  // Once it closes, a no is ours again: the offer is declined.
  c.send({ type: "moment", open: false });
  w.says("Nah, I'm good.");
  await settle();
  assert.deepEqual(c.ws.of("offer_closed"), [{ type: "offer_closed", accepted: false }]);
  c.close();
});

test("okay or please with more words says yes to the offer, and a no with a command declines it and still runs it", async () => {
  for (const yes of ["Please do.", "Okay, let's do it.", "Okay, I want to hear it."]) {
    const w = world();
    const c = w.connect();
    await offered(c);
    w.says(yes);
    await waitFor(`${yes}: the step`, () => c.ws.of("say").length === 3);
    assert.deepEqual(c.ws.of("offer_closed"), [{ type: "offer_closed", accepted: true }], yes);
    assert.equal(c.ws.of("say").at(-1)?.kind, "step", yes);
    assert.deepEqual(w.turns, [], yes);
    c.close();
  }

  const w = world();
  const c = w.connect();
  await offered(c);
  const since = c.mark();
  w.says("No, next step.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.deepEqual(since(), [
    { type: "transcript", text: "No, next step.", final: true },
    { type: "offer_closed", accepted: false },
    { type: "go_to_step", stepOrder: 2 },
  ]);
  assert.deepEqual(w.turns, []);
  c.close();
});

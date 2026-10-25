// What keeps Ink's meter running only when it has to: the server's half of half duplex (cook.ts `hearing`) and the
// Ink stream's idle close, lazy reopen, queue cap and reconnect backoff (ink.ts). Fakes only, on a fake clock.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { CookSession } from "../src/convex.js";
import type { CookingDeps } from "../src/cook.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, fakeSpeak, waitFor } from "./helpers.js";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
const { Cooking } = await import("../src/cook.js");
const { InkStream, IDLE_CLOSE_MS } = await import("../src/ink.js");

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") }));
afterEach(() => mock.timers.reset());

const FRAME = Buffer.alloc(3200); // 100 ms of 16 kHz s16le

let kids = 0;
/** A new kid each time: homie greets a kid once per recipe (a reconnect gets no second hello). */
const session = (): CookSession => ({
  familyId: "fam-1",
  mossIndex: "family-fam-1",
  kid: { id: `kid-credits-${++kids}`, name: "Shreya" },
  cook: { name: "Grandma", language: "en" },
  recipe: {
    id: "recipe-1",
    title: "Varan Bhaat",
    steps: [{ order: 1, title: "Wash the rice", text: "Wash the rice three times.", moment: { startS: 0, endS: 30 } }],
    memories: [],
  },
  stepOrder: 1,
});

/** A cooking session whose Ink only counts the frames it gets. */
function cooking() {
  let stt: SttEvents | undefined;
  let frames = 0;
  const kid = session();
  const deps: CookingDeps = {
    convex: { startSession: async () => kid, setStep: async () => {}, logQuestion: async () => ({ status: "asked_cook", questionId: "q" }) },
    listen: (events) => ((stt = events), { send: () => void frames++, close: () => {} }),
    speak: fakeSpeak([]),
    agent: () => ({ turn: async () => {} }),
    findMoments: async () => [],
    warm: async () => false,
    translateQuote: async (quote) => quote,
  };
  const ws = new FakeSocket();
  const c = new Cooking(ws as unknown as WebSocket, "token", "recipe-1", "pcm", deps);
  void c.start();
  const mic = () => c.onMessage(FRAME, true);
  const text = (t: string) => c.onMessage(Buffer.from(JSON.stringify({ type: "text", text: t })), false);
  return { ws, mic, text, frames: () => frames, stt: () => stt!, close: () => c.close() };
}

test("half duplex, server side: no frames reach Ink while homie's line plays, then they do", async () => {
  const k = cooking();
  await waitFor("the greeting", () => k.ws.of("say").length === 1);
  for (let i = 0; i < 10; i++) k.mic();
  assert.equal(k.frames(), 0, "the greeting is playing: the mic only hears homie");
  await waitFor("the greeting's end", () => k.ws.of("say_end").length === 1);
  await advance(AUDIO_S * 1000 + 100); // the phone finishes playing it
  k.mic();
  assert.equal(k.frames(), 1, "nothing playing: the frame goes to Ink");
  // A step line sent all at once from the cache plays just as long on the phone.
  k.text("repeat");
  await waitFor("the step's line", () => k.ws.of("say_end").length === 2);
  k.mic();
  assert.equal(k.frames(), 1, "the step's line is playing");
  await advance(AUDIO_S * 1000 + 100);
  for (let i = 0; i < 5; i++) k.mic();
  assert.equal(k.frames(), 6, "nothing playing: every frame goes to Ink");
  k.close();
});

test("half duplex never cuts a turn: once the kid started talking, frames flow until Ink ends the turn", async () => {
  const k = cooking();
  await waitFor("the greeting", () => k.ws.of("say").length === 1);
  k.stt().onTurnStart(); // the kid talks over the greeting
  for (let i = 0; i < 4; i++) k.mic();
  assert.equal(k.frames(), 4, "mid-turn: Ink needs the audio to end the turn");
  k.stt().onTurnEnd("next step");
  k.mic();
  assert.equal(k.frames(), 4, "the turn is over and homie is still speaking: dropped again");
  k.close();
});

test("a turn whose end never came stops holding the mic open after 30 s", async () => {
  const k = cooking();
  await waitFor("the greeting", () => k.ws.of("say").length === 1);
  k.stt().onTurnStart();
  k.mic();
  assert.equal(k.frames(), 1);
  await advance(31_000); // no turn.end ever came
  k.text("repeat"); // homie says step 1's line
  await waitFor("step 1 read aloud", () => k.ws.of("say").some((x) => x.kind === "step"));
  k.mic();
  assert.equal(k.frames(), 1, "the stale turn no longer holds half duplex open");
  k.close();
});

/** A WebSocket stand-in: CONNECTING until open(), counts what's sent. */
class FakeInkSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: Buffer[] = [];
  open() {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }
  send(b: Buffer) {
    this.sent.push(b);
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

function ink() {
  const sockets: FakeInkSocket[] = [];
  const events: SttEvents = { onTurnStart() {}, onPartial() {}, onTurnEnd() {}, onError() {} };
  const s = new InkStream(events, [], () => {
    const f = new FakeInkSocket();
    sockets.push(f);
    return f as unknown as WebSocket;
  });
  return { s, sockets, last: () => sockets.at(-1)! };
}

test("ink: no audio for the idle limit closes the stream, and the next frame opens a new one", async () => {
  const { s, sockets, last } = ink();
  last().open();
  s.send(FRAME);
  await advance(IDLE_CLOSE_MS + 31_000, 1000);
  assert.equal(last().readyState, WebSocket.CLOSED, "idle: closed so it stops billing");
  await advance(60_000, 1000);
  assert.equal(sockets.length, 1, "an idle close isn't reopened on its own");
  s.send(FRAME);
  assert.equal(sockets.length, 2, "the next frame opens a fresh stream");
  last().open();
  assert.equal(last().sent.length, 1, "and that frame isn't lost");
  s.close();
});

test("ink: steady audio keeps the stream open", async () => {
  const { s, last } = ink();
  last().open();
  for (let t = 0; t < IDLE_CLOSE_MS * 2; t += 10_000) {
    s.send(FRAME);
    await advance(10_000, 1000);
  }
  assert.equal(last().readyState, WebSocket.OPEN);
  s.close();
});

test("ink: while connecting, only the last 2 s of audio is kept", () => {
  const { s, last } = ink();
  for (let i = 0; i < 100; i++) s.send(FRAME); // 10 s while the socket is still connecting
  last().open();
  assert.equal(last().sent.length, 20, "2 s of 100 ms frames");
  s.close();
});

test("ink: an unexpected drop reopens with backoff, and a good open resets it", async () => {
  const { s, sockets, last } = ink();
  last().open();
  last().close(); // Ink drops us
  await advance(249, 1);
  assert.equal(sockets.length, 1);
  await advance(2, 1);
  assert.equal(sockets.length, 2, "first retry after 250 ms");
  last().close(); // fails again before opening
  await advance(499, 1);
  assert.equal(sockets.length, 2);
  await advance(2, 1);
  assert.equal(sockets.length, 3, "then 500 ms");
  last().open();
  last().close();
  await advance(251, 1);
  assert.equal(sockets.length, 4, "a successful open resets the wait to 250 ms");
  s.close();
  await advance(20_000, 100);
  assert.equal(sockets.length, 4, "closed by us: never reopened");
});

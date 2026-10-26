// Cartesia key rotation (cartesiaKeys.ts): out of credits moves every caller to the next key; nothing else does.
// HTTP (Sonic's withCartesiaKey) and both STT sockets (Ink 2, Ink Whisper). Fakes only.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { SttEvents } from "../src/stt.js";

process.env.CARTESIA_API_KEY = "key-1";
process.env.CARTESIA_API_KEYS_BACKUP = "key-2, key-3";
process.env.ANTHROPIC_API_KEY = "test";
const { cartesiaKey, withCartesiaKey, resetCartesiaKeys } = await import("../src/cartesiaKeys.js");
const { InkStream } = await import("../src/ink.js");
const { InkWhisperStream } = await import("../src/inkWhisper.js");

beforeEach(() => {
  resetCartesiaKeys();
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") });
});
afterEach(() => mock.timers.reset());

const outOfCredits = () =>
  Response.json({ error_code: "quota_exceeded", title: "Out of credits", message: "Model credits limit reached." }, { status: 402 });

test("http: a key out of credits moves to the next one, and later calls start there", async () => {
  const used: string[] = [];
  const res = await withCartesiaKey(async (key) => (used.push(key), key === "key-1" ? outOfCredits() : new Response("audio")));
  assert.equal(res.status, 200);
  assert.deepEqual(used, ["key-1", "key-2"]);
  assert.equal(cartesiaKey(), "key-2");
  await withCartesiaKey(async (key) => (used.push(key), new Response("audio")));
  assert.deepEqual(used, ["key-1", "key-2", "key-2"], "no retry of the empty key");
});

test("http: other errors (even another 402) never switch keys", async () => {
  const used: string[] = [];
  const upgrade = () => Response.json({ error_code: "plan_upgrade_required", message: "Upgrade your plan" }, { status: 402 });
  for (const make of [upgrade, () => new Response("bad", { status: 400 }), () => new Response("down", { status: 500 })]) {
    const res = await withCartesiaKey(async (key) => (used.push(key), make()));
    assert.notEqual(res.status, 200);
  }
  assert.deepEqual(used, ["key-1", "key-1", "key-1"]);
});

test("http: when every key is out of credits, the last 402 comes back", async () => {
  const used: string[] = [];
  const res = await withCartesiaKey(async (key) => (used.push(key), outOfCredits()));
  assert.equal(res.status, 402);
  assert.deepEqual(used, ["key-1", "key-2", "key-3"]);
});

/** A WebSocket stand-in that records the key it was opened with. */
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  constructor(readonly key: string) {
    super();
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }
  send() {}
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
  /** What `ws` does when the handshake is refused: an error, then close. */
  refuse(status: number) {
    this.emit("error", new Error(`Unexpected server response: ${status}`));
    this.close();
  }
}

const quiet: SttEvents = { onTurnStart() {}, onPartial() {}, onTurnEnd() {}, onError() {} };

for (const [name, make] of [
  ["ink-2", (connect: (url: string, h: Record<string, string>) => WebSocket) => new InkStream(quiet, [], connect)],
  ["ink-whisper", (connect: (url: string, h: Record<string, string>) => WebSocket) => new InkWhisperStream("en", quiet, connect)],
] as const) {
  const sockets = () => {
    const all: FakeSocket[] = [];
    const connect = (_url: string, headers: Record<string, string>) => {
      const s = new FakeSocket(headers["X-API-Key"]);
      all.push(s);
      return s as unknown as WebSocket;
    };
    return { all, connect };
  };

  test(`${name}: a handshake refused for credits (402) reopens at once with the next key`, async () => {
    const { all, connect } = sockets();
    const stream = make(connect);
    assert.equal(all[0].key, "key-1");
    all[0].refuse(402);
    await (await import("./helpers.js")).advance(300, 50);
    assert.equal(all.length, 2);
    assert.equal(all[1].key, "key-2");
    stream.close();
  });

  test(`${name}: an out-of-credits error mid-session closes and reopens with the next key`, async () => {
    const { all, connect } = sockets();
    const stream = make(connect);
    all[0].open();
    all[0].emit("message", Buffer.from(JSON.stringify({ type: "error", status_code: 402, error_code: "quota_exceeded", message: "Model credits limit reached." })), false);
    await (await import("./helpers.js")).advance(300, 50);
    assert.equal(all[0].readyState, WebSocket.CLOSED);
    assert.equal(all.at(-1)!.key, "key-2");
    stream.close();
  });

  test(`${name}: any other drop reopens with the same key`, async () => {
    const { all, connect } = sockets();
    const stream = make(connect);
    all[0].refuse(500);
    await (await import("./helpers.js")).advance(300, 50);
    assert.equal(all.at(-1)!.key, "key-1");
    stream.close();
  });
}

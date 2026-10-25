// The cache of homie's step lines (lineCache.ts), on a fake clock: a line is made once however many ask, a line
// still being made plays what's there and then the rest, a failed one isn't kept, and the oldest go past the limits.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { FAILED_MS, LineCache, lineKey, MAKE_MAX_MS, type Line, type Make } from "../src/lineCache.js";
import { advance, settle } from "./helpers.js";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 }));
afterEach(() => mock.timers.reset());

/** Moves the fake clock until the line is done or failed (and the cache has tidied up). */
async function made(line: Line) {
  for (let i = 0; i < 100 && line.state === "making"; i++) await advance(100);
  await settle();
}

/** A Sonic stand-in: `n` chunks of `size` bytes, one every 100 ms. Counts its calls. */
function maker(n = 3, size = 1000) {
  let calls = 0;
  const make: Make = (onChunk, signal) =>
    new Promise((resolve, reject) => {
      calls++;
      let i = 0;
      const tick = () => {
        if (signal.aborted) return reject(new Error("aborted"));
        onChunk(Buffer.alloc(size, i));
        if (++i < n) setTimeout(tick, 100);
        else resolve();
      };
      setTimeout(tick, 100);
    });
  return { make, calls: () => calls };
}

test("made once: a second ask gets the kept line, all of it at once", async () => {
  const cache = new LineCache();
  const m = maker();
  await made(cache.get("a", m.make));
  const got: number[] = [];
  const bytes = await cache.get("a", m.make).play(new AbortController().signal, (c) => got.push(c.length));
  assert.equal(m.calls(), 1);
  assert.deepEqual(got, [1000, 1000, 1000], "the same chunks, in order");
  assert.equal(bytes, 3000);
});

test("a line still being made: what's there at once, then each new piece; never made twice", async () => {
  const cache = new LineCache();
  const m = maker();
  cache.get("a", m.make);
  await advance(150); // one chunk made
  const got: number[] = [];
  const playing = cache.get("a", m.make).play(new AbortController().signal, () => got.push(Date.now()));
  assert.deepEqual(got, [150], "the first chunk at once");
  await advance(200);
  assert.equal(await playing, 3000);
  assert.deepEqual(got, [150, 200, 300], "the rest as it came");
  assert.equal(m.calls(), 1);
});

test("an abort stops the playing, not the making", async () => {
  const cache = new LineCache();
  const m = maker();
  const line = cache.get("a", m.make);
  const ctrl = new AbortController();
  const playing = line.play(ctrl.signal, () => {});
  await advance(150);
  ctrl.abort();
  assert.equal(await playing, 1000);
  await advance(300);
  assert.equal(line.state, "done");
  assert.equal(cache.size, 1);
});

test("a line that fails, or makes no audio, isn't kept; asked again within FAILED_MS it fails at once, then it's made again", async () => {
  const cache = new LineCache();
  const failing: Make = async () => {
    throw new Error("network: socket hang up");
  };
  const line = cache.get("a", failing);
  await line.ready;
  await settle();
  assert.equal(line.state, "failed");
  assert.equal(line.error?.message, "network: socket hang up");
  assert.equal(await line.play(new AbortController().signal, () => {}), 0, "nothing to play");
  assert.equal(cache.size, 0);
  const empty = cache.get("b", async () => {});
  await empty.ready;
  assert.equal(empty.state, "failed");
  const m = maker();
  const again = cache.get("a", m.make);
  assert.equal(again.state, "failed", "remembered: fails at once");
  assert.equal(again.error?.message, "network: socket hang up");
  assert.equal(m.calls(), 0, "and isn't made");
  await made(cache.get("c", m.make));
  assert.equal(m.calls(), 1, "other lines are made as usual (not a 402 or 429)");
  await advance(FAILED_MS, 1000);
  await made(cache.get("a", m.make));
  assert.equal(m.calls(), 2, "a minute on, it's made again");
  assert.equal(cache.size, 2);
});

test("Sonic out of credits or rate-limited (402, 429): every new line fails at once for FAILED_MS", async () => {
  for (const status of ["402: insufficient credits", "429: too many requests"]) {
    const cache = new LineCache();
    const kept = maker(1);
    await made(cache.get("kept", kept.make));
    await cache.get("a", async () => Promise.reject(new Error(status))).ready;
    await settle();
    assert.ok(cache.sonicBusy, status);
    const m = maker();
    const b = cache.get("b", m.make);
    assert.equal(b.state, "failed", status);
    assert.equal(b.error?.message, status);
    assert.equal(m.calls(), 0, `${status}: Sonic isn't asked`);
    assert.equal(cache.get("kept", kept.make).state, "done", "a kept line still plays");
    await advance(FAILED_MS, 1000);
    assert.ok(!cache.sonicBusy);
    await made(cache.get("b", m.make));
    assert.equal(m.calls(), 1, `${status}: asked again a minute on`);
  }
});

test("a line that stalls is given up after MAKE_MAX_MS, so nobody waits on it forever", async () => {
  const cache = new LineCache();
  const stalls: Make = (_onChunk, signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const line = cache.get("a", stalls);
  const playing = line.play(new AbortController().signal, () => {});
  await advance(MAKE_MAX_MS + 100, 1000);
  assert.equal(await playing, 0);
  assert.equal(line.state, "failed");
  assert.equal(line.error?.message, `not made in ${MAKE_MAX_MS / 1000} s`);
  assert.equal(cache.size, 0);
});

test("a make that ignores the abort still ends at MAKE_MAX_MS, keeping nothing it sends later", async () => {
  const cache = new LineCache();
  let send: (audio: Buffer) => void = () => {};
  const deaf: Make = (onChunk) => ((send = onChunk), new Promise<void>(() => {})); // never settles, never stops
  const line = cache.get("a", deaf);
  send(Buffer.alloc(1000));
  const got: number[] = [];
  const playing = line.play(new AbortController().signal, (c) => got.push(c.length));
  await advance(MAKE_MAX_MS + 100, 1000);
  assert.equal(await playing, 1000, "the reader got what was there, then the end");
  assert.equal(line.state, "failed");
  assert.equal(cache.size, 0, "not kept: it was cut short");
  send(Buffer.alloc(1000));
  assert.equal(line.bytes, 1000, "a late piece is ignored");
  assert.deepEqual(got, [1000]);
});

test("one reader that throws stops only itself: the others get every piece", async () => {
  const cache = new LineCache();
  const warn = mock.method(console, "warn", () => {});
  const line = cache.get("a", maker().make);
  const good: number[] = [];
  const bad = line.play(new AbortController().signal, () => {
    throw new Error("socket gone");
  });
  const fine = line.play(new AbortController().signal, (c) => good.push(c.length));
  await made(line);
  assert.equal(await bad, 0, "it stopped (the piece that threw isn't counted as sent)");
  assert.equal(await fine, 3000);
  assert.deepEqual(good, [1000, 1000, 1000]);
  assert.equal(line.state, "done");
  assert.ok(warn.mock.calls.length >= 1);
  warn.mock.restore();
});

test("making ahead: at most aheadAtOnce lines at a time across the process; a kept line doesn't wait", async () => {
  const cache = new LineCache(300, 64 * 2 ** 20, 2);
  let making = 0;
  let most = 0;
  const counted: Make = (onChunk, signal) => {
    most = Math.max(most, ++making);
    return maker(1).make(onChunk, signal).finally(() => making--);
  };
  await made(cache.get("kept", counted));
  making = most = 0;
  // Two sessions asking for five lines between them, all at once.
  const all = ["a", "b", "c", "d", "e"].map((k) => cache.ahead(k, counted));
  const kept = cache.ahead("kept", counted);
  await settle();
  assert.equal((await kept).state, "done", "kept: no turn to wait for");
  await advance(1000);
  const lines = await Promise.all(all);
  assert.deepEqual(lines.map((l) => l.state), ["done", "done", "done", "done", "done"]);
  assert.equal(most, 2);
});

test("past the line or byte limit, the least recently used lines go first", async () => {
  const cache = new LineCache(2, 10_000);
  for (const k of ["a", "b"]) await made(cache.get(k, maker(1).make));
  cache.get("a", maker(1).make); // a used again: b is now the oldest
  await made(cache.get("c", maker(1).make));
  const kept = (k: string) => {
    const m = maker(1);
    cache.get(k, m.make);
    return m.calls() === 0;
  };
  assert.equal(cache.size, 2);
  assert.ok(kept("a") && kept("c"), "a and c kept");

  const bytes = new LineCache(10, 2500);
  for (const k of ["x", "y", "z"]) await made(bytes.get(k, maker(1, 1000).make));
  assert.equal(bytes.size, 2, "three lines of 1000 bytes don't fit in 2500");
  assert.equal(bytes.bytes, 2000);
});

test("the key tells apart the voice, its language and kind (the mood), the format and the words", () => {
  const voice = { voice: "riya", language: undefined, kind: "step" };
  const keys = new Set([
    lineKey("Step 1. Wash the rice.", "pcm", voice),
    lineKey("Step 1. Wash the rice.", "wav", voice),
    lineKey("Step 1. Wash the rice.", "pcm", { ...voice, voice: "other" }),
    lineKey("Step 1. Wash the rice.", "pcm", { ...voice, language: "mr" }),
    lineKey("Step 1. Wash the rice.", "pcm", { ...voice, kind: "reply" }),
    lineKey("Step 2. Wash the rice.", "pcm", voice),
  ]);
  assert.equal(keys.size, 6);
  assert.equal(lineKey("x", "pcm", voice), lineKey("x", "pcm", { voice: "riya", kind: "step", language: "en" }), "no language is English");
});

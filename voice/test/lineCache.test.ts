// The cache of homie's step lines (lineCache.ts), on a fake clock: a line is made once however many ask, a line
// still being made plays what's there and then the rest, a failed one isn't kept, and the oldest go past the limits.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { LineCache, lineKey, MAKE_MAX_MS, type Line, type Make } from "../src/lineCache.js";
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

test("a line that fails, or makes no audio, isn't kept: the next ask makes it again", async () => {
  const cache = new LineCache();
  const failing: Make = async () => {
    throw new Error("402");
  };
  const line = cache.get("a", failing);
  await line.ready;
  await settle();
  assert.equal(line.state, "failed");
  assert.equal(line.error?.message, "402");
  assert.equal(await line.play(new AbortController().signal, () => {}), 0, "nothing to play");
  assert.equal(cache.size, 0);
  const empty = cache.get("b", async () => {});
  await empty.ready;
  assert.equal(empty.state, "failed");
  const m = maker();
  await made(cache.get("a", m.make));
  assert.equal(m.calls(), 1);
});

test("a line that stalls is given up after MAKE_MAX_MS, so nobody waits on it forever", async () => {
  const cache = new LineCache();
  const stalls: Make = (_onChunk, signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const line = cache.get("a", stalls);
  const playing = line.play(new AbortController().signal, () => {});
  await advance(MAKE_MAX_MS + 100, 1000);
  assert.equal(await playing, 0);
  assert.equal(line.state, "failed");
  assert.equal(cache.size, 0);
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

// silentClip on clip sizes measured in real Chrome (Nov 11). Run: cd web && npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOOR_BYTES_PER_S, silentClip } from './silentClip.ts';

const HEADER_ONLY = 110; // a webm with no audio in it: what a live track that delivers nothing leaves, at any length
const THINNEST = 3532; // bytes in 1 s: the thinnest real clip with sound (AAC from Chrome's fake mic)

test('a clip that decodes keeps what decoding showed, whatever its size', () => {
  assert.equal(silentClip(false, HEADER_ONLY, 5), false, 'decoded and heard: sent, even if tiny');
  assert.equal(silentClip(true, 5_000_000, 60), true, 'decoded and silent: never sent, even if large');
});

test("a header-only clip the browser can't decode is quiet, at the shortest answer and the longest", () => {
  assert.equal(silentClip(null, HEADER_ONLY, 0.8), true);
  assert.equal(silentClip(null, HEADER_ONLY, 120), true);
});

test("an undecodable clip with sound in it is heard: the thinnest real one, and one just over the floor", () => {
  assert.equal(silentClip(null, THINNEST, 1), false);
  assert.equal(silentClip(null, THINNEST * 0.8, 0.8), false);
  assert.equal(silentClip(null, Math.ceil(FLOOR_BYTES_PER_S * 4) + 4, 4), false, 'just over 250 B/s');
  assert.equal(silentClip(null, Math.floor(FLOOR_BYTES_PER_S * 4) - 4, 4), true, 'just under 250 B/s');
});

test('the floor is the measured 250 bytes a second, far under any clip with sound', () => {
  assert.equal(FLOOR_BYTES_PER_S, 250);
  assert.ok(THINNEST / FLOOR_BYTES_PER_S >= 14);
  assert.ok(HEADER_ONLY / 0.8 < FLOOR_BYTES_PER_S, 'a header-only clip at the shortest answer (MIN_S 0.8 s) is under it');
});

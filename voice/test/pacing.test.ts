// When homie may ask (pacing.ts): the first question, the gaps, doubling after ignored ones, the limit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO, NORMAL, Pacer } from "../src/pacing.js";

test("the first question comes no earlier than firstS", () => {
  const p = new Pacer(NORMAL);
  assert.equal(p.mayAsk(0), false);
  assert.equal(p.mayAsk(239), false);
  assert.equal(p.mayAsk(240), true);
  assert.equal(new Pacer(DEMO).mayAsk(40), true);
});

test("after a question, the next waits a full gap", () => {
  const p = new Pacer(NORMAL);
  p.onAsk(300);
  assert.equal(p.mayAsk(300 + 269), false);
  assert.equal(p.mayAsk(300 + 270), true);
});

test("each ignored question doubles the gap, up to 8x; an answer resets it", () => {
  const p = new Pacer({ firstS: 0, gapS: 10, maxLive: 99, maxEnd: 2 });
  p.onAsk(0);
  p.ignored();
  assert.equal(p.mayAsk(19), false);
  assert.equal(p.mayAsk(20), true);
  p.onAsk(20);
  p.ignored();
  assert.equal(p.mayAsk(59), false);
  assert.equal(p.mayAsk(60), true);
  p.onAsk(60);
  p.ignored();
  p.ignored(); // a fourth would be 16x; it stays at 8x
  assert.equal(p.mayAsk(139), false);
  assert.equal(p.mayAsk(140), true);
  p.answered();
  p.onAsk(140);
  assert.equal(p.mayAsk(149), false);
  assert.equal(p.mayAsk(150), true);
});

test("never more than maxLive live questions", () => {
  const p = new Pacer(DEMO);
  p.onAsk(40);
  p.onAsk(130);
  assert.equal(p.mayAsk(10_000), false);
});

test("SCRIPTED: every 5 minutes, and an ignored question doesn't push the next one back", async () => {
  const { SCRIPTED } = await import("../src/pacing.js");
  const p = new Pacer(SCRIPTED);
  assert.equal(p.mayAsk(299), false);
  assert.equal(p.mayAsk(300), true);
  p.onAsk(300);
  p.ignored();
  assert.equal(p.mayAsk(599), false);
  assert.equal(p.mayAsk(600), true);
});

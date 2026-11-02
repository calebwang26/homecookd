// Turning work away when overloaded (src/overload.ts). No database: a request turned away never reaches one, and /health never needs one.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { bounds, BUSY_WINDOW_MS, busyMeter, isBusy, lagMeter, Overloaded, shedder, TICK_MS } from "../src/overload.js";

const blockFor = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until);
};

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  return run().finally(() => {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
}

test("off unless OVERLOAD_SHED=on; on, its bounds come from the environment or fall back", () => {
  assert.equal(bounds({}), null);
  assert.equal(bounds({ OVERLOAD_SHED: "1" }), null);
  assert.deepEqual(bounds({ OVERLOAD_SHED: "on" }), { maxBusy: 0.98, maxLagMs: 500, maxPoolWaiting: 50 });
  assert.deepEqual(bounds({ OVERLOAD_SHED: "on", OVERLOAD_MAX_BUSY: "0.9", OVERLOAD_MAX_LAG_MS: "250", OVERLOAD_MAX_POOL_WAITING: "20" }), { maxBusy: 0.9, maxLagMs: 250, maxPoolWaiting: 20 });
  assert.deepEqual(bounds({ OVERLOAD_SHED: "on", OVERLOAD_MAX_BUSY: "2", OVERLOAD_MAX_LAG_MS: "-1", OVERLOAD_MAX_POOL_WAITING: "lots" }), { maxBusy: 0.98, maxLagMs: 500, maxPoolWaiting: 50 });
});

test("the lag counts a timer that hasn't had its turn yet", () => {
  let now = 1_000;
  const meter = lagMeter(() => now);
  try {
    assert.equal(meter.lagMs(), 0);
    now += TICK_MS + 700; // the loop has been busy, and the timer hasn't run
    assert.equal(meter.lagMs(), 700);
  } finally {
    meter.stop();
  }
});

test("the busy share is the event loop's utilization over the last whole window", () => {
  const meter = busyMeter((from) => (from ? { idle: 20, active: 980, utilization: 0.98 } : { idle: 0, active: 0, utilization: 0 }));
  try {
    assert.equal(meter.busy(), 0, "no window has ended yet");
  } finally {
    meter.stop();
  }
  assert.equal(BUSY_WINDOW_MS, 1_000);
});

test("over any bound a request is turned away; under all, and for /health and /ready, it goes on", async () => {
  const check = (busy: number, lag: number, waiting: number, url = "/v1/messages") =>
    shedder({ maxBusy: 0.98, maxLagMs: 500, maxPoolWaiting: 50 }, () => busy, () => lag, () => waiting)({ routeOptions: { url } });
  await check(0.9, 100, 10);
  await assert.rejects(check(0.99, 100, 10), (e: Overloaded) => e instanceof Overloaded && e.reason === "busy");
  await assert.rejects(check(0.9, 600, 10), (e: Overloaded) => e instanceof Overloaded && e.reason === "lag");
  await assert.rejects(check(0.9, 100, 51), (e: Overloaded) => e instanceof Overloaded && e.reason === "pool");
  await check(1, 5_000, 500, "/health");
  await check(1, 5_000, 500, "/ready");
  assert.ok(isBusy(new Overloaded("lag")));
  assert.ok(!isBusy(new Error("anything else")));
});

test("on, a blocked event loop turns requests away fast with the busy 503 and retry-after, in the one shape on every route, and logs what the alarm counts", async () => {
  await withEnv({ OVERLOAD_SHED: "on", OVERLOAD_MAX_LAG_MS: "100" }, async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, done) { lines.push(chunk.toString()); done(); } });
    const app = buildApp({ logger: { stream } });
    try {
      await app.ready();
      blockFor(400);
      const started = Date.now();
      const dish = await app.inject({ method: "POST", url: "/dish/cards/get", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ kidToken: "x".repeat(22) }) });
      assert.equal(dish.statusCode, 503);
      assert.ok(Number(dish.headers["retry-after"]) > 0);
      assert.equal(dish.json().error, "unavailable");
      assert.ok(Date.now() - started < 1_000, "fast, not after a wait");

      blockFor(400);
      const other = await app.inject({ url: "/v1/anything" });
      assert.equal(other.statusCode, 503);
      assert.equal(other.json().error, "unavailable");

      blockFor(400);
      assert.equal((await app.inject("/health")).statusCode, 200, "the load balancer's check is never turned away");
      const busy = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === "too busy to answer");
      assert.ok(busy.length >= 2 && busy.every((l) => l.shed === "lag"), JSON.stringify(busy));
    } finally {
      await app.close();
    }
  });
});

test("off, today's behavior: a blocked loop delays a request and doesn't turn it away", async () => {
  await withEnv({ OVERLOAD_SHED: undefined }, async () => {
    const app = buildApp({ logger: false });
    try {
      await app.ready();
      blockFor(400);
      assert.equal((await app.inject({ url: "/v1/anything" })).statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

// The load balancer's check on its own thread (src/health.ts). No database: the check never needs one.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { buildApp } from "../src/app.js";
import { startHealthResponder } from "../src/health.js";

const blockFor = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until);
};

type Probe = { status: number; at: number };

/**
 * Asks for /health from another thread, `afterMs` after that thread is ready, so the question is asked while this thread is blocked. `answer` resolves
 * once this thread is free again, with the status and when the answer came.
 */
async function probeLater(port: number, afterMs: number): Promise<{ answer: Promise<Probe> }> {
  const worker = new Worker(
    `const { parentPort, workerData } = require("node:worker_threads");
     parentPort.postMessage("ready");
     setTimeout(async () => {
       const res = await fetch("http://127.0.0.1:" + workerData.port + "/health", { signal: AbortSignal.timeout(10000) });
       parentPort.postMessage({ status: res.status, at: Date.now() });
     }, workerData.afterMs);`,
    { eval: true, workerData: { port, afterMs } },
  );
  const answer = new Promise<Probe>((resolve, reject) => {
    worker.on("message", (m) => m !== "ready" && resolve(m));
    worker.once("error", reject);
  }).finally(() => worker.terminate());
  await new Promise((resolve) => worker.once("message", resolve));
  return { answer };
}

test("it answers 200 from its own thread while the main loop is blocked, where the main port's /health can't answer until the loop is free", async () => {
  const health = await startHealthResponder({ port: 0, host: "127.0.0.1" });
  const app = buildApp({ logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const own = await probeLater(health.port, 300);
    const main = await probeLater((app.server.address() as AddressInfo).port, 300);
    const started = Date.now();
    blockFor(2_000); // as a saturated task's loop is busy
    const freed = Date.now();
    const [o, m] = await Promise.all([own.answer, main.answer]);
    assert.equal(o.status, 200);
    assert.ok(o.at < freed, `the thread answered ${o.at - started} ms into a 2,000 ms block`);
    assert.equal(m.status, 200);
    assert.ok(m.at >= freed, "the main port's /health waits for the loop: what got a busy task replaced on Nov 2");
  } finally {
    await app.close();
    await health.stop();
  }
});

test("it goes 503 once the main loop hasn't turned for longer than the stale limit, and back to 200 once it does", async () => {
  const health = await startHealthResponder({ port: 0, host: "127.0.0.1", staleMs: 500, beatMs: 50 });
  try {
    const stuck = await probeLater(health.port, 1_200);
    blockFor(2_000); // a hung loop: no beat for 2 s
    assert.equal((await stuck.answer).status, 503);
    await sleep(200);
    const back = await fetch(`http://127.0.0.1:${health.port}/health`);
    assert.equal(back.status, 200);
    assert.equal(await back.text(), "ok");
  } finally {
    await health.stop();
  }
});

test("it beats only while the api says it's alive: a server that stopped listening goes 503 too", async () => {
  let listening = true;
  const health = await startHealthResponder({ port: 0, host: "127.0.0.1", staleMs: 300, beatMs: 50, alive: () => listening });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${health.port}/health`)).status, 200);
    listening = false;
    await sleep(600);
    const res = await fetch(`http://127.0.0.1:${health.port}/health`);
    assert.equal(res.status, 503);
    assert.equal(await res.text(), "stuck");
  } finally {
    await health.stop();
  }
});

test("it answers only GET and HEAD of /health, and a taken port fails its start", async () => {
  const health = await startHealthResponder({ port: 0, host: "127.0.0.1" });
  try {
    const base = `http://127.0.0.1:${health.port}`;
    assert.equal((await fetch(`${base}/health?from=alb`)).status, 200);
    assert.equal((await fetch(`${base}/health`, { method: "HEAD" })).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 404);
    assert.equal((await fetch(`${base}/health`, { method: "POST" })).status, 404);
    await assert.rejects(startHealthResponder({ port: health.port, host: "127.0.0.1" }), /EADDRINUSE/);
  } finally {
    await health.stop();
  }
});

test("the image's HEALTH_PORT is the port the load balancer checks on staging and production", () => {
  const root = join(import.meta.dirname, "..", "..");
  const image = /^ENV HEALTH_PORT=(\d+)$/m.exec(readFileSync(join(import.meta.dirname, "..", "Dockerfile"), "utf8"));
  assert.ok(image, "the Dockerfile sets HEALTH_PORT");
  for (const env of ["staging", "production"]) {
    const file = join(root, "infra", "envs", env, "main.tf");
    if (!existsSync(file)) continue;
    const api = /\n    api = \{([\s\S]*?)\n    \}/.exec(readFileSync(file, "utf8"));
    assert.equal(/health_port\s*=\s*(\d+)/.exec(api?.[1] ?? "")?.[1], image[1], `${env}'s api health_port`);
  }
});

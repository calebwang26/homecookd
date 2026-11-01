// The consumer of the `scheduled` queue, its repeats and failures, the sweep, the budget under concurrency.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { recordSpend } from "../src/modules/dish/budget.js";
import { claimMerge } from "../src/modules/dish/merge.js";
import { newSpend } from "../src/modules/dish/model.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { DAILY_BUDGET_USD, dayOf } from "../src/modules/dish/values.js";
import { handleMessage, type Received, startConsumer } from "../src/scheduled.js";
import {
  advance,
  answer,
  answersOf,
  askedCard,
  close,
  fileId,
  finish,
  hasDatabase,
  MIN,
  model,
  newBackend,
  rowOf,
  seedSpend,
  silent,
  spent,
  store,
} from "./dishHelpers.js";

const skip = !hasDatabase;
const trace = { log: silent };

/** A queue in memory: what SQS does, without SQS. */
function fakeQueue(messages: Received[]) {
  const removed: string[] = [];
  return {
    removed,
    receiver: {
      async receive(max: number, signal: AbortSignal) {
        if (messages.length === 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
            signal.addEventListener("abort", resolve);
          });
          return [];
        }
        return messages.splice(0, max);
      },
      async remove(id: string) {
        removed.push(id);
      },
    },
  };
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(ok(), "timed out");
};

test("the consumer deletes a message only after its task worked, and a failure doesn't stop the loop", async () => {
  const q = fakeQueue([
    { id: "good", body: "good" },
    { id: "bad", body: "bad" },
    { id: "good-2", body: "good-2" },
  ]);
  const seen: string[] = [];
  const consumer = startConsumer(q.receiver, silent, {
    handle: async (body) => {
      seen.push(body);
      if (body === "bad") throw new Error("boom");
    },
  });
  await until(() => q.removed.length === 2).finally(() => consumer.stop());
  assert.deepEqual(seen.sort(), ["bad", "good", "good-2"]);
  assert.deepEqual(q.removed.sort(), ["good", "good-2"]);
});

test("the consumer never runs more than a few at once, and stop waits for what's running", async () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({ id: String(i), body: String(i) }));
  const q = fakeQueue(messages);
  let running = 0;
  let most = 0;
  let done = 0;
  const consumer = startConsumer(q.receiver, silent, {
    handle: async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      done += 1;
    },
  });
  await until(() => done === 12).finally(() => consumer.stop());
  assert.ok(most <= 5, String(most));
  assert.equal(running, 0);
});

test("a failed read of the queue is waited out, and the loop goes on", async () => {
  let reads = 0;
  const removed: string[] = [];
  const consumer = startConsumer(
    {
      async receive() {
        reads += 1;
        if (reads === 1) throw new Error("SQS is down");
        if (reads === 2) return [{ id: "a", body: "a" }];
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      },
      async remove(id) {
        removed.push(id);
      },
    },
    silent,
    { handle: async () => {}, errorWaitMs: 1 },
  );
  await until(() => removed.length === 1).finally(() => consumer.stop());
});

test("a message with no known task throws, so it stays on the queue and reaches the dead-letter queue", async () => {
  await assert.rejects(handleMessage(JSON.stringify({ payload: { task: "nope" } }), silent));
  await assert.rejects(handleMessage("not json", silent));
  await assert.rejects(handleMessage(JSON.stringify({ payload: { task: "dish.merge" } }), silent), /askId/);
});

test("the real loop, end to end: a Send's work leaves through the outbox and lands as her version", { skip }, async () => {
  const t = await newBackend();
  const { sendDue } = await import("../src/outbox.js");
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  // The outbox's sender puts messages on a queue; the consumer takes them off.
  const queue: Received[] = [];
  await sendDue(db(), async (_queue, body) => void queue.push({ id: String(queue.length), body }));
  assert.equal(queue.length, 2); // hear, merge
  // SQS delivers one of them twice.
  queue.push({ ...queue[1], id: "again" });
  const q = fakeQueue(queue);
  const consumer = startConsumer(q.receiver, silent);
  await until(() => q.removed.length === 3).finally(() => consumer.stop());
  assert.ok((await rowOf(kidToken)).version);
  assert.equal(model.calls.version, 1);
  // Hear and the merge can both reach a clip with no words yet and both pay for it, as on Convex. Her version still comes once.
  assert.ok(model.calls.transcribe >= 1);
});

test("hearing a clip twice pays once; a clip since replaced keeps no words", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const [first] = await answersOf((await rowOf(kidToken)).id);
  const message = JSON.stringify({ payload: { task: "dish.hear", answerId: first.id, audioKey: first.audio_key } });
  await handleMessage(message, silent);
  await handleMessage(message, silent);
  assert.equal(model.calls.transcribe, 1);
  await answer(t, askToken, "q1"); // she records again
  await handleMessage(message, silent); // the old message arrives late
  const [now] = await answersOf((await rowOf(kidToken)).id);
  assert.equal(now.words, null);
});

test("the budget's alert: twenty racing writes add up exactly, and only one can claim the day", { skip }, async () => {
  await newBackend();
  await seedSpend(DAILY_BUDGET_USD - 0.01);
  const loud: string[] = [];
  const loudTrace = { log: { ...silent, error: (_o: object, m: string) => void loud.push(m) } };
  const writes = Array.from({ length: 20 }, () => {
    const spend = newSpend();
    spend.usd = 0.001;
    return recordSpend(spend, null, loudTrace);
  });
  await Promise.all(writes);
  assert.deepEqual(loud, ["ALERT dish budget reached"]);
  close(await spent(), DAILY_BUDGET_USD + 0.01);
  const alerts = (await db().query("select payload from outbox where payload->>'task' = 'dish.budget_alert'")).rows;
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].payload.day, dayOf(Date.now()));
  assert.ok(!JSON.stringify(alerts).match(/[a-z]+@/));
});

test("the budget's alert repeats harmlessly; if the webhook fails, it's tried again", { skip }, async () => {
  await newBackend();
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  const realFetch = globalThis.fetch;
  let calls = 0;
  let up = false;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("x", { status: up ? 200 : 500 });
  }) as typeof fetch;
  try {
    const message = JSON.stringify({ payload: { task: "dish.budget_alert", day: "2026-10-31", usd: 10.5 } });
    await assert.rejects(handleMessage(message, silent));
    assert.equal(calls, 1);
    up = true;
    await handleMessage(message, silent);
    assert.equal(calls, 2);
    await handleMessage(message, silent); // SQS's repeat
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a spend that can't be recorded never loses the work", { skip }, async () => {
  await newBackend();
  const spend = newSpend();
  spend.usd = 1e20; // more than numeric(12, 6) holds
  await assert.doesNotReject(recordSpend(spend, null, trace));
  assert.equal(await spent(), 0);
});

test("the sweep repeats harmlessly; a failed S3 delete stays marked, fails the message, and works next time", { skip }, async () => {
  const t = await newBackend();
  await fileId(t, "photo");
  await fileId(t, "voice");
  await advance(61 * MIN);
  store.failRemoves = true;
  await assert.rejects(sweep(trace), /S3 deletes failed/);
  assert.equal((await db().query("select 1 from files where deleted_at is not null")).rowCount, 0);
  store.failRemoves = false;
  await sweep(trace);
  assert.equal(store.objects.size, 0);
  assert.equal(store.removed.length, 2);
  await sweep(trace);
  assert.equal(store.removed.length, 2, "nothing deleted twice");
  assert.equal((await db().query("select 1 from files where deleted_at is not null")).rowCount, 2);
  // The row goes a week later.
  await advance(8 * 24 * 60 * MIN);
  await sweep(trace);
  assert.equal((await db().query("select 1 from files")).rowCount, 0);
});

test("a task that dies mid-merge is picked up when SQS shows its message again; until 3 minutes pass, a repeat does nothing", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  const askId = (await rowOf(kidToken)).id;
  assert.ok(await claimMerge(askId)); // the task took the claim, then died
  const message = JSON.stringify({ payload: { task: "dish.merge", askId } });
  await handleMessage(message, silent);
  assert.equal((await rowOf(kidToken)).version, null);
  await advance(3 * MIN + 1000);
  await handleMessage(message, silent);
  assert.ok((await rowOf(kidToken)).version);
  assert.equal((await rowOf(kidToken)).merge_tries, 2);
});

after(async () => {
  if (hasDatabase) await db().end();
});

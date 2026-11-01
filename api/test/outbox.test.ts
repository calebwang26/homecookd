import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { enqueue, sendDue } from "../src/outbox.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

async function clear() {
  await db().query("truncate outbox");
}

test("outbox", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();

  await t.test("work rolls back with the change that needed it", async () => {
    await clear();
    const client = await db().connect();
    await client.query("begin");
    await enqueue(client, { queue: "jobs", payload: { jobId: "a" } });
    await client.query("rollback");
    client.release();
    const sent: string[] = [];
    assert.equal(await sendDue(db(), async (_q, b) => void sent.push(b)), 0);
  });

  await t.test("due work is sent once, with an id for spotting repeats", async () => {
    await clear();
    await enqueue(db(), { queue: "jobs", payload: { jobId: "b" }, requestId: "trace-1" });
    const sent: { queue: string; body: { outboxId: string; requestId: string; payload: { jobId: string } } }[] = [];
    const send = async (queue: string, body: string) => void sent.push({ queue, body: JSON.parse(body) });
    assert.equal(await sendDue(db(), send), 1);
    assert.equal(await sendDue(db(), send), 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].queue, "jobs");
    assert.equal(sent[0].body.payload.jobId, "b");
    assert.equal(sent[0].body.requestId, "trace-1");
    assert.ok(sent[0].body.outboxId);
  });

  await t.test("work for later waits", async () => {
    await clear();
    await enqueue(db(), { queue: "scheduled", payload: { x: 1 }, sendAfter: new Date(Date.now() + 3_600_000) });
    assert.equal(await sendDue(db(), async () => {}), 0);
  });

  await t.test("two senders at once never take the same row", async () => {
    await clear();
    for (let i = 0; i < 30; i++) await enqueue(db(), { queue: "jobs", payload: { i } });
    const seen: string[] = [];
    const slow = async (_q: string, body: string) => {
      seen.push(JSON.parse(body).outboxId);
      await new Promise((resolve) => setTimeout(resolve, 5));
    };
    await Promise.all(Array.from({ length: 4 }, () => sendDue(db(), slow, undefined, 10)));
    assert.equal(seen.length, new Set(seen).size);
    assert.ok(seen.length > 10, `only ${seen.length} sent`);
  });

  await t.test("a failed send stays queued, waits longer, and doesn't block the next row", async () => {
    await clear();
    await enqueue(db(), { queue: "jobs", payload: { fail: true } });
    await enqueue(db(), { queue: "jobs", payload: { fail: false } });
    const send = async (_q: string, body: string) => {
      if (JSON.parse(body).payload.fail) throw new Error("SQS is down");
    };
    assert.equal(await sendDue(db(), send), 1);
    const { rows } = await db().query("select attempts, sent_at, send_after > now() as later from outbox where payload->>'fail' = 'true'");
    assert.equal(rows[0].attempts, 1);
    assert.equal(rows[0].sent_at, null);
    assert.equal(rows[0].later, true);
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

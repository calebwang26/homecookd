// The consumer of the `scheduled` queue, its repeats and failures, the sweep, the budget under concurrency.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { db } from "../src/db.js";
import { recordSpend } from "../src/modules/dish/budget.js";
import { claimMerge, TRY } from "../src/modules/dish/merge.js";
import { FAKE_WORDS, MS, newSpend } from "../src/modules/dish/model.js";
import { SWEEP, sweep } from "../src/modules/dish/tasks.js";
import { CLIP_WORST_MS, DAILY_BUDGET_USD, dayOf, HEAR_STALE_MS, MERGE_STALE_MS, sha256Hex } from "../src/modules/dish/values.js";
import { handleMessage, type Received, startConsumer } from "../src/scheduled.js";
import {
  advance,
  answer,
  answersOf,
  askedCard,
  askMom,
  close,
  fileId,
  finish,
  getCard,
  hasDatabase,
  makeCard,
  MIN,
  model,
  newBackend,
  post,
  rowOf,
  seedSpend,
  settle,
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
const until = async (ok: () => boolean, ms = 2_000) => {
  for (const start = Date.now(); Date.now() - start < ms && !ok(); ) await new Promise((resolve) => setTimeout(resolve, 5));
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
  const errors: unknown[] = [];
  const consumer = startConsumer(q.receiver, { ...silent, error: (fields: object, message: string) => void errors.push({ message, fields }) });
  // Each message here runs several real transactions, and on a busy machine a pass can take seconds. What's checked is what happened, not how fast: a real SQS try has 300 s.
  await until(() => q.removed.length === 3, 60_000)
    .catch((error: Error) => {
      // Name what happened, so a failure here isn't written off as load.
      throw new Error(`${error.message}; removed ${q.removed.length} of 3; consumer errors: ${JSON.stringify(errors)}`);
    })
    .finally(() => consumer.stop());
  await settle(); // a merge that found the clip being heard queued itself to look again
  assert.ok((await rowOf(kidToken)).version);
  assert.equal(model.calls.version, 1);
  assert.equal(model.calls.transcribe, 1);
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

test("a cost isn't lost when every connection stays busy past the wait", { skip }, async () => {
  await newBackend();
  const before = await spent();
  const held = await Promise.all(Array.from({ length: 10 }, () => db().connect()));
  const loud: string[] = [];
  const spend = newSpend();
  spend.usd = 0.5;
  const saving = recordSpend(spend, null, { log: { ...silent, error: (_o: object, m: string) => void loud.push(m) } });
  await new Promise((resolve) => setTimeout(resolve, 5_500)); // past one wait
  for (const client of held) client.release();
  await saving;
  assert.deepEqual(loud, []);
  close(await spent(), before + 0.5);
  assert.equal(spend.usd, 0);
});

test("if the connections never free up, the lost cost says so, how much, and why", { skip }, async () => {
  await newBackend();
  const before = await spent();
  const held = await Promise.all(Array.from({ length: 10 }, () => db().connect()));
  const logged: { fields: { usd?: number; poolWait?: boolean; attempt?: number }; message: string }[] = [];
  const spend = newSpend();
  spend.usd = 0.5;
  await recordSpend(spend, null, { log: { ...silent, error: (fields: object, message: string) => void logged.push({ fields, message }) } });
  for (const client of held) client.release();
  assert.equal(logged.length, 1);
  assert.equal(logged[0].message, "dish spend wasn't recorded");
  assert.equal(logged[0].fields.usd, 0.5);
  assert.equal(logged[0].fields.poolWait, true);
  assert.equal(logged[0].fields.attempt, 3);
  close(await spent(), before);
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

// ---------------------------------------------------------------------------------------------
// One holder hears a clip. Each test makes the overlap happen on purpose: Ink stays open until it's let go.

/** Holds Ink inside its first call. `said`: what each call hears, in order, if not the fake's words. */
function holdInk(said: string[] = []) {
  let enter = () => {};
  let letGo = () => {};
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const gate = new Promise<void>((resolve) => (letGo = resolve));
  let n = 0;
  model.transcribe = async (real) => {
    n += 1;
    const call = n;
    if (call === 1) {
      enter();
      await gate;
    }
    const heard = await real();
    return said[call - 1] ?? heard;
  };
  return { entered, letGo };
}
const hearMessage = (a: { id: string; audio_key: string }) => JSON.stringify({ payload: { task: "dish.hear", answerId: a.id, audioKey: a.audio_key } });
const mergeMessage = (askId: string) => JSON.stringify({ payload: { task: "dish.merge", askId } });

test("a merge that finds her clip being heard waits: one Ink, one translation, and the try isn't spent", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1", { lang: "hi" });
  await finish(t, askToken);
  const row = await rowOf(kidToken);
  const [clip] = await answersOf(row.id);
  const held = holdInk();
  const hearing = handleMessage(hearMessage(clip), silent);
  await held.entered;
  await handleMessage(mergeMessage(row.id), silent); // runs to its end with Ink still open
  assert.equal(model.calls.transcribe, 1);
  assert.equal(model.calls.version, 0);
  assert.equal((await rowOf(kidToken)).merge_tries, 0);
  held.letGo();
  await hearing;
  await settle();
  assert.equal(model.calls.transcribe, 1);
  assert.equal(model.calls.toEnglish, 1);
  assert.equal(model.calls.version, 1);
  const [done] = await answersOf(row.id);
  assert.equal(done.words, FAKE_WORDS);
  assert.equal(done.english, `(English) ${FAKE_WORDS}`);
  assert.equal(done.hearing_at, null);
  assert.ok((await rowOf(kidToken)).version);
});

test("a hear that arrives while a merge has her clip does nothing", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  const row = await rowOf(kidToken);
  const [clip] = await answersOf(row.id);
  const held = holdInk();
  const merging = handleMessage(mergeMessage(row.id), silent);
  await held.entered;
  await handleMessage(hearMessage(clip), silent);
  assert.equal(model.calls.transcribe, 1);
  held.letGo();
  await merging;
  assert.equal(model.calls.transcribe, 1);
  assert.equal(model.calls.version, 1);
  assert.ok((await rowOf(kidToken)).version);
});

test("two hears at once, SQS's repeat: one Ink", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const [clip] = await answersOf((await rowOf(kidToken)).id);
  const held = holdInk();
  const first = handleMessage(hearMessage(clip), silent);
  await held.entered;
  await handleMessage(hearMessage(clip), silent);
  held.letGo();
  await first;
  assert.equal(model.calls.transcribe, 1);
  assert.equal((await answersOf((await rowOf(kidToken)).id))[0].words, FAKE_WORDS);
});

test("a slow hear can't change what a merge already quoted: her version and her words agree", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  const row = await rowOf(kidToken);
  const [clip] = await answersOf(row.id);
  const LATE = "Something else entirely, heard late.";
  const held = holdInk([LATE]); // the first holder hears these words, the second the fake's
  const slow = handleMessage(hearMessage(clip), silent);
  await held.entered;
  await advance(HEAR_STALE_MS + 1000); // it has held the clip too long to count
  await handleMessage(mergeMessage(row.id), silent);
  const merged = await rowOf(kidToken);
  assert.equal(merged.version?.ingredients[2].amount, "two big spoons");
  held.letGo();
  await slow;
  const [after_] = await answersOf(row.id);
  assert.equal(after_.words, FAKE_WORDS, "the first to land stays");
  const card = await getCard(t, kidToken);
  assert.equal(card.answers[0].words, FAKE_WORDS);
  assert.equal(card.version.ingredients[2].quote.words, "Two big spoons");
  assert.ok(FAKE_WORDS.includes(card.version.ingredients[2].quote.words));
});

test("a slow hear also keeps out of the English: what's settled stays", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1", { lang: "hi" });
  const id = (await rowOf(kidToken)).id;
  const [clip] = await answersOf(id);
  const held = holdInk(["the slow one", "the second one"]);
  const slow = handleMessage(hearMessage(clip), silent);
  await held.entered;
  await advance(HEAR_STALE_MS + 1000);
  await handleMessage(hearMessage(clip), silent);
  held.letGo();
  await slow;
  const [done] = await answersOf(id);
  assert.deepEqual([done.words, done.english], ["the second one", "(English) the second one"]);
  assert.equal(model.calls.toEnglish, 1, "the slow one took the words that were saved, and had nothing left to translate");
});

test("a slow translation can't replace the English a later holder saved", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1", { lang: "hi" });
  const id = (await rowOf(kidToken)).id;
  const [clip] = await answersOf(id);
  let enter = () => {};
  let letGo = () => {};
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const gate = new Promise<void>((resolve) => (letGo = resolve));
  let n = 0;
  model.english = async () => {
    n += 1;
    if (n > 1) return "the second English";
    enter();
    await gate;
    return "the slow English";
  };
  const slow = handleMessage(hearMessage(clip), silent);
  await entered;
  await advance(HEAR_STALE_MS + 1000);
  await handleMessage(hearMessage(clip), silent);
  letGo();
  await slow;
  const [done] = await answersOf(id);
  assert.equal(done.english, "the second English");
  assert.equal(model.calls.transcribe, 1, "the words were saved already");
});

test("a holder that died stops counting: the merge waits it out, gives its try back, then hears the clip", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  const row = await rowOf(kidToken);
  await db().query("update dish_answers set hearing_at = now() where ask_id = $1", [row.id]);
  await handleMessage(mergeMessage(row.id), silent);
  const waiting = await rowOf(kidToken);
  assert.deepEqual([waiting.merge_tries, waiting.merge_started_at, waiting.version], [0, null, null]);
  assert.equal(model.calls.transcribe, 0);
  assert.equal((await getCard(t, kidToken)).merging, true);
  const later = (await db().query("select 1 from outbox where sent_at is null and payload->>'task' = 'dish.merge' and send_after > now()")).rowCount;
  assert.equal(later, 1, "it queued itself to look again");
  await advance(HEAR_STALE_MS + 1000);
  await settle();
  assert.ok((await rowOf(kidToken)).version);
  assert.equal(model.calls.transcribe, 1);
});

test("she re-records while a hear holds the old clip: the new clip isn't kept waiting, and keeps none of the old words", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const id = (await rowOf(kidToken)).id;
  const [old] = await answersOf(id);
  const held = holdInk(["the old clip's words"]);
  const slow = handleMessage(hearMessage(old), silent);
  await held.entered;
  await answer(t, askToken, "q1");
  const [fresh] = await answersOf(id);
  assert.notEqual(fresh.audio_key, old.audio_key);
  assert.equal(fresh.hearing_at, null);
  held.letGo();
  await slow;
  assert.equal((await answersOf(id))[0].words, null);
  await handleMessage(hearMessage(fresh), silent);
  assert.equal((await answersOf(id))[0].words, FAKE_WORDS);
});

test("a try with many clips to hear stops at its limit, keeps what it heard and goes on, without spending tries", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup?" }, { id: "q2", text: "When are the eggs done?" }, { id: "q3", text: "What goes on top?" }]);
  for (const q of ["q1", "q2", "q3"]) await answer(t, askToken, q);
  await db().query("delete from outbox");
  await finish(t, askToken);
  const before = TRY.hearMs;
  TRY.hearMs = -1;
  try {
    const id = (await rowOf(kidToken)).id;
    await handleMessage(mergeMessage(id), silent);
    assert.equal(model.calls.transcribe, 1, "one clip, then it stopped");
    assert.equal((await rowOf(kidToken)).merge_tries, 0);
    await settle();
    assert.equal(model.calls.transcribe, 3);
    assert.equal(model.calls.version, 1);
    assert.equal((await rowOf(kidToken)).merge_tries, 1);
    assert.ok((await rowOf(kidToken)).version);
  } finally {
    TRY.hearMs = before;
  }
});

test("the numbers hold: a try's worst case is under the stale mark, and that's under SQS's visibility", () => {
  assert.ok(TRY.hearMs + CLIP_WORST_MS < MERGE_STALE_MS, "hearing");
  assert.ok(TRY.hearMs + MS.version.budget + TRY.translate.timeoutMs < MERGE_STALE_MS, "hearing, her version, the page's translation");
  assert.ok(HEAR_STALE_MS > CLIP_WORST_MS);
  const queues = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "infra", "modules", "env", "queues.tf");
  if (!existsSync(queues)) return;
  const scheduled = readFileSync(queues, "utf8").split('resource "aws_sqs_queue" "scheduled"')[1];
  const visibilityS = Number(/visibility_timeout_seconds\s*=\s*(\d+)/.exec(scheduled)![1]);
  assert.ok(MERGE_STALE_MS < visibilityS * 1000);
  assert.ok(SWEEP.ms < visibilityS * 1000);
});

// ---------------------------------------------------------------------------------------------
// What the sweep reaches, and how fast

test("the sweep leaves alone what it can't address: another bucket, and any file that isn't an anonymous upload", { skip }, async () => {
  const t = await newBackend();
  const mine = await fileId(t, "photo");
  const others = [
    ["media/old", "media"],
    ["uploads/old", "uploads"],
    ["private/from-convex", "private"],
  ];
  for (const [key, bucket] of others) {
    await db().query("insert into files (key, bucket, kind, created_at) values ($1, $2, 'other', now() - interval '2 days')", [key, bucket]);
    await db().query("insert into files (key, bucket, kind, created_at, delete_requested_at) values ($1, $2, 'other', now() - interval '2 days', now())", [`${key}-marked`, bucket]);
  }
  await advance(61 * MIN);
  await sweep(trace);
  assert.equal(store.removed.length, 1, store.removed.join());
  assert.equal(store.removed[0], (await db().query("select key from files where capability_hash = $1", [sha256Hex(mine)])).rows[0].key);
  const { rows } = await db().query("select key, delete_requested_at, deleted_at from files where capability_hash is null order by key");
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(row.deleted_at, null, `${row.key} isn't deleted`);
    assert.equal(!!row.delete_requested_at, row.key.endsWith("-marked"), `${row.key} isn't newly marked`);
  }
});

test("one sweep works through every batch, not one", { skip }, async () => {
  const t = await newBackend();
  for (let i = 0; i < 7; i += 1) await fileId(t, "photo", { ip: `192.0.2.${i}` });
  await advance(61 * MIN);
  const before = { ...SWEEP };
  SWEEP.batch = 2;
  try {
    await handleMessage(JSON.stringify({ payload: { task: "dish.sweep" } }), silent);
  } finally {
    Object.assign(SWEEP, before);
  }
  assert.equal(store.removed.length, 7);
  assert.equal((await db().query("select 1 from outbox where sent_at is null")).rowCount, 0, "nothing left over");
});

test("out of time with more to do, the sweep queues itself; a real deletion goes before the orphans", { skip }, async () => {
  const t = await newBackend();
  for (let i = 0; i < 4; i += 1) await fileId(t, "photo", { ip: `192.0.2.${i}` });
  await db().query("update files set delete_requested_at = now() where attached_at is null"); // a backlog of orphans
  // Then a card's file is deleted, later than all of them.
  const { kidToken } = await makeCard(t, { dish: "dal" });
  const note = await fileId(t, "voice");
  await post(t, "/dish/cards/update", { kidToken, voiceNote: note });
  const real = (await rowOf(kidToken)).kid_voice_note_key!;
  await post(t, "/dish/cards/update", { kidToken, voiceNote: null });
  const before = { ...SWEEP };
  SWEEP.batch = 1;
  SWEEP.ms = 0;
  try {
    await sweep({ log: silent });
  } finally {
    Object.assign(SWEEP, before);
  }
  assert.deepEqual(store.removed, [real], "the real deletion, from a full batch");
  const queued = (await db().query("select payload from outbox where sent_at is null and payload->>'task' = 'dish.sweep'")).rows;
  assert.equal(queued.length, 1);
  await settle();
  assert.equal(store.removed.length, 5, "the rest, on its own messages");
});

test("when S3 is down the sweep stops rather than spinning, and the message fails so it's seen", { skip }, async () => {
  const t = await newBackend();
  for (let i = 0; i < 3; i += 1) await fileId(t, "photo", { ip: `192.0.2.${i}` });
  await advance(61 * MIN);
  store.failRemoves = true;
  const before = { ...SWEEP };
  SWEEP.batch = 1;
  try {
    await assert.rejects(sweep(trace), /1 S3 deletes failed/);
  } finally {
    Object.assign(SWEEP, before);
  }
});

after(async () => {
  if (hasDatabase) await db().end();
});

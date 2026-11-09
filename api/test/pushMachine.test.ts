// The push machine (api/src/modules/messages/pushData.ts, docs/agents/STATE-MACHINES.md row 10) on real Postgres: every state × every event, then the
// whole path with a fake Expo that's down, times out, or loses a wake-up. Caleb, Nov 8 (decision 6): a push Expo couldn't take is tried again.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { sendExpoPush, UNAVAILABLE, type ExpoMessage } from "../src/modules/messages/expo.js";
import { queuePush } from "../src/modules/messages/push.js";
import * as data from "../src/modules/messages/pushData.js";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { tx } from "../src/db.js";
import { closeAll, drain, dueNow, logOf, phone, pushes, silent, skip, tokenFor, world, type World } from "./messagesHelpers.js";

after(closeAll);

const EVENTS = ["claim", "sent", "failed", "none", "retry", "drop", "sweep"] as const;
type Event = (typeof EVENTS)[number];

type Seed = {
  status?: string;
  attempts?: number;
  /** SQL for delivering_at and send_at. */
  holder?: string;
  sendAt?: string;
  /** An outbox push.deliver for it: unsent, or sent this long ago. */
  wake?: "unsent" | string;
};

/** What each event does from each state. An event left out changes nothing. */
const TABLE: { state: string; seed: Seed; to: Partial<Record<Event, string>> }[] = [
  { state: "queued", seed: {}, to: { claim: "sending", drop: "none" } },
  // Its wake-up waits in the outbox until then; one that came early would send it.
  { state: "queued, not due yet (a craving waiting out the night, or a retry's wait)", seed: { sendAt: "now() + interval '1 hour'" }, to: { claim: "sending", drop: "none" } },
  { state: "queued, held by an older api", seed: { holder: "now()" }, to: { drop: "none" } },
  { state: "queued, an older api's holder gone quiet", seed: { holder: "now() - interval '5 minutes'" }, to: { claim: "sending", drop: "none" } },
  { state: "queued, out of attempts", seed: { attempts: data.MAX_ATTEMPTS }, to: { drop: "none" } },
  { state: "queued 30 min past due, its wake-up lost", seed: { sendAt: "now() - interval '30 minutes'" }, to: { claim: "sending", drop: "none", sweep: "queued" } },
  { state: "queued 30 min past due, a wake-up still unsent", seed: { sendAt: "now() - interval '30 minutes'", wake: "unsent" }, to: { claim: "sending", drop: "none" } },
  { state: "queued 30 min past due, a wake-up sent 5 min ago", seed: { sendAt: "now() - interval '30 minutes'", wake: "5 minutes" }, to: { claim: "sending", drop: "none" } },
  { state: "queued 30 min past due, a wake-up sent 30 min ago", seed: { sendAt: "now() - interval '30 minutes'", wake: "30 minutes" }, to: { claim: "sending", drop: "none", sweep: "queued" } },
  { state: "queued 30 min past due, one wake-up left", seed: { sendAt: "now() - interval '30 minutes'", attempts: data.MAX_ATTEMPTS - 1 }, to: { claim: "sending", drop: "none", sweep: "failed" } },
  { state: "sending", seed: { status: "sending", attempts: 1, holder: "now()" }, to: { sent: "sent", failed: "failed", none: "none", retry: "queued" } },
  { state: "sending, holder quiet 5 min", seed: { status: "sending", attempts: 1, holder: "now() - interval '5 minutes'" }, to: { claim: "sending", sent: "sent", failed: "failed", none: "none", retry: "queued" } },
  { state: "sending, holder quiet 15 min", seed: { status: "sending", attempts: 1, holder: "now() - interval '15 minutes'" }, to: { claim: "sending", sent: "sent", failed: "failed", none: "none", retry: "queued", sweep: "queued" } },
  { state: "sending, holder quiet 15 min, out of attempts", seed: { status: "sending", attempts: data.MAX_ATTEMPTS, holder: "now() - interval '15 minutes'" }, to: { sent: "sent", failed: "failed", none: "none", retry: "queued", sweep: "failed" } },
  { state: "sent", seed: { status: "sent", attempts: 1 }, to: {} },
  { state: "failed", seed: { status: "failed", attempts: 1 }, to: {} },
  { state: "none", seed: { status: "none" }, to: {} },
  { state: "capped", seed: { status: "capped" }, to: {} },
  { state: "skipped", seed: { status: "skipped" }, to: {} },
];

const ASK = "ask-1";

async function seed(w: World, s: Seed): Promise<string> {
  const { rows } = await db().query(
    `insert into push_log (person_id, kind, status, title, body, url, attempts, delivering_at, send_at, dedupe_key)
     values ($1, 'craving', $2, 'Leo wants your dal', 'Show Leo how', '/dish/x', $3, ${s.holder ?? "null"}, ${s.sendAt ?? "now()"}, $4) returning id`,
    [w.dad.id, s.status ?? "queued", s.attempts ?? 0, data.cravingKey(ASK)],
  );
  const id = rows[0].id as string;
  if (s.wake) {
    await db().query(`insert into outbox (queue, payload, sent_at) values ('scheduled', $1, ${s.wake === "unsent" ? "null" : `now() - interval '${s.wake}'`})`, [
      JSON.stringify({ task: "push.deliver", logId: id }),
    ]);
  }
  return id;
}

const row = async (id: string) => (await db().query(`select status, attempts, title, body, error, delivering_at, send_at from push_log where id = $1`, [id])).rows[0];

async function fire(w: World, e: Event, id: string, attempts: number): Promise<{ woken?: string[] }> {
  if (e === "claim") await data.claimDelivery(db(), id);
  if (e === "sent" || e === "failed" || e === "none") await data.finishDelivery(db(), id, attempts, e, [], e === "failed" ? "gone" : null);
  if (e === "retry") await data.retryDelivery(db(), id, attempts, "HTTP 503", 60);
  if (e === "drop") await data.dropQueuedCraving(db(), w.dad.id, ASK);
  if (e === "sweep") return { woken: (await data.sweepDeliveries(db(), 50)).wake };
  return {};
}

test("every push state × every event, on real Postgres", { skip }, async () => {
  const w = await world();
  for (const c of TABLE) {
    for (const e of EVENTS) {
      await db().query(`truncate push_log, outbox`);
      const id = await seed(w, c.seed);
      const before = await row(id);
      const { woken } = await fire(w, e, id, before.attempts);
      const now = await row(id);
      const at = `${c.state} + ${e}`;
      const to = c.to[e];
      if (!to) {
        assert.deepEqual(now, before, `${at}: nothing changes`);
        if (e === "sweep") assert.deepEqual(woken, [], `${at}: nothing woken`);
        continue;
      }
      assert.equal(now.status, to, at);
      const final = ["sent", "failed", "none"].includes(to);
      assert.deepEqual([now.title, now.body], final ? [null, null] : ["Leo wants your dal", "Show Leo how"], `${at}: the words stay only while it may go`);
      if (e === "claim") {
        assert.equal(now.attempts, before.attempts + 1, `${at}: a claim spends an attempt`);
        assert.ok(now.delivering_at, `${at}: held`);
      }
      if (e === "retry") {
        assert.equal(now.delivering_at, null, at);
        const waitS = (now.send_at.getTime() - Date.now()) / 1000;
        assert.ok(waitS > 50 && waitS <= 61, `${at}: due again in a minute (${waitS})`);
      }
      if (e === "sweep") {
        const spent = c.seed.status === "sending" ? 0 : 1;
        assert.equal(now.attempts, before.attempts + spent, `${at}: a lost wake-up spends an attempt, a quiet holder's was spent by its claim`);
        assert.deepEqual(woken, to === "queued" ? [id] : [], `${at}: woken`);
        if (to === "failed") assert.equal(now.error, "gave up", at);
        assert.equal(now.delivering_at, null, at);
      }
    }
  }
});

test("a holder that lost its claim can't finish or retry: the claim's attempts fence it", { skip }, async () => {
  const w = await world();
  await db().query(`truncate push_log, outbox`);
  const id = await seed(w, { status: "sending", attempts: 1, holder: "now() - interval '5 minutes'" });
  const taken = await data.claimDelivery(db(), id);
  assert.equal(taken?.attempts, 2);
  assert.equal(await data.finishDelivery(db(), id, 1, "failed", [], "late"), false);
  assert.equal(await data.retryDelivery(db(), id, 1, "late", 60), null);
  assert.equal((await row(id)).status, "sending");
  assert.equal(await data.finishDelivery(db(), id, 2, "sent", [], null), true);
  assert.equal((await row(id)).status, "sent");
});

const push = (w: World) =>
  tx((c) => queuePush(c, { personId: w.leo.id, kind: "message", title: "Mom", body: "Dinner at 7?", url: "/chat/x", dedupeKey: `m-${Math.random()}` }));

test("Expo down: tried again 1, 5, 15 and 60 minutes on, and it goes once Expo is back", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  w.expo.down = true;
  assert.equal(await push(w), "queued");
  const waits: number[] = [];
  for (let i = 0; i < data.RETRY_AFTER_S.length; i += 1) {
    await drain();
    const [log] = await logOf(w.leo.id);
    assert.deepEqual([log.status, log.attempts, log.error, log.body], ["queued", i + 1, "HTTP 503", "Dinner at 7?"]);
    const { rows } = await db().query(`select extract(epoch from send_after - now())::int as s from outbox where sent_at is null and payload->>'task' = 'push.deliver'`);
    assert.equal(rows.length, 1, "one wake-up for the next try");
    waits.push(Math.round(rows[0].s / 60));
    await dueNow();
  }
  assert.deepEqual(waits, [1, 5, 15, 60]);
  w.expo.down = false;
  await drain();
  const [log] = await logOf(w.leo.id);
  assert.deepEqual([log.status, log.attempts, log.body], ["sent", data.MAX_ATTEMPTS, null]);
  assert.deepEqual(pushes(w.expo), [[tokenFor("a"), "Mom", "Dinner at 7?", "/chat/x"]], "once");
});

test("Expo down past the last try: failed, words off, and the phone's token kept", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  w.expo.down = true;
  await push(w);
  for (let i = 0; i < data.MAX_ATTEMPTS; i += 1) {
    await drain();
    await dueNow();
  }
  await drain();
  const [log] = await logOf(w.leo.id);
  assert.deepEqual([log.status, log.attempts, log.error, log.title, log.body], ["failed", data.MAX_ATTEMPTS, "HTTP 503", null, null]);
  assert.equal((await db().query(`select 1 from outbox where sent_at is null`)).rowCount, 0, "no more wake-ups");
  assert.equal((await db().query(`select 1 from push_tokens where person_id = $1`, [w.leo.id])).rowCount, 1);
});

test("a timeout isn't tried again: Expo may have taken it, and a push is never sent twice", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  w.expo.timeout = true;
  await push(w);
  await drain();
  const [log] = await logOf(w.leo.id);
  assert.deepEqual([log.status, log.attempts, log.error, log.body], ["failed", 1, "TimeoutError", null]);
});

test("a push.deliver lost to the dead-letter queue, and a holder that died: push.sweep wakes both and they go", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  await push(w);
  // SQS took the wake-up and gave up on it 3 tries later: the outbox says sent, nothing ran.
  await sendDue(db(), async () => {}, undefined, 50);
  await push(w);
  const [, second] = await logOf(w.leo.id);
  // The second's holder claimed it and died.
  await sendDue(db(), async () => {}, undefined, 50);
  await data.claimDelivery(db(), second.id);
  await db().query(`update push_log set send_at = now() - interval '30 minutes'`);
  await db().query(`update push_log set delivering_at = now() - interval '15 minutes' where id = $1`, [second.id]);
  await db().query(`update outbox set sent_at = now() - interval '30 minutes'`);

  await handleMessage(JSON.stringify({ payload: { task: "push.sweep" } }), silent);
  await drain();
  assert.deepEqual((await logOf(w.leo.id)).map((l) => [l.status, l.attempts]), [["sent", 2], ["sent", 2]]);
  assert.equal(w.expo.sent.flat().length, 2);
  await handleMessage(JSON.stringify({ payload: { task: "push.sweep" } }), silent);
  await drain();
  assert.equal(w.expo.sent.flat().length, 2, "a second sweep finds nothing");
});

const msg = (to: string): ExpoMessage => ({ to, title: "t", body: "b", sound: "default", priority: "high", channelId: "default", data: { url: "/", kind: "message", profile_id: "p" } });

test("what Expo didn't take is marked to try again; a timeout or a refusal isn't", { skip: false }, async () => {
  const later = (r: { tickets: { status: string; details?: { error?: string } }[] }) => r.tickets.map((t) => t.details?.error === UNAVAILABLE);
  const status = (n: number) => (async () => new Response("down", { status: n })) as unknown as typeof fetch;
  assert.deepEqual(later(await sendExpoPush([msg("a"), msg("b")], { fetch: status(503), retryWaitMs: 0 })), [true, true]);
  assert.deepEqual(later(await sendExpoPush([msg("a")], { fetch: status(429), retryWaitMs: 0 })), [true]);
  assert.deepEqual(later(await sendExpoPush([msg("a")], { fetch: status(400), retryWaitMs: 0 })), [false]);
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  assert.deepEqual(later(await sendExpoPush([msg("a")], { fetch: (async () => Promise.reject(refused)) as typeof fetch })), [true]);
  const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  assert.deepEqual(later(await sendExpoPush([msg("a")], { fetch: (async () => Promise.reject(reset)) as typeof fetch })), [false], "it may have got there");
  const timeout = new DOMException("timed out", "TimeoutError");
  const out = await sendExpoPush([msg("a")], { fetch: (async () => Promise.reject(timeout)) as typeof fetch });
  assert.deepEqual([later(out), out.tickets[0]], [[false], { status: "error", message: "TimeoutError" }]);
});

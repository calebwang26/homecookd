// What one stuck row does to everyone else: a request waiting on a lock keeps its connection, so without lock_timeout it takes the pool with it. And the guard against asking for
// a second connection inside a transaction, where ten at once would wait on each other until the pool gave up. Made-up data.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, isLockWait, tx } from "../src/db.js";
import { LOCK, migrate } from "../src/migrate.js";
import { hasDatabase, makeCard, newBackend, post } from "./dishHelpers.js";

const skip = !hasDatabase;

test("every connection gives up on a lock after about 3 s", { skip }, async () => {
  assert.equal((await db().query("show lock_timeout")).rows[0].lock_timeout, "3s");
});

test("a second deploy's migration waits its turn past that, rather than failing", { skip }, async () => {
  await newBackend(); // migrated
  const first = await db().connect();
  await first.query("select pg_advisory_lock($1)", [LOCK]);
  const waiting = migrate(db());
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  await first.query("select pg_advisory_unlock($1)", [LOCK]);
  first.release();
  assert.deepEqual(await waiting, []);
});

/** Holds every card's row for as long as `work` takes, on a connection of its own. */
async function holdingTheRows<T>(work: () => Promise<T>): Promise<T> {
  const holder = await db().connect();
  try {
    await holder.query("begin");
    await holder.query("select 1 from dish_asks for update");
    return await work();
  } finally {
    await holder.query("rollback");
    holder.release();
  }
}

test("a request waiting on a held row answers 503 with when to come back, and nothing is written", { skip }, async () => {
  const app = await newBackend();
  const { kidToken } = await makeCard(app);
  await db().query("delete from rate_hits");
  const before = Date.now();
  const reply = await holdingTheRows(() => post(app, "/dish/cards/update", { kidToken, message: "waited" }));
  const waited = Date.now() - before;
  assert.equal(reply.status, 503, JSON.stringify(reply.data));
  assert.equal(reply.data.code, "busy");
  assert.ok(Number(reply.headers["retry-after"]) >= 1, "says when to come back");
  assert.ok(waited >= 2_900 && waited < 4_500, `waited ${waited} ms`);
  const { rows } = await db().query("select count(*)::int as n from dish_asks where message = 'waited'");
  assert.equal(rows[0].n, 0);
  // The row is free again, and the same request works.
  assert.equal((await post(app, "/dish/cards/update", { kidToken, message: "waited" })).status, 200);
});

test("a stuck row with a few waiting leaves the task able to answer anyone else", { skip }, async () => {
  const app = await newBackend();
  const { kidToken } = await makeCard(app);
  await db().query("delete from rate_hits");
  await holdingTheRows(async () => {
    const waiting = Array.from({ length: 15 }, () => post(app, "/dish/cards/update", { kidToken, message: "queued" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const ready = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual([...new Set((await Promise.all(waiting)).map((r) => r.status))], [503]);
  });
});

// Not a cure: requests take connections in the order they came, so a long enough queue still makes everyone else wait. The bounded wait is AWS-MIGRATION.md's overload gate.
test("with a long queue nobody gets a 500: each is told to come back, and it clears when the row does", { skip }, async () => {
  const app = await newBackend();
  const { kidToken } = await makeCard(app);
  await db().query("delete from rate_hits");
  await holdingTheRows(async () => {
    const waiting = Array.from({ length: 40 }, () => post(app, "/dish/cards/update", { kidToken, message: "queued" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const ready = await app.inject({ method: "GET", url: "/ready" });
    assert.ok([200, 503].includes(ready.statusCode), String(ready.statusCode));
    const replies = await Promise.all(waiting);
    assert.deepEqual([...new Set(replies.map((r) => r.status))], [503]);
    for (const r of replies) assert.ok(Number(r.headers["retry-after"]) >= 1);
  });
  await db().query("delete from rate_hits");
  assert.equal((await post(app, "/dish/cards/update", { kidToken, message: "after" })).status, 200);
});

test("a row held briefly is just a short wait", { skip }, async () => {
  const app = await newBackend();
  const { kidToken } = await makeCard(app);
  await db().query("delete from rate_hits");
  const holder = await db().connect();
  await holder.query("begin");
  await holder.query("select 1 from dish_asks for update");
  const waiting = post(app, "/dish/cards/update", { kidToken, message: "patient" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await holder.query("rollback");
  holder.release();
  assert.equal((await waiting).status, 200);
});

test("the old-contract and signed-in handlers say the same: busy is a 503, not a 500", { skip }, async () => {
  const app = await newBackend();
  const held = await Promise.all(Array.from({ length: 10 }, () => db().connect()));
  try {
    const invite = await app.inject({ method: "POST", url: "/invite/open", headers: { origin: "https://homecookd.app", "content-type": "application/json" }, payload: JSON.stringify({ token: "Q".repeat(22), deviceId: "a-device-id" }) });
    assert.equal(invite.statusCode, 503, invite.body);
    assert.ok(Number(invite.headers["retry-after"]) >= 1);
    const ready = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${"Q".repeat(40)}` } });
    assert.equal(ready.statusCode, 503, ready.body);
  } finally {
    for (const c of held) c.release();
  }
});

test("isLockWait knows Postgres's code", () => {
  assert.equal(isLockWait(Object.assign(new Error("x"), { code: "55P03" })), true);
  assert.equal(isLockWait(Object.assign(new Error("x"), { code: "40P01" })), false);
  assert.equal(isLockWait(null), false);
});

test("a second connection inside tx() throws in tests, and the transaction's own client is fine", { skip }, async () => {
  assert.equal(process.env.TX_GUARD, "throw", "package.json sets it");
  await assert.rejects(() => tx(() => db().query("select 1")), /inside a transaction/);
  await assert.rejects(() => tx(() => tx(async (c) => c.query("select 1"))), /inside a transaction/);
  // Awaited work still counts, and so does work started side by side.
  await assert.rejects(() => tx(async () => { await Promise.resolve(); await db().query("select 1"); }), /inside a transaction/);
  assert.equal((await tx((c) => c.query("select 1 as n"))).rows[0].n, 1);
  // Once it's over, the pool is free to use again.
  await tx((c) => c.query("select 1"));
  assert.equal((await db().query("select 2 as n")).rows[0].n, 2);
});

test("production reports a second connection and carries on", { skip }, async () => {
  const saved = [process.env.TX_GUARD, console.error] as const;
  const logged: string[] = [];
  delete process.env.TX_GUARD;
  console.error = (line: string) => void logged.push(line);
  try {
    const out = await tx(() => db().query("select 3 as n"));
    assert.equal(out.rows[0].n, 3);
  } finally {
    process.env.TX_GUARD = saved[0];
    console.error = saved[1];
  }
  assert.ok(logged.some((line) => line.includes("inside a transaction")));
});

after(async () => {
  await db().end().catch(() => {});
});

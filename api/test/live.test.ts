// Live updates on real Postgres, plus the rules that need no database. docs/build/LIVE-UPDATES.md says what these pin.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { SHED_WAITING } from "../src/modules/live/routes.js";
import { isDatabaseDown, pollAfterMs, versionOf, windowCounter } from "../src/modules/live/service.js";
import { bearer, family, freshDatabase, hasDatabase, person, session } from "./helpers.js";

const URL_JOBS = "/v1/live/jobs";

type Job = { stage?: string; progress?: number; title?: string; error?: string; cancelled?: boolean; ageH?: number };

async function job(familyId: string, cookId: string, j: Job = {}): Promise<string> {
  const { rows } = await db().query(
    `insert into jobs (family_id, cook_id, upload_key, source, stage, progress, title, error, cancelled_at, updated_at)
     values ($1, $2, $3, 'phone', $4, $5, $6, $7, case when $8 then now() end, now() - make_interval(hours => $9))
     returning id`,
    [familyId, cookId, `up-${Math.random().toString(36).slice(2)}/`, j.stage ?? "understanding", j.progress ?? 0.3, j.title ?? null, j.error ?? null, j.cancelled ?? false, j.ageH ?? 0],
  );
  return rows[0].id;
}

const moveJob = (id: string, stage: string, progress: number) =>
  db().query("update jobs set stage = $2, progress = $3, updated_at = now() where id = $1", [id, stage, progress]);

async function signedInCook(name?: string) {
  const f = await family(name);
  const p = await person(f);
  return { family: f, person: p, token: await session(f, p) };
}

/** The routes read their settings when the app gets ready, so that's how long these have to be set. */
async function withEnv(settings: Record<string, string>): Promise<FastifyInstance> {
  Object.assign(process.env, settings);
  const app = buildApp({ logger: false });
  await app.ready();
  for (const name of Object.keys(settings)) delete process.env[name];
  return app;
}

const poll = async (app: FastifyInstance, token: string, since?: string) =>
  app.inject({ url: URL_JOBS + (since === undefined ? "" : `?since=${since}`), headers: bearer(token) });

test("the rules", async (t) => {
  await t.test("a version is the same on any task and changes with any field", () => {
    assert.equal(versionOf([{ a: 1 }]), versionOf([{ a: 1 }]));
    assert.notEqual(versionOf([{ a: 1 }]), versionOf([{ a: 2 }]));
    assert.match(versionOf([]), /^[A-Za-z0-9_-]{22}$/);
  });

  await t.test("the window counter stops a key, not its neighbors, and starts over", () => {
    let clock = 1_000;
    const counter = windowCounter(2, 60_000, () => clock);
    counter.add("a");
    assert.equal(counter.waitS("a"), 0);
    counter.add("a");
    assert.equal(counter.waitS("a"), 60);
    assert.equal(counter.waitS("b"), 0);
    clock += 60_000;
    assert.equal(counter.waitS("a"), 0);
  });

  await t.test("a flood of new keys can't grow the counter without end", () => {
    const counter = windowCounter(1, 60_000, () => 0, 3);
    for (const key of ["a", "b", "c", "d"]) counter.add(key);
    assert.equal(counter.waitS("a"), 0); // forgotten, which only makes the brake softer
  });

  await t.test("the next poll stays within 10% of the rate, and the floor wins", () => {
    assert.equal(pollAfterMs(5_000, 0, () => 0), 4_500);
    assert.equal(pollAfterMs(5_000, 0, () => 1), 5_500);
    assert.equal(pollAfterMs(5_000, 60_000, () => 0.5), 60_000);
  });

  await t.test("the database being away is told apart from a bug", () => {
    for (const code of ["ECONNREFUSED", "57P01", "53300", "57014", "08006"]) assert.equal(isDatabaseDown({ code }), true);
    assert.equal(isDatabaseDown(new Error("timeout exceeded when trying to connect")), true);
    assert.equal(isDatabaseDown(new Error("Connection terminated unexpectedly")), true);
    assert.equal(isDatabaseDown(new TypeError("x is not a function")), false);
    assert.equal(isDatabaseDown({ code: "42703" }), false); // a typo in our SQL has to reach Sentry
  });

  await t.test("the way back answers with no database at all", async () => {
    const app = await withEnv({ LIVE_OFF: "jobs" });
    const res = await app.inject(URL_JOBS);
    assert.equal(res.statusCode, 410);
    assert.equal(res.json().error, "live_off");
    await app.close();
  });
});

test("live updates", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const app = buildApp({ logger: false });

  await t.test("delivery: the whole list, then nothing, then the change", async () => {
    const cook = await signedInCook();
    const id = await job(cook.family, cook.person, { title: "Her dal", stage: "understanding", progress: 0.3 });

    const first = await poll(app, cook.token);
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["cache-control"], "no-store");
    const body = first.json();
    assert.equal(body.changed, true);
    assert.equal(body.data[0]._id, id);
    assert.equal(body.data[0].stage, "understanding");
    assert.equal(body.data[0].progress, 0.3);
    assert.equal(body.data[0].title, "Her dal");

    const same = await poll(app, cook.token, body.version);
    assert.deepEqual(Object.keys(same.json()).sort(), ["changed", "pollAfterMs", "version"]);
    assert.equal(same.json().changed, false);
    assert.equal(same.json().version, body.version);

    await moveJob(id, "writing", 0.85);
    const moved = (await poll(app, cook.token, body.version)).json();
    assert.equal(moved.changed, true);
    assert.equal(moved.data[0].stage, "writing");
    assert.notEqual(moved.version, body.version);
  });

  await t.test("what a phone gets is the app's LiveJob and nothing more", async () => {
    const cook = await signedInCook();
    await job(cook.family, cook.person, { stage: "failed", progress: 0, error: "Too long." });
    await db().query("update jobs set cost_usd = 1.5, attempts = 2, result_model = 'm' where family_id = $1", [cook.family]);
    const [row] = (await poll(app, cook.token)).json().data;
    assert.deepEqual(Object.keys(row).sort(), ["_creationTime", "_id", "error", "progress", "source", "stage", "uploadPath"]);
    assert.equal(typeof row._creationTime, "number");
  });

  await t.test("the newest 20, newest first, as jobs.forFamily", async () => {
    const cook = await signedInCook();
    const ids: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const id = await job(cook.family, cook.person, { stage: "done", progress: 1 });
      await db().query("update jobs set created_at = now() - make_interval(mins => $2) where id = $1", [id, 100 - i]);
      ids.push(id);
    }
    const { data } = (await poll(app, cook.token)).json();
    assert.deepEqual(data.map((j: { _id: string }) => j._id), ids.reverse().slice(0, 20));
  });

  await t.test("the cook's stop shows at once, before a worker has acknowledged it", async () => {
    const cook = await signedInCook();
    await job(cook.family, cook.person, { stage: "understanding", progress: 0.4, cancelled: true });
    const res = (await poll(app, cook.token)).json();
    assert.equal(res.data[0].stage, "failed");
    assert.equal(res.data[0].progress, 0);
    assert.equal(res.data[0].error, "Cancelled.");
    assert.ok(res.pollAfterMs > 20_000, "a stopped job is finished");
  });

  await t.test("the rate: quick while a job moves, slow otherwise, and a dead job doesn't hold phones at the quick rate", async () => {
    const cook = await signedInCook();
    const empty = (await poll(app, cook.token)).json().pollAfterMs;
    assert.ok(empty >= 27_000 && empty <= 33_000, String(empty));
    const moving = await job(cook.family, cook.person);
    const quick = (await poll(app, cook.token)).json().pollAfterMs;
    assert.ok(quick >= 4_500 && quick <= 5_500, String(quick));
    await db().query("update jobs set updated_at = now() - interval '3 hours' where id = $1", [moving]);
    assert.ok((await poll(app, cook.token)).json().pollAfterMs >= 27_000);
    await moveJob(moving, "done", 1);
    assert.ok((await poll(app, cook.token)).json().pollAfterMs >= 27_000);
  });

  await t.test("refused: no token, a junk token, an unknown token, an expired session", async () => {
    const cook = await signedInCook();
    await job(cook.family, cook.person, { title: "Her dal" });
    const expired = await session(cook.family, cook.person, -1);
    const refusing = buildApp({ logger: false });
    for (const headers of [{}, bearer("short"), bearer("x".repeat(43)), bearer(expired)]) {
      const res = await refusing.inject({ url: URL_JOBS, headers });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, "signed_out");
      assert.doesNotMatch(res.body, /dal/);
    }
  });

  await t.test("refused: another family's jobs never show, and asking by id does nothing", async () => {
    const mine = await signedInCook();
    const theirs = await signedInCook();
    const secret = await job(theirs.family, theirs.person, { title: "Their secret masala" });
    const res = await app.inject({ url: `${URL_JOBS}?familyId=${theirs.family}&family_id=${theirs.family}&id=${secret}`, headers: bearer(mine.token) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data, []);
    assert.doesNotMatch(res.body, /masala/);
  });

  await t.test("refused: another family's change doesn't move my version", async () => {
    const mine = await signedInCook();
    const theirs = await signedInCook();
    const before = (await poll(app, mine.token)).json().version;
    const id = await job(theirs.family, theirs.person);
    await moveJob(id, "done", 1);
    const res = (await poll(app, mine.token, before)).json();
    assert.equal(res.changed, false);
  });

  await t.test("nobody else in the family sees a job while they poll: a kid or another cook", async () => {
    const cook = await signedInCook();
    const id = await job(cook.family, cook.person);
    for (const role of ["kid", "cook"] as const) {
      const res = (await poll(app, await session(cook.family, await person(cook.family, role)))).json();
      assert.deepEqual(res.data, [], role);
    }
    assert.equal((await poll(app, cook.token)).json().data[0]._id, id);
  });

  await t.test("mid-way: a session ended stops the very next poll", async () => {
    const cook = await signedInCook();
    await job(cook.family, cook.person, { title: "Her dal" });
    const held = (await poll(app, cook.token)).json().version;
    assert.equal((await poll(app, cook.token, held)).statusCode, 200);
    await db().query("delete from sessions where person_id = $1", [cook.person]);
    for (const since of [held, undefined]) {
      const res = await poll(app, cook.token, since);
      assert.equal(res.statusCode, 401);
      assert.doesNotMatch(res.body, /dal/);
    }
  });

  await t.test("mid-way: a session running out stops the very next poll", async () => {
    const cook = await signedInCook();
    assert.equal((await poll(app, cook.token)).statusCode, 200);
    await db().query("update sessions set expires_at = now() - interval '1 second' where person_id = $1", [cook.person]);
    assert.equal((await poll(app, cook.token)).statusCode, 401);
  });

  await t.test("mid-way: a deleted person stops the very next poll, even with a session left over", async () => {
    const cook = await signedInCook();
    assert.equal((await poll(app, cook.token)).statusCode, 200);
    await db().query("update people set deleted_at = now(), name = 'Deleted' where id = $1", [cook.person]);
    assert.equal((await poll(app, cook.token)).statusCode, 401);
  });

  await t.test("mid-way: someone moved to another family stops seeing the old one's", async () => {
    const cook = await signedInCook();
    const other = await family();
    await job(cook.family, cook.person, { title: "Her dal" });
    assert.equal((await poll(app, cook.token)).json().data.length, 1);
    await db().query("update people set family_id = $2 where id = $1", [cook.person, other]);
    assert.equal((await poll(app, cook.token)).statusCode, 401);
  });

  await t.test("reconnect: away through every stage, the next poll has the final state", async () => {
    const cook = await signedInCook();
    const id = await job(cook.family, cook.person, { stage: "understanding", progress: 0.3 });
    const held = (await poll(app, cook.token)).json().version;
    await moveJob(id, "writing", 0.85);
    await moveJob(id, "indexing", 0.95);
    await moveJob(id, "done", 1);
    // On another task, with what the phone last saw: nothing about this phone was in the first task's memory.
    const other = buildApp({ logger: false });
    const back = (await poll(other, cook.token, held)).json();
    assert.equal(back.changed, true);
    assert.equal(back.data[0].stage, "done");
    assert.equal(back.data[0].progress, 1);
    // A phone that restarted and remembers nothing gets it too.
    assert.equal((await poll(other, cook.token)).json().data[0].stage, "done");
    await other.close();
  });

  await t.test("a job that went back to the queue (a retry) reads as moved, not as stuck", async () => {
    const cook = await signedInCook();
    const id = await job(cook.family, cook.person, { stage: "writing", progress: 0.85 });
    const held = (await poll(app, cook.token)).json().version;
    await moveJob(id, "queued", 0);
    const back = (await poll(app, cook.token, held)).json();
    assert.equal(back.changed, true);
    assert.equal(back.data[0].progress, 0);
  });

  await t.test("a bad version is refused without detail; an old one is just old", async () => {
    const cook = await signedInCook();
    const bad = await poll(app, cook.token, encodeURIComponent("her secret masala"));
    assert.equal(bad.statusCode, 400);
    assert.doesNotMatch(bad.body, /masala/);
    assert.equal((await poll(app, cook.token, "not-a-real-version")).json().changed, true);
  });

  await t.test("the read uses the family index, and the session check its own", async () => {
    const client = await db().connect();
    const plan = async (sql: string) => {
      const { rows } = await client.query(`explain ${sql}`);
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    };
    try {
      await client.query("set enable_seqscan = off"); // a test table is too small for the planner to bother otherwise
      const jobs = await plan("select id from jobs where family_id = 'f' order by created_at desc, id desc limit 20");
      assert.match(jobs, /jobs_family_recent/);
      assert.doesNotMatch(jobs, /Sort/);
      assert.match(await plan("select id from sessions where token_hash = repeat('a', 64)"), /sessions_token_hash_key/);
    } finally {
      await client.query("reset enable_seqscan");
      client.release();
    }
  });

  await t.test("the per-person cap: 429 with how long to wait; other people carry on", async () => {
    const capped = await withEnv({ LIVE_PERSON_PER_MIN: "3" });
    const cook = await signedInCook();
    const secondPhone = await session(cook.family, cook.person);
    const someoneElse = await signedInCook();
    for (const token of [cook.token, secondPhone, cook.token]) assert.equal((await poll(capped, token)).statusCode, 200);
    for (const token of [cook.token, secondPhone]) {
      const res = await poll(capped, token);
      assert.equal(res.statusCode, 429);
      assert.equal(res.json().error, "rate_limited");
      assert.ok(Number(res.headers["retry-after"]) >= 1);
    }
    assert.equal((await poll(capped, someoneElse.token)).statusCode, 200);
    await capped.close();
  });

  await t.test("refused calls from one address stop reaching the database; a neighbor's good polls don't count against it", async () => {
    const limited = await withEnv({ LIVE_REFUSED_IP_PER_MIN: "3" });
    const cook = await signedInCook();
    const from = (remoteAddress: string, headers: Record<string, string>) => limited.inject({ url: URL_JOBS, headers, remoteAddress });
    // Good polls from this address use up nothing.
    for (let i = 0; i < 10; i += 1) assert.equal((await from("8.8.8.8", bearer(cook.token))).statusCode, 200);
    for (let i = 0; i < 3; i += 1) assert.equal((await from("8.8.8.8", bearer("x".repeat(43)))).statusCode, 401);
    let queries = 0;
    const query = t.mock.method(db(), "query", ((original) => function (this: unknown, ...args: unknown[]) {
      queries += 1;
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    })(db().query));
    const stopped = await from("8.8.8.8", bearer("x".repeat(43)));
    query.mock.restore();
    assert.equal(stopped.statusCode, 429);
    assert.equal(queries, 0);
    assert.equal((await from("9.9.9.9", bearer(cook.token))).statusCode, 200);
    await limited.close();
  });

  await t.test("a slow database: with the line for a connection full, a poll is told when to come back", async () => {
    const cook = await signedInCook();
    const held = await Promise.all(Array.from({ length: 10 }, () => db().connect()));
    const waiting = Array.from({ length: SHED_WAITING }, () => db().connect().then((client) => client.release()));
    try {
      const res = await poll(app, cook.token);
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, "unavailable");
      const wait = Number(res.headers["retry-after"]);
      assert.ok(wait >= 5 && wait <= 15, String(wait));
    } finally {
      held.forEach((client) => client.release());
      await Promise.all(waiting);
    }
    assert.equal((await poll(app, cook.token)).statusCode, 200);
  });

  await t.test("the database down: 503 and when to come back, and never an old answer", async () => {
    const cook = await signedInCook();
    const down = t.mock.method(db(), "query", async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    const res = await poll(app, cook.token);
    down.mock.restore();
    assert.equal(res.statusCode, 503);
    assert.ok(Number(res.headers["retry-after"]) >= 5);
    assert.deepEqual(Object.keys(res.json()).sort(), ["error", "message", "requestId"]);
  });

  await t.test("a bug is not called an outage: it's a 500 that reaches the main handler", async () => {
    const cook = await signedInCook();
    const bug = t.mock.method(db(), "query", async () => {
      throw Object.assign(new Error("column \"her secret masala\" does not exist"), { code: "42703" });
    });
    const res = await poll(app, cook.token);
    bug.mock.restore();
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error, "server_error");
    assert.doesNotMatch(res.body, /masala/);
  });

  await t.test("Postgres dropping idle connections doesn't end the process, and the next poll works", async () => {
    const cook = await signedInCook();
    await Promise.all(Array.from({ length: 5 }, () => db().query("select pg_sleep(0.02)"))); // leaves several idle
    await db().query(
      "select pg_terminate_backend(pid) from pg_stat_activity where pid <> pg_backend_pid() and datname = current_database()",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await poll(app, cook.token)).statusCode, 200);
  });

  await t.test("the floor is a setting, for slowing every phone with no release", async () => {
    const slowed = await withEnv({ LIVE_POLL_FLOOR_MS: "120000" });
    const cook = await signedInCook();
    await job(cook.family, cook.person);
    assert.ok((await poll(slowed, cook.token)).json().pollAfterMs >= 108_000);
    await slowed.close();
  });

  await t.test("logs carry counts, and no token, title, error text or id", async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, done) { lines.push(chunk.toString()); done(); } });
    const logged = buildApp({ logger: { stream, level: "info" } });
    const cook = await signedInCook();
    await job(cook.family, cook.person, { title: "Her secret masala", error: "Her grandmother's name" });
    await poll(logged, cook.token);
    await logged.inject({ url: URL_JOBS, headers: bearer("x".repeat(43)) });
    await logged.close();
    const output = lines.join("");
    const stats = lines.map((line) => JSON.parse(line)).find((line) => line.live);
    assert.deepEqual(stats.live, { polls: 2, changed: 1, refused: 1, limited: 0, shed: 0, failed: 0 });
    assert.doesNotMatch(output, /masala|grandmother|xxxxxxxx/);
    assert.ok(!output.includes(cook.token));
    assert.ok(!output.includes(cook.family));
    assert.ok(!output.includes(cook.person));
    assert.doesNotMatch(output, /request completed/); // a line per poll would be most of the logs
  });

  await t.test("a server error on a poll still logs at error, by type only", async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, done) { lines.push(chunk.toString()); done(); } });
    const logged = buildApp({ logger: { stream, level: "info" } });
    const cook = await signedInCook();
    const bug = t.mock.method(db(), "query", async () => {
      throw Object.assign(new Error("Key (name)=(her secret masala) already exists"), { code: "23505" });
    });
    await poll(logged, cook.token);
    bug.mock.restore();
    await logged.close();
    const output = lines.join("");
    assert.match(output, /23505/);
    assert.doesNotMatch(output, /masala/);
  });

  await t.test("many phones on a real socket: each family sees its own change, and the pool stays at 10", async () => {
    const server = buildApp({ logger: false });
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const families = await Promise.all(Array.from({ length: 30 }, () => signedInCook()));
    const jobs = await Promise.all(families.map((cook) => job(cook.family, cook.person)));
    const phones: { family: number; token: string; version: string }[] = [];
    for (const [i, cook] of families.entries()) {
      for (let n = 0; n < 10; n += 1) phones.push({ family: i, token: await session(cook.family, cook.person), version: "" });
    }
    let shed = 0;
    let peak = 0;
    const ask = async (phone: (typeof phones)[number]) => {
      for (;;) {
        const res = await fetch(`http://127.0.0.1:${port}${URL_JOBS}?since=${phone.version}`, { headers: bearer(phone.token) });
        peak = Math.max(peak, db().totalCount);
        if (res.status === 503) {
          // As a phone does, only sooner: the storm of all 300 at once is the point of this test.
          shed += 1;
          await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 100));
          continue;
        }
        assert.equal(res.status, 200);
        const body = await res.json() as { changed: boolean; version: string };
        const changed = body.changed;
        phone.version = body.version;
        return changed;
      }
    };
    assert.deepEqual([...new Set(await Promise.all(phones.map(ask)))], [true]);
    assert.deepEqual([...new Set(await Promise.all(phones.map(ask)))], [false]);

    await moveJob(jobs[7], "done", 1);
    const seen = await Promise.all(phones.map(ask));
    phones.forEach((phone, i) => assert.equal(seen[i], phone.family === 7, `phone ${i}`));
    assert.ok(peak <= 10, `pool reached ${peak}`);
    t.diagnostic(`300 phones at once, three rounds: ${shed} polls told to wait, pool peak ${peak}`);
    await server.close();
  });

  await t.test("a graceful stop: open and idle connections don't hold it up, and another task carries on with the same version", async () => {
    const cook = await signedInCook();
    const id = await job(cook.family, cook.person);
    const first = buildApp({ logger: false });
    await first.listen({ host: "127.0.0.1", port: 0 });
    const { port } = first.server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: true });
    const get = (since = "") =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, agent, path: `${URL_JOBS}?since=${since}`, headers: bearer(cook.token) }, (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode!, body }));
        });
        req.on("error", reject);
      });

    const { version } = JSON.parse((await get()).body); // leaves a kept-alive connection, as the load balancer holds
    assert.equal(agent.freeSockets[Object.keys(agent.freeSockets)[0]]?.length, 1);

    // Really in flight: the task has these polls and is waiting on the database when the stop comes.
    const held = await Promise.all(Array.from({ length: 10 }, () => db().connect()));
    const inFlight = Array.from({ length: 10 }, () => get(version).then((res) => res.status, () => 0));
    while (db().waitingCount < 10) await new Promise((resolve) => setTimeout(resolve, 5));
    const started = Date.now();
    const closed = first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    held.forEach((client) => client.release());
    assert.deepEqual([...new Set(await Promise.all(inFlight))], [200]); // every one finished, none dropped
    await closed; // and the kept-alive connection didn't hold the stop up
    const tookMs = Date.now() - started;
    assert.ok(tookMs < 3_000, `took ${tookMs} ms`);
    t.diagnostic(`stopped in ${tookMs} ms with 10 polls in flight and an idle connection open`);
    await assert.rejects(get(version)); // no longer listening: a phone retries, and the load balancer sends it elsewhere
    agent.destroy();

    await moveJob(id, "done", 1);
    const second = buildApp({ logger: false });
    const back = (await poll(second, cook.token, version)).json();
    assert.equal(back.changed, true);
    assert.equal(back.data[0].stage, "done");
    await second.close();
  });

  await app.close();
});

after(async () => {
  if (hasDatabase) await db().end();
});

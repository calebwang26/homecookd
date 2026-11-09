// The invariant sweep (api/src/modules/platform/invariants.ts) against real Postgres: each "must never be true" state is counted and named, and the healthy
// row just beside it is not. The log lines are what infra/modules/env/invariants.tf's metric filters read, so their shape is checked too.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { checkInvariants, IDS_PER_RUN, INVARIANTS, RAN, type Invariant } from "../src/modules/platform/invariants.js";
import { freshDatabase, hasDatabase, makeFamily, makePerson, setup } from "./accountsHelpers.js";

const skip = !hasDatabase;

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
});

after(async () => {
  if (!skip) await db().end();
});

type Line = Record<string, unknown> & { msg: string; level: number };

function traced() {
  const lines: Line[] = [];
  const at = (level: number) => (fields: object, msg: string) => void lines.push({ ...fields, msg, level });
  const log = { info: at(30), warn: at(40), error: at(50) };
  return { trace: { log } as never, lines };
}

const one = async (sql: string, args: unknown[] = []) => (await db().query(sql, args)).rows[0].id as string;
const hex = `md5(random()::text) || md5(random()::text)`;

async function world() {
  const f = await makeFamily("The Invariants");
  const cook = await makePerson(f.id, "Mom");
  const kid = await makePerson(f.id, "Leo", "kid");
  const job = (stage: string, extra: string) =>
    one(`insert into jobs (family_id, cook_id, upload_key, source, stage, ${extra.split("=")[0]}) values ($1, $2, 'up/', 'phone', $3, ${extra.split("=")[1]}) returning id`, [
      f.id,
      cook,
      stage,
    ]);
  const ask = (started: string, merged: string) =>
    one(
      `insert into dish_asks (kid_token_hash, ask_token_hash, dish, relation, guess, message, status, merge_started_at, merged_at)
       values (${hex}, ${hex}, 'dal', 'mom', '{}'::jsonb, 'hi', 'answered', ${started}, ${merged}) returning id`,
    );
  const deletion = async (purged: string, requested: string, attempts: number, external: string) => {
    const who = await makePerson(f.id);
    return one(
      `insert into account_deletions (family_id, person_id, purged_at, requested_at, external_attempts, external_purged_at)
       values ($1, $2, ${purged}, ${requested}, $3, ${external}) returning id`,
      [f.id, who, attempts],
    );
  };
  const outbox = (attempts: number, sent: string) =>
    one(`insert into outbox (queue, payload, attempts, sent_at) values ('scheduled', '{}'::jsonb, $1, ${sent}) returning id::text as id`, [attempts]);
  const recipe = (status: string, shared: string) =>
    one(`insert into recipes (family_id, cook_id, title, status, shared_at) values ($1, $2, 'Dal', $3, ${shared}) returning id`, [f.id, cook, status]);
  const dinner = async (status: string, seats: number, accepted: number) => {
    const id = await one(
      `insert into dinners (host_id, host_family_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status)
       values ($1, $2, 'Dal', now() + interval '2 days', 'home', 'Home', '1 Made-up St', 37.87, -122.27, $3, $4) returning id`,
      [cook, f.id, seats, status],
    );
    for (let i = 0; i < accepted; i += 1) {
      const g = await makeFamily(`Guests ${i}`);
      const guest = await makePerson(g.id);
      await db().query(`insert into dinner_requests (dinner_id, guest_id, guest_family_id, status) values ($1, $2, $3, 'accepted')`, [id, guest, g.id]);
    }
    return id;
  };
  return { f, cook, kid, job, ask, deletion, outbox, recipe, dinner };
}

test("each invariant counts and names its violating rows, never the healthy row beside it", { skip }, async () => {
  const w = await world();
  const bad: Record<string, string[]> = {};

  // A queued job nobody will wake, beside one with a wake-up owed and one only an hour old.
  bad.job_queued_no_wakeup = [await w.job("queued", "updated_at=now() - interval '4 hours'")];
  const owed = await w.job("queued", "updated_at=now() - interval '4 hours'");
  await db().query(`insert into outbox (queue, payload) values ('jobs', $1::jsonb)`, [JSON.stringify({ jobId: owed })]);
  await w.job("queued", "updated_at=now() - interval '1 hour'");

  // A run whose heartbeat stopped 20 minutes ago, beside one 5 minutes ago.
  bad.job_running_stale = [await w.job("writing", "heartbeat_at=now() - interval '20 minutes'")];
  await w.job("writing", "heartbeat_at=now() - interval '5 minutes'");

  bad.push_queued_stale = [await one(`insert into push_log (person_id, kind, status, send_at) values ($1, 'message', 'queued', now() - interval '2 hours') returning id`, [w.kid])];
  await db().query(`insert into push_log (person_id, kind, status, send_at) values ($1, 'message', 'queued', now() - interval '10 minutes')`, [w.kid]);
  await db().query(`insert into push_log (person_id, kind, status, send_at) values ($1, 'message', 'sent', now() - interval '2 hours')`, [w.kid]);

  bad.dish_merge_stuck = [await w.ask("now() - interval '20 minutes'", "null")];
  await w.ask("now() - interval '20 minutes'", "now() - interval '15 minutes'");
  await w.ask("now() - interval '2 minutes'", "null");

  bad.deletion_stalled = [
    await w.deletion("null", "now() - interval '2 hours'", 0, "null"),
    await w.deletion("now()", "now() - interval '2 days'", 10, "null"),
  ];
  await w.deletion("null", "now() - interval '10 minutes'", 0, "null");
  await w.deletion("now()", "now() - interval '2 days'", 3, "null");
  await w.deletion("now()", "now() - interval '2 days'", 10, "now()");

  bad.outbox_stuck = [await w.outbox(5, "null")];
  await w.outbox(4, "null");
  await w.outbox(7, "now()");

  bad.recipe_shared_not_ready = [await w.recipe("processing", "now()")];
  await w.recipe("ready", "now()");
  await w.recipe("processing", "null");

  bad.dinner_full_with_seats = [await w.dinner("full", 2, 1)];
  await w.dinner("full", 1, 1);
  await w.dinner("open", 3, 0);

  const { trace, lines } = traced();
  const counts = await checkInvariants(trace);
  for (const inv of INVARIANTS) {
    assert.equal(counts[inv.name], bad[inv.name].length, inv.name);
    const named = lines.filter((l) => l.msg === `INVARIANT ${inv.name}`);
    assert.deepEqual(named.map((l) => l.id).sort(), [...bad[inv.name]].sort(), inv.name);
    assert.ok(named.every((l) => l.level === 50 && l.owner), inv.name);
    const summary = lines.filter((l) => l.msg === "invariant checked" && l.invariant === inv.name);
    assert.deepEqual(summary.map((l) => [l.count, l.level]), [[bad[inv.name].length, 30]], `${inv.name}: one summary line, for the metric`);
  }
  assert.deepEqual(lines.filter((l) => l.invariant === RAN).map((l) => [l.msg, l.count]), [["invariant checked", 1]]);
  const text = JSON.stringify(lines);
  for (const name of ["Mom", "Leo", "Invariants", "Made-up", "Dal"]) assert.ok(!text.includes(name), `no names or content: ${name}`);
});

test("a run with nothing wrong still writes every count, at 0, so the alarms always have data", { skip }, async () => {
  await freshDatabase();
  await setup();
  const { trace, lines } = traced();
  const counts = await checkInvariants(trace);
  assert.deepEqual(Object.values(counts), INVARIANTS.map(() => 0));
  assert.equal(lines.filter((l) => l.msg === "invariant checked").length, INVARIANTS.length + 1);
  assert.equal(lines.filter((l) => l.level >= 50).length, 0);
});

test("a long list names the first rows only, with the whole count; a broken query is reported and the rest still run", { skip }, async () => {
  await freshDatabase();
  await setup();
  const w = await world();
  for (let i = 0; i < IDS_PER_RUN + 5; i += 1) await w.outbox(9, "null");
  const broken: Invariant = { name: "broken", owner: "AWS backend", sql: "select id from no_such_table", args: [] };
  const outbox = INVARIANTS.find((i) => i.name === "outbox_stuck")!;
  const { trace, lines } = traced();
  const counts = await checkInvariants(trace, [broken, outbox]);
  assert.deepEqual(counts, { outbox_stuck: IDS_PER_RUN + 5 });
  assert.equal(lines.filter((l) => l.msg === "INVARIANT outbox_stuck").length, IDS_PER_RUN);
  assert.deepEqual(lines.filter((l) => l.invariant === "broken").map((l) => l.msg), ["invariant query failed"], "no summary line: its metric goes quiet, never a false 0");
});

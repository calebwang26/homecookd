// An account deletion's stages (api/src/modules/accounts/deletion.ts, docs/agents/STATE-MACHINES.md row 8) on real Postgres: every stage × every event, the CHECK
// that refuses the stages that can't be, and the team's command (api/src/deletions.ts). Caleb, Nov 8 (decision 7): a deletion that gave up can be restarted by the
// team. Made-up people only. accountDeletion.test.ts covers what each purge deletes; this covers how a deletion moves.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { run, parse } from "../src/deletions.js";
import { MAX_OUTSIDE_ATTEMPTS, purgeOutside, retryDeletion, runPurge, stageOf, startDeletion, useVoiceClones } from "../src/modules/accounts/deletion.js";
import { accountsSweep } from "../src/modules/accounts/tasks.js";
import { checkInvariants, INVARIANTS } from "../src/modules/platform/invariants.js";
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

const EVENTS = ["pass", "sweep", "attempt_ok", "attempt_fails", "retry"] as const;
type Event = (typeof EVENTS)[number];

/** Where each event takes each situation, and what it queues. An event left out changes nothing and queues nothing. */
type To = { stage: string; queues?: "accounts.purge" | "accounts.outside"; check?: (row: Row) => void };
const SITUATIONS: { name: string; set: string; to: Partial<Record<Event, To>> }[] = [
  {
    name: "purging",
    set: "purge_run_at = now()",
    to: { pass: { stage: "outside", queues: "accounts.outside" }, retry: { stage: "purging", queues: "accounts.purge" } },
  },
  {
    name: "purging, no batch for 40 min",
    set: "purge_run_at = now() - interval '40 minutes', requested_at = now() - interval '2 hours'",
    to: {
      pass: { stage: "outside", queues: "accounts.outside" },
      sweep: { stage: "purging", queues: "accounts.purge", check: (r) => assert.equal(r.purge_restarts, 1, "a restart is counted") },
      retry: { stage: "purging", queues: "accounts.purge" },
    },
  },
  {
    name: "outside, due",
    set: "purged_at = now() - interval '1 hour'",
    to: {
      sweep: { stage: "outside", queues: "accounts.outside" },
      attempt_ok: { stage: "done", check: (r) => assert.equal(r.voice_clone_id, null, "her voice clone is gone") },
      attempt_fails: { stage: "outside", check: (r) => assert.deepEqual([r.external_attempts, r.external_error], [1, "Cartesia: HTTP 503"]) },
      retry: { stage: "outside", queues: "accounts.outside" },
    },
  },
  {
    name: "outside, waiting after 2 tries",
    set: "purged_at = now() - interval '1 hour', external_attempts = 2, external_tried_at = now()",
    to: {
      attempt_ok: { stage: "done" },
      attempt_fails: { stage: "outside", check: (r) => assert.equal(r.external_attempts, 3) },
      retry: { stage: "outside", queues: "accounts.outside", check: (r) => assert.deepEqual([r.external_attempts, r.external_tried_at], [0, null], "a fresh count, due now") },
    },
  },
  {
    name: "outside, one attempt left",
    set: `purged_at = now() - interval '3 days', external_attempts = ${MAX_OUTSIDE_ATTEMPTS - 1}, external_tried_at = now() - interval '2 days'`,
    to: {
      sweep: { stage: "outside", queues: "accounts.outside" },
      attempt_ok: { stage: "done" },
      attempt_fails: { stage: "gave_up", check: (r) => assert.equal(r.external_attempts, MAX_OUTSIDE_ATTEMPTS) },
      retry: { stage: "outside", queues: "accounts.outside", check: (r) => assert.equal(r.external_attempts, 0) },
    },
  },
  {
    name: "outside, another run holding it",
    set: "purged_at = now() - interval '1 hour', external_attempts = 1, external_tried_at = now() - interval '2 hours', external_claimed_until = now() + interval '5 minutes'",
    to: {
      sweep: { stage: "outside", queues: "accounts.outside" },
      retry: { stage: "outside", queues: "accounts.outside", check: (r) => assert.ok(r.external_claimed_until, "the run that has it keeps it") },
    },
  },
  {
    name: "gave up",
    set: `purged_at = now() - interval '3 days', external_attempts = ${MAX_OUTSIDE_ATTEMPTS}, external_tried_at = now(), external_gave_up_at = now(), external_error = 'Cartesia: HTTP 503'`,
    to: {
      // A stray message still finishes it; one that fails leaves it given up.
      attempt_ok: { stage: "done", check: (r) => assert.equal(r.external_gave_up_at, null) },
      attempt_fails: { stage: "gave_up", check: (r) => assert.equal(r.external_attempts, MAX_OUTSIDE_ATTEMPTS + 1) },
      retry: { stage: "outside", queues: "accounts.outside", check: (r) => assert.deepEqual([r.external_attempts, r.external_gave_up_at], [0, null]) },
    },
  },
  { name: "done", set: "purged_at = now() - interval '1 day', external_purged_at = now()", to: {} },
  {
    name: "done 61 days ago",
    set: "purged_at = now() - interval '61 days', external_purged_at = now() - interval '61 days'",
    to: { sweep: { stage: "done", check: (r) => assert.ok(r.lists_cleared_at, "C5: its lists clear, the row stays") } },
  },
  { name: "done, lists cleared", set: "purged_at = now() - interval '90 days', external_purged_at = now() - interval '90 days', lists_cleared_at = now()", to: {} },
];

type Row = Record<string, unknown> & { external_attempts: number };

const row = async (id: string): Promise<Row> => (await db().query(`select * from account_deletions where id = $1`, [id])).rows[0];
const queued = async (id: string) =>
  (await db().query(`select payload->>'task' as task from outbox where sent_at is null and payload->>'deletionId' = $1 order by id`, [id])).rows.map((r) => r.task as string);

let failing = false;
const fire = async (e: Event, id: string) => {
  failing = e === "attempt_fails";
  if (e === "pass") await runPurge(id, {});
  if (e === "sweep") await accountsSweep({});
  if (e === "attempt_ok" || e === "attempt_fails") await purgeOutside(id);
  if (e === "retry") await retryDeletion(id);
};

test("every deletion stage × every event, on real Postgres", { skip }, async () => {
  useVoiceClones({
    remove: async () => {
      if (failing) throw new Error("HTTP 503");
    },
  });
  const f = await makeFamily();
  for (const s of SITUATIONS) {
    for (const e of EVENTS) {
      await db().query(`truncate account_deletions, outbox cascade`);
      const person = await makePerson(f.id);
      await db().query(`update people set cartesia_voice_id = 'voice_x' where id = $1`, [person]);
      const id = (await startDeletion(person, "person"))!;
      await db().query(`delete from outbox`);
      await db().query(`update account_deletions set ${s.set} where id = $1`, [id]);
      const before = await row(id);
      await fire(e, id);
      const now = await row(id);
      const at = `${s.name} + ${e}`;
      const to = s.to[e];
      if (!to) {
        assert.deepEqual(now, before, `${at}: nothing changes`);
        assert.deepEqual(await queued(id), [], `${at}: nothing queued`);
        continue;
      }
      assert.equal(stageOf(now as never), to.stage, at);
      assert.deepEqual(await queued(id), to.queues ? [to.queues] : [], `${at}: queued`);
      to.check?.(now);
    }
  }
});

test("the database refuses the stages that can't be", { skip }, async () => {
  const f = await makeFamily();
  const id = (await startDeletion(await makePerson(f.id), "person"))!;
  const refused = async (set: string) => {
    await assert.rejects(db().query(`update account_deletions set ${set} where id = $1`, [id]), (e: { code?: string }) => e.code === "23514", set);
  };
  await refused("external_purged_at = now()"); // outside done before inside
  await refused("external_gave_up_at = now()"); // given up before the outside purge began
  await refused("purged_at = now(), external_purged_at = now(), external_gave_up_at = now()"); // given up and done
  await refused("purged_at = now(), lists_cleared_at = now()"); // lists cleared before done
  await refused("external_attempts = -1");
});

test("the team's command: stalled lists what stopped, retry starts it again; a typo touches nothing", { skip }, async () => {
  useVoiceClones({ remove: async () => {} });
  await db().query(`truncate account_deletions, outbox cascade`);
  const f = await makeFamily();
  const stopped = (await startDeletion(await makePerson(f.id), "person"))!;
  await db().query(`update account_deletions set requested_at = now() - interval '2 hours', purge_run_at = now() - interval '2 hours' where id = $1`, [stopped]);
  const gaveUp = (await startDeletion(await makePerson(f.id), "person"))!;
  await db().query(
    `update account_deletions set purged_at = now(), external_attempts = $2, external_tried_at = now(), external_gave_up_at = now(), external_error = 'S3 uploads: AccessDenied' where id = $1`,
    [gaveUp, MAX_OUTSIDE_ATTEMPTS],
  );
  const fine = (await startDeletion(await makePerson(f.id, "KEEP-NAME"), "person"))!;
  // A long purge still batching two hours on: not stopped, for the list as for the alarm (deletion_stalled reads the same STALLED).
  const busy = (await startDeletion(await makePerson(f.id), "person"))!;
  await db().query(`update account_deletions set requested_at = now() - interval '2 hours', purge_run_at = now() - interval '5 minutes' where id = $1`, [busy]);
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) } };
  };

  const a = io();
  assert.equal(await run(["stalled"], a.io), 0);
  const listed = a.out.filter((l) => l.startsWith('{"id"')).map((l) => JSON.parse(l));
  assert.deepEqual(listed.map((d) => [d.id, d.stage]).sort(), [[stopped, "purging"], [gaveUp, "gave_up"]].sort());
  assert.equal(listed.find((d) => d.id === gaveUp).outsideError, "S3 uploads: AccessDenied");
  assert.ok(!a.out.join("\n").includes(fine) && !a.out.join("\n").includes("KEEP-NAME"), "only what stopped, and never a name");
  assert.ok(!a.out.join("\n").includes(busy), "a purge still batching hasn't stopped");
  const only = INVARIANTS.filter((i) => i.name === "deletion_stalled");
  const named: string[] = [];
  await checkInvariants({ log: { info: () => {}, warn: () => {}, error: (o: { id?: string }) => void (o.id && named.push(o.id)) } } as never, only);
  assert.deepEqual(named.sort(), [stopped, gaveUp].sort(), "the alarm names exactly what the list does");

  const b = io();
  assert.equal(await run(["retry", gaveUp], b.io), 0);
  assert.match(b.out[0], /starts again now, with a fresh count/);
  assert.equal(await purgeOutside(gaveUp), "done");
  const c = io();
  assert.equal(await run(["retry", gaveUp], c.io), 0, "a second run is fine");
  assert.match(c.out[0], /already done/);
  assert.equal(await run(["retry", stopped], io().io), 0);
  const d = io();
  assert.equal(await run(["retry", "no-such-deletion"], d.io), 1);
  assert.match(d.err[0], /^Refused: there's no deletion/);

  for (const args of [[], ["stalled", "x"], ["retry"], ["retry", "a b"], ["retry", "x", "y"], ["Retry", "x"], ["delete", "x"]]) {
    const e = io();
    assert.equal(await run(args, e.io), 2, JSON.stringify(args));
    assert.equal(typeof parse(args), "string");
  }
});

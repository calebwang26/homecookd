// A dinner's machine (api/src/modules/community/dinners.ts, docs/agents/STATE-MACHINES.md row 11) on real Postgres: every situation × every event, through the real
// routes, the real account hooks and the team's real review. Caleb, Nov 8 (decision 5): a dinner goes back to open when an accepted guest leaves, and the team can
// undo a takedown. Made-up families only.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, tx } from "../src/db.js";
import { cancelDinnersOfLeaver, purgeCommunityForPerson } from "../src/modules/community/account.js";
import { reviewReport } from "../src/modules/community/reports.js";
import { checkInvariants, INVARIANTS } from "../src/modules/platform/invariants.js";
import { run } from "../src/reports.js";
import { family, host, ok, person, recipe, report, respond, type Who, world } from "./communityHelpers.js";
import { hasDatabase, silent } from "./dishHelpers.js";

const skip = !hasDatabase;
after(async () => {
  if (hasDatabase) await db().end();
});

const EVENTS = ["yes", "no", "guest_deletes", "guest_leaves", "remove", "keep"] as const;
type Event = (typeof EVENTS)[number];

type Situation = {
  name: string;
  /** Accepted guests (the dinner has 2 seats), and SQL run on the dinner afterwards (`d` is its id). */
  accepted: number;
  set?: string;
  /** The status after each event, and whether it's then hidden / taken down. An event left out changes nothing. */
  to: Partial<Record<Event, { status: string; hidden?: boolean; takenDown?: boolean }>>;
};

const SITUATIONS: Situation[] = [
  {
    name: "open, no guests",
    accepted: 0,
    to: { remove: { status: "cancelled", hidden: true, takenDown: true }, guest_deletes: { status: "open" }, guest_leaves: { status: "open" } },
  },
  {
    name: "open, one of two seats taken",
    accepted: 1,
    to: { yes: { status: "full" }, remove: { status: "cancelled", hidden: true, takenDown: true }, guest_deletes: { status: "open" }, guest_leaves: { status: "open" } },
  },
  {
    name: "full",
    accepted: 2,
    to: { guest_deletes: { status: "open" }, guest_leaves: { status: "open" }, remove: { status: "cancelled", hidden: true, takenDown: true } },
  },
  {
    name: "full with a seat free (before decision 5)",
    accepted: 1,
    set: "status = 'full'",
    to: { yes: { status: "full" }, guest_deletes: { status: "open" }, guest_leaves: { status: "open" }, remove: { status: "cancelled", hidden: true, takenDown: true } },
  },
  {
    name: "full, started",
    accepted: 2,
    set: "starts_at = now() - interval '1 minute'",
    // Its guests' asks stay when they leave: it's what happened. A deletion takes them, and the seat frees.
    to: { guest_deletes: { status: "open" }, remove: { status: "cancelled", hidden: true, takenDown: true } },
  },
  {
    name: "called off by its host leaving",
    accepted: 1,
    set: "status = 'cancelled'",
    to: { remove: { status: "cancelled", hidden: true, takenDown: false }, guest_deletes: { status: "cancelled" }, guest_leaves: { status: "cancelled" } },
  },
  {
    name: "taken down by the team, ahead",
    accepted: 2,
    set: "status = 'cancelled', hidden_at = now(), taken_down_at = now()",
    to: { keep: { status: "full", hidden: false, takenDown: false }, guest_deletes: { status: "cancelled" }, guest_leaves: { status: "cancelled" } },
  },
  {
    name: "taken down by the team, one seat taken",
    accepted: 1,
    set: "status = 'cancelled', hidden_at = now(), taken_down_at = now()",
    to: { keep: { status: "open", hidden: false, takenDown: false }, guest_deletes: { status: "cancelled" }, guest_leaves: { status: "cancelled" } },
  },
  {
    name: "taken down by the team, started since",
    accepted: 1,
    set: "status = 'cancelled', hidden_at = now(), taken_down_at = now(), starts_at = now() - interval '1 minute'",
    to: { guest_deletes: { status: "cancelled" } },
  },
  {
    name: "taken down by the team, its host gone since",
    accepted: 1,
    set: "status = 'cancelled', hidden_at = now(), taken_down_at = now()",
    to: { guest_deletes: { status: "cancelled" }, guest_leaves: { status: "cancelled" } },
  },
  {
    name: "hidden by two families' reports",
    accepted: 1,
    set: "hidden_at = now()",
    to: { keep: { status: "open", hidden: false }, yes: { status: "full", hidden: true }, remove: { status: "cancelled", hidden: true, takenDown: true }, guest_deletes: { status: "open", hidden: true }, guest_leaves: { status: "open", hidden: true } },
  },
];

const dinnerRow = async (id: string) =>
  (await db().query(`select status, hidden_at is not null as hidden, taken_down_at is not null as "takenDown", starts_at from dinners where id = $1`, [id])).rows[0];
const asks = async (id: string) => (await db().query(`select guest_id, status from dinner_requests where dinner_id = $1 order by guest_id`, [id])).rows;

async function guest(dinnerId: string, status: "pending" | "accepted"): Promise<Who> {
  const g = await person(await family(`Guests ${Math.random()}`), "Guest", "kid");
  await db().query(`insert into dinner_requests (dinner_id, guest_id, guest_family_id, status) values ($1, $2, $3, $4)`, [dinnerId, g.personId, g.familyId, status]);
  return g;
}

test("every dinner situation × every event, on real Postgres", { skip }, async () => {
  for (const s of SITUATIONS) {
    for (const e of EVENTS) {
      const w = await world();
      const dish = await recipe(w.rajani, { sharedAt: 1 });
      const d = await host(w.t, w.rajani, dish, { seats: 2 });
      const accepted: Who[] = [];
      for (let i = 0; i < s.accepted; i += 1) accepted.push(await guest(d, "accepted"));
      const pending = await guest(d, "pending");
      if (s.set) await db().query(`update dinners set ${s.set} where id = $1`, [d]);
      if (s.name.includes("host gone")) await db().query(`update people set removed_at = now() where id = $1`, [w.rajani.personId]);
      const before = { dinner: await dinnerRow(d), asks: await asks(d) };
      // The guest an event is about: the first accepted one, else the one waiting.
      const who = accepted[0] ?? pending;

      if (e === "yes" || e === "no") await respond(w.t, w.rajani, (await db().query(`select id from dinner_requests where guest_id = $1`, [pending.personId])).rows[0].id, e === "yes");
      if (e === "guest_deletes") await purgeCommunityForPerson(who.personId, who.familyId);
      if (e === "guest_leaves") await tx((c) => cancelDinnersOfLeaver(c, who.personId));
      if (e === "remove" || e === "keep") await reviewReport("dinner", d, e === "keep");

      const now = await dinnerRow(d);
      const at = `${s.name} + ${e}`;
      const to = s.to[e];
      if (!to) {
        assert.deepEqual(now, before.dinner, `${at}: the dinner doesn't change`);
        continue;
      }
      assert.equal(now.status, to.status, at);
      if (to.hidden !== undefined) assert.equal(now.hidden, to.hidden, `${at}: hidden`);
      if (to.takenDown !== undefined) assert.equal(now.takenDown, to.takenDown, `${at}: taken down`);
      if (e === "guest_deletes" || e === "guest_leaves") {
        const gone = !(await asks(d)).some((a) => a.guest_id === who.personId);
        assert.equal(gone, e === "guest_deletes" || now.starts_at > new Date(), `${at}: their ask goes, unless they left a dinner that has started`);
      }
      // Whatever happened, a full dinner has every seat taken.
      if (now.status === "full") assert.equal((await asks(d)).filter((a) => a.status === "accepted").length, 2, `${at}: full means full`);
    }
  }
});

test("the invariant sweep finds no full dinner with a seat free after a guest goes", { skip }, async () => {
  const w = await world();
  const d = await host(w.t, w.rajani, await recipe(w.rajani, { sharedAt: 1 }), { seats: 1 });
  const g = await guest(d, "pending");
  await respond(w.t, w.rajani, (await db().query(`select id from dinner_requests where dinner_id = $1`, [d])).rows[0].id, true);
  assert.equal((await dinnerRow(d)).status, "full");
  await purgeCommunityForPerson(g.personId, g.familyId);
  const only = INVARIANTS.filter((i) => i.name === "dinner_full_with_seats");
  assert.deepEqual(await checkInvariants({ log: silent } as never, only), { dinner_full_with_seats: 0 });
  assert.equal((await dinnerRow(d)).status, "open");
});

test("the team's keep brings back a dinner it took down, and says so; too late, it's refused and nothing changes", { skip }, async () => {
  const w = await world();
  const dish = await recipe(w.rajani, { sharedAt: 1 });
  const d = await host(w.t, w.rajani, dish, { seats: 3 });
  await guest(d, "accepted");
  for (const who of [w.serene, w.caleb]) await ok(report(w.t, who, "dinner", d, "other"));
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) };
  assert.equal(await run(["review", "dinner", d, "remove"], io), 0);
  assert.deepEqual(await dinnerRow(d).then((r) => [r.status, r.hidden, r.takenDown]), ["cancelled", true, true]);

  out.length = 0;
  assert.equal(await run(["review", "dinner", d, "keep"], io), 0, "no open report is needed to undo the team's own takedown");
  assert.equal(out[0], `Brought dinner ${d} back: it's open again, and shows on Community as before.`);
  assert.deepEqual(await dinnerRow(d).then((r) => [r.status, r.hidden, r.takenDown]), ["open", false, false]);

  // Taken down again, then it starts: too late.
  assert.equal(await reviewReport("dinner", d, false), 0);
  await db().query(`update dinners set starts_at = now() - interval '1 minute' where id = $1`, [d]);
  err.length = 0;
  assert.equal(await run(["review", "dinner", d, "keep"], io), 1);
  assert.match(err[0], /^Refused: dinner .* was taken down and can't come back/);
  assert.deepEqual(await dinnerRow(d).then((r) => [r.status, r.hidden]), ["cancelled", true]);

  // A dinner nobody took down and nobody reported is still refused, as before.
  const other = await host(w.t, w.rajani, dish);
  err.length = 0;
  assert.equal(await run(["review", "dinner", other, "keep"], io), 1);
  assert.match(err[0], /has no open report/);
});

test("the database refuses a takedown on a dinner that's showing or not called off", { skip }, async () => {
  const w = await world();
  const d = await host(w.t, w.rajani, await recipe(w.rajani, { sharedAt: 1 }));
  for (const set of ["taken_down_at = now()", "taken_down_at = now(), status = 'cancelled'", "taken_down_at = now(), hidden_at = now()"]) {
    await assert.rejects(db().query(`update dinners set ${set} where id = $1`, [d]), (e: { code?: string }) => e.code === "23514", set);
  }
});

test("a host's yes and the guest's purge on the same ask at once: neither deadlocks, and the dinner is never full with a seat free", { skip }, async () => {
  const w = await world();
  const dish = await recipe(w.rajani, { sharedAt: 1 });
  for (let i = 0; i < 15; i += 1) {
    const d = await host(w.t, w.rajani, dish, { seats: 1 });
    const g = await guest(d, "pending");
    const ask = (await db().query(`select id from dinner_requests where dinner_id = $1`, [d])).rows[0].id;
    const [answer] = await Promise.all([respond(w.t, w.rajani, ask, true), purgeCommunityForPerson(g.personId, g.familyId)]);
    assert.ok([200, 404].includes(answer.status), `the yes lands first, or finds the ask gone (${answer.status})`);
    assert.deepEqual(await asks(d), [], "the ask went with its guest");
    assert.equal((await dinnerRow(d)).status, "open");
  }
});

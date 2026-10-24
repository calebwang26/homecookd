// Offline checks for supabase/functions/api/tablePr.ts (PR 5): the table_activity rows, the library
// fallback for older events (current cooks only) and for delivered recordings, how far back history
// loads, whose zone frames the table, GET /table with a stand-in for the RPC, the cache, and the
// Sunday nudge job (quoting only this family's own recordings), alone and through retention's
// /cron/hourly with notify() and a fake Expo. No database and no network: a tiny in-memory Supabase client stands in.
// The SQL itself is pinned by table_activity_sql_test.ts (PGlite); the live checks are C1-C2 in
// RETENTION-WIRING.md's PR 5 wiring.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/tablePr_test.ts

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";

import * as R from "../functions/api/retention.ts";
import {
  type ActivityRow,
  HISTORY_WEEKS,
  makeTable,
  needsMoreHistory,
  parseActivity,
  toActivity,
  viewerTz,
} from "../functions/api/tablePr.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

const LA = "America/Los_Angeles";
const IN = "Asia/Kolkata";
const DAY = 86_400_000;

const FAM = "11111111-1111-4111-8111-111111111111";
const FAM2 = "12121212-1212-4121-8121-121212121212";
const MOM = "22222222-2222-4222-8222-222222222222"; // cook
const LEO = "33333333-3333-4333-8333-333333333333"; // learner
const GRAN = "44444444-4444-4444-8444-444444444444"; // cook, memorial
const SAM = "55555555-5555-4555-8555-555555555555"; // learner, removed
const DAD = "66666666-6666-4666-8666-666666666666"; // cook
const MAYA = "77777777-7777-4777-8777-777777777777"; // learner
const NIA = "88888888-8888-4888-8888-888888888888"; // learner in FAM2
const POP = "99999999-9999-4999-8999-999999999999"; // cook in FAM2
const LEO_PHONE = "abababab-abab-4bab-8bab-abababababab";

// --- an in-memory stand-in for the Supabase client (what tablePr.ts & notify() call) -------------

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type RpcReply = { data: unknown; error: { code?: string; message?: string } | null };

function fakeDb(tables: Tables, rpc: (fn: string, args: Row) => RpcReply) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private filters: ((r: Row) => boolean)[] = [];
    private max = Infinity;
    private single = false;
    constructor(private table: string) {}
    select(_cols?: string) { return this; }
    insert(row: Row) { this.op = "insert"; this.payload = row; return this; }
    update(row: Row) { this.op = "update"; this.payload = row; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, op: string, v: unknown) {
      if (op !== "is") throw new Error(`fake db: not ${op}`);
      this.filters.push((r) => (r[c] ?? null) !== v);
      return this;
    }
    gt(c: string, v: string) { this.filters.push((r) => Date.parse(r[c]) > Date.parse(v)); return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    // deno-lint-ignore no-explicit-any
    then(ok: (v: any) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
    private run() {
      const rows = tables[this.table];
      if (!rows) throw new Error(`fake db: no table ${this.table}`);
      const hit = (r: Row) => this.filters.every((f) => f(r));
      if (this.op === "insert") {
        const row = { ...this.payload };
        if (this.table === "notification_log" && row.dedupe_key != null &&
          rows.some((r) => r.profile_id === row.profile_id && r.dedupe_key === row.dedupe_key)) {
          return { data: null, error: { code: "23505", message: "duplicate key value" } };
        }
        rows.push(row);
        return { data: null, error: null };
      }
      if (this.op === "update") {
        rows.filter(hit).forEach((r) => Object.assign(r, this.payload));
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = rows.filter((r) => !hit(r));
        return { data: null, error: null };
      }
      const found = rows.filter(hit).slice(0, this.max);
      return { data: this.single ? found[0] ?? null : found, error: null };
    }
  }
  const db = {
    from: (table: string) => new Query(table),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpc(fn, args));
    },
  };
  return { db: db as unknown as R.NotifyDeps["db"], rpcCalls };
}

/** table_activity as the SQL answers it: this family's rows since p_since, oldest first, nulls left out. */
function activityRpc(rowsByFamily: Record<string, ActivityRow[]>, extra?: (fn: string, args: Row) => RpcReply | null) {
  return (fn: string, args: Row): RpcReply => {
    const other = extra?.(fn, args);
    if (other) return other;
    if (fn !== "table_activity") return { data: null, error: { message: `no rpc ${fn}` } };
    const since = Date.parse(args.p_since);
    const rows = (rowsByFamily[args.p_family] ?? [])
      .filter((r) => Date.parse(r.at) >= since)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)));
    return { data: rows, error: null };
  };
}

function family(): Tables {
  const p = (id: string, family_id: string, name: string, role: string, extra: Row = {}) =>
    ({ id, family_id, name, role, tz: LA, memorial: false, removed_at: null, ...extra });
  return {
    profiles: [
      p(MOM, FAM, "Mom", "cook"),
      p(DAD, FAM, "Dad", "cook"),
      p(LEO, FAM, "Leo", "learner"),
      p(MAYA, FAM, "Maya", "learner"),
      p(GRAN, FAM, "Grandma", "cook", { memorial: true }),
      p(SAM, FAM, "Sam", "learner", { removed_at: "2026-09-01T00:00:00Z" }),
      p(NIA, FAM2, "Nia", "learner"),
      p(POP, FAM2, "Pop", "cook"),
    ],
    devices: [{ id: LEO_PHONE, family_id: FAM, profile_id: LEO, revoked_at: null }],
    push_tokens: [],
    notification_log: [],
    // Mom's dal is this family's own recording (delivered); the soup never went out.
    pending_sends: [
      { job_id: "job-dal", family_id: FAM, sender_id: LEO, recipient_ids: [MAYA], delivered_at: "2026-09-01T10:00:00Z", recipe_id: "mom-dal" },
      { job_id: "job-soup", family_id: FAM, sender_id: MOM, recipient_ids: [LEO], delivered_at: null, recipe_id: null },
    ],
  };
}

/** A Library stand-in: `index` for libraryIndex(), `recipes` for recipeInfo(); counts the calls. */
function fakeLibrary(index: Record<string, R.RecipeInfo>, recipes: Record<string, R.RecipeDetails> = {}) {
  const calls = { index: 0, recipe: [] as string[] };
  const lib: R.Library = {
    libraryIndex: () => {
      calls.index += 1;
      return Promise.resolve(new Map(Object.entries(index)));
    },
    recipeInfo: (id) => {
      calls.recipe.push(id);
      return Promise.resolve(recipes[id] ?? null);
    },
  };
  return { lib, calls };
}

const dbFail = (context: string): never => {
  throw new Error(`db fail: ${context}`);
};
const req = (headers: Record<string, string> = {}) => new Request("http://x/api/table", { headers });
const ctx = (me: string | null, fam = FAM) => ({ family: { id: fam }, me: me ? { id: me } : null });

const cooked = (at: string, actor: string, cook: string | null, recipe?: string): ActivityRow =>
  ({ at, actor_id: actor, kind: "cooked", target_cook_id: cook, recipe_id: cook ? null : recipe ?? null });
const msg = (at: string, actor: string, threadWith: string | null): ActivityRow =>
  ({ at, actor_id: actor, kind: "message", thread_with: threadWith });

// --- pure helpers -------------------------------------------------------------------------------

t("parseActivity keeps well-formed rows and skips junk without throwing", () => {
  assertEquals(parseActivity(null), []);
  assertEquals(parseActivity({ at: "x" }), []);
  const rows = parseActivity([
    { at: "2026-10-12T10:00:00+00:00", actor_id: LEO, kind: "message", thread_with: MOM },
    { at: "2026-10-14T18:02:00+00:00", actor_id: LEO, kind: "heard", target_cook_id: MOM, duration_s: 9 },
    { at: "2026-10-15T18:00:00+00:00", actor_id: LEO, kind: "cooked", recipe_id: "old-dal" },
    { at: "2026-10-16T09:00:00+00:00", actor_id: MOM, kind: "published" },
    { at: "not a time", actor_id: LEO, kind: "message" },
    { at: "2026-10-16T09:00:00Z", actor_id: LEO, kind: "viewed" },
    { at: "2026-10-16T09:00:00Z", kind: "message" },
    null,
    "row",
  ]);
  assertEquals(rows.map((r) => r.kind), ["message", "heard", "cooked", "published"]);
  assertEquals(rows[1], {
    at: "2026-10-14T18:02:00+00:00", actor_id: LEO, kind: "heard", target_cook_id: MOM,
    target_kid_id: null, thread_with: null, duration_s: 9, recipe_id: null,
  });
  assertEquals(rows[2].recipe_id, "old-dal");
});

type NameProfile = Parameters<typeof toActivity>[1][number];
const named = (id: string, name: string, role: "cook" | "learner", removed_at: string | null = null): NameProfile =>
  ({ id, name, role, removed_at });

t("toActivity finds an older event's cook by the dish's cook name, and leaves the rest alone", () => {
  const profiles = [named(MOM, "Mom", "cook"), named(LEO, "Leo", "learner")];
  const index = new Map<string, R.RecipeInfo>([
    ["old-dal", { title: "Dal", cook_name: " mom", sample: false }],
    ["gordon-eggs", { title: "Eggs", cook_name: "Gordon", sample: true }],
  ]);
  const rows: ActivityRow[] = [
    cooked("2026-10-13T10:00:00Z", LEO, null, "old-dal"),
    cooked("2026-10-13T10:00:00Z", LEO, null, "gordon-eggs"), // not a family cook
    cooked("2026-10-13T10:00:00Z", LEO, null, "gone"), // not in the library
    cooked("2026-10-13T10:00:00Z", LEO, DAD), // already known
    msg("2026-10-13T10:00:00Z", LEO, MOM),
  ];
  const out = toActivity(rows, profiles, index);
  assertEquals(out.map((a) => a.target_cook_id), [MOM, null, null, DAD, null]);
  assertEquals(out[4], {
    at: "2026-10-13T10:00:00Z", actor_id: LEO, kind: "message", target_cook_id: null,
    target_kid_id: null, thread_with: MOM, duration_s: null,
  });
  assert(!("recipe_id" in out[0])); // dropped: table.ts never needs it
  assertEquals(toActivity(rows, profiles, null)[0].target_cook_id, null); // no library: counts toward nobody
});

t("toActivity matches current cooks only: never a removed same-named profile, never a kid", () => {
  const index = new Map<string, R.RecipeInfo>([
    ["old-dal", { title: "Dal", cook_name: "Mom", sample: false }],
    ["leo-toast", { title: "Toast", cook_name: "Leo", sample: false }],
  ]);
  const OLD_MOM = "2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a";
  // The removed "Mom" comes first, as the database may return her.
  const profiles = [named(OLD_MOM, "Mom", "cook", "2026-06-01T00:00:00Z"), named(MOM, "Mom", "cook"), named(LEO, "Leo", "learner")];
  const rows = [cooked("2026-10-13T10:00:00Z", MAYA, null, "old-dal"), cooked("2026-10-13T10:00:00Z", MAYA, null, "leo-toast")];
  assertEquals(toActivity(rows, profiles, index).map((a) => a.target_cook_id), [MOM, null]);
  // Only the removed one left: nobody (the row counts toward no pair rather than a vanished one).
  assertEquals(toActivity(rows, [profiles[0]], index)[0].target_cook_id, null);
});

t("toActivity credits a delivered recording to the dish's cook, even when a kid registered the send", () => {
  const index = new Map<string, R.RecipeInfo>([["mom-dal", { title: "Dal", cook_name: "Mom", sample: false }]]);
  const profiles = [named(MOM, "Mom", "cook"), named(LEO, "Leo", "learner"), named(DAD, "Dad", "cook")];
  const pub = (actor: string, recipe: string | null): ActivityRow =>
    ({ at: "2026-10-13T10:00:00Z", actor_id: actor, kind: "published", target_kid_id: MAYA, recipe_id: recipe });
  const out = toActivity([pub(LEO, "mom-dal"), pub(DAD, "mom-dal"), pub(LEO, "gone"), pub(DAD, null)], profiles, index);
  assertEquals(out.map((a) => a.actor_id), [MOM, MOM, LEO, DAD]); // unknown dish: the sender stays
  assertEquals(out[0].target_kid_id, MAYA);
  assertEquals(toActivity([pub(LEO, "mom-dal")], profiles, null)[0].actor_id, LEO); // no library: the sender
});

t("needsMoreHistory: only a streak near the window's length asks for more", () => {
  assertEquals(needsMoreHistory([], HISTORY_WEEKS), false);
  assertEquals(needsMoreHistory([{ kept: 0 }, { kept: 30 }], HISTORY_WEEKS), false);
  assertEquals(needsMoreHistory([{ kept: 36 }], HISTORY_WEEKS), false); // 36 + 16 < 53
  assertEquals(needsMoreHistory([{ kept: 37 }], HISTORY_WEEKS), true);
  assertEquals(needsMoreHistory([{ kept: 53 }], HISTORY_WEEKS), true);
});

t("viewerTz: a kid's own zone; a cook lines up with an only kid; else their own; nobody: x-tz", () => {
  const p = (id: string, role: "cook" | "learner", tz: string | null, extra: Partial<R.FamilyProfile> = {}): R.FamilyProfile =>
    ({ id, family_id: FAM, name: id, role, tz, memorial: false, removed_at: null, ...extra });
  const mom = p(MOM, "cook", "America/New_York");
  const leo = p(LEO, "learner", IN);
  const maya = p(MAYA, "learner", "Europe/London");
  assertEquals(viewerTz(leo, [mom, leo, maya], null), IN);
  assertEquals(viewerTz(mom, [mom, leo], null), IN); // one kid: the kid's week
  assertEquals(viewerTz(mom, [mom, leo, { ...maya, removed_at: "2026-01-01T00:00:00Z" }], null), IN);
  assertEquals(viewerTz(mom, [mom, leo, maya], null), "America/New_York"); // two kids: their own
  assertEquals(viewerTz(p(DAD, "cook", null), [mom, leo, maya], null), LA);
  assertEquals(viewerTz(p(LEO, "learner", "Mars/Base"), [], null), LA);
  assertEquals(viewerTz(null, [mom, leo], "Europe/London"), "Europe/London");
  assertEquals(viewerTz(null, [mom, leo], null), LA);
});

// --- GET /table ---------------------------------------------------------------------------------

// Thursday Oct 15, noon in LA. This week (LA) starts Monday Oct 12.
const THU = new Date("2026-10-15T12:00:00-07:00");

t("GET /table: Leo cooks Mom's dish & Mom answers in the same week -> weeks 1, both faces lit", async () => {
  const tables = family();
  const { db, rpcCalls } = fakeDb(tables, activityRpc({
    [FAM]: [
      cooked("2026-10-13T18:00:00-07:00", LEO, MOM),
      msg("2026-10-14T09:00:00-07:00", MOM, LEO),
      msg("2026-10-14T10:00:00-07:00", MAYA, null), // the circle: lights Maya (a cook reads it), no pair
      { at: "2026-10-14T11:00:00-07:00", actor_id: GRAN, kind: "message", thread_with: LEO }, // memorial
    ],
  }));
  const { lib, calls } = fakeLibrary({});
  const table = makeTable({ db, dbFail, library: lib, clock: () => THU });

  const leo = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(leo.week_start, "2026-10-12");
  assertEquals(leo.people, [
    { profile_id: MOM, lit: true },
    { profile_id: DAD, lit: false },
    { profile_id: LEO, lit: true },
    { profile_id: MAYA, lit: true },
    { profile_id: GRAN, lit: false }, // a memorial face stays, quiet
  ]); // Sam (removed) and the other family aren't there
  assertEquals(leo.pairs, [
    { kid_id: LEO, cook_id: MOM, weeks: 1, ember_until: null, lit_this_week: true },
    { kid_id: LEO, cook_id: DAD, weeks: 0, ember_until: null, lit_this_week: false },
  ]); // only Leo's pairs; none with Grandma
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "table_activity");
  assertEquals(rpcCalls[0].args.p_family, FAM);
  assertEquals(Date.parse(rpcCalls[0].args.p_since), THU.getTime() - (HISTORY_WEEKS + 1) * 7 * DAY);
  assertEquals(calls.index, 0); // every event knew its cook: the library wasn't read

  // Mom sees her own pairs (both kids), the same count with Leo.
  const mom = await table.getTable({ req: req(), ctx: ctx(MOM) });
  assertEquals(mom.pairs.map((p) => [p.kid_id, p.weeks]), [[LEO, 1], [MAYA, 0]]);
  // Nobody picked yet (the Profiles screen): faces only.
  const none = await table.getTable({ req: req(), ctx: ctx(null) });
  assertEquals(none.pairs, []);
  assertEquals(none.people.filter((p) => p.lit).map((p) => p.profile_id), [MOM, LEO, MAYA]);
});

t("GET /table: this request's x-tz frames the caller's week before it's stored", async () => {
  const tables = family();
  tables.profiles.find((p) => p.id === LEO)!.tz = null; // never sent a zone yet
  const { db } = fakeDb(tables, activityRpc({ [FAM]: [] }));
  // Monday 02:00 in Kolkata is still Sunday afternoon in Los Angeles.
  const now = new Date("2026-10-19T02:00:00+05:30");
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => now });
  assertEquals((await table.getTable({ req: req(), ctx: ctx(LEO) })).week_start, "2026-10-12");
  assertEquals((await table.getTable({ req: req({ "x-tz": IN }), ctx: ctx(LEO) })).week_start, "2026-10-19");
  assertEquals((await table.getTable({ req: req({ "x-tz": "+05:30" }), ctx: ctx(LEO) })).week_start, "2026-10-12"); // junk ignored
  assertEquals(tables.profiles.find((p) => p.id === LEO)!.tz, null); // storing it is syncTz's job
});

t("GET /table: an older event without a cook is matched through the library", async () => {
  const tables = family();
  const { db } = fakeDb(tables, activityRpc({
    [FAM]: [cooked("2026-10-13T18:00:00-07:00", LEO, null, "dal-classic"), msg("2026-10-14T09:00:00-07:00", MOM, LEO)],
  }));
  const { lib, calls } = fakeLibrary({ "dal-classic": { title: "Dal", cook_name: "MOM", sample: true } });
  const table = makeTable({ db, dbFail, library: lib, clock: () => THU });
  const leo = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(leo.pairs[0], { kid_id: LEO, cook_id: MOM, weeks: 1, ember_until: null, lit_this_week: true });
  assertEquals(leo.people.find((p) => p.profile_id === LEO)!.lit, true);
  assertEquals(calls.index, 1);
});

t("GET /table: a recording Leo filmed & sent lights Mom (the dish's cook), not Leo", async () => {
  const tables = family();
  const { db } = fakeDb(tables, activityRpc({
    [FAM]: [{ at: "2026-10-13T18:00:00-07:00", actor_id: LEO, kind: "published", target_kid_id: MAYA, recipe_id: "mom-dal" }],
  }));
  const { lib, calls } = fakeLibrary(MOM_INDEX);
  const table = makeTable({ db, dbFail, library: lib, clock: () => THU });
  const maya = await table.getTable({ req: req(), ctx: ctx(MAYA) });
  assertEquals(maya.people.filter((p) => p.lit).map((p) => p.profile_id), [MOM]);
  assertEquals(maya.pairs.find((p) => p.cook_id === MOM)!.lit_this_week, false); // Maya hasn't done her part
  assertEquals(calls.index, 1);
});

t("GET /table: a streak longer than the first window loads further back and counts in full", async () => {
  const tables = family();
  // Leo & Mom every week for 60 weeks, this week included.
  const rows: ActivityRow[] = [];
  for (let w = 0; w < 60; w++) {
    const tue = new Date(new Date("2026-10-13T18:00:00-07:00").getTime() - w * 7 * DAY);
    rows.push(cooked(tue.toISOString(), LEO, MOM), msg(new Date(tue.getTime() + 3_600_000).toISOString(), MOM, LEO));
  }
  const { db, rpcCalls } = fakeDb(tables, activityRpc({ [FAM]: rows }));
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => THU });
  const leo = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(leo.pairs[0].weeks, 60);
  assertEquals(rpcCalls.length, 2);
  assertEquals(Date.parse(rpcCalls[1].args.p_since), THU.getTime() - (2 * HISTORY_WEEKS + 1) * 7 * DAY);
});

t("GET /table cache: within 60 s only the last 8 days are read again, so a new flame shows at once", async () => {
  const tables = family();
  const old = msg("2026-09-29T09:00:00-07:00", MOM, LEO); // two weeks back: from the cache
  const rows: ActivityRow[] = [
    cooked("2026-09-29T08:00:00-07:00", LEO, MOM),
    old,
    cooked("2026-10-13T18:00:00-07:00", LEO, MOM), // this week: Leo has done his part
  ];
  const { db, rpcCalls } = fakeDb(tables, activityRpc({ [FAM]: rows }));
  let ms = 1_000_000;
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => THU, cacheNow: () => ms });
  const windowStart = THU.getTime() - (HISTORY_WEEKS + 1) * 7 * DAY;
  const cutoff = THU.getTime() - 8 * DAY; // already on a 15-minute boundary

  const first = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(first.people.find((p) => p.profile_id === MOM)!.lit, false);
  assertEquals(first.pairs[0].lit_this_week, false);
  assertEquals(rpcCalls.map((c) => Date.parse(c.args.p_since)), [windowStart]);

  // Mom answers. The next Home focus, 30 s later, sees it, reading only the last 8 days.
  rows.push(msg("2026-10-15T11:59:00-07:00", MOM, LEO));
  rows.splice(rows.indexOf(old), 1); // an older row deleted meanwhile: the cache still has it for now
  ms += 30_000;
  const second = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(rpcCalls.map((c) => Date.parse(c.args.p_since)), [windowStart, cutoff]);
  assertEquals(second.people.find((p) => p.profile_id === MOM)!.lit, true);
  assertEquals(second.pairs[0], { kid_id: LEO, cook_id: MOM, weeks: 2, ember_until: null, lit_this_week: true });

  // 60 s after the full read: a full read again (the deleted row is gone, so that week no longer counts).
  ms += 30_000;
  const third = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(Date.parse(rpcCalls[2].args.p_since), windowStart);
  assertEquals(third.pairs[0].weeks, 1);

  // cacheMs 0: every call is a full read.
  const { db: db2, rpcCalls: calls2 } = fakeDb(family(), activityRpc({ [FAM]: rows }));
  const off = makeTable({ db: db2, dbFail, library: fakeLibrary({}).lib, clock: () => THU, cacheMs: 0 });
  await off.getTable({ req: req(), ctx: ctx(LEO) });
  await off.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(calls2.map((c) => Date.parse(c.args.p_since)), [windowStart, windowStart]);
});

t("GET /table cache: a long streak starts at the window it needed; a broken one goes back to 53 weeks", async () => {
  const tables = family();
  const rows: ActivityRow[] = [];
  for (let w = 0; w < 60; w++) {
    const tue = new Date(new Date("2026-10-13T18:00:00-07:00").getTime() - w * 7 * DAY);
    rows.push(cooked(tue.toISOString(), LEO, MOM), msg(new Date(tue.getTime() + 3_600_000).toISOString(), MOM, LEO));
  }
  const { db, rpcCalls } = fakeDb(tables, activityRpc({ [FAM]: rows }));
  let ms = 0;
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => THU, cacheNow: () => ms });
  const since = (weeks: number) => THU.getTime() - (weeks + 1) * 7 * DAY;
  const p = () => rpcCalls.map((c) => Date.parse(c.args.p_since));

  assertEquals((await table.getTable({ req: req(), ctx: ctx(LEO) })).pairs[0].weeks, 60);
  assertEquals(p(), [since(HISTORY_WEEKS), since(2 * HISTORY_WEEKS)]);
  // Within 60 s: the cached 106 weeks plus the last 8 days.
  ms += 10_000;
  assertEquals((await table.getTable({ req: req(), ctx: ctx(LEO) })).pairs[0].weeks, 60);
  assertEquals(p().length, 3);
  assertEquals(p()[2], THU.getTime() - 8 * DAY);
  // After the cache: one full read, straight at 106 weeks.
  ms += 60_000;
  assertEquals((await table.getTable({ req: req(), ctx: ctx(LEO) })).pairs[0].weeks, 60);
  assertEquals(p().slice(3), [since(2 * HISTORY_WEEKS)]);

  // The streak breaks (only the last 5 weeks are left): this read still starts at 106, the next at 53.
  rows.splice(10);
  ms += 60_000;
  assertEquals((await table.getTable({ req: req(), ctx: ctx(LEO) })).pairs[0].weeks, 5);
  ms += 60_000;
  await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(p().slice(4), [since(2 * HISTORY_WEEKS), since(HISTORY_WEEKS)]);
});

t("GET /table cache: a cron run with a `now` far ahead never hides brand-new rows from real calls", async () => {
  const tables = family();
  // Leo & Mom met every week for 60 weeks before this one; this week only Leo has cooked so far.
  const rows: ActivityRow[] = [cooked("2026-10-13T18:00:00-07:00", LEO, MOM)];
  for (let w = 1; w <= 60; w++) {
    const tue = new Date(new Date("2026-10-13T18:00:00-07:00").getTime() - w * 7 * DAY);
    rows.push(cooked(tue.toISOString(), LEO, MOM), msg(new Date(tue.getTime() + 3_600_000).toISOString(), MOM, LEO));
  }
  const { db, rpcCalls } = fakeDb(tables, activityRpc({ [FAM]: rows }));
  let ms = 0;
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => THU, cacheMs: 60_000, cacheNow: () => ms });
  await table.getTable({ req: req(), ctx: ctx(LEO) }); // remembers the 106-week window
  // The old weeks are deleted; a minute later a test run of the cron, a month ahead, starts at 106
  // weeks, fills the cache from there, and lets the window go back to 53.
  rows.splice(0, rows.length, ...rows.filter((r) => Date.parse(r.at) > THU.getTime() - 6 * 7 * DAY));
  ms += 61_000;
  await table.loadActivity(FAM, new Date(THU.getTime() + 30 * DAY), tables.profiles as R.FamilyProfile[]);
  // Mom answers right now. The next real Home focus is served from that cache, and reads its fresh
  // part from 8 days before the real clock (not before the cron's `now`), so it sees her.
  rows.push(msg("2026-10-15T11:59:00-07:00", MOM, LEO));
  ms += 10_000;
  const leo = await table.getTable({ req: req(), ctx: ctx(LEO) });
  assertEquals(Date.parse(rpcCalls[rpcCalls.length - 1].args.p_since), THU.getTime() - 8 * DAY);
  assertEquals(leo.pairs[0].lit_this_week, true);
  assertEquals(leo.people.find((p) => p.profile_id === MOM)!.lit, true);
});

t("GET /table: recordings are only the dishes this family's own delivered recordings became", async () => {
  // The kid Home's "I miss home" pool plays only these (handoff 3.3): another family's same-named
  // "Mom" recording, or a send that never went out, is never this family's voice.
  const tables = family();
  tables.pending_sends.push(
    { job_id: "job-pop", family_id: FAM2, sender_id: POP, recipient_ids: [NIA], delivered_at: "2026-09-02T10:00:00Z", recipe_id: "mom-stew" },
    { job_id: "job-chili", family_id: FAM, sender_id: DAD, recipient_ids: [], delivered_at: "2026-09-03T10:00:00Z", recipe_id: "dad-chili" },
  );
  const { db } = fakeDb(tables, activityRpc({}));
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => THU });
  assertEquals((await table.getTable({ req: req(), ctx: ctx(LEO) })).recordings, ["dad-chili", "mom-dal"]);
  assertEquals((await table.getTable({ req: req(), ctx: ctx(null) })).recordings, ["dad-chili", "mom-dal"], "faces-only callers get them too");
  assertEquals((await table.getTable({ req: req(), ctx: ctx(NIA, FAM2) })).recordings, ["mom-stew"]);
});

t("GET /table: a failing RPC is a database failure (500), never an empty table", async () => {
  const { db } = fakeDb(family(), () => ({ data: null, error: { code: "42883", message: "function does not exist" } }));
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib, clock: () => THU });
  await assertRejects(() => table.getTable({ req: req(), ctx: ctx(LEO) }), Error, "db fail: table activity");
});

t("GET /table is registered lenient, so a phone with no one picked still loads faces", () => {
  const { db } = fakeDb(family(), activityRpc({}));
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib });
  assertEquals(table.routes.map((r) => [r.method, r.path, r.auth]), [["GET", "/table", { lenientMe: true }]]);
  assertEquals(table.cronJob.name, "table_nudge");
});

// --- the Sunday nudge ---------------------------------------------------------------------------

// Sunday Oct 18, 17:10 in LA: Leo's nudge hour. Leo & Mom met the two weeks before, not this one.
const SUN = new Date("2026-10-18T17:10:00-07:00");
const twoWeeks = (kid: string, cook: string): ActivityRow[] => [
  cooked("2026-10-01T18:00:00-07:00", kid, cook),
  msg("2026-10-02T09:00:00-07:00", cook, kid),
  msg("2026-10-06T18:00:00-07:00", kid, cook),
  msg("2026-10-07T09:00:00-07:00", cook, kid),
];

const MOM_INDEX: Record<string, R.RecipeInfo> = {
  "mom-dal": { title: "Mom's Dal", cook_name: "Mom", sample: false },
  "mom-sample": { title: "Sample Soup", cook_name: "Mom", sample: true },
};
const MOM_RECIPES: Record<string, R.RecipeDetails> = {
  "mom-dal": {
    id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", sample: false,
    steps: [{ order: 1, quote: null }, { order: 2, quote: "A pinch, then taste." }, { order: 3, quote: "x".repeat(91) }],
  },
  "mom-sample": { id: "mom-sample", title: "Sample Soup", cook_name: "Mom", sample: true, steps: [{ order: 1, quote: "Synthetic words" }] },
};

function dueOf(tables: Tables, ids: string[]): R.Due {
  return { nudge: tables.profiles.filter((p) => ids.includes(p.id)) as R.CronProfile[], recap: [] };
}
function fakeNotify() {
  const calls: { id: string; p: R.PushInput }[] = [];
  return { calls, notify: (id: string, p: R.PushInput) => (calls.push({ id, p }), Promise.resolve("sent" as R.NotifyResult)) };
}

t("nudge: one push to the kid, in the cook's own words from a real recording", async () => {
  const tables = family();
  const { db } = fakeDb(tables, activityRpc({ [FAM]: twoWeeks(LEO, MOM) }));
  const { lib, calls } = fakeLibrary(MOM_INDEX, MOM_RECIPES);
  const table = makeTable({ db, dbFail, library: lib });
  const n = fakeNotify();
  const sent = await table.cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: n.notify });
  assertEquals(sent, 1);
  assertEquals(n.calls, [{
    id: LEO,
    p: {
      kind: "table_nudge",
      title: "Mom",
      body: "“A pinch, then taste.” · Your week at the table is still open.",
      url: "/recipe/mom-dal",
      appInitiated: true,
      dedupeKey: `table_nudge:${LEO}:2026-10-12`,
      quoteKey: "mom-dal#step-2",
    },
  }]);
  assertEquals(calls.recipe, ["mom-dal"]); // the sample's words are never read for a quote
  assertEquals(calls.index, 1);
});

t("nudge: a quote used in the last 15 days isn't repeated; with none left, the plain line", async () => {
  const tables = family();
  tables.notification_log.push(
    { profile_id: LEO, kind: "table_nudge", quote_key: "mom-dal#step-2", skipped_reason: null, sent_at: "2026-10-11T17:05:00-07:00" },
  );
  const { db } = fakeDb(tables, activityRpc({ [FAM]: twoWeeks(LEO, MOM) }));
  const table = makeTable({ db, dbFail, library: fakeLibrary(MOM_INDEX, MOM_RECIPES).lib });
  const n = fakeNotify();
  await table.cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: n.notify });
  assertEquals(n.calls[0].p.body, "Your week at the table with Mom is still open.");
  assertEquals(n.calls[0].p.quoteKey, null);
  assertEquals(n.calls[0].p.url, "/recipe/mom-dal"); // the cook's first dish

  // Older than 15 days, or a skipped push (never seen), and the quote is back.
  tables.notification_log[0].sent_at = "2026-10-02T17:05:00-07:00";
  tables.notification_log.push(
    { profile_id: LEO, kind: "table_nudge", quote_key: "mom-dal#step-2", skipped_reason: "quiet", sent_at: "2026-10-17T22:00:00-07:00" },
  );
  const again = fakeNotify();
  await table.cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: again.notify });
  assertEquals(again.calls[0].p.quoteKey, "mom-dal#step-2");
});

t("nudge: a same-named cook's real recording from another family is never quoted or opened", async () => {
  const tables = family();
  // mom-dal was recorded & delivered by another family whose cook is also called "Mom".
  tables.pending_sends = [
    { job_id: "job-dal", family_id: FAM2, sender_id: NIA, recipient_ids: [], delivered_at: "2026-09-01T10:00:00Z", recipe_id: "mom-dal" },
    { job_id: "job-new", family_id: FAM, sender_id: MOM, recipient_ids: [LEO], delivered_at: null, recipe_id: "mom-dal" }, // never went out here
  ];
  const { db } = fakeDb(tables, activityRpc({ [FAM]: twoWeeks(LEO, MOM) }));
  const { lib, calls } = fakeLibrary(MOM_INDEX, MOM_RECIPES);
  const table = makeTable({ db, dbFail, library: lib });
  const n = fakeNotify();
  assertEquals(await table.cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: n.notify }), 1);
  assertEquals(n.calls[0].p.title, "Mom");
  assertEquals(n.calls[0].p.body, "Your week at the table with Mom is still open.");
  assertEquals(n.calls[0].p.quoteKey, null);
  assertEquals(n.calls[0].p.url, "/recipe/mom-sample"); // the sample under her name, as the app shows it
  assertEquals(calls.recipe, []); // the stranger's recipe.json is never even read

  // Without the sample either: the kid's Home, never the stranger's dish.
  const m = fakeNotify();
  await makeTable({ db, dbFail, library: fakeLibrary({ "mom-dal": MOM_INDEX["mom-dal"] }, MOM_RECIPES).lib })
    .cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: m.notify });
  assertEquals([m.calls[0].p.url, m.calls[0].p.quoteKey], ["/kid/home", null]);
});

t("nudge: only sample dishes or no library -> the plain line, opening a dish or the kid's Home", async () => {
  const tables = family();
  const { db } = fakeDb(tables, activityRpc({ [FAM]: twoWeeks(LEO, MOM) }));
  const samples = makeTable({
    db, dbFail,
    library: fakeLibrary({ "mom-sample": MOM_INDEX["mom-sample"] }, MOM_RECIPES).lib,
  });
  const a = fakeNotify();
  await samples.cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: a.notify });
  assertEquals([a.calls[0].p.body, a.calls[0].p.url], ["Your week at the table with Mom is still open.", "/recipe/mom-sample"]);

  const down = makeTable({ db, dbFail, library: fakeLibrary({}).lib }); // bucket unreachable: empty index
  const b = fakeNotify();
  await down.cronJob.run({ now: SUN, due: dueOf(tables, [LEO]), notify: b.notify });
  assertEquals(b.calls[0].p.url, "/kid/home");
});

t("nudge: never when lit, never to cooks or kids not due, never about a memorial cook", async () => {
  const tables = family();
  const rows = [
    ...twoWeeks(LEO, MOM),
    ...twoWeeks(MAYA, MOM),
    ...twoWeeks(LEO, GRAN), // memorial: in no pair
    // This week Maya & Mom already met: nothing to say.
    msg("2026-10-13T18:00:00-07:00", MAYA, MOM),
    msg("2026-10-14T09:00:00-07:00", MOM, MAYA),
  ];
  const { db } = fakeDb(tables, activityRpc({ [FAM]: rows }));
  const table = makeTable({ db, dbFail, library: fakeLibrary(MOM_INDEX, MOM_RECIPES).lib });
  const n = fakeNotify();
  // Mom & Grandma slipped into `due` by mistake; Leo isn't due (not his nudge hour, say).
  await table.cronJob.run({ now: SUN, due: dueOf(tables, [MAYA, MOM, GRAN]), notify: n.notify });
  assertEquals(n.calls, []);
  // Not Sunday evening in the kid's zone: nothing, even when due says otherwise.
  const m = fakeNotify();
  await table.cronJob.run({ now: new Date("2026-10-18T12:00:00-07:00"), due: dueOf(tables, [LEO]), notify: m.notify });
  assertEquals(m.calls, []);
  // An empty `due` doesn't touch the database or the bucket.
  const { lib, calls } = fakeLibrary(MOM_INDEX);
  assertEquals(await makeTable({ db, dbFail, library: lib }).cronJob.run({ now: SUN, due: { nudge: [], recap: [] }, notify: m.notify }), 0);
  assertEquals(calls.index, 0);
});

t("nudge: a family whose history fails is skipped; the others still get theirs", async () => {
  const tables = family();
  const { db } = fakeDb(tables, (fn, args) =>
    args.p_family === FAM
      ? { data: null, error: { message: "boom" } }
      : activityRpc({ [FAM2]: twoWeeks(NIA, POP) })(fn, args));
  const table = makeTable({ db, dbFail, library: fakeLibrary({}).lib });
  const n = fakeNotify();
  const sent = await table.cronJob.run({ now: SUN, due: dueOf(tables, [LEO, NIA]), notify: n.notify });
  assertEquals(sent, 1);
  assertEquals(n.calls.map((c) => [c.id, c.p.title]), [[NIA, "Pop"]]);
});

// --- through retention's /cron/hourly, with notify() & a fake Expo ---------------------------------

t("cron: /cron/hourly runs the nudge once, logs its quote, and a re-run is a dedupe no-op", async () => {
  const tables = family();
  tables.push_tokens.push({ token: "ExponentPushToken[leo-0001]", family_id: FAM, profile_id: LEO, device_id: LEO_PHONE, platform: "ios" });
  const { db } = fakeDb(tables, activityRpc({ [FAM]: twoWeeks(LEO, MOM) }, (fn, args) =>
    fn === "cron_secret_ok" ? { data: args.p_secret === "test-cron", error: null } : null));
  const sentToExpo: Row[][] = [];
  const expo = ((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Row[];
    sentToExpo.push(body);
    return Promise.resolve(new Response(JSON.stringify({ data: body.map(() => ({ status: "ok", id: "t" })) }), { status: 200 }));
  }) as typeof fetch;
  class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  // PR 5 on through the one factory index.ts calls: it builds makeTable and registers the job.
  const retention = R.makeRetention({
    prs: [5],
    db, HttpError, dbFail, fetch: expo,
    library: fakeLibrary(MOM_INDEX, MOM_RECIPES).lib,
    requireMe: () => ({ id: LEO, name: "Leo" }),
    rateLimit: () => Promise.resolve(),
    clientIp: () => "203.0.113.9",
  });
  assertEquals(retention.cronJobs.map((j) => [j.name, j.pr]), [["table_nudge", 5]]);
  const run = () => retention.cronHourly({
    req: new Request("http://x/api/cron/hourly", { method: "POST", headers: { "x-cron-secret": "test-cron" } }),
    body: () => Promise.resolve({ now: SUN.toISOString() }),
  });

  assertEquals(await run(), { ok: true, due: { nudge: 1, recap: 0 }, sent: 1, jobs: { table_nudge: 1 } });
  assertEquals(sentToExpo.length, 1);
  assertEquals(sentToExpo[0][0].title, "Mom");
  assertEquals(sentToExpo[0][0].body, "“A pinch, then taste.” · Your week at the table is still open.");
  assertEquals(sentToExpo[0][0].data, { url: "/recipe/mom-dal", kind: "table_nudge", profile_id: LEO });
  assertEquals(tables.notification_log.length, 1);
  const row = tables.notification_log[0];
  assertEquals([row.profile_id, row.kind, row.app_initiated, row.dedupe_key, row.quote_key],
    [LEO, "table_nudge", true, `table_nudge:${LEO}:2026-10-12`, "mom-dal#step-2"]);

  // The same hour again: the dedupe key stops a second push.
  assertEquals((await run()).sent, 0);
  assertEquals(sentToExpo.length, 1);
  assertEquals(tables.notification_log.length, 1);
});

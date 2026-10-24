// Offline checks for supabase/functions/api/cooking.ts ("Leo is cooking your chili", retention PR 2):
// the consent gate, sessions (first call logs 'started' and pushes the dish's cook once a kid-local
// day; later calls only move the step; 45 min idle or another dish starts anew), ending, the cook's
// live list, the consent route, the push copy and the reaction push rules. No database and no
// network: the routes get a small in-memory stand-in for the Supabase client, Expo is a fake fetch,
// and the library is a map.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/cooking_test.ts

import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1.0.13";
import * as C from "../functions/api/cooking.ts";
import * as R from "../functions/api/retention.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

// --- an in-memory stand-in for the Supabase client ---------------------------------------------

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
const UNIQUE: Record<string, string[][]> = {
  push_tokens: [["token"]],
  notification_log: [["profile_id", "dedupe_key"]],
  cooking_now: [["profile_id"]],
};

/**
 * PostgREST's spelling of a timestamptz in a select: "2026-10-19T00:00:00.12+00:00" (an offset, not
 * Z; trailing zeros cut), never the "...00.120Z" the edge function wrote. Selects of these columns
 * answer in it, so a route that hands a stored time back as it is gets caught.
 */
const PG_TIMES: Record<string, string[]> = { cooking_now: ["started_at", "updated_at"] };
export function pgTime(v: unknown): unknown {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) return v;
  const [base, frac = ""] = new Date(Date.parse(v)).toISOString().slice(0, -1).split(".");
  const f = frac.replace(/0+$/, "");
  return `${base}${f ? `.${f}` : ""}+00:00`;
}
const asPg = (table: string, r: Row): Row => {
  const out = { ...r };
  for (const c of PG_TIMES[table] ?? []) if (c in out) out[c] = pgTime(out[c]);
  return out;
};

/**
 * Just what cooking.ts & notify() call: select/insert/update/delete, eq/in/is/gt, order, limit,
 * maybeSingle. `beforeSelect` runs just before a select reads its table (to stage a race). Selected
 * times come back in PostgREST's spelling (pgTime).
 */
function fakeDb(tables: Tables, opts: { failInsert?: (table: string) => boolean; beforeSelect?: (table: string) => void } = {}) {
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private filters: ((r: Row) => boolean)[] = [];
    private sort: { col: string; asc: boolean } | null = null;
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
    gt(c: string, v: string) { this.filters.push((r) => Date.parse(r[c]) > Date.parse(v)); return this; }
    order(col: string, o: { ascending?: boolean } = {}) { this.sort = { col, asc: o.ascending !== false }; return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    // deno-lint-ignore no-explicit-any
    then(ok: (v: any) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
    private run() {
      if (this.op === "select") opts.beforeSelect?.(this.table);
      const rows = tables[this.table];
      if (!rows) throw new Error(`fake db: no table ${this.table}`);
      const hit = (r: Row) => this.filters.every((f) => f(r));
      if (this.op === "insert") {
        if (opts.failInsert?.(this.table)) return { data: null, error: { code: "23514", message: "check violation" } };
        const row = { ...this.payload };
        for (const cols of UNIQUE[this.table] ?? []) {
          if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
          if (rows.some((r) => cols.every((c) => r[c] === row[c]))) {
            return { data: null, error: { code: "23505", message: "duplicate key value" } };
          }
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
      let found = rows.filter(hit).map((r) => asPg(this.table, r));
      if (this.sort) {
        const { col, asc } = this.sort;
        found = found.sort((a, b) => (Date.parse(a[col]) - Date.parse(b[col])) * (asc ? 1 : -1));
      }
      found = found.slice(0, this.max);
      return { data: this.single ? found[0] ?? null : found, error: null };
    }
  }
  return { from: (table: string) => new Query(table), rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as R.NotifyDeps["db"];
}

function fakeExpo() {
  const sent: R.ExpoMessage[] = [];
  const fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as R.ExpoMessage[];
    sent.push(...body);
    return Promise.resolve(new Response(JSON.stringify({ data: body.map(() => ({ status: "ok", id: crypto.randomUUID() })) }), {
      headers: { "content-type": "application/json" },
    }));
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

// --- a test family -------------------------------------------------------------------------------

const FAM = "11111111-1111-4111-8111-111111111111";
const MOM = "22222222-2222-4222-8222-222222222222"; // cook
const LEO = "33333333-3333-4333-8333-333333333333"; // learner
const DAD = "44444444-4444-4444-8444-444444444444"; // cook
const MAYA = "55555555-5555-4555-8555-555555555555"; // learner, not asked yet
const SAM = "66666666-6666-4666-8666-666666666666"; // learner, removed
const LA = "America/Los_Angeles";

function family(leoShare: boolean | null = true): Tables {
  const p = (id: string, name: string, role: string, extra: Row = {}) => ({
    id, family_id: FAM, name, role, relation: null, avatar_key: null, sort: 0,
    tz: LA, memorial: false, removed_at: null, share_cooking: null, ...extra,
  });
  return {
    profiles: [
      p(MOM, "Mom", "cook", { relation: "Mom", avatar_key: "mom" }),
      p(LEO, "Leo", "learner", { share_cooking: leoShare }),
      p(DAD, "Dad", "cook"),
      p(MAYA, "Maya", "learner"),
      p(SAM, "Sam", "learner", { share_cooking: true, removed_at: "2026-10-01T00:00:00Z" }),
    ],
    devices: [],
    push_tokens: [
      { token: "ExponentPushToken[mom-0001]", family_id: FAM, profile_id: MOM, device_id: null, platform: "ios" },
      { token: "ExponentPushToken[dad-0001]", family_id: FAM, profile_id: DAD, device_id: null, platform: "ios" },
    ],
    notification_log: [],
    cooking_now: [],
    recipe_events: [],
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

type TestCtx = C.CookingCtx & { phones: Set<string> };
const ctxFor = (tables: Tables, me: string | null): TestCtx => {
  const profiles = tables.profiles.filter((x) => !x.removed_at) as C.CookingProfile[];
  return {
    family: { id: FAM, name: "Test family" },
    profiles,
    me: profiles.find((x) => x.id === me) ?? null,
    device: null,
    phones: new Set(),
  };
};

const LIBRARY: Record<string, { title: string; cook_name: string | null }> = {
  "mom-sunday-chili": { title: "Mom's Sunday Chili", cook_name: "Mom" },
  "mom-dal": { title: "Dal", cook_name: "Mom" },
  "dad-ramen": { title: "Ramen", cook_name: "Dad" },
};

function setup(tables: Tables, opts: { failEvents?: boolean; start?: string; beforeSelect?: (table: string) => void } = {}) {
  const db = fakeDb(tables, { failInsert: (table) => !!opts.failEvents && table === "recipe_events", beforeSelect: opts.beforeSelect });
  const expo = fakeExpo();
  let now = new Date(opts.start ?? "2026-10-18T17:00:00-07:00");
  const rate: string[] = [];
  const asserted: string[] = [];
  const cooking = C.makeCooking<TestCtx>({
    db,
    HttpError,
    requireMe: (ctx) => {
      if (!ctx.me) throw new HttpError(400, "x-profile-id header is required for this request");
      return ctx.me;
    },
    rateLimit: (kind, value, max, windowMin) => {
      rate.push(`${kind}:${value}:${max}:${windowMin}`);
      return Promise.resolve();
    },
    dbFail: (context) => {
      throw new Error(`db fail: ${context}`);
    },
    notify: (id, p) => R.notify({ db, fetch: expo.fetch }, id, p),
    library: { recipeInfo: (id) => Promise.resolve(LIBRARY[id] ?? null) },
    assertRecipe: (id) => {
      asserted.push(id);
      return Promise.resolve();
    },
    now: () => now,
  });
  const as = (me: string | null) => ctxFor(tables, me);
  const req = new Request("http://x/api/cooking", { method: "POST" });
  const body = (b: Record<string, unknown>) => () => Promise.resolve(b);
  return {
    cooking,
    expo,
    rate,
    asserted,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    setNow: (iso: string) => (now = new Date(iso)),
    start: (me: string, b: Record<string, unknown>) => cooking.start({ req, ctx: as(me), body: body(b) }),
    end: (me: string, b: Record<string, unknown> = {}) => cooking.end({ req, ctx: as(me), body: body(b) }),
    live: (me: string) => cooking.live({ req, ctx: as(me), body: body({}) }),
    getShare: (me: string) => cooking.getShare({ req, ctx: as(me), body: body({}) }),
    setShare: (me: string, b: Record<string, unknown>) => cooking.setShare({ req, ctx: as(me), body: body(b) }),
  };
}

async function httpError(p: Promise<unknown>, status: number, message: string) {
  const e = await assertRejects(() => p, HttpError);
  assertEquals([e.status, e.message], [status, message]);
}

const chili = (step = 1, total = 8) => ({ recipe_id: "mom-sunday-chili", cook_id: MOM, step, total });
const MIN = 60_000;

// --- routes ------------------------------------------------------------------------------------

t("the factory hands index.ts five signed-in routes", () => {
  const { cooking } = setup(family());
  assertEquals(cooking.routes.map((r) => [r.method, r.path, r.auth]), [
    ["POST", "/cooking", {}],
    ["POST", "/cooking/end", {}],
    ["GET", "/cooking", {}],
    ["GET", "/profile/share-cooking", {}],
    ["POST", "/profile/share-cooking", {}],
  ]);
});

t("POST /cooking before the kid answers: consent 'unasked', and nothing is stored, logged or pushed", async () => {
  const tables = family(null);
  const s = setup(tables);
  assertEquals(await s.start(LEO, chili()), { ok: true, shared: false, consent: "unasked", started_at: null, new_session: false });
  // "Not now": the same, as 'no'.
  tables.profiles.find((p) => p.id === LEO)!.share_cooking = false;
  assertEquals((await s.start(LEO, chili(2))).consent, "no");
  await R.backgroundIdle();
  assertEquals([tables.cooking_now.length, tables.recipe_events.length, tables.notification_log.length, s.expo.sent.length], [0, 0, 0, 0]);
});

t("POST /cooking checks the dish, the cook and the steps", async () => {
  const tables = family();
  const s = setup(tables);
  await httpError(s.start(LEO, { ...chili(), recipe_id: undefined }), 400, "recipe_id is required");
  await httpError(s.start(LEO, { ...chili(), recipe_id: "Mom Chili!" }), 400, "recipe_id is not a valid recipe id");
  await httpError(s.start(LEO, { ...chili(), cook_id: LEO }), 400, "cook_id must be someone else in your family");
  await httpError(s.start(LEO, { ...chili(), cook_id: MAYA }), 400, "cook_id must be a cook in your family");
  await httpError(s.start(LEO, { ...chili(), cook_id: crypto.randomUUID() }), 400, "cook_id must be a cook in your family");
  await httpError(s.start(LEO, { ...chili(), cook_id: "mom" }), 400, "cook_id must be a cook in your family");
  await httpError(s.start(LEO, { ...chili(), step: 0 }), 400, "step must be between 1 and 200");
  await httpError(s.start(LEO, { ...chili(), step: 1.5 }), 400, "step must be a whole number");
  await httpError(s.start(LEO, { ...chili(), total: "8" }), 400, "total must be a whole number");
  await httpError(s.start(LEO, { ...chili(), total: 201 }), 400, "total must be between 1 and 200");
  await httpError(s.start(LEO, chili(9, 8)), 400, "step must be at most total");
  const noMe = s.cooking.start({ req: new Request("http://x"), ctx: ctxFor(tables, null), body: () => Promise.resolve(chili()) });
  await httpError(noMe, 400, "x-profile-id header is required for this request");
  assertEquals(tables.cooking_now.length, 0);
});

t("the first call of a session stores the row, logs 'started' with the cook, and pushes the cook once", async () => {
  const tables = family();
  const s = setup(tables);
  const first = await s.start(LEO, chili(1, 8));
  assertEquals(first, { ok: true, shared: true, consent: "yes", started_at: "2026-10-19T00:00:00.000Z", new_session: true });
  assertEquals(s.rate, [`cooking:${LEO}:240:60`]);
  assertEquals(s.asserted, ["mom-sunday-chili"]);
  assertEquals(tables.cooking_now.map((r) => [r.profile_id, r.family_id, r.recipe_id, r.cook_id, r.step, r.total]),
    [[LEO, FAM, "mom-sunday-chili", MOM, 1, 8]]);
  assertEquals(tables.recipe_events.map((e) => [e.family_id, e.profile_id, e.recipe_id, e.kind, e.cook_id]),
    [[FAM, LEO, "mom-sunday-chili", "started", MOM]]);
  await R.backgroundIdle();
  // Mom's phone only, in Leo's words about the dish (the possessive dropped, as the app says it).
  assertEquals(s.expo.sent.map((m) => [m.to, m.title, m.body, m.data]), [[
    "ExponentPushToken[mom-0001]",
    "Leo is making your Sunday Chili",
    "Right now, step 1 of 8.",
    { url: "/parent/home", kind: "started", profile_id: MOM },
  ]]);
  // Person-caused (never capped), deduped per kid, dish & Leo's local day.
  assertEquals(tables.notification_log.map((r) => [r.profile_id, r.kind, r.app_initiated, r.dedupe_key]),
    [[MOM, "started", false, `started:${LEO}:mom-sunday-chili:2026-10-18`]]);
});

t("later steps of the same dish only move the step: no event, no push, the same started_at", async () => {
  const tables = family();
  const s = setup(tables);
  const first = await s.start(LEO, chili(1));
  s.advance(3 * MIN);
  const next = await s.start(LEO, chili(3));
  assertEquals(next, { ok: true, shared: true, consent: "yes", started_at: first.started_at, new_session: false });
  assertEquals(tables.cooking_now.map((r) => [r.step, r.total, r.updated_at, r.started_at]),
    [[3, 8, "2026-10-19T00:03:00.000Z", "2026-10-19T00:00:00.000Z"]]);
  // 44 minutes after the last step is still the same session.
  s.advance(44 * MIN);
  assertFalse((await s.start(LEO, chili(4))).new_session);
  await R.backgroundIdle();
  assertEquals([tables.recipe_events.length, tables.notification_log.length, s.expo.sent.length, s.asserted.length], [1, 1, 1, 1]);
});

t("started_at goes out in one spelling, whatever the database answers", async () => {
  const tables = family();
  const s = setup(tables);
  const first = await s.start(LEO, chili(1));
  assertEquals(first.started_at, "2026-10-19T00:00:00.000Z");
  // The fake answers selects as PostgREST does ("2026-10-19T00:00:00+00:00"): the step path says it as
  // the first call did, so the app's heart feed (keyed on it) never restarts mid-session.
  assertEquals(pgTime(tables.cooking_now[0].started_at), "2026-10-19T00:00:00+00:00");
  s.advance(MIN);
  assertEquals((await s.start(LEO, chili(2))).started_at, first.started_at);
  // A start time Postgres wrote itself (microseconds, an offset) comes out the same way.
  tables.cooking_now[0].started_at = "2026-10-18T23:58:00.123456+00:00";
  s.advance(MIN);
  assertEquals((await s.start(LEO, chili(3))).started_at, "2026-10-18T23:58:00.123Z");
  const rows = await s.live(MOM);
  assertEquals([rows[0].started_at, rows[0].updated_at], ["2026-10-18T23:58:00.123Z", "2026-10-19T00:02:00.000Z"]);
  assertEquals(C.isoOf("2026-10-19T00:00:00.5+00:00"), "2026-10-19T00:00:00.500Z");
  assertEquals(C.isoOf("not a time"), "not a time");
});

t("a step naming another cook never hands the session to them", async () => {
  const tables = family();
  const s = setup(tables);
  await s.start(LEO, chili(1));
  s.advance(MIN);
  // Mom's chili with cook_id = Dad: checked like a new session, so refused, and the row keeps Mom.
  await httpError(s.start(LEO, { ...chili(2), cook_id: DAD }), 400, "cook_id must be the dish's cook");
  assertEquals(tables.cooking_now.map((r) => [r.recipe_id, r.cook_id, r.step]), [["mom-sunday-chili", MOM, 1]]);
  assertEquals(await s.live(DAD), []);
  assertEquals((await s.live(MOM)).map((r) => r.step), [1]);
  // The right cook carries on as the same session.
  const next = await s.start(LEO, chili(2));
  assertEquals([next.new_session, next.started_at], [false, "2026-10-19T00:00:00.000Z"]);
  assertEquals(tables.cooking_now.map((r) => [r.cook_id, r.step]), [[MOM, 2]]);
  await R.backgroundIdle();
  assertEquals(s.expo.sent.map((m) => m.to), ["ExponentPushToken[mom-0001]"]);
});

t("another dish starts a new session and pushes that dish's cook", async () => {
  const tables = family();
  const s = setup(tables);
  await s.start(LEO, chili(2));
  s.advance(5 * MIN);
  const ramen = await s.start(LEO, { recipe_id: "dad-ramen", cook_id: DAD, step: 1, total: 5 });
  assert(ramen.new_session);
  assertEquals(tables.cooking_now.map((r) => [r.recipe_id, r.cook_id, r.step]), [["dad-ramen", DAD, 1]]);
  await R.backgroundIdle();
  assertEquals(s.expo.sent.map((m) => [m.to, m.title]), [
    ["ExponentPushToken[mom-0001]", "Leo is making your Sunday Chili"],
    ["ExponentPushToken[dad-0001]", "Leo is making your Ramen"],
  ]);
});

t("45 min idle, or an end, starts anew: a new 'started' event, but no second push the same local day", async () => {
  const tables = family();
  const s = setup(tables);
  await s.start(LEO, chili(1));
  s.advance(46 * MIN);
  const again = await s.start(LEO, chili(1));
  assertEquals([again.new_session, again.started_at], [true, "2026-10-19T00:46:00.000Z"]);
  assertEquals(await s.end(LEO), { ok: true });
  assertEquals(tables.cooking_now.length, 0);
  assert((await s.start(LEO, chili(1))).new_session);
  await R.backgroundIdle();
  assertEquals(tables.recipe_events.length, 3);
  assertEquals(s.expo.sent.length, 1);
  assertEquals(tables.notification_log.length, 1);
  // The next local day pushes again.
  s.setNow("2026-10-19T18:00:00-07:00");
  await s.end(LEO);
  await s.start(LEO, chili(1));
  await R.backgroundIdle();
  assertEquals(tables.notification_log.map((r) => r.dedupe_key), [
    `started:${LEO}:mom-sunday-chili:2026-10-18`,
    `started:${LEO}:mom-sunday-chili:2026-10-19`,
  ]);
});

t("the dedupe day is the kid's local day, not the server's", async () => {
  const tables = family();
  tables.profiles.find((p) => p.id === LEO)!.tz = "Asia/Kolkata";
  // 20:00 UTC Sunday is already Monday 01:30 in Kolkata.
  const s = setup(tables, { start: "2026-10-18T20:00:00Z" });
  await s.start(LEO, chili());
  await R.backgroundIdle();
  assertEquals(tables.notification_log[0].dedupe_key, `started:${LEO}:mom-sunday-chili:2026-10-19`);
  // A zone that is junk or missing reads as Los Angeles.
  assertEquals(C.startedKey(LEO, "x", new Date("2026-10-18T20:00:00Z"), "+05:30"), `started:${LEO}:x:2026-10-18`);
  assertEquals(C.startedKey(LEO, "x", new Date("2026-10-18T20:00:00Z"), null), `started:${LEO}:x:2026-10-18`);
});

t("POST /cooking/end with a recipe_id ends only that dish's session", async () => {
  const tables = family();
  const s = setup(tables);
  await s.start(LEO, { recipe_id: "dad-ramen", cook_id: DAD, step: 1, total: 5 });
  // A late end from the dish before never ends this one.
  await s.end(LEO, { recipe_id: "mom-sunday-chili" });
  assertEquals(tables.cooking_now.length, 1);
  await s.end(LEO, { recipe_id: "dad-ramen" });
  assertEquals(tables.cooking_now.length, 0);
  await httpError(s.end(LEO, { recipe_id: "Bad Id" }), 400, "recipe_id is not a valid recipe id");
});

t("two first calls racing: the loser hits the primary key and is just a step (no second event or push)", async () => {
  const tables = family();
  const seeded = "2026-10-18T23:59:58.000Z";
  let staged = false;
  // The other call's insert lands between this call's select and its insert.
  const s = setup(tables, {
    beforeSelect: (table) => {
      if (table !== "cooking_now" || staged) return;
      staged = true;
      queueMicrotask(() => {
        tables.cooking_now.push({
          profile_id: LEO, family_id: FAM, recipe_id: "mom-sunday-chili", cook_id: MOM, step: 1, total: 8,
          started_at: seeded, updated_at: seeded,
        });
      });
    },
  });
  const res = await s.start(LEO, chili(2, 8));
  // The select saw no row (the dish was checked as for a new session), so this went through the insert.
  assertEquals(s.asserted, ["mom-sunday-chili"]);
  assertEquals(res, { ok: true, shared: true, consent: "yes", started_at: seeded, new_session: false });
  assertEquals(tables.cooking_now.map((r) => [r.profile_id, r.step, r.total, r.started_at, r.updated_at]),
    [[LEO, 2, 8, seeded, "2026-10-19T00:00:00.000Z"]]);
  await R.backgroundIdle();
  assertEquals([tables.recipe_events.length, tables.notification_log.length, s.expo.sent.length], [0, 0, 0]);
});

const MEMORIAL_ANSWER: C.CookingStart = { ok: true, shared: false, consent: "no", memorial: true, started_at: null, new_session: false };

t("a memorial cook's dish: nothing is stored, logged or pushed", async () => {
  const tables = family();
  tables.profiles.find((p) => p.id === MOM)!.memorial = true;
  const s = setup(tables);
  assertEquals(await s.start(LEO, chili()), MEMORIAL_ANSWER);
  await R.backgroundIdle();
  assertEquals([tables.cooking_now.length, tables.recipe_events.length, tables.notification_log.length, s.expo.sent.length], [0, 0, 0, 0]);
  assertEquals(await s.live(MOM), []);
});

t("a memorial cook's dish never asks the consent question (never 'unasked'), and the kid's answer stays unset", async () => {
  for (const share of [null, false]) {
    const tables = family(share);
    tables.profiles.find((p) => p.id === MOM)!.memorial = true;
    const s = setup(tables);
    assertEquals(await s.start(LEO, chili()), MEMORIAL_ANSWER);
    assertEquals(tables.profiles.find((p) => p.id === LEO)!.share_cooking, share);
    assertEquals([tables.cooking_now.length, tables.recipe_events.length], [0, 0]);
  }
});

t("the dish must be that cook's: no push about someone else's dish", async () => {
  const tables = family();
  const s = setup(tables);
  await httpError(s.start(LEO, { recipe_id: "dad-ramen", cook_id: MOM, step: 1, total: 5 }), 400, "cook_id must be the dish's cook");
  // Checked once per session: a fresh session's later steps don't fetch the dish again.
  assert((await s.start(LEO, chili(1))).new_session);
  assertFalse((await s.start(LEO, chili(2))).new_session);
  await R.backgroundIdle();
  assertEquals(tables.cooking_now.map((r) => [r.recipe_id, r.cook_id]), [["mom-sunday-chili", MOM]]);
  assertEquals(s.expo.sent.map((m) => m.title), ["Leo is making your Sunday Chili"]);
});

t("a failed 'started' event never fails the call or loses the push", async () => {
  const tables = family();
  const s = setup(tables, { failEvents: true });
  assert((await s.start(LEO, chili())).new_session);
  await R.backgroundIdle();
  assertEquals([tables.cooking_now.length, tables.recipe_events.length, s.expo.sent.length], [1, 0, 1]);
});

t("an unknown dish still pushes, as 'your recipe'", async () => {
  const tables = family();
  const s = setup(tables);
  await s.start(LEO, { recipe_id: "mom-new-thing", cook_id: MOM, step: 2, total: 3 });
  await R.backgroundIdle();
  assertEquals(s.expo.sent.map((m) => [m.title, m.body]), [["Leo is making your recipe", "Right now, step 2 of 3."]]);
});

t("GET /cooking: only my dishes, only fresh, only kids who said yes and are still in the family", async () => {
  const tables = family();
  const s = setup(tables);
  await s.start(LEO, chili(3));
  // Rows a client could not have written: someone not asked yet, someone removed, someone stale.
  const iso = (ms: number) => new Date(Date.parse("2026-10-19T00:00:00Z") + ms).toISOString();
  tables.cooking_now.push(
    { profile_id: MAYA, family_id: FAM, recipe_id: "mom-dal", cook_id: MOM, step: 1, total: 4, started_at: iso(0), updated_at: iso(0) },
    { profile_id: SAM, family_id: FAM, recipe_id: "mom-dal", cook_id: MOM, step: 1, total: 4, started_at: iso(0), updated_at: iso(0) },
    { profile_id: DAD, family_id: FAM, recipe_id: "mom-dal", cook_id: MOM, step: 2, total: 4, started_at: iso(-60 * MIN), updated_at: iso(-46 * MIN) },
  );
  tables.profiles.find((p) => p.id === DAD)!.share_cooking = true;
  s.advance(2 * MIN);
  assertEquals(await s.live(MOM), [{
    profile: { id: LEO, name: "Leo", role: "learner", relation: null, avatar_key: null },
    recipe_id: "mom-sunday-chili",
    cook_id: MOM,
    step: 3,
    total: 8,
    started_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  }]);
  // Dad's Home never shows Mom's dishes; Leo's own call shows nothing.
  assertEquals(await s.live(DAD), []);
  assertEquals(await s.live(LEO), []);
  // The row goes once it is 45 min old.
  s.advance(44 * MIN);
  assertEquals(await s.live(MOM), []);
});

t("POST /profile/share-cooking stores the answer; no also ends a live session at once", async () => {
  const tables = family(null);
  const s = setup(tables);
  assertEquals(await s.getShare(LEO), { share_cooking: null });
  assertEquals(await s.setShare(LEO, { share: true }), { ok: true, share_cooking: true });
  assertEquals(await s.getShare(LEO), { share_cooking: true });
  assert((await s.start(LEO, chili())).shared);
  assertEquals((await s.live(MOM)).length, 1);
  assertEquals(await s.setShare(LEO, { share: false }), { ok: true, share_cooking: false });
  assertEquals([tables.cooking_now.length, (await s.live(MOM)).length], [0, 0]);
  assertEquals((await s.start(LEO, chili(2))).consent, "no");
  assertEquals(tables.cooking_now.length, 0);
  await httpError(s.setShare(LEO, { share: "yes" }), 400, "share must be true or false");
  await httpError(s.setShare(LEO, {}), 400, "share must be true or false");
  assertEquals(s.rate.filter((r) => r.startsWith("share-cooking")), [`share-cooking:${LEO}:30:60`, `share-cooking:${LEO}:30:60`]);
});

t("a cook cooking another cook's dish works the same: the session is the acting person's", async () => {
  const tables = family();
  tables.profiles.push({
    id: "77777777-7777-4777-8777-777777777777", family_id: FAM, name: "Grandma", role: "cook", relation: null,
    avatar_key: null, sort: 0, tz: LA, memorial: false, removed_at: null, share_cooking: true,
  });
  const s = setup(tables);
  await s.start("77777777-7777-4777-8777-777777777777", chili(1));
  assertEquals(tables.cooking_now.map((r) => r.profile_id), ["77777777-7777-4777-8777-777777777777"]);
  await R.backgroundIdle();
  assertEquals(s.expo.sent.map((m) => m.title), ["Grandma is making your Sunday Chili"]);
});

// --- copy & reaction rules ---------------------------------------------------------------------

t("dishName matches the app's rule", () => {
  assertEquals(C.dishName("Mom's Sunday Chili", "Mom"), "Sunday Chili");
  assertEquals(C.dishName("Grandma’s Dumplings", "Grandma"), "Dumplings");
  assertEquals(C.dishName("Auntie Lin's Noodles", "Mom"), "Noodles"); // a short possessive
  assertEquals(C.dishName("Braised Pork Belly with Eggs and Rice", "Dad"), "Braised Pork Belly");
  assertEquals(C.dishName("", "Dad"), "recipe");
  assertEquals(C.dishName(null), "recipe");
});

t("startedPush: a long name or dish stays one line of at most 90 characters", () => {
  const p = C.startedPush("Leo".repeat(30), { title: "Chili ".repeat(30), cook_name: "Mom" }, 2, 9);
  assert(Array.from(p.title).length <= 90);
  assertEquals([p.kind, p.body, p.url], ["started", "Right now, step 2 of 9.", "/parent/home"]);
});

t("reactionPush: hearts never push; 'Just like mine' pushes the kid who made the dish, once", () => {
  const thread = "8b1c0d6e-0000-4000-8000-000000000001";
  const made = { id: "m1", kind: "cooked", sender_id: LEO };
  const mom = { id: MOM, name: "Mom" };
  assertEquals(C.reactionPush({ body: "heart", thread_id: thread, reply_to: null }, mom, null, "Sunday Chili"), null);
  assertEquals(C.reactionPush({ body: "heart", thread_id: thread, reply_to: "m1" }, mom, made, "Sunday Chili"), null);
  assertEquals(C.reactionPush({ body: "just_like_mine", thread_id: thread, reply_to: "m1" }, mom, made, "Sunday Chili"), {
    to: LEO,
    copy: { kind: "reaction", title: "Mom", body: "“Just like mine.” on your Sunday Chili", url: `/chat/${thread}` },
    dedupeKey: "reaction:m1:just_like_mine",
  });
  // Without a dish name it still says what was said, and nothing more.
  assertEquals(C.reactionPush({ body: "just_like_mine", thread_id: thread, reply_to: "m1" }, mom, made, null)?.copy.body, "“Just like mine.”");
  // Not on a text, not on my own dish, not without the dish it answers, not a different message.
  assertEquals(C.reactionPush({ body: "just_like_mine", thread_id: thread, reply_to: "m1" }, mom, { ...made, kind: "text" }, null), null);
  assertEquals(C.reactionPush({ body: "just_like_mine", thread_id: thread, reply_to: "m1" }, { id: LEO, name: "Leo" }, made, null), null);
  assertEquals(C.reactionPush({ body: "just_like_mine", thread_id: thread, reply_to: null }, mom, null, null), null);
  assertEquals(C.reactionPush({ body: "just_like_mine", thread_id: thread, reply_to: "m2" }, mom, made, null), null);
  assertEquals(C.reactionPush({ body: "wow", thread_id: thread, reply_to: "m1" }, mom, made, null), null);
  assert(C.isReaction("heart") && C.isReaction("just_like_mine"));
  assertFalse(C.isReaction("Heart") || C.isReaction(null));
});

t("copy never assumes a gender and has no guilt words", () => {
  const lines = [
    C.startedPush("Leo", { title: "Sunday Chili", cook_name: "Mom" }, 1, 8),
    C.reactionPush({ body: "just_like_mine", thread_id: "t", reply_to: "m" }, { id: MOM, name: "Mom" }, { id: "m", kind: "cooked", sender_id: LEO }, "Chili")!.copy,
  ].flatMap((p) => [p.title, p.body]);
  for (const line of lines) {
    assertFalse(/\b(he|she|his|her|him|hers)\b/i.test(line), line);
    assertFalse(/\b(lost|expired|broken|missed|miss)\b/i.test(line), line);
  }
});

t("consentOf reads null as not asked, false as no", () => {
  assertEquals([C.consentOf(true), C.consentOf(false), C.consentOf(null), C.consentOf(undefined)], ["yes", "no", "unasked", "unasked"]);
});

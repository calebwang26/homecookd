// Offline checks for Month in the kitchen's route & cron job (supabase/functions/api/recapPr.ts; handoff
// 3.7): ?month= validation & the default (last month on my clock), the kid's & the cook's slides in
// order with every number from that month's rows only, postcards signed (never a storage path), photos
// that can't be signed, an empty month, memorial people, a 503 while the library is unreachable, paging
// past PostgREST's 1000-row cap, and the 1st-of-month push through the real cron route (who is due,
// signed-out phones left out, the copy, once per month, nothing for an empty month or while the library
// is unreachable). No database and no network: an in-memory stand-in
// for the Supabase client (with the 1000-row cap) and a fake Expo.
//
// The made-up family below cooked in October 2026, a month before the first edition (FIRST_MONTH is
// November: the first card & push go out on Dec 1), so recapFor() opens October with makeRecap's
// `firstMonth` override. The tests marked "the real FIRST_MONTH" leave it out, as index.ts does.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/recap_route_test.ts

import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1.0.13";

import * as P from "../functions/api/recapPr.ts";
import type { RecipeInfo } from "../functions/api/recap.ts";
import { makeRetention, type RetentionCtx } from "../functions/api/retention.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

// --- an in-memory PostgREST stand-in --------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
/** Supabase's default max_rows: no select returns more, whatever its range or limit. */
const MAX_ROWS = 1000;
const UNIQUE: Record<string, string[][]> = { push_tokens: [["token"]], notification_log: [["profile_id", "dedupe_key"]] };

const cmp = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "") < String(b ?? "") ? -1 : String(a ?? "") > String(b ?? "") ? 1 : 0;
const time = (v: unknown) => Date.parse(String(v));

function fakeDb(tables: Tables, opts: { rpc?: (fn: string, args: Row) => unknown } = {}) {
  const queries: string[] = [];
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private cols: string[] | null = null;
    private filters: ((r: Row) => boolean)[] = [];
    private orders: [string, boolean][] = [];
    private first = 0;
    private last = Infinity;
    private max = Infinity;
    private single = false;
    constructor(private table: string) {
      queries.push(table);
    }
    select(cols = "*") {
      if (this.op === "select") this.cols = cols.trim() === "*" ? null : cols.split(",").map((c) => c.trim());
      return this;
    }
    insert(row: Row) { this.op = "insert"; this.payload = row; return this; }
    update(row: Row) { this.op = "update"; this.payload = row; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, op: string, v: unknown) {
      if (op !== "is") throw new Error(`fake db: unsupported not.${op}`);
      this.filters.push((r) => (r[c] ?? null) !== v);
      return this;
    }
    gt(c: string, v: string) { this.filters.push((r) => time(r[c]) > time(v)); return this; }
    gte(c: string, v: string) { this.filters.push((r) => time(r[c]) >= time(v)); return this; }
    lt(c: string, v: string) { this.filters.push((r) => time(r[c]) < time(v)); return this; }
    order(c: string, o: { ascending?: boolean } = {}) { this.orders.push([c, o.ascending !== false]); return this; }
    range(a: number, b: number) { this.first = a; this.last = b; return this; }
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
        for (const cols of UNIQUE[this.table] ?? []) {
          if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
          if (rows.some((r) => cols.every((c) => r[c] === row[c]))) return { data: null, error: { code: "23505", message: "duplicate key value" } };
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
      let found = rows.filter(hit);
      if (this.orders.length) {
        found = [...found].sort((a, b) => {
          for (const [c, asc] of this.orders) {
            const d = cmp(a[c], b[c]);
            if (d) return asc ? d : -d;
          }
          return 0;
        });
      }
      found = found.slice(this.first, this.last + 1).slice(0, this.max).slice(0, MAX_ROWS);
      const cols = this.cols;
      const out = cols ? found.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))) : found.map((r) => ({ ...r }));
      return { data: this.single ? out[0] ?? null : out, error: null };
    }
  }
  const db = {
    from: (table: string) => new Query(table),
    rpc: (fn: string, args: Row) => Promise.resolve({ data: opts.rpc ? opts.rpc(fn, args) : null, error: null }),
  };
  return { db: db as unknown as P.RecapDeps<P.RecapCtx>["db"], queries };
}

// --- a family with an October ------------------------------------------------------------------------

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const FAM = "11111111-1111-4111-8111-111111111111";
const MOM = "22222222-2222-4222-8222-222222222222"; // cook
const DAD = "33333333-3333-4333-8333-333333333333"; // cook
const GRAN = "44444444-4444-4444-8444-444444444444"; // cook, memorial
const LEO = "55555555-5555-4555-8555-555555555555"; // learner
const MAYA = "66666666-6666-4666-8666-666666666666"; // learner, New York
const SAM = "77777777-7777-4777-8777-777777777777"; // learner, removed
const T_LEO_MOM = "a1111111-1111-4111-8111-111111111111";
const T_LEO_DAD = "a2222222-2222-4222-8222-222222222222";
const T_MAYA_MOM = "a3333333-3333-4333-8333-333333333333";
const T_CIRCLE = "a4444444-4444-4444-8444-444444444444";

const RECIPES = new Map<string, RecipeInfo>([
  ["mom-dumplings", { title: "Dumplings", cook_name: "Mom", sample: false }],
  ["mom-soup", { title: "Winter Soup", cook_name: "Mom", sample: false }],
  ["dad-chili", { title: "Sunday Chili", cook_name: "Dad", sample: false }],
  ["dad-ribs", { title: "Ribs", cook_name: "Dad", sample: false }],
  ["dad-sample", { title: "Sample Stew", cook_name: "Dad", sample: true }],
  ["leo-toast", { title: "Toast", cook_name: "Leo", sample: false }],
]);

const pad = (n: number) => String(n).padStart(2, "0");
/** Midday in LA on that October day. */
const oct = (d: number, hour = 19) => `2026-10-${pad(d)}T${pad(hour)}:00:00.000Z`;
let seq = 0;
const id = () => `e${String(++seq).padStart(6, "0")}-0000-4000-8000-000000000000`;

const profile = (pid: string, name: string, role: string, extra: Row = {}) =>
  ({ id: pid, family_id: FAM, name, role, relation: null, avatar_key: null, tz: LA, memorial: false, removed_at: null, ...extra });
const event = (profile_id: string, recipe_id: string, kind: string, created_at: string, extra: Row = {}) =>
  ({ id: id(), family_id: FAM, profile_id, recipe_id, kind, cook_id: null, duration_s: null, clip_start_s: null, created_at, ...extra });
const message = (sender_id: string, thread_id: string, kind: string, created_at: string, extra: Row = {}) =>
  ({ id: id(), family_id: FAM, thread_id, sender_id, kind, body: null, recipe_id: null, step_order: null, photo_path: null, reply_to: null, created_at, ...extra });
const postcard = (sender_id: string, thread_id: string, recipe_id: string, created_at: string, photo = true) => {
  const m = message(sender_id, thread_id, "cooked", created_at, { recipe_id });
  return { ...m, photo_path: photo ? `${FAM}/${m.id}.jpg` : null };
};
const heart = (profile_id: string, recipe_id: string, created_at: string) => ({ profile_id, recipe_id, created_at });

function family(): Tables {
  return {
    profiles: [
      profile(MOM, "Mom", "cook"),
      profile(DAD, "Dad", "cook"),
      profile(GRAN, "Grandma", "cook", { memorial: true }),
      profile(LEO, "Leo", "learner"),
      profile(MAYA, "Maya", "learner", { tz: NY }),
      profile(SAM, "Sam", "learner", { removed_at: "2026-10-01T00:00:00Z" }),
    ],
    threads: [
      { id: T_LEO_MOM, family_id: FAM, kind: "pair", a_profile: MOM, b_profile: LEO },
      { id: T_LEO_DAD, family_id: FAM, kind: "pair", a_profile: DAD, b_profile: LEO },
      { id: T_MAYA_MOM, family_id: FAM, kind: "pair", a_profile: MOM, b_profile: MAYA },
      { id: T_CIRCLE, family_id: FAM, kind: "circle", a_profile: null, b_profile: null },
    ],
    recipe_events: [],
    messages: [],
    favorites: [],
    devices: [],
    push_tokens: [],
    notification_log: [],
  };
}

/** Leo's October: 3 family dishes (chili twice), 2 minutes of Mom's voice, 2 hearts, 2 postcards. */
function leosOctober(tables: Tables) {
  tables.recipe_events.push(
    event(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }),
    event(LEO, "dad-chili", "cooked", oct(10)), // no cook_id: the library says Dad
    event(LEO, "mom-dumplings", "cooked", oct(12), { cook_id: MOM }),
    event(LEO, "leo-toast", "cooked", oct(13)), // his own dish
    event(LEO, "dad-chili", "cooked", "2026-10-01T06:30:00.000Z"), // Sep 30, 23:30 in LA
    event(LEO, "dad-chili", "cooked", "2026-11-01T07:30:00.000Z"), // Nov 1, 00:30 in LA
    event(LEO, "mom-dumplings", "viewed", oct(12)),
    event(LEO, "mom-dumplings", "heard", oct(5), { cook_id: MOM, duration_s: 40, clip_start_s: 12 }),
    event(LEO, "mom-dumplings", "heard", oct(6), { cook_id: MOM, duration_s: "35", clip_start_s: "12" }),
    event(LEO, "mom-dumplings", "heard", oct(7), { cook_id: MOM, duration_s: 50, clip_start_s: 80 }),
    event(LEO, "dad-sample", "heard", oct(8), { cook_id: DAD, duration_s: 600, clip_start_s: 0 }), // a sample isn't Dad's voice
  );
  tables.messages.push(
    postcard(LEO, T_LEO_DAD, "dad-chili", oct(3)),
    postcard(LEO, T_LEO_DAD, "dad-chili", oct(10), false),
    postcard(LEO, T_LEO_MOM, "mom-dumplings", oct(12)),
    message(LEO, T_LEO_MOM, "text", oct(12), { body: "So good" }),
  );
  tables.favorites.push(
    heart(LEO, "dad-ribs", oct(5)),
    heart(LEO, "mom-soup", oct(6)),
    heart(LEO, "leo-toast", oct(6)),
    heart(LEO, "dad-chili", "2026-09-20T19:00:00.000Z"),
  );
}

/** Mom's October: her dishes cooked 4 times (Maya twice, Leo, Dad), Winter Soup loved twice, 1 postcard, 2 answers. */
function momsOctober(tables: Tables) {
  const q1 = message(LEO, T_LEO_MOM, "question", "2026-09-28T19:00:00.000Z", { body: "How much ginger?", recipe_id: "mom-dumplings" });
  const q2 = message(LEO, T_LEO_MOM, "question", oct(9, 16), { body: "Lid on or off?", recipe_id: "mom-soup" });
  const q3 = message(MAYA, T_CIRCLE, "question", oct(11, 16), { body: "Who has the big pot?" });
  const q4 = message(MAYA, T_MAYA_MOM, "question", oct(30, 16), { body: "Fresh or dried?" });
  tables.messages.push(
    q1, q2, q3, q4,
    message(MOM, T_LEO_MOM, "text", oct(2), { body: "A thumb of it.", reply_to: q1.id }), // an older question, answered now
    message(MOM, T_LEO_MOM, "voice", oct(9, 17), { reply_to: q2.id, duration_s: 12 }),
    message(DAD, T_CIRCLE, "text", oct(11, 17), { body: "Me.", reply_to: q3.id }), // Dad answered first
    message(MOM, T_CIRCLE, "text", oct(11, 18), { body: "Dad does.", reply_to: q3.id }),
    message(MOM, T_MAYA_MOM, "text", "2026-11-02T19:00:00.000Z", { body: "Dried.", reply_to: q4.id }), // November
    postcard(LEO, T_LEO_MOM, "mom-dumplings", oct(12)),
    postcard(LEO, T_LEO_DAD, "dad-chili", oct(3)), // Dad's dish, Dad's thread
    postcard(MAYA, T_CIRCLE, "mom-soup", oct(20)), // in the circle, not to Mom
  );
  tables.recipe_events.push(
    event(LEO, "mom-dumplings", "cooked", oct(12), { cook_id: MOM }),
    event(MAYA, "mom-soup", "cooked", oct(14)),
    event(MAYA, "mom-soup", "cooked", oct(20)),
    event(DAD, "mom-dumplings", "cooked", oct(15)), // another cook: counted, not a face
    event(MOM, "mom-soup", "cooked", oct(16)), // her own cooking
    event(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }), // Dad's dish
    event(MAYA, "mom-soup", "cooked", "2026-09-29T19:00:00.000Z"), // September
  );
  tables.favorites.push(
    heart(LEO, "mom-soup", oct(6)),
    heart(MAYA, "mom-soup", oct(7)),
    heart(LEO, "mom-dumplings", oct(8)),
    heart(MOM, "mom-dumplings", oct(8)), // her own heart
    heart(LEO, "dad-ribs", oct(8)),
  );
}

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
type Ctx = { family: { id: string; name: string }; me: { id: string } | null };
const ctxAs = (me: string | null): Ctx => ({ family: { id: FAM, name: "Test family" }, me: me ? { id: me } : null });

/** Stands in for index.ts's answersFor(): the earliest reply from a cook other than the asker. */
function fakeAnswers(tables: Tables, seen: string[][]) {
  return (fam: P.RecapFamily, questions: P.QuestionRow[]) => {
    seen.push(questions.map((q) => q.id).sort());
    const cooks = new Set(fam.profiles.filter((p) => p.role === "cook").map((p) => p.id));
    const out = new Map<string, { by: string; at: string }>();
    for (const q of questions) {
      const first = tables.messages
        .filter((m) => m.reply_to === q.id && m.sender_id !== q.sender_id && cooks.has(m.sender_id))
        .sort((a, b) => cmp(a.created_at, b.created_at))[0];
      if (first) out.set(q.id, { by: first.sender_id, at: first.created_at });
    }
    return Promise.resolve(out);
  };
}

type Setup = {
  now?: string;
  sign?: "all" | "none" | ((paths: string[]) => Map<string, string>);
  library?: () => Map<string, RecipeInfo>;
  /** Leave out makeRecap's `firstMonth` (as index.ts does): October 2026 isn't an edition. */
  realFirstMonth?: boolean;
};

/** This file's family cooked in October: its first month (makeRecap's `firstMonth`, tests only). */
const OCTOBER = "2026-10";

function recapFor(tables: Tables, s: Setup = {}) {
  const { db, queries } = fakeDb(tables, { rpc: (fn, args) => fn === "cron_secret_ok" && args.p_secret === "test-cron" });
  const answersSeen: string[][] = [];
  const signed: string[][] = [];
  const sign = s.sign ?? "all";
  const r = P.makeRecap<Ctx>({
    db,
    HttpError,
    requireMe: (ctx) => {
      if (!ctx.me) throw new HttpError(400, "x-profile-id header is required for this request");
      return ctx.me;
    },
    dbFail: (context) => {
      throw new Error(`db fail: ${context}`);
    },
    library: { libraryIndex: () => Promise.resolve(s.library ? s.library() : RECIPES) },
    answersFor: fakeAnswers(tables, answersSeen),
    signPhotos: sign === "none" ? undefined : (paths) => {
      signed.push(paths);
      return Promise.resolve(
        typeof sign === "function" ? sign(paths) : new Map(paths.map((p) => [p, `https://signed.example/${p}?token=1h`])),
      );
    },
    clock: () => new Date(s.now ?? "2026-11-03T18:00:00Z"),
    firstMonth: s.realFirstMonth ? undefined : OCTOBER,
  });
  const get = (me: string | null, month?: string) =>
    r.getRecap({ ctx: ctxAs(me), url: new URL(`http://x/api/recap${month === undefined ? "" : `?month=${encodeURIComponent(month)}`}`) });
  return { r, db, queries, get, answersSeen, signed };
}

async function httpError(p: Promise<unknown>, status: number, message: string) {
  const e = await assertRejects(() => p, HttpError);
  assertEquals([e.status, e.message], [status, message]);
}

type Full = Extract<P.RecapResponse, { slides: unknown }>;
const full = (r: P.RecapResponse): Full => {
  assert(!("empty" in r), "expected a recap, got an empty month");
  return r as Full;
};
const types = (r: P.RecapResponse) => ("empty" in r ? [] : r.slides.map((s) => s.type));
const slide = <T extends P.RecapSlide["type"]>(r: P.RecapResponse, type: T) =>
  full(r).slides.find((s) => s.type === type) as Extract<P.RecapSlide, { type: T }> | undefined;

// --- months -----------------------------------------------------------------------------------------

t("previousMonth is the month before on the person's own clock, across the year end", () => {
  assertEquals(P.previousMonth(new Date("2026-11-01T10:10:00-08:00"), LA), "2026-10");
  // Nov 1 02:00 UTC is still Oct 31 in LA but already Nov 1 in Kolkata.
  assertEquals(P.previousMonth(new Date("2026-11-01T02:00:00Z"), LA), "2026-09");
  assertEquals(P.previousMonth(new Date("2026-11-01T02:00:00Z"), "Asia/Kolkata"), "2026-10");
  assertEquals(P.previousMonth(new Date("2027-01-01T18:00:00Z"), LA), "2026-12");
  assertEquals(P.previousMonth(new Date("2026-11-01T18:00:00Z"), "Not/AZone"), "2026-10"); // the default zone
});

t("?month= is YYYY-MM or missing; a month before the first edition or after this one is empty", () => {
  assertEquals(P.monthParam(null), { ok: true, month: null });
  assertEquals(P.monthParam("  "), { ok: true, month: null });
  assertEquals(P.monthParam("2026-10"), { ok: true, month: "2026-10" });
  for (const bad of ["2026-13", "2026-1", "26-10", "2026-10-01", "october", "2026/10", "2026-00"]) {
    assertEquals(P.monthParam(bad), { ok: false, error: "month must be YYYY-MM" }, bad);
  }
  // The real FIRST_MONTH: the first edition is Dec 1, for November (handoff 3.7). October is empty.
  assertEquals(P.FIRST_MONTH, "2026-11");
  const now = new Date("2026-11-03T18:00:00Z");
  assertEquals(P.resolveMonth(null, now, LA), { month: "2026-10", live: false });
  assertEquals(P.resolveMonth("2026-11", now, LA), { month: "2026-11", live: true }); // so far this month
  assertEquals(P.resolveMonth("2026-12", now, LA), { month: "2026-12", live: false });
  assertEquals(P.resolveMonth(null, new Date("2026-12-01T18:00:00Z"), LA), { month: "2026-11", live: true });
  // This file's October family: the same rules from October on.
  assertEquals(P.resolveMonth(null, now, LA, OCTOBER), { month: "2026-10", live: true });
  assertEquals(P.resolveMonth("2026-09", now, LA, OCTOBER), { month: "2026-09", live: false });
  assertEquals(P.resolveMonth(null, new Date("2026-10-20T18:00:00Z"), LA, OCTOBER), { month: "2026-09", live: false });
});

// --- GET /recap -------------------------------------------------------------------------------------

t("routes: one signed-in GET /recap", () => {
  const { r } = recapFor(family());
  assertEquals(r.routes.map((x) => [x.method, x.path, x.auth]), [["GET", "/recap", {}]]);
  assertEquals(r.cronJob.name, "recap");
});

t("GET /recap needs a person and a well-formed month, refused before any query", async () => {
  const tables = family();
  const { get, queries } = recapFor(tables);
  await httpError(get(null, "2026-10"), 400, "x-profile-id header is required for this request");
  await httpError(get(LEO, "2026-13"), 400, "month must be YYYY-MM");
  await httpError(get(LEO, "last month"), 400, "month must be YYYY-MM");
  assertEquals(queries, []);
});

t("GET /recap: a kid's October, every slide in order, numbers from October's rows only", async () => {
  const tables = family();
  leosOctober(tables);
  const { get } = recapFor(tables);
  const r = full(await get(LEO, "2026-10"));
  assertEquals([r.month, r.role], ["2026-10", "learner"]);
  assertEquals(types(r), ["cover", "cooked", "most_made", "voices", "hearts_left", "then_now", "close"]);
  assertEquals(r.slides.map((s) => s.title), [
    "Your October in the kitchen",
    "You cooked 3 family dishes",
    "Most made: Dad's Sunday Chili, twice",
    "2 minutes of family voices",
    "Hearts you left: 2",
    "Then & now",
    "See you at the table in November.",
  ]);
  const cooked = slide(r, "cooked")!;
  assertEquals(cooked.value, 3);
  assertEquals(cooked.photos.map((p) => p.recipe_id), ["dad-chili", "mom-dumplings"]);
  assert(cooked.photos.every((p) => p.photo_url.startsWith("https://signed.example/")));
  assertEquals(slide(r, "most_made"), {
    type: "most_made", title: "Most made: Dad's Sunday Chili, twice", value: 2, recipe_id: "dad-chili", cook_id: DAD,
  });
  // 40 + 35 + 50 s of Mom's voice; the sample's 600 s are not her voice.
  const voices = slide(r, "voices")!;
  assertEquals([voices.value, voices.seconds, voices.clip], [2, 125, { recipe_id: "mom-dumplings", cook_id: MOM, start_s: 12, plays: 2 }]);
  assertEquals(slide(r, "hearts_left")!.value, 2);
  assertEquals(slide(r, "then_now")!.photos.map((p) => p.at), [oct(3), oct(12)]);
  // Postcards carry signed URLs only: the storage path never leaves the server.
  assertFalse(JSON.stringify(r).includes("photo_path"));
  for (const p of [...cooked.photos, ...slide(r, "then_now")!.photos]) {
    assertEquals(Object.keys(p).sort(), ["at", "message_id", "photo_url", "recipe_id"]);
  }
});

t("GET /recap with no month is last month on my clock", async () => {
  const tables = family();
  leosOctober(tables);
  const { get } = recapFor(tables, { now: "2026-11-01T18:00:00Z" });
  assertEquals(full(await get(LEO)).month, "2026-10");
  // Nov 1 05:00 UTC is still Oct 31 in LA: last month there is September (before October: empty).
  const early = recapFor(tables, { now: "2026-11-01T05:00:00Z" });
  assertEquals(await early.get(LEO), { empty: true });
});

t("GET /recap: a cook's October, faces of the kids, hearts on her dishes, her postcards & first answers", async () => {
  const tables = family();
  momsOctober(tables);
  const { get, answersSeen } = recapFor(tables);
  const r = full(await get(MOM, "2026-10"));
  assertEquals([r.month, r.role], ["2026-10", "cook"]);
  assertEquals(types(r), ["cover", "dishes_cooked", "most_loved", "postcards", "answered", "close"]);
  assertEquals(slide(r, "dishes_cooked"), {
    type: "dishes_cooked", title: "Your dishes were cooked 4 times", value: 4,
    // Leo first cooked hers on Oct 12, Maya on Oct 14 (and again on the 20th): first come, first shown,
    // never ranked by how often, and no count per kid.
    faces: [{ profile_id: LEO }, { profile_id: MAYA }],
  });
  assertEquals(slide(r, "most_loved"), { type: "most_loved", title: "Most loved: Winter Soup (♥ 2)", value: 2, recipe_id: "mom-soup" });
  const cards = slide(r, "postcards")!;
  assertEquals([cards.title, cards.photos.map((p) => p.recipe_id)], ["Postcards you got: 1", ["mom-dumplings"]]);
  // Her October replies point at q1 (asked in September), q2 & q3; Dad answered q3 first.
  assertEquals(slide(r, "answered")!.title, "Questions you answered: 2");
  assertEquals(answersSeen.length, 1);
  assertEquals(answersSeen[0].length, 3);
});

t("GET /recap: an empty month, a memorial person, and someone else's month are all empty", async () => {
  const tables = family();
  leosOctober(tables);
  const { get } = recapFor(tables);
  assertEquals(await get(MAYA, "2026-10"), { empty: true }); // nothing of hers
  assertEquals(await get(GRAN, "2026-10"), { empty: true }); // memorial
  assertEquals(await get(SAM, "2026-10"), { empty: true }); // removed
  assertEquals(await get(LEO, "2026-12"), { empty: true }); // the future
});

t("GET /recap: the current month so far counts what's there", async () => {
  const tables = family();
  leosOctober(tables);
  const { get } = recapFor(tables, { now: "2026-11-03T18:00:00Z" });
  // The Nov 1 00:30 chili (LA time) is November's.
  const r = full(await get(LEO, "2026-11"));
  assertEquals(types(r), ["cover", "cooked", "close"]);
  assertEquals(slide(r, "cooked")!.title, "You cooked 1 family dish");
});

t("GET /recap with the real FIRST_MONTH: October is empty without a query; November so far counts", async () => {
  const tables = family();
  leosOctober(tables);
  const { get, queries } = recapFor(tables, { realFirstMonth: true, now: "2026-11-03T18:00:00Z" });
  assertEquals(await get(LEO, "2026-10"), { empty: true });
  assertEquals(await get(LEO), { empty: true }); // last month on his clock: October
  assertEquals(await get(MOM, "2026-10"), { empty: true });
  assertFalse(queries.includes("recipe_events"), "no October is loaded");
  assertEquals(slide(await get(LEO, "2026-11"), "cooked")!.title, "You cooked 1 family dish");
});

t("GET /recap: photos that can't be signed are left out, and Then & now needs both", async () => {
  const tables = family();
  leosOctober(tables);
  const late = tables.messages.find((m) => m.recipe_id === "mom-dumplings" && m.photo_path)!.photo_path;
  const partly = recapFor(tables, { sign: (paths) => new Map(paths.filter((p) => p !== late).map((p) => [p, `https://signed.example/${p}`])) });
  const r = full(await partly.get(LEO, "2026-10"));
  assertEquals(types(r), ["cover", "cooked", "most_made", "voices", "hearts_left", "close"]);
  assertEquals(slide(r, "cooked")!.photos.length, 1);
  assertEquals(partly.signed.length, 1); // one signing call for every photo
  // No signer at all (before qa-cook's photos bucket lands): the numbers still show.
  const none = full(await recapFor(tables, { sign: "none" }).get(LEO, "2026-10"));
  assertEquals(types(none), ["cover", "cooked", "most_made", "voices", "hearts_left", "close"]);
  assertEquals(slide(none, "cooked")!.photos, []);
  // A signer that throws is the same as none.
  const broken = recapFor(tables, { sign: () => { throw new Error("storage down"); } });
  assertEquals(types(await broken.get(LEO, "2026-10")).includes("then_now"), false);
});

t("signSlides: a month whose only slide was Then & now is empty without its photos", () => {
  const photo = (n: number) => ({ message_id: `m${n}`, photo_path: `p${n}.jpg`, recipe_id: "dad-chili", at: oct(n) });
  const recap = {
    month: "2026-10", role: "learner" as const,
    slides: [
      { type: "cover" as const, title: "Your October in the kitchen" },
      { type: "then_now" as const, title: "Then & now", photos: [photo(1), photo(2)] as [ReturnType<typeof photo>, ReturnType<typeof photo>] },
      { type: "close" as const, title: "See you at the table in November." },
    ],
  };
  assertEquals(P.signSlides(recap, new Map([["p1.jpg", "u1"]])), { empty: true });
  assertEquals(P.signSlides({ empty: true }, new Map()), { empty: true });
  const ok = full(P.signSlides(recap, new Map([["p1.jpg", "u1"], ["p2.jpg", "u2"]])));
  assertEquals(ok.slides[1], {
    type: "then_now", title: "Then & now",
    photos: [{ message_id: "m1", photo_url: "u1", recipe_id: "dad-chili", at: oct(1) }, { message_id: "m2", photo_url: "u2", recipe_id: "dad-chili", at: oct(2) }],
  });
  assertEquals(P.photoPaths(recap), ["p1.jpg", "p2.jpg"]);
});

t("GET /recap with the library unreachable is a 503, never a smaller month (the app keeps the card)", async () => {
  const tables = family();
  leosOctober(tables);
  const { get, queries } = recapFor(tables, { library: () => new Map() });
  await httpError(get(LEO, "2026-10"), 503, "Can’t reach the family recipes right now. Try again.");
  assertFalse(queries.includes("recipe_events"), "no month is built without the library");
  // A month that can't hold anything needs no library: still empty.
  assertEquals(await get(LEO, "2026-12"), { empty: true });
});

t("GET /recap pages past PostgREST's 1000-row cap: 1300 clips all count", async () => {
  const tables = family();
  for (let i = 0; i < 1300; i++) {
    const at = new Date(Date.parse(oct(2)) + i * 60_000).toISOString();
    tables.recipe_events.push(event(LEO, "mom-dumplings", "heard", at, { cook_id: MOM, duration_s: 3, clip_start_s: i % 7 }));
  }
  const { get } = recapFor(tables);
  // 1300 x 3 s = 65 minutes (a single capped select would say 50).
  assertEquals(slide(await get(LEO, "2026-10"), "voices")!.title, "65 minutes of family voices");
});

t("GET /recap reads only what the slides need: a kid's own rows, a cook's hearts only on her dishes", async () => {
  const tables = family();
  leosOctober(tables);
  momsOctober(tables);
  const kid = recapFor(tables);
  await kid.get(LEO, "2026-10");
  assertFalse(kid.queries.includes("threads"), "a kid's postcards need no threads");
  assertEquals(kid.answersSeen, [], "a kid's recap never looks for answers");
  // A cook with no dishes in the library reads no hearts at all.
  const tables2 = family();
  tables2.profiles.push(profile("88888888-8888-4888-8888-888888888888", "Auntie", "cook"));
  tables2.favorites.push(heart(LEO, "mom-soup", oct(6)));
  const aunt = recapFor(tables2);
  assertEquals(await aunt.get("88888888-8888-4888-8888-888888888888", "2026-10"), { empty: true });
  assertFalse(aunt.queries.includes("favorites"));
});

// --- the 1st-of-month push ----------------------------------------------------------------------------

t("maybeLocalFirst: true only while it's the 1st somewhere between UTC-12 and UTC+14", () => {
  assertFalse(P.maybeLocalFirst(new Date("2026-10-31T09:59:00Z"))); // Kiritimati: Oct 31 23:59
  assert(P.maybeLocalFirst(new Date("2026-10-31T10:00:00Z"))); // Kiritimati: Nov 1 00:00
  assert(P.maybeLocalFirst(new Date("2026-11-01T12:00:00Z")));
  assert(P.maybeLocalFirst(new Date("2026-11-02T11:59:00Z"))); // UTC-12: Nov 1 23:59
  assertFalse(P.maybeLocalFirst(new Date("2026-11-02T12:00:00Z")));
  assertFalse(P.maybeLocalFirst(new Date("2026-11-15T12:00:00Z")));
});

t("recapDue: the local 1st from 10:00 until quiet hours, any offset; never memorial or removed", () => {
  const who = (tz: string, extra: Row = {}) => ({ tz, memorial: false, removed_at: null, ...extra });
  const due = (iso: string, p: ReturnType<typeof who>) => P.recapDue([p], new Date(iso)).length === 1;
  assert(due("2026-11-01T10:00:00+05:30", who("Asia/Kolkata")));
  assertFalse(due("2026-11-01T09:59:00+05:30", who("Asia/Kolkata")));
  assert(due("2026-11-01T20:59:00+05:30", who("Asia/Kolkata")));
  assertFalse(due("2026-11-01T21:00:00+05:30", who("Asia/Kolkata"))); // quiet hours
  assert(due("2026-11-01T10:00:00+14:00", who("Pacific/Kiritimati")));
  assert(due("2026-11-01T10:30:00-11:00", who("Pacific/Pago_Pago")));
  assertFalse(due("2026-11-02T10:30:00-08:00", who(LA)));
  assertFalse(due("2026-11-01T10:30:00-08:00", who(LA, { memorial: true })));
  assertFalse(due("2026-11-01T10:30:00-08:00", who(LA, { removed_at: "2026-10-01T00:00:00Z" })));
  assert(due("2026-11-01T10:30:00-08:00", who("")), "no zone yet: the default");
});

/** Leo cooked Dad's chili twice in October; nobody else did anything. */
function quietOctober(tables: Tables) {
  tables.recipe_events.push(
    event(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }),
    event(LEO, "dad-chili", "cooked", oct(17), { cook_id: DAD }),
  );
  let n = 0;
  for (const p of [LEO, MAYA, MOM, DAD, GRAN, SAM]) {
    tables.push_tokens.push({ token: `ExponentPushToken[t${++n}]`, family_id: FAM, profile_id: p, device_id: null, platform: "ios" });
  }
}

function cron(tables: Tables, s: Setup = {}) {
  const { r, db, queries } = recapFor(tables, s);
  const pushed: Row[] = [];
  const expo = ((_url: string | URL | Request, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as Row[];
    pushed.push(...batch);
    return Promise.resolve(
      new Response(JSON.stringify({ data: batch.map(() => ({ status: "ok", id: crypto.randomUUID() })) }), {
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  const retention = makeRetention({
    db,
    HttpError,
    requireMe: (ctx: RetentionCtx) => ctx.me!, // the cron route never asks for a person
    rateLimit: () => Promise.resolve(),
    dbFail: (context) => {
      throw new Error(`db fail: ${context}`);
    },
    clientIp: () => "203.0.113.9",
    fetch: expo,
  });
  retention.cronJobs.push(r.cronJob);
  const run = async (now: string) =>
    (await retention.cronHourly({
      req: new Request("http://x/api/cron/hourly", { method: "POST", headers: { "x-cron-secret": "test-cron" } }),
      body: () => Promise.resolve({ now }),
    })) as { jobs: Record<string, number> };
  return { run, pushed, queries };
}

t("cron: on the 1st at 10:xx local, one recap push per non-empty month, in the slides' own words", async () => {
  const tables = family();
  quietOctober(tables);
  const { run, pushed } = cron(tables);
  const out = await run("2026-11-01T10:10:00-08:00"); // Maya's 13:10 in New York: due too
  assertEquals(out.jobs.recap, 2);
  assertEquals(
    pushed.map((m) => [m.to, m.title, m.body, m.data.url, m.data.kind]).sort(),
    [
      ["ExponentPushToken[t1]", "Your October in the kitchen", "2 dishes.", "/recap?month=2026-10", "recap"], // Leo
      ["ExponentPushToken[t4]", "Your October in the kitchen", "Your dishes were cooked twice.", "/recap?month=2026-10", "recap"], // Dad
    ],
  );
  // Logged as app-initiated (capped) with the month's dedupe key; Maya & Mom (empty), Grandma
  // (memorial) & Sam (removed) get nothing, not even a log row.
  assertEquals(
    tables.notification_log.map((x) => [x.profile_id, x.kind, x.app_initiated, x.dedupe_key, x.skipped_reason ?? null]).sort(),
    [[DAD, "recap", true, "recap:2026-10", null], [LEO, "recap", true, "recap:2026-10", null]].sort(),
  );
  // The next hour (and a replayed run): nothing more.
  assertEquals((await run("2026-11-01T11:10:00-08:00")).jobs.recap, 0);
  assertEquals((await run("2026-11-01T10:10:00-08:00")).jobs.recap, 0);
  assertEquals(pushed.length, 2);
});

t("cron with the real FIRST_MONTH: nothing on Nov 1 (October isn't an edition); Dec 1 sends November's", async () => {
  const tables = family();
  quietOctober(tables); // Leo cooked Dad's chili twice in October; everyone has push on
  const { run, pushed, queries } = cron(tables, { realFirstMonth: true });
  for (const now of ["2026-11-01T10:10:00-08:00", "2026-11-01T14:10:00-08:00", "2026-11-01T10:10:00+05:30"]) {
    assertEquals((await run(now)).jobs.recap, 0, now);
  }
  assertEquals([pushed.length, tables.notification_log.length], [0, 0]);
  // The recap job reads nothing before the first edition's 1st: only the cron runner's own "who has push
  // on" (push_tokens & profiles, once a run) is there.
  assertEquals(queries.filter((q) => q === "push_tokens").length, 3);
  assertEquals(queries.filter((q) => !["push_tokens", "profiles"].includes(q)), []);
  // Dec 1, 10:10 in LA: an empty November sends nothing (and logs nothing).
  assertEquals((await run("2026-12-01T10:10:00-08:00")).jobs.recap, 0);
  assertEquals([pushed.length, tables.notification_log.length], [0, 0]);
  // Leo cooks Dad's chili in November: the next hour, "Your November in the kitchen" for both of them.
  tables.recipe_events.push(event(LEO, "dad-chili", "cooked", "2026-11-10T20:00:00.000Z", { cook_id: DAD }));
  assertEquals((await run("2026-12-01T11:10:00-08:00")).jobs.recap, 2);
  assertEquals(
    pushed.map((m) => [m.to, m.title, m.body, m.data.url]).sort(),
    [
      ["ExponentPushToken[t1]", "Your November in the kitchen", "1 dish.", "/recap?month=2026-11"], // Leo
      ["ExponentPushToken[t4]", "Your November in the kitchen", "Your dishes were cooked once.", "/recap?month=2026-11"], // Dad
    ],
  );
  assertEquals(tables.notification_log.map((x) => x.dedupe_key), ["recap:2026-11", "recap:2026-11"]);
});

t("cron: nothing before 10:00, from quiet hours on, or on any other day", async () => {
  for (const now of ["2026-11-01T09:10:00-08:00", "2026-11-01T21:10:00-08:00", "2026-10-31T10:10:00-07:00", "2026-11-02T10:10:00-08:00", "2026-11-15T10:10:00-08:00"]) {
    const tables = family();
    quietOctober(tables);
    const { run, pushed } = cron(tables);
    assertEquals((await run(now)).jobs.recap, 0, now);
    assertEquals([pushed.length, tables.notification_log.length], [0, 0], now);
  }
});

t("cron: with the library unreachable nothing is sent or logged, and a later hour still sends", async () => {
  const tables = family();
  quietOctober(tables);
  let up = false;
  const { run, pushed } = cron(tables, { library: () => (up ? RECIPES : new Map()) });
  assertEquals((await run("2026-11-01T10:10:00-08:00")).jobs.recap, 0);
  assertEquals([pushed.length, tables.notification_log.length], [0, 0]);
  up = true;
  assertEquals((await run("2026-11-01T14:10:00-08:00")).jobs.recap, 2);
  assertEquals(pushed.map((m) => m.body).sort(), ["2 dishes.", "Your dishes were cooked twice."]);
});

t("cron: a month of postcards alone pushes only when GET /recap can show its Then & now", async () => {
  // Leo sent two postcards of Dad's chili but no 'cooked' event landed (cooked() posts it best-effort),
  // so his month is Then & now alone. Without a photo signer the route drops that slide and answers
  // an empty month: the push would open on nothing, so none goes (and no log row, so a later hour can
  // send once photos can be signed).
  for (const sign of ["none", "all"] as const) {
    const tables = family();
    tables.messages.push(postcard(LEO, T_LEO_DAD, "dad-chili", oct(3)), postcard(LEO, T_LEO_DAD, "dad-chili", oct(17)));
    tables.push_tokens.push({ token: "ExponentPushToken[t1]", family_id: FAM, profile_id: LEO, device_id: null, platform: "ios" });
    const { get } = recapFor(tables, { sign, now: "2026-11-01T10:10:00-08:00" });
    const { run, pushed } = cron(tables, { sign });
    const sent = (await run("2026-11-01T10:10:00-08:00")).jobs.recap;
    if (sign === "none") {
      assertEquals(await get(LEO, "2026-10"), { empty: true }, "the route's month");
      assertEquals([sent, pushed.length, tables.notification_log.length], [0, 0, 0]);
    } else {
      assertEquals(types(await get(LEO, "2026-10")), ["cover", "then_now", "close"]);
      assertEquals(sent, 1);
      assertEquals(pushed.map((m) => [m.title, m.body, m.data.url]), [
        ["Your October in the kitchen", "Your first postcard beside your latest.", "/recap?month=2026-10"],
      ]);
    }
  }
  // Another slide alongside keeps the push without a signer, in that slide's words.
  const tables = family();
  tables.messages.push(postcard(LEO, T_LEO_DAD, "dad-chili", oct(3)), postcard(LEO, T_LEO_DAD, "dad-chili", oct(17)));
  tables.favorites.push(heart(LEO, "dad-ribs", oct(5)));
  tables.push_tokens.push({ token: "ExponentPushToken[t1]", family_id: FAM, profile_id: LEO, device_id: null, platform: "ios" });
  const { run, pushed } = cron(tables, { sign: "none" });
  assertEquals((await run("2026-11-01T10:10:00-08:00")).jobs.recap, 1);
  assertEquals(pushed.map((m) => m.body), ["Hearts you left: 1."]);
});

t("recapPushFor matches signSlides: Then & now counts only when photos can be signed", () => {
  const photo = (id: string, at: string) => ({ message_id: id, photo_path: `${FAM}/${id}.jpg`, recipe_id: "dad-chili", at });
  const thenNow = {
    month: "2026-10", role: "learner" as const,
    slides: [
      { type: "cover" as const, title: "Your October in the kitchen" },
      { type: "then_now" as const, title: "Then & now", photos: [photo("a", oct(3)), photo("b", oct(17))] as [ReturnType<typeof photo>, ReturnType<typeof photo>] },
      { type: "close" as const, title: "See you at the table in November." },
    ],
  };
  assertEquals(P.recapPushFor(thenNow, false), null);
  assertEquals(P.recapPushFor(thenNow, true), { title: "Your October in the kitchen", body: "Your first postcard beside your latest." });
  assertEquals(P.recapPushFor({ empty: true }, true), null);
});

t("cron: tokens on signed-out phones don't count, so no month is built for them", async () => {
  const tables = family();
  quietOctober(tables);
  for (const tk of tables.push_tokens) tk.device_id = "d-signed-out";
  tables.devices.push({ id: "d-signed-out", family_id: FAM, revoked_at: "2026-10-20T00:00:00Z" });
  const { run, pushed, queries } = cron(tables);
  assertEquals((await run("2026-11-01T10:10:00-08:00")).jobs.recap, 0);
  assertFalse(queries.includes("recipe_events"), "no family month is loaded");
  assertEquals([pushed.length, tables.notification_log.length], [0, 0]);
  // Leo signs in on a new phone; Dad's token points at a phone that no longer exists.
  tables.devices.push({ id: "d-leo-new", family_id: FAM, revoked_at: null });
  tables.push_tokens.find((x) => x.profile_id === LEO)!.device_id = "d-leo-new";
  tables.push_tokens.find((x) => x.profile_id === DAD)!.device_id = "d-gone";
  assertEquals((await run("2026-11-01T11:10:00-08:00")).jobs.recap, 1);
  assertEquals(pushed.map((m) => m.to), ["ExponentPushToken[t1]"]);
});

t("cron: a kid already sent an app-initiated push today is capped (logged as skipped), never a second try", async () => {
  const tables = family();
  quietOctober(tables);
  tables.notification_log.push({
    family_id: FAM, profile_id: LEO, kind: "table_nudge", app_initiated: true, dedupe_key: "table_nudge:x",
    quote_key: null, skipped_reason: null, sent_at: "2026-11-01T17:30:00.000Z", // 09:30 that morning in LA
  });
  const { run, pushed } = cron(tables);
  assertEquals((await run("2026-11-01T10:10:00-08:00")).jobs.recap, 1); // Dad's
  assertEquals(pushed.map((m) => m.to), ["ExponentPushToken[t4]"]);
  const leo = tables.notification_log.find((x) => x.profile_id === LEO && x.kind === "recap")!;
  assertEquals([leo.skipped_reason, leo.dedupe_key], ["daily", "recap:2026-10"]);
  assertEquals((await run("2026-11-01T11:10:00-08:00")).jobs.recap, 0);
});

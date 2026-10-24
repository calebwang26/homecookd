// Offline checks for supabase/functions/api/hearts.ts (PR 4, Hearts & kitchen): GET /dish-stats and
// GET /hearts/recent. No database and no network: the routes get a tiny in-memory stand-in for the
// Supabase client (only the filters hearts.ts uses), and the library is plumbing.ts's real
// makeLibrary() over a fake bucket, so the "only the dish's cook" rule runs through dishesOf().
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/hearts_test.ts

import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import * as H from "../functions/api/hearts.ts";
import * as R from "../functions/api/retention.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type Logged = { table: string; filters: string[]; limit: number | null };

/** Understands what hearts.ts calls: select, eq, in, gt, order (created_at desc), limit. Logs each query. */
function fakeDb(tables: Tables, opts: { failOn?: string } = {}) {
  const log: Logged[] = [];
  class Query {
    private filters: ((r: Row) => boolean)[] = [];
    private names: string[] = [];
    private max: number | null = null;
    private desc: string | null = null;
    constructor(private table: string) {}
    select(_cols?: string) { return this; }
    eq(c: string, v: unknown) { this.names.push(`${c}=eq.${v}`); this.filters.push((r) => r[c] === v); return this; }
    in(c: string, vs: unknown[]) { this.names.push(`${c}=in.${vs.length}`); this.filters.push((r) => vs.includes(r[c])); return this; }
    gt(c: string, v: string) { this.names.push(`${c}=gt.${v}`); this.filters.push((r) => Date.parse(r[c]) > Date.parse(v)); return this; }
    order(c: string, o: { ascending?: boolean } = {}) { if (o.ascending === false) this.desc = c; return this; }
    limit(n: number) { this.max = n; return this; }
    // deno-lint-ignore no-explicit-any
    then(ok: (v: any) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
    private run() {
      log.push({ table: this.table, filters: this.names, limit: this.max });
      if (opts.failOn === this.table) return { data: null, error: { code: "XX000", message: "boom" } };
      const rows = tables[this.table];
      if (!rows) throw new Error(`fake db: no table ${this.table}`);
      let found = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.desc) {
        const c = this.desc;
        found = [...found].sort((a, b) => Date.parse(b[c]) - Date.parse(a[c]));
      }
      return { data: found.slice(0, this.max ?? Infinity), error: null };
    }
  }
  return { db: { from: (table: string) => new Query(table) } as unknown as R.NotifyDeps["db"], log };
}

/** A fake public bucket serving library.json; `down` makes every fetch fail. */
function fakeBucket(library: Row[], state: { down: boolean } = { down: false }) {
  return ((url: string | URL | Request) => {
    if (state.down) return Promise.reject(new TypeError("network is off"));
    return Promise.resolve(String(url).endsWith("/library.json")
      ? new Response(JSON.stringify(library), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("<Error>NoSuchKey</Error>", { status: 404 }));
  }) as typeof globalThis.fetch;
}

const FAM = "11111111-1111-4111-8111-111111111111";
const OTHER_FAM = "99999999-9999-4999-8999-999999999999";
const DAD = "22222222-2222-4222-8222-222222222222"; // cook
const MOM = "33333333-3333-4333-8333-333333333333"; // cook
const LEO = "44444444-4444-4444-8444-444444444444"; // learner
const MAYA = "55555555-5555-4555-8555-555555555555"; // learner
const SAM = "66666666-6666-4666-8666-666666666666"; // learner, removed
const STRANGER = "77777777-7777-4777-8777-777777777777"; // another family's kid

const LIBRARY = [
  { id: "dad-sunday-chili", title: "Sunday Chili", cook_name: "Dad", relation: "Dad", sample: true },
  { id: "dad-fried-rice", title: "Fried Rice", cook_name: " dad", relation: "Dad", sample: false },
  { id: "dad-noodles", title: "Noodles", cook_name: "Dad", relation: "Dad", sample: false },
  { id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", relation: "Mom", sample: false },
  { id: "gordon-eggs", title: "Scrambled Eggs", cook_name: "Gordon", relation: "YouTube", sample: true },
];

type P = R.RetentionProfile;
const person = (id: string, name: string, role: "cook" | "learner", extra: Partial<P> = {}): P =>
  ({ id, family_id: FAM, name, role, removed_at: null, ...extra });
const PEOPLE: P[] = [
  person(DAD, "Dad", "cook"),
  person(MOM, "Mom", "cook"),
  person(LEO, "Leo", "learner"),
  person(MAYA, "Maya", "learner"),
];
/** index.ts's ctx.profiles never holds removed people; Sam is here only to prove the filter holds anyway. */
const ctxFor = (me: string | null, extra: P[] = []): R.RetentionCtx => ({
  family: { id: FAM, name: "Test family" },
  profiles: [...PEOPLE, ...extra],
  me: PEOPLE.find((p) => p.id === me) ?? null,
  device: null,
});

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const fav = (profile_id: string, recipe_id: string, created_at: string) => ({ profile_id, recipe_id, created_at });
const ev = (profile_id: string, recipe_id: string, kind: string, created_at: string, family_id = FAM): Row =>
  ({ family_id, profile_id, recipe_id, kind, created_at });

function world(): Tables {
  return {
    favorites: [
      fav(LEO, "dad-sunday-chili", "2026-10-10T10:00:00Z"),
      fav(MAYA, "dad-sunday-chili", "2026-10-12T10:00:00Z"),
      fav(MOM, "dad-sunday-chili", "2026-10-13T10:00:00Z"), // another cook's heart counts too
      fav(DAD, "dad-sunday-chili", "2026-10-14T10:00:00Z"), // my own heart: never counted
      fav(SAM, "dad-sunday-chili", "2026-10-14T11:00:00Z"), // removed: not in the family now
      fav(STRANGER, "dad-sunday-chili", "2026-10-14T12:00:00Z"), // another family (favorites has no family_id)
      fav(LEO, "dad-fried-rice", "2026-10-15T09:00:00Z"),
      fav(LEO, "mom-dal", "2026-10-16T09:00:00Z"), // Mom's dish
    ],
    recipe_events: [
      ev(LEO, "dad-sunday-chili", "cooked", "2026-10-01T10:00:00Z"),
      ev(LEO, "dad-sunday-chili", "cooked", "2026-10-09T10:00:00Z"),
      ev(MAYA, "dad-sunday-chili", "cooked", "2026-10-05T10:00:00Z"),
      // Since PR 1 the table also holds these kinds: none of them is a cook.
      ev(LEO, "dad-sunday-chili", "viewed", "2026-10-11T10:00:00Z"),
      ev(LEO, "dad-sunday-chili", "started", "2026-10-11T10:01:00Z"),
      ev(LEO, "dad-sunday-chili", "heard", "2026-10-11T10:02:00Z"),
      ev(MAYA, "dad-noodles", "viewed", "2026-10-11T10:03:00Z"),
      ev(DAD, "dad-sunday-chili", "cooked", "2026-10-12T10:00:00Z"), // me
      ev(SAM, "dad-sunday-chili", "cooked", "2026-10-12T11:00:00Z"), // removed
      ev(STRANGER, "dad-sunday-chili", "cooked", "2026-10-12T12:00:00Z", OTHER_FAM), // another family
      ev(LEO, "dad-fried-rice", "cooked", "2026-10-15T08:00:00Z"),
      ev(MAYA, "mom-dal", "cooked", "2026-10-15T08:30:00Z"),
    ],
  };
}

function routesFor(tables: Tables, opts: { failOn?: string; bucket?: { down: boolean }; now?: string } = {}) {
  const { db, log } = fakeDb(tables, { failOn: opts.failOn });
  const library = R.makeLibrary({ bucketUrl: "https://bucket.test", fetch: fakeBucket(LIBRARY, opts.bucket) });
  const h = H.makeHearts({
    db,
    HttpError,
    requireMe: (ctx: R.RetentionCtx) => {
      if (!ctx.me) throw new HttpError(400, "x-profile-id header is required for this request");
      return ctx.me;
    },
    dbFail: (context) => {
      throw new Error(`db fail: ${context}`);
    },
    library,
    now: () => new Date(opts.now ?? "2026-10-17T12:00:00Z"),
  });
  return { h, log };
}

const get = (path: string) => new URL(`http://edge.local/functions/v1/api${path}`);

async function httpError(p: Promise<unknown>, status: number, message: string) {
  const e = await assertRejects(() => p, HttpError);
  assertEquals([e.status, e.message], [status, message]);
}

// --- parsing -----------------------------------------------------------------------------------

t("parseDishIds: comma list, deduped, trimmed; 400s for none, junk and more than 50", () => {
  assertEquals(H.parseDishIds("a,b, a ,,c"), { ok: true, ids: ["a", "b", "c"] });
  assertEquals(H.parseDishIds("dad-sunday-chili"), { ok: true, ids: ["dad-sunday-chili"] });
  for (const none of [null, undefined, "", " , ,"]) assertEquals(H.parseDishIds(none), { ok: false, error: "ids is required" });
  for (const bad of ["Dad-Chili", "a,b c", "-x", "a,../etc", "a;b", "x".repeat(101)]) {
    assertEquals(H.parseDishIds(bad), { ok: false, error: "ids must be recipe ids separated by commas" }, bad);
  }
  const fifty = Array.from({ length: 50 }, (_, i) => `d${i}`);
  assertEquals(H.parseDishIds(fifty.join(",")), { ok: true, ids: fifty });
  assertEquals(H.parseDishIds([...fifty, "d50"].join(",")), { ok: false, error: "ids: at most 50" });
  assertEquals(H.parseDishIds([...fifty, "d0", "d1"].join(",")).ok, true, "repeats don't count toward 50");
});

t("parseSince: default 14 days, clamped to 30 days back and to now; 400 for junk", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const since = (raw: string | null) => {
    const p = H.parseSince(raw, now);
    return p.ok ? p.since.toISOString() : p.error;
  };
  assertEquals(since(null), "2026-10-03T12:00:00.000Z");
  assertEquals(since("  "), "2026-10-03T12:00:00.000Z");
  assertEquals(since("2026-10-15T08:00:00-07:00"), "2026-10-15T15:00:00.000Z");
  assertEquals(since("2026-01-01T00:00:00Z"), "2026-09-17T12:00:00.000Z"); // 30 days at most
  assertEquals(since("2027-01-01T00:00:00Z"), "2026-10-17T12:00:00.000Z"); // a fast phone clock
  for (const bad of ["yesterday", "2026-13-45", "x".repeat(41)]) assertEquals(since(bad), "since must be an ISO time", bad);
});

t("newestHearts: newest first, stable ties, capped", () => {
  const rows = [
    fav(LEO, "b", "2026-10-10T10:00:00Z"),
    fav(MAYA, "a", "2026-10-12T10:00:00Z"),
    fav(LEO, "a", "2026-10-12T10:00:00Z"),
    fav(LEO, "c", "2026-10-11T10:00:00Z"),
  ];
  assertEquals(H.newestHearts(rows), [
    { profile_id: LEO, recipe_id: "a", at: "2026-10-12T10:00:00Z" },
    { profile_id: MAYA, recipe_id: "a", at: "2026-10-12T10:00:00Z" },
    { profile_id: LEO, recipe_id: "c", at: "2026-10-11T10:00:00Z" },
    { profile_id: LEO, recipe_id: "b", at: "2026-10-10T10:00:00Z" },
  ]);
  assertEquals(H.newestHearts(rows, 2).length, 2);
  assertEquals(H.newestHearts([]), []);
});

// --- GET /dish-stats ---------------------------------------------------------------------------

t("routes: two signed-in GET routes for index.ts to register", () => {
  const { h } = routesFor(world());
  assertEquals(h.routes.map((r) => [r.method, r.path, r.auth]), [
    ["GET", "/dish-stats", {}],
    ["GET", "/hearts/recent", {}],
  ]);
});

t("GET /dish-stats: the handoff's exact shape, my family only, me excluded, cooked = kind 'cooked' only", async () => {
  const { h, log } = routesFor(world());
  const out = await h.dishStats({ ctx: ctxFor(DAD, [person(SAM, "Sam", "learner", { removed_at: "2026-10-01T00:00:00Z" })]), url: get("/dish-stats?ids=dad-sunday-chili,dad-noodles") });
  assertEquals(out, {
    "dad-sunday-chili": {
      hearts: {
        count: 3,
        by: [
          { profile_id: MOM, at: "2026-10-13T10:00:00Z" },
          { profile_id: MAYA, at: "2026-10-12T10:00:00Z" },
          { profile_id: LEO, at: "2026-10-10T10:00:00Z" },
        ],
      },
      cooked: {
        count: 3,
        by: [
          { profile_id: LEO, count: 2, last_at: "2026-10-09T10:00:00Z" },
          { profile_id: MAYA, count: 1, last_at: "2026-10-05T10:00:00Z" },
        ],
      },
    },
    // A dish of mine nobody has hearted or cooked yet: zeros, never missing.
    "dad-noodles": { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } },
  });
  // The cooked query names its kind and its family; both queries name the people.
  const cooked = log.find((q) => q.table === "recipe_events")!;
  // Mom, Leo & Maya: never me, never removed Sam.
  assertEquals(cooked.filters, [`family_id=eq.${FAM}`, "kind=eq.cooked", "recipe_id=in.2", "profile_id=in.3"]);
  assertEquals(log.find((q) => q.table === "favorites")!.filters, ["recipe_id=in.2", "profile_id=in.3"]);
  assertEquals(log.map((q) => q.limit), [1000, 1000]);
});

t("GET /dish-stats: counts go only to the dish's cook (Mom asking about Dad's dishes gets nothing)", async () => {
  const { h, log } = routesFor(world());
  assertEquals(await h.dishStats({ ctx: ctxFor(MOM), url: get("/dish-stats?ids=dad-sunday-chili,dad-fried-rice") }), {});
  assertEquals(log.length, 0, "not even a query");
  // Mom's own dish, asked for next to Dad's: only hers comes back.
  const mine = await h.dishStats({ ctx: ctxFor(MOM), url: get("/dish-stats?ids=dad-sunday-chili,mom-dal") });
  assertEquals(Object.keys(mine), ["mom-dal"]);
  assertEquals(mine["mom-dal"].hearts.by.map((x) => x.profile_id), [LEO]);
  assertEquals(mine["mom-dal"].cooked.by.map((x) => [x.profile_id, x.count]), [[MAYA, 1]]);
  // A kid has no dishes: nothing, whatever is asked.
  assertEquals(await h.dishStats({ ctx: ctxFor(LEO), url: get("/dish-stats?ids=dad-sunday-chili,mom-dal,gordon-eggs") }), {});
  // Unknown ids are simply not mine.
  assertEquals(await h.dishStats({ ctx: ctxFor(DAD), url: get("/dish-stats?ids=nope,gordon-eggs") }), {});
});

t("GET /dish-stats: the cook's name matches the library like cookProfile (case & spaces), samples included", async () => {
  const { h } = routesFor(world());
  const out = await h.dishStats({ ctx: ctxFor(DAD), url: get("/dish-stats?ids=dad-fried-rice,dad-sunday-chili") });
  assertEquals(Object.keys(out).sort(), ["dad-fried-rice", "dad-sunday-chili"]); // " dad" and the sample
  assertEquals([out["dad-fried-rice"].hearts.count, out["dad-fried-rice"].cooked.count], [1, 1]);
});

t("GET /dish-stats: un-hearting removes the heart; a family of one gets zeros without a query", async () => {
  const tables = world();
  const { h } = routesFor(tables);
  const ctx = ctxFor(DAD);
  tables.favorites = tables.favorites.filter((f) => !(f.profile_id === LEO && f.recipe_id === "dad-sunday-chili"));
  const out = await h.dishStats({ ctx, url: get("/dish-stats?ids=dad-sunday-chili") });
  assertEquals(out["dad-sunday-chili"].hearts.by.map((x) => x.profile_id), [MOM, MAYA]);

  const alone = routesFor(world());
  const solo: R.RetentionCtx = { ...ctx, profiles: [PEOPLE[0]] };
  assertEquals(await alone.h.dishStats({ ctx: solo, url: get("/dish-stats?ids=dad-noodles") }), {
    "dad-noodles": { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } },
  });
  assertEquals(alone.log.length, 0);
});

t("GET /dish-stats: 400s (no person, no ids, junk, more than 50); bucket down = nothing; db errors fail loudly", async () => {
  const { h } = routesFor(world());
  await httpError(h.dishStats({ ctx: ctxFor(null), url: get("/dish-stats?ids=dad-noodles") }), 400, "x-profile-id header is required for this request");
  await httpError(h.dishStats({ ctx: ctxFor(DAD), url: get("/dish-stats") }), 400, "ids is required");
  await httpError(h.dishStats({ ctx: ctxFor(DAD), url: get("/dish-stats?ids=Dad%20Chili") }), 400, "ids must be recipe ids separated by commas");
  const many = Array.from({ length: 51 }, (_, i) => `dad-${i}`).join(",");
  await httpError(h.dishStats({ ctx: ctxFor(DAD), url: get(`/dish-stats?ids=${many}`) }), 400, "ids: at most 50");

  const down = routesFor(world(), { bucket: { down: true } });
  assertEquals(await down.h.dishStats({ ctx: ctxFor(DAD), url: get("/dish-stats?ids=dad-noodles") }), {});
  assertEquals(down.log.length, 0);

  const broken = routesFor(world(), { failOn: "recipe_events" });
  await assertRejects(() => broken.h.dishStats({ ctx: ctxFor(DAD), url: get("/dish-stats?ids=dad-noodles") }), Error, "db fail: dish stats cooked");
});

// --- GET /hearts/recent ------------------------------------------------------------------------

t("GET /hearts/recent: hearts on my dishes from my family, newest first, since the default 14 days", async () => {
  const tables = world();
  tables.favorites.push(fav(LEO, "dad-noodles", "2026-09-20T10:00:00Z")); // older than 14 days
  const { h, log } = routesFor(tables);
  const out = await h.heartsRecent({ ctx: ctxFor(DAD, [person(SAM, "Sam", "learner", { removed_at: "2026-10-01T00:00:00Z" })]), url: get("/hearts/recent") });
  assertEquals(out, [
    { profile_id: LEO, recipe_id: "dad-fried-rice", at: "2026-10-15T09:00:00Z" },
    { profile_id: MOM, recipe_id: "dad-sunday-chili", at: "2026-10-13T10:00:00Z" },
    { profile_id: MAYA, recipe_id: "dad-sunday-chili", at: "2026-10-12T10:00:00Z" },
    { profile_id: LEO, recipe_id: "dad-sunday-chili", at: "2026-10-10T10:00:00Z" },
  ]);
  assertEquals(log[0].filters, ["recipe_id=in.3", "profile_id=in.3", "created_at=gt.2026-10-03T12:00:00.000Z"]);
  assertEquals(log[0].limit, 20);
});

t("GET /hearts/recent: since narrows it, a 30-day floor; Mom never sees Dad's; un-heart removes it", async () => {
  const tables = world();
  tables.favorites.push(fav(LEO, "dad-noodles", "2026-09-20T10:00:00Z"));
  const { h } = routesFor(tables);
  const since = encodeURIComponent("2026-10-12T12:00:00Z");
  assertEquals((await h.heartsRecent({ ctx: ctxFor(DAD), url: get(`/hearts/recent?since=${since}`) })).map((x) => x.recipe_id), ["dad-fried-rice", "dad-sunday-chili"]);
  // Asking for a year still reads 30 days at most (Sep 20 is within 30 days of Oct 17).
  const year = await h.heartsRecent({ ctx: ctxFor(DAD), url: get("/hearts/recent?since=2025-10-17T00:00:00Z") });
  assertEquals(year.at(-1), { profile_id: LEO, recipe_id: "dad-noodles", at: "2026-09-20T10:00:00Z" });
  assertEquals((await h.heartsRecent({ ctx: ctxFor(DAD), url: get("/hearts/recent?since=2026-08-01T00:00:00Z") })).length, 5);
  const late = routesFor(tables, { now: "2026-10-25T12:00:00Z" });
  assertEquals((await late.h.heartsRecent({ ctx: ctxFor(DAD), url: get("/hearts/recent?since=2026-08-01T00:00:00Z") })).length, 4, "Sep 20 is past the floor now");

  assertEquals(await h.heartsRecent({ ctx: ctxFor(MOM), url: get("/hearts/recent") }), [{ profile_id: LEO, recipe_id: "mom-dal", at: "2026-10-16T09:00:00Z" }]);
  assertEquals(await h.heartsRecent({ ctx: ctxFor(LEO), url: get("/hearts/recent") }), []);

  tables.favorites = tables.favorites.filter((f) => !(f.profile_id === LEO && f.recipe_id === "dad-fried-rice"));
  assertEquals((await h.heartsRecent({ ctx: ctxFor(DAD), url: get("/hearts/recent") }))[0].recipe_id, "dad-sunday-chili");
});

t("GET /hearts/recent: at most 20, across dish chunks of 100", async () => {
  const lib = Array.from({ length: 130 }, (_, i) => ({ id: `dad-dish-${i}`, title: `Dish ${i}`, cook_name: "Dad", relation: "Dad", sample: false }));
  const tables: Tables = { favorites: [], recipe_events: [] };
  for (let i = 0; i < 130; i += 5) tables.favorites.push(fav(LEO, `dad-dish-${i}`, new Date(Date.parse("2026-10-16T00:00:00Z") - i * 60_000).toISOString()));
  const { db, log } = fakeDb(tables);
  const h = H.makeHearts({
    db, HttpError,
    requireMe: (ctx: R.RetentionCtx) => ctx.me!,
    dbFail: (c) => { throw new Error(c); },
    library: R.makeLibrary({ bucketUrl: "https://bucket.test", fetch: fakeBucket(lib) }),
    now: () => new Date("2026-10-17T12:00:00Z"),
  });
  const out = await h.heartsRecent({ ctx: ctxFor(DAD), url: get("/hearts/recent") });
  assertEquals(log.map((q) => q.filters[0]), ["recipe_id=in.100", "recipe_id=in.30"]);
  assertEquals(out.length, 20);
  assertEquals(out[0].recipe_id, "dad-dish-0");
  assertEquals(out.at(-1)!.recipe_id, "dad-dish-95");
});

t("GET /hearts/recent: 400s for no person and a junk since", async () => {
  const { h } = routesFor(world());
  await httpError(h.heartsRecent({ ctx: ctxFor(null), url: get("/hearts/recent") }), 400, "x-profile-id header is required for this request");
  await httpError(h.heartsRecent({ ctx: ctxFor(DAD), url: get("/hearts/recent?since=last-week") }), 400, "since must be an ISO time");
});

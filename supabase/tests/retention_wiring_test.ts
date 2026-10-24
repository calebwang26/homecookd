// How the retention modules fit together, offline (no database, no network): the one factory index.ts
// calls (retention.ts makeRetention) hands back every PR's routes tagged with its PR, registers the
// cron jobs of the PRs that are on and refuses a PR it can't build; no retention route shadows or is
// shadowed by a route index.ts already has; the modules import each other without cycles and only
// index.ts imports retention.ts; and the lists the code and the migrations both spell out (event kinds,
// push kinds, cap reasons, reactions) agree.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/retention_wiring_test.ts

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import * as R from "../functions/api/retention.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

const API = new URL("../functions/api/", import.meta.url);
const MIGRATIONS = new URL("../migrations/", import.meta.url);

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/** Just enough of a client for the cron runner on a day with nothing due. */
function quietDb(secret = "test-cron"): SupabaseClient {
  const rows = { data: [], error: null };
  const query = { limit: () => Promise.resolve(rows), order: () => query, range: () => Promise.resolve(rows), eq: () => query, in: () => query };
  return {
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve({ data: fn === "cron_secret_ok" && args.p_secret === secret, error: null }),
    from: () => ({ select: () => query }),
  } as unknown as SupabaseClient;
}

const library: R.Library = { libraryIndex: () => Promise.resolve(new Map()), recipeInfo: () => Promise.resolve(null) };

function retentionWith(extra: Partial<R.RetentionDeps<R.RetentionCtx>> = {}) {
  return R.makeRetention<R.RetentionCtx>({
    db: quietDb(),
    HttpError,
    requireMe: (ctx) => {
      if (!ctx.me) throw new HttpError(400, "x-profile-id header is required for this request");
      return ctx.me;
    },
    rateLimit: () => Promise.resolve(),
    dbFail: (context) => {
      throw new Error(`db fail: ${context}`);
    },
    clientIp: () => "203.0.113.9",
    ...extra,
  });
}

const ALL = { prs: [2, 4, 5, 6] as R.RetentionPr[], library, answersFor: () => Promise.resolve(new Map()) };

t("makeRetention: every PR's routes, tagged with the PR, in PR order; the jobs of PRs 5 & 6", () => {
  const r = retentionWith(ALL);
  assertEquals(r.prs, [1, 2, 4, 5, 6]);
  assertEquals(r.routes.map((x) => [x.pr, x.method, x.path, x.auth]), [
    [1, "POST", "/push-tokens", {}],
    [1, "POST", "/push-tokens/remove", { lenientMe: true }],
    [2, "POST", "/cooking", {}],
    [2, "POST", "/cooking/end", {}],
    [2, "GET", "/cooking", {}],
    [2, "GET", "/profile/share-cooking", {}],
    [2, "POST", "/profile/share-cooking", {}],
    [4, "GET", "/dish-stats", {}],
    [4, "GET", "/hearts/recent", {}],
    [5, "GET", "/table", { lenientMe: true }],
    [6, "GET", "/recap", {}],
  ]);
  assertEquals(r.publicRoutes.map((x) => [x.pr, x.method, x.path]), [[1, "POST", "/cron/hourly"]]);
  assertEquals(r.cronJobs.map((j) => [j.name, j.pr]), [["table_nudge", 5], ["recap", 6]]);
  assert(r.cooking && r.hearts && r.table && r.recap);
  for (const x of r.routes) assertEquals(typeof x.handler, "function", x.path);
});

t("makeRetention: PR 1 is always on; each later PR only when listed; nothing else registered", () => {
  const plain = retentionWith();
  assertEquals([plain.prs, plain.routes.map((x) => x.path), plain.cronJobs, plain.cooking, plain.recap],
    [[1], ["/push-tokens", "/push-tokens/remove"], [], null, null]);
  const hearts = retentionWith({ prs: [4], library });
  assertEquals([hearts.prs, hearts.routes.map((x) => `${x.pr} ${x.path}`), hearts.cronJobs.length],
    [[1, 4], ["1 /push-tokens", "1 /push-tokens/remove", "4 /dish-stats", "4 /hearts/recent"], 0]);
  // Order and repeats in `prs` don't matter.
  assertEquals(retentionWith({ ...ALL, prs: [6, 5, 1, 5] }).cronJobs.map((j) => j.name), ["table_nudge", "recap"]);
});

t("makeRetention: refuses a PR it has nothing for, or one missing what it needs (loudly, at init)", () => {
  assertThrows(() => retentionWith({ prs: [3 as R.RetentionPr] }), Error, "PR 3 has no server routes here");
  assertThrows(() => retentionWith({ prs: [7 as R.RetentionPr] }), Error, "PR 7 has no server routes here");
  for (const pr of [2, 4, 5, 6] as R.RetentionPr[]) {
    assertThrows(() => retentionWith({ prs: [pr], answersFor: ALL.answersFor }), Error, `PR ${pr} needs library`);
  }
  assertThrows(() => retentionWith({ prs: [6], library }), Error, "PR 6 needs answersFor");
});

t("makeRetention: /cron/hourly runs the registered jobs in order, each reported by name", async () => {
  const r = retentionWith(ALL);
  const out = await r.cronHourly({
    req: new Request("http://x/api/cron/hourly", { method: "POST", headers: { "x-cron-secret": "test-cron" } }),
    body: () => Promise.resolve({ now: "2026-10-21T19:00:00Z" }), // a Wednesday the 21st: nothing due
  });
  assertEquals(out, { ok: true, due: { nudge: 0, recap: 0 }, sent: 0, jobs: { table_nudge: 0, recap: 0 } });
});

// --- routes: none shadows index.ts's, none twice --------------------------------------------------

/** Every `on("GET", "/x")` / `onPublic("POST", "/y")` in index.ts. */
async function indexRoutes(): Promise<{ method: string; path: string }[]> {
  const src = await Deno.readTextFile(new URL("index.ts", API));
  return [...src.matchAll(/\bon(?:Public)?\(\s*"(GET|POST|PUT|PATCH|DELETE)",\s*"([^"]+)"/g)].map((m) => ({ method: m[1], path: m[2] }));
}

/** index.ts's match(): same length, each segment equal or a `:param` on either side. */
function overlaps(a: { method: string; path: string }, b: { method: string; path: string }): boolean {
  if (a.method !== b.method) return false;
  const x = a.path.split("/").filter(Boolean);
  const y = b.path.split("/").filter(Boolean);
  return x.length === y.length && x.every((s, i) => s === y[i] || s.startsWith(":") || y[i].startsWith(":"));
}

t("routes: no retention route overlaps a route index.ts already has, or another retention route", async () => {
  const existing = await indexRoutes();
  assert(existing.length > 40, `found ${existing.length} routes in index.ts`);
  const r = retentionWith(ALL);
  const mine = [...r.routes, ...r.publicRoutes];
  for (const a of mine) {
    const hit = existing.find((b) => overlaps(a, b));
    assertEquals(hit, undefined, `${a.method} ${a.path} overlaps index.ts's ${hit?.method} ${hit?.path}`);
    assertEquals(mine.filter((b) => overlaps(a, b)).length, 1, `${a.method} ${a.path} twice`);
  }
});

// --- imports: no cycles, one door ------------------------------------------------------------------

async function importGraph(): Promise<Map<string, string[]>> {
  const graph = new Map<string, string[]>();
  for await (const e of Deno.readDir(API)) {
    if (!e.isFile || !e.name.endsWith(".ts")) continue;
    const src = await Deno.readTextFile(new URL(e.name, API));
    const deps = [...src.matchAll(/^(?:import|export)\b[^;]*?from\s+"\.\/([^"]+\.ts)"/gms)].map((m) => m[1]);
    graph.set(e.name, [...new Set(deps)]);
  }
  return graph;
}

t("imports: the api modules form no cycle, and only index.ts imports retention.ts", async () => {
  const graph = await importGraph();
  for (const name of ["time.ts", "table.ts", "recap.ts", "plumbing.ts", "cooking.ts", "hearts.ts", "tablePr.ts", "recapPr.ts", "retention.ts"]) {
    assert(graph.has(name), name);
  }
  assertEquals(graph.get("time.ts"), []);
  assertEquals(graph.get("retention.ts")?.sort(), [
    "cooking.ts", "hearts.ts", "plumbing.ts", "recap.ts", "recapPr.ts", "table.ts", "tablePr.ts", "time.ts",
  ]);
  for (const [name, deps] of graph) {
    if (name !== "index.ts") assert(!deps.includes("retention.ts"), `${name} imports retention.ts`);
    assert(!deps.includes("index.ts"), `${name} imports index.ts`);
  }
  // Depth-first search for a cycle.
  const state = new Map<string, "open" | "done">();
  const visit = (n: string, path: string[]) => {
    if (state.get(n) === "done") return;
    if (state.get(n) === "open") throw new Error(`import cycle: ${[...path, n].join(" -> ")}`);
    state.set(n, "open");
    for (const d of graph.get(n) ?? []) visit(d, [...path, n]);
    state.set(n, "done");
  };
  for (const n of graph.keys()) visit(n, []);
});

t("exports: retention.ts is the one door; every module's names come through it", () => {
  for (const name of ["makeRetention", "makePlumbing", "notify", "messagePush", "runInBackground", "syncTz", "makeLibrary",
    "backgroundIdle", "familyProfiles", "dishName", "reactionPush", "isReaction", "postcardPush", "makeCooking", "makeHearts",
    "makeTable", "makeRecap", "computeTable", "computeRecap", "weekStart", "validTz", "RECIPE_EVENT_KINDS", "STAT_EVENT_KINDS"]) {
    assert(name in R, name);
  }
});

// --- the lists code & SQL both spell out agree -----------------------------------------------------

/** The quoted values of one `check (<column> in (...))` in a migration's text. */
function checkList(sql: string, column: string): string[] {
  const m = new RegExp(`${column}\\s+in\\s*\\(([^)]*)\\)`).exec(sql);
  if (!m) throw new Error(`no check on ${column}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

t("lists: event kinds, push kinds, cap reasons & reactions match the plumbing migration's checks", async () => {
  const sql = await Deno.readTextFile(new URL("20261018100000_retention_plumbing.sql", MIGRATIONS));
  const between = (from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to, sql.indexOf(from)));
  assertEquals(checkList(between("recipe_events_kind_check check", ";"), "kind"), [...R.RECIPE_EVENT_KINDS]);
  assertEquals(checkList(between("create table if not exists public.notification_log", "app_initiated"), "kind"), [...R.PUSH_KINDS]);
  assertEquals(checkList(sql, "skipped_reason"), [...R.CAP_REASONS]);
  const body = /coalesce\(body, ''\) in \(([^)]*)\)/.exec(sql)![1];
  assertEquals([...body.matchAll(/'([^']+)'/g)].map((x) => x[1]), [...R.REACTIONS]);
  assert(checkList(between("messages_kind_check\n", ";"), "kind").includes("reaction"));
  assert(R.STAT_EVENT_KINDS.every((k) => (R.RECIPE_EVENT_KINDS as readonly string[]).includes(k)));
  // table_activity counts a listen from the same 3 s the app & POST /events use.
  const table = await Deno.readTextFile(new URL("20261018100300_retention_table.sql", MIGRATIONS));
  assert(table.includes(`e.duration_s >= ${R.HEARD_MIN_S}`));
});

t("copy: the postcard push names the dish the way the started push does, with no pronoun", () => {
  assertEquals(R.postcardPush("Leo", { title: "Mom's Sunday Chili", cook_name: "Mom" }), {
    kind: "postcard",
    title: "Leo made your Sunday Chili",
    body: "Sent you a postcard.",
    url: "/parent/home",
  });
  assertEquals(R.postcardPush("Leo", null).title, "Leo made your recipe");
  assertEquals(R.postcardKey("m1"), "postcard:m1");
  const words = JSON.stringify(R.postcardPush("Leo", { title: "Dal", cook_name: "Mom" }));
  assert(!/\b(he|she|his|her)\b/i.test(words), words);
});

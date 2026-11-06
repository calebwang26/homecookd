// Offline checks for supabase/functions/api/appBuilds.ts, the log of which app builds still call the api
// (docs/build/CUTOVER.md, step 13): the user agent parser, the switch (it ships off, and off writes nothing),
// one write per (day, platform, build) per isolate, and a write that fails or hangs never touching the answer.
// A real supabase-js client talks to a stand-in fetch, so the PostgREST request itself is checked. No network.
// The table and its sweep are checked on real Postgres in retention_migrations_sql_test.ts.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/appBuilds_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1.0.13";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  appBuildOf,
  LOG_APP_BUILDS,
  makeBuildLog,
  MAX_PER_DAY,
  UA_MAX,
} from "../functions/api/appBuilds.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

const STUB = "http://stub.local";
const IOS_6 = "homecookd/6 CFNetwork/1568.100.1 Darwin/24.0.0";
const IOS_7 = "homecookd/7 CFNetwork/3826.500.131 Darwin/24.5.0";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type Seen = { method: string; url: URL; prefer: string; body: Record<string, unknown> };

/** A supabase-js client whose requests land in `seen`. `answer` decides each reply (default: 201). */
function stubDb(answer?: (req: Request) => Promise<Response> | Response) {
  const seen: Seen[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = req.method === "GET" ? "" : await req.clone().text();
    seen.push({ method: req.method, url: new URL(req.url), prefer: req.headers.get("prefer") ?? "", body: text ? JSON.parse(text) : null });
    return answer ? answer(req) : new Response(null, { status: 201 });
  };
  const db = createClient(STUB, "stub-service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch as typeof fetch },
  });
  return { db, seen };
}

/** Background tasks, kept so a test can wait for them (and fail if one ever rejects). */
function tasks() {
  const list: Promise<unknown>[] = [];
  return { background: (p: Promise<unknown>) => void list.push(p), idle: () => Promise.all(list), list };
}

/** console.error's lines while `fn` runs. */
async function errorsDuring(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const was = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = was;
  }
  return lines;
}

const at = (iso: string) => () => new Date(iso);

// --- the parser ------------------------------------------------------------------------------------

t("parser: iOS's own user agent gives the build number", () => {
  assertEquals(appBuildOf(IOS_6), { platform: "ios", build: "6" });
  assertEquals(appBuildOf(IOS_7), { platform: "ios", build: "7" });
  assertEquals(appBuildOf("homecookd/1.0.6 CFNetwork/1568 Darwin/24.0.0"), { platform: "ios", build: "1.0.6" });
  assertEquals(appBuildOf("home%20cookd/12 CFNetwork/1568.100.1 Darwin/24.0.0"), { platform: "ios", build: "12" }); // iOS percent-encodes the name
  assertEquals(appBuildOf(`  ${IOS_6}  `), { platform: "ios", build: "6" });
});

t("parser: Android's OkHttp, and browsers, have no build", () => {
  for (const ua of ["okhttp/4.12.0", "okhttp/4.9.2", "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240805.005)"]) {
    assertEquals(appBuildOf(ua), { platform: "android", build: "unknown" }, ua);
  }
  for (const ua of [SAFARI, CHROME]) assertEquals(appBuildOf(ua), { platform: "web", build: "unknown" }, ua);
});

t("parser: anything else is other, with no build", () => {
  const junk = [
    null, undefined, "", "   ", "curl/8.7.1", "python-requests/2.32.3", "pg_net/0.10.0", "Deno/2.1.4", "node",
    "homecookd/6", // no CFNetwork part
    "homecookd/abc CFNetwork/1568 Darwin/24.0.0", // not a number
    "homecookd/1.2.3.4 CFNetwork/1568 Darwin/24.0.0", // four numbers: not a CFBundleVersion
    "homecookd/1234567 CFNetwork/1568 Darwin/24.0.0", // seven digits
    `${IOS_6} extra`, // something after Darwin
    "home cookd/6 CFNetwork/1568 Darwin/24.0.0", // a space in the name: iOS never sends one
    "'; drop table app_builds_seen; --/6 CFNetwork/1 Darwin/1",
  ];
  for (const ua of junk) assertEquals(appBuildOf(ua), { platform: "other", build: "unknown" }, String(ua));
});

t("parser: a very long user agent is other, unread, however it starts", () => {
  const browser = (n: number) => `Mozilla/5.0 ${"x".repeat(n - "Mozilla/5.0 ".length)}`;
  assertEquals(appBuildOf(browser(UA_MAX)), { platform: "web", build: "unknown" }); // at the cap: still read
  assertEquals(appBuildOf(browser(UA_MAX + 1)), { platform: "other", build: "unknown" });
  assertEquals(appBuildOf(`homecookd/6 CFNetwork/1568 Darwin/${"1".repeat(UA_MAX)}`), { platform: "other", build: "unknown" });
  assertEquals(appBuildOf(`homecookd/${"9".repeat(100_000)} CFNetwork/1 Darwin/1`), { platform: "other", build: "unknown" });
  assertEquals(appBuildOf(`${"a".repeat(101)}/6 CFNetwork/1 Darwin/1`), { platform: "other", build: "unknown" }); // a name past 100
  assertEquals(appBuildOf(`${"a".repeat(100)}/6 CFNetwork/1 Darwin/1`), { platform: "ios", build: "6" });
  // Bounded: hostile strings under the cap can't make the parser slow.
  const started = performance.now();
  for (let i = 0; i < 2000; i++) appBuildOf(`${"a".repeat(99)}/${"1.".repeat(150)} CFNetwork/${"9".repeat(200)}`);
  assert(performance.now() - started < 1000, "2000 hostile parses took over a second");
});

// --- the switch ------------------------------------------------------------------------------------

t("switch: it ships off, and index.ts hands it to the log before any route runs", async () => {
  assertEquals(LOG_APP_BUILDS, false);
  const src = await Deno.readTextFile(new URL("../functions/api/index.ts", import.meta.url));
  assert(src.includes("makeBuildLog({ on: LOG_APP_BUILDS, db, background: runInBackground })"), "index.ts builds the log from the switch");
  const serve = src.indexOf("Deno.serve(");
  const record = src.indexOf('buildLog.record(req.headers.get("user-agent"));');
  const routing = src.indexOf("for (const r of publicRoutes)");
  assert(serve > 0 && serve < record && record < routing, "record() runs first thing in Deno.serve, before routing");
  const switches = await Deno.readTextFile(new URL("../functions/api/appBuilds.ts", import.meta.url));
  assertEquals(switches.match(/^export const LOG_APP_BUILDS: boolean = (true|false);$/gm), ["export const LOG_APP_BUILDS: boolean = false;"]);
});

t("switch off: nothing is written, nothing runs in the background", async () => {
  const { db, seen } = stubDb();
  const bg = tasks();
  const log = makeBuildLog({ on: false, db, background: bg.background, clock: at("2026-11-02T10:00:00Z") });
  for (const ua of [IOS_6, IOS_7, SAFARI, "okhttp/4.9.2", null, "x".repeat(100_000)]) assertEquals(log.record(ua), undefined);
  await bg.idle();
  assertEquals([bg.list.length, seen.length], [0, 0]);
});

// --- switched on -----------------------------------------------------------------------------------

t("on: one upsert per (day, platform, build) in an isolate, with the build and platform only", async () => {
  const { db, seen } = stubDb();
  const bg = tasks();
  let now = "2026-11-02T10:00:00.000Z";
  const log = makeBuildLog({ on: true, db, background: bg.background, clock: () => new Date(now) });
  for (let i = 0; i < 5; i++) log.record(IOS_6);
  log.record(IOS_7);
  log.record(SAFARI);
  log.record(CHROME); // another browser: still web, unknown
  log.record("curl/8.7.1");
  log.record(null); // other, unknown again
  await bg.idle();
  assertEquals(seen.map((s) => [s.body.platform, s.body.build]), [["ios", "6"], ["ios", "7"], ["web", "unknown"], ["other", "unknown"]]);
  for (const s of seen) {
    assertEquals([s.method, s.url.pathname, s.url.searchParams.get("on_conflict")], ["POST", "/rest/v1/app_builds_seen", "day,platform,build"]);
    assert(s.prefer.includes("resolution=merge-duplicates"), s.prefer);
    // first_seen is left to the table's default, so an upsert never moves it; no user agent, no person.
    assertEquals(Object.keys(s.body).sort(), ["build", "day", "last_seen", "platform"]);
    assertEquals([s.body.day, s.body.last_seen], ["2026-11-02", now]);
  }

  // The next UTC day starts over.
  now = "2026-11-03T00:00:01.000Z";
  log.record(IOS_6);
  log.record(IOS_6);
  await bg.idle();
  assertEquals(seen.slice(4).map((s) => [s.body.day, s.body.build]), [["2026-11-03", "6"]]);

  // Another isolate keeps its own list, so it writes the same build again (the upsert makes it one row).
  const other = makeBuildLog({ on: true, db, background: bg.background, clock: () => new Date(now) });
  other.record(IOS_6);
  await bg.idle();
  assertEquals(seen.length, 6);
});

t("on: made-up user agents stop at MAX_PER_DAY writes an isolate a day", async () => {
  const { db, seen } = stubDb();
  const bg = tasks();
  let now = "2026-11-02T10:00:00Z";
  const log = makeBuildLog({ on: true, db, background: bg.background, clock: () => new Date(now) });
  for (let b = 1; b <= MAX_PER_DAY + 30; b++) log.record(`homecookd/${b} CFNetwork/1568 Darwin/24.0.0`);
  await bg.idle();
  assertEquals(seen.length, MAX_PER_DAY);
  now = "2026-11-03T10:00:00Z";
  log.record(IOS_6);
  await bg.idle();
  assertEquals(seen.length, MAX_PER_DAY + 1);
});

t("on: a failed write is logged by its kind only, never thrown, and isn't retried that day", async () => {
  const pgError = () =>
    new Response(JSON.stringify({ code: "42P01", message: 'relation "public.app_builds_seen" does not exist', details: null, hint: null }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  for (const [answer, kind] of [
    [pgError, "42P01"],
    [() => new Response("<html>bad gateway</html>", { status: 502 }), "error"],
    [() => Promise.reject(new TypeError("network down: homecookd/6 CFNetwork")), "TypeError"],
  ] as const) {
    const { db, seen } = stubDb(answer);
    const bg = tasks();
    const log = makeBuildLog({ on: true, db, background: bg.background, clock: at("2026-11-02T10:00:00Z") });
    const lines = await errorsDuring(async () => {
      log.record(IOS_6);
      log.record(IOS_6);
      await bg.idle(); // resolves: the task never rejects
    });
    assertEquals(seen.length, 1, kind);
    // The kind only: no message words, no user agent.
    assertEquals(lines, [`app build log failed: ${kind}`]);
  }
});

t("on: a hanging write is cut off by its timeout", async () => {
  const { db, seen } = stubDb((req) =>
    new Promise<Response>((_, reject) => req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true }))
  );
  const bg = tasks();
  const log = makeBuildLog({ on: true, db, background: bg.background, clock: at("2026-11-02T10:00:00Z"), timeoutMs: 30 });
  const started = performance.now();
  const lines = await errorsDuring(async () => {
    log.record(IOS_6);
    await bg.idle();
  });
  assertEquals(seen.length, 1);
  assert(performance.now() - started < 2000, "the write waited past its timeout");
  assertEquals(lines.length, 1, JSON.stringify(lines));
  assert(/^app build log failed: (TimeoutError|AbortError)$/.test(lines[0]), lines[0]);
});

t("on: the answer goes out while the write still hangs", async () => {
  let release = () => {};
  const { db, seen } = stubDb(() => new Promise<Response>((done) => (release = () => done(new Response(null, { status: 201 })))));
  const bg = tasks();
  let settled = false;
  const log = makeBuildLog({
    on: true,
    db,
    background: (p) => bg.background(p.finally(() => (settled = true))),
    clock: at("2026-11-02T10:00:00Z"),
  });
  // The same shape as index.ts's Deno.serve: record() first, then the route answers.
  const handler = (req: Request) => {
    log.record(req.headers.get("user-agent"));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const res = handler(new Request("http://edge.local/functions/v1/api/family", { headers: { "user-agent": IOS_6 } }));
  assertEquals([res.status, await res.json(), settled], [200, { ok: true }, false]);
  for (let i = 0; i < 200 && !seen.length; i++) await new Promise((r) => setTimeout(r, 5));
  assertEquals([seen.length, settled], [1, false]); // the write reached the database and is still waiting
  release();
  await bg.idle();
  assert(settled);
});

t("on: a client or clock that throws can't reach the request", async () => {
  const broken = { from: () => { throw new Error("boom"); } } as unknown as ReturnType<typeof stubDb>["db"];
  const { db, seen } = stubDb();
  const bg = tasks();
  const lines = await errorsDuring(async () => {
    const a = makeBuildLog({ on: true, db: broken, background: bg.background, clock: at("2026-11-02T10:00:00Z") });
    assertEquals(a.record(IOS_6), undefined);
    await bg.idle();
    const b = makeBuildLog({ on: true, db, background: bg.background, clock: () => { throw new RangeError("clock"); } });
    assertEquals(b.record(IOS_6), undefined);
    await bg.idle();
  });
  assertEquals(lines, ["app build log failed: Error", "app build log failed: RangeError"]);
  assertEquals(seen.length, 0);
});

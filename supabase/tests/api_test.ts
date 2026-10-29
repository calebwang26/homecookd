// Offline checks for the api function's two-sided routes (device keys, whose phone it is and the
// lock on faces with their own phone, invites named and family-wide, POST /profiles/self, moving to
// a new phone, removal, Apple / Google, the lander's POST /web-events). No database and no network: `fetch` is swapped for a tiny
// in-memory stand-in for PostgREST that understands just the filters these routes use (plus Apple's
// key set, served from a key made here, so real signed tokens can be checked; plus `order`, `limit` and
// the one-pending-ask-per-phone unique index), and Deno.serve is
// captured so requests go straight to the handler. The live check is two_sided_live.mjs.
//
// Storage is stubbed too, just enough for signed upload / read URLs (`stored` = the files "uploaded").
// Expo's push API is caught too (`pushed` = every message sent to exp.host; a token with "dead" in
// it answers DeviceNotRegistered), and so is the cron's secret check (CRON_SECRET is the right one).
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/api_test.ts

import { assert, assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1.0.13";
import { exportJWK, generateKeyPair, SignJWT } from "npm:jose@5.9.6";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Handler = (req: Request) => Promise<Response>;

const STUB = "http://stub.local";
const FAM = "11111111-1111-4111-8111-111111111111";
const MOM = "22222222-2222-4222-8222-222222222222";
const DAD = "33333333-3333-4333-8333-333333333333";
const SAM = "44444444-4444-4444-8444-444444444444"; // removed
const KEY = "Mk".repeat(21) + "x"; // 43 base64url characters; Mom's phone (Apple)
const DAD_KEY = "Dd".repeat(21) + "x"; // Dad's phone, when a test gives him one (dadsPhone)
const CODE = "TEST-CODE";
const SHARE = "SE65stMwrw"; // Mom's recipe link
const SIGNED_OUT = "This phone was signed out.";
const BUCKET = "https://storage.googleapis.com/edible-media-379797517579"; // the function's default
const CHILI = { id: "dad-sunday-chili", title: "Dad's Sunday Chili", cook: { name: "Dad", relation: "Dad" } };

const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

// --- Apple's key set, from a key made here ----------------------------------------------------

const apple = await generateKeyPair("RS256");
const APPLE_JWK = { ...(await exportJWK(apple.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
let appleKeysDown = false;

/** A real signed Apple id token (Expo Go's audience unless told otherwise). */
function appleToken(sub: string, opts: { aud?: string; email?: string } = {}) {
  return new SignJWT(opts.email ? { email: opts.email } : {})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(opts.aud ?? "host.exp.Exponent")
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(apple.privateKey);
}

// --- the in-memory database ------------------------------------------------------------------

let tables: Record<string, Row[]> = {};
/** What public.table_activity answers (PR 5), per test: the rows since p_since, as one jsonb array. */
let tableActivity: Row[] = [];
/** Every message handed to Expo's push API, in order. */
let pushed: Row[] = [];
const CRON_SECRET = "cron-test-secret";
/** Storage objects that exist, as "<bucket>/<path>" (a test adds one to stand for its PUT). */
let stored = new Set<string>();
let rateHits: string[] = [];
let rateKeys: string[] = [];
let rateDeny = new Set<string>();
/**
 * Runs before the stand-in handles a request (to stage a race, e.g. another tap's write). A Response
 * it returns is the answer instead (a database error, say).
 */
let beforeRequest: ((table: string, method: string, url: URL) => void | Response) | null = null;

/** An ISO time `days` ago. */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function reset() {
  const now = new Date().toISOString();
  tables = {
    families: [{ id: FAM, name: "Test family", code_hash: await sha(CODE), code_enc: null }],
    // Mom started the family (its first person); Mom's phone joined just now (below).
    profiles: [
      { id: MOM, family_id: FAM, name: "Mom", role: "cook", relation: "Mom", avatar_key: "mom", sort: 1, removed_at: null, email: null, created_at: ago(30) },
      { id: DAD, family_id: FAM, name: "Dad", role: "cook", relation: "Dad", avatar_key: null, sort: 2, removed_at: null, email: null, created_at: ago(29) },
      { id: SAM, family_id: FAM, name: "Sam", role: "learner", relation: null, avatar_key: null, sort: 3, removed_at: now, email: null, created_at: ago(29) },
    ],
    devices: [{
      id: crypto.randomUUID(), family_id: FAM, profile_id: MOM, key_hash: await sha(KEY), label: "iPhone",
      via: "apple", created_at: now, last_seen_at: now, revoked_at: null,
    }],
    identities: [],
    invites: [],
    threads: [],
    messages: [],
    thread_reads: [],
    lander_events: [],
    signups: [],
    shares: [{ token: SHARE, family_id: FAM, recipe_id: "dad-sunday-chili", sender_id: MOM }],
    recipe_notes: [],
    favorites: [],
    move_requests: [],
    recipe_events: [],
    pending_sends: [],
    push_tokens: [],
    notification_log: [],
    cooking_now: [],
    join_links: [],
  };
  pushed = [];
  stored = new Set();
  rateHits = [];
  tableActivity = [];
  rateKeys = [];
  rateDeny = new Set();
  appleKeysDown = false;
  beforeRequest = null;
}

const DEFAULTS: Record<string, () => Row> = {
  devices: () => ({ revoked_at: null, last_seen_at: new Date().toISOString() }),
  invites: () => ({ status: "pending", used_at: null, used_device_id: null }),
  profiles: () => ({ removed_at: null, email: null }),
  threads: () => ({ last_message_at: null }),
  move_requests: () => ({ status: "pending", decided_at: null, decided_by: null }),
};

/**
 * PostgREST's `order=a.desc,b.asc`. Ties (and `id`, a random uuid in Postgres) fall back to the
 * order rows were made in, read in the first key's direction, as created_at would at full precision.
 */
function sorted(rows: Row[], all: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((k) => k.split(".")).map(([col, dir]) => ({ col, desc: dir === "desc" }));
  const val = (v: unknown) =>
    (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v) as number | string | null | undefined;
  return [...rows].sort((a, b) => {
    for (const { col, desc } of keys) {
      if (col === "id") continue;
      const x = val(a[col]);
      const y = val(b[col]);
      if (x === y) continue;
      if (x === null || x === undefined) return desc ? -1 : 1; // Postgres: nulls last asc, first desc
      if (y === null || y === undefined) return desc ? 1 : -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }
    return (all.indexOf(a) - all.indexOf(b)) * (keys[0]?.desc ? -1 : 1);
  });
}

function test1(row: Row, col: string, raw: string): boolean {
  let op = raw.slice(0, raw.indexOf("."));
  let val = raw.slice(raw.indexOf(".") + 1);
  let negate = false;
  if (op === "not") {
    negate = true;
    op = val.slice(0, val.indexOf("."));
    val = val.slice(val.indexOf(".") + 1);
  }
  const v = row[col];
  let ok: boolean;
  if (op === "eq") ok = String(v) === val;
  else if (op === "neq") ok = String(v) !== val;
  else if (op === "is") ok = val === "null" ? v === null || v === undefined : String(v) === val;
  else if (op === "in") ok = val.slice(1, -1).split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(v));
  else if (op === "gt") ok = v !== null && v !== undefined && Date.parse(v) > Date.parse(val);
  else if (op === "lt") ok = v !== null && v !== undefined && Date.parse(v) < Date.parse(val);
  else if (op === "gte") ok = v !== null && v !== undefined && Date.parse(v) >= Date.parse(val);
  else throw new Error(`stub: unsupported filter ${col}=${raw}`);
  return negate ? !ok : ok;
}

function matches(row: Row, query: URLSearchParams): boolean {
  for (const [col, raw] of query) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
    if (col === "or") {
      // `(a_profile.eq.X,b_profile.eq.X)`: any one of them
      const parts = raw.slice(1, -1).split(",");
      if (!parts.some((p) => test1(row, p.slice(0, p.indexOf(".")), p.slice(p.indexOf(".") + 1)))) return false;
    } else if (!test1(row, col, raw)) return false;
  }
  return true;
}

/** Attach `families(...)` / `profiles(...)` embeds the way PostgREST would (many-to-one). */
function embed(table: string, row: Row, select: string): Row {
  const out = { ...row };
  const fam = (id: string) => tables.families.find((f) => f.id === id);
  if (select.includes("families(") && row.family_id) out.families = { name: fam(row.family_id)?.name, code_enc: fam(row.family_id)?.code_enc };
  if (select.includes("profiles(") && table !== "profiles") {
    const p = tables.profiles.find((x) => x.id === (row.profile_id ?? row.sender_id));
    out.profiles = p ? { ...p, families: { name: fam(p.family_id)?.name } } : null;
  }
  return out;
}

function reply(req: Request, rows: Row[], status = 200): Response {
  const accept = req.headers.get("accept") ?? "";
  const prefer = req.headers.get("prefer") ?? "";
  const headers = { "content-type": "application/json", "content-range": `*/${rows.length}` };
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  if (accept.includes("vnd.pgrst.object")) {
    return rows.length === 1
      ? new Response(JSON.stringify(rows[0]), { status, headers })
      : new Response(JSON.stringify({ code: "PGRST116", message: "not one row" }), { status: 406, headers });
  }
  if (req.method !== "GET" && !prefer.includes("return=representation")) {
    return new Response(null, { status: req.method === "POST" ? 201 : 204 });
  }
  return new Response(JSON.stringify(rows), { status, headers });
}

/** Supabase Storage's signed-URL endpoints (supabase-js builds the full URLs from these paths). */
function storageReply(url: URL, body: Row | null): Response {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const rest = url.pathname.replace("/storage/v1/object/", "");
  if (rest.startsWith("upload/sign/")) {
    const key = rest.slice("upload/sign/".length);
    return json({ url: `/object/upload/sign/${key}?token=up` });
  }
  if (rest.startsWith("sign/")) {
    const [bucket, ...path] = rest.slice("sign/".length).split("/");
    const signed = (p: string) => `/object/sign/${bucket}/${p}?token=read`;
    if (path.length) {
      const p = path.join("/");
      return stored.has(`${bucket}/${p}`) ? json({ signedURL: signed(p) }) : json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
    }
    return json((body!.paths as string[]).map((p) =>
      stored.has(`${bucket}/${p}`) ? { path: p, signedURL: signed(p), error: null } : { path: p, signedURL: null, error: "Object not found" }
    ));
  }
  throw new Error(`stub: storage ${url.pathname}`);
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.href === "https://appleid.apple.com/auth/keys") {
    return appleKeysDown
      ? new Response("down", { status: 500 })
      : new Response(JSON.stringify({ keys: [APPLE_JWK] }), { headers: { "content-type": "application/json" } });
  }
  // The chili's recipe.json (GET only: assertRecipe's HEAD still finds the network off and skips).
  if (req.method === "GET" && url.href === `${BUCKET}/dad-sunday-chili/recipe.json`) {
    return new Response(JSON.stringify(CHILI), { headers: { "content-type": "application/json" } });
  }
  // PR 2: one dish's recipe.json in the public bucket (whose dish it is, its title for the push).
  // The api caches recipe.json for 10 minutes per isolate, so this stays the same for the whole file.
  if (url.href === `${BUCKET}/mom-dal/recipe.json`) {
    return new Response(req.method === "HEAD" ? null : JSON.stringify({ title: "Mom's Dal", cook: { name: "Mom" }, steps: [] }), {
      headers: { "content-type": "application/json" },
    });
  }
  // PR 4: library.json (GET /dish-stats and /hearts/recent map dishes to their cook through it).
  if (url.href === `${BUCKET}/library.json`) {
    return new Response(JSON.stringify(BUCKET_LIBRARY), { headers: { "content-type": "application/json" } });
  }
  if (url.href === "https://exp.host/--/api/v2/push/send") {
    const batch = JSON.parse(await req.text()) as Row[];
    pushed.push(...batch);
    const ticket = (m: Row) =>
      String(m.to).includes("dead")
        ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: crypto.randomUUID() };
    return new Response(JSON.stringify({ data: batch.map(ticket) }), { headers: { "content-type": "application/json" } });
  }
  if (url.origin !== STUB) throw new TypeError(`network is off in tests (${url.origin})`);
  const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  const body = text ? JSON.parse(text) : null;
  if (url.pathname === "/rest/v1/rpc/table_activity") {
    const since = Date.parse(body.p_since);
    const rows = body.p_family === FAM ? tableActivity.filter((r) => Date.parse(r.at) >= since) : [];
    return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/rest/v1/rpc/hit_rate") {
    const kind = body.p_key.split(":")[0];
    rateHits.push(kind);
    rateKeys.push(body.p_key);
    return new Response(rateDeny.has(kind) ? "false" : "true", { headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/rest/v1/rpc/cron_secret_ok") {
    return new Response(body.p_secret === CRON_SECRET ? "true" : "false", { headers: { "content-type": "application/json" } });
  }
  if (url.pathname.startsWith("/storage/v1/object/")) return storageReply(url, body);
  const table = url.pathname.replace("/rest/v1/", "");
  const early = beforeRequest?.(table, req.method, url);
  if (early) return early;
  const rows = tables[table];
  if (!rows) throw new Error(`stub: no table ${table}`);
  const select = url.searchParams.get("select") ?? "";
  const hit = rows.filter((r) => matches(r, url.searchParams));
  switch (req.method) {
    case "GET":
    case "HEAD": {
      if (req.method === "HEAD") return reply(req, hit);
      const limit = Number(url.searchParams.get("limit") ?? Infinity);
      return reply(req, sorted(hit, rows, url.searchParams.get("order")).slice(0, limit).map((r) => embed(table, r, select)));
    }
    case "POST": {
      const now = new Date().toISOString();
      const made: Row[] = (Array.isArray(body) ? body : [body]).map((b: Row) => ({
        id: crypto.randomUUID(), created_at: now, ...(DEFAULTS[table]?.() ?? {}), ...b,
      }));
      // move_requests_one_pending: one pending ask per phone.
      if (table === "move_requests" && made.some((m) => m.status === "pending" && rows.some((r) => r.device_id === m.device_id && r.status === "pending"))) {
        return new Response(JSON.stringify({ code: "23505", message: "duplicate key value violates unique constraint \"move_requests_one_pending\"" }), {
          status: 409, headers: { "content-type": "application/json" },
        });
      }
      rows.push(...made);
      return reply(req, made, 201);
    }
    case "PATCH":
      for (const r of hit) Object.assign(r, body);
      return reply(req, hit);
    case "DELETE":
      tables[table] = rows.filter((r) => !hit.includes(r));
      return reply(req, hit);
  }
  throw new Error(`stub: ${req.method}`);
}

/** library.json in the public bucket (PR 4: whose dish is whose). One for the whole file: the api caches it 10 min. */
const BUCKET_LIBRARY = [
  { id: "dad-sunday-chili", title: "Sunday Chili", cook_name: "Dad", relation: "Dad", sample: true, recipe_url: "x" },
  { id: "dad-fried-rice", title: "Fried Rice", cook_name: "Dad", relation: "Dad", sample: false, recipe_url: "x" },
  { id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", relation: "Mom", sample: false, recipe_url: "x" },
];

// --- load the function with the stand-ins in place --------------------------------------------

Deno.env.set("SUPABASE_URL", STUB);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-key");
Deno.env.delete("GOOGLE_CLIENT_IDS");
Deno.env.delete("APPLE_AUDIENCES");
globalThis.fetch = fakeFetch as typeof fetch;
let handler: Handler | null = null;
(Deno as unknown as { serve: (h: Handler) => unknown }).serve = (h: Handler) => {
  handler = h;
  return {};
};
// The function logs a few expected failures (a refused audience, keys down, the code limiter);
// keep those out of the test output and let anything else through.
const logError = console.error;
// "library fetch:": a dish's recipe.json for push copy, other than the chili's (the network is off).
const EXPECTED = /^(apple: token audience|apple keys:|ALERT invite codes|library fetch:)/;
console.error = (...args: unknown[]) => (EXPECTED.test(String(args[0])) ? undefined : logError(...args));
// Messages about a dish check the public bucket (assertRecipe's HEAD), which is off here: the
// check lets them through, as when the bucket is down.
const logWarn = console.warn;
console.warn = (...args: unknown[]) => (/^recipe check skipped/.test(String(args[0])) ? undefined : logWarn(...args));
await import("../functions/api/index.ts");
// Pushes go out after the response (runInBackground); tests wait for them with backgroundIdle().
const { backgroundIdle } = await import("../functions/api/retention.ts");

async function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  let body: string | undefined = opts.raw;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  const res = await handler!(new Request(`http://edge.local/functions/v1/api${path}`, { method, headers, body }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

const asMom = { "x-device-key": KEY, "x-profile-id": MOM };
const t = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn: async () => (await reset(), await fn()) });
const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;
const findDevice = async (key: string) => {
  const h = await sha(key);
  return tables.devices.find((d) => d.key_hash === h)!;
};
const pendingInvite = (profileId: string) =>
  tables.invites.push({
    id: crypto.randomUUID(), family_id: FAM, inviter_id: MOM, profile_id: profileId, status: "pending",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), token_hash: crypto.randomUUID(), code_hash: crypto.randomUUID(),
  });

/** The family circle's id, and a write as someone that touches nothing else (marking it read). */
const circleId = async () => (await call("GET", "/circle", { headers: { "x-family-code": CODE } })).data.id as string;
const write = (cid: string, headers: Record<string, string>) => call("POST", `/threads/${cid}/read`, { headers });

/** A phone that joined through a family invite from Mom: in the family, with no person yet. */
async function familyPhone(): Promise<string> {
  const inv = await call("POST", "/invites", { headers: asMom, body: {} });
  const acc = await call("POST", "/invites/accept", { body: { token: tokenOf(inv.data.invite.url), device_label: "iPhone" } });
  assertEquals([acc.status, acc.data.profile_id], [200, null], JSON.stringify(acc.data));
  return acc.data.device_key;
}

/** Give Dad a phone of his own (Apple), signed in two days ago: he is locked to it, and settled. */
async function dadsPhone() {
  tables.devices.push({
    id: crypto.randomUUID(), family_id: FAM, profile_id: DAD, key_hash: await sha(DAD_KEY), label: "iPhone",
    via: "apple", created_at: ago(2), last_seen_at: new Date().toISOString(), revoked_at: null,
  });
}
const asDad = { "x-device-key": DAD_KEY, "x-profile-id": DAD };

/** A phone-less face added the old way (no invite, no phone). */
const phoneless = async (name: string) =>
  (await call("POST", "/profiles", { headers: { "x-family-code": CODE }, body: { name, role: "cook" } })).data as Row;

/** This family-invite phone asks to be `who`. */
const askMove = (key: string, who: string) => call("POST", "/move-requests", { headers: { "x-device-key": key }, body: { profile_id: who } });
const answer = (id: string, how: "approve" | "decline", headers: Record<string, string>) =>
  call("POST", `/move-requests/${id}/${how}`, { headers });
const mineFull = async (key: string) => (await call("GET", "/move-requests/mine", { headers: { "x-device-key": key } })).data;
/** This phone's latest ask, without the waiting sheet's names (see the asked / let_in_by test). */
const mine = async (key: string) => {
  const r = await mineFull(key);
  return r && { id: r.id, profile_id: r.profile_id, status: r.status };
};
const notes = () => tables.messages.filter((m) => m.kind === "system").map((m) => [m.body, m.sender_id]);

/** Mom invites someone new; returns the invite and their profile. */
async function invite(name: string, role = "learner") {
  const r = await call("POST", "/invites", { headers: asMom, body: { name, role } });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return r.data as { invite: Row; profile: Row };
}

// --- tests ------------------------------------------------------------------------------------

t("CORS allows x-device-key", async () => {
  const res = await handler!(new Request("http://edge.local/functions/v1/api/family", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assert(res.headers.get("access-control-allow-headers")!.includes("x-device-key"));
});

t("GET /family by device key: invited, phones, locks, former people, this phone's profile", async () => {
  pendingInvite(DAD);
  const r = await call("GET", "/family", { headers: asMom });
  assertEquals(r.status, 200);
  assertEquals(r.data.family.name, "Test family");
  // [name, invited, has_phone, locked]: Mom's phone is this one, so she isn't locked here.
  assertEquals(
    r.data.profiles.map((p: Row) => [p.name, p.invited, p.has_phone, p.locked]),
    [["Mom", false, true, false], ["Dad", true, false, false]],
  );
  assertEquals(r.data.former_profiles.map((p: Row) => p.name), ["Sam"]);
  assertEquals([r.data.device_profile_id, r.data.device_needs_profile], [MOM, false]);
  assertEquals(r.data.can_manage, true, "Mom started the family");
});

t("unknown, malformed and revoked keys all get the exact signed-out 401", async () => {
  for (const key of ["Zz".repeat(21) + "z", "short"]) {
    const r = await call("GET", "/family", { headers: { "x-device-key": key } });
    assertEquals([r.status, r.data.error], [401, SIGNED_OUT]);
  }
  assertEquals(rateHits, ["badcode", "badcode"]);
  tables.devices[0].revoked_at = new Date().toISOString();
  const r = await call("GET", "/family", { headers: { "x-device-key": KEY } });
  assertEquals([r.status, r.data.error], [401, SIGNED_OUT]);
  assertEquals(rateHits.length, 2, "a revoked key isn't a guess");
});

t("a removed person can't act, but GET /family still loads for them", async () => {
  const fam = await call("GET", "/family", { headers: { "x-device-key": KEY, "x-profile-id": SAM } });
  assertEquals(fam.status, 200);
  const fav = await call("GET", "/favorites", { headers: { "x-device-key": KEY, "x-profile-id": SAM } });
  assertEquals(fav.status, 403);
});

t("family code still works, and POST /devices swaps it for a key (never a key for a key)", async () => {
  const r = await call("POST", "/devices", { headers: { "x-family-code": CODE.toLowerCase() }, body: { label: "iPad" } });
  assertEquals(r.status, 200);
  assertMatch(r.data.device_key, /^[A-Za-z0-9_-]{43}$/);
  const row = tables.devices.at(-1)!;
  assertEquals([row.via, row.profile_id, row.label, row.key_hash], ["code", null, "iPad", await sha(r.data.device_key)]);
  const fam = await call("GET", "/family", { headers: { "x-device-key": r.data.device_key } });
  assertEquals([fam.status, fam.data.device_profile_id, fam.data.device_needs_profile], [200, null, false]);

  // A key can't mint another key: it would belong to nobody and outlive its person's removal.
  for (const key of [KEY, r.data.device_key]) {
    const spare = await call("POST", "/devices", { headers: { "x-device-key": key }, body: {} });
    assertEquals([spare.status, spare.data.error], [400, "This phone already has its own key."]);
  }
  assertEquals(tables.devices.length, 2);

  const out = await call("POST", "/devices/revoke", { headers: { "x-device-key": r.data.device_key } });
  assertEquals(out.status, 200);
  const after = await call("GET", "/family", { headers: { "x-device-key": r.data.device_key } });
  assertEquals(after.status, 401);
});

t("a phone with no person gets one on its first write as someone phone-less, and it never moves", async () => {
  const key = (await call("POST", "/devices", { headers: { "x-family-code": CODE }, body: {} })).data.device_key;
  const as = (who: string) => ({ "x-device-key": key, "x-profile-id": who });
  const cid = await circleId();
  const kai = (await invite("Kai")).profile;
  const lin = (await call("POST", "/profiles", { headers: { "x-family-code": CODE }, body: { name: "Lin", role: "cook" } })).data;
  // Reads never set it: the Profiles screen reads everyone's lines as each person.
  assertEquals((await call("GET", "/favorites", { headers: as(DAD) })).status, 200);
  assertEquals((await findDevice(key)).profile_id, null);
  // Mom has her own phone: this one can't be her, so it doesn't become hers.
  const mom = await write(cid, as(MOM));
  assertEquals([mom.status, mom.data.error], [403, "Mom uses their own phone."]);
  // Nobody only invited either (a message "from Kai" would be from this phone): their link claims them.
  const asKai = await write(cid, as(kai.id));
  assertEquals([asKai.status, asKai.data.error], [403, "Kai hasn't joined yet. Pick your own face."]);
  assertEquals((await call("GET", "/favorites", { headers: as(kai.id) })).status, 200, "reads as them are fine");
  assertEquals((await findDevice(key)).profile_id, null);
  // The first write as someone phone-less makes it theirs. Later writes as other phone-less people
  // (Lin on Dad's iPad) and reads as anyone leave it alone.
  assertEquals((await write(cid, as(DAD))).status, 200);
  assertEquals((await findDevice(key)).profile_id, DAD);
  assertEquals((await write(cid, as(lin.id))).status, 200);
  assertEquals((await call("POST", "/invites", { headers: as(lin.id), body: { name: "Ivy", role: "learner" } })).status, 200);
  assertEquals((await findDevice(key)).profile_id, DAD, "set once");
  const fam = await call("GET", "/family", { headers: { "x-device-key": key } });
  assertEquals([fam.data.device_profile_id, fam.data.device_needs_profile], [DAD, false]);
  assertEquals(
    fam.data.profiles.map((p: Row) => [p.name, p.has_phone, p.locked, p.invited]),
    [["Mom", true, true, false], ["Dad", true, false, false], ["Kai", false, false, true], ["Lin", false, false, false], ["Ivy", false, false, true]],
  );

  // Dad leaving from this phone (his now) signs it out.
  const r = await call("POST", `/profiles/${DAD}/remove`, { headers: as(DAD) });
  assertEquals(r.status, 200);
  const gone = await call("GET", "/family", { headers: { "x-device-key": key } });
  assertEquals([gone.status, gone.data.error], [401, SIGNED_OUT]);
  // An Apple phone's person never moves either.
  assertEquals((await call("GET", "/favorites", { headers: asMom })).status, 200);
  assertEquals(tables.devices[0].profile_id, MOM);
});

t("someone with their own phone can only be them from it: other phones and the code get 403, reads too", async () => {
  const cid = await circleId();
  const byCode = (who: string) => ({ "x-family-code": CODE, "x-profile-id": who });
  for (const r of [await call("GET", "/threads", { headers: byCode(MOM) }), await write(cid, byCode(MOM))]) {
    assertEquals([r.status, r.data.error], [403, "Mom uses their own phone."], "the family code (old builds)");
  }
  const dadKey = (await call("POST", "/devices", { headers: { "x-family-code": CODE }, body: {} })).data.device_key;
  assertEquals((await write(cid, { "x-device-key": dadKey, "x-profile-id": DAD })).status, 200); // now Dad's phone
  const momOnDads = { "x-device-key": dadKey, "x-profile-id": MOM };
  for (const r of [await call("GET", "/threads", { headers: momOnDads }), await write(cid, momOnDads)]) {
    assertEquals([r.status, r.data.error], [403, "Mom uses their own phone."], "another phone");
  }
  assertEquals((await call("GET", "/threads", { headers: asMom })).status, 200, "her own phone");
  assertEquals((await call("GET", "/favorites", { headers: byCode(DAD) })).status, 403, "Dad has a phone now too");

  // GET /family: locked everywhere but their own phone. A locked x-profile-id is ignored there, so a
  // phone that remembers them still loads the family.
  const fromDad = await call("GET", "/family", { headers: momOnDads });
  assertEquals([fromDad.status, fromDad.data.profiles.map((p: Row) => p.locked)], [200, [true, false]]);
  assertEquals((await call("GET", "/family", { headers: byCode(MOM) })).data.profiles.map((p: Row) => p.locked), [true, true]);
  assertEquals((await call("GET", "/family", { headers: asMom })).data.profiles.map((p: Row) => p.locked), [false, true]);

  // Signing her phone out unlocks her.
  tables.devices[0].revoked_at = new Date().toISOString();
  assertEquals((await call("GET", "/threads", { headers: byCode(MOM) })).status, 200);
});

t("invite: create, peek, accept once, then 410; joined people aren't 'invited'", async () => {
  const made = await call("POST", "/invites", { headers: asMom, body: { name: "Grandpa", role: "cook", phone: "+1 (555) 010-2030" } });
  assertEquals(made.status, 200);
  const { invite, profile } = made.data;
  assertMatch(invite.url, /^https:\/\/homecookd\.app\/i\?t=[0-9A-Za-z]{16}&c=[A-HJ-NP-Z2-9]{6}$/);
  assertMatch(invite.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assertEquals(new URL(invite.url).searchParams.get("c"), invite.code, "the link carries the code for the web /i page");
  assertEquals([profile.name, profile.invited, invite.phone], ["Grandpa", true, "+15550102030"]);
  const token = tokenOf(invite.url);
  const stored = tables.invites.at(-1)!;
  assertEquals([stored.token_hash, stored.code_hash], [await sha(token), await sha(invite.code)]);
  assert(!JSON.stringify(stored).includes(token) && !JSON.stringify(stored).includes(invite.code), "only hashes are stored");
  const days = (Date.parse(stored.expires_at) - Date.now()) / 86_400_000;
  assert(days > 13.9 && days <= 14, "expires in 14 days");

  const peek = await call("POST", "/invites/peek", { body: { token } });
  assertEquals(peek.data.status, "pending");
  assertEquals(peek.data.inviter.name, "Mom");
  assertEquals([peek.data.invitee.name, peek.data.invitee.role], ["Grandpa", "cook"]);
  assertEquals((await call("POST", "/invites/peek", { body: { code: invite.code.toLowerCase() } })).data.status, "pending");
  // same_family only when this phone sends its key: Mom's phone is already in; a bad key is just false.
  assert(!("same_family" in peek.data), "no key, no answer");
  assertEquals((await call("POST", "/invites/peek", { headers: { "x-device-key": KEY }, body: { token } })).data.same_family, true);
  const stranger = await call("POST", "/invites/peek", { headers: { "x-device-key": "Zz".repeat(21) + "z" }, body: { token } });
  assertEquals([stranger.status, stranger.data.same_family], [200, false]);
  assertEquals(tables.devices.length, 1, "peeking joins nobody");

  // Two Join taps at once: exactly one gets in.
  const [a, b] = await Promise.all([
    call("POST", "/invites/accept", { body: { token, device_label: "iPhone" } }),
    call("POST", "/invites/accept", { body: { token, device_label: "iPhone" } }),
  ]);
  const join = a.status === 200 ? a : b;
  const loser = a.status === 200 ? b : a;
  assertEquals([join.status, loser.status, loser.data.status], [200, 410, "used"]);
  assertEquals([join.data.profile_id, join.data.family_name], [profile.id, "Test family"]);
  assertEquals(tables.devices.length, 2, "one key handed out");
  const dev = tables.devices.at(-1)!;
  assertEquals([dev.via, dev.profile_id, dev.key_hash], ["invite", profile.id, await sha(join.data.device_key)]);
  assertEquals(tables.invites.at(-1)!.used_device_id, dev.id);
  assertEquals(tables.messages.filter((m) => m.kind === "system").map((m) => m.body), ["Grandpa joined."]);

  const again = await call("POST", "/invites/accept", { body: { code: invite.code } });
  assertEquals([again.status, again.data.status, again.data.error], [410, "used", "This invite was already used."]);
  const fam = await call("GET", "/family", { headers: { "x-device-key": join.data.device_key } });
  assertEquals(fam.data.profiles.find((p: Row) => p.id === profile.id).invited, false);
  assertEquals(fam.data.device_profile_id, profile.id);
});

t("someone who already wrote or invited isn't 'invited', even with a link of their own pending", async () => {
  const cid = await circleId();
  const byCode = (who: string) => ({ "x-family-code": CODE, "x-profile-id": who });
  const lin = await phoneless("Lin");
  // Dad wrote in the circle from a shared phone; Lin sent a family invite. Then each gets a link.
  assertEquals((await call("POST", `/threads/${cid}/messages`, { headers: byCode(DAD), body: { kind: "text", body: "Chili Sunday?" } })).status, 200);
  assertEquals((await call("POST", "/invites", { headers: byCode(lin.id), body: {} })).status, 200);
  for (const id of [DAD, lin.id]) assertEquals((await call("POST", "/invites", { headers: asMom, body: { profile_id: id } })).status, 200);
  const kai = (await invite("Kai")).profile;
  const fam = await call("GET", "/family", { headers: asMom });
  assertEquals(
    fam.data.profiles.map((p: Row) => [p.name, p.invited]),
    [["Mom", false], ["Dad", false], ["Lin", false], ["Kai", true]],
  );
  // ...so they can still be picked on a shared phone; Kai, who never did anything, can't.
  assertEquals((await write(cid, byCode(DAD))).status, 200);
  assertEquals((await write(cid, byCode(kai.id))).status, 403);
  // A "<Name> joined." note isn't them writing.
  tables.messages.push({ id: crypto.randomUUID(), thread_id: cid, sender_id: kai.id, kind: "system", body: "Kai joined.", created_at: new Date().toISOString() });
  assertEquals((await call("GET", "/family", { headers: asMom })).data.profiles.find((p: Row) => p.id === kai.id).invited, true);
});

t("re-invite turns the old link off and keeps the number", async () => {
  const first = (await call("POST", "/invites", { headers: asMom, body: { name: "Leo", role: "learner", phone: "5550001111" } })).data;
  const second = await call("POST", "/invites", { headers: asMom, body: { profile_id: first.profile.id } });
  assertEquals([second.status, second.data.invite.phone], [200, "5550001111"]);
  const old = tokenOf(first.invite.url);
  assertEquals((await call("POST", "/invites/peek", { body: { token: old } })).data.status, "revoked");
  const r = await call("POST", "/invites/accept", { body: { token: old } });
  assertEquals([r.status, r.data.status, r.data.error], [410, "revoked", "This invite was turned off."]);
  const self = await call("POST", "/invites", { headers: asMom, body: { profile_id: MOM } });
  assertEquals(self.status, 400);
});

t("expired and unknown invites", async () => {
  const made = await invite("Lin", "cook");
  tables.invites.at(-1)!.expires_at = new Date(Date.now() - 1000).toISOString();
  const token = tokenOf(made.invite.url);
  assertEquals((await call("POST", "/invites/peek", { body: { token } })).data.status, "expired");
  const r = await call("POST", "/invites/accept", { body: { token } });
  assertEquals([r.status, r.data.status, r.data.error], [410, "expired", "This invite expired."]);
  const unknown = await call("POST", "/invites/peek", { body: { token: "A".repeat(16) } });
  assertEquals([unknown.status, unknown.data.error], [404, "That invite link doesn't work."]);
  const bad = await call("POST", "/invites/accept", { body: { code: "0O1I00" } });
  assertEquals([bad.status, bad.data.error], [404, "That invite code doesn't work."]);
  assertEquals((await call("POST", "/invites/peek", { body: {} })).status, 400);
  assertEquals(rateHits.filter((k) => k === "badinvite").length, 2);
});

t("typed codes are counted before lookup, per IP and service-wide; links aren't", async () => {
  const made = await invite("Kai");
  rateHits = [];
  await call("POST", "/invites/peek", { body: { token: tokenOf(made.invite.url) } });
  assertEquals(rateHits, ["invitepeek-ip"]);
  rateHits = [];
  await call("POST", "/invites/peek", { body: { code: made.invite.code } });
  assertEquals(rateHits, ["invitepeek-ip", "invitecode-ip", "invitecode-all"]);
  // Over the service-wide budget, even a right code waits; the link still works.
  rateDeny.add("invitecode-all");
  const busy = await call("POST", "/invites/accept", { body: { code: made.invite.code } });
  assertEquals([busy.status, busy.data.error], [429, "Invite codes are busy right now. Tap the invite link instead."]);
  assertEquals(tables.invites.at(-1)!.status, "pending");
  assertEquals((await call("POST", "/invites/accept", { body: { token: tokenOf(made.invite.url) } })).status, 200);
});

t("family invite: an empty body names nobody; Join makes a phone with no person and posts no note", async () => {
  pendingInvite(DAD); // a named invite alongside, so `invited` still reads right
  const r = await call("POST", "/invites", { headers: asMom, body: {} });
  assertEquals([r.status, r.data.profile], [200, null]);
  const inv = r.data.invite;
  assertEquals(inv.profile_id, null);
  assertMatch(inv.url, /^https:\/\/homecookd\.app\/i\?t=[0-9A-Za-z]{16}&c=[A-HJ-NP-Z2-9]{6}$/);
  assertEquals(rateHits, ["invites"], "the same daily budget as named invites");
  assertEquals(tables.profiles.length, 3, "no profile is made");
  const stored = tables.invites.at(-1)!;
  assertEquals([stored.profile_id, stored.inviter_id, stored.status], [null, MOM, "pending"]);
  const days = (Date.parse(stored.expires_at) - Date.now()) / 86_400_000;
  assert(days > 13.9 && days <= 14, "expires in 14 days");
  // No body at all is the same; a blank name is still a mistake, not a family invite.
  const bare = await call("POST", "/invites", { headers: asMom });
  assertEquals([bare.status, bare.data.profile, bare.data.invite.profile_id], [200, null, null]);
  const blank = await call("POST", "/invites", { headers: asMom, body: { name: "", role: "cook" } });
  assertEquals([blank.status, blank.data.error], [400, "name is required"]);

  const token = tokenOf(inv.url);
  const peek = await call("POST", "/invites/peek", { body: { token } });
  assertEquals(
    [peek.status, peek.data.status, peek.data.invitee, peek.data.inviter?.name, peek.data.family_name],
    [200, "pending", null, "Mom", "Test family"],
  );
  assertEquals((await call("POST", "/invites/peek", { body: { code: inv.code } })).data.invitee, null);
  assertEquals(tables.devices.length, 1, "peeking joins nobody");

  const acc = await call("POST", "/invites/accept", { body: { token, device_label: "iPhone" } });
  assertEquals([acc.status, acc.data.profile_id, acc.data.family_name], [200, null, "Test family"]);
  assertMatch(acc.data.device_key, /^[A-Za-z0-9_-]{43}$/);
  const dev = await findDevice(acc.data.device_key);
  assertEquals([dev.via, dev.profile_id, dev.label], ["invite", null, "iPhone"]);
  assertEquals(tables.invites.find((i) => i.id === inv.id)!.used_device_id, dev.id);
  assertEquals(tables.messages.filter((m) => m.kind === "system").length, 0, "no note until they say who they are");
  assertEquals(tables.invites.filter((i) => i.status === "pending").length, 2, "Dad's named invite and the bare one are untouched");
  const again = await call("POST", "/invites/accept", { body: { token } });
  assertEquals([again.status, again.data.status, again.data.error], [410, "used", "This invite was already used."]);

  const fam = await call("GET", "/family", { headers: { "x-device-key": acc.data.device_key } });
  assertEquals([fam.status, fam.data.device_needs_profile, fam.data.device_profile_id], [200, true, null]);
  assertEquals(fam.data.profiles.map((p: Row) => [p.name, p.invited, p.locked]), [["Mom", false, true], ["Dad", true, false]]);
});

t("a family-invite phone can't take a face: writes as anyone are 403 'Add yourself first.' until it adds itself", async () => {
  const key = await familyPhone();
  const lin = (await call("POST", "/profiles", { headers: { "x-family-code": CODE }, body: { name: "Lin", role: "cook" } })).data;
  const kai = (await invite("Kai")).profile;
  const as = (who: string) => ({ "x-device-key": key, "x-profile-id": who });
  const cid = await circleId();
  // Reads as phone-less faces stay fine (the Profiles screen reads everyone's lines).
  assertEquals((await call("GET", "/favorites", { headers: as(lin.id) })).status, 200);
  // Any write as an existing face, phone-less (Lin, Dad), locked (Mom) or only invited (Kai): 403.
  for (const who of [lin.id, DAD, MOM, kai.id]) {
    const r = await write(cid, as(who));
    assertEquals([r.status, r.data.error], [403, "Add yourself first."], who);
  }
  const msg = await call("POST", `/threads/${cid}/messages`, { headers: as(DAD), body: { kind: "text", body: "It's me, Dad" } });
  assertEquals([msg.status, msg.data.error], [403, "Add yourself first."]);
  assertEquals(tables.messages.length, 0);
  assertEquals((await findDevice(key)).profile_id, null, "no write made the phone anyone's");
  const fam = await call("GET", "/family", { headers: { "x-device-key": key } });
  assertEquals([fam.data.device_needs_profile, fam.data.device_profile_id], [true, null]);
  assertEquals(fam.data.profiles.find((p: Row) => p.id === lin.id).has_phone, false);
  // Signing itself out never needs a face (x-profile-id isn't read there).
  assertEquals((await call("POST", "/devices/revoke", { headers: as(lin.id) })).status, 200);
  assertEquals((await call("GET", "/family", { headers: { "x-device-key": key } })).status, 401);

  // Once a phone has its own person it can write as phone-less faces (Lin on Ivy's phone), and stays Ivy's.
  const key2 = await familyPhone();
  const ivy = await call("POST", "/profiles/self", { headers: { "x-device-key": key2 }, body: { name: "Ivy", role: "cook" } });
  assertEquals(ivy.status, 200, JSON.stringify(ivy.data));
  assertEquals((await write(cid, { "x-device-key": key2, "x-profile-id": lin.id })).status, 200);
  assertEquals((await findDevice(key2)).profile_id, ivy.data.id);
});

t("POST /profiles/self: a phone with no person adds its own, once, and is then theirs alone", async () => {
  const key = await familyPhone();
  const self = (body: unknown, headers: Record<string, string> = {}) =>
    call("POST", "/profiles/self", { headers: { "x-device-key": key, ...headers }, body });
  const clash = await self({ name: "mom", role: "cook" });
  assertEquals([clash.status, clash.data.error], [409, "Mom is already in this family. Pick another name or tap your face."]);
  for (const bad of [{ name: "Ivy" }, { name: "Ivy", role: "chef" }, { role: "cook" }, { name: "x".repeat(41), role: "cook" }]) {
    assertEquals((await self(bad)).status, 400, JSON.stringify(bad));
  }
  rateHits = [];
  // x-profile-id is ignored: it neither makes the phone Dad's nor gets in the way.
  const made = await self({ name: "Ivy", role: "learner" }, { "x-profile-id": DAD });
  assertEquals(made.status, 200, JSON.stringify(made.data));
  assertEquals([made.data.name, made.data.role, made.data.invited, made.data.has_phone, made.data.locked], ["Ivy", "learner", false, true, false]);
  assertEquals(rateHits, ["profiles-self"]);
  const ivy = tables.profiles.find((p) => p.name === "Ivy")!;
  assertEquals([ivy.id, ivy.family_id, ivy.role], [made.data.id, FAM, "learner"]);
  assertEquals((await findDevice(key)).profile_id, ivy.id);
  assertEquals(tables.messages.filter((m) => m.kind === "system").map((m) => [m.body, m.sender_id]), [["Ivy joined.", ivy.id]]);
  const fam = await call("GET", "/family", { headers: { "x-device-key": key } });
  assertEquals([fam.data.device_needs_profile, fam.data.device_profile_id], [false, ivy.id]);

  // Hers now: a second try is 409, and nobody else can be her.
  const twice = await self({ name: "Ivy Two", role: "cook" });
  assertEquals([twice.status, twice.data.error], [409, "This phone already belongs to Ivy."]);
  const momsPhone = await call("POST", "/profiles/self", { headers: { "x-device-key": KEY }, body: { name: "Rae", role: "cook" } });
  assertEquals([momsPhone.status, momsPhone.data.error], [409, "This phone already belongs to Mom."]);
  const byCode = await call("POST", "/profiles/self", { headers: { "x-family-code": CODE }, body: { name: "Rae", role: "cook" } });
  assertEquals([byCode.status, byCode.data.error], [400, "Send this phone's x-device-key to add yourself."]);
  assertEquals(tables.profiles.length, 4, "nothing else was made");
  const asIvy = await call("GET", "/threads", { headers: { "x-device-key": KEY, "x-profile-id": ivy.id } });
  assertEquals([asIvy.status, asIvy.data.error], [403, "Ivy uses their own phone."]);
  assertEquals((await call("GET", "/family", { headers: asMom })).data.profiles.find((p: Row) => p.id === ivy.id).locked, true);
  assertEquals((await call("GET", "/threads", { headers: { "x-device-key": key, "x-profile-id": ivy.id } })).status, 200);
});

t("POST /profiles/self: when another tap gave the phone its person first, the new face is undone", async () => {
  const key = await familyPhone();
  const dev = await findDevice(key);
  // Another tap wins between the name check and the owner update.
  beforeRequest = (table, method) => {
    if (table === "devices" && method === "PATCH") dev.profile_id = DAD;
  };
  const r = await call("POST", "/profiles/self", { headers: { "x-device-key": key }, body: { name: "Ivy", role: "cook" } });
  assertEquals([r.status, r.data.error], [409, "This phone already belongs to Dad."]);
  assert(!tables.profiles.some((p) => p.name === "Ivy"), "the new face is gone");
  assertEquals(tables.messages.filter((m) => m.kind === "system").length, 0);
});

t("removing someone turns off the family invites they sent (named ones stay)", async () => {
  const byDad = { "x-family-code": CODE, "x-profile-id": DAD };
  const dads = (await call("POST", "/invites", { headers: byDad, body: {} })).data.invite;
  const leo = (await call("POST", "/invites", { headers: byDad, body: { name: "Leo", role: "learner" } })).data.invite;
  const moms = (await call("POST", "/invites", { headers: asMom, body: {} })).data.invite;
  assertEquals((await call("POST", `/profiles/${DAD}/remove`, { headers: byDad })).status, 200, "Dad (no phone) leaves");
  const status = async (inv: Row) => (await call("POST", "/invites/peek", { body: { token: tokenOf(inv.url) } })).data.status;
  assertEquals(await status(dads), "revoked");
  assertEquals((await call("POST", "/invites/accept", { body: { token: tokenOf(dads.url) } })).status, 410);
  assertEquals(await status(leo), "pending", "it can only become Leo");
  assertEquals(await status(moms), "pending");
});

t("remove: nobody removes anyone else; leaving from your own phone signs it out", async () => {
  const made = await invite("Kai");
  const join = await call("POST", "/invites/accept", { body: { token: tokenOf(made.invite.url) } });
  assertEquals(join.status, 200, "Join worked, so the sign-out below is real");
  tables.identities.push({ provider: "apple", subject: "kai", profile_id: made.profile.id, email: null });
  const asKai = { "x-device-key": join.data.device_key, "x-profile-id": made.profile.id };

  // Mom, the family's first person, can't remove Kai or Dad.
  for (const [who, name] of [[made.profile.id, "Kai"], [DAD, "Dad"]]) {
    const r = await call("POST", `/profiles/${who}/remove`, { headers: asMom });
    assertEquals([r.status, r.data.error], [403, `Only ${name} can remove themselves.`]);
  }
  // Kai's phone acting as Dad (no phone of his own) can't remove Kai, nor Mom.
  const own = await call("POST", `/profiles/${made.profile.id}/remove`, { headers: { ...asKai, "x-profile-id": DAD } });
  assertEquals([own.status, own.data.error], [403, "Only Kai can remove themselves."]);
  assertEquals((await call("POST", `/profiles/${MOM}/remove`, { headers: { ...asKai, "x-profile-id": DAD } })).status, 403);
  assertEquals(tables.devices.filter((d) => d.revoked_at).length, 0, "nobody was signed out");

  // Kai leaves from his own phone: it's signed out, and he leaves the lists.
  const r = await call("POST", `/profiles/${made.profile.id}/remove`, { headers: asKai });
  assertEquals([r.status, r.data], [200, { ok: true }]);
  const gone = await call("GET", "/family", { headers: { "x-device-key": join.data.device_key } });
  assertEquals([gone.status, gone.data.error], [401, SIGNED_OUT]);
  const fam = await call("GET", "/family", { headers: asMom });
  assert(!fam.data.profiles.some((p: Row) => p.id === made.profile.id));
  assert(fam.data.former_profiles.some((p: Row) => p.id === made.profile.id));
  assertEquals(tables.identities.length, 0);
  assertEquals((await call("POST", `/profiles/${made.profile.id}/remove`, { headers: asMom })).status, 200, "a repeated tap is fine");
  assertEquals(notes(), [["Kai joined.", made.profile.id]], "no note for leaving");
  // The name is free again (the unique index only covers people still in the family).
  assertEquals((await call("POST", "/invites", { headers: asMom, body: { name: "Kai", role: "learner" } })).status, 200);
});

t("remove: someone with no phone leaves from a lent or shared phone, which stays signed in", async () => {
  const lin = await phoneless("Lin");
  const ivy = await phoneless("Ivy");
  // On Mom's phone, as Lin: Lin can leave; Lin can't take Ivy (or Mom) with her.
  const asLin = { "x-device-key": KEY, "x-profile-id": lin.id };
  const other = await call("POST", `/profiles/${ivy.id}/remove`, { headers: asLin });
  assertEquals([other.status, other.data.error], [403, "Only Ivy can remove themselves."]);
  assertEquals((await call("POST", `/profiles/${MOM}/remove`, { headers: asLin })).data.error, "Only Mom can remove themselves.");
  assertEquals((await call("POST", `/profiles/${lin.id}/remove`, { headers: asLin })).status, 200);
  assertEquals((await call("GET", "/family", { headers: asMom })).status, 200, "Mom's phone stays in");
  // The family code (an old build) as Ivy.
  assertEquals((await call("POST", `/profiles/${ivy.id}/remove`, { headers: { "x-family-code": CODE, "x-profile-id": ivy.id } })).status, 200);
  // A swapped phone with no person yet, as Dad: leaving doesn't make it his and sign it out.
  const key = (await call("POST", "/devices", { headers: { "x-family-code": CODE }, body: {} })).data.device_key;
  assertEquals((await call("POST", `/profiles/${DAD}/remove`, { headers: { "x-device-key": key, "x-profile-id": DAD } })).status, 200);
  const shared = await call("GET", "/family", { headers: { "x-device-key": key } });
  assertEquals([shared.status, shared.data.device_profile_id], [200, null]);
  assertEquals(
    (await call("GET", "/family", { headers: asMom })).data.former_profiles.map((p: Row) => p.name).sort(),
    ["Dad", "Ivy", "Lin", "Sam"],
  );
});

t("a 1:1 with someone removed stays in the inbox, read-only", async () => {
  const thread = (await call("POST", "/threads", { headers: asMom, body: { other_id: DAD } })).data;
  assertEquals((await call("POST", `/threads/${thread.id}/messages`, { headers: asMom, body: { kind: "text", body: "Chili Sunday?" } })).status, 200);
  tables.profiles.find((p) => p.id === DAD)!.removed_at = new Date().toISOString();
  const inbox = await call("GET", "/threads", { headers: asMom });
  const pair = inbox.data.find((s: Row) => s.id === thread.id);
  assertEquals([pair?.other.name, pair?.other.removed, pair?.last.body], ["Dad", true, "Chili Sunday?"]);
  assertEquals(pair.members.map((p: Row) => p.name), ["Mom", "Dad"]);
  const old = await call("GET", `/threads/${thread.id}/messages`, { headers: asMom });
  assertEquals(old.data.map((m: Row) => m.body), ["Chili Sunday?"]);
  const send = await call("POST", `/threads/${thread.id}/messages`, { headers: asMom, body: { kind: "text", body: "Hello?" } });
  assertEquals([send.status, send.data.error], [403, "Dad isn't in the family anymore."]);
});

t("a removed person's recipe notes keep their name and face", async () => {
  tables.recipe_notes.push({
    id: crypto.randomUUID(), family_id: FAM, recipe_id: "dad-sunday-chili", step_order: 3, question_message_id: null,
    question: "How hot?", asked_by: SAM, answer_message_id: crypto.randomUUID(), answer_text: "Brick red oil.",
    answer_audio_path: null, answer_audio_url: null, answer_duration_s: null, answered_by: DAD, created_at: new Date().toISOString(),
  });
  tables.profiles.find((p) => p.id === DAD)!.removed_at = new Date().toISOString();
  const r = await call("GET", "/recipes/dad-sunday-chili/notes", { headers: asMom });
  assertEquals(r.status, 200);
  assertEquals([r.data[0].author.name, r.data[0].asker.name], ["Dad", "Sam"]);
});

t("emails can only be set with the family code (a key can't trade one for the code)", async () => {
  const viaKey = await call("POST", `/profiles/${DAD}/email`, { headers: asMom, body: { email: "dad@example.com" } });
  assertEquals([viaKey.status, viaKey.data.error], [403, "Emails can't be added in this version. Send an invite instead."]);
  const newViaKey = await call("POST", "/profiles", { headers: asMom, body: { name: "Lin", role: "cook", email: "lin@example.com" } });
  assertEquals(newViaKey.status, 403);
  assertEquals(tables.profiles.filter((p) => p.email).length, 0);
  assertEquals((await call("POST", "/profiles", { headers: asMom, body: { name: "Lin", role: "cook" } })).status, 200);
  const viaCode = await call("POST", `/profiles/${DAD}/email`, { headers: { "x-family-code": CODE }, body: { email: "dad@example.com" } });
  assertEquals([viaCode.status, tables.profiles.find((p) => p.id === DAD)!.email], [200, "dad@example.com"]);
});

t("Apple / Google: bad tokens 401, Google 503 until set up", async () => {
  const bad = await call("POST", "/auth/apple", { body: { id_token: "not.a.token" } });
  assertEquals([bad.status, bad.data.error], [401, "That Apple sign-in didn't work. Please try again."]);
  assertEquals(rateHits, ["authid-ip"]);
  const google = await call("POST", "/auth/google", { body: { id_token: "x" } });
  assertEquals([google.status, google.data.error], [503, "Google sign-in isn't set up yet."]);
  assertEquals((await call("POST", "/auth/apple", { body: {} })).status, 400);
});

t("Apple: keys unreachable is 503, a foreign app id is 503 'not set up', a forged token 401", async () => {
  appleKeysDown = true;
  const down = await call("POST", "/auth/apple", { body: { id_token: await appleToken("a1") } });
  assertEquals([down.status, down.data.error], [503, "We couldn't reach Apple just now. Please try again."]);
  appleKeysDown = false;
  const store = await call("POST", "/auth/apple", { body: { id_token: await appleToken("a1", { aud: "app.homecookd.ios" }) } });
  assertEquals([store.status, store.data.error], [503, "Apple sign-in isn't set up for this version yet. Try an invite link."]);
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer("https://appleid.apple.com")
    .setAudience("host.exp.Exponent").setSubject("a1").setExpirationTime("10m").sign(other.privateKey);
  assertEquals((await call("POST", "/auth/apple", { body: { id_token: forged } })).status, 401);
  assertEquals(tables.identities.length + tables.devices.length, 1, "nothing made");
});

t("Apple: new person needs a name, then joins by link; the same account signs in again", async () => {
  const id = await appleToken("apple-new", { email: "Dana@Example.com" });
  const first = await call("POST", "/auth/apple", { body: { id_token: id, share_token: SHARE } });
  assertEquals(first.data, { existing: false, needs_name: true, suggested_name: null });
  assertEquals(tables.profiles.length, 3, "nothing made before the name");

  const joined = await call("POST", "/auth/apple", { body: { id_token: id, share_token: SHARE, name: "Dana", device_label: "iPhone" } });
  assertEquals([joined.status, joined.data.joined, joined.data.family_name], [200, true, "Test family"]);
  const dana = tables.profiles.find((p) => p.id === joined.data.profile_id)!;
  assertEquals([dana.name, dana.role], ["Dana", "learner"]);
  assertEquals((await findDevice(joined.data.device_key)).profile_id, dana.id);
  assertEquals(tables.identities.map((i) => [i.subject, i.profile_id, i.email]), [["apple-new", dana.id, "dana@example.com"]]);
  assertEquals(tables.messages.at(-1)!.body, "Dana joined from Mom's link");

  const again = await call("POST", "/auth/apple", { body: { id_token: await appleToken("apple-new") } });
  assertEquals([again.data.existing, again.data.profile_id], [true, dana.id]);
  assertNotEquals(again.data.device_key, joined.data.device_key);
});

t("Apple via a recipe link: only an invited, not-yet-joined person can be claimed", async () => {
  const join = async (name: string, sub: string) =>
    call("POST", "/auth/apple", { body: { id_token: await appleToken(sub), share_token: SHARE, name } });
  // Dad is invited and hasn't joined, but this is his own link (the /r page shows the sender): never.
  pendingInvite(DAD);
  tables.shares[0].sender_id = DAD;
  const dad = await join("dad", "x-dad");
  assertEquals([dad.status, dad.data.error], [409, "Dad is already in this family. Try another name."]);
  tables.shares[0].sender_id = MOM;
  // Mom is signed in on a phone: never.
  assertEquals((await join("Mom", "x-mom")).status, 409);
  // Without an invite (an old build's family-code member looks like this): never.
  tables.invites = [];
  assertEquals((await join("Dad", "x-dad")).status, 409);
  assertEquals(tables.identities.length, 0);

  // Grandpa was invited by "+ Add family" and hasn't joined: this is him.
  const made = await invite("Grandpa", "cook");
  const g = await join("grandpa", "x-grandpa");
  assertEquals([g.status, g.data.profile_id, g.data.joined], [200, made.profile.id, true]);
  assertEquals(tables.profiles.find((p) => p.id === made.profile.id)!.role, "cook", "the invite's role stays");
  assertEquals(tables.invites.at(-1)!.status, "revoked", "his invite link stops working");
  // Now he's signed in: nobody else can become him.
  assertEquals((await join("Grandpa", "x-someone")).status, 409);
});

t("Apple with no link: role required, then their own family", async () => {
  const id = await appleToken("solo");
  assertEquals((await call("POST", "/auth/apple", { body: { id_token: id, name: "Rae" } })).status, 400);
  const r = await call("POST", "/auth/apple", { body: { id_token: id, name: "Rae", role: "cook" } });
  assertEquals([r.status, r.data.family_name, r.data.joined], [200, "Rae's family", false]);
  assertNotEquals(tables.profiles.find((p) => p.id === r.data.profile_id)!.family_id, FAM);
});

t("email sign-in from a link (old builds) can't claim the sender or someone signed in", async () => {
  await call("GET", "/family", { headers: { "x-family-code": CODE } }); // seals the code for email sign-in
  const email = (name: string, address: string) =>
    call("POST", "/auth/email", { body: { email: address, name, share_token: SHARE } });
  tables.shares[0].sender_id = DAD;
  const sender = await email("Dad", "x1@example.com");
  assertEquals([sender.status, sender.data.error], [409, "Dad is already in this family. Try another name."]);
  tables.shares[0].sender_id = MOM;
  tables.identities.push({ provider: "apple", subject: "dad", profile_id: DAD, email: null });
  assertEquals((await email("Dad", "x2@example.com")).status, 409);
  assert(!tables.profiles.some((p) => p.email), "no email was attached");
  tables.identities = [];
  // An old build's "+ Add family" person who never signed in is still claimed, as before; a live
  // invite for them is turned off.
  pendingInvite(DAD);
  const r = await email("Dad", "dad@example.com");
  assertEquals([r.status, r.data.profile_id, r.data.joined], [200, DAD, true]);
  assertEquals(tables.invites.at(-1)!.status, "revoked");
});

// --- joining only by a link (joinLinks.ts, JOIN-SIMPLE.md) ---------------------------------------

const LINK_SECRET = "test-link-secret-0123456789abcdef";

/** A receipt's payload, once its signature checks out with LINK_SECRET. */
async function receiptOf(receipt: string): Promise<Row> {
  const [body, sig] = receipt.split(".");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  assertEquals(sig, btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
}

t("join links: one link for the family all week, peek says kind link, 1.0's accept gets 426, revoke turns it off", async () => {
  assertEquals((await call("POST", "/join-links", { headers: { "x-device-key": KEY } })).status, 400, "x-profile-id is required");
  const made = await call("POST", "/join-links", { headers: asMom });
  assertEquals(made.status, 200);
  const token = tokenOf(made.data.url);
  assertMatch(made.data.url, /^https:\/\/homecookd\.app\/i\?t=[0-9A-Za-z]{22}$/);
  assert(Math.abs(Date.parse(made.data.expires_at) - (Date.now() + 7 * 86_400_000)) < 60_000);
  const row = tables.join_links[0];
  assertEquals([row.family_id, row.inviter_id, row.token_hash, row.revoked_at ?? null], [FAM, MOM, await sha(token), null]);
  assert(row.token_enc.startsWith("v1:") && !row.token_enc.includes(token), "sealed, not stored in the clear");
  assert(rateHits.includes("joinlinks"));
  assertEquals((await call("POST", "/join-links", { headers: asMom })).data, made.data, "the same link all week");

  const peek = await call("POST", "/invites/peek", { body: { token } });
  assertEquals(peek.data, {
    status: "pending", family_name: "Test family", inviter: { name: "Mom", relation: "Mom", avatar_key: "mom" }, invitee: null,
    expires_at: made.data.expires_at, kind: "link", claimable: null,
  });
  assertEquals((await call("POST", "/invites/peek", { headers: { "x-device-key": KEY }, body: { token } })).data.same_family, true);
  assertEquals((await call("POST", "/invites/peek", { body: { token: "Nope".padEnd(22, "0") } })).status, 404);

  const old = await call("POST", "/invites/accept", { body: { token, device_label: "iPhone" } });
  assertEquals([old.status, old.data], [426, { error: "Update homecookd to join this family." }]);
  assertEquals(tables.devices.length, 1, "1.0 can't join by a join link");

  assertEquals((await call("POST", "/join-links/revoke", { headers: asMom })).data, { ok: true });
  assertEquals((await call("POST", "/invites/peek", { body: { token } })).data.status, "revoked");
  const fresh = await call("POST", "/join-links", { headers: asMom });
  assertNotEquals(fresh.data.url, made.data.url);
  assertEquals((await call("POST", "/auth/link", { body: { ticket: "x" } })).status, 404, "POST /auth/link is gone");
});

t("Apple with a join link: name first, a new person joins; the same account signs in again; an old invite works once", async () => {
  const token = tokenOf((await call("POST", "/join-links", { headers: asMom })).data.url);
  const id = await appleToken("dana", { email: "dana@example.com" });
  assertEquals((await call("POST", "/auth/apple", { body: { id_token: id, join_token: token } })).data,
    { existing: false, needs_name: true, suggested_name: null });
  const joined = await call("POST", "/auth/apple", { body: { id_token: id, join_token: token, name: "Dana", role: "cook", device_label: "iPhone" } });
  assertEquals([joined.status, joined.data.joined, joined.data.existing, joined.data.family_name], [200, true, false, "Test family"]);
  const dana = tables.profiles.find((p) => p.id === joined.data.profile_id)!;
  assertEquals([dana.name, dana.role, dana.family_id], ["Dana", "cook", FAM]);
  const dev = await findDevice(joined.data.device_key);
  assertEquals([dev.profile_id, dev.via, dev.label], [dana.id, "apple", "iPhone"]);
  assertEquals(tables.signups.map((s) => s.share_token), [`join:${tables.join_links[0].id}`]);
  assertEquals(notes().at(-1), ["Dana joined", dana.id]);
  const again = await call("POST", "/auth/apple", { body: { id_token: await appleToken("dana"), join_token: token } });
  assertEquals([again.data.existing, again.data.profile_id], [true, dana.id]);

  // A 1.0 phone's one-use family invite still brings someone in, once, as a new person.
  const inv = (await call("POST", "/invites", { headers: asMom, body: {} })).data.invite;
  const kai = await call("POST", "/auth/apple", { body: { id_token: await appleToken("kai"), join_token: tokenOf(inv.url), name: "Kai" } });
  assertEquals([kai.status, kai.data.joined], [200, true]);
  assertEquals(tables.invites.at(-1)!.status, "used");
  const late = await call("POST", "/auth/apple", { body: { id_token: await appleToken("lee"), join_token: tokenOf(inv.url), name: "Lee" } });
  assertEquals([late.status, late.data.error, late.data.status], [410, "This invite was already used.", "used"]);
});

t("Apple with another family's link: asked first, then one tap moves them; a solo family's faces come too", async () => {
  // Rae started her own family and added Gran (no phone).
  const rae = (await call("POST", "/auth/apple", { body: { id_token: await appleToken("rae"), name: "Rae", role: "cook" } })).data;
  const asRae = { "x-device-key": rae.device_key, "x-profile-id": rae.profile_id };
  const gran = (await call("POST", "/profiles", { headers: asRae, body: { name: "Gran", role: "cook" } })).data;
  const raes = tables.profiles.find((p) => p.id === rae.profile_id)!.family_id;
  const token = tokenOf((await call("POST", "/join-links", { headers: asMom })).data.url);

  const ask = await call("POST", "/auth/apple", { body: { id_token: await appleToken("rae"), join_token: token } });
  assertEquals(ask.data, { existing: true, needs_move: true, from_family: "Rae's family", to_family: "Test family" });
  assertEquals((await call("GET", "/family", { headers: asRae })).status, 200, "nothing changed");

  const had = Deno.env.get("LINK_JOIN_SECRET");
  Deno.env.set("LINK_JOIN_SECRET", LINK_SECRET);
  let moved;
  try {
    moved = await call("POST", "/auth/apple", { body: { id_token: await appleToken("rae"), join_token: token, move: true } });
  } finally {
    if (had === undefined) Deno.env.delete("LINK_JOIN_SECRET");
    else Deno.env.set("LINK_JOIN_SECRET", had);
  }
  assertEquals([moved.status, moved.data.existing, moved.data.joined, moved.data.family_name], [200, true, true, "Test family"]);
  const fresh = moved.data.profile_id;
  // Her old family: she left as "Leave the family" does; her old phone key is signed out.
  assert(tables.profiles.find((p) => p.id === rae.profile_id)!.removed_at);
  assertEquals((await call("GET", "/family", { headers: { "x-device-key": rae.device_key } })).status, 401);
  assertEquals(tables.identities.filter((i) => i.subject === "rae").map((i) => i.profile_id), [fresh]);
  const said = (fam: string) => tables.messages.filter((m) => m.family_id === fam && m.kind === "system").map((m) => m.body);
  assertEquals(said(raes), ["Rae left"]);
  assertEquals(said(FAM), ["Rae joined"]);
  // Nobody else signed in to Rae's family, so Gran comes along; Convex gets the receipt.
  const fam = await call("GET", "/family", { headers: { "x-device-key": moved.data.device_key } });
  assertEquals(fam.data.profiles.map((p: Row) => p.name), ["Mom", "Dad", "Rae", "Gran"]);
  assertEquals(fam.data.device_profile_id, fresh);
  const r = await receiptOf(moved.data.moved.receipt);
  assertEquals([r.v, r.kind, r.fromProfile, r.fromFamily, r.toProfile, r.toFamily, r.solo, r.faces], [1, "moved", rae.profile_id, raes, fresh, FAM, true, [gran.id]]);
  assert(Math.abs(r.exp - (Date.now() + 3_600_000)) < 60_000);
});

t("Are you Dad? peek with a name finds phone-less Dad; Apple with claim_profile_id becomes him", async () => {
  const token = tokenOf((await call("POST", "/join-links", { headers: asMom })).data.url);
  const peek = (body: Row) => call("POST", "/invites/peek", { body: { token, ...body } });
  assertEquals((await peek({ name: "  dAd " })).data.claimable, { id: DAD, name: "Dad", avatar_key: null });
  for (const name of [undefined, "", "Da", "Mom", "Sam"]) assertEquals((await peek({ name })).data.claimable, null, String(name));
  // An old family invite asks the same; one naming somebody doesn't.
  const fam = (await call("POST", "/invites", { headers: asMom, body: {} })).data.invite;
  assertEquals((await call("POST", "/invites/peek", { body: { token: tokenOf(fam.url), name: "dad" } })).data.claimable?.id, DAD);
  const named = (await call("POST", "/invites", { headers: asMom, body: { name: "Grandpa", role: "cook" } })).data.invite;
  assertEquals((await call("POST", "/invites/peek", { body: { token: tokenOf(named.url), name: "dad" } })).data.claimable, null);

  const bad = await call("POST", "/auth/apple", { body: { id_token: await appleToken("dad"), join_token: token, claim_profile_id: "p-dad" } });
  assertEquals([bad.status, bad.data.error], [400, "claim_profile_id is not a valid id"]);
  const people = tables.profiles.length;
  const res = await call("POST", "/auth/apple", { body: { id_token: await appleToken("dad"), join_token: token, claim_profile_id: DAD, name: "Papa", device_label: "iPhone" } });
  assertEquals([res.status, res.data.profile_id, res.data.joined, res.data.existing, res.data.family_name], [200, DAD, true, false, "Test family"]);
  assertEquals(tables.profiles.length, people, "nobody new");
  assertEquals(tables.profiles.find((p) => p.id === DAD)!.name, "Dad");
  assertEquals((await findDevice(res.data.device_key)).profile_id, DAD);
  assertEquals(tables.identities.map((i) => [i.subject, i.profile_id]), [["dad", DAD]]);
  assertEquals(notes().at(-1), ["Dad joined", DAD]);
  assertEquals((await peek({ name: "Dad" })).data.claimable, null, "Dad is on homecookd now");
  const again = await call("POST", "/auth/apple", { body: { id_token: await appleToken("someone"), join_token: token, claim_profile_id: DAD } });
  assertEquals([again.status, again.data.error], [409, "That person is already on homecookd."]);
});

// --- moving to a new phone ---------------------------------------------------------------------

t("move to a new phone: ask, the family sees it, approve, and the old phone is signed out, with no note", async () => {
  await dadsPhone();
  pendingInvite(DAD); // an old link to him, which approval turns off
  const key = await familyPhone();
  const asNew = { "x-device-key": key };
  rateHits = [];
  // x-profile-id is ignored here: Dad is locked to his old phone, and this phone is nobody yet.
  const ask = await call("POST", "/move-requests", { headers: { ...asNew, "x-profile-id": DAD }, body: { profile_id: DAD } });
  assertEquals(ask.status, 200, JSON.stringify(ask.data));
  assertEquals(Object.keys(ask.data).sort(), ["created_at", "id", "profile_id", "status"]);
  assertEquals([ask.data.profile_id, ask.data.status, ask.data.created_at], [DAD, "pending", tables.move_requests[0].created_at]);
  assertEquals(rateHits, ["move-requests"]);
  assertEquals(notes(), [], "asking posts no note");
  assertEquals(await mine(key), { id: ask.data.id, profile_id: DAD, status: "pending" });
  assertEquals((await findDevice(key)).profile_id, null, "asking changes nothing yet");

  // Mom, on her own phone, sees it. Dad's own phone doesn't (it's about him) and can't let himself in.
  const list = await call("GET", "/move-requests", { headers: asMom });
  assertEquals(list.status, 200);
  assertEquals(list.data, [{ id: ask.data.id, profile: { id: DAD, name: "Dad", role: "cook", relation: "Dad", avatar_key: null }, created_at: ask.data.created_at }]);
  assertEquals((await call("GET", "/family", { headers: asMom })).data.move_requests_pending, 1);
  assertEquals((await call("GET", "/move-requests", { headers: asDad })).data, []);
  assertEquals((await call("GET", "/family", { headers: asDad })).data.move_requests_pending, 0);
  const self = await answer(ask.data.id, "approve", asDad);
  assertEquals([self.status, self.data.error], [400, "You can't let yourself in."]);
  assertEquals((await findDevice(key)).profile_id, null);

  const ok = await answer(ask.data.id, "approve", asMom);
  assertEquals([ok.status, ok.data], [200, { ok: true }]);
  const row = tables.move_requests[0];
  assertEquals([row.status, row.decided_by, typeof row.decided_at], ["approved", MOM, "string"]);
  // The new phone is Dad's; his old one is signed out; Mom's stays in.
  assertEquals((await findDevice(key)).profile_id, DAD);
  const old = await call("GET", "/family", { headers: asDad });
  assertEquals([old.status, old.data.error], [401, SIGNED_OUT]);
  assertEquals((await call("GET", "/family", { headers: asMom })).status, 200);
  assertEquals(tables.invites.find((i) => i.profile_id === DAD)!.status, "revoked", "his old links stop working");
  assertEquals(notes(), [], "letting him in posts no note");
  assertEquals(await mine(key), { id: ask.data.id, profile_id: DAD, status: "approved" });
  const fam = await call("GET", "/family", { headers: asNew });
  assertEquals([fam.data.device_profile_id, fam.data.device_needs_profile], [DAD, false]);
  assertEquals((await call("GET", "/threads", { headers: { ...asNew, "x-profile-id": DAD } })).status, 200);
  assertEquals((await call("GET", "/family", { headers: asMom })).data.profiles.find((p: Row) => p.id === DAD).locked, true, "locked to his new phone");

  // Done: it leaves the list, and later answers are 409.
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data, []);
  assertEquals((await call("GET", "/family", { headers: asMom })).data.move_requests_pending, 0);
  for (const how of ["approve", "decline"] as const) {
    const late = await answer(ask.data.id, how, asMom);
    assertEquals([late.status, late.data.error], [409, "Already handled."], how);
  }
  // It has its person now: no more asks from it.
  const more = await askMove(key, MOM);
  assertEquals([more.status, more.data.error], [400, "Only a phone that just joined can ask to move in."]);
});

t("only a phone that just joined can ask, and only to be someone in the family now", async () => {
  const no = "Only a phone that just joined can ask to move in.";
  const swapped = (await call("POST", "/devices", { headers: { "x-family-code": CODE }, body: {} })).data.device_key;
  const named = (await call("POST", "/invites/accept", { body: { token: tokenOf((await invite("Kai")).invite.url) } })).data.device_key;
  // Mom's own phone, the family code, a code-swapped phone (no person yet) and a named invite's phone.
  for (const [what, headers] of [["mom", asMom], ["code", { "x-family-code": CODE }], ["swapped", { "x-device-key": swapped }], ["named", { "x-device-key": named }]] as const) {
    const r = await call("POST", "/move-requests", { headers, body: { profile_id: DAD } });
    assertEquals([r.status, r.data.error], [400, no], what);
  }
  const key = await familyPhone();
  for (const [body, status] of [[{}, 400], [{ profile_id: "family" }, 400], [{ profile_id: SAM }, 404], [{ profile_id: crypto.randomUUID() }, 404]] as const) {
    assertEquals((await call("POST", "/move-requests", { headers: { "x-device-key": key }, body })).status, status, JSON.stringify(body));
  }
  assertEquals(tables.move_requests.length, 0);
  // Once it has added itself it's someone's phone.
  assertEquals((await call("POST", "/profiles/self", { headers: { "x-device-key": key }, body: { name: "Ivy", role: "cook" } })).status, 200);
  const late = await askMove(key, DAD);
  assertEquals([late.status, late.data.error], [400, no]);
  // Per family, an hour at a time.
  const key2 = await familyPhone();
  rateDeny.add("move-requests");
  assertEquals((await askMove(key2, DAD)).status, 429);
  assertEquals(tables.move_requests.length, 0);
});

t("asking again: the same person returns the same ask; someone else replaces it", async () => {
  const lin = await phoneless("Lin");
  const key = await familyPhone();
  const x = await askMove(key, DAD);
  assertEquals(x.status, 200);
  const repeat = await askMove(key, DAD);
  assertEquals([repeat.status, repeat.data], [200, x.data]);
  assertEquals(tables.move_requests.length, 1);

  const other = await askMove(key, lin.id);
  assertEquals([other.status, other.data.profile_id, other.data.status], [200, lin.id, "pending"]);
  assertNotEquals(other.data.id, x.data.id);
  const first = tables.move_requests.find((r) => r.id === x.data.id)!;
  assertEquals([first.status, typeof first.decided_at, first.decided_by], ["declined", "string", null], "replaced");
  assertEquals(tables.move_requests.filter((r) => r.status === "pending").length, 1);
  assertEquals(await mine(key), { id: other.data.id, profile_id: lin.id, status: "pending" });
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data.map((r: Row) => r.id), [other.data.id]);
  const stale = await answer(x.data.id, "approve", asMom);
  assertEquals([stale.status, stale.data.error], [409, "Already handled."]);
  assertEquals((await findDevice(key)).profile_id, null);
});

t("two taps at once make one ask (the one-pending index): same person returns it, someone else is 409", async () => {
  const key = await familyPhone();
  const device = (await findDevice(key)).id;
  // The other tap's insert lands between this tap's look and its insert.
  const otherTap = (who: string) => {
    let done = false;
    beforeRequest = (table, method) => {
      if (table !== "move_requests" || method !== "POST" || done) return;
      done = true;
      tables.move_requests.push({
        id: crypto.randomUUID(), family_id: FAM, profile_id: who, device_id: device, status: "pending",
        created_at: new Date().toISOString(), decided_at: null, decided_by: null,
      });
    };
  };
  otherTap(DAD);
  const same = await askMove(key, DAD);
  assertEquals([same.status, same.data.id, same.data.status], [200, tables.move_requests[0].id, "pending"]);
  assertEquals(tables.move_requests.length, 1);

  const key2 = await familyPhone();
  const device2 = (await findDevice(key2)).id;
  let done = false;
  beforeRequest = (table, method) => {
    if (table !== "move_requests" || method !== "POST" || done) return;
    done = true;
    tables.move_requests.push({
      id: crypto.randomUUID(), family_id: FAM, profile_id: MOM, device_id: device2, status: "pending",
      created_at: new Date().toISOString(), decided_at: null, decided_by: null,
    });
  };
  const clash = await askMove(key2, DAD);
  assertEquals([clash.status, clash.data.error], [409, "Please try again."]);
  assertEquals(tables.move_requests.filter((r) => r.device_id === device2).map((r) => [r.profile_id, r.status]), [[MOM, "pending"]]);
});

t("an ask expires after 7 days: it reads expired, can't be answered, and the phone can ask again", async () => {
  const key = await familyPhone();
  const ask = await askMove(key, DAD);
  tables.move_requests[0].created_at = new Date(Date.now() - 7 * 86_400_000 - 1000).toISOString();
  assertEquals(await mine(key), { id: ask.data.id, profile_id: DAD, status: "expired" });
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data, []);
  assertEquals((await call("GET", "/family", { headers: asMom })).data.move_requests_pending, 0);
  for (const how of ["approve", "decline"] as const) {
    const r = await answer(ask.data.id, how, asMom);
    assertEquals([r.status, r.data.error], [410, "That request expired."], how);
  }
  assertEquals([tables.move_requests[0].status, (await findDevice(key)).profile_id], ["pending", null], "expired is computed");

  const again = await askMove(key, DAD);
  assertEquals([again.status, again.data.status], [200, "pending"]);
  assertNotEquals(again.data.id, ask.data.id);
  assertEquals(tables.move_requests[0].status, "declined", "the expired one is closed first");
  assertEquals(await mine(key), { id: again.data.id, profile_id: DAD, status: "pending" });

  // Expiring between the look and the update still counts as expired.
  beforeRequest = (table, method) => {
    if (table === "move_requests" && method === "PATCH") tables.move_requests[1].created_at = new Date(Date.now() - 8 * 86_400_000).toISOString();
  };
  const edge = await answer(again.data.id, "approve", asMom);
  assertEquals([edge.status, edge.data.error, tables.move_requests[1].status], [410, "That request expired.", "pending"]);
  assertEquals((await findDevice(key)).profile_id, null);
});

t("two people answer at once: the first wins, the other gets 409", async () => {
  await dadsPhone();
  const lin = await phoneless("Lin");
  const key = await familyPhone();
  const ask = await askMove(key, lin.id);
  // Dad's approval lands between Mom's look at the ask and her update.
  const dadFirst = (status: string) => {
    let done = false;
    beforeRequest = (table, method) => {
      if (table !== "move_requests" || method !== "PATCH" || done) return;
      done = true;
      Object.assign(tables.move_requests[0], { status, decided_by: DAD, decided_at: new Date().toISOString() });
    };
  };
  dadFirst("approved");
  const late = await answer(ask.data.id, "approve", asMom);
  assertEquals([late.status, late.data.error], [409, "Already handled."]);
  assertEquals([tables.move_requests[0].status, tables.move_requests[0].decided_by], ["approved", DAD], "Mom's didn't overwrite it");
  assertEquals((await findDevice(key)).profile_id, null, "the late approval moved nothing");

  // A decline racing an approval loses the same way.
  Object.assign(tables.move_requests[0], { status: "pending", decided_by: null, decided_at: null });
  dadFirst("approved");
  const no = await answer(ask.data.id, "decline", asMom);
  assertEquals([no.status, no.data.error], [409, "Already handled."]);
  assertEquals(tables.move_requests[0].status, "approved");

  // Sequential: the second answer sees it handled.
  Object.assign(tables.move_requests[0], { status: "pending", decided_by: null, decided_at: null });
  beforeRequest = null;
  const ok = await answer(ask.data.id, "approve", asDad);
  assertEquals([ok.status, (await findDevice(key)).profile_id], [200, lin.id]);
  assertEquals((await answer(ask.data.id, "approve", asMom)).data.error, "Already handled.");
  assertEquals(notes(), []);
  // Lin had no other phone: nobody else was signed out.
  assertEquals(tables.devices.filter((d) => d.revoked_at).length, 0);
});

t("GET /move-requests/mine names who can let them in (settled, on their own phone), then who did", async () => {
  await dadsPhone();
  const lin = await phoneless("Lin");
  // Ivy just joined on her own phone: not settled, so not named.
  const ivyKey = await familyPhone();
  assertEquals((await call("POST", "/profiles/self", { headers: { "x-device-key": ivyKey }, body: { name: "Ivy", role: "cook" } })).status, 200);
  const key = await familyPhone();
  const ask = await askMove(key, lin.id);
  assertEquals(await mineFull(key), { id: ask.data.id, profile_id: lin.id, status: "pending", asked: ["Mom", "Dad"], let_in_by: null });
  // Asking to be Dad: Dad isn't named (it's about him).
  const asDadNow = await askMove(key, DAD);
  assertEquals((await mineFull(key)).asked, ["Mom"]);
  assertEquals((await answer(asDadNow.data.id, "approve", asMom)).status, 200);
  assertEquals(await mineFull(key), { id: asDadNow.data.id, profile_id: DAD, status: "approved", asked: [], let_in_by: "Mom" });
  // Declined: nobody named either way.
  const key2 = await familyPhone();
  const no = await askMove(key2, lin.id);
  assertEquals((await answer(no.data.id, "decline", asMom)).status, 200);
  const d = await mineFull(key2);
  assertEquals([d.status, d.asked, d.let_in_by], ["declined", [], null]);
});

t("only settled people answer asks: a day after their first phone joined, or the family's first person", async () => {
  const key = await familyPhone();
  const ask = await askMove(key, DAD);
  // Ivy joined a minute ago through a family link and added herself.
  const ivyKey = await familyPhone();
  const ivy = (await call("POST", "/profiles/self", { headers: { "x-device-key": ivyKey }, body: { name: "Ivy", role: "cook" } })).data;
  const asIvy = { "x-device-key": ivyKey, "x-profile-id": ivy.id };
  const fam = async (headers: Record<string, string>) => (await call("GET", "/family", { headers })).data;
  assertEquals((await call("GET", "/move-requests", { headers: asIvy })).data, []);
  assertEquals([(await fam(asIvy)).move_requests_pending, (await fam(asIvy)).can_manage], [0, false]);
  assertEquals((await fam({ "x-device-key": ivyKey })).can_manage, false, "this phone's person, without x-profile-id");
  for (const how of ["approve", "decline"] as const) {
    const r = await answer(ask.data.id, how, asIvy);
    assertEquals([r.status, r.data.error], [403, "You can do this after your first day here."], how);
  }
  assertEquals(tables.move_requests[0].status, "pending");
  // Mom's phone joined just now too, but she started the family.
  assertEquals([(await fam(asMom)).can_manage, (await fam({ "x-device-key": KEY })).can_manage], [true, true]);
  // A lent phone or the family code never manages (nobody's own phone).
  assertEquals((await fam({ "x-device-key": KEY, "x-profile-id": DAD })).can_manage, false);
  assertEquals((await fam({ "x-family-code": CODE })).can_manage, false);

  // Ivy's first phone (signed out since) joined two days ago: settled.
  tables.devices.push({
    id: crypto.randomUUID(), family_id: FAM, profile_id: ivy.id, key_hash: "old", label: "iPhone", via: "invite",
    created_at: ago(2), last_seen_at: ago(2), revoked_at: ago(1),
  });
  assertEquals([(await fam(asIvy)).move_requests_pending, (await fam(asIvy)).can_manage], [1, true]);
  assertEquals((await answer(ask.data.id, "decline", asIvy)).status, 200);

  // Just over a day on this phone alone is enough too.
  tables.devices.pop();
  (await findDevice(ivyKey)).created_at = new Date(Date.now() - 86_400_000 - 1000).toISOString();
  assertEquals((await fam(asIvy)).can_manage, true);
});

t("the family's first person stays first after leaving: it never passes to whoever joined last", async () => {
  // Ivy joins through a family link; then Mom (from her phone) and Dad leave, so Ivy is the earliest
  // added still in the family. She still waits out her own first day.
  const ivyKey = await familyPhone();
  const ivy = (await call("POST", "/profiles/self", { headers: { "x-device-key": ivyKey }, body: { name: "Ivy", role: "cook" } })).data;
  const asIvy = { "x-device-key": ivyKey, "x-profile-id": ivy.id };
  const key = await familyPhone();
  assertEquals((await call("POST", `/profiles/${MOM}/remove`, { headers: asMom })).status, 200, "Mom leaves from her phone");
  assertEquals((await call("POST", `/profiles/${DAD}/remove`, { headers: { "x-family-code": CODE, "x-profile-id": DAD } })).status, 200);
  const lin = await phoneless("Lin");
  const ask = await askMove(key, lin.id);
  assertEquals(ask.status, 200, JSON.stringify(ask.data));
  assertEquals((await call("GET", "/family", { headers: asIvy })).data.can_manage, false);
  assertEquals((await call("GET", "/move-requests", { headers: asIvy })).data, []);
  const r = await answer(ask.data.id, "approve", asIvy);
  assertEquals([r.status, r.data.error], [403, "You can do this after your first day here."]);
  assertEquals(tables.move_requests[0].status, "pending");
});

t("only someone on their own phone can answer: not a lent phone, not the family code", async () => {
  const lin = await phoneless("Lin");
  const key = await familyPhone();
  const ask = await askMove(key, DAD);
  const no = "Only someone on their own phone can let people in.";
  const lent = { "x-device-key": KEY, "x-profile-id": lin.id }; // Mom's phone, as Lin
  const code = { "x-family-code": CODE, "x-profile-id": lin.id }; // an old build
  for (const headers of [lent, code]) {
    assertEquals((await call("GET", "/move-requests", { headers })).data, []);
    assertEquals((await call("GET", "/family", { headers })).data.move_requests_pending, 0);
    for (const how of ["approve", "decline"] as const) {
      const r = await answer(ask.data.id, how, headers);
      assertEquals([r.status, r.data.error], [403, no], how);
    }
  }
  // Without x-profile-id: nobody to answer as.
  assertEquals((await call("GET", "/family", { headers: { "x-device-key": KEY } })).data.move_requests_pending, 0);
  assertEquals((await answer(ask.data.id, "approve", { "x-device-key": KEY })).status, 400);
  // The asking phone can't answer its own ask (it writes as nobody yet).
  const own = await answer(ask.data.id, "approve", { "x-device-key": key, "x-profile-id": lin.id });
  assertEquals([own.status, own.data.error], [403, "Add yourself first."]);
  // Unknown ids, and another family's ask, are 404.
  assertEquals((await answer(crypto.randomUUID(), "approve", asMom)).status, 404);
  assertEquals((await answer("nope", "decline", asMom)).status, 404);
  tables.move_requests[0].family_id = crypto.randomUUID();
  assertEquals((await answer(ask.data.id, "approve", asMom)).status, 404);
  tables.move_requests[0].family_id = FAM;
  assertEquals([tables.move_requests[0].status, (await findDevice(key)).profile_id], ["pending", null]);
});

t("approving for a phone that stopped waiting: 409, the ask is declined, nobody is signed out", async () => {
  await dadsPhone();
  // Signed out before anyone answered.
  const key = await familyPhone();
  const ask = await askMove(key, DAD);
  assertEquals((await call("POST", "/devices/revoke", { headers: { "x-device-key": key } })).status, 200);
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data, [], "a signed-out phone isn't listed");
  assertEquals((await call("GET", "/family", { headers: asMom })).data.move_requests_pending, 0);
  const r = await answer(ask.data.id, "approve", asMom);
  assertEquals([r.status, r.data.error], [409, "That phone isn't waiting anymore."]);
  assertEquals(tables.move_requests[0].status, "declined");
  assertEquals((await call("GET", "/family", { headers: asDad })).status, 200, "Dad's phone stays in");

  // Added itself instead.
  const key2 = await familyPhone();
  const ask2 = await askMove(key2, DAD);
  const ivy = await call("POST", "/profiles/self", { headers: { "x-device-key": key2 }, body: { name: "Ivy", role: "cook" } });
  assertEquals(ivy.status, 200);
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data, []);
  const r2 = await answer(ask2.data.id, "approve", asMom);
  assertEquals([r2.status, r2.data.error], [409, "That phone isn't waiting anymore."]);
  assertEquals([(await findDevice(key2)).profile_id, tables.move_requests[1].status], [ivy.data.id, "declined"]);
  assertEquals((await call("GET", "/family", { headers: asDad })).status, 200, "Dad's phone stays in");
  assertEquals(await mine(key2), { id: ask2.data.id, profile_id: DAD, status: "declined" });
});

t("decline: the ask closes with no note, and the phone can ask again", async () => {
  const key = await familyPhone();
  const ask = await askMove(key, DAD);
  const no = await answer(ask.data.id, "decline", asMom);
  assertEquals([no.status, no.data], [200, { ok: true }]);
  const row = tables.move_requests[0];
  assertEquals([row.status, row.decided_by, typeof row.decided_at], ["declined", MOM, "string"]);
  assertEquals(notes(), [], "no note for a no");
  assertEquals(await mine(key), { id: ask.data.id, profile_id: DAD, status: "declined" });
  assertEquals((await findDevice(key)).profile_id, null);
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data, []);
  for (const how of ["decline", "approve"] as const) {
    const late = await answer(ask.data.id, how, asMom);
    assertEquals([late.status, late.data.error], [409, "Already handled."], how);
  }
  const again = await askMove(key, DAD);
  assertEquals([again.status, again.data.status], [200, "pending"]);
  assertNotEquals(again.data.id, ask.data.id);
});

t("removing someone closes asks to be them", async () => {
  const lin = await phoneless("Lin");
  const key = await familyPhone();
  const ask = await askMove(key, lin.id);
  assertEquals((await call("POST", `/profiles/${lin.id}/remove`, { headers: { "x-device-key": KEY, "x-profile-id": lin.id } })).status, 200);
  assertEquals(await mine(key), { id: ask.data.id, profile_id: lin.id, status: "declined" });
  assertEquals((await call("GET", "/move-requests", { headers: asMom })).data, []);
  assertEquals((await answer(ask.data.id, "approve", asMom)).status, 409);
  assertEquals((await call("GET", "/move-requests/mine", { headers: { "x-family-code": CODE } })).data, null, "no key: nothing");
  assertEquals(await mine(await familyPhone()), null, "a phone that never asked");
});

t("POST /web-events: lander visits (JSON or text/plain); /events still takes old beacons", async () => {
  const visit = { event: "switch", aud: "kid", signal: "switch", ui: "hero", path: "/learn", utm_source: "ig", host: "homecookd.app" };
  const a = await call("POST", "/web-events", { body: visit, headers: { "cf-connecting-ip": "203.0.113.7" } });
  assertEquals([a.status, a.data], [204, null]);
  const b = await call("POST", "/web-events", { raw: JSON.stringify({ event: "land", aud: "parent" }), headers: { "content-type": "text/plain;charset=UTF-8" } });
  assertEquals(b.status, 204);
  assertEquals(tables.lander_events.length, 2);
  const row = tables.lander_events[0];
  assertEquals(
    [row.event, row.aud, row.signal, row.ui, row.path, row.utm_source, row.host, row.app, row.utm_campaign],
    ["switch", "kid", "switch", "hero", "/learn", "ig", "homecookd.app", null, null],
  );
  assertEquals(Object.keys(row).filter((k) => /ip|agent/i.test(k)), [], "nothing about the person");
  // The rate-limit key is a keyed hash: hashing every IP can't find who visited.
  assertNotEquals(rateKeys[0], `events-ip:${(await sha("203.0.113.7")).slice(0, 32)}`);

  for (const bad of [
    { event: "click", aud: "kid" },
    { event: "land" },
    { event: "land", aud: "kid", path: "x".repeat(101) },
    { event: "land", aud: "kid", ui: "x".repeat(21) },
    { event: "land", aud: "kid", host: "x".repeat(61) },
  ]) {
    assertEquals((await call("POST", "/web-events", { body: bad })).status, 400, JSON.stringify(bad));
  }
  assertEquals((await call("POST", "/web-events", { raw: "not json", headers: { "content-type": "text/plain" } })).status, 400);
  assertEquals((await call("POST", "/web-events", { raw: "event=land", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 400);
  const big = await call("POST", "/web-events", { raw: JSON.stringify({ event: "land", aud: "kid", pad: "x".repeat(70_000) }) });
  assertEquals([big.status, big.data.error], [413, "Request body is too large"]);
  assertEquals(tables.lander_events.length, 2);

  // An early lander beacon to /events still lands; the app's shape without a key is 401; with one,
  // the recipe-event path.
  assertEquals((await call("POST", "/events", { body: { event: "land", aud: "kid" } })).status, 204);
  assertEquals((await call("POST", "/events", { body: { recipe_id: "dad-sunday-chili", kind: "viewed" } })).status, 401);
  const app = await call("POST", "/events", { headers: asMom, body: { recipe_id: "dad-sunday-chili", kind: "nope" } });
  assertEquals([app.status, app.data.error], [400, "kind must be viewed, cooked, started or heard"]);
  assertEquals(tables.lander_events.length, 3);
});

// --- answers saved into a recipe, and taking one back out ---------------------------------------

/** Leo (a phone-less learner) asks about the chili in the circle; returns his headers and the question. */
async function leoAsks(body = "How long do I let the beef sit?") {
  const leo = (await call("POST", "/profiles", { headers: { "x-family-code": CODE }, body: { name: "Leo", role: "learner" } })).data as Row;
  const asLeo = { "x-family-code": CODE, "x-profile-id": leo.id };
  const cid = await circleId();
  const q = await call("POST", `/threads/${cid}/messages`, {
    headers: asLeo, body: { kind: "question", body, recipe_id: "dad-sunday-chili", step_order: 1 },
  });
  assertEquals(q.status, 200, JSON.stringify(q.data));
  return { leo, asLeo, cid, q: q.data as Row };
}
const asDadCode = { "x-family-code": CODE, "x-profile-id": DAD };
const openIds = async (headers: Record<string, string>) =>
  (await call("GET", "/questions/open", { headers })).data.map((x: Row) => x.message.id);

t("an answer saved by mistake comes back out, and the question opens again", async () => {
  const { cid, q } = await leoAsks();
  const a = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "text", body: "Hi everyone!", reply_to: q.id } });
  assertEquals([a.data.saved_to_recipe, typeof a.data.note_id], [true, "string"]);
  assertEquals(await openIds(asDadCode), [], "answered");

  const r = await call("POST", `/recipe-notes/${a.data.note_id}/remove`, { headers: asMom });
  assertEquals([r.status, r.data.ok, r.data.answer_message_id, r.data.question_message_id], [200, true, a.data.id, q.id]);
  assertEquals(tables.recipe_notes.length, 0);
  assertEquals(tables.messages.find((m) => m.id === a.data.id)!.reply_to, null, "the hello stays, unlinked");
  assertEquals(await openIds(asDadCode), [q.id], "open again");
  const msgs = (await call("GET", `/threads/${cid}/messages`, { headers: asMom })).data as Row[];
  const hello = msgs.find((m) => m.id === a.data.id)!;
  assertEquals([hello.saved_to_recipe, hello.note_id, msgs.find((m) => m.id === q.id)!.answered_by], [false, null, null]);

  const again = await call("POST", `/recipe-notes/${a.data.note_id}/remove`, { headers: asMom });
  assertEquals([again.status, again.data.error], [404, "That answer isn't in the recipe anymore."]);
  assertEquals((await call("POST", "/recipe-notes/nope/remove", { headers: asMom })).status, 404);
});

t("the asker and the dish's cook may take an answer out; nobody else may", async () => {
  const { cid, q, asLeo } = await leoAsks();
  const linda = await phoneless("Linda");
  const asLinda = { "x-family-code": CODE, "x-profile-id": linda.id };
  const a = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "text", body: "Ten minutes.", reply_to: q.id } });
  const no = await call("POST", `/recipe-notes/${a.data.note_id}/remove`, { headers: asLinda });
  assertEquals([no.status, no.data.error], [403, "Only the person who answered, the person who asked, or the cook can take this out."]);
  assertEquals(tables.recipe_notes.length, 1);
  // Dad's chili (cook.name in its recipe.json): he may.
  assertEquals((await call("POST", `/recipe-notes/${a.data.note_id}/remove`, { headers: asDadCode })).status, 200);

  const b = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "text", body: "Twelve.", reply_to: q.id } });
  assertEquals((await call("POST", `/recipe-notes/${b.data.note_id}/remove`, { headers: asLeo })).status, 200, "Leo asked");
  assertEquals(tables.recipe_notes.length, 0);
});

t("taking one answer out leaves a question someone else answered answered", async () => {
  const { cid, q } = await leoAsks();
  const mom = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "text", body: "Hi everyone!", reply_to: q.id } });
  const dad = await call("POST", `/threads/${cid}/messages`, { headers: asDadCode, body: { kind: "text", body: "Five minutes, then flip.", reply_to: q.id } });
  assertEquals(dad.data.saved_to_recipe, true);
  assertEquals((await call("POST", `/recipe-notes/${mom.data.note_id}/remove`, { headers: asMom })).status, 200);
  assertEquals(await openIds(asDadCode), [], "Dad's answer still answers it");
  assertEquals(tables.recipe_notes.map((n) => n.answer_text), ["Five minutes, then flip."]);
});

t("a newcomer's open questions start after they joined (no backlog)", async () => {
  const { q } = await leoAsks();
  tables.messages.find((m) => m.id === q.id)!.created_at = new Date(Date.now() - 60_000).toISOString();
  const linda = await phoneless("Linda");
  assertEquals(await openIds({ "x-family-code": CODE, "x-profile-id": linda.id }), [], "asked before Linda was added");
  assertEquals(await openIds(asDadCode), [q.id], "Dad (no created_at here: in the family all along) still sees it");
  const cid = await circleId();
  const leo = tables.profiles.find((p) => p.name === "Leo")!;
  const later = await call("POST", `/threads/${cid}/messages`, {
    headers: { "x-family-code": CODE, "x-profile-id": leo.id }, body: { kind: "question", body: "And the beans?" },
  });
  assertEquals(await openIds({ "x-family-code": CODE, "x-profile-id": linda.id }), [later.data.id], "asked after she joined");
});

/** A learner with no phone, added the old way; returns headers to act as them by the family code. */
async function learner(name: string) {
  const p = (await call("POST", "/profiles", { headers: { "x-family-code": CODE }, body: { name, role: "learner" } })).data as Row;
  return { id: p.id as string, as: { "x-family-code": CODE, "x-profile-id": p.id as string } };
}
const asDadByCode = { "x-family-code": CODE, "x-profile-id": DAD };

t("GET /recipes/:id/questions: the circle's open questions and my own 1:1s, never someone else's", async () => {
  const leo = await learner("Leo");
  const priya = await learner("Priya");
  const cid = await circleId();
  const R = "dad-sunday-chili";
  const ask = (thread: string, headers: Record<string, string>, body: Row) =>
    call("POST", `/threads/${thread}/messages`, { headers, body: { kind: "question", ...body } });
  // Leo asks the circle about step 2, and Dad 1:1 about step 3; Priya asks Dad 1:1 too. Another
  // dish's question never shows.
  const q1 = await ask(cid, leo.as, { body: "How long do I knead it?", recipe_id: R, step_order: 2 });
  assertEquals(q1.status, 200, JSON.stringify(q1.data));
  const leoDad = (await call("POST", "/threads", { headers: leo.as, body: { other_id: DAD } })).data.id;
  assertEquals((await ask(leoDad, leo.as, { body: "How much salt?", recipe_id: R, step_order: 3 })).status, 200);
  const priyaDad = (await call("POST", "/threads", { headers: priya.as, body: { other_id: DAD } })).data.id;
  assertEquals((await ask(priyaDad, priya.as, { body: "Which beans?", recipe_id: R, step_order: 1 })).status, 200);
  assertEquals((await ask(cid, leo.as, { body: "Rice or noodles?", recipe_id: "grandma-hand-pulled-noodle-soup", step_order: 1 })).status, 200);

  const list = async (headers: Record<string, string>) => {
    const r = await call("GET", `/recipes/${R}/questions`, { headers });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    return (r.data as Row[]).map((q) => [q.step_order, q.asker.name, q.mine, q.thread_kind, q.waiting_for?.name ?? null]);
  };
  assertEquals(await list(priya.as), [[1, "Priya", true, "pair", "Dad"], [2, "Leo", false, "circle", null]]);
  assertEquals(await list(leo.as), [[3, "Leo", true, "pair", "Dad"], [2, "Leo", true, "circle", null]]);
  // No profile: the circle's only. Dad (asked) doesn't see others' 1:1s here either.
  assertEquals(await list({ "x-family-code": CODE }), [[2, "Leo", false, "circle", null]]);
  assertEquals(await list(asDadByCode), [[2, "Leo", false, "circle", null]]);

  // Dad answers the circle question: it's gone for everyone. Leo's 1:1 one still waits.
  const reply = await call("POST", `/threads/${cid}/messages`, { headers: asDadByCode, body: { kind: "text", body: "Until it's smooth.", reply_to: q1.data.id } });
  assertEquals(reply.status, 200, JSON.stringify(reply.data));
  assertEquals(await list(priya.as), [[1, "Priya", true, "pair", "Dad"]]);
  assertEquals(await list(leo.as), [[3, "Leo", true, "pair", "Dad"]]);
  assertEquals((await call("GET", "/recipes/not a recipe/questions", { headers: leo.as })).status, 400);

  // Someone who left: their own questions drop (asker gone), and so do questions to them.
  assertEquals((await ask(cid, priya.as, { body: "Fresh or dried chiles?", recipe_id: R, step_order: 4 })).status, 200);
  assertEquals((await list(leo.as)).length, 2);
  tables.profiles.find((p) => p.id === priya.id)!.removed_at = new Date().toISOString();
  assertEquals(await list(leo.as), [[3, "Leo", true, "pair", "Dad"]]);
  tables.profiles.find((p) => p.id === DAD)!.removed_at = new Date().toISOString();
  assertEquals(await list(leo.as), []);
});

t("POST /photo-upload, then a cooked message with photo_path: private bucket, signed photo_url", async () => {
  const leo = await learner("Leo");
  const up = await call("POST", "/photo-upload", { headers: leo.as, body: { content_type: "image/jpeg" } });
  assertEquals(up.status, 200, JSON.stringify(up.data));
  assertMatch(up.data.path, new RegExp(`^${FAM}/[0-9a-f-]{36}\\.jpg$`));
  assertMatch(up.data.upload_url, /\/storage\/v1\/object\/upload\/sign\/photos\//);
  assertEquals([up.data.method, up.data.headers["content-type"], up.data.max_bytes], ["PUT", "image/jpeg", 10 * 1024 * 1024]);
  assertEquals((await call("POST", "/photo-upload", { headers: leo.as, body: { content_type: "video/mp4" } })).status, 400);
  assertEquals((await call("POST", "/photo-upload", { headers: { "x-family-code": CODE }, body: {} })).status, 400, "needs a person");

  const pair = (await call("POST", "/threads", { headers: leo.as, body: { other_id: DAD } })).data.id;
  const send = (body: Row) =>
    call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "dad-sunday-chili", ...body } });
  // Sent before the PUT landed: refused.
  const early = await send({ photo_path: up.data.path });
  assertEquals([early.status, early.data.error], [400, "Upload the photo before sending it"]);
  stored.add(`photos/${up.data.path}`);
  const sent = await send({ photo_path: up.data.path, body: "First try!!" });
  assertEquals(sent.status, 200, JSON.stringify(sent.data));
  assertMatch(sent.data.photo_url, /\/storage\/v1\/object\/sign\/photos\//);
  assertEquals(sent.data.body, "First try!!");
  assertEquals((await send({})).status, 200);
  // Dad reads it with a fresh signed URL; a cooked message without a photo has photo_url null.
  const read = await call("GET", `/threads/${pair}/messages`, { headers: asDadByCode });
  assertEquals((read.data as Row[]).map((m) => [m.kind, m.body, !!m.photo_url]), [["cooked", "First try!!", true], ["cooked", null, false]]);
  assertEquals(read.data[1].photo_url, null);

  // Only our own paths, and only on cooked messages.
  assertEquals((await send({ photo_path: `${FAM}/nope.jpg` })).status, 400);
  assertEquals((await send({ photo_path: up.data.path.replace(FAM, MOM) })).status, 400);
  assertEquals((await send({ photo_path: up.data.path.replace(".jpg", ".m4a") })).status, 400);
  const text = await call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "text", body: "hi", photo_path: up.data.path } });
  assertEquals([text.status, text.data.error], [400, "photo_path is only for cooked messages"]);
});

// === retention PR 1: x-tz, pushes for messages & recipes, reactions, events, tokens & cron ======

const tokenFor = (id: string, n: number | string) => ({
  token: `ExponentPushToken[t${n}]`, family_id: FAM, profile_id: id, device_id: null, platform: "ios",
});
/** What reached Expo, as [to, title, body, url]. */
const pushes = () => pushed.map((m) => [m.to, m.title, m.body, m.data.url]);

t("retention: CORS allows x-tz, and a signed-in call stores it on the acting profile", async () => {
  const pre = await handler!(new Request("http://edge.local/functions/v1/api/family", { method: "OPTIONS" }));
  assertMatch(pre.headers.get("access-control-allow-headers") ?? "", /x-tz/);
  assertEquals((await call("GET", "/family", { headers: { ...asMom, "x-tz": "America/New_York" } })).status, 200);
  await backgroundIdle();
  assertEquals(tables.profiles.find((x) => x.id === MOM)!.tz, "America/New_York");
  await call("GET", "/family", { headers: { ...asMom, "x-tz": "+05:30" } }); // not a zone: refused, kept
  await backgroundIdle();
  assertEquals(tables.profiles.find((x) => x.id === MOM)!.tz, "America/New_York");
  // POST /events (public, signed in by its headers) stores it too; a call with no person stores nothing.
  const leo = await learner("Leo");
  await call("POST", "/events", { headers: { ...leo.as, "x-tz": "Europe/London" }, body: { recipe_id: "dad-sunday-chili", kind: "viewed" } });
  await call("GET", "/family", { headers: { "x-family-code": CODE, "x-tz": "Asia/Tokyo" } });
  await backgroundIdle();
  assertEquals(tables.profiles.filter((x) => x.tz).map((x) => [x.name, x.tz]), [["Mom", "America/New_York"], ["Leo", "Europe/London"]]);
});

t("retention: a text pushes the other person once, with the sender's name and the chat; never the sender", async () => {
  tables.push_tokens.push(tokenFor(DAD, 1), tokenFor(MOM, 2));
  const th = await call("POST", "/threads", { headers: asMom, body: { other_id: DAD } });
  const sent = await call("POST", `/threads/${th.data.id}/messages`, { headers: asMom, body: { kind: "text", body: "Dinner at 6?" } });
  assertEquals(sent.status, 200);
  await backgroundIdle();
  assertEquals(pushes(), [["ExponentPushToken[t1]", "Mom", "Dinner at 6?", `/chat/${th.data.id}`]]);
  assertEquals(pushed[0].data.profile_id, DAD, "a shared phone knows whose push it is");
  assertEquals(
    tables.notification_log.map((r) => [r.profile_id, r.kind, r.app_initiated, r.dedupe_key]),
    [[DAD, "message", false, `message:${sent.data.id}`]],
  );
  // A voice note says how long it is. No phone with push on: nothing sent, nothing logged.
  tables.push_tokens = tables.push_tokens.filter((x) => x.profile_id !== DAD);
  await call("POST", `/threads/${th.data.id}/messages`, { headers: asMom, body: { kind: "text", body: "Again?" } });
  await backgroundIdle();
  assertEquals([pushed.length, tables.notification_log.length], [1, 1]);
});

t("retention: a dead token is pruned; Expo's answer never fails the send", async () => {
  tables.push_tokens.push(tokenFor(DAD, "dead"), tokenFor(DAD, 7));
  const th = await call("POST", "/threads", { headers: asMom, body: { other_id: DAD } });
  const sent = await call("POST", `/threads/${th.data.id}/messages`, { headers: asMom, body: { kind: "text", body: "Hi" } });
  assertEquals(sent.status, 200);
  await backgroundIdle();
  assertEquals(pushed.map((m) => m.to).sort(), ["ExponentPushToken[t7]", "ExponentPushToken[tdead]"]);
  assertEquals(tables.push_tokens.map((x) => x.token), ["ExponentPushToken[t7]"]);
});

t("retention: a circle question pushes the cooks but the asker, naming the dish; a 1:1 question only the one asked", async () => {
  const leo = await learner("Leo");
  tables.push_tokens.push(tokenFor(MOM, 1), tokenFor(DAD, 2), tokenFor(leo.id, 3));
  const cid = await circleId();
  const q = await call("POST", `/threads/${cid}/messages`, {
    headers: leo.as, body: { kind: "question", body: "How long do the beans soak?", recipe_id: "dad-sunday-chili", step_order: 2 },
  });
  assertEquals(q.status, 200, JSON.stringify(q.data));
  await backgroundIdle();
  assertEquals(pushes().sort(), [
    ["ExponentPushToken[t1]", "Leo asked about Dad's Sunday Chili", "How long do the beans soak?", `/chat/${cid}`],
    ["ExponentPushToken[t2]", "Leo asked about Dad's Sunday Chili", "How long do the beans soak?", `/chat/${cid}`],
  ]);
  assertEquals(tables.notification_log.map((r) => r.kind), ["question", "question"]);

  pushed = [];
  const pair = (await call("POST", "/threads", { headers: leo.as, body: { other_id: DAD } })).data.id;
  await call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "step", recipe_id: "dad-sunday-chili", step_order: 3, body: "Lid on?" } });
  await backgroundIdle();
  assertEquals(pushes(), [["ExponentPushToken[t2]", "Leo asked about Dad's Sunday Chili", "Lid on?", `/chat/${pair}`]]);
  // A circle text goes to everyone else in the family.
  pushed = [];
  await call("POST", `/threads/${cid}/messages`, { headers: asDadByCode, body: { kind: "text", body: "Overnight." } });
  await backgroundIdle();
  assertEquals(pushes().map((x) => [x[0], x[1]]).sort(), [["ExponentPushToken[t1]", "Dad"], ["ExponentPushToken[t3]", "Dad"]]);
});

t("retention: reactions: a heart (no push), 'Just like mine' only on a dish someone else made, once", async () => {
  const leo = await learner("Leo");
  tables.push_tokens.push(tokenFor(leo.id, 3));
  const cid = (await call("POST", "/threads", { headers: leo.as, body: { other_id: MOM } })).data.id;
  const made = await call("POST", `/threads/${cid}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "mom-dal" } });
  assertEquals(made.status, 200);
  const text = await call("POST", `/threads/${cid}/messages`, { headers: leo.as, body: { kind: "text", body: "So good" } });

  const heart = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "reaction", body: "heart" } });
  assertEquals([heart.status, heart.data.kind, heart.data.body], [200, "reaction", "heart"]);
  const bad = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "reaction", body: "wow" } });
  assertEquals([bad.status, bad.data.error], [400, "body must be heart or just_like_mine"]);
  for (const body of [
    { kind: "reaction", body: "just_like_mine" }, // needs the dish
    { kind: "reaction", body: "just_like_mine", reply_to: text.data.id }, // not a dish
  ]) {
    const r = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body });
    assertEquals([r.status, r.data.error], [400, "A reaction answers a dish someone made"], JSON.stringify(body));
  }
  const own = await call("POST", `/threads/${cid}/messages`, { headers: leo.as, body: { kind: "reaction", body: "heart", reply_to: made.data.id } });
  assertEquals(own.status, 400, "not on my own dish");

  const jlm = { kind: "reaction", body: "just_like_mine", reply_to: made.data.id, recipe_id: "mom-dal" };
  const first = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: jlm });
  const again = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: jlm });
  assertEquals([first.status, again.data.id], [200, first.data.id]);
  await backgroundIdle();
  // Leo's phone: one push for "Just like mine", none for the heart.
  assertEquals(pushed.map((m) => [m.to, m.title, m.body]), [["ExponentPushToken[t3]", "Mom", "“Just like mine.” on your Dal"]]);

  // Reactions never become the inbox headline, never unread.
  const inbox = await call("GET", "/threads", { headers: leo.as });
  const pair = inbox.data.find((x: Row) => x.id === cid);
  assertEquals([pair.last.id, pair.unread], [text.data.id, 0]);

  // In the circle, "Just like mine" still goes only to whoever made the dish: its "your" is theirs.
  pushed = [];
  tables.push_tokens.push(tokenFor(DAD, 2));
  const circle = await circleId();
  const madeHere = await call("POST", `/threads/${circle}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "mom-dal" } });
  assertEquals(madeHere.status, 200);
  await backgroundIdle();
  pushed = [];
  const inCircle = await call("POST", `/threads/${circle}/messages`, {
    headers: asMom, body: { kind: "reaction", body: "just_like_mine", reply_to: madeHere.data.id, recipe_id: "mom-dal" },
  });
  assertEquals(inCircle.status, 200, JSON.stringify(inCircle.data));
  await backgroundIdle();
  assertEquals(pushed.map((m) => m.to), ["ExponentPushToken[t3]"], "never Dad");
});

// pushMessage's member check (stillHere) and notify()'s own removed_at check both hold this one.
t("retention: 'Just like mine' never pushes a maker who has left the family", async () => {
  const leo = await learner("Leo");
  tables.push_tokens.push(tokenFor(leo.id, 3), tokenFor(DAD, 2));
  const circle = await circleId();
  const made = await call("POST", `/threads/${circle}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "mom-dal" } });
  assertEquals(made.status, 200);
  await backgroundIdle();
  tables.profiles.find((p) => p.id === leo.id)!.removed_at = new Date().toISOString();
  pushed = [];
  const jlm = await call("POST", `/threads/${circle}/messages`, {
    headers: asMom, body: { kind: "reaction", body: "just_like_mine", reply_to: made.data.id, recipe_id: "mom-dal" },
  });
  assertEquals(jlm.status, 200, JSON.stringify(jlm.data));
  await backgroundIdle();
  assertEquals(pushed.length, 0, "Leo left; nobody else gets Leo's 'your'");
});

t("retention: a heart sent from Home never marks the chat read or moves it up the inbox", async () => {
  const leo = await learner("Leo");
  const withLeo = (await call("POST", "/threads", { headers: leo.as, body: { other_id: MOM } })).data.id;
  const text = await call("POST", `/threads/${withLeo}/messages`, { headers: leo.as, body: { kind: "text", body: "Is it two cups?" } });
  const withDad = (await call("POST", "/threads", { headers: asDadByCode, body: { other_id: MOM } })).data.id;
  await call("POST", `/threads/${withDad}/messages`, { headers: asDadByCode, body: { kind: "text", body: "Home at 6" } });
  // Leo wrote a minute before Dad, so a later touch of Leo's chat can't tie with it.
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  tables.messages.find((m) => m.id === text.data.id)!.created_at = minuteAgo;
  tables.threads.find((x) => x.id === withLeo)!.last_message_at = minuteAgo;
  const momsInbox = async () =>
    (await call("GET", "/threads", { headers: asMom })).data.map((x: Row) => [x.id, x.unread]);
  const before = await momsInbox();
  assertEquals(before.slice(1), [[withDad, 1], [withLeo, 1]]);

  // Mom hearts Leo mid-cook from Home (no chat open, nothing answered).
  const heart = await call("POST", `/threads/${withLeo}/messages`, { headers: asMom, body: { kind: "reaction", body: "heart" } });
  assertEquals([heart.status, heart.data.kind], [200, "reaction"]);
  assertEquals(await momsInbox(), before, "same order, Leo's question still unread");
  assertEquals((await call("GET", "/unread", { headers: asMom })).data.total, 2);
  assertEquals(tables.threads.find((x) => x.id === withLeo)!.last_message_at, minuteAgo);
});

t("retention: a recipe sent or delivered by the pipeline pushes 'Just in from' with the dish, opening it", async () => {
  const leo = await learner("Leo");
  tables.push_tokens.push(tokenFor(leo.id, 4), tokenFor(MOM, 5));
  const sent = await call("POST", "/send-recipe", { headers: asMom, body: { recipe_id: "dad-sunday-chili", to: [leo.id] } });
  assertEquals(sent.status, 200, JSON.stringify(sent.data));
  await backgroundIdle();
  assertEquals(pushes(), [["ExponentPushToken[t4]", "Just in from Mom", "Dad's Sunday Chili", "/recipe/dad-sunday-chili"]]);

  // The worker publishes Dad's recording: Leo gets it (Dad sent it, so not Dad).
  pushed = [];
  tables.pending_sends.push({
    job_id: "job-chili", family_id: FAM, sender_id: DAD, recipient_ids: [leo.id, DAD], hello_path: null,
    hello_duration_s: null, delivered_at: null, recipe_id: null,
  });
  const pub = await call("POST", "/jobs/job-chili/published", { headers: { "x-family-code": CODE }, body: { recipe_id: "dad-sunday-chili" } });
  assertEquals([pub.status, pub.data.delivered], [200, 1], JSON.stringify(pub.data));
  await backgroundIdle();
  assertEquals(pushes(), [["ExponentPushToken[t4]", "Just in from Dad", "Dad's Sunday Chili", "/recipe/dad-sunday-chili"]]);
  // Delivered once: the worker's retry delivers (and pushes) nothing.
  await call("POST", "/jobs/job-chili/published", { headers: { "x-family-code": CODE }, body: { recipe_id: "dad-sunday-chili" } });
  await backgroundIdle();
  assertEquals(pushed.length, 1);
});

t("retention: POST /events takes started & heard with cook_id; recipe stats still count views & cooks only", async () => {
  const leo = await learner("Leo");
  const ev = (body: Row) => call("POST", "/events", { headers: leo.as, body });
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 2 })).data.error, "duration_s must be at least 3 for heard");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: "nobody", duration_s: 5 })).data.error, "cook_id must be someone in your family");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 5, start_s: 12 })).data, { ok: true, counted: true });
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 5, start_s: 12 })).data.counted, false, "same clip within 5 s");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 7, start_s: 40 })).data.counted, true, "another clip");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "started", cook_id: MOM })).data.counted, true);
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "cooked", cook_id: MOM })).data.counted, true);
  const heard = tables.recipe_events.find((e) => e.kind === "heard")!;
  assertEquals([heard.cook_id, heard.duration_s, heard.clip_start_s], [MOM, 5, 12]);
  const stats = await call("GET", "/me/recipe-stats", { headers: leo.as });
  assertEquals(stats.data.map((x: Row) => [x.recipe_id, x.views, x.cooked]), [["mom-dal", 0, 1]]);
  // Only heard events about a dish: still no row for it in my stats.
  await ev({ recipe_id: "dad-sunday-chili", kind: "heard", cook_id: DAD, duration_s: 9, start_s: 0 });
  assertEquals((await call("GET", "/me/recipe-stats", { headers: leo.as })).data.length, 1);
  const act = await call("GET", "/recipes/mom-dal/activity", { headers: leo.as });
  assertEquals([act.data.cooked.map((c: Row) => c.profile.name), act.data.viewed], [["Leo"], []]);
});

t("retention: push tokens register to the phone's own person and come off at sign-out", async () => {
  const bad = await call("POST", "/push-tokens", { headers: asMom, body: { token: "abc", platform: "ios" } });
  assertEquals([bad.status, bad.data.error], [400, "token must be an Expo push token"]);
  const reg = await call("POST", "/push-tokens", { headers: asMom, body: { token: "ExponentPushToken[abc]", platform: "ios" } });
  assertEquals([reg.status, tables.push_tokens.map((x) => [x.profile_id, !!x.device_id])], [200, [[MOM, true]]]);
  // Again from the same phone: still one row.
  await call("POST", "/push-tokens", { headers: asMom, body: { token: "ExponentPushToken[abc]", platform: "ios" } });
  assertEquals(tables.push_tokens.length, 1);
  // Sign-out sends only the key (no person).
  const off = await call("POST", "/push-tokens/remove", { headers: { "x-device-key": KEY }, body: { token: "ExponentPushToken[abc]" } });
  assertEquals([off.status, tables.push_tokens.length], [200, 0]);
});

t("retention: the hourly cron needs its secret, takes a test clock, and finds whose local hour it is", async () => {
  const leo = await learner("Leo");
  tables.profiles.find((p) => p.id === leo.id)!.tz = "America/Los_Angeles";
  tables.push_tokens.push(tokenFor(leo.id, 8), tokenFor(MOM, 9));
  const none = await call("POST", "/cron/hourly", { body: {} });
  assertEquals([none.status, none.data.error], [401, "Not allowed"]);
  const wrong = await call("POST", "/cron/hourly", { headers: { "x-cron-secret": "nope" }, body: {} });
  assertEquals(wrong.status, 401);
  const cron = (now: unknown) => call("POST", "/cron/hourly", { headers: { "x-cron-secret": CRON_SECRET }, body: { now } });
  assertEquals((await cron("Sunday")).data.error, "now must be an ISO time");
  // Sunday Oct 25, 17:10 in Los Angeles: Leo (a learner with push on) is in his nudge hour. PR 5's
  // table_nudge runs for him, but he has no week at the table with anyone yet, so nothing is sent.
  // PR 6's recap job runs every hour too and finds nobody on a local 1st.
  const sunday = await cron("2026-10-25T17:10:00-07:00");
  assertEquals([sunday.status, sunday.data], [200, { ok: true, due: { nudge: 1, recap: 0 }, sent: 0, jobs: { table_nudge: 0, recap: 0 } }]);
  assertEquals((await cron("2026-10-25T18:10:00-07:00")).data.due, { nudge: 0, recap: 0 });
  // Dec 1, 10:10 in Los Angeles: the first edition's recap hour (FIRST_MONTH is November), but nobody
  // did anything in November: no push.
  const first = await cron("2026-12-01T10:10:00-08:00");
  assertEquals([first.status, first.data.sent, first.data.jobs.recap], [200, 0, 0], JSON.stringify(first.data));
  assertEquals(pushed.length, 0);
});

// === retention PR 2: Leo is cooking ===============================================================

const COOKING_KID = "77777777-7777-4777-8777-777777777777";
const asCookingKid = { "x-family-code": CODE, "x-profile-id": COOKING_KID };
function addCookingKid() {
  tables.profiles.push({ id: COOKING_KID, family_id: FAM, name: "Leo", role: "learner", relation: null, avatar_key: null, sort: 6, removed_at: null, email: null });
}

t("PR 2: asked once; then one push to Mom, her live row, the step, the end, and no second push that day", async () => {
  addCookingKid();
  tables.push_tokens.push({ token: "ExponentPushToken[pr2-mom]", family_id: FAM, profile_id: MOM, device_id: null, platform: "ios" });
  const dal = (step: number) => ({ recipe_id: "mom-dal", cook_id: MOM, step, total: 6 });
  const asked = await call("POST", "/cooking", { headers: asCookingKid, body: dal(1) });
  assertEquals([asked.status, asked.data.consent, asked.data.shared], [200, "unasked", false]);
  assertEquals((await call("GET", "/profile/share-cooking", { headers: asCookingKid })).data, { share_cooking: null });
  assertEquals((await call("POST", "/profile/share-cooking", { headers: asCookingKid, body: { share: true } })).data, { ok: true, share_cooking: true });

  const go = await call("POST", "/cooking", { headers: asCookingKid, body: dal(1) });
  assertEquals([go.status, go.data.shared, go.data.new_session], [200, true, true]);
  await backgroundIdle();
  assertEquals(pushed.map((m) => [m.to, m.title, m.body, m.data.url]),
    [["ExponentPushToken[pr2-mom]", "Leo is making your Dal", "Right now, step 1 of 6.", "/parent/home"]]);
  assertEquals(tables.recipe_events.map((e) => [e.profile_id, e.kind, e.cook_id]), [[COOKING_KID, "started", MOM]]);

  assertEquals((await call("POST", "/cooking", { headers: asCookingKid, body: dal(3) })).data.new_session, false);
  const live = await call("GET", "/cooking", { headers: asMom });
  assertEquals(live.data.map((r: Row) => [r.profile.name, r.recipe_id, r.step, r.total]), [["Leo", "mom-dal", 3, 6]]);
  assertEquals((await call("GET", "/cooking", { headers: { "x-family-code": CODE, "x-profile-id": DAD } })).data, []);

  assertEquals((await call("POST", "/cooking/end", { headers: asCookingKid, body: { recipe_id: "mom-dal" } })).data, { ok: true });
  assertEquals((await call("GET", "/cooking", { headers: asMom })).data, []);
  assert((await call("POST", "/cooking", { headers: asCookingKid, body: dal(1) })).data.new_session);
  await backgroundIdle();
  assertEquals([pushed.length, tables.notification_log.length, tables.recipe_events.length], [1, 1, 2]);
});

t("PR 2: 400s, someone else's dish, and Not now (nothing written)", async () => {
  addCookingKid();
  const r = (body: Row) => call("POST", "/cooking", { headers: asCookingKid, body });
  assertEquals((await r({ recipe_id: "mom-dal", cook_id: COOKING_KID, step: 1, total: 6 })).data.error, "cook_id must be someone else in your family");
  assertEquals((await r({ recipe_id: "mom-dal", cook_id: MOM, step: 7, total: 6 })).data.error, "step must be at most total");
  await call("POST", "/profile/share-cooking", { headers: asCookingKid, body: { share: true } });
  const theirs = await r({ recipe_id: "mom-dal", cook_id: DAD, step: 1, total: 6 });
  assertEquals([theirs.status, theirs.data.error], [400, "cook_id must be the dish's cook"]);
  await call("POST", "/profile/share-cooking", { headers: asCookingKid, body: { share: false } });
  assertEquals((await r({ recipe_id: "mom-dal", cook_id: MOM, step: 1, total: 6 })).data.consent, "no");
  assertEquals([tables.cooking_now.length, tables.recipe_events.length], [0, 0]);
  assertEquals((await call("GET", "/cooking", { headers: { "x-family-code": CODE } })).data.error, "x-profile-id header is required for this request");
});

t("PR 2: a memorial cook's dish never asks (consent 'no', memorial) and writes nothing", async () => {
  addCookingKid();
  tables.profiles.find((p) => p.id === MOM)!.memorial = true;
  const r = await call("POST", "/cooking", { headers: asCookingKid, body: { recipe_id: "mom-dal", cook_id: MOM, step: 1, total: 6 } });
  assertEquals([r.status, r.data], [200, { ok: true, shared: false, consent: "no", memorial: true, started_at: null, new_session: false }]);
  assertEquals((await call("GET", "/profile/share-cooking", { headers: asCookingKid })).data, { share_cooking: null });
  await backgroundIdle();
  assertEquals([tables.cooking_now.length, tables.recipe_events.length, pushed.length], [0, 0, 0]);
});

t("PR 2: Mom's heart from Home reaches Leo's 1:1 as a reaction (no push, not unread, not the inbox headline)", async () => {
  addCookingKid();
  tables.push_tokens.push({ token: "ExponentPushToken[pr2-leo]", family_id: FAM, profile_id: COOKING_KID, device_id: null, platform: "ios" });
  const th = (await call("POST", "/threads", { headers: asMom, body: { other_id: COOKING_KID } })).data.id;
  const hi = await call("POST", `/threads/${th}/messages`, { headers: asCookingKid, body: { kind: "text", body: "Making your dal!" } });
  // A minute before the heart, so `after` never ties with it inside one millisecond.
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  tables.messages.find((m) => m.id === hi.data.id)!.created_at = minuteAgo;
  await backgroundIdle();
  pushed = [];
  const heart = await call("POST", `/threads/${th}/messages`, { headers: asMom, body: { kind: "reaction", body: "heart", recipe_id: "mom-dal" } });
  assertEquals([heart.status, heart.data.kind, heart.data.body, heart.data.recipe_id], [200, "reaction", "heart", "mom-dal"]);
  await backgroundIdle();
  assertEquals(pushed.length, 0, "a heart is in-app only");
  // The kid's heart watch reads it from the thread after the session start.
  const after = await call("GET", `/threads/${th}/messages?after=${encodeURIComponent(minuteAgo)}`, { headers: asCookingKid });
  assertEquals(after.data.map((m: Row) => [m.kind, m.body, m.sender_id]), [["reaction", "heart", MOM]]);
  // Leo's inbox: the text is still the headline and the heart counts as nothing unread.
  const inbox = await call("GET", "/threads", { headers: asCookingKid });
  const row = inbox.data.find((x: Row) => x.id === th);
  assertEquals([row.last.id, row.unread], [hi.data.id, 0]);
  assertEquals((await call("GET", "/unread", { headers: asCookingKid })).data.total, 0);
  // A thread holding only a heart never shows in the inbox.
  const dadTh = (await call("POST", "/threads", { headers: asDadByCode, body: { other_id: COOKING_KID } })).data.id;
  await call("POST", `/threads/${dadTh}/messages`, { headers: asDadByCode, body: { kind: "reaction", body: "heart" } });
  const again = await call("GET", "/threads", { headers: asCookingKid });
  assert(!again.data.some((x: Row) => x.id === dadTh), "a heart alone is no conversation");
  assertEquals((await call("GET", "/unread", { headers: asCookingKid })).data.total, 0);
});

// === retention PR 4: hearts & kitchen ============================================================

const MAYA = "66666666-6666-4666-8666-666666666666";
const asMaya = { "x-family-code": CODE, "x-profile-id": MAYA };
function addMaya() {
  tables.profiles.push({ id: MAYA, family_id: FAM, name: "Maya", role: "learner", relation: null, avatar_key: null, sort: 5, removed_at: null, email: null });
}

t("PR 4: Maya hearts & cooks Dad's chili -> Dad's /dish-stats & /hearts/recent show her; Mom sees nothing of Dad's", async () => {
  addMaya();
  assertEquals((await call("POST", "/favorites", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", on: true } })).status, 200);
  assertEquals((await call("POST", "/events", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", kind: "cooked" } })).data.counted, true);
  // Kinds PR 1 adds, written straight into the table: none of them is a cook.
  for (const kind of ["viewed", "started", "heard"]) {
    tables.recipe_events.push({ id: crypto.randomUUID(), family_id: FAM, profile_id: MAYA, recipe_id: "dad-sunday-chili", kind, created_at: new Date().toISOString() });
  }
  // Dad's own heart never counts.
  await call("POST", "/favorites", { headers: asDadByCode, body: { recipe_id: "dad-sunday-chili", on: true } });

  const stats = await call("GET", "/dish-stats?ids=dad-sunday-chili,dad-fried-rice,mom-dal", { headers: asDadByCode });
  assertEquals(stats.status, 200);
  assertEquals(Object.keys(stats.data).sort(), ["dad-fried-rice", "dad-sunday-chili"]);
  const chili = stats.data["dad-sunday-chili"];
  assertEquals([chili.hearts.count, chili.hearts.by.map((h: Row) => h.profile_id), chili.cooked.count, chili.cooked.by.map((c: Row) => [c.profile_id, c.count])],
    [1, [MAYA], 1, [[MAYA, 1]]]);
  assertEquals(stats.data["dad-fried-rice"], { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } });

  const recent = await call("GET", "/hearts/recent", { headers: asDadByCode });
  assertEquals(recent.data.map((h: Row) => [h.profile_id, h.recipe_id]), [[MAYA, "dad-sunday-chili"]]);

  assertEquals((await call("GET", "/dish-stats?ids=dad-sunday-chili", { headers: asMom })).data, {});
  assertEquals((await call("GET", "/hearts/recent", { headers: asMom })).data, []);

  // No push for hearts (handoff 2.5).
  await backgroundIdle();
  assertEquals(pushed.length, 0);

  // Un-heart: gone from both.
  await call("POST", "/favorites", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", on: false } });
  assertEquals((await call("GET", "/dish-stats?ids=dad-sunday-chili", { headers: asDadByCode })).data["dad-sunday-chili"].hearts.count, 0);
  assertEquals((await call("GET", "/hearts/recent", { headers: asDadByCode })).data, []);
});

t("PR 4: GET /family says who is memorial; a database that can't read it leaves the flag out", async () => {
  // Guardrail 2: the app's "Dad sees your hearts" note (and anything else that would address someone
  // as present) needs memorial === false to have really come back.
  tables.profiles.find((p) => p.id === DAD)!.memorial = true;
  const r = await call("GET", "/family", { headers: asMom });
  assertEquals(r.data.profiles.map((p: Row) => [p.name, p.memorial]), [["Mom", false], ["Dad", true]]);
  assertEquals(r.data.former_profiles.map((p: Row) => "memorial" in p), [false], "removed people stay names only");
  // A database without the column (function deployed before the migration): the family still loads.
  beforeRequest = (table, method, url) => {
    if (table === "profiles" && method === "GET" && (url.searchParams.get("select") ?? "").replace(/\s/g, "") === "id,memorial") {
      return new Response(JSON.stringify({ code: "42703", message: "column profiles.memorial does not exist" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }
  };
  const old = await call("GET", "/family", { headers: asMom });
  assertEquals(old.status, 200);
  assertEquals(old.data.profiles.map((p: Row) => [p.name, "memorial" in p]), [["Mom", false], ["Dad", false]]);
});

t("PR 4: /dish-stats & /hearts/recent 400s", async () => {
  const many = Array.from({ length: 51 }, (_, i) => `dad-${i}`).join(",");
  const r = (path: string, headers: Record<string, string> = asDadByCode) => call("GET", path, { headers });
  assertEquals([(await r(`/dish-stats?ids=${many}`)).status, (await r(`/dish-stats?ids=${many}`)).data.error], [400, "ids: at most 50"]);
  assertEquals((await r("/dish-stats")).data.error, "ids is required");
  assertEquals((await r("/dish-stats?ids=Bad%20Id")).data.error, "ids must be recipe ids separated by commas");
  assertEquals((await r("/hearts/recent?since=soon")).data.error, "since must be an ISO time");
  assertEquals((await r("/dish-stats?ids=dad-sunday-chili", { "x-family-code": CODE })).data.error, "x-profile-id header is required for this request");
});

t("PR 4 wiring: /me/recipe-stats and /recipes/:id/activity count views & cooks only", async () => {
  addMaya();
  const now = new Date().toISOString();
  for (const kind of ["heard", "started"]) {
    tables.recipe_events.push({ id: crypto.randomUUID(), family_id: FAM, profile_id: MAYA, recipe_id: "mom-dal", kind, created_at: now });
  }
  await call("POST", "/events", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", kind: "cooked" } });
  const stats = await call("GET", "/me/recipe-stats", { headers: asMaya });
  assertEquals(stats.data.map((x: Row) => [x.recipe_id, x.views, x.cooked]), [["dad-sunday-chili", 0, 1]], "no zero row for a dish only heard");
  const act = await call("GET", "/recipes/mom-dal/activity", { headers: asMom });
  assertEquals([act.data.cooked, act.data.viewed], [[], []]);
});

// === retention PR 5: the Sunday table ============================================================

const NIA = "88888888-8888-4888-8888-888888888888";
const asNia = { "x-family-code": CODE, "x-profile-id": NIA };

t("PR 5: GET /table: Nia cooks Mom's dish & Mom answers -> 1 week, both lit; only Nia's own pairs", async () => {
  tables.profiles.push({ id: NIA, family_id: FAM, name: "Nia", role: "learner", relation: null, avatar_key: null, sort: 4, removed_at: null, email: null });
  // A minute ago: this week, unless the test runs in the first minute of a Monday in Los Angeles.
  const secsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  tableActivity = [
    { at: secsAgo(60), actor_id: NIA, kind: "cooked", target_cook_id: MOM },
    { at: secsAgo(30), actor_id: MOM, kind: "message", thread_with: NIA },
  ];
  const r = await call("GET", "/table", { headers: asNia });
  assertEquals(r.status, 200);
  assertEquals(r.data.people.filter((p: Row) => p.lit).map((p: Row) => p.profile_id).sort(), [MOM, NIA].sort());
  assertEquals(r.data.pairs.map((p: Row) => [p.kid_id, p.cook_id, p.weeks, p.lit_this_week]), [[NIA, MOM, 1, true], [NIA, DAD, 0, false]]);
  // A cook sees only the pairs they're in; no one picked (lenient): faces only.
  assertEquals((await call("GET", "/table", { headers: asMom })).data.pairs.map((p: Row) => p.kid_id), [NIA]);
  const none = await call("GET", "/table", { headers: { "x-family-code": CODE } });
  assertEquals([none.status, none.data.pairs], [200, []]);
  assertEquals(none.data.people.some((p: Row) => p.profile_id === SAM), false, "removed people aren't at the table");
});

t("PR 5: GET /table lists the dishes this family's own recordings became (the I miss home pool)", async () => {
  tables.profiles.push({ id: NIA, family_id: FAM, name: "Nia", role: "learner", relation: null, avatar_key: null, sort: 4, removed_at: null, email: null });
  tables.pending_sends.push(
    { job_id: "job-dal", family_id: FAM, sender_id: NIA, recipient_ids: [], delivered_at: ago(2), recipe_id: "mom-dal" },
    { job_id: "job-wait", family_id: FAM, sender_id: MOM, recipient_ids: [NIA], delivered_at: null, recipe_id: null },
    { job_id: "job-other", family_id: "99999999-9999-4999-8999-999999999999", sender_id: MOM, recipient_ids: [], delivered_at: ago(1), recipe_id: "dad-fried-rice" },
  );
  const r = await call("GET", "/table", { headers: asNia });
  assertEquals([r.status, r.data.recordings], [200, ["mom-dal"]]);
});

t("PR 5: a memorial cook keeps a face, never lit, and has no pair", async () => {
  // Guardrail 2: no count with someone who has died, and nothing that addresses them as present.
  tables.profiles.push({ id: NIA, family_id: FAM, name: "Nia", role: "learner", relation: null, avatar_key: null, sort: 4, removed_at: null, email: null });
  tables.profiles.find((p) => p.id === DAD)!.memorial = true;
  const secsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  tableActivity = [
    { at: secsAgo(90), actor_id: NIA, kind: "heard", target_cook_id: DAD, duration_s: 12 },
    { at: secsAgo(60), actor_id: DAD, kind: "message", thread_with: NIA },
  ];
  const r = await call("GET", "/table", { headers: asNia });
  assertEquals(r.status, 200);
  assertEquals(r.data.people.find((p: Row) => p.profile_id === DAD)?.lit, false, "a memorial face stays, never lit");
  assertEquals(r.data.pairs.some((p: Row) => p.cook_id === DAD), false, "no pair count with a memorial cook");
});

// === retention PR 6: month in the kitchen ========================================================

/**
 * Runs `fn` with Date (and Date.now) moved to `iso` and ticking from there; timers stay real. The first
 * edition is November 2026 (recapPr.ts FIRST_MONTH), so a month with something in it needs a clock
 * from November on.
 */
async function atClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const Real = Date;
  const shift = Real.parse(iso) - Real.now();
  class Shifted extends Real {
    // deno-lint-ignore no-explicit-any
    constructor(...a: any[]) {
      // deno-lint-ignore no-explicit-any
      if (a.length) super(...(a as [any]));
      else super(Real.now() + shift);
    }
    static override now() {
      return Real.now() + shift;
    }
  }
  globalThis.Date = Shifted as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = Real;
  }
}

t("PR 6: GET /recap is registered: a person, a well-formed month; a month that can't hold anything is empty", async () => {
  const bad = await call("GET", "/recap?month=2026-13", { headers: asMom });
  assertEquals([bad.status, bad.data.error], [400, "month must be YYYY-MM"]);
  const future = await call("GET", "/recap?month=2099-01", { headers: asMom });
  assertEquals([future.status, future.data], [200, { empty: true }]);
  // October 2026 comes before the first edition (November): empty, whatever happened in it.
  const october = await call("GET", "/recap?month=2026-10", { headers: asMom });
  assertEquals([october.status, october.data], [200, { empty: true }]);
  const nobody = await call("GET", "/recap?month=2026-10", { headers: { "x-family-code": CODE } });
  assertEquals([nobody.status, nobody.data.error], [400, "x-profile-id header is required for this request"]);
});

t("PR 6: the first edition through index.ts's deps: on Dec 1, Dad's November names Leo, signs the postcard & counts his answer", async () => {
  // Nov 20: Leo cooks Dad's fried rice with a photo postcard and asks Dad a question; Dad answers it.
  const leo = await atClock("2026-11-20T19:00:00Z", async () => {
    const leo = await learner("Leo");
    const pair = (await call("POST", "/threads", { headers: leo.as, body: { other_id: DAD } })).data.id;
    assertEquals((await call("POST", "/events", { headers: leo.as, body: { recipe_id: "dad-fried-rice", kind: "cooked" } })).data.counted, true);
    const up = await call("POST", "/photo-upload", { headers: leo.as, body: { content_type: "image/jpeg" } });
    stored.add(`photos/${up.data.path}`);
    const card = await call("POST", `/threads/${pair}/messages`, {
      headers: leo.as, body: { kind: "cooked", recipe_id: "dad-fried-rice", photo_path: up.data.path },
    });
    assertEquals(card.status, 200, JSON.stringify(card.data));
    const q = await call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "question", body: "Day-old rice?", recipe_id: "dad-fried-rice" } });
    const a = await call("POST", `/threads/${pair}/messages`, { headers: asDadByCode, body: { kind: "text", body: "Always.", reply_to: q.data.id } });
    assertEquals([q.status, a.status], [200, 200]);
    return leo;
  });
  assertEquals(tables.recipe_events.filter((e) => e.kind === "cooked").map((e) => e.created_at.slice(0, 10)), ["2026-11-20"]);

  // Dec 1, 10:15 on Dad's clock (no zone stored: the default, Los Angeles): no month = last month.
  const r = await atClock("2026-12-01T18:15:00Z", () => call("GET", "/recap", { headers: asDadByCode }));
  assertEquals([r.status, r.data.role, r.data.month], [200, "cook", "2026-11"], JSON.stringify(r.data));
  assertEquals((r.data.slides as Row[])[0].title, "Your November in the kitchen");
  const slide = (type: string) => (r.data.slides as Row[]).find((s) => s.type === type);
  assertEquals(slide("dishes_cooked")?.faces, [{ profile_id: leo.id }]);
  // signPhotos: the postcard comes back as a 1-hour signed URL from the private bucket, never its path.
  const photos = slide("postcards")?.photos as Row[];
  assertEquals(photos.length, 1);
  assertMatch(String(photos[0].photo_url), /\/storage\/v1\/object\/sign\/photos\//);
  assertEquals("photo_path" in photos[0], false);
  // answersFor over the whole family (familyCtx): Dad's reply answers Leo's question.
  assertEquals([slide("answered")?.value, slide("answered")?.title], [1, "Questions you answered: 1"]);
  assertEquals([(r.data.slides as Row[])[0].type, (r.data.slides as Row[]).at(-1)!.type], ["cover", "close"]);
});

// === retention PR 3: Send it home, get one back =================================================

/** A photo that went up through /photo-upload (its PUT stands in as a stored object). */
async function uploadedPhoto(headers: Record<string, string>): Promise<string> {
  const up = await call("POST", "/photo-upload", { headers, body: { content_type: "image/jpeg" } });
  assertEquals(up.status, 200, JSON.stringify(up.data));
  stored.add(`photos/${up.data.path}`);
  return up.data.path as string;
}

t("PR 3: the postcard goes on my own cooked message: photo & rating, one push to the dish's cook; again replaces", async () => {
  const leo = await learner("Leo");
  tables.push_tokens.push(tokenFor(DAD, 1), tokenFor(MOM, 2), tokenFor(leo.id, 3));
  const pair = (await call("POST", "/threads", { headers: leo.as, body: { other_id: DAD } })).data.id;
  const made = await call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "dad-sunday-chili" } });
  assertEquals([made.status, made.data.photo_url, made.data.rating], [200, null, null]);
  await backgroundIdle();
  assertEquals(pushed.length, 0, "a cooked message alone pushes nobody");

  // Sent before the PUT landed: refused, nothing changed.
  const up = await call("POST", "/photo-upload", { headers: leo.as, body: { content_type: "image/jpeg" } });
  const early = await call("POST", `/messages/${made.data.id}/postcard`, { headers: leo.as, body: { photo_path: up.data.path } });
  assertEquals([early.status, early.data.error], [400, "Upload the photo before sending it"]);
  stored.add(`photos/${up.data.path}`);

  const card = await call("POST", `/messages/${made.data.id}/postcard`, { headers: leo.as, body: { photo_path: up.data.path, rating: 4 } });
  assertEquals(card.status, 200, JSON.stringify(card.data));
  assertEquals([card.data.id, card.data.kind, card.data.rating, card.data.thread_id], [made.data.id, "cooked", 4, pair]);
  assertMatch(card.data.photo_url, /\/storage\/v1\/object\/sign\/photos\//);
  assertEquals("photo_path" in card.data, false, "the path never leaves the server");
  await backgroundIdle();
  assertEquals(pushes(), [["ExponentPushToken[t1]", "Leo made your Sunday Chili", "Sent you a postcard.", "/parent/home"]]);
  assertEquals(
    tables.notification_log.map((r) => [r.profile_id, r.kind, r.app_initiated, r.dedupe_key]),
    [[DAD, "postcard", false, `postcard:${made.data.id}`]],
  );

  // "Take another": a new photo and no rating replace both; still one card, still one push.
  const again = await uploadedPhoto(leo.as);
  const second = await call("POST", `/messages/${made.data.id}/postcard`, { headers: leo.as, body: { photo_path: again } });
  assertEquals([second.status, second.data.rating], [200, null]);
  assertMatch(second.data.photo_url, new RegExp(again.split("/")[1]));
  await backgroundIdle();
  assertEquals(pushed.length, 1);
  assertEquals(tables.messages.filter((m) => m.kind === "cooked").length, 1, "one card per dish made");

  // Dad reads it in the chat and in his inbox's `last` (what his Home's updates card keys on).
  const read = await call("GET", `/threads/${pair}/messages`, { headers: asDadByCode });
  assertEquals((read.data as Row[]).map((m) => [m.kind, !!m.photo_url, m.rating]), [["cooked", true, null]]);
  const inbox = await call("GET", "/threads", { headers: asDadByCode });
  const row = (inbox.data as Row[]).find((x) => x.id === pair)!;
  assertEquals([row.last.id, !!row.last.photo_url, row.postcards], [made.data.id, true, 1]);

  // Dad answers with "Just like mine" and a voice note held down on the card (reply_to the cooked
  // message): both reach Leo; the voice note answers no question and is saved to no recipe.
  pushed = [];
  const jlm = await call("POST", `/threads/${pair}/messages`, {
    headers: asDadByCode, body: { kind: "reaction", body: "just_like_mine", reply_to: made.data.id, recipe_id: "dad-sunday-chili" },
  });
  assertEquals(jlm.status, 200, JSON.stringify(jlm.data));
  const vup = await call("POST", "/voice-upload", { headers: asDadByCode, body: { content_type: "audio/m4a" } });
  stored.add(`voice/${vup.data.path}`);
  const voice = await call("POST", `/threads/${pair}/messages`, {
    headers: asDadByCode, body: { kind: "voice", audio_path: vup.data.path, duration_s: 5, reply_to: made.data.id },
  });
  assertEquals([voice.status, voice.data.reply_to, voice.data.saved_to_recipe], [200, made.data.id, false]);
  await backgroundIdle();
  assertEquals(pushes().map((x) => [x[0], x[1], x[2]]), [
    ["ExponentPushToken[t3]", "Dad", "“Just like mine.” on your Sunday Chili"],
    ["ExponentPushToken[t3]", "Dad", "Sent a voice note · 0:05"],
  ]);
});

t("PR 3: only my own cooked message, a photo of ours, a rating of 1-5; never after the cook left", async () => {
  const leo = await learner("Leo");
  const pair = (await call("POST", "/threads", { headers: leo.as, body: { other_id: DAD } })).data.id;
  const made = await call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "dad-sunday-chili" } });
  const text = await call("POST", `/threads/${pair}/messages`, { headers: leo.as, body: { kind: "text", body: "So good" } });
  const photo = await uploadedPhoto(leo.as);
  const post = (id: string, body: Row, headers: Record<string, string> = leo.as) => call("POST", `/messages/${id}/postcard`, { headers, body });

  assertEquals((await post(made.data.id, { photo_path: photo }, asDadByCode)).data.error, "Only whoever made the dish can send its postcard");
  assertEquals((await post(made.data.id, { photo_path: photo }, asDadByCode)).status, 403);
  assertEquals(await post(text.data.id, { photo_path: photo }).then((r) => [r.status, r.data.error]), [400, "A postcard goes on a dish you made"]);
  assertEquals((await post(made.data.id, {})).data.error, "photo_path is required");
  for (const rating of [0, 6, 2.5, "4", true]) {
    const r = await post(made.data.id, { photo_path: photo, rating });
    assertEquals([r.status, r.data.error], [400, "rating must be a whole number from 1 to 5"], JSON.stringify(rating));
  }
  for (const bad of [`${FAM}/nope.jpg`, photo.replace(FAM, MOM), photo.replace(".jpg", ".m4a")]) {
    assertEquals((await post(made.data.id, { photo_path: bad })).data.error, "photo_path must be a path returned by /photo-upload");
  }
  assertEquals((await post("not-a-message", { photo_path: photo })).status, 404);
  assertEquals((await post(crypto.randomUUID(), { photo_path: photo })).data.error, "No such message");
  // Another family's message reads as no message at all.
  const foreign = crypto.randomUUID();
  tables.messages.push({ ...tables.messages.find((m) => m.id === made.data.id)!, id: foreign, family_id: crypto.randomUUID() });
  assertEquals((await post(foreign, { photo_path: photo })).status, 404);
  assertEquals((await post(made.data.id, { photo_path: photo }, { "x-family-code": CODE })).data.error, "x-profile-id header is required for this request");
  rateDeny.add("postcard");
  assertEquals((await post(made.data.id, { photo_path: photo })).status, 429);
  rateDeny.delete("postcard");
  // Nothing above wrote anything.
  assertEquals([tables.messages.find((m) => m.id === made.data.id)!.photo_path ?? null, tables.notification_log.length], [null, 0]);

  // The cook left the family: the 1:1 is read-only, postcard included.
  tables.profiles.find((p) => p.id === DAD)!.removed_at = new Date().toISOString();
  const gone = await post(made.data.id, { photo_path: photo });
  assertEquals([gone.status, gone.data.error], [403, "Dad isn't in the family anymore."]);
});

t("PR 3: the push names only the dish's cook: in the circle by name, never someone else's 1:1", async () => {
  const leo = await learner("Leo");
  tables.push_tokens.push(tokenFor(DAD, 1), tokenFor(MOM, 2));
  // A card about Dad's chili in the family circle (older builds): Dad, by the name on the dish.
  const circle = await circleId();
  const inCircle = await call("POST", `/threads/${circle}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "dad-sunday-chili" } });
  // Dad writes before the photo lands, so the card is no longer the circle's newest message.
  const reply = await call("POST", `/threads/${circle}/messages`, { headers: asDadByCode, body: { kind: "text", body: "Looks so good" } });
  await backgroundIdle();
  pushed = [];
  const a = await call("POST", `/messages/${inCircle.data.id}/postcard`, { headers: leo.as, body: { photo_path: await uploadedPhoto(leo.as), rating: 5 } });
  assertEquals(a.status, 200, JSON.stringify(a.data));
  await backgroundIdle();
  assertEquals(pushes().map((x) => [x[0], x[1]]), [["ExponentPushToken[t1]", "Leo made your Sunday Chili"]]);

  // `last` stays Dad's text; the postcard count is what tells his Home to look again.
  const inbox = await call("GET", "/threads", { headers: asDadByCode });
  const circleRow = (inbox.data as Row[]).find((x) => x.kind === "circle")!;
  assertEquals([circleRow.last.id, circleRow.postcards], [reply.data.id, 1]);

  // A card about Dad's chili in Leo's 1:1 with Mom: Mom isn't its cook, so nobody is told "your".
  pushed = [];
  const withMom = (await call("POST", "/threads", { headers: leo.as, body: { other_id: MOM } })).data.id;
  const wrong = await call("POST", `/threads/${withMom}/messages`, { headers: leo.as, body: { kind: "cooked", recipe_id: "dad-sunday-chili" } });
  const b = await call("POST", `/messages/${wrong.data.id}/postcard`, { headers: leo.as, body: { photo_path: await uploadedPhoto(leo.as) } });
  assertEquals(b.status, 200);
  await backgroundIdle();
  assertEquals(pushed.length, 0);
});

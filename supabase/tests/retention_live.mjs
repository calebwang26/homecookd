// Live check of the retention routes (PRs 1-6 and PR 3's postcard) against the deployed api, on the
// TEST family only. Run it right after a deploy (docs/build/RETENTION-WIRING.md section 6, step 6).
// Dependency-free (Node 20+). Prints PASS / FAIL / SKIP lines and a count; exits 1 on any FAIL.
// Never prints the family code, device keys or push tokens.
//
//   node supabase/tests/retention_live.mjs
//   API_URL=https://<project>.supabase.co/functions/v1/api CODE_FILE=<path> node supabase/tests/retention_live.mjs
//
// It mints one device key (a "phone") from the family code and acts on it as a free kid (no phone of
// their own, not only invited). Its first write makes the key that kid's phone; revoking it at the end
// frees them again. The same key is lent to a free cook for the cook's reads and the cook's reaction.
// DB-level checks (notification_log, token pruning, profiles.tz, the cron with the real secret,
// cron.job) are done by hand: RETENTION-WIRING.md section 6.
//
// What it leaves behind (no API deletes these): in the kid & cook's 1:1, one `cooked` message
// ("Retention live test") and the cook's "Just like mine" stamp on it; one `heard` recipe_events row
// (it lights the kid's face at this week's table); the kid's profiles.tz = America/Los_Angeles. If the
// kid already said yes to sharing cook mode, also one `started` event and a "… is making your …" push
// to the cook (the session itself is ended). The bogus push token is removed and the key revoked.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.API_URL || "https://qeiednrjkiyzbolkepbk.supabase.co/functions/v1/api").replace(/\/+$/, "");
// Like two_sided_live.mjs: the gitignored code file in this checkout (copy it into a worktree, or set CODE_FILE).
const here = dirname(fileURLToPath(import.meta.url));
const CODE_FILE = process.env.CODE_FILE || join(here, "../../docs/build/.test-family-code");
// The public library the api reads (index.ts BUCKET_URL): only to pick a dish that is the cook's.
const LIBRARY_URL = process.env.LIBRARY_URL || "https://storage.googleapis.com/edible-media-379797517579/library.json";
const LA = "America/Los_Angeles";
const TOKEN = "ExponentPushToken[retention-test-0001]";
const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const SIGNED_OUT = "This phone was signed out.";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

let CODE = "";
try {
  CODE = readFileSync(CODE_FILE, "utf8").trim();
} catch {
  // reported as the first FAIL
}

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name, ok, got) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${got ? ` (${got})` : ""}`);
  }
  return ok;
}
function skip(name, why) {
  skipped++;
  console.log(`SKIP ${name} (${why})`);
}
/** What a failure line may show: the status and the server's human sentence, nothing else. */
const seen = (r) => `got ${r.status}${r.data?.error ? `: ${r.data.error}` : ""}`;

async function call(method, path, { body, code, key, me, tz, secret } = {}) {
  const headers = {};
  if (code) headers["x-family-code"] = code;
  if (key) headers["x-device-key"] = key;
  if (me) headers["x-profile-id"] = me;
  if (tz) headers["x-tz"] = tz;
  if (secret !== undefined) headers["x-cron-secret"] = secret;
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  try {
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, headers: res.headers };
  } catch (e) {
    return { status: 0, data: { error: `network: ${e.message}` }, headers: new Headers() };
  }
}

/** library.json as id -> cook_name; empty when it can't be read (dish-matched checks then skip). */
async function loadLibrary() {
  try {
    const res = await fetch(LIBRARY_URL);
    const list = res.ok ? await res.json() : [];
    return new Map(list.filter((e) => typeof e?.id === "string").map((e) => [e.id, e.cook_name ?? ""]));
  } catch {
    return new Map();
  }
}

/** This week's Monday ('YYYY-MM-DD') in `tz`, as GET /table counts the week. */
function mondayIn(tz, now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

const made = { keys: [], tokenKey: null, cooking: null };

async function run() {
  // Safety: this must be the test family, never the demo family.
  if (!check("test family code file is readable (CODE_FILE)", !!CODE)) return;
  const fam0 = await call("GET", "/family", { code: CODE });
  if (!check("test family code opens a family", fam0.status === 200, seen(fam0))) return;
  if (!check("it is not the demo family", fam0.data.family.name !== "Our family", "refusing to write to Our family")) return;

  // A cook whose dish is in the library (for /cooking & /dish-stats) and a kid, both free: no phone of
  // their own (else 403) and not only invited (else no writes), never a memorial cook.
  const norm = (s) => (s ?? "").trim().toLowerCase();
  const lib = await loadLibrary();
  const dishesOf = (name) => [...lib].filter(([, c]) => norm(c) === norm(name)).map(([id]) => id);
  const free = (p) => !p.locked && !p.invited && p.memorial !== true;
  const people = fam0.data.profiles;
  const cooks = people.filter((p) => p.role === "cook" && free(p));
  const cook = cooks.find((p) => dishesOf(p.name).length) ?? cooks[0];
  const kid = people.find((p) => p.role === "learner" && free(p)) ?? people.find((p) => free(p) && p.id !== cook?.id);
  if (!check("test family has a free cook and a free kid (no phone, not only invited)", !!cook && !!kid)) return;
  const cookDishes = dishesOf(cook.name).slice(0, 50);
  const noDish = `no library dish is ${cook.name}'s`;
  const dish = cookDishes[0] ?? [...lib.keys()][0] ?? "dad-sunday-chili";

  const dev = await call("POST", "/devices", { code: CODE, body: { device_label: "Retention live test" } });
  const key = dev.data?.device_key;
  if (key) made.keys.push(key);
  if (!check("POST /devices returns a key", dev.status === 200 && KEY_SHAPE.test(key ?? ""), seen(dev))) return;
  const asKid = { key, me: kid.id, tz: LA };
  const asCook = { key, me: cook.id };

  // 1. Push tokens. The first write as the kid makes this key the kid's phone, so the token is theirs.
  const reg = await call("POST", "/push-tokens", { ...asKid, body: { token: TOKEN, platform: "ios" } });
  if (reg.status === 200) made.tokenKey = key;
  check("POST /push-tokens (bogus token, as the kid): {ok: true}", reg.status === 200 && reg.data?.ok === true, seen(reg));
  const famK = await call("GET", "/family", { key });
  check("...and the key is now the kid's phone", famK.data?.device_profile_id === kid.id, seen(famK));
  const reg2 = await call("POST", "/push-tokens", { ...asKid, tz: "Not/A_Zone", body: { token: TOKEN, platform: "ios" } });
  check("POST /push-tokens again (upsert), with a bad x-tz: {ok: true}", reg2.status === 200 && reg2.data?.ok === true, seen(reg2));
  const junk = await call("POST", "/push-tokens", { ...asKid, body: { token: "ExponentPushToken[]", platform: "ios" } });
  check("malformed token: 400 'token must be an Expo push token'", junk.status === 400 && junk.data?.error === "token must be an Expo push token", seen(junk));
  const plat = await call("POST", "/push-tokens", { ...asKid, body: { token: TOKEN, platform: "web" } });
  check("bad platform: 400 'platform must be ios or android'", plat.status === 400 && plat.data?.error === "platform must be ios or android", seen(plat));
  const rm = await call("POST", "/push-tokens/remove", { key, body: { token: TOKEN } });
  if (rm.status === 200) made.tokenKey = null;
  check("POST /push-tokens/remove (no x-profile-id): {ok: true}", rm.status === 200 && rm.data?.ok === true, seen(rm));
  const rmJunk = await call("POST", "/push-tokens/remove", { key, body: { token: "not-a-token" } });
  check("remove a malformed token: 400", rmJunk.status === 400 && rmJunk.data?.error === "token must be an Expo push token", seen(rmJunk));

  // 2. x-tz: allowed by CORS, stored best effort, and a bad one never breaks a call.
  const pre = await call("OPTIONS", "/family");
  const allowed = (pre.headers.get("access-control-allow-headers") ?? "").split(",").map((s) => s.trim().toLowerCase());
  check("CORS preflight allows x-tz", pre.status >= 200 && pre.status < 300 && allowed.includes("x-tz"), `got ${pre.status}`);
  const tzOk = await call("GET", "/family", asKid);
  check("GET /family with x-tz America/Los_Angeles: 200", tzOk.status === 200, seen(tzOk));
  for (const [label, tz] of [["unknown zone", "Mars/Olympus_Mons"], ["path-like", "../../etc/passwd"], ["300 chars", "x".repeat(300)]]) {
    const r = await call("GET", "/family", { ...asKid, tz });
    check(`GET /family with a bad x-tz (${label}): still 200`, r.status === 200, seen(r));
  }

  // 3. POST /events heard: counted at >= 3 s; the same clip within 5 s counts once; 1 s is refused.
  const clip = 1000 + Math.floor(Math.random() * 80000); // a fresh clip, so a re-run never reads as a double
  const heard = { recipe_id: dish, kind: "heard", cook_id: cook.id, duration_s: 5, start_s: clip };
  const h1 = await call("POST", "/events", { ...asKid, body: heard });
  check("POST /events heard 5 s + cook_id: {ok, counted: true}", h1.status === 200 && h1.data?.ok === true && h1.data?.counted === true, seen(h1));
  const h2 = await call("POST", "/events", { ...asKid, body: heard });
  check("...the same clip again within 5 s: counted false", h2.status === 200 && h2.data?.counted === false, seen(h2));
  const h3 = await call("POST", "/events", { ...asKid, body: { ...heard, duration_s: 1, start_s: clip + 1 } });
  check("heard 1 s: 400 'duration_s must be at least 3 for heard' (never counted)",
    h3.status === 400 && h3.data?.error === "duration_s must be at least 3 for heard", seen(h3));

  // 4. The hourly cron refuses anyone without the secret (checked by the database).
  const c1 = await call("POST", "/cron/hourly", { body: {} });
  check("POST /cron/hourly with no secret: 401 'Not allowed'", c1.status === 401 && c1.data?.error === "Not allowed", seen(c1));
  const c2 = await call("POST", "/cron/hourly", { secret: `wrong-${randomUUID()}`, body: { now: "2026-10-25T17:10:00-07:00" } });
  check("...with a wrong secret (and a now): 401", c2.status === 401 && c2.data?.error === "Not allowed", seen(c2));

  // 5. The reads: GET /table, /dish-stats, /hearts/recent, /recap.
  const members = (famK.data?.profiles ?? people).map((p) => p.id);
  const tb = await call("GET", "/table", asKid);
  const t = tb.data;
  const tableOk = tb.status === 200 && DAY.test(t?.week_start ?? "") && Array.isArray(t.people) && Array.isArray(t.pairs) && Array.isArray(t.recordings);
  if (check("GET /table: {week_start, people, pairs, recordings}", tableOk, seen(tb))) {
    check("...people: every current member, each {profile_id, lit}",
      t.people.every((p) => typeof p.profile_id === "string" && typeof p.lit === "boolean") &&
        members.every((id) => t.people.some((p) => p.profile_id === id)));
    const pairOk = (p) =>
      typeof p.kid_id === "string" && typeof p.cook_id === "string" && (p.weeks === null || Number.isInteger(p.weeks)) &&
      (p.ember_until === null || typeof p.ember_until === "string") && typeof p.lit_this_week === "boolean";
    check("...pairs: documented shape, only the caller's", t.pairs.every((p) => pairOk(p) && (p.kid_id === kid.id || p.cook_id === kid.id)));
    check("...recordings: sorted recipe ids", t.recordings.every((s) => typeof s === "string") && t.recordings.join() === [...t.recordings].sort().join());
    if (kid.role === "learner") check("...week_start is this week's Monday in x-tz", t.week_start === mondayIn(LA), `got ${t.week_start}`);
  }
  const tbNone = await call("GET", "/table", { key, tz: LA });
  check("GET /table with no x-profile-id: 200, no pairs", tbNone.status === 200 && tbNone.data?.pairs?.length === 0, seen(tbNone));
  const tbBad = await call("GET", "/table", { ...asKid, tz: "Not/A_Zone" });
  check("GET /table with a bad x-tz: still 200", tbBad.status === 200, seen(tbBad));

  const statOk = (s) => Number.isInteger(s?.hearts?.count) && Array.isArray(s.hearts.by) && Number.isInteger(s?.cooked?.count) && Array.isArray(s.cooked.by);
  if (cookDishes.length) {
    const q = `/dish-stats?ids=${cookDishes.join(",")}`;
    const ds = await call("GET", q, asCook);
    check("GET /dish-stats as the dish's cook: every id, {hearts, cooked}", ds.status === 200 && cookDishes.every((id) => statOk(ds.data?.[id])), seen(ds));
    const dsKid = await call("GET", q, asKid);
    check("...someone else's dishes are left out ({} for the kid)", dsKid.status === 200 && Object.keys(dsKid.data ?? { x: 1 }).length === 0, seen(dsKid));
  } else skip("GET /dish-stats as the dish's cook", noDish);
  const dsNone = await call("GET", "/dish-stats", asCook);
  check("GET /dish-stats with no ids: 400 'ids is required'", dsNone.status === 400 && dsNone.data?.error === "ids is required", seen(dsNone));
  const hr = await call("GET", "/hearts/recent", asCook);
  const heartOk = (h) => typeof h?.profile_id === "string" && typeof h.recipe_id === "string" && typeof h.at === "string";
  const theirs = new Set(dishesOf(cook.name));
  check("GET /hearts/recent as the cook: [{profile_id, recipe_id, at}], <= 20, only their dishes",
    hr.status === 200 && Array.isArray(hr.data) && hr.data.length <= 20 && hr.data.every(heartOk) &&
      (!lib.size || hr.data.every((h) => theirs.has(h.recipe_id))), seen(hr));
  const hrBad = await call("GET", "/hearts/recent?since=yesterday", asCook);
  check("GET /hearts/recent?since=yesterday: 400 'since must be an ISO time'", hrBad.status === 400 && hrBad.data?.error === "since must be an ISO time", seen(hrBad));

  const rc = await call("GET", "/recap", asKid);
  const recapOk = (d) =>
    d?.empty === true ||
    (/^\d{4}-\d{2}$/.test(d?.month ?? "") && ["cook", "learner"].includes(d.role) && Array.isArray(d.slides) &&
      d.slides.every((s) => typeof s?.type === "string" && typeof s.title === "string"));
  check("GET /recap: {empty: true} or {month, role, slides}", rc.status === 200 && recapOk(rc.data), seen(rc));
  const rcBad = await call("GET", "/recap?month=last-month", asKid);
  check("GET /recap?month=last-month: 400 'month must be YYYY-MM'", rcBad.status === 400 && rcBad.data?.error === "month must be YYYY-MM", seen(rcBad));
  const rcNoMe = await call("GET", "/recap", { key });
  check("GET /recap with no x-profile-id: 400", rcNoMe.status === 400, seen(rcNoMe));

  // 6. Cook mode. share_cooking is never written here (no API sets it back to null).
  const sc = await call("GET", "/profile/share-cooking", asKid);
  const share = sc.data?.share_cooking;
  check("GET /profile/share-cooking: {share_cooking: true | false | null}", sc.status === 200 && [true, false, null].includes(share), seen(sc));
  if (cookDishes.length) {
    made.cooking = { key, me: kid.id, recipe_id: dish };
    const ck = await call("POST", "/cooking", { ...asKid, body: { recipe_id: dish, cook_id: cook.id, step: 1, total: 3 } });
    const d = ck.data ?? {};
    check("POST /cooking: {ok, shared, consent, started_at, new_session}",
      ck.status === 200 && d.ok === true && typeof d.shared === "boolean" && ["yes", "no", "unasked"].includes(d.consent) &&
        (d.started_at === null || typeof d.started_at === "string") && typeof d.new_session === "boolean", seen(ck));
    const want = d.memorial ? "no" : share === true ? "yes" : share === false ? "no" : "unasked";
    const sharedOk = d.consent === "yes"
      ? d.shared === true && typeof d.started_at === "string"
      : d.shared === false && d.started_at === null && d.new_session === false;
    check("...consent matches the kid's answer; nothing is shared without a yes", ck.status === 200 && d.consent === want && sharedOk,
      `consent ${d.consent}, shared ${d.shared}`);
    const end = await call("POST", "/cooking/end", { ...asKid, body: { recipe_id: dish } });
    if (end.status === 200) made.cooking = null;
    check("POST /cooking/end {recipe_id}: {ok: true}", end.status === 200 && end.data?.ok === true, seen(end));
    const live = await call("GET", "/cooking", asCook);
    check("...and GET /cooking (as the cook) has no live session from the kid",
      live.status === 200 && Array.isArray(live.data) && !live.data.some((r) => r.profile?.id === kid.id), seen(live));
  } else skip("POST /cooking + /cooking/end", noDish);
  const self = await call("POST", "/cooking", { ...asKid, body: { recipe_id: dish, cook_id: kid.id, step: 1, total: 3 } });
  check("POST /cooking naming yourself as the cook: 400", self.status === 400 && self.data?.error === "cook_id must be someone else in your family", seen(self));

  // 7. The postcard (PR 3) goes only on the caller's own cooked message, with a photo from /photo-upload.
  const probe = await call("POST", `/messages/${randomUUID()}/postcard`, { ...asKid, body: {} });
  const postcardLive = !(probe.status === 404 && /^No route for /.test(probe.data?.error ?? ""));
  if (postcardLive) {
    check("POST /messages/<unknown id>/postcard: 404 'No such message'", probe.status === 404 && probe.data?.error === "No such message", seen(probe));
  } else skip("POST /messages/:id/postcard", "route not deployed");
  const pair = await call("POST", "/threads", { ...asKid, body: { other_id: cook.id } });
  const pid = pair.data?.id;
  if (!check("POST /threads: the kid & cook's 1:1", pair.status === 200 && !!pid, seen(pair))) return;
  const cookedR = await call("POST", `/threads/${pid}/messages`, { ...asKid, body: { kind: "cooked", recipe_id: dish, body: "Retention live test" } });
  const cooked = cookedR.data;
  if (!check("the kid sends a cooked message there", cookedR.status === 200 && cooked?.kind === "cooked" && !!cooked.id, seen(cookedR))) return;
  if (postcardLive) {
    const pc = (who, body) => call("POST", `/messages/${cooked.id}/postcard`, { ...who, body });
    const BAD_PATH = "photo_path must be a path returned by /photo-upload";
    const wellFormed = `${fam0.data.family.id}/${randomUUID()}.jpg`;
    const other = await pc(asCook, { photo_path: wellFormed });
    check("postcard on someone else's cooked message: 403 (never 200)",
      other.status === 403 && other.data?.error === "Only whoever made the dish can send its postcard", seen(other));
    const badPath = await pc(asKid, { photo_path: "../not/a/photo.jpg" });
    check("postcard with a bad photo_path: 400", badPath.status === 400 && badPath.data?.error === BAD_PATH, seen(badPath));
    const foreign = await pc(asKid, { photo_path: `${randomUUID()}/${randomUUID()}.jpg` });
    check("...another family's photo_path: 400", foreign.status === 400 && foreign.data?.error === BAD_PATH, seen(foreign));
    const none = await pc(asKid, {});
    check("...no photo_path: 400 'photo_path is required'", none.status === 400 && none.data?.error === "photo_path is required", seen(none));
    const notUp = await pc(asKid, { photo_path: wellFormed, rating: 4 });
    check("...a photo never uploaded: 400 'Upload the photo before sending it'",
      notUp.status === 400 && notUp.data?.error === "Upload the photo before sending it", seen(notUp));
  }

  // 8. A reaction is a stamp under the dish: never the inbox headline, never unread.
  const jlm = { kind: "reaction", body: "just_like_mine", reply_to: cooked.id, recipe_id: dish };
  const r1 = await call("POST", `/threads/${pid}/messages`, { ...asCook, body: jlm });
  check("the cook's 'Just like mine' on it (reply_to the cooked message)", r1.status === 200 && r1.data?.kind === "reaction" && r1.data?.reply_to === cooked.id, seen(r1));
  const r2 = await call("POST", `/threads/${pid}/messages`, { ...asCook, body: jlm });
  check("...sent twice, it's one stamp (same id)", r2.status === 200 && !!r1.data?.id && r2.data?.id === r1.data.id, seen(r2));
  const lone = await call("POST", `/threads/${pid}/messages`, { ...asCook, body: { kind: "reaction", body: "just_like_mine" } });
  check("'Just like mine' with no reply_to: 400", lone.status === 400 && lone.data?.error === "A reaction answers a dish someone made", seen(lone));
  const inKid = await call("GET", "/threads", asKid);
  const tk = inKid.data?.find?.((x) => x.id === pid);
  check("GET /threads (kid): the 1:1's last is the cooked message, not the reaction", tk?.last?.id === cooked.id, seen(inKid));
  check("...and the reaction isn't unread for the kid", tk?.unread === 0, `unread ${tk?.unread}`);
  const inCook = await call("GET", "/threads", asCook);
  check("GET /threads (cook, who reacted): last is still the cooked message", inCook.data?.find?.((x) => x.id === pid)?.last?.id === cooked.id, seen(inCook));
  const log = await call("GET", `/threads/${pid}/messages`, asKid);
  check("...while the chat log keeps the stamp", log.data?.some?.((m) => m.id === r1.data?.id && m.kind === "reaction"), seen(log));

  // Sign the phone out; the kid is free again.
  const rv = await call("POST", "/devices/revoke", { key });
  check("POST /devices/revoke", rv.status === 200, seen(rv));
  const dead = await call("GET", "/family", { key });
  check("revoked key: 401", dead.status === 401 && dead.data?.error === SIGNED_OUT, seen(dead));
  const famEnd = await call("GET", "/family", { code: CODE });
  check("...and the kid has no phone again", famEnd.data?.profiles?.find?.((p) => p.id === kid.id)?.has_phone === false, seen(famEnd));
}

async function cleanUp() {
  // While the key still works: drop the bogus token and any cook-mode session, then revoke every key.
  if (made.tokenKey) await call("POST", "/push-tokens/remove", { key: made.tokenKey, body: { token: TOKEN } });
  if (made.cooking) {
    const { key, me, recipe_id } = made.cooking;
    await call("POST", "/cooking/end", { key, me, body: { recipe_id } });
  }
  for (const key of made.keys) await call("POST", "/devices/revoke", { key }); // 401 when already revoked: fine
}

try {
  await run();
} catch (e) {
  check("live run finished", false, e.message);
} finally {
  await cleanUp();
}
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);

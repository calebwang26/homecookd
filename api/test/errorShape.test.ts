// One error shape on every route (docs/build/contracts/ERROR-CODES.md): each route family's refusals look the same, every 429 says when to come back,
// an unknown path is told apart from a missing row, and every code the api can send is in the app's checklist.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { subjectKey } from "../src/rateLimit.js";
import { Api, freshDatabase, hasDatabase, setup } from "./accountsHelpers.js";
import { bearer, family, person, session } from "./helpers.js";

const skip = !hasDatabase;
let api: Api;

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
  api = new Api();
});

after(async () => {
  if (!skip) await db().end();
});

const CODE = /^[a-z][a-z0-9_]*$/;
const TOKEN22 = "Zz".repeat(11);
const TOKEN43 = "Zz".repeat(21) + "Z";

/** Exactly `{error, message?, requestId}`: a code, maybe a sentence, and the id the response header carries. */
function oneShape(res: { status: number; data: Record<string, unknown>; headers: Record<string, unknown> }, what: string) {
  const { error, message, requestId, ...rest } = res.data;
  assert.match(String(error), CODE, `${what}: error is a code`);
  assert.ok(message === undefined || (typeof message === "string" && message.includes(" ")), `${what}: message is a sentence`);
  assert.equal(requestId, res.headers["x-request-id"], `${what}: requestId`);
  assert.deepEqual(rest, {}, `${what}: nothing else`);
}

test("a refusal from each route family has the one shape", { skip }, async () => {
  const fam = await family();
  const token = await session(fam, await person(fam));
  const cases: [string, () => ReturnType<Api["get"]>, number, string][] = [
    ["/v1 with no session", () => api.get("/v1/me"), 401, "signed_out"],
    ["/v1 row that isn't there", () => api.get("/v1/recipes/no-such-recipe", bearer(token)), 404, "not_found"],
    ["/dish unknown card", () => api.post("/dish/cards/get", { kidToken: TOKEN22 }), 404, "not_found"],
    ["/link/open unknown card", () => api.post("/link/open", { token: TOKEN22 }), 404, "not_found"],
    ["/invite/open unknown dinner", () => api.post("/invite/open", { token: TOKEN43, deviceId: TOKEN22 }), 404, "not_found"],
    ["family route with a dead key", () => api.get("/family", { "x-device-key": TOKEN43 }), 401, "signed_out"],
    ["family route with no key", () => api.post("/join-links", {}), 401, "signed_out"],
    ["sign-in with a bad token", () => api.apple({ id_token: "not-a-token" }), 401, "sign_in_failed"],
  ];
  for (const [what, call, status, code] of cases) {
    const res = await call();
    assert.deepEqual([res.status, res.data.error], [status, code], what);
    oneShape(res, what);
  }
  // `field` is the one extra a code may carry: `invalid` names what's wrong.
  const bad = await api.post("/dish/cards/get", {});
  assert.deepEqual([bad.status, bad.data.error, bad.data.field], [400, "invalid", "kidToken"]);
});

test("an unknown path is no_route, a missing row is not_found, under every prefix", { skip }, async () => {
  for (const url of ["/nothing", "/v1/nothing", "/dish/nothing", "/invite/nothing"]) {
    const res = await api.post(url, {});
    assert.deepEqual([res.status, res.data.error], [404, "no_route"], url);
    oneShape(res, url);
  }
  const fam = await family();
  const token = await session(fam, await person(fam));
  const row = await api.get("/v1/recipes/no-such-recipe", bearer(token));
  assert.deepEqual([row.status, row.data.error], [404, "not_found"], "a route that's there, with no such row");
});

/** Fills a limit's current window, so the next call is the one past it. The same key and window as rateLimit.ts's `hit`. */
async function filled(bucket: string, subject: string, max: number, windowS: number) {
  await db().query(
    `insert into rate_hits (key, window_start, count) values ($1, to_timestamp(floor(extract(epoch from now()) / $3) * $3), $2)
     on conflict (key, window_start) do update set count = $2`,
    [`${bucket}:${subjectKey(subject)}`, max, windowS],
  );
}

test("every 429 says when to come back, in the one shape", { skip }, async () => {
  const ip = "198.51.100.42";
  const cases: [string, string, number, () => ReturnType<Api["post"]>][] = [
    ["/v1 (a share link)", "share-open", 120, () => api.post("/v1/shares/open", { token: "x" }, {}, ip)],
    ["/dish (new cards)", "dish-cards", 6, () => api.post("/dish/cards", { dish: "poha" }, {}, ip)],
    ["/link/open", "link-open", 30, () => api.post("/link/open", { token: TOKEN22 }, {}, ip)],
    ["/invite/open", "invite-open", 120, () => api.post("/invite/open", { token: TOKEN43, deviceId: TOKEN22 }, {}, ip)],
    ["sign-in", "authid-ip", 30, () => api.apple({ id_token: "x" }, ip)],
    ["a family link's peek", "invitepeek-ip", 60, () => api.post("/invites/peek", { token: TOKEN22 }, {}, ip)],
  ];
  for (const [what, bucket, max, call] of cases) {
    await filled(bucket, ip, max, 600);
    const res = await call();
    assert.deepEqual([res.status, res.data.error], [429, "rate_limited"], what);
    assert.ok(Number(res.headers["retry-after"]) >= 1, `${what}: retry-after`);
    oneShape(res, what);
  }
});

/** Every code a route can send, read from the source: the code literal beside a status, and the helpers' own. */
function codesInSource(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  for (const file of walk(join(import.meta.dirname, "..", "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:ApiError|refused?|fail|DishFail)\(\s*\d{3},\s*"([a-z_]+)"/g)) found.add(m[1]);
  }
  // The helpers in errors.ts, which build their codes inside.
  for (const m of readFileSync(join(import.meta.dirname, "..", "src", "errors.ts"), "utf8").matchAll(/new ApiError\([^,]+, "([a-z_]+)"/g)) found.add(m[1]);
  return found;
}

test("every code the api sends is in ERROR-CODES.md, the app's checklist for its words", () => {
  const doc = readFileSync(join(import.meta.dirname, "..", "..", "docs", "build", "contracts", "ERROR-CODES.md"), "utf8");
  const codes = codesInSource();
  for (const expected of ["invalid", "signed_out", "not_found", "no_route", "rate_limited", "unavailable", "server_error", "sign_in_failed", "budget"]) {
    assert.ok(codes.has(expected), `the scan finds ${expected}`);
  }
  const missing = [...codes].filter((code) => !doc.includes(`\`${code}\``));
  assert.deepEqual(missing, [], "add these to docs/build/contracts/ERROR-CODES.md");
});

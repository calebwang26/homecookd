// POST /web-events, the lander's visit log, against Supabase's api_test case ("POST /web-events: lander visits"), on real Postgres. Made-up visits only.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

const skip = !hasDatabase;
let app: FastifyInstance;
let nextIp = 0;

before(async () => {
  if (skip) return;
  process.env.RATE_LIMIT_SALT = "test-salt-for-the-web-events";
  await freshDatabase();
  app = buildApp({ logger: false });
});

beforeEach(async () => {
  if (!skip) await db().query("truncate lander_events, rate_hits");
});

after(async () => {
  if (skip) return;
  await app.close();
  await db().end();
});

/** A POST as the site sends it. `type: null` sends no Content-Type, as a beacon with an untyped Blob does. Each call gets its own address unless told. */
function send(payload: unknown, o: { type?: string | null; ip?: string; headers?: Record<string, string> } = {}) {
  nextIp += 1;
  const type = o.type === undefined ? "application/json" : o.type;
  return app.inject({
    method: "POST",
    url: "/web-events",
    remoteAddress: o.ip ?? `198.51.100.${nextIp % 250}`,
    headers: { ...(type ? { "content-type": type } : {}), ...o.headers },
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const rows = async () => (await db().query("select * from lander_events order by id")).rows;

test("a visit as JSON, as a beacon's text/plain, or with no type is 204 with no body, and its row lands", { skip }, async () => {
  const visit = { event: "switch", aud: "kid", signal: "switch", ui: "hero", path: "/learn", utm_source: "ig", host: "homecookd.app" };
  const json = await send(visit);
  assert.deepEqual([json.statusCode, json.body], [204, ""]);
  const beacon = await send({ event: "land", aud: "parent" }, { type: "text/plain;charset=UTF-8" });
  assert.deepEqual([beacon.statusCode, beacon.body], [204, ""]);
  const untyped = await send({ event: "tap", aud: "kid", ui: "  sticky ", app: "snapchat", utm_campaign: "fall" }, { type: null });
  assert.equal(untyped.statusCode, 204, untyped.body);

  const [a, b, c] = await rows();
  assert.deepEqual(
    [a.event, a.aud, a.signal, a.ui, a.path, a.utm_source, a.host, a.app, a.utm_campaign],
    ["switch", "kid", "switch", "hero", "/learn", "ig", "homecookd.app", null, null],
  );
  assert.deepEqual([b.event, b.aud, b.signal, b.path], ["land", "parent", null, null]);
  assert.deepEqual([c.event, c.ui, c.app, c.utm_campaign], ["tap", "sticky", "snapchat", "fall"], "trimmed, as Supabase's str() did");
  assert.ok(a.created_at instanceof Date);
});

test("a bad field is 400 invalid naming it, and a body that isn't a JSON object is 400 invalid; none lands", { skip }, async () => {
  const cases: [unknown, string][] = [
    [{ event: "click", aud: "kid" }, "event"],
    [{ aud: "kid" }, "event"],
    [{ event: "  ", aud: "kid" }, "event"],
    [{ event: "land" }, "aud"],
    [{ event: "land", aud: "mom" }, "aud"],
    [{ event: "land", aud: "kid", signal: "tv" }, "signal"],
    [{ event: "land", aud: "kid", path: "x".repeat(101) }, "path"],
    [{ event: "land", aud: "kid", ui: "x".repeat(21) }, "ui"],
    [{ event: "land", aud: "kid", host: "x".repeat(61) }, "host"],
    [{ event: "land", aud: "kid", app: "x".repeat(101) }, "app"],
    [{ event: "land", aud: "kid", utm_source: 7 }, "utm_source"],
    [{ event: "land", aud: "kid", utm_campaign: ["a"] }, "utm_campaign"],
    [{ event: "land", aud: true }, "aud"],
  ];
  for (const [body, field] of cases) {
    const res = await send(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.deepEqual([res.json().error, res.json().field], ["invalid", field], JSON.stringify(body));
  }
  assert.deepEqual([(await send("")).json().field, (await send(undefined, { type: null })).json().field], ["event", "event"], "an empty body names the first field");

  const notAnObject: [string, string | null][] = [["not json", "text/plain"], ["[1, 2]", "application/json"], ["null", "text/plain"], ["event=land", "application/x-www-form-urlencoded"], ["{}", "multipart/form-data; boundary=x"]];
  for (const [payload, type] of notAnObject) {
    const res = await send(payload, { type });
    assert.deepEqual([res.statusCode, res.json().error], [400, "invalid"], payload);
    assert.equal(res.json().field, undefined, payload);
  }
  assert.deepEqual(await rows(), []);
});

test("a body over 64 KB is 413 too_large, and nothing lands", { skip }, async () => {
  const big = { event: "land", aud: "kid", pad: "x".repeat(70_000) };
  for (const type of ["application/json", "text/plain"]) {
    const res = await send(big, { type });
    assert.deepEqual([res.statusCode, res.json().error], [413, "too_large"], type);
  }
  const justUnder = await send({ event: "land", aud: "kid", pad: "x".repeat(60_000) });
  assert.equal(justUnder.statusCode, 204, "the limit is 64 KB, not the api's usual 1 MB or a smaller one");
  assert.equal((await rows()).length, 1);
});

test("the 121st visit in 10 minutes from one address is 429 rate_limited with retry-after; another address still lands", { skip }, async () => {
  const ip = "192.0.2.121";
  for (let i = 0; i < 120; i += 1) assert.equal((await send({ event: "land", aud: "kid" }, { ip })).statusCode, 204);
  const over = await send({ event: "land", aud: "kid" }, { ip });
  assert.deepEqual([over.statusCode, over.json().error], [429, "rate_limited"]);
  const wait = Number(over.headers["retry-after"]);
  assert.ok(wait >= 1 && wait <= 600, `retry-after ${over.headers["retry-after"]}`);
  assert.equal((await rows()).length, 120);
  assert.equal((await send({ event: "land", aud: "kid" }, { ip: "192.0.2.122" })).statusCode, 204);
});

test("nothing about the person is stored: no IP, no user agent, and the limit holds only a keyed hash", { skip }, async () => {
  const ip = "203.0.113.77";
  const agent = "Mozilla/5.0 (iPhone; made-up-agent-for-this-test)";
  const res = await send({ event: "land", aud: "parent", host: "homecookd.app" }, { ip, headers: { "user-agent": agent, referer: "https://instagram.com/" } });
  assert.equal(res.statusCode, 204);
  const columns = (await db().query(`select column_name from information_schema.columns where table_name = 'lander_events'`)).rows.map((r) => r.column_name);
  assert.deepEqual(columns.filter((name: string) => /ip|agent|addr|referr?er/i.test(name)), []);
  const stored = JSON.stringify(await rows());
  for (const personal of [ip, "made-up-agent", "instagram"]) assert.ok(!stored.includes(personal), `${personal} isn't stored`);
  const keys = JSON.stringify((await db().query("select key from rate_hits")).rows);
  assert.ok(keys.includes("web-events:") && !keys.includes(ip), keys);
});

test("it has no CORS: a beacon's answer is never read, so there's no preflight to answer and no header to add", { skip }, async () => {
  const pre = await app.inject({ method: "OPTIONS", url: "/web-events", headers: { origin: "https://homecookd.app", "access-control-request-method": "POST" } });
  assert.deepEqual([pre.statusCode, pre.json().error], [404, "no_route"]);
  const res = await send({ event: "land", aud: "kid" }, { type: "text/plain", headers: { origin: "https://homecookd.app" } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

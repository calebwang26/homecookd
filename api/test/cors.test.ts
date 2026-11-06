// The app's web build on staging (APP_WEB_ORIGINS, cors.ts), the website's own origins (SITE_ORIGINS), and the routes with CORS of their own: no database needed.
// A share opened from the site, which needs one, is in messagesActivity.test.ts.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const APP = "http://localhost:8081";
const BOTH = "https://staging-app.example"; // in both lists, to show the app's layer stays off a route with its own CORS
const SITE = "https://site-staging.example";
let app: FastifyInstance;
let plain: FastifyInstance;

before(async () => {
  // SITE_ORIGINS is read on each request, so it stays set for the file; APP_WEB_ORIGINS is read once, when the app is built.
  process.env.SITE_ORIGINS = ` ${SITE} ,${BOTH}`;
  process.env.APP_WEB_ORIGINS = ` ${APP} , ${BOTH} `;
  app = buildApp({ logger: false });
  delete process.env.APP_WEB_ORIGINS;
  plain = buildApp({ logger: false });
});

after(async () => {
  await app.close();
  await plain.close();
});

const preflight = (on: FastifyInstance, url: string, origin: string) =>
  on.inject({ method: "OPTIONS", url, headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization" } });

test("a listed origin's preflight is answered for any /v1 path, and its answers carry what a page may read", async () => {
  for (const url of ["/v1/me", "/v1/threads/abc/messages", "/v1/nothing-here"]) {
    const res = await preflight(app, url, APP);
    assert.equal(res.statusCode, 204, url);
    assert.equal(res.headers["access-control-allow-origin"], APP);
    assert.equal(res.headers.vary, "Origin");
    assert.equal(res.headers["access-control-allow-methods"], "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    assert.equal(res.headers["access-control-allow-headers"], "content-type, authorization, x-device-key, x-profile-id, x-tz, x-request-id, idempotency-key");
    assert.equal(res.headers["access-control-expose-headers"], "retry-after, x-request-id");
    assert.equal(res.headers["access-control-max-age"], "86400");
    assert.equal(res.headers["access-control-allow-credentials"], undefined, "credentials are headers, not cookies");
  }
  const real = await app.inject({ url: "/v1/me", headers: { origin: APP } });
  assert.equal(real.statusCode, 401, "the route's own answer is unchanged");
  assert.equal(real.json().error, "signed_out");
  assert.equal(real.headers["access-control-allow-origin"], APP, "an error a page can read");
  assert.equal(real.headers["access-control-expose-headers"], "retry-after, x-request-id");
  assert.equal(real.headers.vary, "Origin");
});

test("an origin that isn't listed, or no list at all, gets no CORS headers and the route's own answer", async () => {
  for (const [on, origin] of [[app, "https://evil.example"], [plain, APP]] as const) {
    const pre = await preflight(on, "/v1/me", origin);
    assert.deepEqual([pre.statusCode, pre.json().error], [404, "no_route"]);
    assert.equal(pre.headers["access-control-allow-origin"], undefined);
    const real = await on.inject({ url: "/v1/me", headers: { origin } });
    assert.equal(real.statusCode, 401);
    assert.equal(real.headers["access-control-allow-origin"], undefined);
    assert.equal(real.headers["access-control-expose-headers"], undefined);
  }
});

test("routes with CORS of their own keep it, once, with the request id and retry-after readable", async () => {
  // The family routes answer any site.
  const family = await preflight(app, "/family", APP);
  assert.equal(family.statusCode, 204);
  assert.equal(family.headers["access-control-allow-origin"], "*", "accounts' own answer, not the app's layer");
  assert.match(String(family.headers["access-control-allow-headers"]), /x-device-key, .*x-request-id, idempotency-key$/);
  assert.equal(family.headers["access-control-expose-headers"], "retry-after, x-request-id");
  const familyGet = await app.inject({ url: "/family", headers: { origin: APP } });
  assert.equal(familyGet.headers["access-control-allow-origin"], "*");

  // /dish, /link/open and /invite/open: only our pages, each with its own list.
  for (const [url, extra] of [["/dish/cards/get", "X-Dish-Token, "], ["/link/open", ""], ["/invite/open", ""]] as const) {
    const ours = await preflight(app, url, "https://homecookd.app");
    assert.equal(ours.statusCode, 204, url);
    assert.equal(ours.headers["access-control-allow-origin"], "https://homecookd.app", url);
    assert.equal(ours.headers["access-control-allow-methods"], "POST, OPTIONS", `${url}: its own methods, not the app layer's`);
    assert.equal(ours.headers["access-control-allow-headers"], `Content-Type, ${extra}X-Request-Id, Idempotency-Key`, url);
    assert.equal(ours.headers["access-control-expose-headers"], "retry-after, x-request-id", url);
    const evil = await preflight(app, url, "https://evil.example");
    assert.equal(evil.statusCode, 403, `${url}: another site is still refused`);
    assert.equal(evil.headers["access-control-allow-origin"], undefined);
  }
  // The app's origin on /dish gets dish's own answer (it takes local pages), not a second set of headers.
  const dish = await preflight(app, "/dish/cards/get", APP);
  assert.deepEqual([dish.statusCode, dish.headers["access-control-allow-methods"]], [204, "POST, OPTIONS"]);
});

test("/v1/shares/open answers the website's origins itself: a preflight, its own headers once, and another site refused", async () => {
  for (const origin of [SITE, BOTH]) {
    const res = await preflight(app, "/v1/shares/open", origin);
    assert.equal(res.statusCode, 204, origin);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    assert.equal(res.headers["access-control-allow-methods"], "POST, OPTIONS", `${origin}: its own, not the app layer's`);
    assert.equal(res.headers["access-control-allow-headers"], "content-type, x-request-id, idempotency-key", `${origin}: no session header, as the app layer's has`);
    assert.equal(res.headers["access-control-expose-headers"], "retry-after, x-request-id");
    assert.equal(res.headers["access-control-max-age"], "86400");
    assert.equal(res.headers.vary, "Origin", `${origin}: once`);
    assert.equal(res.headers["access-control-allow-credentials"], undefined);
  }
  // The app's own web build isn't the site: the app layer leaves this route alone, so it's refused like any other site.
  for (const origin of [APP, "https://evil.example", "https://homecookd.app.evil.example"]) {
    const pre = await preflight(app, "/v1/shares/open", origin);
    assert.deepEqual([pre.statusCode, pre.json().error], [403, "origin"], origin);
    assert.equal(pre.headers["access-control-allow-origin"], undefined, origin);
    assert.equal(pre.headers.vary, "Origin");
    const post = await app.inject({ method: "POST", url: "/v1/shares/open", headers: { origin, "content-type": "text/plain" }, payload: '{"token":"ABCDEFGHIJ"}' });
    assert.deepEqual([post.statusCode, post.json().error], [403, "origin"], `${origin}: refused before the route runs`);
  }
  // The app's fetch sends no Origin, and needs no CORS.
  const native = await app.inject({ method: "OPTIONS", url: "/v1/shares/open" });
  assert.deepEqual([native.statusCode, native.headers["access-control-allow-origin"], native.headers.vary], [204, undefined, "Origin"]);
});

test("unset, SITE_ORIGINS allows no site on /v1/shares/open, homecookd.app included: production lists it", async () => {
  const saved = process.env.SITE_ORIGINS;
  delete process.env.SITE_ORIGINS;
  try {
    for (const origin of [SITE, "https://homecookd.app"]) assert.equal((await preflight(app, "/v1/shares/open", origin)).statusCode, 403, origin);
  } finally {
    process.env.SITE_ORIGINS = saved;
  }
});

test("/invite and /dish also take SITE_ORIGINS, and keep homecookd.app, www and local pages", async () => {
  for (const url of ["/invite/open", "/dish/cards/get"]) {
    for (const origin of [SITE, "https://homecookd.app", "https://www.homecookd.app", "http://localhost:3000"]) {
      const res = await preflight(app, url, origin);
      assert.equal(res.statusCode, 204, `${url} ${origin}`);
      assert.equal(res.headers["access-control-allow-origin"], origin, `${url} ${origin}`);
      assert.equal(res.headers["access-control-allow-methods"], "POST, OPTIONS", `${url}: its own answer`);
    }
    assert.equal((await preflight(app, url, "https://evil.example")).statusCode, 403, url);
  }
  const saved = process.env.SITE_ORIGINS;
  delete process.env.SITE_ORIGINS;
  try {
    for (const url of ["/invite/open", "/dish/cards/get"]) {
      assert.equal((await preflight(app, url, SITE)).statusCode, 403, `${url}: it's the setting that lets staging's site in`);
      assert.equal((await preflight(app, url, "https://homecookd.app")).statusCode, 204, url);
    }
  } finally {
    process.env.SITE_ORIGINS = saved;
  }
});

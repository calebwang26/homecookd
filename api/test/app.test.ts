import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import { buildApp, pathOnly } from "../src/app.js";
import { scrub } from "../src/sentry.js";

test("/health answers without a database", async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject("/health");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "ok");
});

test("a caller's request id comes back; a bad one is replaced", async () => {
  const app = buildApp({ logger: false });
  const good = await app.inject({ url: "/health", headers: { "x-request-id": "abc12345-trace" } });
  assert.equal(good.headers["x-request-id"], "abc12345-trace");
  const bad = await app.inject({ url: "/health", headers: { "x-request-id": "no spaces\tor junk" } });
  assert.notEqual(bad.headers["x-request-id"], "no spaces\tor junk");
  assert.match(String(bad.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
});

test("logs carry the request id and never the query string", async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _e, done) { lines.push(chunk.toString()); done(); } });
  const app = buildApp({ logger: { stream, serializers: { req: (r: { url: string }) => ({ path: pathOnly(r.url) }) } } });
  await app.inject({ url: "/health?token=secret-token", headers: { "x-request-id": "abc12345-trace" } });
  const output = lines.join("");
  assert.match(output, /abc12345-trace/);
  assert.doesNotMatch(output, /secret-token/);
});

test("a server error hides its message from the caller and gives the request id", async () => {
  const app = buildApp({ logger: false });
  app.get("/boom", async () => { throw new Error("family secret detail"); });
  const res = await app.inject("/boom");
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, "server_error");
  assert.doesNotMatch(res.body, /family secret detail/);
  assert.ok(res.json().requestId);
});

test("Sentry events lose the query, body, headers and user", () => {
  const event = scrub({
    type: undefined,
    request: { method: "POST", url: "https://x/a?token=t", data: "her message", headers: { authorization: "Bearer t" }, cookies: { a: "b" } },
    user: { id: "person" },
  } as never) as { request: Record<string, unknown>; user?: unknown };
  assert.deepEqual(event.request, { method: "POST", url: "https://x/a" });
  assert.equal(event.user, undefined);
});

test("/ready reaches a real database", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { db } = await import("../src/db.js");
  const app = buildApp({ logger: false });
  const res = await app.inject("/ready");
  assert.equal(res.statusCode, 200);
  await db().end();
});

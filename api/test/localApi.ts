// The api on this machine, for web/scripts/qa/dish-api-e2e.mjs: the real routes, the real rules and real Postgres, with fake models and a small local
// stand-in for S3 that behaves as a presigned link does (it checks the signed type, size and expiry, and answers CORS like the private bucket). It lives under
// test/, so it's never in the api's image, and there's no queue here, so this loop works the outbox instead.
//
//   docker run -d --rm --name hc-web-pg -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t -p 15451:5432 postgres:17
//   cd api && DATABASE_URL=postgres://postgres:t@localhost:15451/t npx tsx test/localApi.ts    # the api on :8792, storage on :8793
import { createServer } from "node:http";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { type ObjectStore, UPLOAD_LINK_S, useObjectStore } from "../src/storage.js";

const local = /^postgres:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/;
if (process.env.DEPLOY_ENV || !local.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("This runs only on this machine, against a local Postgres: DATABASE_URL must be on localhost, and DEPLOY_ENV unset.");
}
process.env.DISH_FAKE_AI = "1";
process.env.RATE_LIMIT_SALT ??= "local-only";

const API_PORT = Number(process.env.API_PORT ?? 8792);
const STORE_PORT = Number(process.env.STORE_PORT ?? 8793);
const STORE = `http://localhost:${STORE_PORT}`;

const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
const ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const storage = createServer((req, res) => {
  const url = new URL(req.url ?? "/", STORE);
  const key = decodeURIComponent(url.pathname.slice(1));
  const origin = req.headers.origin ?? "";
  if (ORIGIN.test(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "PUT");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(ORIGIN.test(origin) ? 200 : 403).end();
    return;
  }
  if (req.method === "PUT") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      const signed = Number(url.searchParams.get("size")) === bytes.length && url.searchParams.get("type") === req.headers["content-type"];
      if (!signed || Date.now() > Number(url.searchParams.get("expires"))) return void res.writeHead(403).end("<Error>SignatureDoesNotMatch</Error>");
      objects.set(key, { bytes, contentType: req.headers["content-type"] ?? "" });
      res.writeHead(200).end();
    });
    return;
  }
  const object = objects.get(key);
  if (req.method !== "GET" || !object) return void res.writeHead(404).end("<Error>NoSuchKey</Error>");
  res.writeHead(200, { "Content-Type": object.contentType, "Content-Length": object.bytes.length, "Accept-Ranges": "none" }).end(object.bytes);
});

const store: ObjectStore = {
  async presignPut(key, contentType, size) {
    const q = new URLSearchParams({ type: contentType, size: String(size), expires: String(Date.now() + UPLOAD_LINK_S * 1000) });
    return { url: `${STORE}/${encodeURI(key)}?${q}`, headers: { "Content-Type": contentType }, expiresInS: UPLOAD_LINK_S };
  },
  async presignGet(key) {
    return `${STORE}/${encodeURI(key)}`;
  },
  async head(key) {
    const o = objects.get(key);
    return o ? { size: o.bytes.length, contentType: o.contentType } : null;
  },
  async read(key) {
    const o = objects.get(key);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
  },
  async remove(key) {
    objects.delete(key);
  },
};
useObjectStore(store);

await migrate(db());
const app = buildApp();
await app.listen({ host: "127.0.0.1", port: API_PORT });
storage.listen(STORE_PORT, "127.0.0.1");

// What SQS and the consumer do on AWS.
const log = app.log as never;
let working = false;
setInterval(() => {
  if (working) return;
  working = true;
  sendDue(db(), async (_queue, body) => handleMessage(body, log))
    .catch((error) => app.log.error({ err: { type: (error as Error).name } }, "local outbox pass failed"))
    .finally(() => {
      working = false;
    });
}, 500);

console.log(JSON.stringify({ api: `http://localhost:${API_PORT}`, storage: STORE, fakeModels: true }));

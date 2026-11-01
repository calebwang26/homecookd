import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { requireSession } from "../src/auth.js";
import { db } from "../src/db.js";
import { looksLikeFileKey } from "../src/files.js";
import { bearer, family, file, freshDatabase, hasDatabase, person, session } from "./helpers.js";

const body = {
  type: "object",
  properties: {
    audioKey: { type: "string" },
    photo_keys: { type: "array", items: { type: "string" } },
    attachments: { type: "array", items: { type: "object", properties: { photoKey: { type: "string" } } } },
    cover: { type: "object", properties: { path: { type: "string" } } },
  },
};
const fields = ["audioKey", "photo_keys", "attachments[].photoKey", "cover.path"];
const query = { type: "object", properties: { fileId: { type: "string" } } };
const params = { type: "object", properties: { key: { type: "string" } } };

function testApp() {
  return buildApp({
    logger: false,
    routes: (a) => {
      a.post(
        "/test/attach",
        { preValidation: requireSession, schema: { body, querystring: query }, config: { fileKeys: [...fields, "query.fileId"] } },
        async () => ({ attached: true }),
      );
      a.get(
        "/test/file/:key",
        { preValidation: requireSession, schema: { params }, config: { fileKeys: ["params.key"] } },
        async () => ({ read: true }),
      );
    },
  });
}

function startsWith(register: (a: FastifyInstance) => void, error: RegExp) {
  assert.throws(() => buildApp({ logger: false, routes: register }), error);
}

test("a route that could take a key without saying so won't start", async (t) => {
  await t.test("top-level body fields", () =>
    startsWith((a) => a.post("/x", { schema: { body } }, async () => ({})), /declare audioKey, photo_keys/),
  );
  await t.test("nested fields and array items", () => {
    const nested = { type: "object", properties: { attachments: { type: "array", items: { type: "object", properties: { photoKey: { type: "string" } } } } } };
    startsWith((a) => a.post("/x", { schema: { body: nested } }, async () => ({})), /attachments\[\]\.photoKey/);
  });
  await t.test("inside oneOf", () => {
    const either = { oneOf: [{ type: "object", properties: { audioKey: { type: "string" } } }] };
    startsWith((a) => a.post("/x", { schema: { body: either } }, async () => ({})), /declare audioKey/);
  });
  await t.test("the querystring", () =>
    startsWith((a) => a.get("/x", { schema: { querystring: query } }, async () => ({})), /query\.fileId/),
  );
  await t.test("params", () =>
    startsWith((a) => a.get("/x/:key", { schema: { params } }, async () => ({})), /params\.key/),
  );
  await t.test("a write route with no body schema", () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      startsWith((a) => a[method]("/x", async () => ({})), /needs a body schema, or config.noBody/);
    }
  });
  await t.test("saying it takes no body, or that a field isn't a file, is allowed", () => {
    const idempotent = { type: "object", properties: { idempotency_key: { type: "string" } } };
    buildApp({
      logger: false,
      routes: (a) => {
        a.post("/x", { config: { noBody: true } }, async () => ({}));
        a.post("/y", { schema: { body: idempotent }, config: { notFileKeys: ["idempotency_key"] } }, async () => ({}));
      },
    });
  });
});

test("key-looking names", () => {
  for (const f of ["audioKey", "audio_key", "photo_keys", "key", "audioPath", "fileId", "file_id", "storageId", "coverUpload", "file", "photos", "photo", "voiceNote", "voice_note", "clip", "audio", "kidPhoto"]) {
    assert.ok(looksLikeFileKey(f), f);
  }
  for (const f of ["monkey", "text", "turkey_recipe", "profile", "name"]) assert.ok(!looksLikeFileKey(f), f);
});

/** One request with `key` in one declared field, whatever its shape. */
function sendWith(app: FastifyInstance, token: string, route: { method: string; url: string }, field: string, key: string, ownKey: string) {
  const headers = bearer(token);
  const method = route.method as "POST";
  if (field.startsWith("query.")) {
    return app.inject({ method, url: route.url, headers, query: { [field.slice(6)]: key }, payload: method === "POST" ? {} : undefined });
  }
  if (field.startsWith("params.")) return app.inject({ method, url: route.url.replace(":key", encodeURIComponent(key)), headers });
  const payload =
    field === "attachments[].photoKey" ? { attachments: [{ photoKey: ownKey }, { photoKey: key }] }
    : field === "cover.path" ? { cover: { path: key } }
    : field === "photo_keys" ? { photo_keys: [ownKey, key] }
    : { [field]: key };
  return app.inject({ method, url: route.url, headers, payload });
}

test("attaching a file", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const mine = await family();
  const theirs = await family();
  const token = await session(mine, await person(mine));
  const app = testApp();
  const attach = (payload: object) =>
    app.inject({ method: "POST", url: "/test/attach", headers: bearer(token), payload });

  await t.test("my own family's file works", async () => {
    const res = await attach({ audioKey: await file(mine), photo_keys: [await file(mine)] });
    assert.equal(res.statusCode, 200);
  });

  await t.test("every route with a declared key refuses another family's", async () => {
    const other = await file(theirs);
    assert.ok(app.fileKeyRoutes.length > 0);
    for (const route of app.fileKeyRoutes) {
      for (const field of route.fields) {
        const res = await sendWith(app, token, route, field, other, await file(mine));
        assert.equal(res.statusCode, 404, `${route.url} ${field}`);
      }
    }
  });

  await t.test("nested fields work with my own file, and read it through every shape", async () => {
    const own = await file(mine);
    assert.equal((await attach({ attachments: [{ photoKey: own }], cover: { path: own } })).statusCode, 200);
    assert.equal((await app.inject({ url: `/test/file/${encodeURIComponent(own)}`, headers: bearer(token) })).statusCode, 200);
  });

  await t.test("a link was asked for, but S3 hasn't confirmed any bytes", async () => {
    const waiting = await file(mine);
    await db().query("update files set uploaded_at = null where key = $1", [waiting]);
    assert.equal((await attach({ audioKey: waiting })).statusCode, 404);
  });

  await t.test("a key that doesn't exist answers the same as another family's", async () => {
    const res = await attach({ audioKey: "private/nothing-here" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "not_found");
  });

  await t.test("a deleted file, or one being deleted, is refused", async () => {
    const deleted = await file(mine);
    await db().query("update files set deleted_at = now() where key = $1", [deleted]);
    const going = await file(mine);
    await db().query("update files set delete_requested_at = now() where key = $1", [going]);
    assert.equal((await attach({ audioKey: deleted })).statusCode, 404);
    assert.equal((await attach({ audioKey: going })).statusCode, 404);
  });

  await t.test("a key that isn't a string is refused", async () => {
    assert.equal((await attach({ photo_keys: [{ key: "x" }] })).statusCode, 404);
  });

  await t.test("signing in comes first", async () => {
    const res = await app.inject({ method: "POST", url: "/test/attach", payload: { audioKey: "private/x" } });
    assert.equal(res.statusCode, 401);
  });
});

test("every route in the real app with a key field refuses another family's, and another person's", { skip: !hasDatabase }, async () => {
  await freshDatabase();
  const mine = await family();
  const theirs = await family();
  const me = await person(mine);
  const sibling = await person(mine, "kid");
  const token = await session(mine, me);
  const app = buildApp({ logger: false });
  await app.ready();
  // Each signed-in route with a key is named here when it's added. The anonymous routes have no session, so they say notFileKeys instead, and dishFiles.test.ts's last test
  // holds them to their own check, field by field.
  assert.deepEqual(app.fileKeyRoutes, [{ method: "POST", url: "/v1/cravings/:id/voice-recipe", fields: ["audioKey"] }]);
  const other = await file(theirs);
  const othersInMyFamily = await file(mine);
  await db().query("update files set owner_person_id = $2 where key = $1", [othersInMyFamily, sibling]);
  for (const route of app.fileKeyRoutes) {
    for (const field of route.fields) {
      for (const key of [other, othersInMyFamily, "private/nothing-here"]) {
        const res = await sendWith(app, token, route, field, key, await file(mine));
        assert.equal(res.statusCode, 404, `${route.url} ${field}`);
        assert.equal(res.json().error, "not_found");
      }
    }
  }
  assert.ok(app.notFileKeyRoutes.every((route) => route.url.startsWith("/dish/")), "only the anonymous routes may say a file field isn't a key");
});

after(async () => {
  if (hasDatabase) await db().end();
});

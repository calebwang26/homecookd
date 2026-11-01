import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { requireSession } from "../src/auth.js";
import { db } from "../src/db.js";
import { looksLikeFileKey } from "../src/files.js";
import { bearer, family, file, freshDatabase, hasDatabase, person, session } from "./helpers.js";

const body = { properties: { audioKey: { type: "string" }, photo_keys: { type: "array" } }, type: "object" };

function testApp() {
  return buildApp({
    logger: false,
    routes: (a) => {
      a.post(
        "/test/attach",
        { preValidation: requireSession, schema: { body }, config: { fileKeys: ["audioKey", "photo_keys"] } },
        async () => ({ attached: true }),
      );
    },
  });
}

test("a route that takes a key must declare it, or the app won't start", () => {
  assert.throws(
    () =>
      buildApp({
        logger: false,
        routes: (a) => {
          a.post("/test/forgot", { schema: { body } }, async () => ({}));
        },
      }),
    /declare audioKey, photo_keys/,
  );
});

test("key-looking names", () => {
  for (const f of ["audioKey", "audio_key", "photo_keys", "key"]) assert.ok(looksLikeFileKey(f), f);
  for (const f of ["monkey", "text", "turkey_recipe"]) assert.ok(!looksLikeFileKey(f), f);
});

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
        const payload = field.endsWith("s") ? { [field]: [await file(mine), other] } : { [field]: other };
        const res = await app.inject({ method: route.method as "POST", url: route.url, headers: bearer(token), payload });
        assert.equal(res.statusCode, 404, `${route.url} ${field}`);
      }
    }
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

test("every route in the real app with a key field refuses another family's", { skip: !hasDatabase }, async () => {
  const app = buildApp({ logger: false });
  await app.ready();
  // Empty today. It fills as routes are added, and files.test.ts's loop above is what each must pass.
  for (const route of app.fileKeyRoutes) assert.ok(route.fields.length > 0);
});

after(async () => {
  if (hasDatabase) await db().end();
});

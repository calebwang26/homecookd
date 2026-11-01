import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { requireFamily, requireSession, signedIn } from "../src/auth.js";
import { db } from "../src/db.js";
import { bearer, family, freshDatabase, hasDatabase, person, session } from "./helpers.js";

test("sessions", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  const f = await family();
  const p = await person(f);
  const app = buildApp({ logger: false });

  await t.test("no token, a junk token and a wrong token are refused alike", async () => {
    for (const headers of [{}, bearer("short"), bearer("x".repeat(43))]) {
      const res = await app.inject({ url: "/v1/me", headers });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, "signed_out");
    }
  });

  await t.test("a good token gets its own person and family", async () => {
    const res = await app.inject({ url: "/v1/me", headers: bearer(await session(f, p)) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().person.id, p);
    assert.equal(res.json().family.id, f);
  });

  await t.test("an expired session is refused", async () => {
    const res = await app.inject({ url: "/v1/me", headers: bearer(await session(f, p, -1)) });
    assert.equal(res.statusCode, 401);
  });

  await t.test("a deleted account's session is refused", async () => {
    const gone = await person(f);
    const token = await session(f, gone);
    await db().query("update people set deleted_at = now(), name = 'Deleted' where id = $1", [gone]);
    assert.equal((await app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode, 401);
  });

  await t.test("a session for a family the person has left is refused", async () => {
    const moved = await person(f);
    const token = await session(f, moved);
    await db().query("update people set family_id = $2 where id = $1", [moved, await family()]);
    assert.equal((await app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode, 401);
  });

  await t.test("the wrong family gets the same answer as a missing row", async () => {
    const other = await family();
    const scoped = buildApp({
      logger: false,
      routes: (a) => {
        a.get("/test/family/:id", { preValidation: requireSession }, async (req) => {
          requireFamily(signedIn(req), (req.params as { id: string }).id);
          return { ok: true };
        });
      },
    });
    const token = await session(f, p);
    assert.equal((await scoped.inject({ url: `/test/family/${f}`, headers: bearer(token) })).statusCode, 200);
    const refused = await scoped.inject({ url: `/test/family/${other}`, headers: bearer(token) });
    assert.equal(refused.statusCode, 404);
    assert.equal(refused.json().error, "not_found");
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { ApiError } from "../src/errors.js";
import { hit, subjectKey } from "../src/rateLimit.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

test("no salt means a loud failure, not a guessable hash", () => {
  delete process.env.RATE_LIMIT_SALT;
  assert.throws(() => subjectKey("1.2.3.4"), /RATE_LIMIT_SALT/);
});

test("rate limits", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();
  process.env.RATE_LIMIT_SALT = "test-salt";
  const limit = { bucket: "test", max: 2, windowS: 3600 };

  await t.test("the key never holds the IP", async () => {
    const key = subjectKey("1.2.3.4");
    await hit(key, [limit]);
    const { rows } = await db().query("select key from rate_hits");
    assert.doesNotMatch(rows[0].key, /1\.2\.3\.4/);
  });

  await t.test("the limit holds, and says when to retry", async () => {
    const key = subjectKey("5.6.7.8");
    await hit(key, [limit]);
    await hit(key, [limit]);
    await assert.rejects(hit(key, [limit]), (error: ApiError) => {
      assert.equal(error.statusCode, 429);
      assert.ok(Number(error.headers["retry-after"]) > 0);
      return true;
    });
  });

  await t.test("when one limit is full, the others aren't charged", async () => {
    const key = subjectKey("9.9.9.9");
    const roomy = { bucket: "roomy", max: 10, windowS: 3600 };
    const full = { bucket: "full", max: 1, windowS: 3600 };
    await hit(key, [full]);
    await assert.rejects(hit(key, [roomy, full]));
    const { rows } = await db().query("select count(*)::int as n from rate_hits where key = $1", [`roomy:${key}`]);
    assert.equal(rows[0].n, 0);
  });

  await t.test("concurrent hits can't pass the limit", async () => {
    const key = subjectKey("8.8.8.8");
    const tight = { bucket: "race", max: 5, windowS: 3600 };
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => hit(key, [tight])));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

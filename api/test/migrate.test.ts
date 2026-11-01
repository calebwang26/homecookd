import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { defaultDir, migrate } from "../src/migrate.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

const dir = () => mkdtemp(join(tmpdir(), "migrations-"));

test("migrations", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();

  await t.test("every real file is recorded, and a second run does nothing", async () => {
    const files = (await readdir(defaultDir)).filter((f) => f.endsWith(".sql"));
    const { rows } = await db().query("select name from schema_migrations");
    assert.equal(rows.length, files.length);
    assert.deepEqual(await migrate(db()), []);
  });

  await t.test("a failing file leaves nothing behind", async () => {
    const d = await dir();
    await writeFile(join(d, "900_bad.sql"), "create table half_done (id int); select nonsense from nowhere;");
    await assert.rejects(migrate(db(), d));
    const { rows } = await db().query("select to_regclass('half_done') as t");
    assert.equal(rows[0].t, null);
  });

  await t.test("a file changed after it was applied is refused", async () => {
    const d = await dir();
    await writeFile(join(d, "901_a.sql"), "create table changed_file (id int);");
    await migrate(db(), d);
    await writeFile(join(d, "901_a.sql"), "create table changed_file (id bigint);");
    await assert.rejects(migrate(db(), d), /changed after it was applied/);
  });

  await t.test("the no-transaction escape hatch can build an index concurrently", async () => {
    const d = await dir();
    await db().query("create table big_table (id int)");
    await writeFile(
      join(d, "902_index.sql"),
      "-- migrate: no-transaction\ncreate index concurrently if not exists big_table_id on big_table (id);\n",
    );
    assert.deepEqual(await migrate(db(), d), ["902_index.sql"]);
    const { rows } = await db().query("select to_regclass('big_table_id') as i");
    assert.equal(rows[0].i, "big_table_id");
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

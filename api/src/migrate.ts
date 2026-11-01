// Applies api/migrations/*.sql in order, each once, each in one transaction. Run as a one-off task before a release rolls out
// (.github/workflows/deploy-aws.yml), so a file must be safe while the previous release is still running (SYSTEM-DESIGN.md).
//
// Escape hatch: CREATE INDEX CONCURRENTLY can't run in a transaction, and once a table has real rows a plain CREATE INDEX blocks
// writes to it. A file whose first line is `-- migrate: no-transaction` runs outside one. It must hold one statement, written
// so a re-run is harmless (IF NOT EXISTS, and drop an INVALID index first), because a failure can't roll it back.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const LOCK = 7263519; // an advisory lock, so two runs can't apply the same file
const NO_TRANSACTION = /^-- migrate: no-transaction\s*\n/;

export const defaultDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(pool: Pool, dir = defaultDir): Promise<string[]> {
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("set statement_timeout = 0"); // the pool's timeout is for requests
    await client.query("select pg_advisory_lock($1)", [LOCK]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key, checksum text not null, applied_at timestamptz not null default now())`,
    );
    const { rows } = await client.query("select name, checksum from schema_migrations");
    const done = new Map(rows.map((row) => [row.name as string, row.checksum as string]));
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile(join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const before = done.get(file);
      if (before) {
        if (before !== checksum) throw new Error(`${file} changed after it was applied; add a new file instead`);
        continue;
      }
      const record = `insert into schema_migrations (name, checksum) values ($1, $2)`;
      if (NO_TRANSACTION.test(sql)) {
        await client.query(sql);
        await client.query(record, [file, checksum]);
      } else {
        try {
          await client.query("begin");
          await client.query(sql);
          await client.query(record, [file, checksum]);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { db } = await import("./db.js");
  const pool = db();
  const applied = await migrate(pool);
  console.log(JSON.stringify({ msg: "migrations done", applied }));
  await pool.end();
}

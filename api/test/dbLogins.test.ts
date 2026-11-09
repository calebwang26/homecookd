// The api's and the worker's own database logins (migrations/078_app_logins.sql; infra/README.md, "Database logins"). The pool's IAM token
// path with a fake signer, no AWS. On real Postgres: what each login can and can't do. Made-up data only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import pg from "pg";
import { config, db, type TokenSource } from "../src/db.js";
import { defaultDir, migrate } from "../src/migrate.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

const API = "homecookd_api";
const WORKER = "homecookd_worker";
const RDS = { DB_HOST: "homecookd-staging.example.us-west-2.rds.amazonaws.com" };
const MASTER = JSON.stringify({ username: "homecookd", password: "made-up-master" });

/** A signer that hands out numbered tokens, and remembers what it was asked to sign for. */
function fakeTokens(token = (n: number) => `token-${n}`) {
  const asked: [string, number, string][] = [];
  let made = 0;
  const tokens: TokenSource = (host, port, user) => {
    asked.push([host, port, user]);
    return async () => token((made += 1));
  };
  return { tokens, asked, made: () => made };
}

test("the pool's login", async (t) => {
  await t.test("DB_IAM=1: DB_USER with a fresh token for each new connection, and never the master password", async () => {
    const { tokens, asked } = fakeTokens();
    const c = config({ ...RDS, DB_IAM: "1", DB_USER: API, DB_CREDENTIALS: MASTER }, tokens);
    assert.equal(c.user, API);
    assert.equal(typeof c.password, "function");
    assert.deepEqual(asked, [[RDS.DB_HOST, 5432, API]]);
    const password = c.password as () => Promise<string>;
    assert.equal(await password(), "token-1");
    assert.equal(await password(), "token-2", "a new connection gets a new token: a 15-minute one would have run out");
    assert.equal(c.database, "homecookd");
    assert.deepEqual(c.ssl, { rejectUnauthorized: true }, "IAM tokens need TLS, and the certificate is checked");
    assert.doesNotMatch(JSON.stringify(c), /made-up-master/);
  });

  await t.test("without it, the master login, as before", () => {
    const { tokens, asked } = fakeTokens();
    for (const flag of [undefined, "0", "true"]) {
      const c = config({ ...RDS, DB_IAM: flag, DB_USER: API, DB_CREDENTIALS: MASTER }, tokens);
      assert.equal(c.user, "homecookd");
      assert.equal(c.password, "made-up-master");
      assert.deepEqual(c.ssl, { rejectUnauthorized: true });
    }
    assert.deepEqual(asked, [], "nothing signed");
  });

  await t.test("DATABASE_URL wins, locally and in tests", () => {
    const { tokens, asked } = fakeTokens();
    const c = config({ ...RDS, DB_IAM: "1", DB_USER: API, DATABASE_URL: "postgres://u:p@127.0.0.1:5432/t" }, tokens);
    assert.equal(c.connectionString, "postgres://u:p@127.0.0.1:5432/t");
    assert.equal(c.password, undefined);
    assert.deepEqual(asked, []);
  });

  await t.test("missing settings stop the start, rather than guess", () => {
    const { tokens } = fakeTokens();
    assert.throws(() => config({}, tokens), /No database settings/);
    assert.throws(() => config({ ...RDS }, tokens), /No database settings/);
    assert.throws(() => config({ ...RDS, DB_IAM: "1" }, tokens), /No database settings/, "no user named");
    assert.throws(() => config({ DB_IAM: "1", DB_USER: API }, tokens), /No database settings/, "no host");
  });
});

// Real Postgres from here.

/** Runs fn on one connection as that login: Postgres checks every statement against its grants. */
async function as<T>(login: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query(`set role ${login}`);
    return await fn(c);
  } finally {
    c.release(true); // never back to the pool: it may hold the role, or a transaction a refusal broke
  }
}

async function refused(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<void> {
  await assert.rejects(c.query(sql, params), (error: { code?: string }) => {
    assert.equal(error.code, "42501", `${sql}: ${String(error)}`);
    return true;
  });
}

const one = async (sql: string, params: unknown[] = []) => (await db().query(sql, params)).rows[0];

test("the logins, on real Postgres", { skip: !hasDatabase }, async (t) => {
  await freshDatabase();

  await t.test("the migration runs twice without harm, and each login is a plain one", async () => {
    await db().query(await readFile(join(defaultDir, "078_app_logins.sql"), "utf8"));
    for (const login of [API, WORKER]) {
      const role = await one(
        `select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
                (select count(*)::int from pg_auth_members where member = r.oid) as memberships
           from pg_roles r where rolname = $1`,
        [login],
      );
      assert.deepEqual(role, {
        rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: 0,
      }, login);
    }
  });

  await t.test("neither login can change the schema, make a role, or make a temporary table", async () => {
    for (const login of [API, WORKER]) {
      await as(login, async (c) => {
        await refused(c, "create table sneaky (id int)");
        await refused(c, "create temporary table sneaky (id int)");
        await refused(c, "create schema sneaky");
        await refused(c, "create role sneaky");
        await refused(c, "create function sneaky() returns int language sql as 'select 1'");
        await refused(c, "alter table jobs add column sneaky int");
        await refused(c, "create index sneaky on jobs (title)");
        await refused(c, "drop table jobs");
        await refused(c, "truncate jobs");
        await refused(c, "alter table recipes disable trigger sync_1_read_only");
        await refused(c, "alter table jobs owner to current_user");
      });
    }
  });

  await t.test("the api reads and writes every table's rows, but not which migrations ran", async () => {
    await as(API, async (c) => {
      const { id } = (await c.query("insert into families (name) values ('Made-up family') returning id")).rows[0];
      await c.query("update families set public_name = 'the Made-ups' where id = $1", [id]);
      assert.equal((await c.query("select public_name from families where id = $1", [id])).rows[0].public_name, "the Made-ups");
      await c.query("select count(*) from sessions");
      await c.query("insert into outbox (queue, payload) values ('scheduled', '{}'::jsonb)");
      await c.query("delete from families where id = $1", [id]);
      await refused(c, "select name from schema_migrations");
      await refused(c, "insert into schema_migrations (name, checksum) values ('999_skip_me.sql', 'x')");
    });
  });

  await t.test("a table a later migration makes is the api's too, and not the worker's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    await writeFile(join(dir, "900_later.sql"), "create table later_things (id bigint generated always as identity primary key, n serial, note text);");
    assert.deepEqual(await migrate(db(), dir), ["900_later.sql"]);
    await as(API, async (c) => {
      const row = (await c.query("insert into later_things (note) values ('made up') returning id, n")).rows[0];
      await c.query("update later_things set note = 'changed' where id = $1", [row.id]);
      await c.query("delete from later_things where id = $1", [row.id]);
    });
    await as(WORKER, (c) => refused(c, "select * from later_things"));
  });

  await t.test("the worker does what queue_db.py does, and nothing else", async () => {
    const home = (await one("insert into families (name) values ('Made-up family') returning id")).id;
    const cook = (await one("insert into people (family_id, name, role) values ($1, 'Made-up cook', 'cook') returning id", [home])).id;
    const card = (await one("insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Made-up dish', 'processing') returning id", [home, cook])).id;
    const job = (await one(
      "insert into jobs (family_id, cook_id, recipe_id, upload_key, source, stage) values ($1, $2, $3, 'up-1/', 'phone', 'queued') returning id",
      [home, cook, card],
    )).id;
    const day = "(now() at time zone 'utc')::date";

    await as(WORKER, async (c) => {
      // claim, _context, heartbeat
      const claim = (await c.query(
        `update jobs set stage = 'preparing', attempts = attempts + 1, claimed_at = now(), heartbeat_at = now(), updated_at = now()
          where id = $1 and cancelled_at is null and stage = 'queued' returning id, attempts, family_id, cook_id, recipe_id, recording_id`,
        [job],
      )).rows[0];
      assert.equal(claim.attempts, 1);
      await c.query(
        `select p.name, p.relation, p.language, r.media_prefix, rec.memories_opt_in, rec.cover_key from people p
           left join recipes r on r.id = $1 left join recordings rec on rec.id = $2 where p.id = $3`,
        [card, null, cook],
      );
      await c.query("select kind, text, at_s from homie_prompts where recording_id = $1 order by at_s limit 200", ["none"]);
      await c.query("select j.stage, r.media_prefix from jobs j left join recipes r on r.id = j.recipe_id where j.id = $1", [job]);
      await c.query("update jobs set heartbeat_at = now() where id = $1 and attempts = 1 returning 1", [job]);
      // record_calls, spent_today, note_daily_cap
      await c.query("begin");
      await c.query(
        "insert into model_calls (job_id, purpose, provider, model, cost_usd, ok) values ((select id from jobs where id = $1), 'merge', 'anthropic', 'claude-made-up', 0.5, true)",
        [job],
      );
      await c.query(`insert into daily_spend (scope, day, usd) values ('pipeline', ${day}, 0.5)
                     on conflict (scope, day) do update set usd = daily_spend.usd + excluded.usd`);
      await c.query("update jobs set cost_usd = coalesce(cost_usd, 0) + 0.5 where id = $1 returning cost_usd", [job]);
      await c.query("commit");
      await c.query(`select usd from daily_spend where scope = 'pipeline' and day = ${day}`);
      await c.query(`insert into daily_spend (scope, day, usd, alerted_at) values ('pipeline', ${day}, 0, now())
                     on conflict (scope, day) do update set alerted_at = now() where daily_spend.alerted_at is null returning 1`);
      // finish: the recipe, its follow-ups, the job's end, the follow-on message
      await c.query("begin");
      await c.query("select id, stage, attempts, cancelled_at from jobs where id = $1 for update", [job]);
      await c.query("update recipes set status = 'ready', title = 'Made-up dish', steps = '[]'::jsonb, moss_indexed_at = null where id = $1 returning id", [card]);
      const fresh = (await c.query("insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Another dish', 'ready') returning id", [home, cook])).rows[0].id;
      for (let i = 0; i < 2; i += 1) {
        await c.query(
          `insert into questions (family_id, recipe_id, step_order, asked_by, text, kind, follow_up_id, status)
           values ($1, $2, 1, $3, 'How much salt?', 'follow_up', 'f1', 'asked_cook')
           on conflict (recipe_id, follow_up_id) where follow_up_id is not null do nothing`,
          [home, card, cook],
        );
      }
      await c.query("update jobs set stage = 'done', progress = 1, finished_at = now(), updated_at = now(), recipe_id = $1 where id = $2", [card, job]);
      await c.query("update model_calls set recipe_id = $1 where job_id = $2", [card, job]);
      await c.query("insert into outbox (queue, payload, request_id) values ('scheduled', $1::jsonb, 'made-up')", [JSON.stringify({ kind: "recipe_published", jobId: job })]);
      await c.query("commit");
      // fail, acknowledge_cancel and the sweep mark a recipe failed
      await c.query("update recipes set status = 'failed' where id = $1", [fresh]);
      await c.query(
        `with gone as (select id from jobs where stage = 'preparing' and attempts >= 3 limit 50 for update skip locked),
              failed as (update jobs set stage = 'failed' where id in (select id from gone) returning id, recipe_id)
         update recipes set status = 'failed' where id in (select recipe_id from failed where recipe_id is not null)`,
      );
      // wake_later and the sweep's stranded check: a wake-up owed through the outbox, which it reads by queue, payload and sent_at only
      await c.query("update jobs set failures = failures + 1, updated_at = now() where id = $1 and stage = 'queued' returning id", [job]);
      await c.query("insert into outbox (queue, payload, request_id, send_after) values ('jobs', $1::jsonb, null, now() + make_interval(secs => 60))", [
        JSON.stringify({ jobId: job }),
      ]);
      await c.query("select 1 from outbox o where o.queue = 'jobs' and o.sent_at is null and o.payload->>'jobId' = $1", [job]);

      // Nothing outside its jobs: no sign-in, no messages, no deleting, no family or person changes.
      for (const table of ["sessions", "devices", "identities", "messages", "threads", "families", "files"]) {
        await refused(c, `select count(*) from ${table}`);
      }
      await refused(c, "select request_id, attempts from outbox");
      await refused(c, "select text from questions");
      await refused(c, "delete from jobs where id = $1", [job]);
      await refused(c, "delete from recipes where id = $1", [fresh]);
      await refused(c, "update people set name = 'changed' where id = $1", [cook]);
      await refused(c, "insert into families (name) values ('Another family')");
      await refused(c, "update questions set text = 'changed'");
    });
    assert.equal((await one("select stage from jobs where id = $1", [job])).stage, "done");
    assert.equal((await one("select count(*)::int as n from questions where recipe_id = $1", [card])).n, 1, "the second follow-up was a no-op");
  });

  await t.test("a login connects only to this database, with a new password for each connection", async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    const secret = randomBytes(24).toString("hex"); // this throwaway server's only, and cleared below
    await db().query(`alter role ${API} password '${secret}'`);
    const { tokens, asked, made } = fakeTokens(() => secret);
    const local = { host: url.hostname, port: Number(url.port), ssl: false as const };
    const pool = new pg.Pool({ ...config({ DB_HOST: url.hostname, DB_IAM: "1", DB_USER: API }, tokens), ...local, database: url.pathname.slice(1) });
    const other = new pg.Pool({ ...config({ DB_HOST: url.hostname, DB_IAM: "1", DB_USER: API }, tokens), ...local, database: "postgres" });
    try {
      const [a, b] = await Promise.all([pool.connect(), pool.connect()]);
      assert.equal((await a.query("select current_user as who")).rows[0].who, API);
      a.release();
      b.release();
      assert.equal(made(), 2, "one token per connection");
      assert.deepEqual(asked[0], [url.hostname, 5432, API]);
      if (url.pathname !== "/postgres") {
        await assert.rejects(other.query("select 1"), (error: { code?: string }) => error.code === "42501", "the server's other database is closed to it");
      }
    } finally {
      await pool.end();
      await other.end();
      await db().query(`alter role ${API} password null`);
    }
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

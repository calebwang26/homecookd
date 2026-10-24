// The retention migrations, applied for real in an in-memory Postgres (PGlite) on top of main's
// migrations and qa-cook's 20261018000000_cooked_photos.sql, in timestamp order, then all over again:
// - they apply in order, and twice (idempotent), whichever of cooked_photos and the plumbing file
//   runs first (both add messages.photo_path; only cooked_photos touches the photos bucket);
// - the checks they widen keep every older kind and refuse junk (reaction bodies, event kinds);
// - the cron file leaves one secret and one of each job however often it runs, and its functions
//   are closed to client keys;
// - table_activity (PR 5) runs against the real tables, not stand-ins;
// - PR 3's postcard file (messages.rating) is a no-op after the plumbing file and stands on its own.
//
// PGlite has no pg_cron, pg_net, Vault or pgcrypto, so small stand-ins with the same names and
// signatures are made first and the `create extension` lines are skipped; nothing else is changed.
// main's `create extension pgcrypto` is skipped too (gen_random_uuid is built in since Postgres 13).
// table_activity_sql_test.ts pins table_activity's rows; this file pins the files as a set.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/retention_migrations_sql_test.ts

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

const DIR = new URL("../migrations/", import.meta.url);
const COOKED_PHOTOS = "20261018000000_cooked_photos.sql";
/** Retention's own files: everything from 20261018100000 on. */
const isRetention = (name: string) => name >= "20261018100000";

/**
 * qa-cook's migration: in ../migrations once qa-cook is on main, else the sibling worktree, else this
 * copy of its two statements (as of qa-cook 674e32e).
 */
const COOKED_PHOTOS_COPY = `
alter table public.messages add column if not exists photo_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
`;

async function readOr(url: URL): Promise<string | null> {
  try {
    return await Deno.readTextFile(url);
  } catch {
    return null;
  }
}

async function migrationFiles(): Promise<{ base: [string, string][]; retention: [string, string][]; cookedPhotos: string }> {
  const names: string[] = [];
  for await (const e of Deno.readDir(DIR)) if (e.isFile && e.name.endsWith(".sql")) names.push(e.name);
  names.sort();
  const base: [string, string][] = [];
  const retention: [string, string][] = [];
  for (const n of names) {
    if (n === COOKED_PHOTOS) continue;
    (isRetention(n) ? retention : base).push([n, await Deno.readTextFile(new URL(n, DIR))]);
  }
  const cookedPhotos = (await readOr(new URL(COOKED_PHOTOS, DIR))) ??
    (await readOr(new URL(`../../../qa-cook/supabase/migrations/${COOKED_PHOTOS}`, import.meta.url))) ??
    COOKED_PHOTOS_COPY;
  return { base, retention, cookedPhotos };
}

/** Supabase's roles & schemas, and stand-ins for the extensions PGlite doesn't have. */
const SUPABASE = `
  create role anon; create role authenticated; create role service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);

  create schema extensions;
  create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as
    $$ select substring(decode(md5(random()::text) || md5(random()::text), 'hex') from 1 for n) $$;
  create function extensions.digest(data text, alg text) returns bytea language sql immutable as
    $$ select sha256(convert_to(data, 'UTF8')) $$;

  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text, new_description text) returns uuid language sql as
    $$ insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;

  create schema net;
  create table net.calls (id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_ms int);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
    headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as
    $$ insert into net.calls (url, body, params, headers, timeout_ms) values (url, body, params, headers, timeout_milliseconds) returning id $$;

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
  create table cron.job_run_details (runid bigserial primary key, end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
  create function cron.unschedule(job_id bigint) returns boolean language sql as
    $$ delete from cron.job where jobid = job_id returning true $$;
`;

/** Only the `create extension` lines PGlite can't run; the rest of each file runs as written. */
const runnable = (sql: string) => sql.replace(/^create extension if not exists (pgcrypto|pg_cron|pg_net)\b[^;]*;$/gm, "-- (skipped in PGlite) $&");

async function apply(db: PGlite, name: string, sql: string) {
  try {
    await db.exec(runnable(sql));
  } catch (e) {
    throw new Error(`${name}: ${String(e)}`);
  }
}

/**
 * main's migrations, then qa-cook's and retention's in `order`, then qa-cook's & retention's again.
 * `plumbingFirst` puts the retention plumbing file before cooked_photos (retention landing first).
 */
async function database(opts: { plumbingFirst?: boolean } = {}): Promise<PGlite> {
  const { base, retention, cookedPhotos } = await migrationFiles();
  const db = new PGlite();
  await db.exec(SUPABASE);
  for (const [n, sql] of base) await apply(db, n, sql);
  const later: [string, string][] = [[COOKED_PHOTOS, cookedPhotos], ...retention];
  if (opts.plumbingFirst) later.sort(([a], [b]) => (a.includes("plumbing") ? -1 : b.includes("plumbing") ? 1 : a < b ? -1 : 1));
  for (const pass of [1, 2]) {
    for (const [n, sql] of later) await apply(db, `${n} (pass ${pass})`, sql);
  }
  return db;
}

const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

const FAM = "11111111-1111-4111-8111-111111111111";
const MOM = "22222222-2222-4222-8222-222222222222";
const LEO = "33333333-3333-4333-8333-333333333333";

async function seed(db: PGlite): Promise<string> {
  await db.exec(`
    insert into public.families (id, name, code_hash) values ('${FAM}', 'Test family', repeat('a', 64));
    insert into public.profiles (id, family_id, name, role) values
      ('${MOM}', '${FAM}', 'Mom', 'cook'), ('${LEO}', '${FAM}', 'Leo', 'learner');
  `);
  const th = await one<{ id: string }>(db,
    `insert into public.threads (family_id, a_profile, b_profile) values ($1, $2, $3) returning id`, [FAM, MOM, LEO]);
  return th[0].id;
}

t("migrations: main + cooked_photos + retention apply in timestamp order, then all again", async () => {
  const { retention } = await migrationFiles();
  assertEquals(retention.map(([n]) => n), [
    "20261018100000_retention_plumbing.sql",
    "20261018100100_retention_cron.sql",
    "20261018100300_retention_table.sql",
    "20261018100400_retention_postcard.sql",
  ]);
  const db = await database();
  for (const table of ["push_tokens", "notification_log", "cooking_now"]) {
    const rls = await one<{ relrowsecurity: boolean }>(db, `select relrowsecurity from pg_class where relname = $1`, [table]);
    assertEquals(rls, [{ relrowsecurity: true }], table);
    for (const role of ["anon", "authenticated"]) {
      const can = await one<{ ok: boolean }>(db, `select has_table_privilege($1, $2, 'select') as ok`, [role, `public.${table}`]);
      assertEquals(can, [{ ok: false }], `${role} on ${table}`);
    }
  }
  const cols = await one<{ table_name: string; column_name: string }>(db, `
    select table_name, column_name from information_schema.columns
     where (table_name, column_name) in (('messages', 'photo_path'), ('messages', 'rating'), ('profiles', 'tz'),
       ('profiles', 'share_cooking'), ('profiles', 'memorial'), ('recipe_events', 'cook_id'),
       ('recipe_events', 'duration_s'), ('recipe_events', 'clip_start_s'))
     order by 1, 2`);
  assertEquals(cols.length, 8, JSON.stringify(cols));
  await db.close();
});

t("migrations: either cooked_photos or the plumbing file may run first; the photos bucket stays qa-cook's", async () => {
  for (const plumbingFirst of [false, true]) {
    const db = await database({ plumbingFirst });
    const photo = await one<{ data_type: string }>(db,
      `select data_type from information_schema.columns where table_name = 'messages' and column_name = 'photo_path'`);
    assertEquals(photo, [{ data_type: "text" }], `plumbingFirst=${plumbingFirst}`);
    const buckets = await one<{ id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(db,
      `select id, public, file_size_limit::int as file_size_limit, allowed_mime_types from storage.buckets where id = 'photos'`);
    assertEquals(buckets, [{
      id: "photos", public: false, file_size_limit: 10485760,
      allowed_mime_types: ["image/jpeg", "image/png", "image/heic", "image/webp"],
    }]);
    await db.close();
  }
  // No retention file touches storage (the bucket is qa-cook's alone).
  const { retention } = await migrationFiles();
  for (const [n, sql] of retention) assert(!/storage\./.test(sql.replace(/--.*$/gm, "")), n);
});

t("migrations: the widened checks keep every older kind and refuse junk", async () => {
  const db = await database();
  const thread = await seed(db);
  const msg = (kind: string, body: string | null) =>
    db.query(`insert into public.messages (family_id, thread_id, sender_id, kind, body) values ($1, $2, $3, $4, $5)`,
      [FAM, thread, MOM, kind, body]);
  for (const kind of ["text", "voice", "step", "recipe", "cooked", "request", "question", "system"]) await msg(kind, "x");
  await msg("reaction", "heart");
  await msg("reaction", "just_like_mine");
  await assertRejects(() => msg("reaction", "wow"), Error, "messages_reaction_body_check");
  await assertRejects(() => msg("reaction", null), Error, "messages_reaction_body_check");
  await assertRejects(() => msg("sticker", "x"), Error, "messages_kind_check");
  // A postcard's rating (PR 3): 1-5 pots, or none.
  const rated = (rating: number | null) =>
    db.query(`insert into public.messages (family_id, thread_id, sender_id, kind, recipe_id, rating) values ($1, $2, $3, 'cooked', 'mom-dal', $4)`,
      [FAM, thread, LEO, rating]);
  for (const r of [1, 5, null]) await rated(r);
  for (const r of [0, 6]) await assertRejects(() => rated(r), Error, "check");

  const ev = (kind: string, duration: number | null = null) =>
    db.query(`insert into public.recipe_events (family_id, profile_id, recipe_id, kind, cook_id, duration_s) values ($1, $2, 'mom-dal', $3, $4, $5)`,
      [FAM, LEO, kind, MOM, duration]);
  for (const kind of ["viewed", "cooked", "started"]) await ev(kind);
  await ev("heard", 5);
  await assertRejects(() => ev("liked"), Error, "recipe_events_kind_check");
  await assertRejects(() => ev("heard", 4000), Error, "check");

  // notification_log: one row per (person, dedupe key); null keys never collide.
  const log = (key: string | null) =>
    db.query(`insert into public.notification_log (family_id, profile_id, kind, app_initiated, dedupe_key) values ($1, $2, 'message', false, $3)`,
      [FAM, LEO, key]);
  await log("message:1");
  await assertRejects(() => log("message:1"), Error, "notification_log_dedupe");
  await log(null);
  await log(null);
  await assertRejects(() =>
    db.query(`insert into public.push_tokens (token, family_id, profile_id, platform) values ('not-a-token', $1, $2, 'ios')`, [FAM, LEO]),
  Error, "check");
  await db.query(`insert into public.push_tokens (token, family_id, profile_id, platform) values ('ExponentPushToken[abc]', $1, $2, 'ios')`, [FAM, LEO]);
  await assertRejects(() =>
    db.query(`insert into public.cooking_now (profile_id, family_id, recipe_id, cook_id, step, total) values ($1, $2, 'mom-dal', $3, 9, 8)`, [LEO, FAM, MOM]),
  Error, "cooking_now_step_check");
  await db.close();
});

t("migrations: PR 3's postcard file stands on its own (rating with its check) and leaves photo_path & the bucket alone", async () => {
  const { base, retention, cookedPhotos } = await migrationFiles();
  const postcard = retention.find(([n]) => n.includes("postcard"))!;
  const db = new PGlite();
  await db.exec(SUPABASE);
  for (const [n, sql] of base) await apply(db, n, sql);
  await apply(db, "cooked_photos", cookedPhotos);
  for (const pass of [1, 2]) await apply(db, `${postcard[0]} (alone, pass ${pass})`, postcard[1]);
  const cols = await one<{ column_name: string; data_type: string }>(db,
    `select column_name, data_type from information_schema.columns where table_name = 'messages' and column_name in ('photo_path', 'rating') order by 1`);
  assertEquals(cols, [{ column_name: "photo_path", data_type: "text" }, { column_name: "rating", data_type: "smallint" }]);
  const thread = await seed(db);
  await assertRejects(() =>
    db.query(`insert into public.messages (family_id, thread_id, sender_id, kind, recipe_id, rating) values ($1, $2, $3, 'cooked', 'mom-dal', 9)`, [FAM, thread, LEO]),
  Error, "check");
  assert(!/photo_path|storage\./.test(postcard[1].replace(/--.*$/gm, "")), "photo_path & the bucket are qa-cook's");
  await db.close();
});

t("migrations: the cron file leaves one secret & one of each job, and only its owner runs it", async () => {
  const db = await database(); // applied twice
  assertEquals(await one(db, `select count(*)::int as n from vault.secrets where name = 'edible_cron_secret'`), [{ n: 1 }]);
  assertEquals(await one(db, `select jobname, schedule from cron.job order by jobname`), [
    { jobname: "homecookd-cron-sweep", schedule: "15 4 * * *" },
    { jobname: "homecookd-hourly", schedule: "5 * * * *" },
  ]);
  const [{ secret }] = await one<{ secret: string }>(db, `select secret from vault.secrets where name = 'edible_cron_secret'`);
  assertEquals(secret.length, 64);
  assertEquals(await one(db, `select public.cron_secret_ok($1) as ok`, [secret]), [{ ok: true }]);
  for (const wrong of ["nope", "", null]) assertEquals(await one(db, `select public.cron_secret_ok($1) as ok`, [wrong]), [{ ok: false }]);

  await db.query(`select public.run_cron_hourly('2026-10-25 17:10:00-07')`);
  const [call] = await one<{ url: string; body: Record<string, string>; headers: Record<string, string>; timeout_ms: number }>(db,
    `select url, body, headers, timeout_ms from net.calls order by id desc limit 1`);
  assertEquals(call.url, "https://qeiednrjkiyzbolkepbk.supabase.co/functions/v1/api/cron/hourly");
  assertEquals([call.headers["x-cron-secret"] === secret, call.timeout_ms, Date.parse(call.body.now)],
    [true, 60000, Date.parse("2026-10-26T00:10:00Z")]);

  const grants = await one(db, `
    select r.rolname as role,
           has_function_privilege(r.rolname, 'public.cron_secret_ok(text)', 'execute') as secret_ok,
           has_function_privilege(r.rolname, 'public.run_cron_hourly(timestamptz)', 'execute') as run,
           has_function_privilege(r.rolname, 'public.table_activity(uuid, timestamptz)', 'execute') as activity
      from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by 1`);
  assertEquals(grants, [
    { role: "anon", secret_ok: false, run: false, activity: false },
    { role: "authenticated", secret_ok: false, run: false, activity: false },
    { role: "service_role", secret_ok: true, run: false, activity: true },
  ]);
  await db.close();
});

t("migrations: table_activity runs against the real tables (a cook, a reply, a heard clip)", async () => {
  const db = await database();
  const thread = await seed(db);
  await db.query(`insert into public.recipe_events (family_id, profile_id, recipe_id, kind, cook_id, duration_s, created_at) values
    ($1, $2, 'mom-dal', 'cooked', $3, null, '2026-10-14T18:00:00Z'), ($1, $2, 'mom-dal', 'heard', $3, 7, '2026-10-14T19:00:00Z')`,
    [FAM, LEO, MOM]);
  await db.query(`insert into public.messages (family_id, thread_id, sender_id, kind, body, created_at) values
    ($1, $2, $3, 'text', 'So good', '2026-10-15T18:00:00Z'), ($1, $2, $3, 'reaction', 'heart', '2026-10-15T19:00:00Z')`,
    [FAM, thread, MOM]);
  const [{ a }] = await one<{ a: Record<string, unknown>[] }>(db, `select public.table_activity($1, '2026-10-01') as a`, [FAM]);
  assertEquals(a.map((r) => [r.kind, r.actor_id, r.target_cook_id ?? r.thread_with ?? null]), [
    ["cooked", LEO, MOM],
    ["heard", LEO, MOM],
    ["message", MOM, LEO],
    ["message", MOM, LEO], // a cook's heart counts toward the table (handoff 3.2: "any message ... reaction")
  ]);
  await db.close();
});

// The account purge's sign-up log step (pipeline/account_purge.py), run for real: the SQL Python writes, in an
// in-memory Postgres (PGlite) with every migration applied. It needs Python, so it runs only when given --allow-run:
//   npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read --allow-run --allow-net supabase/tests/account_purge_sql_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const canRun = (await Deno.permissions.query({ name: "run", command: ".venv/bin/python" })).state === "granted";
const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, ignore: !canRun, sanitizeOps: false, sanitizeResources: false, fn });

const ROOT = new URL("../../", import.meta.url);
const DIR = new URL("supabase/migrations/", ROOT);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (c: string) => c.repeat(64);
const FAM = uuid(1), OTHER_FAM = uuid(2), HER = uuid(10), SIBLING = uuid(11), STRANGER = uuid(12);

/** Stand-ins for what Supabase has and PGlite doesn't (as retention_migrations_sql_test.ts). */
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
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
    headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
  create function cron.unschedule(job_id bigint) returns boolean language sql as
    $$ delete from cron.job where jobid = job_id returning true $$;
`;

async function database(): Promise<PGlite> {
  const names: string[] = [];
  for await (const e of Deno.readDir(DIR)) if (e.isFile && e.name.endsWith(".sql")) names.push(e.name);
  const db = new PGlite();
  await db.exec(SUPABASE);
  for (const n of names.sort()) {
    const sql = await Deno.readTextFile(new URL(n, DIR));
    await db.exec(sql.replace(/^create extension if not exists (pgcrypto|pg_cron|pg_net)\b[^;]*;$/gm, ""));
  }
  return db;
}

/** The SQL account_purge.py writes for this person. */
async function python(fn: "plan_sql" | "purge_sql", profile: string, family: string): Promise<string> {
  const code = `import sys; from pipeline import account_purge as a; print(a.${fn}(sys.argv[1], sys.argv[2]))`;
  const out = await new Deno.Command(".venv/bin/python", { args: ["-c", code, profile, family], cwd: ROOT }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout);
}

type Plan = { counts: Record<string, number>; signups_unsure: number };
async function plan(db: PGlite, profile = HER, family = FAM): Promise<Plan> {
  const res = await db.query<{ plan: Plan }>(await python("plan_sql", profile, family));
  return res.rows[0].plan;
}
const purge = async (db: PGlite, profile = HER, family = FAM) => db.exec(await python("purge_sql", profile, family));

async function people(db: PGlite) {
  await db.exec(`
    insert into public.families (id, name, code_hash) values ('${FAM}', 'Her family', '${hash("a")}'), ('${OTHER_FAM}', 'Others', '${hash("b")}');
    insert into public.profiles (id, family_id, name, role, email) values
      ('${HER}', '${FAM}', 'Asha', 'learner', 'asha@example.com'),
      ('${SIBLING}', '${FAM}', 'Leo', 'learner', 'leo@example.com'),
      ('${STRANGER}', '${OTHER_FAM}', 'Asha', 'learner', 'other-asha@example.com');
    insert into public.identities (provider, subject, profile_id, email) values
      ('apple', 'her-apple', '${HER}', 'asha.relay@example.com');
  `);
}
async function signup(db: PGlite, name: string, email: string | null, token: string | null, family: string | null = FAM) {
  await db.query(`insert into public.signups (name, email, share_token, family_id) values ($1, $2, $3, $4)`, [name, email, token, family]);
}
const rows = async (db: PGlite) =>
  (await db.query<{ name: string; email: string | null; share_token: string | null }>(
    `select name, email, share_token from public.signups order by share_token nulls first, name, email`,
  )).rows.map((r) => [r.name, r.email, r.share_token]);

t("her rows go, a card side's row stays blank, and everyone else's are untouched", async () => {
  const db = await database();
  await people(db);
  await signup(db, "Asha", "asha@example.com", null); // her email, no token: goes
  await signup(db, "Asha S", "ASHA.RELAY@example.com", "abc123"); // her account's email, any case, a share link: goes
  await signup(db, "Asha", null, null); // no email, her family, her name: goes
  await signup(db, "Asha", "asha@example.com", "link:card1:cook"); // a card side: stays, blanked
  await signup(db, "Mom", null, `link:claim:${HER}`); // her claim, another name: stays, blanked
  await signup(db, "Leo", "leo@example.com", "link:card2:kid"); // her brother
  await signup(db, "Leo", null, null); // her brother, no email
  await signup(db, "Asha", null, null, OTHER_FAM); // the other Asha, other family
  await signup(db, "Asha", "other-asha@example.com", null, OTHER_FAM); // the other Asha
  await signup(db, "Asha", "old-asha@example.com", null); // her name, her family, an email that isn't hers: unsure

  const before = await plan(db);
  assertEquals(before.counts["signups"], 3);
  assertEquals(before.counts["signups.name"], 2);
  assertEquals(before.signups_unsure, 1);

  await purge(db);
  assertEquals(await rows(db), [
    ["Asha", "old-asha@example.com", null],
    ["Asha", "other-asha@example.com", null],
    ["Asha", null, null],
    ["Leo", null, null],
    ["Deleted", null, "link:card1:cook"],
    ["Leo", "leo@example.com", "link:card2:kid"],
    ["Deleted", null, `link:claim:${HER}`],
  ]);
});

t("same name: a row with no email isn't touched when another profile there has that name, removed or not", async () => {
  const db = await database();
  await people(db);
  await db.exec(`insert into public.profiles (id, family_id, name, role, removed_at)
    values ('${uuid(13)}', '${FAM}', 'asha ', 'learner', now())`);
  await signup(db, "Asha", null, null);
  await signup(db, "Asha", "asha@example.com", null); // her email still tells them apart
  await signup(db, "Asha", null, `link:claim:${HER}`); // and so does her claim

  const p = await plan(db);
  assertEquals([p.counts["signups"], p.counts["signups.name"], p.signups_unsure], [1, 1, 1]);
  await purge(db);
  assertEquals(await rows(db), [["Asha", null, null], ["Deleted", null, `link:claim:${HER}`]]);
});

t("an email someone else holds too isn't a match", async () => {
  const db = await database();
  await people(db);
  await db.exec(`insert into public.identities (provider, subject, profile_id, email) values
    ('google', 'leo-google', '${SIBLING}', 'asha.relay@example.com')`);
  await signup(db, "Family", "asha.relay@example.com", null);

  const p = await plan(db);
  assertEquals([p.counts["signups"], p.signups_unsure], [0, 1]);
  await purge(db);
  assertEquals(await rows(db), [["Family", "asha.relay@example.com", null]]);
});

t("her invite's row is hers; the keep-the-count rows of other people's links aren't", async () => {
  const db = await database();
  await people(db);
  const inv = uuid(20);
  await db.exec(`insert into public.invites (id, family_id, profile_id, inviter_id, token_hash, code_hash, expires_at)
    values ('${inv}', '${FAM}', '${HER}', '${SIBLING}', '${hash("c")}', '${hash("d")}', now() + interval '1 day')`);
  await signup(db, "Mum", null, `invite:${inv}`);
  await signup(db, "Leo", null, `invite:${uuid(21)}`);
  await purge(db);
  assertEquals(await rows(db), [["Leo", null, `invite:${uuid(21)}`]]);
});

t("all or nothing, and a second run finds nothing", async () => {
  const db = await database();
  await people(db);
  await signup(db, "Asha", "asha@example.com", null);
  await signup(db, "Asha", "asha@example.com", "link:card1:cook");

  // In another family: refused, and the sign-up log is as it was.
  await assertRejects(() => purge(db, HER, OTHER_FAM));
  assertEquals((await rows(db)).length, 2);

  await purge(db);
  const after = await rows(db);
  assertEquals(after, [["Deleted", null, "link:card1:cook"]]);
  const again = await plan(db);
  assertEquals([again.counts["signups"], again.counts["signups.name"], again.signups_unsure], [0, 0, 0]);
  await purge(db);
  assertEquals(await rows(db), after);
});

t("one join per card side still holds after the row is blanked", async () => {
  const db = await database();
  await people(db);
  await signup(db, "Asha", "asha@example.com", "link:card1:cook");
  await purge(db);
  await assertRejects(() => signup(db, "Someone", "new@example.com", "link:card1:cook"));
});

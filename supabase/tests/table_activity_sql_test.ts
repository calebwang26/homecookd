// The SQL of public.table_activity (supabase/migrations/20261018100300_retention_table.sql, PR 5),
// run for real in an in-memory Postgres (PGlite): which rows come back and in what shape, the
// heard >= 3 s filter, system notes left out, thread_with for a 1:1 thread vs the circle,
// delivered recordings per recipient with the dish they became (an empty recipient list still counts
// once), the 15-minute
// collapse, p_since and other families, and that only the service role may call it.
// tablePr_test.ts covers the api side with a stand-in for this function; this file pins the function.
//
// The stand-in tables carry only the columns the function reads (the real ones are in
// 20261015000000_messages_backend.sql, 20261016120000_family_circle.sql and
// 20261018100000_retention_plumbing.sql). The live checks are C1-C2 in RETENTION-WIRING.md, PR 5 wiring.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/table_activity_sql_test.ts

import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

const MIGRATION = new URL("../migrations/20261018100300_retention_table.sql", import.meta.url);

const F = "11111111-1111-4111-8111-111111111111";
const G = "99999999-9999-4999-8999-999999999999";
const MOM = "22222222-2222-4222-8222-222222222222";
const LEO = "33333333-3333-4333-8333-333333333333";
const MAYA = "44444444-4444-4444-8444-444444444444";
const PAIR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Mom (a, the smaller id) & Leo (b)
const CIRCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.threads (id uuid primary key, family_id uuid not null, a_profile uuid, b_profile uuid,
      kind text not null default 'pair');
    create table public.messages (id uuid primary key default gen_random_uuid(), family_id uuid not null,
      thread_id uuid not null references public.threads(id), sender_id uuid not null, kind text not null,
      recipe_id text, created_at timestamptz not null default now());
    create table public.recipe_events (id uuid primary key default gen_random_uuid(), family_id uuid not null,
      profile_id uuid not null, recipe_id text not null, kind text not null, cook_id uuid, duration_s numeric,
      created_at timestamptz not null default now());
    create table public.pending_sends (job_id text primary key, family_id uuid not null, sender_id uuid not null,
      recipient_ids uuid[] not null, delivered_at timestamptz, created_at timestamptz not null default now(),
      recipe_id text);
  `);
  await db.exec(await Deno.readTextFile(MIGRATION));
  await db.exec(`
    insert into public.threads (id, family_id, a_profile, b_profile, kind) values
      ('${PAIR}', '${F}', '${MOM}', '${LEO}', 'pair'),
      ('${CIRCLE}', '${F}', null, null, 'circle'),
      ('${OTHER}', '${G}', null, null, 'circle');
    insert into public.messages (family_id, thread_id, sender_id, kind, created_at) values
      ('${F}', '${PAIR}', '${LEO}', 'text', '2026-10-12T10:00:00Z'),
      ('${F}', '${PAIR}', '${LEO}', 'text', '2026-10-12T10:05:00Z'),     -- same 15-min slot: collapses
      ('${F}', '${PAIR}', '${LEO}', 'text', '2026-10-12T10:16:00Z'),     -- the next slot
      ('${F}', '${PAIR}', '${MOM}', 'voice', '2026-10-12T11:00:00Z'),
      ('${F}', '${PAIR}', '${MOM}', 'system', '2026-10-12T11:01:00Z'),   -- a system note: never
      ('${F}', '${CIRCLE}', '${MAYA}', 'question', '2026-10-13T09:00:00Z'),
      ('${F}', '${PAIR}', '${LEO}', 'text', '2025-01-01T00:00:00Z'),     -- before p_since
      ('${G}', '${OTHER}', '${MAYA}', 'text', '2026-10-13T09:00:00Z');   -- another family
    insert into public.recipe_events (family_id, profile_id, recipe_id, kind, cook_id, duration_s, created_at) values
      ('${F}', '${LEO}', 'mom-dal', 'cooked', '${MOM}', null, '2026-10-14T18:00:00Z'),
      ('${F}', '${LEO}', 'mom-dal', 'heard', '${MOM}', 2, '2026-10-14T18:01:00Z'),       -- under 3 s: never
      ('${F}', '${LEO}', 'mom-dal', 'heard', '${MOM}', 5, '2026-10-14T18:02:00Z'),
      ('${F}', '${LEO}', 'mom-dal', 'heard', '${MOM}', 9, '2026-10-14T18:03:00Z'),       -- same slot: max 9
      ('${F}', '${LEO}', 'old-dal', 'cooked', null, null, '2026-10-15T18:00:00Z'),        -- no cook: recipe_id kept
      ('${F}', '${LEO}', 'mom-dal', 'viewed', '${MOM}', null, '2026-10-15T18:00:00Z'),    -- never
      ('${F}', '${LEO}', 'mom-dal', 'started', '${MOM}', null, '2026-10-15T18:00:00Z');   -- never
    insert into public.pending_sends (job_id, family_id, sender_id, recipient_ids, delivered_at, recipe_id) values
      ('job-1', '${F}', '${MOM}', array['${LEO}', '${MAYA}']::uuid[], '2026-10-16T08:00:00Z', 'mom-dal'),
      ('job-2', '${F}', '${MOM}', array[]::uuid[], '2026-10-16T09:00:00Z', null),         -- to nobody: one row
      ('job-3', '${F}', '${MOM}', array['${LEO}']::uuid[], null, 'mom-soup');             -- not out yet: never
  `);
  return db;
}

async function activity(db: PGlite, family: string, since: string): Promise<Record<string, unknown>[]> {
  const r = await db.query<{ a: Record<string, unknown>[] }>(`select public.table_activity($1, $2) as a`, [family, since]);
  return r.rows[0].a;
}

const iso = (s: unknown) => new Date(String(s)).toISOString();

t("table_activity: one jsonb array of every kind, collapsed by slot, nulls left out", async () => {
  const db = await database();
  // The array is ordered by time; ties (one recording, two recipients) in no set order, so by id here.
  const rows: Record<string, unknown>[] = (await activity(db, F, "2026-01-01T00:00:00Z"))
    .map((r): Record<string, unknown> => ({ ...r, at: iso(r.at) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.target_kid_id ?? "").localeCompare(String(b.target_kid_id ?? "")));
  assertEquals(rows, [
    { at: "2026-10-12T10:00:00.000Z", actor_id: LEO, kind: "message", thread_with: MOM }, // 10:00 & 10:05 as one
    { at: "2026-10-12T10:16:00.000Z", actor_id: LEO, kind: "message", thread_with: MOM },
    { at: "2026-10-12T11:00:00.000Z", actor_id: MOM, kind: "message", thread_with: LEO }, // the other side of the pair
    { at: "2026-10-13T09:00:00.000Z", actor_id: MAYA, kind: "message" }, // the circle: no thread_with
    { at: "2026-10-14T18:00:00.000Z", actor_id: LEO, kind: "cooked", target_cook_id: MOM },
    { at: "2026-10-14T18:02:00.000Z", actor_id: LEO, kind: "heard", target_cook_id: MOM, duration_s: 9 }, // 2 s dropped
    { at: "2026-10-15T18:00:00.000Z", actor_id: LEO, kind: "cooked", recipe_id: "old-dal" },
    { at: "2026-10-16T08:00:00.000Z", actor_id: MOM, kind: "published", target_kid_id: LEO, recipe_id: "mom-dal" },
    { at: "2026-10-16T08:00:00.000Z", actor_id: MOM, kind: "published", target_kid_id: MAYA, recipe_id: "mom-dal" },
    { at: "2026-10-16T09:00:00.000Z", actor_id: MOM, kind: "published" }, // went to nobody: still once (no dish known)
  ]);
  await db.close();
});

t("table_activity: p_since cuts the start, an unknown family is [], and a heard row needs 3 s", async () => {
  const db = await database();
  const recent = await activity(db, F, "2026-10-14T00:00:00Z");
  assertEquals(recent.map((r) => r.kind), ["cooked", "heard", "cooked", "published", "published", "published"]);
  assertEquals(await activity(db, "00000000-0000-4000-8000-000000000000", "2026-01-01T00:00:00Z"), []);
  // Exactly 3 s counts; nothing under it ever leaves the database.
  await db.exec(`insert into public.recipe_events (family_id, profile_id, recipe_id, kind, cook_id, duration_s, created_at)
    values ('${F}', '${MAYA}', 'mom-dal', 'heard', '${MOM}', 3, '2026-10-17T10:00:00Z'),
           ('${F}', '${MAYA}', 'mom-dal', 'heard', '${MOM}', 2.9, '2026-10-17T11:00:00Z'),
           ('${F}', '${MAYA}', 'mom-dal', 'heard', '${MOM}', null, '2026-10-17T12:00:00Z')`);
  const heard = (await activity(db, F, "2026-10-17T00:00:00Z")).filter((r) => r.kind === "heard");
  assertEquals(heard.map((r) => [iso(r.at), Number(r.duration_s)]), [["2026-10-17T10:00:00.000Z", 3]]);
  await db.close();
});

t("table_activity: security definer, stable, empty search_path; only the service role may call it", async () => {
  const db = await database();
  const proc = await db.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] }>(
    `select prosecdef, provolatile, proconfig from pg_proc where proname = 'table_activity'`,
  );
  assertEquals(proc.rows, [{ prosecdef: true, provolatile: "s", proconfig: ['search_path=""'] }]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assertRejects(() => activity(db, F, "2026-01-01T00:00:00Z"), Error, "permission denied for function table_activity");
    await db.exec(`reset role`);
  }
  await db.exec(`set role service_role`);
  assertEquals((await activity(db, F, "2026-01-01T00:00:00Z")).length, 10);
  await db.exec(`reset role`);
  await db.close();
});

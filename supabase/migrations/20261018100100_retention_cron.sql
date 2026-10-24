-- Hourly cron for retention pushes (docs/build/RETENTION-HANDOFF.md 2.5 "Cron"): pg_cron calls the
-- api's POST /cron/hourly at minute 5 of every hour through pg_net, with an x-cron-secret header.
-- The handler picks people whose LOCAL hour is a target (Sunday 17:00 for the kid's nudge, the 1st
-- at 10:00 for the recap), so one UTC schedule serves every zone, half-hour ones included.
--
-- The secret is generated here, inside Vault. It is never in git, never printed and never set by
-- hand: run_cron_hourly() reads it to send the header and cron_secret_ok() reads it to check one,
-- so the api function needs no secret of its own. Both functions are revoked from client keys, or
-- anon could trigger runs or probe the secret through PostgREST /rpc.
--
-- APPLY ORDER (exactly this; MCP apply_migration, never `supabase db push`):
--   1. 20261018100000_retention_plumbing.sql.
--   2. Deploy the api function that has POST /cron/hourly (MCP deploy_edge_function with every file
--      under supabase/functions/api/, entrypoint as get_edge_function shows it, verify_jwt false).
--   3. This file. (Applied before step 2, the hourly call would only 404 until the deploy.)
--   4. Check, as postgres (the secret never leaves the database):
--        select public.run_cron_hourly('2026-10-25 17:10:00-07');
--        select status_code, left(content, 200) from net._http_response order by created desc limit 1;
--      -> 200 {"ok":true,"due":{...},"sent":0,...}. A wrong secret:
--        curl -s -X POST "$API/cron/hourly" -H 'x-cron-secret: nope'   -> 401 {"error":"Not allowed"}
--        select jobname, schedule, active from cron.job;
--
-- Rotate the secret (both sides read Vault, so it takes effect at once):
--   select vault.update_secret((select id from vault.secrets where name = 'edible_cron_secret'),
--     encode(extensions.gen_random_bytes(32), 'hex'));
-- Pause: select cron.alter_job((select jobid from cron.job where jobname = 'homecookd-hourly'), active := false);

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 1. The shared secret: 32 random bytes, hex. Made once; re-running this file keeps it.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'edible_cron_secret',
  'x-cron-secret for POST /functions/v1/api/cron/hourly (pg_cron -> api)'
)
where not exists (select 1 from vault.secrets where name = 'edible_cron_secret');

-- 2. The api's check of the header (db.rpc('cron_secret_ok', {p_secret})). It compares SHA-256
--    digests, so the time a comparison takes says nothing about the secret's characters (bytea
--    equality isn't constant time, but nobody can steer a digest byte by byte); the api also rate
--    limits wrong guesses. Empty, null or a missing secret is always false.
create or replace function public.cron_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_secret, '') <> '' and coalesce(
    (select extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
       from vault.decrypted_secrets s
      where s.name = 'edible_cron_secret'
      limit 1),
    false);
$$;

revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

-- 3. The hourly call. p_now (tests only) becomes the body's {now}, which the api accepts only with
--    the secret. 60 s timeout: pg_net's 2 s default is too short for a run that sends pushes. The
--    project URL is not a secret (supabase/config.toml); a local `db reset` would just get a 401.
create or replace function public.run_cron_hourly(p_now timestamptz default null)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://aaxyabymvwxlxrxwxgwv.supabase.co/functions/v1/api/cron/hourly',
    body := case when p_now is null then '{}'::jsonb else jsonb_build_object('now', p_now) end,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'edible_cron_secret' limit 1)
    ),
    timeout_milliseconds := 60000
  );
$$;

-- Only its owner (postgres: pg_cron, and the SQL editor / MCP for tests) runs it.
revoke all on function public.run_cron_hourly(timestamptz) from public, anon, authenticated, service_role;

-- 4. The schedules. cron.unschedule(name) errors when the job is missing, so unschedule by id first;
--    re-running this file leaves exactly one of each.
select cron.unschedule(jobid) from cron.job where jobname = 'homecookd-hourly';
select cron.schedule('homecookd-hourly', '5 * * * *', 'select public.run_cron_hourly()');

-- cron.job_run_details is never cleaned on its own.
select cron.unschedule(jobid) from cron.job where jobname = 'homecookd-cron-sweep';
select cron.schedule('homecookd-cron-sweep', '15 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

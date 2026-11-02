-- Which app builds still call the api function (docs/build/CUTOVER.md, step 13): one row per UTC day, platform
-- and build, written by supabase/functions/api/appBuilds.ts while LOG_APP_BUILDS is on. It ships off, so this
-- table stays empty until then. The build is the number in an iPhone's user agent (build 6 is 1.0); the user
-- agent itself, the IP and anything about the person are never stored. first_seen and last_seen are when an
-- isolate first wrote it that day, so they're rough.
--
-- Same access model as the rest: RLS on, no policies, no grants to anon/authenticated; only the api function
-- (service role) writes it. Additive and idempotent. Apply BEFORE deploying an api with LOG_APP_BUILDS = true.
--
-- Kept 120 days, by a daily pg_cron job. TODO(caleb): 120 days is the default. Step 13 watches a whole month,
-- so this keeps about four to compare.

create table if not exists public.app_builds_seen (
  day date not null,
  platform text not null check (platform in ('ios', 'android', 'web', 'other')),
  -- CFBundleVersion (up to three numbers with dots), or 'unknown' for anything that doesn't say one.
  build text not null check (build ~ '^([0-9]{1,6}(\.[0-9]{1,6}){0,2}|unknown)$'),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (day, platform, build)
);

alter table public.app_builds_seen enable row level security;
revoke all on public.app_builds_seen from anon, authenticated;
grant select, insert, update, delete on public.app_builds_seen to service_role;

comment on table public.app_builds_seen is
  'Which app builds called the api, per UTC day (appBuilds.ts, CUTOVER.md step 13). Build number and platform '
  'only, never the user agent or the person. Rows go after 120 days (homecookd-app-builds-sweep).';

-- The sweep. cron.unschedule(name) errors when the job is missing, so unschedule by id first; re-running this
-- file leaves exactly one.
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'homecookd-app-builds-sweep';
select cron.schedule('homecookd-app-builds-sweep', '25 4 * * *',
  $$delete from public.app_builds_seen where day < (now() at time zone 'utc')::date - 120$$);

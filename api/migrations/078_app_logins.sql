-- 078: the api's and the worker's own logins, in place of the RDS master one (infra/README.md, "Database logins"). Each reads and writes
-- rows and nothing more: no schema change, no new role, no other database. Migrations keep the master login, in a task of their own.
-- It changes no table, so the release still running doesn't notice. Safe to run twice.
--
-- Two logins, not one: the worker opens videos anyone can upload and reads model output, so it reaches only what its jobs use
-- (pipeline/queue_db.py), never sessions, devices or messages. The api reaches every table, including ones later migrations make.
-- **A later table the worker needs is granted to it in the migration that makes it.** pipeline/test_queue_worker.py and
-- api/test/jobsWorker.test.ts run the real worker as homecookd_worker, so a missing grant fails there first.
--
-- On RDS each logs in with an IAM token (rds_iam), so no password exists anywhere. Local Postgres has no rds_iam, and no password is
-- set, so nothing logs in as these there.

do $$
declare
  login text;
  other text;
begin
  foreach login in array array['homecookd_api', 'homecookd_worker'] loop
    if not exists (select 1 from pg_roles where rolname = login) then
      execute format('create role %I login nosuperuser nocreatedb nocreaterole noreplication nobypassrls', login);
    elsif exists (select 1 from pg_roles where rolname = login and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
       or exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
                   where m.member = (select oid from pg_roles where rolname = login) and r.rolname <> 'rds_iam') then
      raise exception 'the role % already exists with more than a row login can have', login;
    elsif not (select rolcanlogin from pg_roles where rolname = login) then
      execute format('alter role %I login', login);
    end if;
    if exists (select 1 from pg_roles where rolname = 'rds_iam') then
      execute format('grant rds_iam to %I', login);
    end if;
    execute format('grant connect on database %I to %I', current_database(), login);
  end loop;

  -- Nobody else may make temporary tables here, or connect to another database on this server that this login owns (RDS's postgres).
  -- The owner keeps both. RDS's own databases and the empty templates aren't this login's to change.
  execute format('revoke temporary on database %I from public', current_database());
  for other in
    select datname from pg_database
     where datname <> current_database() and not datistemplate and datallowconn and pg_has_role(datdba, 'MEMBER')
  loop
    execute format('revoke connect on database %I from public', other);
  end loop;
end $$;

revoke create on schema public from public;
grant usage on schema public to homecookd_api, homecookd_worker;

-- The api: every table's rows, and the same on tables later migrations make (they run as this same login).
grant select, insert, update, delete on all tables in schema public to homecookd_api;
grant usage, select on all sequences in schema public to homecookd_api;
alter default privileges in schema public grant select, insert, update, delete on tables to homecookd_api;
alter default privileges in schema public grant usage, select on sequences to homecookd_api;

-- Which migrations ran is the migration task's business only. (pipeline/test_queue_worker.py runs these files without migrate.ts.)
do $$
begin
  if to_regclass('schema_migrations') is not null then
    revoke all on schema_migrations from homecookd_api;
  end if;
end $$;

-- The worker: what pipeline/queue_db.py does, and nothing else. No delete anywhere. An identity column numbers rows without a grant on
-- its sequence.
grant select, update on jobs to homecookd_worker;
grant select, insert, update on recipes, model_calls, daily_spend to homecookd_worker;
grant select on people, recordings, homie_prompts to homecookd_worker;
grant insert on questions, outbox to homecookd_worker;
-- A follow-up's "on conflict do nothing" reads the key it checks, and only that: never what anyone asked.
grant select (recipe_id, follow_up_id) on questions to homecookd_worker;
-- recipes' triggers read these (012_sync.sql).
grant select on sync_copies, sync_deleted to homecookd_worker;

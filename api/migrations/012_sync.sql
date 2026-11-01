-- 012: the temporary one-way copy of families, people and recipes from Convex and Supabase (SCHEMA.md M1, docs/build/SYNC-MIGRATION.md).
-- All of it comes off at cutover (AWS-MIGRATION, "Cutover list"): the triggers, these tables, api/src/modules/sync. No FK here points at a
-- copied table, because a deletion's record has to exist before, and without, the row it names.

-- Which copies are read-only. Off until the sync's first real run turns it on, so nothing changes while the switch is off.
create table sync_copies (
  table_name text primary key check (table_name in ('families', 'people', 'recipes')),
  read_only boolean not null default false,
  moved_at timestamptz -- this area moved: the sync stops writing the table and the api may
);
insert into sync_copies (table_name) values ('families'), ('people'), ('recipes');

-- Where each kind of run is. The lease stops two api tasks doing the same run without holding a connection through outside calls.
create table sync_state (
  name text primary key check (name in ('pass', 'deletions', 'reconcile')),
  lease_id text,
  lease_until timestamptz,
  pass_no bigint not null default 0,
  at_table text check (at_table in ('families', 'people', 'recipes')), -- null: no pass running
  page_cursor text, -- Convex's own cursor inside at_table. Opaque, no family content
  after_ms double precision not null default 0, -- deletions: Convex's _creationTime read up to, less an overlap
  started_at timestamptz,
  finished_at timestamptz,
  last_success_at timestamptz,
  alerted_at timestamptz,
  last_report jsonb -- counts and ids only: never a name, an email, a place or a recipe's words
);
insert into sync_state (name) values ('pass'), ('deletions'), ('reconcile');

-- What has been deleted. Ids only, kept until the sync is removed. It's what stops a stale row bringing someone back, even a row
-- that arrives before their first copy does.
create table sync_deleted (
  kind text not null check (kind in ('person', 'recipe')),
  id text not null,
  supabase_id text, -- a person's old id: their data can't come back through a second row either
  deleted_at timestamptz not null,
  noted_at timestamptz not null default now(),
  primary key (kind, id)
);
create index sync_deleted_supabase on sync_deleted (supabase_id) where supabase_id is not null; -- sync_keep_person_deleted

-- Recipes the sync has read, by the pass that last read them. Convex hard-deletes recipes, so a row no finished pass read is gone at the
-- source. Only ids here, so the sweep can't touch a recipe the sync never landed.
create table sync_recipe_seen (
  recipe_id text primary key,
  pass_no bigint not null
);
create index sync_recipe_seen_pass on sync_recipe_seen (pass_no); -- the sweep

-- A row the sync held out, by id and by the rule it broke. Cleared when the row lands. The rule is a constraint's name: never the row's values.
create table sync_issues (
  table_name text not null,
  row_id text not null,
  rule text not null check (char_length(rule) <= 100),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times int not null default 1,
  primary key (table_name, row_id, rule)
);

-- Only the sync writes a read-only copy. It says so per transaction with a local setting, so this catches a route that writes by mistake.
-- It isn't a security boundary while every task logs in as one user: a limited login is on the Cutover list, and is the real one.
create function sync_guard_copy() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('homecookd.sync_writer', true), '') <> 'on'
     and exists (select 1 from sync_copies c where c.table_name = tg_table_name and c.read_only and c.moved_at is null) then
    raise exception 'this table is a read-only copy until its area moves' using errcode = 'HC001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- A deleted person never comes back, whoever writes, in whatever order. Everyone touching one person's data takes the same lock, so a
-- row being written while the deletion commits is either blanked by it or refused after it. There is no in-between.
create function sync_keep_person_deleted() returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null then return new; end if; -- people_tombstone_blank checks it holds nothing
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    raise exception 'a deleted person stays deleted' using errcode = 'HC002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sync-person:' || new.id, 0));
  if exists (select 1 from sync_deleted d where d.kind = 'person' and d.id = new.id)
     or (new.supabase_id is not null and exists (select 1 from sync_deleted d where d.supabase_id = new.supabase_id)) then
    raise exception 'a deleted person stays deleted' using errcode = 'HC002';
  end if;
  return new;
end $$;

-- The same for a recipe, or any recipe of a deleted cook.
create function sync_keep_recipe_deleted() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('sync-person:' || new.cook_id, 0));
  if exists (select 1 from sync_deleted d where (d.kind = 'recipe' and d.id = new.id) or (d.kind = 'person' and d.id = new.cook_id)) then
    raise exception 'a deleted recipe stays deleted' using errcode = 'HC002';
  end if;
  return new;
end $$;

-- Triggers run in name order: read-only first.
create trigger sync_1_read_only before insert or update or delete on families for each row execute function sync_guard_copy();
create trigger sync_1_read_only before insert or update or delete on people for each row execute function sync_guard_copy();
create trigger sync_1_read_only before insert or update or delete on recipes for each row execute function sync_guard_copy();
create trigger sync_1_read_only_truncate before truncate on families for each statement execute function sync_guard_copy();
create trigger sync_1_read_only_truncate before truncate on people for each statement execute function sync_guard_copy();
create trigger sync_1_read_only_truncate before truncate on recipes for each statement execute function sync_guard_copy();
create trigger sync_2_stays_deleted before insert or update on people for each row execute function sync_keep_person_deleted();
create trigger sync_2_stays_deleted before insert or update on recipes for each row execute function sync_keep_recipe_deleted();

-- 071: when a recipe last changed, for the live poll's cheap check (docs/build/LIVE-UPDATES.md, "How later areas plug in"; JOBS-MIGRATION.md). A trigger keeps it, because three
-- writers touch this table (the api, the worker, the sync) and a column each must remember would be missed. Safe while the previous release runs: the default needs no rewrite,
-- and none of them names the column. The sync writes only what differs, so its passes don't move it.
alter table recipes add column updated_at timestamptz not null default now();

create function recipes_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger recipes_touch before update on recipes for each row execute function recipes_touch();

-- 010: one holder hears a clip at a time, and the sweep's own indexes (docs/build/DISH-MIGRATION.md). Adding a nullable column rewrites nothing, and no
-- table has real rows yet, so plain CREATE INDEX blocks no one.

-- The clip is being heard, since then: dish.hear and a merge can arrive together, and Ink must run once. A holder that died stops counting after a while.
alter table dish_answers add column hearing_at timestamptz;

-- The sweep can reach only the private bucket, and owns only anonymous uploads (files.capability_hash).
create index files_dish_orphans on files (created_at)
  where bucket = 'private' and capability_hash is not null and attached_at is null and delete_requested_at is null and deleted_at is null;
create index files_dish_to_delete on files (delete_requested_at)
  where bucket = 'private' and capability_hash is not null and delete_requested_at is not null and deleted_at is null;

-- 009: what the dish ask's hourly sweep reads (docs/build/DISH-MIGRATION.md). No table has real rows yet, so plain CREATE INDEX
-- doesn't block anyone. Once these tables hold real rows, a change like this needs `-- migrate: no-transaction` (migrate.ts).

-- C4: an anonymous card's ip_key is nulled after 90 days.
create index dish_asks_ip_key_old on dish_asks (created_at) where ip_key is not null;
create index files_ip_key_old on files (created_at) where ip_key is not null;

-- A deleted file's row stays for a week, so a repeated sweep is harmless, and then goes.
create index files_deleted_old on files (deleted_at) where deleted_at is not null;

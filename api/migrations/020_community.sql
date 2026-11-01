-- 020: what Community's lists read (docs/build/COMMUNITY-MIGRATION.md). No table has real rows yet, so plain CREATE INDEX blocks no one.
-- Once these tables hold real rows, a change like this needs `-- migrate: no-transaction` (migrate.ts).

-- My family's swaps, newest first, one page at a time. The unique index on these rows sorts by recipe, not by time.
create index swap_requests_asked_by_us on swap_requests (requester_family_id, created_at desc, id desc);

-- A recipe's newest "put it on the map" ask. Questions are mostly cooking questions, so questions_recipe_recent could read many to find one.
create index questions_share_recent on questions (recipe_id, created_at desc) where kind = 'share';

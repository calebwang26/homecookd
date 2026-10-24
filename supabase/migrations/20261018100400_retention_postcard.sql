-- Retention PR 3, "Send it home, get one back" (docs/build/RETENTION-HANDOFF.md 3.4): the postcard's
-- optional rating ("How close to Mom's?", 1-5 pots) on the kid's own `cooked` message, set by
-- POST /messages/:id/postcard together with the photo.
--
-- Idempotent, and a no-op where PR 1's 20261018100000_retention_plumbing.sql has run (it adds the same
-- column with the same check, `if not exists`). This file only makes PR 3's schema stand on its own.
-- The photo is messages.photo_path, added by qa-cook's 20261018000000_cooked_photos.sql: not re-added
-- here. The private `photos` bucket is qa-cook's alone: nothing here touches storage.
--
-- Apply (MCP apply_migration, name `retention_postcard`) BEFORE the api deploy that has
-- POST /messages/:id/postcard: from that deploy on, every message read selects `rating`.

alter table public.messages
  add column if not exists rating smallint check (rating between 1 and 5);

comment on column public.messages.rating is
  'A postcard''s optional "How close to Mom''s?" (1-5 pots), on the kid''s own cooked message.';

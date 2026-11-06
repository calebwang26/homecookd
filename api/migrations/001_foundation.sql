-- 001: shared value types for homecookd's one Postgres schema (docs/build/SCHEMA.md).
-- Conventions used by every later file:
--   ids        text primary keys: Convex ids and Supabase uuids as they are; new rows get gen_random_uuid()::text.
--   times      timestamptz, never epoch ms.
--   choices    text with a CHECK, because a Postgres enum is harder to change compatibly.
--   files      an S3 key (domain s3_key), never a URL.
--   -- personal marks personal data. docs/build/SCHEMA.md says what account deletion does to each table.
-- Foreign keys: people and families are never hard-deleted (a deleted person is a blank tombstone), so references to them
-- use the default NO ACTION. A row that holds a file key never cascades: the delete must fail rather than lose the only
-- record of a file that still has to come off S3.

-- A key inside one of our S3 buckets. The bucket comes from the column's role (or files.bucket). A host never goes in, so
-- hosts can change. A trailing slash is allowed: an upload folder holds several clips.
create domain s3_key as text
  check (value <> '' and char_length(value) <= 1024 and value !~ '://' and value !~ '^/' and value !~ '\.\.');

-- sha256 or HMAC-SHA256 as lowercase hex: every stored token hash and IP HMAC.
create domain hex_digest as text
  check (value ~ '^[0-9a-f]{64}$');

-- What someone speaks, as an Ink code ("mr"). Null means English on the columns that allow null.
create domain lang_code as text
  check (value ~ '^[a-z]{2,3}$');

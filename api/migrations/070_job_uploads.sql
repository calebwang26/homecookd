-- 070: which upload a video file belongs to (docs/build/JOBS-MIGRATION.md). The worker lists a folder in S3, but only the api can say all of its files
-- are in, so the ledger needs the set: the upload-complete check, a re-issued link, a cancel and the purge all read it by this. Nullable, so the previous
-- release keeps running. `files` has few rows on staging and none on production, so a plain CREATE INDEX blocks no one.
alter table files add column upload_id text check (upload_id ~ '^[a-z0-9][a-z0-9-]{0,99}$');
create index files_upload on files (upload_id, key) where upload_id is not null;

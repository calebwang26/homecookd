-- 074: a video over S3's 5 GiB limit for one PUT goes up in parts (docs/build/JOBS-MIGRATION.md, decision 1). This is S3's id for that upload, once it's started.
alter table files add column multipart_id text;

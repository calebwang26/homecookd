-- 072: a phone's last word on an upload, and a stop that keeps the footage (docs/build/JOBS-MIGRATION.md). Nullable or defaulted, so the previous release keeps running.
alter table files add column last_link_at timestamptz; -- the overdue clock runs from this and the last landed clip, not from when the upload began
alter table jobs add column keep_upload boolean not null default false; -- another cook stopped it: the job ends and the raw video stays

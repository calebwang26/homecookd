-- 050: what the messages area needs on top of 007 and 008 (docs/build/MESSAGES-MIGRATION.md). Nullable columns and plain indexes on tables with no
-- real rows yet, so nothing blocks and the previous release keeps working.

-- A push being sent, since then. SQS delivers at least once and Expo can't dedupe, so one holder sends. A holder that died stops counting after 4 minutes,
-- under SQS's 5-minute visibility, so the queue's next try can take over.
alter table push_log add column delivering_at timestamptz;

-- A voice answer being written out, since then: Ink runs once however often the message arrives.
alter table questions add column answer_transcribing_at timestamptz;

-- "Just like mine" tapped twice is one reaction, even at the same moment. The backfill has to count old doubles first (AWS-MIGRATION, "Before real data").
create unique index messages_one_reaction on messages (thread_id, sender_id, reply_to, body)
  where kind = 'reaction' and reply_to is not null;

-- The purge's "to them" step: recipient_ids has no index, so it looks through the family's rows.
create index pending_sends_family on pending_sends (family_id);

-- The sweep's reach now includes signed-in uploads (owner_person_id), which live in the private bucket too.
create index files_person_to_delete on files (delete_requested_at)
  where bucket = 'private' and owner_person_id is not null and delete_requested_at is not null and deleted_at is null;
create index files_person_orphans on files (created_at)
  where bucket = 'private' and owner_person_id is not null and attached_at is null and delete_requested_at is null and deleted_at is null;

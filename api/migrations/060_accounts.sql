-- 060: what sign-in, invites and account deletion add (docs/build/ACCOUNTS-MIGRATION.md). Each change adds a nullable column or an index, so the
-- previous release keeps running. No table has real rows yet, so plain CREATE INDEX blocks no one.

-- C2: the family's last person deleted. The name and codes are blank and it takes nobody in. A name can't say this: one could really read "Deleted".
alter table families add column blanked_at timestamptz;

-- C5: the lists of ids and keys are cleared 60 days after the outside purge. The row stays as proof.
alter table account_deletions add column lists_cleared_at timestamptz;
create index account_deletions_lists_due on account_deletions (external_purged_at)
  where external_purged_at is not null and lists_cleared_at is null;

-- Which deletion marked this file, so the outside purge can tell whether everything it marked is gone. A row marked from a message or a question has no
-- owner to find it by, and may have had no row in the ledger before the mark.
alter table files add column purge_deletion_id text references account_deletions (id);
create index files_purge_deletion on files (purge_deletion_id) where purge_deletion_id is not null;

-- The last person's delete turns off every phone in the family, the person-less ones too: devices_family_live leaves those out.
create index devices_family on devices (family_id);

-- A deleted person leaves `recipient_ids` of what's waiting to be delivered in their family: pending_sends_family, from 050, finds those.

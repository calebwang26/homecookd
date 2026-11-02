-- 073: someone who left or moved and came back is a new person. These tie the new row to the old one, so deleting them reaches what the old row still holds
-- (docs/build/ACCOUNTS-MIGRATION.md, "Someone who left the family"). Nothing reads them but the deletion, and they give no access.
alter table people add column previous_person_id text references people (id);
create index people_previous on people (previous_person_id) where previous_person_id is not null;

-- The one thing kept about who left, so their next sign-in can find the old row: a keyed hash of provider and subject, never the subject. It goes when the row is deleted.
create table left_identities (
  hash text primary key,
  person_id text not null references people (id),
  created_at timestamptz not null default now()
);
create index left_identities_person on left_identities (person_id);

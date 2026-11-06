-- 002: families, people, and how a phone proves who it is (Supabase's sign-in tables, Convex's sessions and deletions).
-- Convex's families/people mirrored Supabase's families/profiles, so each pair becomes one table here.

create table families (
  id text primary key default gen_random_uuid()::text,
  -- The Supabase family id (or a Convex seed's 'seed:...'). Old phones and signed tickets still send it. Null on new rows.
  supabase_id text unique,
  name text not null check (char_length(name) between 1 and 200), -- personal
  public_name text, -- personal: "the Pawar family" on Community cards; null means not shown by name
  code_hash hex_digest unique, -- the family code old builds sign in with
  code_enc text check (char_length(code_enc) <= 200), -- the same code, sealed, so a known email can recover it
  -- Moss rebuilds a whole index on every write, so one sync runs per family at a time.
  moss_sync_started_at timestamptz,
  moss_sync_again boolean not null default false,
  created_at timestamptz not null default now()
);

create table people (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  -- The Supabase profile id (or 'seed:...'). The app and push payloads still carry it. Null on new rows.
  supabase_id text unique,
  name text not null check (char_length(btrim(name)) between 1 and 100), -- personal
  role text not null check (role in ('cook', 'kid')), -- Supabase's 'learner' is 'kid'
  relation text check (char_length(relation) <= 40), -- personal: what the family calls them
  avatar_key text check (avatar_key ~ '^[a-z0-9_-]{1,40}$'), -- a bundled avatar's name, not a file
  sort int not null default 0,
  email text check (char_length(email) between 3 and 254 and email = lower(btrim(email))), -- personal
  tz text check (char_length(tz) between 1 and 64), -- IANA zone from the phone
  share_cooking boolean, -- the kid's answer to sharing live cooking; null is not asked yet, read as no
  memorial boolean not null default false,
  language lang_code,
  voice_clone_consented_at timestamptz, -- personal: a cloned voice exists only after this
  cartesia_voice_id text, -- personal: deleted at Cartesia by the outside purge
  -- personal: the numeric type rounds to 2 decimals, about 1 km (lib/geo.ts), so a finer place can't be stored.
  approx_lat numeric(5, 2) check (approx_lat between -90 and 90),
  approx_lng numeric(5, 2) check (approx_lng between -180 and 180),
  campus text check (char_length(campus) <= 100), -- personal
  removed_at timestamptz, -- left the family: out of every list, old messages keep their name and face
  deleted_at timestamptz, -- deleted their account: the row stays only as a blank tombstone
  created_at timestamptz not null default now(),
  constraint people_approx_both check ((approx_lat is null) = (approx_lng is null)),
  -- A tombstone can't hold personal data, so a bug in the delete can't leave any here.
  constraint people_tombstone_blank check (
    deleted_at is null or (
      name = 'Deleted' and relation is null and avatar_key is null and email is null and tz is null
      and share_cooking is null and language is null and voice_clone_consented_at is null
      and cartesia_voice_id is null and approx_lat is null and campus is null
    )
  )
);
-- A family's people in order (GET /family, people.family, sessions.mirror).
create index people_family_order on people (family_id, sort, created_at);
-- One email is one person, across all families (POST /auth/email). The check above keeps it lowercase.
create unique index people_email_unique on people (email) where email is not null;
-- A removed or deleted name can be used again.
create unique index people_family_name_unique on people (family_id, lower(name))
  where removed_at is null and deleted_at is null;

-- One per phone: the long-lived key from sign-in. Only sha256(key) is stored.
create table devices (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  person_id text references people (id), -- set once; null until the phone has a person
  key_hash hex_digest not null unique, -- every request from an old build
  label text check (char_length(label) <= 40), -- personal: often the phone's name
  via text not null check (via in ('invite', 'apple', 'google', 'code', 'share')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index devices_family_live on devices (family_id) where revoked_at is null and person_id is not null;
-- A person's phones; also the per-provider sign-up count (POST /auth/apple|google).
create index devices_person on devices (person_id, created_at) where person_id is not null;

-- An Apple or Google account linked to one person.
create table identities (
  provider text not null check (provider in ('apple', 'google')),
  subject text not null check (char_length(subject) between 1 and 255), -- personal
  person_id text not null references people (id),
  email text check (char_length(email) <= 254), -- personal
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index identities_person on identities (person_id);

-- One per signed-in phone: the short-lived token every Convex function took. Only sha256(token) is stored.
-- Not the same thing as a device: a device key lasts until revoked and mints sessions; a session lasts 30 days.
create table sessions (
  id text primary key default gen_random_uuid()::text,
  token_hash hex_digest not null unique, -- every signed-in request
  family_id text not null references families (id),
  person_id text not null references people (id),
  -- New, and null on old rows: revoking a phone can now end its sessions too.
  device_id text references devices (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_expiry on sessions (expires_at); -- the hourly sweep
create index sessions_person on sessions (person_id);
create index sessions_family on sessions (family_id);
create index sessions_device on sessions (device_id) where device_id is not null;

create table invites (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  inviter_id text references people (id),
  person_id text references people (id), -- the person invited; null for a family invite
  token_hash hex_digest not null unique,
  code_hash hex_digest not null unique,
  phone text check (phone ~ '^\+?[0-9]{3,15}$'), -- personal: digits from the picked contact, shown back to the family
  status text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_device_id text references devices (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invites_family_pending on invites (family_id, expires_at) where status = 'pending';
create index invites_person on invites (person_id, created_at desc) where person_id is not null;
create index invites_inviter on invites (inviter_id, status) where inviter_id is not null;
create index invites_used_device on invites (used_device_id) where used_device_id is not null;

-- A family's one link anyone may join through until it expires. Only sha256(token) is looked up.
create table join_links (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  inviter_id text references people (id),
  token_hash hex_digest not null unique,
  token_enc text, -- the token, sealed, so the app shows the same link all week
  expires_at timestamptz, -- null: only the operator's TEST family link for App Review
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index join_links_family_live on join_links (family_id, expires_at desc) where revoked_at is null;
create index join_links_inviter on join_links (inviter_id) where inviter_id is not null;

-- A phone asking to become someone already in the family. 'expired' is never stored.
create table move_requests (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  person_id text not null references people (id),
  device_id text not null references devices (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text references people (id),
  constraint move_requests_decided check ((status = 'pending') = (decided_at is null))
);
create unique index move_requests_one_pending on move_requests (device_id) where status = 'pending';
create index move_requests_family_pending on move_requests (family_id, created_at desc) where status = 'pending';
create index move_requests_device on move_requests (device_id, created_at desc);
create index move_requests_person on move_requests (person_id);
create index move_requests_decided_by on move_requests (decided_by) where decided_by is not null;

-- The log of who joined through which link. Its rows also enforce "one join per card side" (share_token 'link:...').
create table signups (
  id text primary key default gen_random_uuid()::text,
  name text not null check (char_length(name) between 1 and 100), -- personal
  email text check (char_length(email) <= 254), -- personal
  share_token text,
  family_id text references families (id),
  -- New: lets account deletion reach this row. Old rows are matched by email or family and name at backfill.
  person_id text references people (id),
  created_at timestamptz not null default now()
);
create unique index signups_link_token_unique on signups (share_token) where share_token like 'link:%';
create index signups_share_token on signups (share_token, created_at, id) where share_token is not null;
create index signups_email_recent on signups (email, created_at) where email is not null; -- the sign-up rate check
create index signups_family on signups (family_id) where family_id is not null;
create index signups_person on signups (person_id) where person_id is not null;

-- One per deleted account. Same meaning as Convex's accountDeletions: what the delete found, the database purge's
-- progress (purge_*), and the purge of everything outside the database (external_*: S3, Cartesia, and Supabase/GCS
-- while those still exist). The lists are plain arrays because the rows they name are gone by then.
create table account_deletions (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  person_id text not null unique references people (id), -- one per person: a retry finds the row it already made
  supabase_profile_id text,
  requested_at timestamptz not null default now(),
  recipe_ids text[] not null default '{}',
  job_ids text[] not null default '{}',
  upload_keys s3_key[] not null default '{}', -- raw videos in the uploads bucket
  media_keys s3_key[] not null default '{}', -- recipe.json files, covers and glasses videos in the media bucket
  media_prefixes s3_key[] not null default '{}', -- whole recipe folders in the media bucket
  media_urls_legacy text[] not null default '{}', -- Convex's mediaUrls, kept until GCS is off: the purge there needs them
  voice_clone_id text, -- personal: until Cartesia confirms it's gone
  purged_at timestamptz,
  purge_run_at timestamptz,
  purge_restarts int not null default 0,
  external_purged_at timestamptz,
  external_attempts int not null default 0,
  external_tried_at timestamptz,
  external_error text check (char_length(external_error) <= 500), -- short, without secrets
  external_counts jsonb, -- { kind: count }: a report read whole, no fixed set of kinds
  created_at timestamptz not null default now()
);
create index account_deletions_purge_open on account_deletions (requested_at) where purged_at is null;
create index account_deletions_external_open on account_deletions (requested_at)
  where external_purged_at is null and purged_at is not null;
create index account_deletions_family on account_deletions (family_id);

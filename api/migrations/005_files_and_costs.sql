-- 005: the file ledger, and what model calls cost.

-- Every private file we hand out an upload link for: replaces Convex's _storage metadata and dishFiles. The columns on
-- other tables hold the S3 key itself; this row says whose file it is, so:
--   an upload can be attached only by its own family, an orphan is found and deleted, a person's files can be listed, and
--   a delete is durable (S3 can't join a database transaction, so a row is marked here and a sweep does the S3 delete).
-- Other tables have no FK to it: their key columns can also name public library media, which has no row here.
create table files (
  key s3_key primary key, -- every prefix is unique across buckets, so the key alone identifies the file
  bucket text not null check (bucket in ('media', 'uploads', 'private')), -- our name for it, not a host
  kind text not null check (kind in ('photo', 'voice', 'video', 'cover', 'frame', 'document', 'other')),
  content_type text,
  size_bytes bigint check (size_bytes >= 0),
  family_id text references families (id),
  owner_person_id text references people (id), -- null for an anonymous kid's upload
  ask_id text references dish_asks (id) on delete set null,
  -- dishFiles' two public-route fields.
  capability_hash hex_digest unique, -- sha256 of the file id an anonymous page was given
  ip_key hex_digest, -- personal: HMAC of the uploader's IP
  uploaded_at timestamptz, -- S3 confirmed it, so a job or message can use it
  attached_at timestamptz, -- something points at it; unattached after an hour is an orphan
  delete_requested_at timestamptz,
  deleted_at timestamptz, -- gone from S3; the row stays briefly so a re-run is harmless
  legacy_ref text unique, -- the Convex _storage id or GCS/Supabase path it was copied from
  created_at timestamptz not null default now()
);
create index files_orphans on files (created_at)
  where attached_at is null and delete_requested_at is null and deleted_at is null;
create index files_to_delete on files (delete_requested_at)
  where delete_requested_at is not null and deleted_at is null;
create index files_owner on files (owner_person_id) where owner_person_id is not null;
create index files_family on files (family_id) where family_id is not null;
create index files_ask on files (ask_id) where ask_id is not null;

-- One row per model call: which model and prompt, and what it cost (SYSTEM-DESIGN, "Transforming data"). No family content:
-- prompt_version is a name or a hash of the template, never the filled-in text. Kept for cost history after deletion.
create table model_calls (
  id bigint generated always as identity primary key,
  job_id text references jobs (id) on delete set null,
  recipe_id text references recipes (id) on delete set null,
  ask_id text references dish_asks (id) on delete set null,
  purpose text not null, -- extract, merge, order, shorten, align, cover, transcribe, story_card, dish_guess, dish_merge...
  provider text not null,
  model text not null,
  prompt_version text,
  attempt int not null default 1,
  batch boolean not null default false,
  input_tokens bigint,
  output_tokens bigint,
  thinking_tokens bigint,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  price_known boolean not null default true,
  seconds double precision,
  ok boolean not null,
  error text check (char_length(error) <= 200), -- never model output
  created_at timestamptz not null default now()
);
create index model_calls_job on model_calls (job_id, created_at) where job_id is not null;
create index model_calls_recipe on model_calls (recipe_id, created_at) where recipe_id is not null;
create index model_calls_ask on model_calls (ask_id, created_at) where ask_id is not null;
create index model_calls_recent on model_calls (created_at);

-- Model spend per UTC day and budget. Was dishSpend, with the dish ask's $10 budget as its only scope; SYSTEM-DESIGN's daily
-- cap on the pipeline can use the same row shape.
create table daily_spend (
  scope text not null check (scope in ('dish_ask', 'pipeline')),
  day date not null,
  usd numeric(12, 6) not null default 0 check (usd >= 0),
  alerted_at timestamptz, -- the team was told this day reached the budget
  primary key (scope, day)
);

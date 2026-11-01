-- 003: a family's recipes and how they get made: recordings, video jobs, homie's log, who is cooking, pending sends.

-- A dish being processed or ready to cook. Its full recipe.json is in S3.
create table recipes (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  cook_id text not null references people (id),
  title text not null,
  status text not null check (status in ('processing', 'ready', 'failed')),
  -- recipe.json's id. The older Supabase tables name recipes by this, and several families can share a demo's.
  library_id text,
  -- This recipe's own folder in the media bucket, set only when the pipeline made it from this family's upload. Account
  -- deletion takes this folder. Null on seeded demos, whose files are the public library's.
  media_prefix s3_key,
  recipe_json_key s3_key,
  cover_key s3_key,
  cover_version text, -- publish.py's ?v= cache-buster; the api adds it to the CDN link
  -- One of our own stock photos on the website: the only cover Community may show. A family's poster is a video frame.
  cover_stock_path text check (cover_stock_path ~ '^(stock|app-covers)/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$'),
  -- Documents read whole: written all at once by the worker, never queried inside. Keys are Convex's, so rows copy as they are.
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  memories jsonb not null default '[]' check (jsonb_typeof(memories) = 'array'), -- personal: her stories, shown only after her yes
  added_ingredients jsonb not null default '[]' check (jsonb_typeof(added_ingredients) = 'array'), -- personal: her words
  step_count int generated always as (jsonb_array_length(steps)) stored, -- so lists needn't load the steps
  memories_opt_in boolean not null default false,
  moss_indexed_at timestamptz,
  language lang_code,
  shared_at timestamptz, -- on Community: set means shared with neighbors
  story_card_text text, -- personal: may be written from her stories
  story_card_written_at timestamptz,
  story_card_used_stories boolean,
  story_card_culture text,
  story_card_quote text, -- personal: one of her own step quotes
  hidden_at timestamptz, -- reports from two families hid it
  created_at timestamptz not null default now(),
  constraint recipes_one_cover check (cover_key is null or cover_stock_path is null)
);
create index recipes_family_recent on recipes (family_id, created_at desc, id desc); -- recipes.list, chooser, homie, sync
create index recipes_family_library on recipes (family_id, library_id) where library_id is not null; -- signer.owns
create index recipes_cook on recipes (cook_id, created_at desc); -- purge, links.moved
create index recipes_shared_recent on recipes (shared_at desc) where shared_at is not null; -- the Community feed
create index recipes_moss_missing on recipes (family_id) where status = 'ready' and moss_indexed_at is null; -- reindexMissing

-- homie's live session while a cook records.
create table recordings (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  cook_id text not null references people (id),
  -- Read whole with the row, never searched, and person rows are never hard-deleted, so a plain array and no FK.
  for_kid_ids text[] not null default '{}',
  dish text,
  language lang_code not null default 'en',
  source text not null check (source in ('phone', 'glasses')),
  status text not null check (status in ('intro', 'recording', 'wrapping_up', 'ended', 'abandoned')),
  started_at timestamptz, -- t0 for every homie_prompts.at_s
  ended_at timestamptz,
  video_started_at timestamptz,
  memories_opt_in boolean, -- her answer; null means not asked
  job_id text, -- foreign key added below, after jobs exists
  video_key s3_key, -- personal: the full glasses video
  cover_key s3_key, -- personal: the photo of her plate
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recordings_family_recent on recordings (family_id, created_at desc);
create index recordings_live on recordings (status, created_at desc) where status in ('intro', 'recording', 'wrapping_up');
create index recordings_cook_started on recordings (cook_id, started_at);

-- One upload going through the pipeline. Safe to repeat: a queue message names a job id, and the claim is a conditional
-- update; a phone's retry finds the job by idempotency_key.
create table jobs (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  cook_id text not null references people (id),
  recipe_id text references recipes (id) on delete set null,
  recording_id text references recordings (id) on delete set null,
  upload_key s3_key not null, -- one object or a folder ("<upload_id>/") in the uploads bucket
  upload_id text generated always as (split_part(upload_key::text, '/', 1)) stored, -- the signer's job id
  source text not null check (source in ('phone', 'glasses')),
  title text,
  language lang_code,
  for_kid_ids text[] not null default '{}', -- see recordings.for_kid_ids
  stage text not null check (stage in
    ('uploading', 'queued', 'preparing', 'understanding', 'writing', 'indexing', 'done', 'failed')),
  progress double precision not null default 0 check (progress between 0 and 1),
  error text check (char_length(error) <= 500), -- words the cook may read
  video_gaps jsonb check (jsonb_typeof(video_gaps) = 'array'), -- spans with no footage, read whole by the worker
  -- A phone's retry of jobs.create. Null on old rows; old builds use their upload folder as the key.
  idempotency_key text,
  attempts int not null default 0, -- claims so far: the dead-letter alarm and "did this run twice?"
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The video job target is upload_finished_at to finished_at (SYSTEM-DESIGN). Null on old rows: Convex never kept them.
  upload_finished_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz, -- the cook stopped it: a worker mid-way can't bring it back
  -- What made the result, and what it cost. Every call is in model_calls; these are the main writer and the total.
  result_model text,
  result_prompt_version text,
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  constraint jobs_finished_only_when_over check (finished_at is null or stage in ('done', 'failed'))
);
create index jobs_family_recent on jobs (family_id, created_at desc, id desc); -- jobs.forFamily, the app's live list
create index jobs_queued on jobs (created_at, id) where stage = 'queued'; -- the claim, oldest first
create index jobs_unfinished on jobs (stage, claimed_at) where stage not in ('done', 'failed'); -- stuck jobs, cancelUnfinished
create index jobs_upload_key on jobs (upload_key, created_at desc); -- is this folder already a job, and whose?
create index jobs_family_upload on jobs (family_id, upload_id); -- cancelUpload, signer.owns
create index jobs_cook on jobs (cook_id, created_at desc); -- purge, links.moved
create index jobs_recipe on jobs (recipe_id, finished_at desc) where recipe_id is not null; -- which job made this recipe
create index jobs_recording on jobs (recording_id) where recording_id is not null;
create unique index jobs_idempotency_unique on jobs (family_id, idempotency_key) where idempotency_key is not null;
create index jobs_measured on jobs (finished_at) where finished_at is not null; -- the 30-minute target, by period

alter table recordings add constraint recordings_job_fk foreign key (job_id) references jobs (id) on delete set null;
create index recordings_job on recordings (job_id) where job_id is not null;

-- Everything homie said during a recording, and what the cook answered. Reached only through its recording.
create table homie_prompts (
  id text primary key default gen_random_uuid()::text,
  recording_id text not null references recordings (id) on delete cascade,
  kind text not null check (kind in
    ('intro', 'amount', 'cue', 'substitution', 'story', 'show', 'reaction', 'end', 'plate', 'closing', 'optin')),
  text text not null,
  text_en text not null,
  at_s double precision not null, -- seconds after recordings.started_at; negative is before filming
  said_at_s double precision,
  said_end_s double precision,
  status text not null check (status in ('spoken', 'answered', 'ignored', 'not_now')),
  answer_transcript text, -- personal: what the cook said
  answer_transcript_en text, -- personal
  answer_at_s double precision,
  answer_end_s double precision,
  created_at timestamptz not null default now()
);
create index homie_prompts_recording on homie_prompts (recording_id, at_s);

-- What the glasses' live analysis saw. Hints for the app's live view and the final recipe.
create table live_events (
  id text primary key default gen_random_uuid()::text,
  recording_id text not null references recordings (id) on delete cascade,
  session_id text not null,
  session_started_at timestamptz not null,
  kind text not null check (kind in ('step', 'ingredient', 'cue', 'quote', 'story', 'marker')),
  at_s double precision not null,
  end_s double precision,
  title text not null,
  text text not null, -- personal: can hold her stories
  said_as text, -- personal
  quote_original text, -- personal
  confidence double precision not null,
  created_at timestamptz not null default now()
);
create index live_events_recording on live_events (recording_id, session_started_at, at_s);

-- The newest glasses frame of a live recording: one row each, replaced about once a second.
create table live_frames (
  recording_id text primary key references recordings (id), -- holds a file key: never cascades
  frame_key s3_key not null, -- personal
  at timestamptz not null,
  session_id text,
  t bigint -- ms on the glasses session's clock, so a late older frame can't replace a newer one
);

-- Each window the live analysis tried, so a hole in live_events reads as "not analysed".
create table live_windows (
  id text primary key default gen_random_uuid()::text,
  recording_id text not null references recordings (id) on delete cascade,
  session_id text not null,
  session_started_at timestamptz not null,
  start_s double precision not null,
  end_s double precision not null,
  ok boolean not null,
  reason text check (char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index live_windows_recording on live_windows (recording_id, session_started_at, start_s);

-- Who is cooking what (Convex's cookingSessions and Supabase's cooking_now). At most one open row per kid.
create table cooking_sessions (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  kid_id text not null references people (id),
  recipe_id text references recipes (id) on delete cascade,
  library_id text, -- the name the app's POST /cooking uses; a sample recipe has no row in recipes
  cook_id text references people (id), -- whose dish, when known
  step_order int not null check (step_order >= 0),
  step_total int check (step_total between 1 and 200),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint cooking_sessions_names_recipe check (recipe_id is not null or library_id is not null)
);
create unique index cooking_sessions_one_open on cooking_sessions (kid_id) where ended_at is null;
create index cooking_sessions_family_recent on cooking_sessions (family_id, updated_at desc); -- cooking.current, homie
create index cooking_sessions_kid_recent on cooking_sessions (kid_id, updated_at desc); -- purge, "a quiet week"
create index cooking_sessions_cook_open on cooking_sessions (cook_id, updated_at desc) where cook_id is not null;
create index cooking_sessions_recipe on cooking_sessions (recipe_id) where recipe_id is not null;
create index cooking_sessions_idle on cooking_sessions (updated_at) where ended_at is null; -- the idle sweep

-- A recording someone sent before it was ready: who it goes to, delivered when the recipe is published.
create table pending_sends (
  upload_id text primary key check (upload_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'), -- Supabase's job_id: the signer's folder
  job_id text references jobs (id) on delete set null, -- the pipeline's job, when one matches
  family_id text not null references families (id),
  sender_id text not null references people (id),
  recipient_ids text[] not null, -- see recordings.for_kid_ids; a purge removes one with array_remove within the family
  hello_key s3_key, -- personal: the voice hello
  hello_duration_s double precision check (hello_duration_s between 0 and 300),
  library_id text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index pending_sends_family_delivered on pending_sends (family_id, delivered_at) where delivered_at is not null;
create index pending_sends_sender on pending_sends (sender_id);
create index pending_sends_job on pending_sends (job_id) where job_id is not null;

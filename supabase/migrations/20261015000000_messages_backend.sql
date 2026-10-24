-- Edible backend: families, profiles, messages, shares, pending sends, events, signups.
-- Access model: the `api` edge function is the only reader/writer (service role).
-- Every table has RLS enabled and NO policies, so anon/authenticated keys can read nothing.

create extension if not exists pgcrypto;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  role text not null check (role in ('cook', 'learner')),
  relation text check (relation is null or char_length(relation) <= 40),
  avatar_key text check (avatar_key is null or avatar_key ~ '^[a-z0-9_-]{1,40}$'),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index profiles_family_name_key on public.profiles (family_id, lower(name));

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  a_profile uuid not null references public.profiles(id) on delete cascade,
  b_profile uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check (a_profile < b_profile),
  unique (family_id, a_profile, b_profile)
);
create index threads_a_profile_idx on public.threads (a_profile);
create index threads_b_profile_idx on public.threads (b_profile);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('text', 'voice', 'step', 'recipe', 'cooked', 'request')),
  body text check (body is null or char_length(body) <= 2000),
  recipe_id text check (recipe_id is null or recipe_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  step_order int check (step_order is null or step_order >= 1),
  audio_path text,
  audio_url text,
  clip_start_s numeric check (clip_start_s is null or clip_start_s >= 0),
  clip_end_s numeric check (clip_end_s is null or clip_end_s >= 0),
  duration_s numeric check (duration_s is null or (duration_s >= 0 and duration_s <= 300)),
  transcript text check (transcript is null or char_length(transcript) <= 5000),
  seed boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_thread_created_idx on public.messages (thread_id, created_at);
create index messages_family_idx on public.messages (family_id);
create index messages_sender_idx on public.messages (sender_id);

create table public.thread_reads (
  thread_id uuid not null references public.threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, profile_id)
);
create index thread_reads_profile_idx on public.thread_reads (profile_id);

create table public.shares (
  token text primary key check (token ~ '^[0-9A-Za-z]{10}$'),
  family_id uuid not null references public.families(id) on delete cascade,
  recipe_id text not null check (recipe_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  sender_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  open_count int not null default 0,
  last_opened_at timestamptz
);
create index shares_family_idx on public.shares (family_id);
create index shares_sender_idx on public.shares (sender_id);

create table public.pending_sends (
  job_id text primary key check (job_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  family_id uuid not null references public.families(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_ids uuid[] not null,
  hello_path text,
  hello_duration_s numeric check (hello_duration_s is null or (hello_duration_s >= 0 and hello_duration_s <= 300)),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  recipe_id text
);
create index pending_sends_family_idx on public.pending_sends (family_id);
create index pending_sends_sender_idx on public.pending_sends (sender_id);

create table public.recipe_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recipe_id text not null check (recipe_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  kind text not null check (kind in ('viewed', 'cooked')),
  created_at timestamptz not null default now()
);
create index recipe_events_family_recipe_idx on public.recipe_events (family_id, recipe_id, created_at);
create index recipe_events_profile_idx on public.recipe_events (profile_id);

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  email text not null check (char_length(email) <= 254),
  share_token text,
  family_id uuid references public.families(id) on delete set null,
  created_at timestamptz not null default now()
);
create index signups_family_idx on public.signups (family_id);

-- Deny-all to client keys: RLS on, no policies, and no table grants for anon/authenticated.
alter table public.families enable row level security;
alter table public.profiles enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.thread_reads enable row level security;
alter table public.shares enable row level security;
alter table public.pending_sends enable row level security;
alter table public.recipe_events enable row level security;
alter table public.signups enable row level security;

revoke all on public.families, public.profiles, public.threads, public.messages, public.thread_reads,
  public.shares, public.pending_sends, public.recipe_events, public.signups from anon, authenticated;

-- Private bucket for voice notes. Path: <family_id>/<uuid>.<ext>. Uploads go through signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 10485760,
        array['audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/wav', 'audio/ogg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Retention plumbing (docs/build/RETENTION-HANDOFF.md section 2, PR 1): push tokens, a log of every
-- push homecookd sends or skips (caps, dedupe & quote rotation), each person's time zone, consent to
-- share live cooking & a memorial flag, two new kinds of recipe event ('started', 'heard') that
-- remember whose dish it was, how long a clip played & where it started, reactions & postcard
-- ratings on messages, and who is in cook mode right now. The only schema PRs 1-4 & 6 need
-- (docs/build/RETENTION-WIRING.md); PR 5 adds just its table_activity function
-- (20261018100300_retention_table.sql). Idempotent: every statement can run twice
-- (supabase/tests/retention_migrations_sql_test.ts applies the files twice, in both orders with
-- qa-cook's cooked_photos).
-- Same access model as the rest: RLS on, no policies, no grants to anon/authenticated; only the api
-- function (service role) reads or writes these tables.
--
-- Apply BEFORE deploying the api function that registers push tokens, logs pushes or stores x-tz
-- (MCP apply_migration; never `supabase db push`: the live migration versions don't match these
-- file names). The hourly cron is a separate file, applied after that deploy:
-- 20261018100100_retention_cron.sql. Additive except the widened recipe_events & messages kind
-- checks, which every existing row passes.

-- 1. Push tokens: one row per phone's Expo token, owned by that phone's own person (a lent phone
--    keeps its owner's pushes). Registering the same token again moves it to the new person & phone.
create table if not exists public.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[^]]{1,200}\]$'),
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The phone that registered it (null for a family-code caller). People & phones are removed
  -- softly (removed_at, revoked_at), so the cascades rarely fire: the api skips & deletes tokens
  -- whose phone was signed out.
  device_id uuid references public.devices(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_profile_idx on public.push_tokens (profile_id);
create index if not exists push_tokens_device_idx on public.push_tokens (device_id);

-- 2. Every push, sent or skipped. App-initiated rows that were sent count toward the caps (a kid
--    1 a local day & 3 a local week, a cook 1 a local month); skipped ones keep their reason.
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'question', 'recipe', 'started', 'postcard', 'reaction', 'table_nudge', 'recap')),
  -- true = homecookd sent it on its own (a nudge, a recap); false = a person caused it (a message).
  app_initiated boolean not null,
  -- e.g. 'started:<kid>:<recipe>:<local yyyy-mm-dd>'. The same key twice for one person = skip.
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200),
  -- e.g. '<recipe_id>#step-3', so a nudge doesn't repeat a quote within 15 days.
  quote_key text check (quote_key is null or char_length(quote_key) <= 200),
  -- Null = sent. Otherwise why it wasn't: quiet hours or which cap.
  skipped_reason text check (skipped_reason is null or skipped_reason in ('quiet', 'daily', 'weekly', 'monthly')),
  sent_at timestamptz not null default now(),
  -- Not partial (NULL keys are distinct anyway), so it can be an on_conflict target.
  constraint notification_log_dedupe unique (profile_id, dedupe_key)
);
create index if not exists notification_log_recent on public.notification_log (profile_id, sent_at desc);

-- 3. Profiles: local time zone, consent to share live cooking & memorial.
alter table public.profiles
  add column if not exists tz text check (tz is null or char_length(tz) between 1 and 64),
  add column if not exists share_cooking boolean,
  add column if not exists memorial boolean not null default false;

-- 4. Recipe events: kids starting cook mode & listening to a cook's voice, whose dish it was, and
--    how long the clip played. The kind check was created inline in 20261015000000_messages_backend.sql
--    (so Postgres named it recipe_events_kind_check); replace it in one statement.
alter table public.recipe_events drop constraint if exists recipe_events_kind_check,
  add constraint recipe_events_kind_check check (kind in ('viewed', 'cooked', 'started', 'heard'));
alter table public.recipe_events
  add column if not exists cook_id uuid references public.profiles(id) on delete set null,
  add column if not exists duration_s numeric check (duration_s is null or (duration_s >= 0 and duration_s <= 3600)),
  add column if not exists clip_start_s numeric check (clip_start_s is null or clip_start_s >= 0);
create index if not exists recipe_events_cook_idx on public.recipe_events (cook_id) where cook_id is not null;
-- The Sunday table & the monthly recap read a family's events by time.
create index if not exists recipe_events_family_created_idx on public.recipe_events (family_id, created_at);

-- 5. Messages: a 'reaction' kind (a cook's "heart" mid-cook, "Just like mine" on a postcard; its
--    reply_to column already exists, 20261016120000_family_circle.sql), and the postcard's photo &
--    rating. OVERLAP: photo_path is also added by qa-cook's 20261018000000_cooked_photos.sql, the same
--    `text` column, both with `if not exists`, so either file can run first and the second is a
--    no-op. That migration owns the private 'photos' bucket (10 MiB, jpeg/png/heic/webp); nothing
--    here touches storage.buckets.
alter table public.messages drop constraint if exists messages_kind_check,
  add constraint messages_kind_check
  check (kind in ('text', 'voice', 'step', 'recipe', 'cooked', 'request', 'question', 'system', 'reaction'));
alter table public.messages
  add column if not exists photo_path text,
  add column if not exists rating smallint check (rating is null or rating between 1 and 5);
alter table public.messages drop constraint if exists messages_reaction_body_check,
  add constraint messages_reaction_body_check
  check (kind <> 'reaction' or coalesce(body, '') in ('heart', 'just_like_mine'));

-- 6. Live cooking (handoff 3.1): one row per kid in cook mode, replaced as they move through steps.
create table if not exists public.cooking_now (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  recipe_id text not null check (recipe_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  cook_id uuid references public.profiles(id) on delete set null,
  step int not null,
  total int not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cooking_now_step_check check (step >= 1 and step <= total and total <= 200)
);
create index if not exists cooking_now_cook_idx on public.cooking_now (cook_id, updated_at);

-- Deny-all to client keys; the api function (service role) does everything.
alter table public.push_tokens enable row level security;
alter table public.notification_log enable row level security;
alter table public.cooking_now enable row level security;
revoke all on public.push_tokens, public.notification_log, public.cooking_now from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;
grant select, insert, delete on public.notification_log to service_role;
grant select, insert, update, delete on public.cooking_now to service_role;

comment on table public.push_tokens is
  'Expo push tokens, one per phone, owned by the profile signed in on that phone (POST /push-tokens). '
  'Removed on sign-out (POST /push-tokens/remove) or when Expo says the device is no longer registered.';
comment on table public.notification_log is
  'Every push the api sent or skipped: caps for app-initiated pushes, dedupe (unique profile_id, '
  'dedupe_key) and quote rotation (quote_key).';
comment on column public.profiles.tz is
  'IANA time zone from the app''s x-tz header, validated by the api. Null reads as America/Los_Angeles.';
comment on column public.profiles.share_cooking is
  'A kid''s answer to the one-time "let the cook see when you cook their dishes" question. Null = not '
  'asked yet, read as no (asked once, respected on every device).';
comment on column public.profiles.memorial is
  'Someone the family remembers: no nudges or pushes about or to them, no pair counts, no recap '
  'slides that address them as present. Set by SQL in v1 (TODO(caleb): who sets it in the app).';
comment on column public.recipe_events.cook_id is
  'Whose dish it was (the app resolves recipe -> cook by name and sends it; the api checks the family).';
comment on column public.recipe_events.duration_s is
  'For ''heard'': seconds of the cook''s voice that played (the app logs plays of 3 s or more).';
comment on column public.recipe_events.clip_start_s is
  'For ''heard'': where the clip starts in the recipe audio, so the recap can name the most-played clip.';
comment on column public.messages.rating is
  'A postcard''s optional "How close to Mom''s?" (1-5 pots), on the kid''s own cooked message.';
comment on table public.cooking_now is
  'Who is in cook mode right now (POST /cooking; ended by POST /cooking/end or 45 min idle). Shown only '
  'to the dish''s cook, and only when the kid said yes (profiles.share_cooking).';

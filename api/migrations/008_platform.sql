-- 008: what the api needs to run: pushes, rate limits, safe retries, delayed work, the lander's visit log.

-- One phone's Expo push token, moved to whoever signed in on it last.
create table push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[^]]{1,200}\]$'), -- personal
  family_id text not null references families (id),
  person_id text not null references people (id),
  device_id text references devices (id) on delete cascade, -- the phone that registered it
  platform text not null check (platform in ('ios', 'android')),
  tz text check (char_length(tz) between 1 and 64), -- for quiet hours
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_tokens_person on push_tokens (person_id, updated_at desc);
create index push_tokens_device on push_tokens (device_id) where device_id is not null;
create index push_tokens_family on push_tokens (family_id);

-- Every push decided on, sent or not: dedupe, the caps, quote rotation, receipts. Pruned after 40 days.
create table push_log (
  id text primary key default gen_random_uuid()::text,
  person_id text not null references people (id),
  kind text not null check (kind in
    ('message', 'question', 'recipe', 'started', 'postcard', 'reaction', 'table_nudge', 'recap', -- Supabase's
     'answered', 'craving', 'joined', 'filmed')), -- Convex's
  app_initiated boolean not null default false, -- homecookd sent it on its own: counts toward the caps
  dedupe_key text check (char_length(dedupe_key) <= 200),
  quote_key text check (char_length(quote_key) <= 200), -- so a nudge doesn't repeat a quote within 15 days
  status text not null check (status in ('queued', 'sent', 'failed', 'none', 'capped', 'skipped')),
  skipped_reason text check (skipped_reason in ('quiet', 'daily', 'weekly', 'monthly')),
  title text, -- personal: names a person and a dish
  body text, -- personal
  url text, -- an in-app path
  tickets jsonb check (jsonb_typeof(tickets) = 'array'), -- Expo's tickets, read whole by the receipts check
  error text check (char_length(error) <= 200),
  send_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Null keys are distinct, so this is also the insert's ON CONFLICT target: the same push twice is a no-op.
  unique (person_id, dedupe_key)
);
create index push_log_person_recent on push_log (person_id, created_at desc); -- the caps, purge
create index push_log_person_kind on push_log (person_id, kind, created_at desc); -- cravings per day, quote rotation
create index push_log_due on push_log (send_at) where status = 'queued'; -- a craving waiting out quiet hours
create index push_log_prune on push_log (created_at);

-- The fixed-window limiter (Convex's shape): a counter per key and window, safe under a plain upsert. A key is a bucket name
-- plus an HMAC of the IP or email, never the IP or email. Pruned after 2 days.
create table rate_hits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);
create index rate_hits_prune on rate_hits (window_start);

-- A phone's retry of a write (SYSTEM-DESIGN, "Moving data"). Holds only what the row was, never a response body, so no family
-- content sits here. scope is the person id, or a token hash on the public routes. Pruned at expires_at.
create table idempotency_keys (
  scope text not null,
  key text not null check (char_length(key) <= 200),
  route text not null,
  request_hash hex_digest, -- the same key with a different body is refused
  resource_id text, -- what the first call made
  status_code int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  primary key (scope, key)
);
create index idempotency_keys_expired on idempotency_keys (expires_at);

-- Work to start later, written in the same transaction as the change that needs it. This replaces Convex's scheduler, which
-- was atomic with its mutation: without this, a crash between COMMIT and sending to SQS would lose the work, and SQS can't
-- delay past 15 minutes. A sender moves due rows to SQS. Payloads hold ids only, never family content.
create table outbox (
  id bigint generated always as identity primary key,
  queue text not null,
  payload jsonb not null,
  request_id text, -- so logs trace across api, queue and worker
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index outbox_due on outbox (send_after, id) where sent_at is null;
create index outbox_prune on outbox (sent_at) where sent_at is not null;

-- Lander visits: which page and why. Nothing about the person (no IP, no user agent).
create table lander_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('land', 'switch', 'tap')),
  aud text not null check (aud in ('parent', 'kid')),
  signal text check (signal in ('aud', 'saved', 'snapchat', 'link', 'default', 'switch')),
  app text check (char_length(app) <= 100),
  utm_source text check (char_length(utm_source) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  path text check (char_length(path) <= 100),
  ui text check (char_length(ui) <= 20),
  host text check (char_length(host) <= 60),
  created_at timestamptz not null default now()
);
create index lander_events_recent on lander_events (created_at);

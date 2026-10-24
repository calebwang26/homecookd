-- Two-sided sign-in (FEEDBACK-OCT16c section A1): a key per phone, Sign in with Apple / Google,
-- single-use family invites, soft removal of people, and the lander's anonymous visit log.
-- Same access model as the rest: RLS on, no policies, no grants to anon/authenticated; only the api
-- function (service role) reads or writes these tables. Additive except two loosened constraints
-- (a removed person's name can be reused; a sign-up log row may have no email).

-- 1. Devices: each phone gets its own key. Only sha256(key) is stored; the key is shown once.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  -- Who signed in on it. A family-code exchange (POST /devices, via 'code') starts null and then
  -- follows whoever the phone last wrote as, so removing that person signs it out too.
  profile_id uuid references public.profiles(id) on delete set null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label text check (label is null or char_length(label) <= 40),
  via text not null check (via in ('invite', 'apple', 'google', 'code', 'share')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index devices_family_idx on public.devices (family_id);
create index devices_profile_idx on public.devices (profile_id);

-- 2. Identities: an Apple or Google account (`sub` claim) linked to one profile.
create table public.identities (
  provider text not null check (provider in ('apple', 'google')),
  subject text not null check (char_length(subject) between 1 and 255),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text check (email is null or char_length(email) <= 254),
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index identities_profile_idx on public.identities (profile_id);

-- 3. Invites: one link (and a 6-letter code) for one person, used once, alive 14 days. The invited
-- profile exists from the moment of inviting, so their face shows up right away. Only hashes of the
-- token and code are stored.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  inviter_id uuid references public.profiles(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  -- Digits from the picked contact, shown back to the family. Never used to send anything.
  phone text check (phone is null or phone ~ '^\+?[0-9]{3,15}$'),
  status text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invites_family_idx on public.invites (family_id);
create index invites_profile_idx on public.invites (profile_id);
create index invites_inviter_idx on public.invites (inviter_id);
create index invites_used_device_idx on public.invites (used_device_id);

-- 4. Soft removal. A removed person leaves every list and is signed out, but their old messages and
-- recipe notes keep their name and face, so the row stays.
alter table public.profiles add column removed_at timestamptz;
-- Names stay unique per family among the people still in it, so a removed name can be used again.
drop index if exists public.profiles_family_name_key;
create unique index profiles_family_name_key on public.profiles (family_id, lower(name)) where removed_at is null;

-- 5. Sign-ups through a share link are counted per link (MAX_JOINS_PER_LINK). Apple may not share an
-- email, so a sign-up log row can have none.
alter table public.signups alter column email drop not null;

-- 6. Lander visits: which page a visitor saw and why. Nothing about the person (no IP, no user agent).
create table public.lander_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('land', 'switch', 'tap')),
  aud text not null check (aud in ('parent', 'kid')),
  signal text check (signal is null or signal in ('aud', 'saved', 'snapchat', 'link', 'default', 'switch')),
  app text check (app is null or char_length(app) <= 100),
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 100),
  path text check (path is null or char_length(path) <= 100),
  ui text check (ui is null or char_length(ui) <= 20),
  host text check (host is null or char_length(host) <= 60),
  created_at timestamptz not null default now()
);
create index lander_events_created_idx on public.lander_events (created_at);

-- Deny-all to client keys; the api function (service role) does everything.
alter table public.devices enable row level security;
alter table public.identities enable row level security;
alter table public.invites enable row level security;
alter table public.lander_events enable row level security;

revoke all on public.devices, public.identities, public.invites, public.lander_events from anon, authenticated;
grant select, insert, update, delete on public.devices, public.identities, public.invites to service_role;
grant select, insert, delete on public.lander_events to service_role;

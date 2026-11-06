-- 006: Community: dinners, swaps, reports and blocks. No file keys here, so children may cascade.

create table dinners (
  id text primary key default gen_random_uuid()::text,
  host_id text not null references people (id),
  host_family_id text not null references families (id),
  -- Null once the dish's cook deleted her account: another family's cancelled dinner around it stays.
  recipe_id text references recipes (id) on delete set null,
  dish text not null,
  starts_at timestamptz not null,
  place_kind text not null check (place_kind in ('campus_kitchen', 'community_center', 'cafe', 'home')),
  place_name text not null, -- public
  address text not null, -- personal: only the host and accepted guests see it
  approx_lat numeric(5, 2) not null check (approx_lat between -90 and 90), -- personal: rounded to about 1 km
  approx_lng numeric(5, 2) not null check (approx_lng between -180 and 180), -- personal
  seats int not null check (seats >= 1),
  status text not null check (status in ('open', 'full', 'cancelled')),
  invite_token text unique, -- /d?t=: stored as it is, because the same link is handed out every time
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index dinners_open_upcoming on dinners (starts_at) where status = 'open'; -- the Community feed
create index dinners_host on dinners (host_id, starts_at);
create index dinners_recipe on dinners (recipe_id) where recipe_id is not null;
create index dinners_host_family on dinners (host_family_id);

-- One per phone or browser that opened a dinner's invite link: "X going" counts them.
create table dinner_invite_opens (
  id text primary key default gen_random_uuid()::text,
  dinner_id text not null references dinners (id) on delete cascade,
  device_id text not null, -- made up by the opening phone or browser
  created_at timestamptz not null default now(),
  unique (dinner_id, device_id)
);

create table dinner_requests (
  id text primary key default gen_random_uuid()::text,
  dinner_id text not null references dinners (id) on delete cascade,
  guest_id text not null references people (id),
  guest_family_id text not null references families (id),
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (dinner_id, guest_id)
);
create index dinner_requests_guest on dinner_requests (guest_id, created_at desc);
create index dinner_requests_guest_family on dinner_requests (guest_family_id);

-- One family asks another to swap recipes, or (kind 'cook') to cook the other family's dish together.
create table swap_requests (
  id text primary key default gen_random_uuid()::text,
  requester_id text not null references people (id),
  requester_family_id text not null references families (id),
  their_recipe_id text not null references recipes (id) on delete cascade,
  my_recipe_id text references recipes (id) on delete cascade,
  other_family_id text not null references families (id),
  kind text not null default 'swap' check (kind in ('swap', 'cook')),
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (requester_family_id, their_recipe_id, kind) -- "asking again returns the same ask"
);
create index swap_requests_asked_of_us on swap_requests (other_family_id, created_at desc);
create index swap_requests_requester on swap_requests (requester_id);
create index swap_requests_their_recipe on swap_requests (their_recipe_id);
create index swap_requests_my_recipe on swap_requests (my_recipe_id) where my_recipe_id is not null;

-- A report of another family's recipe or dinner, or a block (kind 'family'). target_id has no FK: it names a row in one of
-- three tables, and a report must outlive what it reports for the review record.
create table reports (
  id text primary key default gen_random_uuid()::text,
  reporter_family_id text not null references families (id),
  reporter_person_id text references people (id), -- nulled when they delete their account; the family's hide stays
  kind text not null check (kind in ('recipe', 'dinner', 'family')),
  target_id text not null,
  target_family_id text not null references families (id),
  reason text check (reason in ('not_food', 'rude', 'other')),
  status text not null check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  unique (reporter_family_id, kind, target_id) -- one per family and item; also what a family reported (lib/safety.ts)
);
create index reports_target on reports (kind, target_id);
create index reports_open on reports (created_at) where status = 'open';
create index reports_reporter_person on reports (reporter_person_id) where reporter_person_id is not null;
create index reports_target_family on reports (target_family_id);

-- One family blocked another. Both ways: neither sees the other's dishes, dinners or asks.
create table blocks (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  blocked_family_id text not null references families (id),
  label text not null, -- personal: how the blocked family's cards named it, sometimes a cook's first name
  created_at timestamptz not null default now(),
  unique (family_id, blocked_family_id)
);
create index blocks_reverse on blocks (blocked_family_id, family_id);

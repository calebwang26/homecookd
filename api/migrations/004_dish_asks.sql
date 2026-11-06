-- 004: the web's "what dish do you miss?" and Mom's answers (docs/build/DISH-ASK-SPEC.md).

-- A parent's "what do you miss?" link: one live link per person, reused. The token is stored as it is so her own link can
-- be shown to her again; it's never returned to anyone else.
create table craving_links (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  person_id text not null references people (id),
  token text not null unique, -- /miss?c=
  message text not null, -- personal: her line, in her voice
  uses int not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index craving_links_person_newest on craving_links (person_id, created_at desc);
create index craving_links_family on craving_links (family_id);

-- One card: a kid's guess at a dish (no account needed) and what Mom answered. Both links' tokens are stored only as
-- sha256. A row can reach a person only through person_id and requested_of: family_id alone deletes nothing.
create table dish_asks (
  id text primary key default gen_random_uuid()::text,
  kid_token_hash hex_digest not null unique, -- every read of the kid's page
  ask_token_hash hex_digest not null unique, -- every read of Mom's page
  dish text not null, -- as typed; '' when they gave only a photo or voice note
  relation text not null check (relation in ('mom', 'dad', 'grandma', 'grandpa', 'auntie', 'uncle', 'none')),
  kid_name text, -- personal
  photo_keys s3_key[] not null default '{}' check (cardinality(photo_keys) <= 3), -- personal
  dish_voice_note_key s3_key, -- personal: private, never on Mom's page
  kid_voice_note_key s3_key, -- personal: never sent to a model
  kid_voice_s double precision,
  -- Documents read whole on every page view and validated by lib/dishAsk/validate.ts; a change rewrites the whole recipe.
  guess jsonb not null check (jsonb_typeof(guess) = 'object'), -- personal
  version jsonb check (jsonb_typeof(version) = 'object'), -- personal: Mom's version
  asked jsonb not null default '[]' check (jsonb_typeof(asked) = 'array' and jsonb_array_length(asked) <= 6),
  message text not null, -- personal: the Ask Mom text, in the kid's voice
  mom_page_lang lang_code,
  status text not null check (status in ('draft', 'asked', 'answered')),
  merge_tries int not null default 0,
  merge_started_at timestamptz, -- a try's claim: it writes only while this still matches
  merged_at timestamptz,
  asked_at timestamptz,
  asked_via text check (asked_via in ('copy', 'sms', 'instagram', 'whatsapp', 'more')),
  opened_at timestamptz,
  finished_at timestamptz,
  questions_at timestamptz,
  gen_ms int not null default 0,
  created_at timestamptz not null default now(),
  ip_key hex_digest, -- personal: HMAC of the maker's IP, never the IP. Nulled when the kid deletes their account
  family_id text references families (id),
  person_id text references people (id), -- the kid, once they claim the card
  requested_of text references people (id), -- Mom, once she claims it or when it came from her craving link
  kid_claimed_at timestamptz,
  cook_claimed_at timestamptz,
  craving_id text references craving_links (id) on delete set null,
  filming_day smallint check (filming_day between 0 and 6),
  voice_recipe_q text check (voice_recipe_q in ('q1', 'q2', 'q3', 'q4', 'q5', 'q6'))
);
create index dish_asks_person_recent on dish_asks (person_id, created_at desc) where person_id is not null;
create index dish_asks_requested_recent on dish_asks (requested_of, created_at desc) where requested_of is not null;
create index dish_asks_craving_recent on dish_asks (craving_id, created_at desc) where craving_id is not null;
create index dish_asks_family on dish_asks (family_id) where family_id is not null;

-- Mom's page in her language: was dishAsks.momLang, one array in the card. Her page polls every 2 seconds and needs one
-- language, so each language is its own row. A cache: re-made from the card when source_hash no longer matches.
create table dish_ask_translations (
  ask_id text not null references dish_asks (id) on delete cascade,
  lang lang_code not null,
  source_hash hex_digest not null, -- sha256 of what was translated (Convex stored that whole text as `key`)
  guess jsonb not null, -- personal
  questions jsonb not null,
  message text not null, -- personal
  version jsonb, -- personal
  created_at timestamptz not null default now(),
  primary key (ask_id, lang)
);

-- One of Mom's voice answers. Re-recording replaces it and sends the old clip to files for deletion.
create table dish_answers (
  id text primary key default gen_random_uuid()::text,
  ask_id text not null references dish_asks (id), -- holds a file key: never cascades
  question_id text not null check (question_id in ('q1', 'q2', 'q3', 'q4', 'q5', 'q6')),
  audio_key s3_key not null unique, -- personal: unique so a used clip can't go on a second card
  duration_s double precision not null,
  language lang_code not null default 'en',
  words text, -- personal: null is not heard yet, '' is no words
  english text, -- personal
  english_settled boolean not null default false, -- Convex's three states: not yet, none (null) or a translation
  merged boolean not null default false,
  created_at timestamptz not null default now(),
  unique (ask_id, question_id)
);

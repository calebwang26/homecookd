-- 007: family messages (Supabase's thread shape, which Convex's messages move into), questions, recipe notes, and what
-- people do with a recipe. Supabase's tables name a recipe by library_id: a recipe.json id, with no FK because a sample
-- recipe in the public library has no row in recipes.

-- A pair (two people, smaller id first) or the family's one circle.
create table threads (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  kind text not null check (kind in ('pair', 'circle')),
  a_person_id text references people (id),
  b_person_id text references people (id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  -- COLLATE "C" so "smaller" doesn't change with the database's language settings.
  constraint threads_shape check (
    (kind = 'pair' and a_person_id is not null and b_person_id is not null
      and a_person_id collate "C" < b_person_id collate "C")
    or (kind = 'circle' and a_person_id is null and b_person_id is null)
  )
);
create unique index threads_one_pair on threads (family_id, a_person_id, b_person_id) where kind = 'pair';
create unique index threads_one_circle on threads (family_id) where kind = 'circle';
-- My threads, newest first, including the purge's "her 1:1s".
create index threads_a_recent on threads (a_person_id, last_message_at desc) where kind = 'pair';
create index threads_b_recent on threads (b_person_id, last_message_at desc) where kind = 'pair';

create table thread_reads (
  thread_id text not null references threads (id) on delete cascade,
  person_id text not null references people (id),
  last_read_at timestamptz not null default now(),
  primary key (thread_id, person_id)
);
create index thread_reads_person on thread_reads (person_id);

create table messages (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  thread_id text not null references threads (id), -- holds file keys: never cascades
  sender_id text not null references people (id),
  kind text not null check (kind in
    ('text', 'voice', 'step', 'recipe', 'cooked', 'request', 'question', 'system', 'reaction', 'photo')),
  body text check (char_length(body) <= 2000), -- personal
  library_id text check (library_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  recipe_id text references recipes (id) on delete set null, -- Convex's recipeId
  step_order int check (step_order >= 1),
  audio_key s3_key, -- personal: her private voice note (Supabase's audio_path, Convex's voice fileId)
  clip_key s3_key, -- a clip of a recipe's public audio (Supabase's audio_url)
  clip_start_s double precision check (clip_start_s >= 0),
  clip_end_s double precision check (clip_end_s >= 0),
  duration_s double precision check (duration_s between 0 and 300),
  transcript text check (char_length(transcript) <= 5000), -- personal
  photo_key s3_key, -- personal (Supabase's photo_path, Convex's photo fileId)
  rating smallint check (rating between 1 and 5),
  reply_to text references messages (id) on delete set null,
  ai_drafted boolean not null default false, -- shown with an "AI-drafted" label, even after the kid edits it
  seed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint messages_reaction_body check (kind <> 'reaction' or coalesce(body, '') in ('heart', 'just_like_mine'))
);
create index messages_thread_recent on messages (thread_id, created_at desc, id desc); -- a thread's page
create index messages_thread_kind on messages (thread_id, kind, created_at desc); -- questions, recipes received
create index messages_family_recent on messages (family_id, created_at desc, id desc); -- the app's list, table, recap
create index messages_family_library on messages (family_id, library_id, created_at desc) where library_id is not null;
create index messages_sender on messages (sender_id, created_at desc); -- purge
create index messages_reply_to on messages (reply_to) where reply_to is not null;
create index messages_recipe on messages (recipe_id) where recipe_id is not null;

-- A cook's answer saved into the shared family recipe, made from two messages. Not the same as questions: this is the
-- saved result of a chat, keyed by library_id, while a question is a work item with a status that Moss may answer.
create table recipe_notes (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  library_id text not null check (library_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  step_order int check (step_order >= 1),
  question_message_id text references messages (id) on delete set null,
  question text check (char_length(question) <= 5000), -- personal
  asked_by text references people (id),
  answer_message_id text not null unique references messages (id), -- holds file keys: never cascades
  answer_text text check (char_length(answer_text) <= 5000), -- personal
  answer_audio_key s3_key, -- personal
  answer_clip_key s3_key,
  answer_duration_s double precision check (answer_duration_s between 0 and 300),
  answered_by text not null references people (id),
  created_at timestamptz not null default now(),
  constraint recipe_notes_has_answer check
    (answer_text is not null or answer_audio_key is not null or answer_clip_key is not null)
);
create index recipe_notes_family_library on recipe_notes (family_id, library_id, step_order, created_at);
create index recipe_notes_question on recipe_notes (question_message_id) where question_message_id is not null;
create index recipe_notes_asked_by on recipe_notes (asked_by) where asked_by is not null;
create index recipe_notes_answered_by on recipe_notes (answered_by);

-- A question about a recipe while cooking. The video answers it when Moss finds the moment; otherwise it goes to the cook.
-- Also the "may I share this?" ask (kind 'share') and the pipeline's own questions (kind 'follow_up').
create table questions (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  recipe_id text not null references recipes (id), -- holds a file key: never cascades
  step_order int,
  asked_by text not null references people (id),
  text text not null check (char_length(text) <= 2000), -- personal
  text_for_cook text, -- personal
  kind text not null default 'cooking' check (kind in ('cooking', 'share', 'follow_up')),
  follow_up_id text, -- recipe.json's id, so a re-published recipe doesn't ask twice
  follow_up_ingredient text,
  follow_up_said text check (follow_up_said in ('yes', 'no', 'unclear')),
  share_said text check (share_said in ('yes', 'no', 'unclear')),
  share_decided_at timestamptz,
  status text not null check (status in ('found_in_video', 'asked_cook', 'answered')),
  found_start_s double precision,
  found_end_s double precision,
  found_quote text, -- personal: the cook's words
  answer_by text references people (id),
  answer_text text, -- personal
  answer_audio_key s3_key, -- personal
  answer_transcript text, -- personal
  answer_translation text, -- personal
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint questions_answer_means_answered check (answer_by is null or status = 'answered')
);
create index questions_recipe_recent on questions (recipe_id, created_at desc);
create index questions_family_status_recent on questions (family_id, status, created_at desc);
create index questions_asked_by on questions (asked_by);
create index questions_answer_by on questions (answer_by) where answer_by is not null;
create unique index questions_one_follow_up on questions (recipe_id, follow_up_id) where follow_up_id is not null;

-- Public share links for a recipe (/r). The token is the link: stored as it is, and returned again to the family.
create table shares (
  token text primary key check (token ~ '^[0-9A-Za-z]{10}$'),
  family_id text not null references families (id),
  library_id text not null check (library_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  sender_id text references people (id),
  created_at timestamptz not null default now(),
  open_count int not null default 0,
  last_opened_at timestamptz
);
create index shares_family_library on shares (family_id, library_id);
create index shares_sender on shares (sender_id) where sender_id is not null;

create table favorites (
  person_id text not null references people (id),
  library_id text not null check (library_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  created_at timestamptz not null default now(),
  primary key (person_id, library_id)
);
create index favorites_library on favorites (library_id, person_id); -- who in the family hearted this dish
create index favorites_recent on favorites (created_at); -- the monthly recap

-- Which recipes someone opened, cooked or listened to. personal: how they use the app.
create table recipe_events (
  id text primary key default gen_random_uuid()::text,
  family_id text not null references families (id),
  person_id text not null references people (id),
  library_id text not null check (library_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  kind text not null check (kind in ('viewed', 'cooked', 'started', 'heard')),
  cook_id text references people (id),
  duration_s double precision check (duration_s between 0 and 3600),
  clip_start_s double precision check (clip_start_s >= 0),
  created_at timestamptz not null default now()
);
create index recipe_events_family_library on recipe_events (family_id, library_id, created_at desc); -- one dish's stats
create index recipe_events_family_recent on recipe_events (family_id, created_at); -- the Sunday table, the recap
create index recipe_events_person_recent on recipe_events (person_id, created_at desc); -- my stats
create index recipe_events_person_dedupe on recipe_events (person_id, library_id, kind, created_at desc); -- once per window
create index recipe_events_cook on recipe_events (cook_id) where cook_id is not null;

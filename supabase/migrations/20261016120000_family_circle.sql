-- Family circle (FEEDBACK-OCT16 A1 + A3 + A5): sign-in by email, one group thread per family,
-- questions and answers, answers saved into the recipe as notes.
-- Same access model as the first migration: RLS on, no policies, no grants to anon/authenticated.

-- 1. Email sign-in ------------------------------------------------------------------------------
-- One email = one profile, across all families. Stored lowercased by the api function.
alter table public.profiles
  add column email text check (email is null or (char_length(email) between 3 and 254 and email = lower(btrim(email))));
create unique index profiles_email_key on public.profiles (lower(email)) where email is not null;

-- The api hands a known email its family code, so it must be recoverable. The function stores it
-- AES-GCM encrypted (key derived inside the function, AAD = family id) as 'v1:<iv>.<ciphertext>'.
-- Existing families get it the next time a device calls with the plain code. code_hash stays the
-- lookup key.
alter table public.families
  add column code_enc text check (code_enc is null or char_length(code_enc) <= 200);

-- 2. Threads: 'pair' (two people, as before) or 'circle' (the whole family, one per family).
-- A circle has no a_profile/b_profile (both null); a pair has both, smaller uuid first.
alter table public.threads
  add column kind text not null default 'pair' check (kind in ('pair', 'circle'));
alter table public.threads alter column a_profile drop not null;
alter table public.threads alter column b_profile drop not null;
-- (the old check a_profile < b_profile stays: it passes when both are null)
alter table public.threads add constraint threads_shape_check check (
  (kind = 'pair' and a_profile is not null and b_profile is not null and a_profile < b_profile)
  or (kind = 'circle' and a_profile is null and b_profile is null)
);
create unique index threads_one_circle_per_family on public.threads (family_id) where kind = 'circle';

-- 3. Messages: replies, questions, system notes.
alter table public.messages
  add column reply_to uuid references public.messages(id) on delete set null;
create index messages_reply_to_idx on public.messages (reply_to);
-- Widen the kind check (replace it in one transaction; existing rows all pass the new one).
alter table public.messages drop constraint if exists messages_kind_check,
  add constraint messages_kind_check
  check (kind in ('text', 'voice', 'step', 'recipe', 'cooked', 'request', 'question', 'system'));

-- 4. Recipe notes: a cook's answer saved into the shared family recipe (and step).
create table public.recipe_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recipe_id text not null check (recipe_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  step_order int check (step_order is null or step_order >= 1),
  question_message_id uuid references public.messages(id) on delete set null,
  question text check (question is null or char_length(question) <= 5000),
  asked_by uuid references public.profiles(id) on delete set null,
  answer_message_id uuid not null unique references public.messages(id) on delete cascade,
  answer_text text check (answer_text is null or char_length(answer_text) <= 5000),
  answer_audio_path text,
  answer_audio_url text,
  answer_duration_s numeric check (answer_duration_s is null or (answer_duration_s >= 0 and answer_duration_s <= 300)),
  answered_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (answer_text is not null or answer_audio_path is not null or answer_audio_url is not null)
);
create index recipe_notes_family_recipe_idx on public.recipe_notes (family_id, recipe_id, created_at);
create index recipe_notes_question_idx on public.recipe_notes (question_message_id);
create index recipe_notes_asked_by_idx on public.recipe_notes (asked_by);
create index recipe_notes_answered_by_idx on public.recipe_notes (answered_by);

alter table public.recipe_notes enable row level security;
revoke all on public.recipe_notes from anon, authenticated;

-- 5. Backfill: every existing family gets its (empty) circle. No messages move.
insert into public.threads (family_id, kind)
select id, 'circle' from public.families
on conflict (family_id) where kind = 'circle' do nothing;

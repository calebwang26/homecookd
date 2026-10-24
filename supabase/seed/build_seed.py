"""Build the one-off seed SQL for the demo family and the test family.

    .venv/bin/python supabase/seed/build_seed.py <out.sql>                 # everything
    .venv/bin/python supabase/seed/build_seed.py --circle-only <out.sql>   # only the family circles

Reads FAMILY_CODE from the root .env and the test family's code from docs/build/.test-family-code
(created here with a fresh random XXXX-XXXX code if it doesn't exist). Only sha256 hashes go into the
SQL; the codes themselves are never printed. Run the output once with the Supabase SQL editor or the
MCP execute_sql tool, then delete it. Re-running is safe: families and profiles are upserted, and the
demo family's seed=true messages are replaced (real messages are kept).

Codes are hashed the way the api function does it: sha256(code.strip().upper()) as hex.

Needs the two-sided migration (20261017000000): a profile name is unique only among people not
removed (`profiles.removed_at`), so the upsert names that partial index and lookups skip removed people.
"""
from __future__ import annotations

import hashlib
import secrets
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
TEST_CODE_FILE = ROOT / "docs" / "build" / ".test-family-code"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I, same as the api's generator


def code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def test_code() -> str:
    if TEST_CODE_FILE.exists() and TEST_CODE_FILE.read_text().strip():
        return TEST_CODE_FILE.read_text().strip()
    code = "".join(secrets.choice(ALPHABET) for _ in range(4)) + "-" + "".join(secrets.choice(ALPHABET) for _ in range(4))
    TEST_CODE_FILE.write_text(code + "\n")
    return code


PROFILES_SQL = """
insert into public.profiles (family_id, name, role, relation, avatar_key, sort) values
  ({fam}, 'Mom', 'cook', 'Mom', 'mom', 1),
  ({fam}, 'Dad', 'cook', 'Dad', 'dad', 2),
  ({fam}, 'Grandma', 'cook', 'Grandma', 'grandma', 3),
  ({fam}, 'Leo', 'learner', null, 'leo', 4),
  ({fam}, 'Maya', 'learner', null, null, 5)
on conflict (family_id, lower(name)) where removed_at is null do nothing;
"""

# True-to-data demo threads. Recipe ids, step numbers and step titles come from
# app/assets/data/recipes/*.json; questions come from those recipes' follow_up_questions.
DEMO_SQL = """
do $$
declare
  fam uuid;
  mom uuid; dad uuid; grandma uuid; leo uuid; maya uuid;
  t_leo_dad uuid; t_leo_mom uuid; t_leo_grandma uuid; t_maya_grandma uuid;
  pair uuid[];
begin
  insert into public.families (name, code_hash) values ('Our family', '{demo_hash}')
  on conflict (code_hash) do update set name = excluded.name
  returning id into fam;
  {profiles}
  select id into mom from public.profiles where family_id = fam and lower(name) = 'mom' and removed_at is null;
  select id into dad from public.profiles where family_id = fam and lower(name) = 'dad' and removed_at is null;
  select id into grandma from public.profiles where family_id = fam and lower(name) = 'grandma' and removed_at is null;
  select id into leo from public.profiles where family_id = fam and lower(name) = 'leo' and removed_at is null;
  select id into maya from public.profiles where family_id = fam and lower(name) = 'maya' and removed_at is null;

  delete from public.messages where family_id = fam and seed;

  -- threads store the smaller uuid in a_profile
  pair := array[least(leo, dad), greatest(leo, dad)];
  insert into public.threads (family_id, a_profile, b_profile) values (fam, pair[1], pair[2])
  on conflict (family_id, a_profile, b_profile) do update set a_profile = excluded.a_profile returning id into t_leo_dad;
  pair := array[least(leo, mom), greatest(leo, mom)];
  insert into public.threads (family_id, a_profile, b_profile) values (fam, pair[1], pair[2])
  on conflict (family_id, a_profile, b_profile) do update set a_profile = excluded.a_profile returning id into t_leo_mom;
  pair := array[least(leo, grandma), greatest(leo, grandma)];
  insert into public.threads (family_id, a_profile, b_profile) values (fam, pair[1], pair[2])
  on conflict (family_id, a_profile, b_profile) do update set a_profile = excluded.a_profile returning id into t_leo_grandma;
  pair := array[least(maya, grandma), greatest(maya, grandma)];
  insert into public.threads (family_id, a_profile, b_profile) values (fam, pair[1], pair[2])
  on conflict (family_id, a_profile, b_profile) do update set a_profile = excluded.a_profile returning id into t_maya_grandma;

  -- Dad -> Leo: the chili, with a note. Leo asks about step 3; Dad answers (unread by Leo).
  insert into public.messages (family_id, thread_id, sender_id, kind, body, recipe_id, step_order, seed, created_at) values
    (fam, t_leo_dad, dad, 'recipe', 'Made a big pot today and thought of you. Try it this Sunday.',
     'dad-sunday-chili', null, true, now() - interval '3 days 4 hours'),
    (fam, t_leo_dad, leo, 'step', 'How much bean paste would you start with if I''m nervous about spice?',
     'dad-sunday-chili', 3, true, now() - interval '2 days 2 hours'),
    (fam, t_leo_dad, dad, 'text', 'Start with half of my big spoon. Taste it after the simmer and stir in the rest if you want it warmer.',
     'dad-sunday-chili', null, true, now() - interval '1 day 20 hours');

  -- Leo -> Mom: a request for a dish she hasn't recorded yet (unread by Mom).
  insert into public.messages (family_id, thread_id, sender_id, kind, body, seed, created_at) values
    (fam, t_leo_mom, leo, 'request', 'Will you teach me your Sunday eggs? The ones you made the morning I left.',
     true, now() - interval '1 day 3 hours');

  -- Leo -> Grandma: a question on step 1 of the noodle soup (unread by Grandma).
  insert into public.messages (family_id, thread_id, sender_id, kind, body, recipe_id, step_order, seed, created_at) values
    (fam, t_leo_grandma, leo, 'step', 'Grandma, how many cups is one of your heaping rice bowls of flour?',
     'grandma-hand-pulled-noodle-soup', 1, true, now() - interval '14 hours');

  -- Grandma -> Maya: the noodle soup (unread by Maya).
  insert into public.messages (family_id, thread_id, sender_id, kind, body, recipe_id, seed, created_at) values
    (fam, t_maya_grandma, grandma, 'recipe', 'Cold mornings are coming. Make these noodles for yourself, and don''t cut them.',
     'grandma-hand-pulled-noodle-soup', true, now() - interval '6 hours');

  update public.threads t set last_message_at = (select max(created_at) from public.messages m where m.thread_id = t.id)
   where t.family_id = fam;

  -- Read receipts: each sender has read up to their own last message; Dad read Leo's question.
  insert into public.thread_reads (thread_id, profile_id, last_read_at)
  select m.thread_id, m.sender_id, max(m.created_at) from public.messages m where m.family_id = fam group by 1, 2
  on conflict (thread_id, profile_id) do update set last_read_at = greatest(public.thread_reads.last_read_at, excluded.last_read_at);
end $$;
"""

TEST_SQL = """
do $$
declare fam uuid;
begin
  insert into public.families (name, code_hash) values ('Test family', '{test_hash}')
  on conflict (code_hash) do update set name = excluded.name
  returning id into fam;
  {profiles}
end $$;
"""


# The family circle (one group thread per family; the migration created it empty). Leo asks two
# step questions there about real recipe steps; Dad answers the chili one, so it is also saved as a
# recipe note. Step numbers and wording come from app/assets/data/recipes/*.json:
#   grandma-hand-pulled-noodle-soup step 2 "Knead until smooth"
#   dad-sunday-chili step 3 "Toast the spices with the bean paste" (cue: the oil turns brick red and
#   the smell hits the back of your nose without scorching; about a minute)
# Re-running replaces only the circle's seed=true messages (and, by cascade, their notes).
CIRCLE_SQL = """
do $$
declare
  fam uuid; dad uuid; leo uuid; circle uuid; q_chili uuid; a_chili uuid;
begin
  select id into fam from public.families where code_hash = '{hash}';
  if fam is null then raise exception 'family not found'; end if;
  select id into dad from public.profiles where family_id = fam and lower(name) = 'dad' and removed_at is null;
  select id into leo from public.profiles where family_id = fam and lower(name) = 'leo' and removed_at is null;
  insert into public.threads (family_id, kind) values (fam, 'circle')
  on conflict (family_id) where kind = 'circle' do nothing;
  select id into circle from public.threads where family_id = fam and kind = 'circle';

  delete from public.messages where thread_id = circle and seed;

  insert into public.messages (family_id, thread_id, sender_id, kind, body, recipe_id, step_order, seed, created_at)
  values (fam, circle, leo, 'question', 'How do I know the spices are toasted and not burnt?',
          'dad-sunday-chili', 3, true, now() - interval '1 day 22 hours')
  returning id into q_chili;
  insert into public.messages (family_id, thread_id, sender_id, kind, body, reply_to, seed, created_at)
  values (fam, circle, dad, 'text',
          'About a minute. When the oil turns brick red and the smell hits the back of your nose, mix it all in before it scorches.',
          q_chili, true, now() - interval '1 day 19 hours')
  returning id into a_chili;
  insert into public.recipe_notes (family_id, recipe_id, step_order, question_message_id, question, asked_by,
                                   answer_message_id, answer_text, answered_by, created_at)
  select fam, 'dad-sunday-chili', 3, q_chili, q.body, leo, a_chili, a.body, dad, a.created_at
    from public.messages q, public.messages a where q.id = q_chili and a.id = a_chili;

  -- Open: nobody has answered this one yet (shows as "Waiting for your answer" for every cook).
  insert into public.messages (family_id, thread_id, sender_id, kind, body, recipe_id, step_order, seed, created_at)
  values (fam, circle, leo, 'question', 'Grandma, how long do you knead it? Mine still sticks to my hand.',
          'grandma-hand-pulled-noodle-soup', 2, true, now() - interval '9 hours');

  update public.threads set last_message_at = (select max(created_at) from public.messages where thread_id = circle)
   where id = circle;
  insert into public.thread_reads (thread_id, profile_id, last_read_at)
  select thread_id, sender_id, max(created_at) from public.messages where thread_id = circle group by 1, 2
  on conflict (thread_id, profile_id) do update set last_read_at = greatest(public.thread_reads.last_read_at, excluded.last_read_at);
end $$;
"""


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--circle-only"]
    if len(args) != 1:
        sys.exit(__doc__)
    demo = dotenv_values(ROOT / ".env").get("FAMILY_CODE")
    if not demo:
        sys.exit("FAMILY_CODE is missing from .env")
    demo_hash, test_hash = code_hash(demo), code_hash(test_code())
    circles = CIRCLE_SQL.format(hash=demo_hash) + CIRCLE_SQL.format(hash=test_hash)
    if "--circle-only" in sys.argv:
        sql = circles
    else:
        profiles = PROFILES_SQL.format(fam="fam")
        sql = DEMO_SQL.format(demo_hash=demo_hash, profiles=profiles) + TEST_SQL.format(
            test_hash=test_hash, profiles=profiles) + circles
    out = Path(args[0])
    out.write_text(sql)
    print(f"wrote {out}")

if __name__ == "__main__":
    main()

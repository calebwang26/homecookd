-- Family invites and "a phone's person is set once" (FEEDBACK-OCT16c section E1-E3).
-- Apply before deploying the api function that sends `POST /invites {}` (it inserts invites with no
-- profile). Additive: existing named invites and devices are unchanged.

-- 1. A family invite names nobody: whoever opens it joins the family, then adds themselves
-- (POST /profiles/self). The older named invites (Mom invites Dad) still carry the person.
alter table public.invites alter column profile_id drop not null;

comment on column public.invites.profile_id is
  'The person invited (their profile exists from the moment of inviting). Null for a family invite: '
  'whoever opens it joins with a phone that has no person yet, then adds themselves.';

-- 2. A phone's person is set once and never moves (the api enforces it with a conditional update
-- `where profile_id is null`). Null means no person yet: a family-code swap or a family invite.
comment on column public.devices.profile_id is
  'This phone''s person, set once: who signed in on it, or for a phone that came in with no person '
  '(via code, or a family invite) the first phone-less person it wrote as, or who it added with '
  'POST /profiles/self. Null until then. Someone with a live phone can only be acted as from it.';

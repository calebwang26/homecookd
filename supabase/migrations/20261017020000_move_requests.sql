-- Moving to a new phone (Oct 17). Dad lost his phone and joined again through a family invite, so
-- his new phone has a key with no person. It asks to be Dad (POST /move-requests); someone in the
-- family on their own phone lets him in (POST /move-requests/:id/approve), which makes the new phone
-- his and signs his other phones out. A family-invite phone can no longer become an existing face by
-- writing as them: it adds itself (POST /profiles/self) or asks to move in.
--
-- Apply BEFORE deploying the api function that has these routes: it reads this table in
-- GET /family (`move_requests_pending`) and writes it on removal. Additive.

create table public.move_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  -- The person the phone asks to be.
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The asking phone: a family-invite key with no person yet.
  device_id uuid not null references public.devices(id) on delete cascade,
  -- 'expired' is never stored: a pending request older than 7 days reads as expired.
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  -- Who approved or declined it. Null when homecookd closed it: replaced by a newer ask from the
  -- same phone, expired and asked again, or the person was removed.
  decided_by uuid references public.profiles(id) on delete set null,
  constraint move_requests_decided check ((status = 'pending') = (decided_at is null))
);

-- One pending request per phone: asking for someone else replaces it.
create unique index move_requests_one_pending on public.move_requests (device_id) where status = 'pending';
create index move_requests_family_idx on public.move_requests (family_id, status, created_at);
create index move_requests_device_idx on public.move_requests (device_id, created_at);
create index move_requests_profile_idx on public.move_requests (profile_id);
create index move_requests_decided_by_idx on public.move_requests (decided_by);

-- Deny-all to client keys; the api function (service role) does everything.
alter table public.move_requests enable row level security;
revoke all on public.move_requests from anon, authenticated;
grant select, insert, update, delete on public.move_requests to service_role;

comment on table public.move_requests is
  'A phone that joined through a family invite asking to be someone already in the family (they '
  'moved to a new phone). Approved by someone else on their own phone; approval makes the asking '
  'phone theirs and signs their other phones out.';

-- The rule for a phone's person, as of this migration (the api enforces it).
comment on column public.devices.profile_id is
  'This phone''s person, set once: who signed in on it, who it added with POST /profiles/self, who '
  'it was let in as (an approved move request), or for a family-code swap (via code) the first '
  'phone-less person it wrote as. A family-invite phone never becomes an existing face by writing '
  'as them. Null until then. Someone with a live phone can only be acted as from it.';

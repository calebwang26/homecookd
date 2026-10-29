-- Join links (docs/build/JOIN-SIMPLE.md §3): a family's one link, homecookd.app/i?t=<token>, that anyone may
-- join through, any number of times, until it expires (7 days; POST /join-links, joinLinks.ts). The token is
-- 22 random base62 characters. Only its sha256 is looked up; token_enc keeps it AES-GCM sealed (as
-- families.code_enc, AAD = the link's id) so the app shows the same link all week. expires_at null = never:
-- only an operator's TEST family link for App Review (§5), which the api never hands out or turns off.
--
-- Same access model as the rest: RLS on, no policies, no grants to anon/authenticated; only the api function
-- (service role) reads it. Additive and idempotent. Apply BEFORE deploying the api that has POST /join-links
-- (after Apple approves 1.0).

create table if not exists public.join_links (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  -- Who made it (the join card's "Mom sent this."). Null once they're deleted.
  inviter_id uuid references public.profiles(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The token, sealed. Null for a link made outside the api (the operator's): it's never handed out again.
  token_enc text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists join_links_family_idx on public.join_links (family_id);
create index if not exists join_links_inviter_idx on public.join_links (inviter_id);

alter table public.join_links enable row level security;
revoke all on public.join_links from anon, authenticated;
grant select, insert, update, delete on public.join_links to service_role;

comment on table public.join_links is
  'A family''s join link (JOIN-SIMPLE.md): anyone with it may join that family until it expires or is '
  'turned off. Only sha256(token) is looked up; token_enc is the sealed token. expires_at null: the '
  'operator''s TEST family link for App Review.';

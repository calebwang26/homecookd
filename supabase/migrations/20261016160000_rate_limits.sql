-- Shared rate limits for the api function. Edge isolates don't share memory, so the limits live
-- here. Keys are built by the function (route + hashed IP or email); rows older than the window
-- are dropped on the next hit for that key, and anything over a day old is swept now and then.
-- Same access model as the rest: RLS on, no policies, no grants to anon/authenticated.

create table public.rate_hits (
  key text not null check (char_length(key) <= 200),
  at timestamptz not null default now()
);
create index rate_hits_key_at_idx on public.rate_hits (key, at);
create index rate_hits_at_idx on public.rate_hits (at);

alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;
grant select, insert, delete on public.rate_hits to service_role;

-- true = allowed (and counted), false = over the limit (not counted).
create or replace function public.hit_rate(p_key text, p_max int, p_window interval)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));
  delete from public.rate_hits where key = p_key and at < now() - p_window;
  select count(*) into used from public.rate_hits where key = p_key;
  if used >= p_max then
    return false;
  end if;
  insert into public.rate_hits (key) values (p_key);
  if random() < 0.01 then
    delete from public.rate_hits where at < now() - interval '1 day';
  end if;
  return true;
end;
$$;

revoke all on function public.hit_rate(text, int, interval) from public, anon, authenticated;
grant execute on function public.hit_rate(text, int, interval) to service_role;

-- Joins per share link are counted from the sign-up log (see POST /auth/email).
create index signups_share_token_idx on public.signups (share_token) where share_token is not null;

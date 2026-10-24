-- Atomic open counter for public share links. Called only by the `api` edge function (service role).
create or replace function public.share_opened(p_token text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.shares
     set open_count = open_count + 1,
         last_opened_at = now()
   where token = p_token;
$$;

revoke all on function public.share_opened(text) from public, anon, authenticated;
grant execute on function public.share_opened(text) to service_role;

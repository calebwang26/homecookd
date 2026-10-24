-- The Sunday table's history in one call (docs/build/RETENTION-HANDOFF.md 3.2, PR 5): GET /table and
-- the Sunday nudge need up to a year (or more, for a long streak) of a family's activity, and a plain
-- select would stop at PostgREST's 1000-row cap and quietly undercount a chatty family's weeks. This
-- function returns ONE jsonb array instead, which the cap never truncates.
--
-- Rows are raw instants, not week keys: supabase/functions/api/table.ts puts each pair's weeks in
-- that kid's own zone, so the database can't bucket by week. To keep the payload small, repeats of
-- the same thing by the same person within a 15-minute slot collapse into one row (the earliest
-- instant). Every zone's offset is a whole number of quarter hours, so a slot never straddles a local
-- midnight and the week each row lands in is exact.
--
-- One row per thing someone did, nulls left out of each object:
--   {at, actor_id, kind: 'cooked',    target_cook_id?, recipe_id?}   recipe_events (recipe_id only
--   {at, actor_id, kind: 'heard',     target_cook_id?, recipe_id?,    when cook_id is null: older
--        duration_s}                                                  events, mapped by the api)
--   {at, actor_id, kind: 'message',   thread_with?}                   messages except system notes;
--                                                                     thread_with = the other person
--                                                                     of a 1:1 thread, absent in the
--                                                                     family circle
--   {at, actor_id, kind: 'published', target_kid_id?, recipe_id?}    a recording that went out
--                                                                     (pending_sends.delivered_at),
--                                                                     one row per recipient, or one
--                                                                     without a target when it went
--                                                                     to nobody; recipe_id = the dish
--                                                                     it became
-- A published row's actor is pending_sends.sender_id, whoever registered the send (often a kid who
-- filmed the cook). The api credits the row to the dish's cook instead, through recipe_id and the
-- library (tablePr.ts toActivity), so the cook whose recording went out is the one who lights.
-- A recipe sent with POST /send-recipe, and each recipient's copy of a published recording, arrive as
-- 'recipe' messages in the pair thread, so they count as 'message' rows toward that kid. Heard clips
-- under 3 s never count, so they never leave the database.
--
-- Same access model as the rest: security definer for the api's service role only; client keys can't
-- call it (revoked from public, anon & authenticated).
--
-- Apply AFTER 20261018100000_retention_plumbing.sql (it reads recipe_events.cook_id & duration_s) and
-- BEFORE deploying the api function that registers GET /table (MCP apply_migration; never
-- `supabase db push`: the live migration versions don't match these file names).

create or replace function public.table_activity(p_family uuid, p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with raw as (
    select e.created_at as at,
           e.profile_id as actor_id,
           e.kind,
           e.cook_id as target_cook_id,
           null::uuid as target_kid_id,
           null::uuid as thread_with,
           case when e.kind = 'heard' then e.duration_s end as duration_s,
           case when e.cook_id is null then e.recipe_id end as recipe_id
      from public.recipe_events e
     where e.family_id = p_family
       and e.created_at >= p_since
       and (e.kind = 'cooked' or (e.kind = 'heard' and e.duration_s >= 3))
    union all
    select m.created_at,
           m.sender_id,
           'message'::text,
           null::uuid,
           null::uuid,
           case when t.kind = 'pair' then
             case when t.a_profile = m.sender_id then t.b_profile else t.a_profile end
           end,
           null::numeric,
           null::text
      from public.messages m
      join public.threads t on t.id = m.thread_id
     where m.family_id = p_family
       and m.created_at >= p_since
       and m.kind <> 'system'
    union all
    select s.delivered_at,
           s.sender_id,
           'published'::text,
           null::uuid,
           r.kid,
           null::uuid,
           null::numeric,
           s.recipe_id
      from public.pending_sends s
      left join lateral unnest(s.recipient_ids) as r(kid) on true
     where s.family_id = p_family
       and s.delivered_at is not null
       and s.delivered_at >= p_since
  ),
  slots as (
    select min(at) as at, actor_id, kind, target_cook_id, target_kid_id, thread_with,
           max(duration_s) as duration_s, recipe_id
      from raw
     group by actor_id, kind, target_cook_id, target_kid_id, thread_with, recipe_id,
              floor(extract(epoch from at) / 900)
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(s)) order by s.at), '[]'::jsonb)
    from slots s;
$$;

revoke all on function public.table_activity(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.table_activity(uuid, timestamptz) to service_role;

comment on function public.table_activity(uuid, timestamptz) is
  'The Sunday table''s raw activity for one family since p_since, as one jsonb array (no 1000-row cap): '
  'cooked & heard (>= 3 s) recipe events, non-system messages with the other person of a 1:1 thread, '
  'and delivered recordings per recipient (with the dish they became). Repeats within a 15-minute slot collapse. api only (GET /table, '
  'the Sunday nudge); see supabase/functions/api/tablePr.ts.';

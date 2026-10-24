-- Favorites (FEEDBACK-OCT16b section 4): the dishes each person hearted, kept per profile so the
-- kid app's Favorites chip and "Your favorites" row follow them to any device (and feed later
-- recommendations). Additive only.
-- Same access model as the rest: RLS on, no policies, no grants to anon/authenticated; only the api
-- function (service role) reads or writes it.

create table public.favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recipe_id text not null check (recipe_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  created_at timestamptz not null default now(),
  primary key (profile_id, recipe_id)
);
-- "Who hearted this dish" across a family (the primary key already serves per-profile lookups).
create index favorites_recipe_idx on public.favorites (recipe_id);

alter table public.favorites enable row level security;
revoke all on public.favorites from anon, authenticated;
grant select, insert, delete on public.favorites to service_role;

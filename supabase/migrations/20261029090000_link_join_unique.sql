-- One join per dish card side, enforced by the database too (docs/build/V2-LINKING.md §2.4, POST /auth/link).
-- link.ts logs each join in signups as share_token 'link:<card>:<side>' and checks first; this index closes the
-- moment between the check and the insert, so two joins at once can't both get in. Additive: no existing row
-- has a 'link:' share token. Apply with the api deploy that ships link.ts (after Apple approves 1.0).
create unique index if not exists signups_link_share_token
  on public.signups (share_token)
  where share_token like 'link:%';

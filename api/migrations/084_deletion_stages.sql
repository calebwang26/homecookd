-- An account deletion's stages, made explicit (Caleb, Nov 8: decision 7; docs/agents/STATE-MACHINES.md row 8; the table is in
-- api/src/modules/accounts/deletion.ts). An outside purge that ran out of attempts now says so on its row, and the team's retry
-- (api/src/deletions.ts) clears it. Production and staging had none given up and none breaking the rules below on Nov 9.
alter table account_deletions add column external_gave_up_at timestamptz;
update account_deletions set external_gave_up_at = coalesce(external_tried_at, now())
 where purged_at is not null and external_purged_at is null and external_attempts >= 10; -- MAX_OUTSIDE_ATTEMPTS when this was written

-- The states that can't be: the outside purge done before the inside one, given up once done, the lists cleared before done.
alter table account_deletions add constraint account_deletions_stages check (
  (external_purged_at is null or purged_at is not null)
  and (external_gave_up_at is null or (purged_at is not null and external_purged_at is null))
  and (lists_cleared_at is null or external_purged_at is not null)
  and external_attempts >= 0 and purge_restarts >= 0
);

-- 076: the outside purge's claim, so a schedule's retry and a message carrying on can't run the same deletion at once and count its files twice.
alter table account_deletions add column external_claimed_until timestamptz;

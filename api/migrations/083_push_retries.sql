-- A push Expo couldn't take is tried again (Caleb, Nov 8: decision 6; docs/agents/STATE-MACHINES.md row 10). The row is the machine
-- (api/src/modules/messages/pushData.ts): 'sending' is a claimed send, where 'queued' with delivering_at set used to stand for it, and
-- attempts counts the wake-ups spent on it: each claim, and each wake-up the sweep had to send again because the last one never arrived.
-- Old rows keep working: a 'queued' row with delivering_at set is still a holder's for 4 minutes.
alter table push_log drop constraint push_log_status_check;
alter table push_log add constraint push_log_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'none', 'capped', 'skipped'));
alter table push_log add column attempts int not null default 0 check (attempts >= 0);

-- The sweep's look for a send whose holder went quiet.
create index push_log_sending on push_log (delivering_at) where status = 'sending';

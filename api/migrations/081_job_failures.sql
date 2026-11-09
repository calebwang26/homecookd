-- A job's try budget lives in its row, not in SQS's receive count (Caleb, Nov 8: stuck jobs re-queued; docs/agents/STATE-MACHINES.md).
-- attempts counts claims (the fence, and each attempt's own folder); failures counts tries that went wrong: the child failed or died,
-- the lease lapsed with its worker gone, or the job was found queued with no wake-up left. A deploy stop or a wait never counts.
-- The third failure fails the job visibly (pipeline/queue_worker.py MAX_FAILURES).
alter table jobs add column failures int not null default 0 check (failures >= 0);

-- The worker's sweep finds a queued job with no wake-up still owed: an unsent 'jobs' row in the outbox for it. Only these columns.
grant select (queue, payload, sent_at) on outbox to homecookd_worker;

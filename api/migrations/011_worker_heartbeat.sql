-- 011: the worker's heartbeat on a running job (docs/build/WORKER-MIGRATION.md). A running job whose heartbeat has stopped
-- belonged to a worker that died, so another may claim it. claimed_at keeps its meaning: when this attempt started.
-- Adds one nullable column, so the previous release keeps running. The stuck-job sweep reads jobs_unfinished.
alter table jobs add column heartbeat_at timestamptz;

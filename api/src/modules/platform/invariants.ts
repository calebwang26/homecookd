// States that must never be true, one or two per machine (docs/agents/STATE-MACHINES.md; Caleb, Nov 9: "what saves the most time"). Every 5 minutes the
// `platform.invariants` task counts each. Per invariant and run it logs one "invariant checked" line with its count, even at 0, which a CloudWatch metric filter
// turns into a metric and an alarm (infra/modules/env/invariants.tf), and one "INVARIANT <name>" line per violating row naming its id, so a chat can act.
// Ids only, never a name or content. Read-only: putting a row right is its owning module's job.
import * as Sentry from "@sentry/node";
import { db } from "../../db.js";
import { STUCK_ATTEMPTS } from "../../outbox.js";
import type { Trace } from "../dish/budget.js";

/** The ids logged for one invariant in one run. The count is always whole. */
export const IDS_PER_RUN = 20;
/** pipeline/queue_db.py RUNNING. */
const RUNNING = ["preparing", "understanding", "writing", "indexing"];

export type Invariant = { name: string; owner: string; sql: string; args: unknown[] };

/** Each `sql` selects the violating rows' `id`. The names are the metric filters' too: change both together. */
export const INVARIANTS: Invariant[] = [
  {
    // The worker's sweep wakes one again at 3 hours (pipeline/queue_worker.py STRANDED_S); seen here at 3 hours, that wake-up didn't take.
    name: "job_queued_no_wakeup",
    owner: "AWS backend",
    sql: `select j.id from jobs j
           where j.stage = 'queued' and j.cancelled_at is null and j.updated_at < now() - interval '3 hours'
             and not exists (select 1 from outbox o where o.queue = 'jobs' and o.sent_at is null and o.payload->>'jobId' = j.id)`,
    args: [],
  },
  {
    // The lease is 10 minutes, and the worker's sweep wakes a lapsed run within 5 more while it's idle.
    name: "job_running_stale",
    owner: "AWS backend",
    sql: `select id from jobs
           where stage = any($1::text[]) and cancelled_at is null
             and coalesce(heartbeat_at, claimed_at, updated_at) < now() - interval '15 minutes'`,
    args: [RUNNING],
  },
  {
    // push.sweep wakes a push 20 minutes past due, and takes over a send quiet for 10 (messages/pushData.ts); an hour means the wake-ups don't take.
    name: "push_queued_stale",
    owner: "AWS backend",
    sql: `select id::text as id from push_log
           where (status = 'queued' and send_at < now() - interval '1 hour') or (status = 'sending' and delivering_at < now() - interval '1 hour')`,
    args: [],
  },
  {
    name: "dish_merge_stuck",
    owner: "AWS backend",
    sql: `select id from dish_asks
           where merge_started_at < now() - interval '10 minutes' and (merged_at is null or merged_at < merge_started_at)`,
    args: [],
  },
  {
    // The purge inside the database stalled, or the purge outside it gave up (accounts/deletion.ts). node dist/deletions.js stalled lists them, retry <id> restarts one.
    name: "deletion_stalled",
    owner: "AWS backend",
    sql: `select id from account_deletions
           where (purged_at is null and requested_at < now() - interval '1 hour') or external_gave_up_at is not null`,
    args: [],
  },
  {
    name: "outbox_stuck",
    owner: "AWS backend",
    sql: `select id::text as id from outbox where sent_at is null and attempts >= $1`,
    args: [STUCK_ATTEMPTS],
  },
  {
    name: "recipe_shared_not_ready",
    owner: "AWS backend",
    sql: `select id from recipes where status <> 'ready' and (shared_at is not null or hidden_at is not null)`,
    args: [],
  },
  {
    name: "dinner_full_with_seats",
    owner: "AWS backend",
    sql: `select d.id from dinners d
           where d.status = 'full'
             and (select count(*) from dinner_requests r where r.dinner_id = d.id and r.status = 'accepted') < d.seats`,
    args: [],
  },
];

/** The liveness line: its metric missing for 15 minutes alarms, so a sweep that stopped running is seen too. */
export const RAN = "invariants_ran";

/** One pass. Returns each invariant's count; one whose query fails is reported and left out (its metric goes quiet, never a false 0). */
export async function checkInvariants(trace: Trace, invariants = INVARIANTS): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const inv of invariants) {
    const n = inv.args.length + 1;
    let row: { count: number; ids: string[] };
    try {
      const { rows } = await db().query(
        `with v as (${inv.sql})
         select (select count(*) from v)::int as count,
                (select coalesce(array_agg(id order by id), '{}') from (select id from v order by id limit $${n}) x) as ids`,
        [...inv.args, IDS_PER_RUN],
      );
      row = rows[0];
    } catch (error) {
      trace.log.error({ invariant: inv.name, err: { type: (error as Error).name } }, "invariant query failed");
      Sentry.captureException(error, { extra: { invariant: inv.name } });
      continue;
    }
    counts[inv.name] = row.count;
    trace.log.info({ invariant: inv.name, count: row.count }, "invariant checked");
    for (const id of row.ids) trace.log.error({ invariant: inv.name, id, owner: inv.owner }, `INVARIANT ${inv.name}`);
  }
  trace.log.info({ invariant: RAN, count: 1 }, "invariant checked");
  return counts;
}

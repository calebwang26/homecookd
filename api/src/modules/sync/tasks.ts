// The sync's work on the `scheduled` queue. Each can arrive twice, and a lease stops two tasks doing the same run. A task that throws leaves its message on
// the queue: SQS tries again, and after 3 tries it goes to the dead-letter queue, which raises an alert. Schedules: SYNC-MIGRATION.md.
import * as Sentry from "@sentry/node";
import { sendAlert } from "../../alerts.js";
import type { Trace } from "../dish/budget.js";
import * as data from "./data.js";
import { runReconcile } from "./reconcile.js";
import { runDeletions, runPass, type Reporter, type Run } from "./service.js";
import { syncSources } from "./sources.js";
import { syncMode } from "./switch.js";

type Payload = Record<string, unknown>;

// Named errors, because Sentry gets the type and never the text (sentry.ts). The webhook too, since Sentry stays off anything with real people's data until
// /privacy names it (AWS-MIGRATION). An alert holds a name and counts, and failing to send one can't fail the work.
const alertBoth: Reporter["alert"] = (name, tags) => {
  Sentry.captureException(Object.assign(new Error(name), { name }), { tags });
  void sendAlert(`homecookd: ${name}`, JSON.stringify(tags ?? {})).catch(() => {});
};

const OFF_ALERT_S = 3600;

function reporter(trace: Trace): Reporter {
  const log = trace.log as Reporter["log"];
  return { log: { info: (fields, message) => log.info?.(fields, message), error: (fields, message) => log.error(fields, message) }, alert: alertBoth };
}

const run = (trace: Trace): Run => ({ ...syncSources(), report: reporter(trace) });

/** Off, and copies hold real rows: a deletion can't reach them. `deletions` is the safe way to pause. */
async function warnIfOffWithCopies(trace: Trace): Promise<void> {
  const { last_success_at: everRan } = await data.readState("deletions");
  if (everRan && (await data.claimAlert("deletions", OFF_ALERT_S))) {
    trace.log.error({}, "the sync is off but copies exist, so deletions aren't reaching them");
    alertBoth("SyncOffWithCopies");
  }
}

export const syncTasks: Record<string, (payload: Payload, trace: Trace) => Promise<void>> = {
  "sync.deletions": async (_payload, trace) => {
    if (syncMode() === "off") return warnIfOffWithCopies(trace);
    await runDeletions(run(trace));
  },
  "sync.pass": async (_payload, trace) => {
    if (syncMode() !== "on") return;
    await runPass(run(trace));
  },
  "sync.reconcile": async (_payload, trace) => {
    if (syncMode() !== "on") return;
    await runReconcile(run(trace));
  },
  // A deletion's purge is the account's own (`accounts.purge`), queued with the deletion in the same transaction: it reaches every area that has moved.
};

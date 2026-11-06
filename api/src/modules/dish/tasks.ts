// The dish ask's work on the `scheduled` queue. Each can arrive twice, so each is safe to repeat. A task that throws leaves its message on the
// queue: SQS tries again, and after 3 tries it goes to the dead-letter queue, which raises an alert.
import { sendAlert } from "../../alerts.js";
import { db } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { objectStore } from "../../storage.js";
import { budgetAlertText, type Trace } from "./budget.js";
import * as data from "./data.js";
import { hear, merge } from "./merge.js";
import { IP_KEY_DAYS, ORPHAN_MS } from "./values.js";

type Payload = Record<string, unknown>;

const text = (payload: Payload, name: string) => {
  const value = payload[name];
  if (typeof value !== "string" || !value) throw new Error(`a task is missing ${name}`);
  return value;
};

/** The team hears once a day, however often the message arrives. If the webhook fails, the mark comes off and the queue tries again. */
async function budgetAlert(payload: Payload): Promise<void> {
  const day = text(payload, "day");
  const mark = `budget-alert:${day}`;
  if (!(await data.markAlertSent(mark))) return;
  try {
    await sendAlert("homecookd: dish budget reached", budgetAlertText(day, Number(payload.usd)));
  } catch (error) {
    await data.unmarkAlertSent(mark);
    throw error;
  }
}

const KEEP_DELETED_DAYS = 7;

/** A message stays well under SQS's 300 s visibility, and what's left goes on a new message. */
export const SWEEP = { ms: 60_000, batch: 200 };

/**
 * The hourly sweep: uploads no card took within an hour go; S3 deletes happen for everything marked, real deletions first; a deleted file's row goes
 * after a week; C4's old ip_keys go. It works through batches until they're done or its time is up, then queues itself, so a flood of orphans can't hold
 * up a real deletion. A file S3 wouldn't delete stays marked and fails the message, so it's tried again and someone hears.
 */
export async function sweep(trace: Trace): Promise<void> {
  const started = Date.now();
  const inTime = () => Date.now() - started < SWEEP.ms;
  let failures = 0;
  let more = false;
  for (;;) {
    const orphans = await data.markOrphanFiles(ORPHAN_MS, SWEEP.batch);
    const keys = await data.filesToDelete(SWEEP.batch);
    let removed = 0;
    for (const key of keys) {
      try {
        await objectStore().remove(key);
        await data.markFileDeleted(key);
        removed += 1;
      } catch (error) {
        failures += 1;
        trace.log.error({ err: { type: (error as Error).name } }, "an S3 delete failed");
      }
    }
    // Nothing went this round: S3 is down, or nothing's left. Going on would only repeat it.
    const full = orphans === SWEEP.batch || keys.length === SWEEP.batch;
    if (removed === 0 || !full) {
      more = false;
      break;
    }
    if (!inTime()) {
      more = true;
      break;
    }
  }
  await data.dropDeletedFileRows(KEEP_DELETED_DAYS);
  await data.clearOldIpKeys(IP_KEY_DAYS);
  if (more) await enqueue(db(), { queue: "scheduled", payload: { task: "dish.sweep" }, requestId: trace.requestId });
  if (failures > 0) throw new Error(`${failures} S3 deletes failed`);
}

export const dishTasks: Record<string, (payload: Payload, trace: Trace) => Promise<void>> = {
  "dish.merge": (payload, trace) => merge(text(payload, "askId"), trace),
  "dish.hear": (payload, trace) => hear(text(payload, "answerId"), text(payload, "audioKey"), trace),
  "dish.budget_alert": (payload) => budgetAlert(payload),
  "dish.sweep": (_payload, trace) => sweep(trace),
};

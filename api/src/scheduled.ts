// The consumer of the `scheduled` queue: work a module put in `outbox` (outbox.ts sends it here), and EventBridge schedules. It runs as a
// loop inside every api task, with long polling, a few messages at a time. Every task must tolerate a repeat: SQS delivers at least once.
// A message is deleted only after its task succeeds. Otherwise SQS shows it again after the visibility timeout (300 s), and after 3 tries
// it moves to the dead-letter queue, which raises an alert. Logs get a task's name and ids, never the payload's text.
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type SQSClientConfig } from "@aws-sdk/client-sqs";
import * as Sentry from "@sentry/node";
import { db } from "./db.js";
import { accountTasks } from "./modules/accounts/tasks.js";
import { communityTasks } from "./modules/community/tasks.js";
import type { Trace } from "./modules/dish/budget.js";
import { dishTasks } from "./modules/dish/tasks.js";
import { jobTasks } from "./modules/jobs/tasks.js";
import { syncTasks } from "./modules/sync/tasks.js"; // temporary: comes off with the sync (docs/build/SYNC-MIGRATION.md)
import { messageTasks } from "./modules/messages/tasks.js";

type Task = (payload: Record<string, unknown>, trace: Trace) => Promise<void>;

/** Old windows, sent outbox rows and expired retries go: all safe to run any time, a batch at a time. */
async function prune(): Promise<void> {
  const passes = [
    `delete from rate_hits where (key, window_start) in (select key, window_start from rate_hits where window_start < now() - interval '2 days' limit 500)`,
    `delete from outbox where id in (select id from outbox where sent_at < now() - interval '7 days' limit 500)`,
    `delete from idempotency_keys where (scope, key) in (select scope, key from idempotency_keys where expires_at < now() limit 500)`,
  ];
  for (const sql of passes) {
    for (let i = 0; i < 20; i += 1) {
      const { rowCount } = await db().query(sql);
      if ((rowCount ?? 0) < 500) break;
    }
  }
}

const TASKS: Record<string, Task> = { ...dishTasks, ...jobTasks, ...syncTasks, ...communityTasks, ...messageTasks, ...accountTasks, "platform.prune": prune };

/**
 * One message, from the outbox ({outboxId, requestId, payload}) or a schedule ({payload}). An unknown or broken one throws, so it's seen. The worker's own
 * row names its work `kind` (pipeline/queue_db.py, finish), where the api's say `task`.
 */
export async function handleMessage(body: string, log: Trace["log"]): Promise<void> {
  const message = JSON.parse(body) as { outboxId?: string; requestId?: string | null; payload?: Record<string, unknown> };
  const name = message.payload?.task ?? message.payload?.kind;
  const task = typeof name === "string" ? TASKS[name] : undefined;
  if (!task || !message.payload) throw new Error("A message with no known task");
  await task(message.payload, { requestId: message.requestId ?? undefined, log });
}

/** `receiveCount` and `sentAt` (ms) are SQS's ApproximateReceiveCount and SentTimestamp, when it sent them. */
export type Received = { id: string; body: string; receiveCount?: number; sentAt?: number };
export type Receiver = {
  /** Waits a while for up to `max` messages. */
  receive(max: number, signal: AbortSignal): Promise<Received[]>;
  remove(id: string): Promise<void>;
};

const IN_FLIGHT = 5;
const ERROR_WAIT_MS = 5_000;

/**
 * What a message's log lines say about it: its task's name if it's one we know, its outbox row and how many times SQS has handed it out.
 * Never the payload, so a name we don't know is only "unknown".
 */
function about(m: Received): { task: string; outboxId?: string; receiveCount?: number } {
  let message: { outboxId?: unknown; payload?: { task?: unknown; kind?: unknown } | null } = {};
  try {
    const parsed: unknown = JSON.parse(m.body);
    if (parsed && typeof parsed === "object") message = parsed;
  } catch {
    // A body that isn't JSON fails in its task, and says so there.
  }
  const name = message.payload?.task ?? message.payload?.kind;
  return {
    task: typeof name === "string" && Object.hasOwn(TASKS, name) ? name : "unknown",
    outboxId: typeof message.outboxId === "string" && /^\d+$/.test(message.outboxId) ? message.outboxId : undefined,
    receiveCount: m.receiveCount,
  };
}

/** The loop. stop() lets running tasks finish; what's still on the queue waits for another task. */
export function startConsumer(
  receiver: Receiver,
  log: Trace["log"],
  options: { handle?: (body: string) => Promise<void>; errorWaitMs?: number } = {},
): { stop: () => Promise<void> } {
  const handle = options.handle ?? ((body: string) => handleMessage(body, log));
  const stopping = new AbortController();
  const running = new Set<Promise<void>>();
  const one = async (m: Received) => {
    const fields = about(m);
    const start = Date.now();
    log.info(fields, "scheduled message received");
    // A second hand-out: its first try failed, or the answer that carried it was lost and SQS waited out the visibility timeout.
    if ((m.receiveCount ?? 1) > 1) {
      const lateS = m.sentAt === undefined ? undefined : Math.round((start - m.sentAt) / 1000);
      log.warn({ ...fields, lateS }, "scheduled message redelivered");
    }
    try {
      await handle(m.body);
      await receiver.remove(m.id);
      log.info({ ...fields, ms: Date.now() - start }, "scheduled message done");
    } catch (error) {
      // Stays on the queue.
      log.error({ ...fields, ms: Date.now() - start, err: { type: (error as Error).name } }, "a scheduled task failed");
      Sentry.captureException(error);
    }
  };
  const loop = (async () => {
    while (!stopping.signal.aborted) {
      if (running.size >= IN_FLIGHT) {
        await Promise.race(running);
        continue;
      }
      const start = Date.now();
      try {
        for (const m of await receiver.receive(IN_FLIGHT - running.size, stopping.signal)) {
          const task: Promise<void> = one(m).finally(() => running.delete(task));
          running.add(task);
        }
      } catch (error) {
        if (stopping.signal.aborted) break;
        // ms tells a lost answer (the 25 s timeout) from SQS saying no.
        log.error({ ms: Date.now() - start, err: { type: (error as Error).name } }, "reading the scheduled queue failed");
        await new Promise((resolve) => setTimeout(resolve, options.errorWaitMs ?? ERROR_WAIT_MS));
      }
    }
    await Promise.allSettled(running);
  })();
  return {
    stop: async () => {
      stopping.abort();
      await loop;
    },
  };
}

/**
 * The receiving client, separate from the sender's, whose timeouts are short. The long poll is 20 s, so the timeout has to be longer.
 * One attempt, not the SDK's retry: once SQS has answered a receive, what it handed out is hidden for the visibility timeout (300 s), so if
 * that answer is lost a retry can't get those messages back. It would only hide that it happened. With one attempt the loop logs "reading
 * the scheduled queue failed" and reads again after 5 s, which is the same retry, seen.
 */
export const RECEIVE_CLIENT: SQSClientConfig = { maxAttempts: 1, requestHandler: { connectionTimeout: 2_000, requestTimeout: 25_000 } };
/** Deleting keeps the SDK's retry: it's safe to repeat, and a delete lost to a blip would run the task again 5 minutes later. */
export const DELETE_CLIENT: SQSClientConfig = { ...RECEIVE_CLIENT, maxAttempts: 2 };
const num = (value: string | undefined) => (value && Number.isFinite(Number(value)) ? Number(value) : undefined);

export function sqsReceiver(
  queueUrl: string,
  receiving: Pick<SQSClient, "send"> = new SQSClient(RECEIVE_CLIENT),
  deleting: Pick<SQSClient, "send"> = new SQSClient(DELETE_CLIENT),
): Receiver {
  return {
    async receive(max, signal) {
      const out = await receiving.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: max,
          WaitTimeSeconds: 20,
          MessageSystemAttributeNames: ["ApproximateReceiveCount", "SentTimestamp"],
        }),
        { abortSignal: signal },
      );
      return (out.Messages ?? []).flatMap((m) =>
        m.ReceiptHandle && m.Body
          ? [{ id: m.ReceiptHandle, body: m.Body, receiveCount: num(m.Attributes?.ApproximateReceiveCount), sentAt: num(m.Attributes?.SentTimestamp) }]
          : [],
      );
    },
    async remove(id) {
      await deleting.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: id }));
    },
  };
}

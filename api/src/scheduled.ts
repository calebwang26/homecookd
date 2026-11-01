// The consumer of the `scheduled` queue: work a module put in `outbox` (outbox.ts sends it here), and EventBridge schedules. It runs as a
// loop inside every api task, with long polling, a few messages at a time. Every task must tolerate a repeat: SQS delivers at least once.
// A message is deleted only after its task succeeds. Otherwise SQS shows it again after the visibility timeout (300 s), and after 3 tries
// it moves to the dead-letter queue, which raises an alert. Logs get a task's name and ids, never the payload's text.
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import * as Sentry from "@sentry/node";
import { db } from "./db.js";
import type { Trace } from "./modules/dish/budget.js";
import { dishTasks } from "./modules/dish/tasks.js";
import { syncTasks } from "./modules/sync/tasks.js"; // temporary: comes off with the sync (docs/build/SYNC-MIGRATION.md)

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

const TASKS: Record<string, Task> = { ...dishTasks, ...syncTasks, "platform.prune": prune };

/** One message, from the outbox ({outboxId, requestId, payload}) or a schedule ({payload}). An unknown or broken one throws, so it's seen. */
export async function handleMessage(body: string, log: Trace["log"]): Promise<void> {
  const message = JSON.parse(body) as { outboxId?: string; requestId?: string | null; payload?: Record<string, unknown> };
  const name = message.payload?.task;
  const task = typeof name === "string" ? TASKS[name] : undefined;
  if (!task || !message.payload) throw new Error("A message with no known task");
  await task(message.payload, { requestId: message.requestId ?? undefined, log });
}

export type Received = { id: string; body: string };
export type Receiver = {
  /** Waits a while for up to `max` messages. */
  receive(max: number, signal: AbortSignal): Promise<Received[]>;
  remove(id: string): Promise<void>;
};

const IN_FLIGHT = 5;
const ERROR_WAIT_MS = 5_000;

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
    try {
      await handle(m.body);
      await receiver.remove(m.id);
    } catch (error) {
      // Stays on the queue.
      log.error({ err: { type: (error as Error).name } }, "a scheduled task failed");
      Sentry.captureException(error);
    }
  };
  const loop = (async () => {
    while (!stopping.signal.aborted) {
      if (running.size >= IN_FLIGHT) {
        await Promise.race(running);
        continue;
      }
      try {
        for (const m of await receiver.receive(IN_FLIGHT - running.size, stopping.signal)) {
          const task: Promise<void> = one(m).finally(() => running.delete(task));
          running.add(task);
        }
      } catch (error) {
        if (stopping.signal.aborted) break;
        log.error({ err: { type: (error as Error).name } }, "reading the scheduled queue failed");
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

export function sqsReceiver(queueUrl: string): Receiver {
  // The long poll is 20 s, so this timeout has to be longer. Separate from the sender's client, whose timeouts are short.
  const sqs = new SQSClient({ maxAttempts: 2, requestHandler: { connectionTimeout: 2_000, requestTimeout: 25_000 } });
  return {
    async receive(max, signal) {
      const out = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: max, WaitTimeSeconds: 20 }), { abortSignal: signal });
      return (out.Messages ?? []).flatMap((m) => (m.ReceiptHandle && m.Body ? [{ id: m.ReceiptHandle, body: m.Body }] : []));
    },
    async remove(id) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: id }));
    },
  };
}

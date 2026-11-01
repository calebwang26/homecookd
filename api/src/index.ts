import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { buildApp } from "./app.js";
import { db } from "./db.js";
import { sendDue } from "./outbox.js";

const app = buildApp();

// Every api task runs a sender; SKIP LOCKED keeps them off each other's rows. Off locally unless the queues are set.
const queues: Record<string, string | undefined> = {
  jobs: process.env.JOBS_QUEUE_URL,
  scheduled: process.env.SCHEDULED_QUEUE_URL,
};
if (queues.jobs && queues.scheduled) {
  const sqs = new SQSClient({});
  const send = async (queue: string, body: string) => {
    const url = queues[queue];
    if (!url) throw new Error(`Unknown queue ${queue}`);
    await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }));
  };
  const timer = setInterval(() => {
    sendDue(db(), send, app.log).catch((error) =>
      app.log.error({ err: { type: (error as Error).name } }, "outbox pass failed"),
    );
  }, 5_000);
  app.addHook("onClose", async () => clearInterval(timer));
}

// ECS sends SIGTERM before stopping a task: finish what's running, then leave.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void app.close().then(() => db().end()).finally(() => process.exit(0)));
}

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });

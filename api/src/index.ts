import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import * as Sentry from "@sentry/node";
import { buildApp } from "./app.js";
import { db } from "./db.js";
import { oldestDueAgeS, oneAtATime, sendDue } from "./outbox.js";
import { sqsReceiver, startConsumer } from "./scheduled.js";

// Someone who left can't be found when they come back without this (accounts/data.ts). Everything else works, so this says so rather than stopping.
if (!process.env.LEFT_IDENTITY_SECRET?.trim()) console.error(JSON.stringify({ level: "warn", msg: "LEFT_IDENTITY_SECRET isn't set, so nobody who leaves can be linked when they return" }));

const app = buildApp();

// Every api task runs a sender; SKIP LOCKED keeps them off each other's rows. Off locally unless the queues are set.
const queues: Record<string, string | undefined> = {
  jobs: process.env.JOBS_QUEUE_URL,
  scheduled: process.env.SCHEDULED_QUEUE_URL,
};
if (queues.jobs && queues.scheduled) {
  // An outside call needs a timeout (SYSTEM-DESIGN.md): a hung SQS must not hold a database connection for long.
  const sqs = new SQSClient({ maxAttempts: 2, requestHandler: { connectionTimeout: 2_000, requestTimeout: 3_000 } });
  const send = async (queue: string, body: string) => {
    const url = queues[queue];
    if (!url) throw new Error(`Unknown queue ${queue}`);
    await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }));
  };
  // Named errors, because Sentry gets the type and never the text (sentry.ts).
  const alert = (name: string, tags: Record<string, string>) => {
    Sentry.captureException(Object.assign(new Error(name), { name }), { tags });
  };
  let lastLateAlert = 0;
  const log = {
    error: (fields: object, message: string) => app.log.error(fields, message),
    stuck: ({ outboxId, queue }: { outboxId: string; queue: string }) => alert("OutboxRowStuck", { outbox_id: outboxId, queue }),
  };
  const pass = oneAtATime(async () => {
    await sendDue(db(), send, log);
    const age = await oldestDueAgeS(db());
    if (age > 900 && Date.now() - lastLateAlert > 900_000) {
      lastLateAlert = Date.now();
      app.log.error({ ageS: Math.round(age) }, "outbox is behind");
      alert("OutboxBehind", { age_s: String(Math.round(age)) });
    }
  });
  const timer = setInterval(() => {
    pass().catch((error) => {
      app.log.error({ err: { type: (error as Error).name } }, "outbox pass failed");
      Sentry.captureException(error);
    });
  }, 5_000);
  app.addHook("onClose", async () => clearInterval(timer));

  // The other half: every api task also works the scheduled queue (scheduled.ts).
  const consumer = startConsumer(sqsReceiver(queues.scheduled), app.log as never);
  app.addHook("onClose", async () => consumer.stop());
}

// ECS sends SIGTERM before stopping a task: finish what's running, then leave.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void app.close().then(() => db().end()).finally(() => process.exit(0)));
}

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });

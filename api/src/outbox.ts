// Work to start later, written in the same transaction as the change that needs it (008_platform.sql). A sender moves due rows
// to SQS. FOR UPDATE SKIP LOCKED lets any number of api tasks run a sender without taking the same row.
//
// A crash between SQS accepting a message and our commit sends it again, so every consumer must tolerate repeats: messages carry
// outboxId for that. Payloads hold ids only, never family content.
import type { Pool, PoolClient } from "pg";

export type Queue = "jobs" | "scheduled";
export type Send = (queue: string, body: string) => Promise<void>;

export async function enqueue(
  client: Pick<PoolClient, "query">,
  message: { queue: Queue; payload: Record<string, string | number | boolean | null>; requestId?: string; sendAfter?: Date },
): Promise<void> {
  await client.query(
    `insert into outbox (queue, payload, request_id, send_after) values ($1, $2, $3, coalesce($4, now()))`,
    [message.queue, JSON.stringify(message.payload), message.requestId ?? null, message.sendAfter ?? null],
  );
}

const backoffS = (attempts: number) => Math.min(3600, 30 * 2 ** attempts);

/** One pass. Returns how many it sent. A row that fails waits longer each time; it's never dropped. */
export async function sendDue(
  pool: Pool,
  send: Send,
  log?: { error: (fields: object, message: string) => void },
  batch = 20,
): Promise<number> {
  const client = await pool.connect();
  let sent = 0;
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select id, queue, payload, request_id, attempts from outbox
        where sent_at is null and send_after <= now()
        order by send_after, id
        limit $1
        for update skip locked`,
      [batch],
    );
    for (const row of rows) {
      try {
        await send(row.queue, JSON.stringify({ outboxId: String(row.id), requestId: row.request_id, payload: row.payload }));
        await client.query("update outbox set sent_at = now() where id = $1", [row.id]);
        sent += 1;
      } catch (error) {
        log?.error({ outboxId: String(row.id), queue: row.queue, err: { type: (error as Error).name } }, "outbox send failed");
        await client.query(
          `update outbox set attempts = attempts + 1, send_after = now() + make_interval(secs => $2) where id = $1`,
          [row.id, backoffS(row.attempts)],
        );
      }
    }
    await client.query("commit");
    return sent;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

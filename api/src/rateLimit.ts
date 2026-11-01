// Fixed-window limits on the public routes (Convex's lib/rateLimit.ts). A key is a bucket plus an HMAC of the IP or email,
// never the value itself. There's deliberately no default salt: a route that needs this fails loudly without one.
import { createHmac } from "node:crypto";
import { db } from "./db.js";
import { tooMany } from "./errors.js";

export type Limit = { bucket: string; max: number; windowS: number };

export function subjectKey(value: string): string {
  const salt = process.env.RATE_LIMIT_SALT?.trim();
  if (!salt) throw new Error("RATE_LIMIT_SALT isn't set");
  return createHmac("sha256", salt).update(value).digest("hex");
}

/** One hit on each limit. If any is full, nothing is counted, so a refused call doesn't use up the others. */
export async function hit(subject: string, limits: Limit[]): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("begin");
    for (const limit of limits) {
      const { rowCount, rows } = await client.query(
        `with win as (select to_timestamp(floor(extract(epoch from now()) / $3) * $3) as start)
         insert into rate_hits (key, window_start, count)
         select $1, win.start, 1 from win
         on conflict (key, window_start) do update set count = rate_hits.count + 1
           where rate_hits.count < $2
         returning extract(epoch from window_start) as start`,
        [`${limit.bucket}:${subject}`, limit.max, limit.windowS],
      );
      if (!rowCount || !rows[0]) {
        await client.query("rollback");
        throw tooMany(limit.windowS - (Date.now() / 1000) % limit.windowS);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

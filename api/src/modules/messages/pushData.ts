// SQL for push tokens and the push log. A push_log row is the push's machine (Caleb, Nov 8: decision 6; docs/agents/STATE-MACHINES.md row 10):
// state-machine-test: api/test/pushMachine.test.ts
//
//   status    queued -> sending -> sent | failed | none          decided at once instead: none | capped | skipped (never sent)
//                        sending -> queued (Expo couldn't take it: tried again after RETRY_AFTER_S)
//   events    claim (push.deliver)        queued, nobody holding it; or sending whose holder went quiet (LEASE). attempts + 1
//             finish                      sending -> sent | failed | none, fenced by the claim's attempts
//             retry                       sending -> queued, send_at = the next try, a new push.deliver then. Only below MAX_ATTEMPTS
//             drop (dropQueuedCraving)    queued -> none
//             sweep (push.sweep)          sending quiet for 10 min -> queued + a wake-up, or failed at MAX_ATTEMPTS;
//                                         queued 20 min past due with no wake-up owed (its push.deliver went to the dead-letter queue)
//                                         -> a new wake-up, attempts + 1, or failed at MAX_ATTEMPTS
//   guards    every update names the state it leaves; sent, failed, none, capped and skipped are final; a claim never passes MAX_ATTEMPTS
//   invariant a push is never queued an hour past its time, or sending for an hour (platform/invariants.ts push_queued_stale)
//
// The words (title, body) stay while it may still go and come off when it's final.
//
//   A person's phones                  push_tokens_person
//   A token                            push_tokens primary key
//   Every token, a page at a time      push_tokens primary key (the hourly job)
//   Dedupe                             push_log (person_id, dedupe_key) unique
//   Caps, the flood guard              push_log_person_recent
//   Quote rotation                     push_log_person_kind
//   Old pushes                         push_log_prune
import type { Queryable } from "../../db.js";
import { iso } from "./data.js";

export type TokenRow = { token: string; device_id: string | null; tz: string | null; family_id: string; person_id: string };

export const MAX_TOKENS = 5;

export async function tokensOf(q: Queryable, personId: string, limit = 50): Promise<TokenRow[]> {
  const { rows } = await q.query(
    `select token, device_id, tz, family_id, person_id from push_tokens where person_id = $1 order by updated_at desc, token limit $2`,
    [personId, limit],
  );
  return rows;
}

export async function dropTokens(q: Queryable, tokens: string[]): Promise<void> {
  if (tokens.length > 0) await q.query(`delete from push_tokens where token = any($1::text[])`, [tokens]);
}

/** Moves a phone's token to whoever signed in last, then keeps a person's newest 5. */
export async function saveToken(
  q: Queryable,
  t: { token: string; familyId: string; personId: string; deviceId: string | null; platform: string; tz: string | null },
): Promise<void> {
  await q.query(
    `insert into push_tokens (token, family_id, person_id, device_id, platform, tz) values ($1, $2, $3, $4, $5, $6)
     on conflict (token) do update set family_id = excluded.family_id, person_id = excluded.person_id, device_id = excluded.device_id,
       platform = excluded.platform, tz = excluded.tz, updated_at = clock_timestamp()`,
    [t.token, t.familyId, t.personId, t.deviceId, t.platform, t.tz],
  );
  await q.query(
    `delete from push_tokens where token in (
       select token from push_tokens where person_id = $1 order by updated_at desc, token offset $2 limit 50)`,
    [t.personId, MAX_TOKENS],
  );
}

export async function dropTokenInFamily(q: Queryable, token: string, familyId: string): Promise<void> {
  await q.query(`delete from push_tokens where token = $1 and family_id = $2`, [token, familyId]);
}

export async function dropTokensOf(q: Queryable, personId: string): Promise<void> {
  await q.query(`delete from push_tokens where person_id = $1`, [personId]);
}

export async function tokenPage(q: Queryable, after: string, limit: number): Promise<{ token: string; person_id: string; device_id: string | null }[]> {
  const { rows } = await q.query(`select token, person_id, device_id from push_tokens where token > $1 order by token limit $2`, [after, limit]);
  return rows;
}

export type LogRow = {
  id: string;
  person_id: string;
  kind: string;
  app_initiated: boolean;
  dedupe_key: string | null;
  quote_key: string | null;
  status: string;
  skipped_reason: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  tickets: { id: string; token: string }[] | null;
  error: string | null;
  send_at: string;
  created_at: string;
};

const LOG = `id, person_id, kind, app_initiated, dedupe_key, quote_key, status, skipped_reason, title, body, url, tickets, error,
  ${iso("send_at")} as send_at, ${iso("created_at")} as created_at`;

export async function hasKey(q: Queryable, personId: string, key: string): Promise<boolean> {
  const { rowCount } = await q.query(`select 1 from push_log where person_id = $1 and dedupe_key = $2`, [personId, key]);
  return (rowCount ?? 0) > 0;
}

/** Null when the dedupe key was already used. */
export async function insertLog(
  q: Queryable,
  row: {
    personId: string;
    kind: string;
    appInitiated: boolean;
    dedupeKey: string | null;
    quoteKey: string | null;
    status: string;
    skippedReason: string | null;
    title: string | null;
    body: string | null;
    url: string | null;
    sendAt: Date;
    createdAt: Date;
  },
): Promise<string | null> {
  const { rows } = await q.query(
    `insert into push_log (person_id, kind, app_initiated, dedupe_key, quote_key, status, skipped_reason, title, body, url, send_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (person_id, dedupe_key) do nothing returning id`,
    [
      row.personId,
      row.kind,
      row.appInitiated,
      row.dedupeKey,
      row.quoteKey,
      row.status,
      row.skippedReason,
      row.title,
      row.body,
      row.url,
      row.sendAt,
      row.createdAt,
    ],
  );
  return rows[0]?.id ?? null;
}

/** What the caps read: pushes homecookd sent on its own in the last 40 days, which covers a local calendar month with room for DST. */
/** A craving's key. It's how a queued one is found again: its words name a kid, and the row is keyed by who it's to. */
export const cravingKey = (askId: string) => `craving:${askId}`;

/** A queued craving that won't go now, words and all. Its outbox row finds nothing left to claim. */
export async function dropQueuedCraving(q: Queryable, cookId: string, askId: string): Promise<void> {
  await q.query(`update push_log set status = 'none', title = null, body = null where person_id = $1 and dedupe_key = $2 and status = 'queued'`, [cookId, cravingKey(askId)]);
}

export async function recentAppInitiated(q: Queryable, personId: string, now: Date): Promise<{ sent_at: string; app_initiated: boolean }[]> {
  const { rows } = await q.query(
    `select ${iso("created_at")} as sent_at, app_initiated from push_log
      where person_id = $1 and app_initiated and status not in ('skipped', 'none', 'capped') and created_at > $2::timestamptz - interval '40 days'
      order by push_log.created_at desc limit 50`,
    [personId, now],
  );
  return rows;
}

/** What Convex's flood guard reads: its own kinds only, or a busy chat would stop a craving. */
export async function recentConvexKinds(q: Queryable, personId: string, kinds: string[], now: Date, limit: number): Promise<{ kind: string }[]> {
  const { rows } = await q.query(
    `select kind from push_log
      where person_id = $1 and kind = any($2::text[]) and status not in ('capped', 'none') and created_at > $3::timestamptz - interval '24 hours'
      limit $4`,
    [personId, kinds, now, limit],
  );
  return rows;
}

export async function usedQuoteKeys(q: Queryable, personId: string, now: Date, days: number): Promise<string[]> {
  const { rows } = await q.query(
    `select quote_key from push_log
      where person_id = $1 and kind = 'table_nudge' and status not in ('skipped', 'none', 'capped') and quote_key is not null
        and created_at > $2::timestamptz - make_interval(days => $3)
      limit 200`,
    [personId, now, days],
  );
  return rows.map((row) => row.quote_key);
}

/** Who already has this month's recap row. */
export async function peopleWithKey(q: Queryable, ids: string[], key: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await q.query(`select person_id from push_log where person_id = any($1::text[]) and dedupe_key = $2`, [ids, key]);
  return new Set(rows.map((row) => row.person_id));
}

/** Wake-ups a push may use: claims, and wake-ups sent again by the sweep. */
export const MAX_ATTEMPTS = 5;
/** The wait before try 2, 3, 4 and 5: Expo down for an hour and a half still lets the push go. */
export const RETRY_AFTER_S = [60, 300, 900, 3600];
/** A holder that went quiet is taken over after this, under SQS's visibility timeout (300 s). One send takes at most ~11 s. */
const LEASE = "4 minutes";

export type Claimed = LogRow & { attempts: number };

/**
 * queued (nobody holding it) or sending (its holder quiet past the lease) -> sending. One holder sends. A queued row with delivering_at set is an older
 * api's claim (before 083_push_retries.sql) and is held the same way. send_at isn't checked: the outbox holds each wake-up until its time, and the
 * database's clock never strands a push the api's clock queued.
 */
export async function claimDelivery(q: Queryable, id: string): Promise<Claimed | null> {
  const { rows } = await q.query(
    `update push_log set status = 'sending', delivering_at = now(), attempts = attempts + 1
      where id = $1 and attempts < $2
        and (delivering_at is null or delivering_at < now() - interval '${LEASE}')
        and status in ('queued', 'sending')
      returning ${LOG}, attempts`,
    [id, MAX_ATTEMPTS],
  );
  return rows[0] ?? null;
}

/**
 * sending -> sent | failed | none, only for the claim that's still holding it (its attempts). The words come off: a recipient's log can quote someone
 * who later deletes their account, and the purge can't find that row by them.
 */
export async function finishDelivery(
  q: Queryable,
  id: string,
  attempts: number,
  status: "sent" | "failed" | "none",
  tickets: { id: string; token: string }[],
  error: string | null,
): Promise<boolean> {
  const { rowCount } = await q.query(
    `update push_log set status = $3, tickets = coalesce($4::jsonb, tickets), error = $5, title = null, body = null, delivering_at = null
      where id = $1 and status = 'sending' and attempts = $2`,
    [id, attempts, status, tickets.length ? JSON.stringify(tickets) : null, error],
  );
  return rowCount === 1;
}

/** sending -> queued, due again in `afterS`. Returns when, for its push.deliver; null when this claim no longer holds it. */
export async function retryDelivery(q: Queryable, id: string, attempts: number, error: string | null, afterS: number): Promise<Date | null> {
  const { rows } = await q.query(
    `update push_log set status = 'queued', delivering_at = null, error = $3, send_at = now() + make_interval(secs => $4)
      where id = $1 and status = 'sending' and attempts = $2
      returning send_at`,
    [id, attempts, error, afterS],
  );
  return rows[0]?.send_at ?? null;
}

const GIVE_UP = (cond: string, row: string) => `
    status = case when ${cond} then 'failed' else 'queued' end,
    error = case when ${cond} then 'gave up' else ${row}.error end,
    title = case when ${cond} then null else ${row}.title end,
    body = case when ${cond} then null else ${row}.body end,
    delivering_at = null`;

/**
 * push.sweep, a batch at a time. A send whose holder went quiet for 10 minutes goes back to queued; a queued push 20 minutes past due with no
 * wake-up owed (none unsent in the outbox, none sent in the last 20 minutes, which covers SQS's 3 tries) spends a wake-up. Either is failed at
 * MAX_ATTEMPTS. Returns the ids to wake now, and how many it gave up on.
 */
export async function sweepDeliveries(q: Queryable, limit: number): Promise<{ wake: string[]; gaveUp: number }> {
  const lapsed = await q.query(
    `update push_log p set ${GIVE_UP("p.attempts >= $1", "p")}, send_at = case when p.attempts >= $1 then p.send_at else now() end
      where p.id in (select id from push_log where status = 'sending' and delivering_at < now() - interval '10 minutes'
                      order by delivering_at limit $2 for update skip locked)
        and p.status = 'sending'
      returning p.id, p.status`,
    [MAX_ATTEMPTS, limit],
  );
  const stranded = await q.query(
    `update push_log p set ${GIVE_UP("p.attempts + 1 >= $1", "p")}, attempts = p.attempts + 1
      where p.id in (select l.id from push_log l
                      where l.status = 'queued' and l.send_at < now() - interval '20 minutes'
                        and (l.delivering_at is null or l.delivering_at < now() - interval '${LEASE}')
                        and not exists (select 1 from outbox o
                                         where o.queue = 'scheduled' and o.payload->>'task' = 'push.deliver' and o.payload->>'logId' = l.id
                                           and (o.sent_at is null or o.sent_at > now() - interval '20 minutes'))
                      order by l.send_at limit $2 for update skip locked)
        and p.status = 'queued'
      returning p.id, p.status`,
    [MAX_ATTEMPTS, limit],
  );
  const rows = [...lapsed.rows, ...stranded.rows] as { id: string; status: string }[];
  return { wake: rows.filter((r) => r.status === "queued").map((r) => r.id), gaveUp: rows.filter((r) => r.status === "failed").length };
}

export async function ticketsOf(q: Queryable, id: string): Promise<{ id: string; token: string }[]> {
  const { rows } = await q.query(`select tickets from push_log where id = $1`, [id]);
  return rows[0]?.tickets ?? [];
}

export async function clearTickets(q: Queryable, id: string): Promise<void> {
  await q.query(`update push_log set tickets = null where id = $1`, [id]);
}

export async function dropLogOf(q: Queryable, personId: string, limit: number): Promise<number> {
  const { rowCount } = await q.query(
    `delete from push_log where id in (select id from push_log where person_id = $1 order by created_at desc limit $2)`,
    [personId, limit],
  );
  return rowCount ?? 0;
}

export async function pruneLog(q: Queryable, days: number, limit: number): Promise<number> {
  const { rowCount } = await q.query(
    `delete from push_log where id in (select id from push_log where created_at < now() - make_interval(days => $1) limit $2)`,
    [days, limit],
  );
  return rowCount ?? 0;
}

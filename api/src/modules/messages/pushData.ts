// SQL for push tokens and the push log.
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

/** One holder sends: the claim is a conditional update. A holder that died stops counting after 4 minutes (050_messages.sql). */
export async function claimDelivery(q: Queryable, id: string): Promise<LogRow | null> {
  const { rows } = await q.query(
    `update push_log set delivering_at = now()
      where id = $1 and status = 'queued' and (delivering_at is null or delivering_at < now() - interval '4 minutes')
      returning ${LOG}`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * What came of a send. The words come off: a recipient's log can quote someone who later deletes their account, and the purge can't find that row by them.
 */
export async function finishDelivery(q: Queryable, id: string, status: string, tickets: { id: string; token: string }[], error: string | null): Promise<void> {
  await q.query(
    `update push_log set status = $2, tickets = coalesce($3::jsonb, tickets), error = $4, title = null, body = null, delivering_at = null where id = $1`,
    [id, status, tickets.length ? JSON.stringify(tickets) : null, error],
  );
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

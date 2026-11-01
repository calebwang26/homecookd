// The signed-in side of cravings' SQL (the card-making side is data.ts's). Every query, and the index behind it:
//
//   Query                                  Index                          Limit
//   her newest link                        craving_links_person_newest    one row
//   the cards asked of her                 dish_asks_requested_recent     the caller's page
//   those cards' answers                   dish_answers (ask_id, question_id)   6 a card
//   a file by key                          files primary key              one row
import type { Queryable } from "../../db.js";
import type { After } from "../../paging.js";
import type { AnswerRow, CardRow } from "./data.js";

export type LinkRow = { id: string; token: string; message: string; uses: number; revoked_at: Date | null };

export async function newestLink(q: Queryable, personId: string): Promise<LinkRow | null> {
  const { rows } = await q.query(`select id, token, message, uses, revoked_at from craving_links where person_id = $1 order by created_at desc limit 1`, [personId]);
  return rows[0] ?? null;
}

export async function insertLink(q: Queryable, l: { familyId: string; personId: string; token: string; message: string }): Promise<void> {
  await q.query(`insert into craving_links (family_id, person_id, token, message) values ($1, $2, $3, $4)`, [l.familyId, l.personId, l.token, l.message]);
}

export async function setLinkMessage(q: Queryable, id: string, message: string): Promise<void> {
  await q.query(`update craving_links set message = $2 where id = $1`, [id, message]);
}

export async function revokeLink(q: Queryable, id: string): Promise<void> {
  await q.query(`update craving_links set revoked_at = now() where id = $1 and revoked_at is null`, [id]);
}

/** One person makes one link at a time: Convex's serialized mutation gave us this. Held until the transaction ends. */
export async function lockLinksOf(q: Queryable, personId: string): Promise<void> {
  await q.query(`select pg_advisory_xact_lock(hashtextextended('craving-links:' || $1, 0))`, [personId]);
}

/** The columns a card needs, as data.ts reads them. */
const CARD = `id, kid_token_hash, ask_token_hash, dish, relation, kid_name, photo_keys::text[] as photo_keys, dish_voice_note_key,
  kid_voice_note_key, kid_voice_s, guess, version, asked, message, mom_page_lang, status, merge_tries, merge_started_at, merged_at,
  asked_at, asked_via, opened_at, finished_at, questions_at, gen_ms, created_at, ip_key, person_id, requested_of, kid_claimed_at,
  cook_claimed_at, filming_day, voice_recipe_q, family_id, created_at::text as cursor_at`;

export type AskedRow = CardRow & { family_id: string | null; cursor_at: string };

export async function askedOf(q: Queryable, personId: string, before: After | null, limit: number): Promise<AskedRow[]> {
  const { rows } = await q.query(
    `select ${CARD} from dish_asks
      where requested_of = $1 ${before ? "and (created_at, id) < ($3::timestamptz, $4)" : ""}
      order by created_at desc, id desc limit $2`,
    before ? [personId, limit, before.at, before.id] : [personId, limit],
  );
  return rows;
}

export async function askById(q: Queryable, id: string, lock = false): Promise<AskedRow | null> {
  const { rows } = await q.query(`select ${CARD} from dish_asks where id = $1${lock ? " for update" : ""}`, [id]);
  return rows[0] ?? null;
}

export async function answersOfCards(q: Queryable, askIds: string[]): Promise<Map<string, AnswerRow[]>> {
  const out = new Map<string, AnswerRow[]>();
  if (askIds.length === 0) return out;
  const { rows } = await q.query(`select * from dish_answers where ask_id = any($1::text[])`, [askIds]);
  for (const row of rows) out.set(row.ask_id, [...(out.get(row.ask_id) ?? []), row]);
  return out;
}

/**
 * A clip's row, tied from the start to her and this card. The capability is one nobody is given: it's what makes a file the hourly sweep's to delete, as an orphan or
 * once it's marked (data.ts, SWEEPABLE).
 */
export async function insertClip(q: Queryable, f: { key: string; contentType: string; size: number; capabilityHash: string; familyId: string; personId: string; askId: string }): Promise<void> {
  await q.query(
    `insert into files (key, bucket, kind, content_type, size_bytes, capability_hash, family_id, owner_person_id, ask_id)
     values ($1, 'private', 'voice', $2, $3, $4, $5, $6, $7)`,
    [f.key, f.contentType, f.size, f.capabilityHash, f.familyId, f.personId, f.askId],
  );
}

export async function clipByKey(q: Queryable, key: string): Promise<{ capability_hash: string | null; owner_person_id: string | null; ask_id: string | null; uploaded_at: Date | null } | null> {
  const { rows } = await q.query(`select capability_hash, owner_person_id, ask_id, uploaded_at from files where key = $1`, [key]);
  return rows[0] ?? null;
}

/**
 * Takes her fresh clip for this card. The WHERE is the whole check: her own upload, for this card, confirmed, not being deleted and held by nothing, so another's file, a
 * file on another card or a file already used can't land here, and two requests racing can't both win.
 */
export async function attachOwnClip(q: Queryable, key: string, personId: string, askId: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `update files set attached_at = now()
      where key = $1 and owner_person_id = $2 and ask_id = $3 and attached_at is null
        and uploaded_at is not null and delete_requested_at is null and deleted_at is null`,
    [key, personId, askId],
  );
  return Boolean(rowCount);
}

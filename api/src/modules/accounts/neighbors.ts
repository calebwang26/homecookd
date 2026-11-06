// What this area needs from areas that haven't moved yet. Modules call each other's services, never each other's tables (SYSTEM-DESIGN.md), so each of these
// is SQL that belongs to another module and moves to it when that module merges: messages (circle notes, read marks, "has acted"), shares (a share link's family),
// and recipes and jobs (re-homing a solo family's after a move). Nothing else in accounts/ reads those tables, apart from purgeSteps.ts, which lists its own.
import { db, type Queryable } from "../../db.js";
import { shareTokenHash } from "../../sealed.js";
import { ownsPeople } from "./values.js";

/** The family's one circle thread, made on first use. */
export async function circleOf(q: Queryable, familyId: string): Promise<string> {
  await q.query(`insert into threads (family_id, kind) values ($1, 'circle') on conflict (family_id) where kind = 'circle' do nothing`, [familyId]);
  const { rows } = await q.query(`select id from threads where family_id = $1 and kind = 'circle'`, [familyId]);
  return rows[0].id;
}

/** A new person starts with the circle read up to now, so its history isn't "new" for them. */
export async function markCircleRead(q: Queryable, familyId: string, personId: string): Promise<void> {
  const thread = await circleOf(q, familyId);
  await q.query(
    `insert into thread_reads (thread_id, person_id) values ($1, $2) on conflict (thread_id, person_id) do update set last_read_at = now()`,
    [thread, personId],
  );
}

/** "Asha joined". A note must never cost the caller their phone's key, so it runs after the join has committed and a failure is only logged. */
export async function quietNote(familyId: string, personId: string, body: string, log?: (fields: object, message: string) => void): Promise<void> {
  try {
    const thread = await circleOf(db(), familyId);
    await db().query(`insert into messages (family_id, thread_id, sender_id, kind, body) values ($1, $2, $3, 'system', $4)`, [familyId, thread, personId, body]);
    await db().query(`update threads set last_message_at = now() where id = $1`, [thread]);
  } catch (error) {
    log?.({ err: { type: (error as Error).name } }, "a circle note failed");
  }
}

/** Of these people, the ones already at home in the family: they sent a message (not a system note) or an invite. */
export async function actedIds(q: Queryable, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await q.query(
    `select p.id from unnest($1::text[]) as p(id)
      where exists (select 1 from messages m where m.sender_id = p.id and m.kind <> 'system')
         or exists (select 1 from invites i where i.inviter_id = p.id)`,
    [ids],
  );
  return new Set(rows.map((r) => r.id));
}

export type Share = { id: string; family_id: string; sender_id: string | null };

/** Looked up by its keyed hash: the token itself isn't stored. */
export async function shareByToken(q: Queryable, token: string): Promise<Share | null> {
  const { rows } = await q.query(`select id, family_id, sender_id from shares where token_hash = $1`, [shareTokenHash(token)]);
  return rows[0] ?? null;
}

/** Rows re-homed per table in one call; a family that started days ago has far fewer. */
const MOVE_MAX = 200;

/**
 * A solo family's recipes after its cook moved (convex/links.ts `moved`): the recipes, the questions on them, their jobs and recordings get the new family, and
 * `newCook` when one is given. Running it again finds nothing left, since each row is matched by its old family. Returns how many recipes moved.
 */
export async function rehomeCookWork(q: Queryable, cook: string, newCook: string, from: string, to: string): Promise<number> {
  const recipes = await q.query(
    `update recipes set family_id = $3, cook_id = $4
      where id in (select id from recipes where cook_id = $1 and family_id = $2 limit ${MOVE_MAX}) returning id`,
    [cook, from, to, newCook],
  );
  const ids = recipes.rows.map((r) => r.id);
  if (ids.length) await q.query(`update questions set family_id = $2 where recipe_id = any($1::text[])`, [ids, to]);
  for (const table of ["jobs", "recordings"]) {
    await q.query(
      `update ${table} set family_id = $3, cook_id = $4
        where id in (select id from ${table} where cook_id = $1 and family_id = $2 limit ${MOVE_MAX})`,
      [cook, from, to, newCook],
    );
  }
  return ids.length;
}

/** Her Moss index needs a sync (convex/worker.ts requestMossSync). Moss hasn't moved: nothing reads this flag yet, which ACCOUNTS-MIGRATION.md says plainly. */
export async function requestMossSync(q: Queryable, familyId: string): Promise<void> {
  if (!ownsPeople()) return; // Convex tells Moss itself until this area moves
  await q.query(`update families set moss_sync_again = true where id = $1 and moss_sync_again = false`, [familyId]);
}

// Reads of `people` for other modules. READ-ONLY: the one-way sync owns these rows until their area moves (SCHEMA.md, M1). All by primary key, for ids a caller already holds.
import type { Queryable } from "../../db.js";

const MAX_KIDS = 20; // convex/lib/forKids.ts

export type ForKids = { forKidId?: string | null; forKidIds?: string[] | null };

/** The kids a row or a call names, in order, without repeats: `forKidIds`, else the older single `forKidId` (convex/lib/forKids.ts). */
export const forKids = (x: ForKids): string[] => [...new Set(x.forKidIds ?? (x.forKidId ? [x.forKidId] : []))];

/** A cook's name or a kid's, tombstones included: they read "Deleted". */
export async function namesOf(q: Queryable, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query(`select id, name from people where id = any($1::text[])`, [[...new Set(ids)]]);
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** What a recipe.json says about its cook (pipeline/queue_db.py _context): her name, what the family calls her, and the language she cooks in. */
export async function cookOf(q: Queryable, personId: string): Promise<{ name: string; relation: string | null; language: string | null } | null> {
  const { rows } = await q.query(`select name, relation, language from people where id = $1`, [personId]);
  return rows[0] ?? null;
}

export async function languageOf(q: Queryable, personId: string): Promise<string | null> {
  const { rows } = await q.query(`select language from people where id = $1`, [personId]);
  return rows[0]?.language ?? null;
}

/** Is every id a live kid in this family? */
export async function areFamilyKids(q: Queryable, familyId: string, ids: string[]): Promise<boolean> {
  if (ids.length > MAX_KIDS) return false;
  if (ids.length === 0) return true;
  const { rows } = await q.query(`select id from people where id = any($1::text[]) and family_id = $2 and role = 'kid' and deleted_at is null and removed_at is null`, [ids, familyId]);
  return rows.length === ids.length;
}

/** The purge's first check, and the family it needs for what it writes down. Null for someone who hasn't deleted. */
export async function deletedPersonFamily(q: Queryable, personId: string): Promise<string | null> {
  const { rows } = await q.query(`select family_id from people where id = $1 and deleted_at is not null`, [personId]);
  return rows[0]?.family_id ?? null;
}

import { db, type Queryable } from "../../db.js";

export async function personWithFamily(personId: string) {
  const { rows } = await db().query(
    `select p.id, p.name, p.role, p.language, f.id as family_id, f.name as family_name
       from people p
       join families f on f.id = p.family_id
      where p.id = $1`,
    [personId],
  );
  return rows[0] ?? null;
}

export async function isLive(q: Queryable, personId: string): Promise<boolean> {
  const { rows } = await q.query("select 1 from people where id = $1 and deleted_at is null", [personId]);
  return rows.length > 0;
}

export type PersonRow = {
  id: string;
  family_id: string;
  name: string;
  language: string | null;
  approx_lat: string | null;
  approx_lng: string | null;
  removed_at: Date | null;
  deleted_at: Date | null;
};

export type FamilyRow = { id: string; name: string; public_name: string | null };

// Both by primary key, for ids a caller's page already holds.
export async function peopleByIds(q: Queryable, ids: string[]): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query(`select id, family_id, name, language, approx_lat, approx_lng, removed_at, deleted_at from people where id = any($1::text[])`, [[...new Set(ids)]]);
  return new Map(rows.map((row) => [row.id, row]));
}

export async function familiesByIds(q: Queryable, ids: string[]): Promise<Map<string, FamilyRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query(`select id, name, public_name from families where id = any($1::text[])`, [[...new Set(ids)]]);
  return new Map(rows.map((row) => [row.id, row]));
}

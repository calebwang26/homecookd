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

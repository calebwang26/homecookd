// Read-only: who's in a family, for other modules. `people`, `families`, `devices`, `sessions` and `signups` belong to the accounts area, which moves last;
// nothing here writes them. Times come back as text with microseconds, because a JS Date would round them.
import type { Queryable } from "../../db.js";

export type Member = {
  id: string;
  family_id: string;
  supabase_id: string | null;
  name: string;
  role: "cook" | "kid";
  relation: string | null;
  avatar_key: string | null;
  tz: string | null;
  memorial: boolean;
  language: string | null;
  removed_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

const iso = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const COLUMNS = `id, family_id, supabase_id, name, role, relation, avatar_key, tz, memorial, language,
  ${iso("removed_at")} as removed_at, ${iso("deleted_at")} as deleted_at, ${iso("created_at")} as created_at`;

/** Everyone ever in the family, removed people and tombstones included: names on old messages. Index: people_family_order. */
export async function everyoneIn(q: Queryable, familyId: string): Promise<Member[]> {
  const { rows } = await q.query(`select ${COLUMNS} from people where family_id = $1 order by sort, created_at limit 500`, [familyId]);
  return rows;
}

export async function membersByIds(q: Queryable, ids: string[]): Promise<Member[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query(`select ${COLUMNS} from people where id = any($1::text[])`, [ids]);
  return rows;
}

export async function memberById(q: Queryable, id: string): Promise<Member | null> {
  return (await membersByIds(q, [id]))[0] ?? null;
}

export async function familyNameOf(q: Queryable, familyId: string): Promise<string | null> {
  const { rows } = await q.query(`select name from families where id = $1`, [familyId]);
  return rows[0]?.name ?? null;
}

/** How many people joined a family through one share link. Index: signups_share_token. */
export async function joinsViaShare(q: Queryable, token: string, familyId: string): Promise<number> {
  const { rows } = await q.query(`select count(*)::int as n from signups where share_token = $1 and family_id = $2`, [token, familyId]);
  return rows[0].n;
}

/** The phone a session is on, when the session knows it. */
export async function deviceOfSession(q: Queryable, sessionId: string): Promise<string | null> {
  const { rows } = await q.query(`select device_id from sessions where id = $1`, [sessionId]);
  return rows[0]?.device_id ?? null;
}

/** Which of these phones were signed out, or are gone. */
export async function signedOutDevices(q: Queryable, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await q.query(`select id from devices where id = any($1::text[]) and revoked_at is null`, [ids]);
  const live = new Set(rows.map((row) => row.id as string));
  return new Set(ids.filter((id) => !live.has(id)));
}

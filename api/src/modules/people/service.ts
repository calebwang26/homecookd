import type { Signed } from "../../auth.js";
import type { Queryable } from "../../db.js";
import { notFound } from "../../errors.js";
import { isLive, personWithFamily } from "./data.js";

export async function me(signed: Signed) {
  const row = await personWithFamily(signed.personId);
  if (!row) throw notFound();
  return {
    person: { id: row.id, name: row.name, role: row.role, language: row.language },
    family: { id: row.family_id, name: row.family_name },
  };
}

/** Has this person not deleted their account? Other modules ask here rather than read `people`. */
export const personIsLive = (q: Queryable, personId: string) => isLive(q, personId);

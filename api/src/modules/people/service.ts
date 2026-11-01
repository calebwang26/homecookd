import type { Signed } from "../../auth.js";
import { notFound } from "../../errors.js";
import { personWithFamily } from "./data.js";

export async function me(signed: Signed) {
  const row = await personWithFamily(signed.personId);
  if (!row) throw notFound();
  return {
    person: { id: row.id, name: row.name, role: row.role, language: row.language },
    family: { id: row.family_id, name: row.family_name },
  };
}

// Who's asking, for every route in this area.
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { removedFromFamily } from "../../errors.js";
import { everyoneIn, type Member } from "../people/family.js";

export type Actor = { familyId: string; me: Member; everyone: Member[]; here: Member[] };
export type Write = { key: string | null; requestId?: string };

/** A deleted person's session is already refused (auth.ts); someone who left the family can't act either. */
export async function actorOf(signed: Signed): Promise<Actor> {
  const everyone = await everyoneIn(db(), signed.familyId);
  const me = everyone.find((p) => p.id === signed.personId);
  if (!me || me.removed_at || me.deleted_at) throw removedFromFamily();
  return { familyId: signed.familyId, me, everyone, here: everyone.filter((p) => !p.removed_at && !p.deleted_at) };
}

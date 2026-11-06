// Who may see a thread: anyone in the family for the circle, only its two people for a pair.
import type { Queryable } from "../../db.js";
import { notFound } from "../../errors.js";
import type { Actor } from "./actor.js";
import * as data from "./data.js";
import type { ThreadRow } from "./data.js";
import { isRowId } from "./values.js";

const inThread = (t: ThreadRow, personId: string) => t.kind === "circle" || t.a_person_id === personId || t.b_person_id === personId;

/** Another family's thread, or someone else's pair, reads as no thread at all. */
export async function threadFor(q: Queryable, actor: Actor, id: string): Promise<ThreadRow> {
  if (!isRowId(id)) throw notFound();
  const t = await data.threadInFamily(q, id, actor.familyId);
  if (!t || !inThread(t, actor.me.id)) throw notFound();
  return t;
}

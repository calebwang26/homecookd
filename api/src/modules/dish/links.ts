// What other modules need from a card: claim on install (convex/links.ts; docs/build/V2-LINKING.md section 2), and whether a job's card is its cook's (jobs/service.ts).
// They ask here rather than read this module's tables.
import type { Queryable } from "../../db.js";
import { personIsLive } from "../people/service.js";
import * as data from "./data.js";
import type { CardRow } from "./data.js";

export type Side = "kid" | "cook";

/** The card behind a token's hash: the kid's own token, else the ask token sent to Mom. */
export async function cardOfToken(q: Queryable, tokenHash: string, lock = false): Promise<{ card: CardRow; side: Side } | null> {
  const kid = await data.cardByKidHash(q, tokenHash, lock);
  if (kid) return { card: kid, side: "kid" };
  const cook = await data.cardByAskHash(q, tokenHash, lock);
  return cook ? { card: cook, side: "cook" } : null;
}

/** The ask sent (or the card made, for one that starts asked) or Mom's answer, whichever is later. */
export const lastActivityMs = (card: CardRow) => Math.max((card.asked_at ?? card.created_at).getTime(), card.finished_at?.getTime() ?? 0);

export const holderOf = (card: CardRow, side: Side) => (side === "kid" ? card.person_id : card.requested_of);
export const otherSideOf = (card: CardRow, side: Side) => (side === "kid" ? card.requested_of : card.person_id);
export const claimedOnce = (card: CardRow, side: Side) => (side === "kid" ? card.kid_claimed_at : card.cook_claimed_at) !== null;

export const liveHolder = async (q: Queryable, id: string | null) => (id && (await personIsLive(q, id)) ? id : null);

/** Whether this card is asked of her, in her family: a request from her craving link, or a card whose cook side she claimed. Index: the primary key. */
export async function isRequestOf(q: Queryable, askId: string, personId: string, familyId: string): Promise<boolean> {
  const { rowCount } = await q.query(`select 1 from dish_asks where id = $1 and requested_of = $2 and family_id = $3`, [askId, personId, familyId]);
  return !!rowCount;
}

/** The language Mom answered in, so the app can pre-pick her cook language. */
export async function answerLanguage(q: Queryable, askId: string): Promise<string | null> {
  return (await data.answersOf(q, askId))[0]?.language ?? null;
}

/** Puts the card in someone's app. The first claim of a side is stamped for good, which is what makes it one join per side. The card's files become the family's. */
export async function claimCardSide(c: Queryable, card: CardRow, side: Side, personId: string, familyId: string): Promise<void> {
  const now = new Date();
  await data.patchCard(c, card.id, {
    ...(side === "kid" ? { person_id: personId, kid_claimed_at: card.kid_claimed_at ?? now } : { requested_of: personId, cook_claimed_at: card.cook_claimed_at ?? now }),
    family_id: familyId,
  });
  await c.query(`update files set family_id = $2 where ask_id = $1 and family_id is null`, [card.id, familyId]);
}

const MOVE_MAX = 200;

/** After a move: the cards she answered as Mom and any she made as the kid become the new person's, and those in the old family come along. Running it again finds nothing. */
export async function rehomeCards(c: Queryable, oldPerson: string, newPerson: string, from: string, to: string): Promise<void> {
  for (const col of ["requested_of", "person_id"]) {
    await c.query(
      `update dish_asks set ${col} = $2, family_id = case when family_id = $3 then $4 else family_id end
        where id in (select id from dish_asks where ${col} = $1 limit ${MOVE_MAX})`,
      [oldPerson, newPerson, from, to],
    );
  }
}

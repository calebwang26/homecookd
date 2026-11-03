// v2's pushes about a dish card (Convex's pushEvents.ts and links.claim; docs/build/V2-LINKING.md §1.4). Each finds who it's for, says it in their language
// (pushWords.ts) and goes through queuePush, so no caller builds a title. A web-only kid has no person, so nothing is sent to them; they see Mom's answer when they
// reopen their link. Who queues each:
//   answered   dish/merge.ts: her version lands, or her clips go to the kid without one (push.dish_answered)
//   craving    a kid making a card from her craving link (push.dish_requested): that card-making isn't on the api yet (dish/routes.ts), so nothing queues it
//   filmed     messages/published.ts: a recipe she filmed for the card is ready (push.dish_filmed)
//   joined     accounts/links.ts claimCard, in the claim's own transaction
import { db, tx, type Queryable } from "../../db.js";
import { cardForPush } from "../dish/service.js";
import { memberById } from "../people/family.js";
import { recipesByIds } from "../recipes/read.js";
import { queuePush } from "./push.js";
import { cravingKey } from "./pushData.js";
import { pushWords, relationLabel } from "./pushWords.js";

const dishOf = (card: { dish: string | null; guess: { dish?: string } | null }) => card.dish || card.guess?.dish || "";

/** Mom's version landed, or her clips went to the kid without one. */
export async function pushAnswered(askId: string): Promise<void> {
  const card = await cardForPush(askId);
  if (!card?.person_id) return;
  const language = (await memberById(db(), card.person_id))?.language ?? undefined;
  const { title, body } = pushWords("answered", language, { relation: relationLabel(card.relation ?? undefined), dish: dishOf(card) });
  const stamp = card.merged_at ?? card.finished_at ?? 0;
  await tx((c) => queuePush(c, { personId: card.person_id!, kind: "answered", title, body, url: `/dish/${askId}`, dedupeKey: `answered:${askId}:${new Date(stamp).getTime()}` }));
}

/** A kid named a dish from the parent's craving link. */
export async function pushRequested(askId: string): Promise<void> {
  const card = await cardForPush(askId);
  if (!card?.requested_of) return;
  const language = (await memberById(db(), card.requested_of))?.language ?? undefined;
  const { title, body } = pushWords("craving", language, { kid: card.kid_name ?? undefined, dish: dishOf(card) });
  await tx((c) => queuePush(c, { personId: card.requested_of!, kind: "craving", title, body, url: `/request/${askId}`, dedupeKey: cravingKey(askId) }));
}

/**
 * A recipe Mom filmed for this card was published: the video is the upgrade to her voice answer. Only once it's ready, only her recipe, and only to a kid in its family,
 * who can open it: a recipe still processing is its cook's alone.
 */
export async function pushFilmed(askId: string, recipeId: string): Promise<void> {
  const card = await cardForPush(askId);
  if (!card?.person_id) return;
  const [recipe] = await recipesByIds(db(), [recipeId]);
  if (!recipe || recipe.status !== "ready" || recipe.cook_id !== card.requested_of) return;
  const kid = await memberById(db(), card.person_id);
  if (!kid || kid.family_id !== recipe.family_id) return;
  const { title, body } = pushWords("filmed", kid.language ?? undefined, { relation: relationLabel(card.relation ?? undefined), dish: dishOf(card) });
  await tx((c) => queuePush(c, { personId: kid.id, kind: "filmed", title, body, url: `/recipe/${recipeId}`, dedupeKey: `filmed:${recipeId}` }));
}

/**
 * Someone claimed a side of a card: "Caleb is on homecookd" to its Mom, "Mom joined your kitchen" to its kid, whoever holds the other side in the claimer's family.
 * Called in the claim's transaction, so the push and the claim land together. Once per card and side.
 */
export async function queueJoined(
  c: Queryable,
  j: { cardId: string; side: "kid" | "cook"; relation: string; joinerId: string; otherId: string | null; familyId: string },
): Promise<void> {
  if (!j.otherId) return;
  const them = await memberById(c, j.otherId);
  if (!them || them.deleted_at || them.family_id !== j.familyId) return;
  const name = j.side === "kid" ? ((await memberById(c, j.joinerId))?.name ?? "") : relationLabel(j.relation);
  const { title, body } = pushWords("joined", them.language ?? undefined, { name }, j.side === "kid" ? "cook" : "kid");
  await queuePush(c, { personId: them.id, kind: "joined", title, body, url: `/dish/${j.cardId}`, dedupeKey: `joined:${j.cardId}:${j.side}` });
}

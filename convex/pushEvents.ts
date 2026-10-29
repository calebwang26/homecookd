// v2's pushes about a dish card (docs/build/V2-LINKING.md §1.4). The dish ask code schedules these and never
// builds a push itself: each one finds who it's for, says it in their language (lib/pushWords.ts) and goes
// through queuePush (dedupe, limits, quiet hours). A web-only kid has no person, so nothing is sent to them; they
// see Mom's answer when they reopen their link.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { queuePush } from "./push";
import { pushWords, relationLabel } from "./lib/pushWords";

const dishOf = (card: Doc<"dishAsks">) => card.dish || card.guess.dish;

async function languageOf(ctx: MutationCtx, personId: Id<"people">): Promise<string | undefined> {
  return (await ctx.db.get("people", personId))?.language;
}

/** Mom's version landed (her web answers or "tell him now"), or her clips went to the kid without one. */
export const answered = internalMutation({
  args: { askId: v.id("dishAsks") },
  returns: v.null(),
  handler: async (ctx, { askId }) => {
    const card = await ctx.db.get("dishAsks", askId);
    if (!card?.personId) return null;
    const relation = relationLabel(card.relation);
    const { title, body } = pushWords("answered", await languageOf(ctx, card.personId), { relation, dish: dishOf(card) });
    await queuePush(ctx, {
      personId: card.personId,
      kind: "answered",
      title,
      body,
      url: `/dish/${askId}`,
      dedupeKey: `answered:${askId}:${card.mergedAt ?? card.finishedAt ?? 0}`,
    });
    return null;
  },
});

/** A kid named a dish from the parent's craving link (Phase 5): "Caleb wants your braised pork". */
export const requested = internalMutation({
  args: { askId: v.id("dishAsks") },
  returns: v.null(),
  handler: async (ctx, { askId }) => {
    const card = await ctx.db.get("dishAsks", askId);
    if (!card?.requestedOf) return null;
    const { title, body } = pushWords("craving", await languageOf(ctx, card.requestedOf), { kid: card.kidName, dish: dishOf(card) });
    await queuePush(ctx, { personId: card.requestedOf, kind: "craving", title, body, url: `/request/${askId}`, dedupeKey: `craving:${askId}` });
    return null;
  },
});

/** A recipe Mom filmed for this card was published: the video is the upgrade to her voice answer. */
export const filmed = internalMutation({
  args: { askId: v.id("dishAsks"), recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, { askId, recipeId }) => {
    const card = await ctx.db.get("dishAsks", askId);
    if (!card?.personId) return null;
    const relation = relationLabel(card.relation);
    const { title, body } = pushWords("filmed", await languageOf(ctx, card.personId), { relation, dish: dishOf(card) });
    await queuePush(ctx, { personId: card.personId, kind: "filmed", title, body, url: `/recipe/${recipeId}`, dedupeKey: `filmed:${recipeId}` });
    return null;
  },
});

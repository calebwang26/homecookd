// Claim on install (docs/build/V2-LINKING.md §2). A dish card's links open the app: the kid's own (/miss?k=)
// and the one they sent Mom (/a?t=). A card that belongs to a family is an invite to it, so someone new who
// opens one joins that family with a join ticket (lib/joinTicket.ts, checked by Supabase's POST /auth/link),
// at most once per side of the card and only within JOIN_WINDOW_DAYS of its last activity. Signed in,
// `claim` puts the card in their app: the kid as `personId`, Mom as `requestedOf`.
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, type QueryCtx } from "./_generated/server";
import { requireSession } from "./lib/auth";
import { sha256Hex } from "./lib/dishAskRoutes";
import { pushWords, relationLabel } from "./lib/pushWords";
import { queuePush } from "./push";

/** TODO(caleb): how long after the ask (or Mom's answer) a card can still bring someone into the family. */
export const JOIN_WINDOW_DAYS = 30;
export const DEAD_LINK = "This link doesn't work anymore.";

export type Side = "kid" | "cook";
const sideV = v.union(v.literal("kid"), v.literal("cook"));

/** The card behind a token's hash: the kid's own token, else the ask token sent to Mom. */
async function cardOf(ctx: QueryCtx, tokenHash: string): Promise<{ card: Doc<"dishAsks">; side: Side } | null> {
  const kid = await ctx.db.query("dishAsks").withIndex("by_kid_token", (q) => q.eq("kidTokenHash", tokenHash)).unique();
  if (kid) return { card: kid, side: "kid" };
  const cook = await ctx.db.query("dishAsks").withIndex("by_ask_token", (q) => q.eq("askTokenHash", tokenHash)).unique();
  return cook ? { card: cook, side: "cook" } : null;
}

/** The ask sent (or the card made, for one that starts asked) or Mom's answer, whichever is later. */
export function lastActivity(card: Doc<"dishAsks">): number {
  return Math.max(card.askedAt ?? card.createdAt, card.finishedAt ?? 0);
}

async function live(ctx: QueryCtx, id: Id<"people"> | undefined): Promise<Doc<"people"> | null> {
  const p = id ? await ctx.db.get("people", id) : null;
  return p && p.deletedAt === undefined ? p : null;
}

/** What /link/open needs; the route signs the ticket. Null for an unknown token. */
export const forOpen = internalQuery({
  args: { tokenHash: v.string(), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      askId: v.id("dishAsks"),
      side: sideV,
      dish: v.string(),
      kidName: v.union(v.string(), v.null()),
      relation: v.string(),
      familyName: v.union(v.string(), v.null()),
      supabaseFamilyId: v.union(v.string(), v.null()),
      taken: v.boolean(),
      joinable: v.union(v.literal("yes"), v.literal("taken"), v.literal("window"), v.literal("no_family")),
      language: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { tokenHash, now }) => {
    const found = await cardOf(ctx, tokenHash);
    if (!found) return null;
    const { card, side } = found;
    const family = card.familyId ? await ctx.db.get("families", card.familyId) : null;
    const claimedOnce = (side === "kid" ? card.kidClaimedAt : card.cookClaimedAt) !== undefined;
    const joinable: "yes" | "taken" | "window" | "no_family" = !family
      ? "no_family"
      : claimedOnce
        ? "taken"
        : now - lastActivity(card) > JOIN_WINDOW_DAYS * 24 * 3600 * 1000
          ? "window"
          : "yes";
    // The language Mom answered in, so the app can pre-pick her cook language.
    const answer = side === "cook" ? await ctx.db.query("dishAnswers").withIndex("by_ask_question", (q) => q.eq("askId", card._id)).first() : null;
    return {
      askId: card._id,
      side,
      dish: card.dish || card.guess.dish,
      kidName: card.kidName ?? null,
      relation: card.relation,
      familyName: family?.name ?? null,
      supabaseFamilyId: family?.supabaseFamilyId ?? null,
      taken: !!(await live(ctx, side === "kid" ? card.personId : card.requestedOf)),
      joinable,
      language: answer?.language ?? null,
    };
  },
});

/**
 * Signed in: the card goes in the caller's app. The kid's token makes them the card's kid, the ask token its Mom,
 * unless someone still here already holds that side. The card joins the caller's family when it has none; a card
 * in another family stays there (no one is moved between families). Claiming again returns the same.
 */
export const claim = mutation({
  args: { sessionToken: v.string(), token: v.string() },
  returns: v.object({ dishAskId: v.id("dishAsks"), side: sideV, sameFamily: v.boolean(), taken: v.boolean() }),
  handler: async (ctx, { sessionToken, token }) => {
    const { person, family } = await requireSession(ctx, sessionToken);
    if (!/^[0-9A-Za-z]{22}$/.test(token)) throw new ConvexError(DEAD_LINK);
    const found = await cardOf(ctx, await sha256Hex(token));
    if (!found) throw new ConvexError(DEAD_LINK);
    const { card, side } = found;
    const field = side === "kid" ? "personId" : "requestedOf";
    const other = side === "kid" ? card.requestedOf : card.personId;
    if (other === person._id) throw new ConvexError("You're already on this card.");

    const holder = await live(ctx, card[field]);
    const familyId = card.familyId ?? family._id;
    const result = { dishAskId: card._id, side, sameFamily: familyId === family._id };
    if (holder && holder._id !== person._id) return { ...result, taken: true };
    if (holder) return { ...result, taken: false };

    const now = Date.now();
    await ctx.db.patch("dishAsks", card._id, {
      [field]: person._id,
      familyId,
      ...(side === "kid" ? { kidClaimedAt: card.kidClaimedAt ?? now } : { cookClaimedAt: card.cookClaimedAt ?? now }),
    });
    if (side === "cook" && !person.relation) await ctx.db.patch("people", person._id, { relation: relationLabel(card.relation) });

    // "Caleb is on homecookd" / "Mom joined your kitchen", to whoever holds the other side in this family.
    const them = await live(ctx, other);
    if (them && them.familyId === family._id) {
      const name = side === "kid" ? person.name : relationLabel(card.relation);
      const { title, body } = pushWords("joined", them.language, { name }, side === "kid" ? "cook" : "kid");
      await queuePush(ctx, { personId: them._id, kind: "joined", title, body, url: `/dish/${card._id}`, dedupeKey: `joined:${card._id}:${side}` });
    }
    return { ...result, taken: false };
  },
});

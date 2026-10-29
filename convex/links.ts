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
import { verifyMoved } from "./lib/joinTicket";
import { queuePush } from "./push";
import { requestMossSync } from "./worker";

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

/** Rows re-homed per table in one call; a family that started days ago has far fewer. */
const MOVE_MAX = 200;

/**
 * After a move between families (docs/build/JOIN-SIMPLE.md §4): the app hands over Supabase's signed receipt,
 * signed in as the new person. When nobody else signs in to the old family (`solo`, a cold parent who started
 * her own and then got her kid's link), her recipes, their jobs and recordings, the questions on them and her
 * dish cards come to the new family, as do the phone-less faces she added; both Moss indexes re-sync. Otherwise
 * everything stays with the old family, as when someone leaves. TODO(caleb): the solo rule (approved Oct 29).
 * Running it again finds nothing left to move.
 */
export const moved = mutation({
  args: { sessionToken: v.string(), receipt: v.string() },
  returns: v.object({ recipes: v.number(), faces: v.number() }),
  handler: async (ctx, { sessionToken, receipt }) => {
    const { person, family } = await requireSession(ctx, sessionToken);
    const secret = process.env.LINK_JOIN_SECRET?.trim();
    const r = secret ? await verifyMoved(secret, receipt, Date.now()) : null;
    if (!r || r.toProfile !== person.supabaseProfileId || r.toFamily !== family.supabaseFamilyId) {
      throw new ConvexError("That move can't be checked. Your recipes stay where they were.");
    }
    const none = { recipes: 0, faces: 0 };
    if (!r.solo) return none;
    const from = await ctx.db
      .query("families")
      .withIndex("by_supabaseFamilyId", (q) => q.eq("supabaseFamilyId", r.fromFamily))
      .unique();
    if (!from || from._id === family._id) return none;
    const inFrom = async (supabaseProfileId: string) =>
      (await ctx.db.query("people").withIndex("by_supabaseProfileId", (q) => q.eq("supabaseProfileId", supabaseProfileId)).take(10)).find(
        (p) => p.familyId === from._id,
      );

    // Her recipes become the new person's; a face's stay theirs, in the new family.
    const cooks: [Id<"people">, Id<"people">][] = [];
    const old = await inFrom(r.fromProfile);
    if (old) cooks.push([old._id, person._id]);
    let faces = 0;
    for (const id of r.faces) {
      const face = await inFrom(id);
      if (!face) continue;
      await ctx.db.patch("people", face._id, { familyId: family._id });
      cooks.push([face._id, face._id]);
      faces++;
    }

    let recipes = 0;
    for (const [was, now] of cooks) {
      for (const rec of await ctx.db.query("recipes").withIndex("by_cookId", (q) => q.eq("cookId", was)).take(MOVE_MAX)) {
        if (rec.familyId !== from._id) continue;
        await ctx.db.patch("recipes", rec._id, { familyId: family._id, cookId: now });
        for (const q of await ctx.db.query("questions").withIndex("by_recipeId", (x) => x.eq("recipeId", rec._id)).take(MOVE_MAX)) {
          await ctx.db.patch("questions", q._id, { familyId: family._id });
        }
        recipes++;
      }
      for (const job of await ctx.db.query("jobs").withIndex("by_cookId", (q) => q.eq("cookId", was)).take(MOVE_MAX)) {
        if (job.familyId === from._id) await ctx.db.patch("jobs", job._id, { familyId: family._id, cookId: now });
      }
      const recs = await ctx.db.query("recordings").withIndex("by_cookId_and_startedAt", (q) => q.eq("cookId", was)).take(MOVE_MAX);
      for (const rec of recs) {
        if (rec.familyId === from._id) await ctx.db.patch("recordings", rec._id, { familyId: family._id, cookId: now });
      }
    }
    // Her dish cards: the cards she answered as Mom, and any she made as the kid.
    if (old) {
      for (const card of await ctx.db.query("dishAsks").withIndex("by_requested_of", (q) => q.eq("requestedOf", old._id)).take(MOVE_MAX)) {
        await ctx.db.patch("dishAsks", card._id, { requestedOf: person._id, ...(card.familyId === from._id ? { familyId: family._id } : {}) });
      }
      for (const card of await ctx.db.query("dishAsks").withIndex("by_person", (q) => q.eq("personId", old._id)).take(MOVE_MAX)) {
        await ctx.db.patch("dishAsks", card._id, { personId: person._id, ...(card.familyId === from._id ? { familyId: family._id } : {}) });
      }
    }
    if (recipes) {
      await requestMossSync(ctx, from._id);
      await requestMossSync(ctx, family._id);
    }
    return { recipes, faces };
  },
});

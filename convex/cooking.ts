// What each kid is cooking right now, so the cook's phone can show "Leo is on step 3". The voice
// service moves it (/voice/session, /voice/step); a session nobody touched for 2 hours ends itself.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireSession } from "./lib/auth";

const IDLE_MS = 2 * 3600 * 1000;

async function activeFor(ctx: MutationCtx, familyId: Id<"families">, kidId: Id<"people">) {
  const rows = await ctx.db
    .query("cookingSessions")
    .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
    .order("desc")
    .take(50);
  return rows.filter((r) => r.kidId === kidId && r.endedAt === undefined);
}

export const current = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      kidId: v.id("people"),
      kidName: v.string(),
      recipeId: v.id("recipes"),
      recipeTitle: v.string(),
      stepOrder: v.number(),
      stepCount: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const rows = await ctx.db
      .query("cookingSessions")
      .withIndex("by_familyId", (q) => q.eq("familyId", signed.family._id))
      .order("desc")
      .take(50);
    const out = [];
    for (const r of rows) {
      if (r.endedAt !== undefined) continue;
      const kid = await ctx.db.get("people", r.kidId);
      const recipe = await ctx.db.get("recipes", r.recipeId);
      if (!kid || !recipe) continue;
      out.push({
        kidId: r.kidId,
        kidName: kid.name,
        recipeId: r.recipeId,
        recipeTitle: recipe.title,
        stepOrder: r.stepOrder,
        stepCount: recipe.steps.length,
        updatedAt: r.updatedAt,
      });
    }
    return out;
  },
});

/** The kid is done (or left the cooking screen). */
export const finish = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    for (const r of await activeFor(ctx, signed.family._id, signed.person._id)) {
      await ctx.db.patch("cookingSessions", r._id, { endedAt: Date.now() });
    }
    return null;
  },
});

/** Upserts the kid's one live session. `stepOrder` undefined keeps the step (or starts at 1). */
export const setStep = internalMutation({
  args: {
    familyId: v.id("families"),
    kidId: v.id("people"),
    recipeId: v.id("recipes"),
    stepOrder: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, { familyId, kidId, recipeId, stepOrder }) => {
    const now = Date.now();
    let keep = null;
    for (const r of await activeFor(ctx, familyId, kidId)) {
      if (!keep && r.recipeId === recipeId) keep = r;
      else await ctx.db.patch("cookingSessions", r._id, { endedAt: now });
    }
    const step = stepOrder ?? keep?.stepOrder ?? 1;
    if (keep) await ctx.db.patch("cookingSessions", keep._id, { stepOrder: step, updatedAt: now });
    else await ctx.db.insert("cookingSessions", { familyId, recipeId, kidId, stepOrder: step, updatedAt: now });
    return step;
  },
});

export const endIdle = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    // Few rows: one per kid cooking at a time across all families.
    const recent = await ctx.db.query("cookingSessions").order("desc").take(500);
    for (const r of recent) {
      if (r.endedAt === undefined && now - r.updatedAt > IDLE_MS) {
        await ctx.db.patch("cookingSessions", r._id, { endedAt: now });
      }
    }
    return null;
  },
});

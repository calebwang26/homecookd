// The demo family for the hackathon: Mom, Dad, Grandma (cooks), Leo and Maya (kids), and four of
// the synthetic recipes. Safe to run twice. Run it before or after a real phone signs in:
//   npx convex run seed:demo '{"supabaseFamilyId": "<the demo family's Supabase id>"}'
// The first sign-in then takes over these people by name (sessions.mirror).
import { v } from "convex/values";
import chili from "../data/synthetic/dad-sunday-chili.json";
import fish from "../data/synthetic/dad-ginger-scallion-fish.json";
import noodles from "../data/synthetic/grandma-hand-pulled-noodle-soup.json";
import pork from "../data/synthetic/grandma-red-braised-pork.json";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { parseRecipeJson } from "./lib/recipeJson";
import { requestMossSync } from "./worker";

const PEOPLE = [
  { name: "Mom", role: "cook" },
  { name: "Dad", role: "cook" },
  { name: "Grandma", role: "cook" },
  { name: "Leo", role: "kid" },
  { name: "Maya", role: "kid" },
] as const;
const RECIPES = [chili, fish, pork, noodles];

export const demo = internalMutation({
  args: { supabaseFamilyId: v.optional(v.string()), familyName: v.optional(v.string()) },
  returns: v.object({ familyId: v.id("families"), recipesAdded: v.number() }),
  handler: async (ctx, args) => {
    const supabaseFamilyId = args.supabaseFamilyId ?? "seed:demo";
    const found = await ctx.db
      .query("families")
      .withIndex("by_supabaseFamilyId", (q) => q.eq("supabaseFamilyId", supabaseFamilyId))
      .unique();
    const familyId =
      found?._id ?? (await ctx.db.insert("families", { name: args.familyName ?? "Our family", supabaseFamilyId }));

    const people = await ctx.db
      .query("people")
      .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
      .take(200);
    const ids = new Map<string, Id<"people">>();
    for (const p of PEOPLE) {
      const match = people.find((e) => e.name === p.name);
      ids.set(
        p.name,
        match?._id ??
          (await ctx.db.insert("people", { familyId, supabaseProfileId: `seed:${p.name.toLowerCase()}`, ...p })),
      );
    }

    const existing = await ctx.db
      .query("recipes")
      .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
      .take(200);
    let recipesAdded = 0;
    for (const raw of RECIPES) {
      const parsed = parseRecipeJson(raw);
      if (typeof parsed === "string") throw new Error(`${raw.id}: ${parsed}`);
      if (existing.some((r) => r.libraryId === parsed.libraryId)) continue;
      const cookId = ids.get(raw.cook.name);
      if (!cookId) continue;
      const recipeId = await ctx.db.insert("recipes", {
        ...parsed,
        familyId,
        cookId,
        status: "ready",
        memoriesOptIn: true, // synthetic stories, shared for the demo
      });
      recipesAdded++;
      if (raw.id === "dad-sunday-chili") {
        await ctx.db.insert("questions", {
          familyId,
          recipeId,
          stepOrder: 3,
          askedBy: ids.get("Leo")!,
          text: "Can I use canned beans instead of dried?",
          status: "asked_cook",
        });
      }
    }
    if (recipesAdded) await requestMossSync(ctx, familyId);
    return { familyId, recipesAdded };
  },
});

/** Points the seeded demo family at its real Supabase family, if a phone hasn't signed in yet:
 *    npx convex run seed:claim '{"supabaseFamilyId": "<id>"}' */
export const claim = internalMutation({
  args: { supabaseFamilyId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { supabaseFamilyId }) => {
    const byId = (id: string) =>
      ctx.db
        .query("families")
        .withIndex("by_supabaseFamilyId", (q) => q.eq("supabaseFamilyId", id))
        .unique();
    const seeded = await byId("seed:demo");
    if (!seeded || (await byId(supabaseFamilyId))) return false;
    await ctx.db.patch("families", seeded._id, { supabaseFamilyId });
    return true;
  },
});

/** Removes a recipe with its jobs and questions (demo cleanup): npx convex run seed:removeRecipe '{"recipeId": "…"}' */
export const removeRecipe = internalMutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, { recipeId }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    if (!recipe) return null;
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .take(500);
    for (const q of questions) await ctx.db.delete("questions", q._id);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_familyId", (q) => q.eq("familyId", recipe.familyId))
      .take(500);
    for (const j of jobs) if (j.recipeId === recipeId) await ctx.db.delete("jobs", j._id);
    await ctx.db.delete("recipes", recipeId);
    return null;
  },
});

/** Sets the language a person speaks (an Ink code), so their voice-note answers are written in it
 * and translated for the kid: npx convex run seed:language '{"personId": "<id>", "language": "mr"}' */
export const language = internalMutation({
  args: { personId: v.id("people"), language: v.string() },
  returns: v.null(),
  handler: async (ctx, { personId, language }) => {
    await ctx.db.patch("people", personId, { language: language === "en" ? undefined : language });
    return null;
  },
});

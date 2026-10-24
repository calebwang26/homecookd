"use node";
// Fills the family's Moss index after a recipe is published (worker.published) or the cook changes
// whether stories are shared (recipes.setMemoriesOptIn). Moss only finds moments; it never answers.
// The SDK is used because Moss's REST API can't create an index (convex.json lists it as external).
import { MossClient } from "@moss-js/moss";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { memoryDocs, mossIndexName, stepDocs } from "./lib/mossDocs";

export const indexRecipe = internalAction({
  args: { recipeId: v.id("recipes"), jobId: v.optional(v.id("jobs")) },
  returns: v.null(),
  handler: async (ctx, { recipeId, jobId }) => {
    const recipe = await ctx.runQuery(internal.worker.indexInput, { recipeId });
    const projectId = process.env.MOSS_PROJECT_ID;
    const projectKey = process.env.MOSS_PROJECT_KEY;
    let indexed = false;
    if (!recipe || !projectId || !projectKey) {
      console.warn(recipe ? "MOSS_PROJECT_ID / MOSS_PROJECT_KEY aren't set" : "recipe is gone");
    } else {
      try {
        const moss = new MossClient(projectId, projectKey);
        const name = mossIndexName(recipe.familyId);
        const memories = memoryDocs(recipe);
        const docs = [...stepDocs(recipe), ...(recipe.memoriesOptIn ? memories : [])];
        const exists = await moss.getIndex(name).then(
          () => true,
          () => false,
        );
        // Two recipes published at once can both see no index; the loser adds to the winner's.
        const created =
          !exists &&
          (await moss.createIndex(name, docs, { modelId: "moss-minilm" }).then(
            () => true,
            () => false,
          ));
        if (!created) {
          await moss.addDocs(name, docs, { upsert: true });
          if (!recipe.memoriesOptIn && memories.length) await moss.deleteDocs(name, memories.map((m) => m.id));
        }
        indexed = true;
      } catch (e) {
        // The recipe still works without search; the kid's questions then go to the cook.
        console.error("Moss indexing failed", e);
      }
    }
    await ctx.runMutation(internal.worker.indexed, { recipeId, jobId, indexed });
    return null;
  },
});

"use node";
// Brings a family's Moss index up to date. Moss only finds moments; it never answers. Moss rebuilds
// the whole index on every write, so only one sync runs per family (worker.requestMossSync), and each
// one sends every ready recipe and removes what shouldn't be there (a cook who took back the stories).
// The SDK is used because Moss's REST API can't create an index (convex.json lists it as external).
import { MossClient } from "@moss-js/moss";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { memoryDocs, mossIndexName, stepDocs } from "./lib/mossDocs";

export const syncFamily = internalAction({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    const recipes = await ctx.runQuery(internal.worker.syncInput, { familyId });
    const projectId = process.env.MOSS_PROJECT_ID;
    const projectKey = process.env.MOSS_PROJECT_KEY;
    let ok = false;
    if (!projectId || !projectKey) {
      console.warn("MOSS_PROJECT_ID / MOSS_PROJECT_KEY aren't set");
    } else {
      try {
        const moss = new MossClient(projectId, projectKey);
        const name = mossIndexName(familyId);
        const docs = recipes.flatMap((r) => [...stepDocs(r), ...(r.memoriesOptIn ? memoryDocs(r) : [])]);
        const existing = await moss.getDocs(name).catch(() => null);
        if (!docs.length) {
          // Nothing left to find (say the only cook deleted her account): drop the index, so none of it stays searchable.
          if (existing) await moss.deleteIndex(name);
        } else if (!existing) {
          await moss.createIndex(name, docs, { modelId: "moss-minilm" });
        } else {
          await moss.addDocs(name, docs, { upsert: true });
          const wanted = new Set(docs.map((d) => d.id));
          const stale = existing.map((d) => d.id).filter((id) => !wanted.has(id));
          if (stale.length) await moss.deleteDocs(name, stale);
        }
        ok = true;
      } catch (e) {
        // The recipes still work without search; the kid's questions then go to the cook.
        console.error("Moss sync failed", e);
      }
    }
    await ctx.runMutation(internal.worker.synced, { familyId, recipeIds: recipes.map((r) => r._id), ok });
    return null;
  },
});

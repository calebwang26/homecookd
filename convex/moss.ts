"use node";
// Brings a family's Moss index up to date. Moss only finds moments; it never answers. Moss rebuilds
// the whole index on every write, so only one sync runs per family (worker.requestMossSync), and each
// one sends every ready recipe and removes what shouldn't be there (a cook who took back the stories,
// or deleted her account). A Moss error is tried again a few times (RETRY_MS), then left to the next
// change or `worker:reindexMissing`.
// MOSS_SYNC=off (Caleb, Oct 31: stop once Apple approves 1.0) stops sending: a sync then only deletes the family's index and
// clears `mossIndexedAt`, so jobs still finish and a deleted account leaves nothing in Moss. Turning it back on:
// unset it, then `npx convex run worker:reindexMissing` (needed before homie's voice cooking returns).
// The SDK is used because Moss's REST API can't create an index (convex.json lists it as external).
import { MossClient } from "@moss-js/moss";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { memoryDocs, mossIndexName, stepDocs } from "./lib/mossDocs";

/** Waits before each try again after a Moss error. */
export const RETRY_MS = [30_000, 2 * 60_000, 5 * 60_000];

/** The SDK's word that the index isn't there (a ManageApiError 404, or its message). */
const notFound = (e: unknown) =>
  (e as { status?: unknown } | null)?.status === 404 || /not found|does ?n[o’']t exist|no such index/i.test(String(e));

/** True while MOSS_SYNC=off: nothing is sent to Moss. */
export const syncOff = () => process.env.MOSS_SYNC === "off";

export const syncFamily = internalAction({
  args: { familyId: v.id("families"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { familyId, attempt = 0 }) => {
    const recipes = await ctx.runQuery(internal.worker.syncInput, { familyId });
    const projectId = process.env.MOSS_PROJECT_ID;
    const projectKey = process.env.MOSS_PROJECT_KEY;
    const off = syncOff();
    let ok = false;
    let failed = false;
    if (!projectId || !projectKey) {
      console.warn("MOSS_PROJECT_ID / MOSS_PROJECT_KEY aren't set");
    } else {
      try {
        const moss = new MossClient(projectId, projectKey);
        const name = mossIndexName(familyId);
        const docs = off ? [] : recipes.flatMap((r) => [...stepDocs(r), ...(r.memoriesOptIn ? memoryDocs(r) : [])]);
        if (!docs.length) {
          // Nothing left to find (the sync is off, or the only cook deleted her account): no index keeps any of it.
          await moss.deleteIndex(name).catch((e) => {
            if (!notFound(e)) throw e;
          });
        } else {
          // Unreadable counts as missing: creating it then fails if it's there after all, and is tried again.
          const existing = await moss.getDocs(name).catch(() => null);
          if (!existing) {
            await moss.createIndex(name, docs, { modelId: "moss-minilm" });
          } else {
            await moss.addDocs(name, docs, { upsert: true });
            const wanted = new Set(docs.map((d) => d.id));
            const stale = existing.map((d) => d.id).filter((id) => !wanted.has(id));
            if (stale.length) await moss.deleteDocs(name, stale);
          }
        }
        ok = true;
      } catch (e) {
        // The recipes still work without search meanwhile; the kid's questions then go to the cook.
        console.error("Moss sync failed", e);
        failed = true;
      }
    }
    const retry = failed && attempt < RETRY_MS.length ? { attempt: attempt + 1, inMs: RETRY_MS[attempt] } : undefined;
    await ctx.runMutation(internal.worker.synced, {
      familyId,
      recipeIds: recipes.map((r) => r._id),
      ok: ok && !off,
      ...(off && ok ? { cleared: true } : {}),
      ...(retry ? { retry } : {}),
    });
    return null;
  },
});

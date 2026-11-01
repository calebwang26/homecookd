// "Delete my account" in the app (App Store guideline 5.1.1(v)). deleteMe takes the caller out of Convex
// at once: their person row becomes a blank tombstone (other rows may point at it), every session as them
// ends, sign-in as them is refused (lib/auth.ts findSession, sessions.mirror), nothing of theirs is worked
// on again (jobs cancelled, recordings abandoned), a cook's recipes are gone for the whole family,
// Community included, with the dinners around them cancelled, and Moss is told. The rest is purged right
// after, in batches, each step through an index of its own rows: their messages and voice notes, their
// questions and answers, what they were cooking, their Community dinners and asks, what they put on a dish
// ask card (as the kid or as Mom) and their craving links, and a cook's jobs and recordings (homie's prompts, the glasses' live log and
// frames). A purge that stopped is started again by a cron (restartPurges). The accountDeletions row lists what Convex can't delete itself: their
// Supabase rows (the app calls POST /profiles/:id/remove next), their media in GCS and a voice clone.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { PUBLIC_COVER } from "./community";
import { deleteCard, dropCook, dropKid } from "./dishAsks";
import { cancelJob } from "./jobs";
import { dropLogOf, dropTokensOf } from "./push";
import { requireSession } from "./lib/auth";
import { dropFileOf } from "./lib/fileOwner";
import { requestMossSync } from "./worker";

/** Rows deleted (or changed) per purge run; the next run carries on where this one stopped. */
export const PURGE_BATCH = 500;
/** A purge with no batch for this long stopped; restartPurges starts it again, at most MAX_RESTARTS times. */
export const PURGE_STUCK_MS = 30 * 60_000;
const MAX_RESTARTS = 5;

export const deleteMe = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const { person, family } = await requireSession(ctx, sessionToken);
    const now = Date.now();
    const recipes = await ctx.db.query("recipes").withIndex("by_cookId", (q) => q.eq("cookId", person._id)).take(PURGE_BATCH);
    const jobs = await ctx.db.query("jobs").withIndex("by_cookId", (q) => q.eq("cookId", person._id)).take(PURGE_BATCH);
    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_cookId_and_startedAt", (q) => q.eq("cookId", person._id))
      .take(PURGE_BATCH);
    // Only recipes the pipeline made from her uploads: a seeded demo recipe's files are the public library's.
    const uploaded = new Set(jobs.map((j) => j.recipeId));
    const files = recipes.filter((r) => uploaded.has(r._id)).flatMap((r) => [r.recipeJsonUrl, r.coverUrl]);
    const mediaUrls = [...files, ...recordings.map((r) => r.videoUrl)].filter((u): u is string => !!u && !PUBLIC_COVER.test(u));
    const voiceCloneId = person.voiceClone?.cartesiaVoiceId;

    const deletionId = await ctx.db.insert("accountDeletions", {
      familyId: family._id,
      personId: person._id,
      supabaseProfileId: person.supabaseProfileId,
      requestedAt: now,
      recipeIds: recipes.map((r) => r._id),
      jobIds: jobs.map((j) => j._id),
      uploadPaths: [...new Set(jobs.map((j) => j.uploadPath))],
      mediaUrls: [...new Set(mediaUrls)],
      ...(voiceCloneId ? { voiceCloneId } : {}),
    });
    // Only what other rows and sessions.mirror need: no name, voice, language, place or campus.
    await ctx.db.replace("people", person._id, {
      familyId: person.familyId,
      supabaseProfileId: person.supabaseProfileId,
      name: "Deleted",
      role: person.role,
      deletedAt: now,
    });
    const sessions = await ctx.db.query("sessions").withIndex("by_personId", (q) => q.eq("personId", person._id)).take(1000);
    for (const s of sessions) await ctx.db.delete("sessions", s._id);
    await dropTokensOf(ctx, person._id);

    // Nothing of hers is worked on again: the worker can't claim (or finish) her jobs, and the glasses
    // can't make a recipe from her recordings (glasses.finished refuses an abandoned one).
    for (const j of jobs) await cancelJob(ctx, j);
    for (const r of recordings) {
      if (r.status !== "abandoned") await ctx.db.patch("recordings", r._id, { status: "abandoned", updatedAt: now });
    }
    // Off the map now: the dinners she hosts and any around her recipes (the purge deletes hers).
    const dinners = await ctx.db.query("dinners").withIndex("by_hostId", (q) => q.eq("hostId", person._id)).take(200);
    for (const r of recipes) {
      dinners.push(...(await ctx.db.query("dinners").withIndex("by_recipeId", (q) => q.eq("recipeId", r._id)).take(50)));
    }
    for (const d of dinners) if (d.status !== "cancelled") await ctx.db.patch("dinners", d._id, { status: "cancelled" });
    for (const r of recipes) await ctx.db.delete("recipes", r._id);
    if (recipes.length) await requestMossSync(ctx, family._id);
    await ctx.scheduler.runAfter(0, internal.account.purge, { deletionId, step: 0 });
    return null;
  },
});

export const purge = internalMutation({
  args: { deletionId: v.id("accountDeletions"), step: v.number() },
  returns: v.null(),
  handler: async (ctx, { deletionId, step }) => {
    const d = await ctx.db.get("accountDeletions", deletionId);
    if (!d || d.purgedAt !== undefined) return null;
    await ctx.db.patch("accountDeletions", deletionId, { purgeRunAt: Date.now() });
    let left = PURGE_BATCH;
    for (let i = step; i < STEPS.length; i++) {
      left -= await STEPS[i](ctx, d, left);
      if (left <= 0) {
        await ctx.scheduler.runAfter(0, internal.account.purge, { deletionId, step: i });
        return null;
      }
    }
    await ctx.db.patch("accountDeletions", deletionId, { purgedAt: Date.now() });
    // Again at the end, for a recipe the worker published after deleteMe (its sync drops what's gone).
    if (d.recipeIds.length) await requestMossSync(ctx, d.familyId);
    return null;
  },
});

/** The cron (crons.ts): starts again, from the top, each purge that stopped; every step finds only what's left. */
export const restartPurges = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db.query("accountDeletions").withIndex("by_purgedAt", (q) => q.eq("purgedAt", undefined)).take(100);
    for (const d of open) {
      if (now - (d.purgeRunAt ?? d.requestedAt) < PURGE_STUCK_MS) continue;
      const restarts = (d.purgeRestarts ?? 0) + 1;
      if (restarts > MAX_RESTARTS + 1) continue;
      await ctx.db.patch("accountDeletions", d._id, { purgeRestarts: restarts, purgeRunAt: now });
      if (restarts > MAX_RESTARTS) {
        console.error(`account purge ${d._id} keeps stopping; look at the logs and run account:purge by hand`);
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.account.purge, { deletionId: d._id, step: 0 });
    }
    return null;
  },
});

type Deletion = Doc<"accountDeletions">;
/** Deletes (or changes) at most `max` rows and says how many; fewer than `max` means this step is done. */
type Step = (ctx: MutationCtx, d: Deletion, max: number) => Promise<number>;

const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];

/** Adds what a step found that deleteMe didn't know of to the deletion row (and to `d`, for the steps after). */
async function note(ctx: MutationCtx, d: Deletion, found: { recipeIds?: Id<"recipes">[]; jobIds?: Id<"jobs">[]; uploadPaths?: string[] }) {
  const next = {
    recipeIds: union(d.recipeIds, found.recipeIds ?? []),
    jobIds: union(d.jobIds, found.jobIds ?? []),
    uploadPaths: union(d.uploadPaths, found.uploadPaths ?? []),
  };
  if (next.recipeIds.length + next.jobIds.length + next.uploadPaths.length === d.recipeIds.length + d.jobIds.length + d.uploadPaths.length) return;
  await ctx.db.patch("accountDeletions", d._id, next);
  Object.assign(d, next);
}

/** Runs `step` for each of her recipes until `max` rows are done. */
async function perRecipe(d: Deletion, max: number, step: (recipeId: Id<"recipes">, left: number) => Promise<number>) {
  let n = 0;
  for (const recipeId of d.recipeIds) {
    if (n >= max) break;
    n += await step(recipeId, max - n);
  }
  return n;
}

/** deleteMe took her recipes already; this catches one the worker published a moment later. */
const recipes: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("recipes").withIndex("by_cookId", (q) => q.eq("cookId", d.personId)).take(max);
  await note(ctx, d, { recipeIds: rows.map((r) => r._id) });
  for (const r of rows) await ctx.db.delete("recipes", r._id);
  return rows.length;
};

const messages: Step = async (ctx, d, max) => {
  const sent = await ctx.db.query("messages").withIndex("by_from", (q) => q.eq("from", d.personId)).take(max);
  for (const m of sent) {
    await dropFileOf(ctx, m.from, m.fileId);
    await ctx.db.delete("messages", m._id);
  }
  return sent.length;
};

/** The questions they asked and the ones about their recipes, with the answers on them. */
const questions: Step = async (ctx, d, max) => {
  const drop = async (rows: Doc<"questions">[]) => {
    for (const q of rows) {
      await dropFileOf(ctx, q.answer?.by, q.answer?.audioId);
      await ctx.db.delete("questions", q._id);
    }
    return rows.length;
  };
  const n = await drop(await ctx.db.query("questions").withIndex("by_askedBy", (q) => q.eq("askedBy", d.personId)).take(max));
  return (
    n +
    (await perRecipe(d, max - n, async (recipeId, left) =>
      drop(await ctx.db.query("questions").withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId)).take(left)),
    ))
  );
};

/** Their answer to anyone else's question comes off it, so it waits for an answer again. */
const answers: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("questions").withIndex("by_answer_by", (q) => q.eq("answer.by", d.personId)).take(max);
  for (const q of rows) {
    await dropFileOf(ctx, d.personId, q.answer?.audioId);
    await ctx.db.patch("questions", q._id, { status: "asked_cook", answer: undefined });
  }
  return rows.length;
};

/** What they were cooking, and anyone cooking one of their recipes. */
const cooking: Step = async (ctx, d, max) => {
  const drop = async (rows: Doc<"cookingSessions">[]) => {
    for (const s of rows) await ctx.db.delete("cookingSessions", s._id);
    return rows.length;
  };
  const n = await drop(await ctx.db.query("cookingSessions").withIndex("by_kidId", (q) => q.eq("kidId", d.personId)).take(max));
  return (
    n +
    (await perRecipe(d, max - n, async (recipeId, left) =>
      drop(await ctx.db.query("cookingSessions").withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId)).take(left)),
    ))
  );
};

/** A cook's recordings, each after everything saved with it. */
const recordings: Step = async (ctx, d, max) => {
  let n = 0;
  while (n < max) {
    const rec = await ctx.db.query("recordings").withIndex("by_cookId_and_startedAt", (q) => q.eq("cookId", d.personId)).first();
    if (!rec) break;
    for (const table of ["homiePrompts", "liveEvents", "liveWindows", "liveFrames"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_recordingId", (q) => q.eq("recordingId", rec._id)).take(max - n);
      for (const row of rows) {
        if ("storageId" in row) await dropFileOf(ctx, d.personId, row.storageId);
        await ctx.db.delete(table, row._id);
      }
      n += rows.length;
      if (n >= max) return n;
    }
    await dropFileOf(ctx, d.personId, rec.coverStorageId);
    await ctx.db.delete("recordings", rec._id);
    n++;
  }
  return n;
};

const jobs: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("jobs").withIndex("by_cookId", (q) => q.eq("cookId", d.personId)).take(max);
  await note(ctx, d, { jobIds: rows.map((j) => j._id), uploadPaths: rows.map((j) => j.uploadPath) });
  for (const j of rows) await ctx.db.delete("jobs", j._id);
  return rows.length;
};

/** Dinners they host, each after its guests' asks and its invite link's opens. */
const hostedDinners: Step = async (ctx, d, max) => {
  let n = 0;
  while (n < max) {
    const dinner = await ctx.db.query("dinners").withIndex("by_hostId", (q) => q.eq("hostId", d.personId)).first();
    if (!dinner) break;
    const asks = await ctx.db.query("dinnerRequests").withIndex("by_dinnerId", (q) => q.eq("dinnerId", dinner._id)).take(max - n);
    for (const r of asks) await ctx.db.delete("dinnerRequests", r._id);
    n += asks.length;
    if (n >= max) return n;
    const opens = await ctx.db
      .query("dinnerInviteOpens")
      .withIndex("by_dinnerId_and_deviceId", (q) => q.eq("dinnerId", dinner._id))
      .take(max - n);
    for (const o of opens) await ctx.db.delete("dinnerInviteOpens", o._id);
    n += opens.length;
    if (n >= max) return n;
    await ctx.db.delete("dinners", dinner._id);
    n++;
  }
  return n;
};

const dinnerAsks: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("dinnerRequests").withIndex("by_guestId", (q) => q.eq("guestId", d.personId)).take(max);
  for (const r of rows) await ctx.db.delete("dinnerRequests", r._id);
  return rows.length;
};

/** Swaps and "cook together" asks they made, and any with one of their recipes in it, either side. */
const swaps: Step = async (ctx, d, max) => {
  const drop = async (rows: Doc<"swapRequests">[]) => {
    for (const s of rows) await ctx.db.delete("swapRequests", s._id);
    return rows.length;
  };
  const n = await drop(await ctx.db.query("swapRequests").withIndex("by_requesterId", (q) => q.eq("requesterId", d.personId)).take(max));
  return (
    n +
    (await perRecipe(d, max - n, async (recipeId, left) => {
      const theirs = await drop(await ctx.db.query("swapRequests").withIndex("by_theirRecipeId", (q) => q.eq("theirRecipeId", recipeId)).take(left));
      if (theirs >= left) return theirs;
      return theirs + (await drop(await ctx.db.query("swapRequests").withIndex("by_myRecipeId", (q) => q.eq("myRecipeId", recipeId)).take(left - theirs)));
    }))
  );
};

/**
 * Dish ask cards they made as the kid (DISH-ASK-SPEC.md §5, V2-LINKING.md). One asked of a Mom who is still here
 * stays for her, without the kid's name, photos or voice note; any other goes, with her answers and every file.
 * A card's familyId alone deletes nothing.
 */
const dishCardsAsKid: Step = async (ctx, d, max) => {
  let n = 0;
  while (n < max) {
    const card = await ctx.db.query("dishAsks").withIndex("by_person", (q) => q.eq("personId", d.personId)).first();
    if (!card) break;
    const mom = card.requestedOf && card.requestedOf !== d.personId ? await ctx.db.get("people", card.requestedOf) : null;
    n += mom && mom.deletedAt === undefined ? await dropKid(ctx, card) : await deleteCard(ctx, card);
  }
  return n;
};

/** Dish ask cards asked of them as Mom: her answers, clips and version go; the card stays for the kid. */
const dishCardsAsCook: Step = async (ctx, d, max) => {
  let n = 0;
  while (n < max) {
    const card = await ctx.db.query("dishAsks").withIndex("by_requested_of", (q) => q.eq("requestedOf", d.personId)).first();
    if (!card) break;
    n += await dropCook(ctx, card);
  }
  return n;
};

/** The craving links they made (DISH-ASK-SPEC.md §8); the cards from them follow the two steps above. */
const cravingLinks: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("cravingLinks").withIndex("by_person", (q) => q.eq("personId", d.personId)).take(max);
  for (const link of rows) await ctx.db.delete("cravingLinks", link._id);
  return rows.length;
};

/** The pushes decided on for them (push.ts); their tokens went in deleteMe. */
const pushLog: Step = (ctx, d, max) => dropLogOf(ctx, d.personId, max);

// Recipes first, so a late one's questions, cooking and swaps go with the rest.
/** Whatever they uploaded and no row of theirs held any more: a draft photo, say. */
const fileClaims: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("fileClaims").withIndex("by_person", (q) => q.eq("personId", d.personId)).take(max);
  for (const c of rows) await dropFileOf(ctx, d.personId, c.storageId);
  return rows.length;
};

const STEPS: Step[] = [
  recipes, messages, questions, answers, cooking, recordings, jobs, hostedDinners, dinnerAsks, swaps, dishCardsAsKid, dishCardsAsCook,
  cravingLinks, pushLog, fileClaims,
];
